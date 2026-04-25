import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

// 8 real Untuckit songs pulled from Mingus prod, grouped as 4 hooks x 2 takes.
const SONG_FAMILIES = [
  {
    hookText: 'Good with that, just the way you are',
    takes: [
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/ac380244-2b13-430a-9dd7-a5ad15527c5f/1.mp3',
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/ac380244-2b13-430a-9dd7-a5ad15527c5f/2.mp3',
    ],
  },
  {
    hookText: 'Coming home to a Sunday afternoon',
    takes: [
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/2155b386-fabb-403a-b754-2db2e8ce4e30/1.mp3',
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/2155b386-fabb-403a-b754-2db2e8ce4e30/2.mp3',
    ],
  },
  {
    hookText: 'Say it again, slower this time',
    takes: [
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/debd1361-36c7-475d-a7bc-95d8666836e7/1.mp3',
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/debd1361-36c7-475d-a7bc-95d8666836e7/2.mp3',
    ],
  },
  {
    hookText: 'The long light of a midwest evening',
    takes: [
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/6c1e4ae5-8c17-4fee-9903-4536c0748642/1.mp3',
      'https://pub-c56d67b37830400a982d07e34b528013.r2.dev/tracks/6c1e4ae5-8c17-4fee-9903-4536c0748642/2.mp3',
    ],
  },
]

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'daniel@entuned.co'
  const adminPassword = process.env.ADMIN_PASSWORD ?? '1'

  // ---- Operator (admin) ----
  const passwordHash = await bcrypt.hash(adminPassword, 10)
  const admin = await prisma.operator.upsert({
    where: { email: adminEmail },
    update: { passwordHash, isAdmin: true, disabledAt: null },
    create: {
      email: adminEmail,
      passwordHash,
      displayName: 'Daniel',
      isAdmin: true,
    },
  })

  // ---- Client + ICP + Store ----
  const client = await prisma.client.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      companyName: 'Untuckit (test)',
      plan: 'mvp_pilot',
      brandLyricGuidelines: 'Warm, confident, never preachy. Avoid jargon.',
    },
  })

  const icp = await prisma.iCP.upsert({
    where: { id: '22222222-2222-2222-2222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      clientId: client.id,
      name: 'Park Meadows shopper',
      ageRange: '35-55',
      values: 'family, ease, quiet confidence',
      desires: 'feeling pulled-together without effort',
    },
  })

  // ---- Outcomes (global library, copy-on-write versioned) ----
  const brandKey = '33333333-3333-3333-3333-333333333333'
  const energyKey = '44444444-4444-4444-4444-444444444444'

  const brandOutcome = await prisma.outcome.upsert({
    where: { outcomeKey_version: { outcomeKey: brandKey, version: 1 } },
    update: {},
    create: {
      outcomeKey: brandKey,
      version: 1,
      title: 'Brand Reinforcement',
      tempoBpm: 92,
      mode: 'major',
      dynamics: 'soft-medium',
      instrumentation: 'rhodes, brushed kit, upright bass',
    },
  })

  const energyOutcome = await prisma.outcome.upsert({
    where: { outcomeKey_version: { outcomeKey: energyKey, version: 1 } },
    update: {},
    create: {
      outcomeKey: energyKey,
      version: 1,
      title: 'Energy Lift',
      tempoBpm: 116,
      mode: 'major',
      dynamics: 'medium-loud',
      instrumentation: 'electric guitar, drums, synth pad',
    },
  })

  // ---- Store (with default outcome + a schedule row covering business hours) ----
  const store = await prisma.store.upsert({
    where: { id: '55555555-5555-5555-5555-555555555555' },
    update: { defaultOutcomeId: brandOutcome.id },
    create: {
      id: '55555555-5555-5555-5555-555555555555',
      clientId: client.id,
      icpId: icp.id,
      name: 'Park Meadows',
      timezone: 'America/Denver',
      goLiveDate: new Date(),
      defaultOutcomeId: brandOutcome.id,
    },
  })

  // Wipe + reseed schedule rows (idempotency on this small set is overkill).
  await prisma.scheduleRow.deleteMany({ where: { storeId: store.id } })
  // Mon-Fri 10:00-14:00 = Brand; 14:00-19:00 = Energy. Sat-Sun 10:00-19:00 = Brand.
  const time = (h: number) => new Date(`1970-01-01T${String(h).padStart(2, '0')}:00:00.000Z`)
  for (let dow = 1; dow <= 5; dow++) {
    await prisma.scheduleRow.create({
      data: { storeId: store.id, dayOfWeek: dow, startTime: time(10), endTime: time(14), outcomeId: brandOutcome.id },
    })
    await prisma.scheduleRow.create({
      data: { storeId: store.id, dayOfWeek: dow, startTime: time(14), endTime: time(19), outcomeId: energyOutcome.id },
    })
  }
  for (const dow of [6, 7]) {
    await prisma.scheduleRow.create({
      data: { storeId: store.id, dayOfWeek: dow, startTime: time(10), endTime: time(19), outcomeId: brandOutcome.id },
    })
  }

  // Assign admin to store (admins bypass the table, but we write it for completeness).
  await prisma.operatorStoreAssignment.upsert({
    where: { operatorId_storeId: { operatorId: admin.id, storeId: store.id } },
    update: {},
    create: { operatorId: admin.id, storeId: store.id, assignedById: admin.id },
  })

  // ---- RotationRules (singleton) ----
  const existingRules = await prisma.rotationRules.findFirst()
  if (!existingRules) {
    await prisma.rotationRules.create({ data: {} }) // defaults: 240/45/3
  }

  // ---- Hooks + Songs + LineageRows ----
  // 4 hooks total: 2 against brand outcome, 2 against energy outcome.
  // Each hook has 2 LineageRows (the two takes).
  await prisma.lineageRow.deleteMany({ where: { icpId: icp.id } })
  await prisma.song.deleteMany({})
  await prisma.hook.deleteMany({ where: { icpId: icp.id } })

  for (let i = 0; i < SONG_FAMILIES.length; i++) {
    const fam = SONG_FAMILIES[i]
    const outcome = i < 2 ? brandOutcome : energyOutcome
    const hook = await prisma.hook.create({
      data: {
        icpId: icp.id,
        outcomeId: outcome.id,
        text: fam.hookText,
        status: 'approved',
        approvedAt: new Date(),
        approvedById: admin.id,
      },
    })
    for (const url of fam.takes) {
      const objectKey = url.split('.r2.dev/')[1]
      const song = await prisma.song.create({
        data: { r2Url: url, r2ObjectKey: objectKey, contentType: 'audio/mpeg' },
      })
      await prisma.lineageRow.create({
        data: {
          id: randomUUID(),
          songId: song.id,
          r2Url: url,
          icpId: icp.id,
          outcomeId: outcome.id,
          hookId: hook.id,
          active: true,
        },
      })
    }
  }

  // ---- Summary ----
  const counts = {
    operators: await prisma.operator.count(),
    clients: await prisma.client.count(),
    icps: await prisma.iCP.count(),
    stores: await prisma.store.count(),
    outcomes: await prisma.outcome.count(),
    scheduleRows: await prisma.scheduleRow.count(),
    hooks: await prisma.hook.count(),
    songs: await prisma.song.count(),
    lineageRows: await prisma.lineageRow.count(),
    rotationRules: await prisma.rotationRules.count(),
  }
  console.log('Seed complete:', counts)
  console.log('Store id:', store.id)
  console.log('Admin email:', adminEmail)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
