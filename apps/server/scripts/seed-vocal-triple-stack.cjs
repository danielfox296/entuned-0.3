// One-time seed: populate vocal triple-stack arrays on existing GenreGravityRules.
// Run via: railway ssh "cd /app && node scripts/seed-vocal-triple-stack.cjs"
// (After the new deploy lands with this file.)
//
// Or run locally: node apps/server/scripts/seed-vocal-triple-stack.cjs
// (Uses DATABASE_URL from .env)

const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

const seeds = {
  'hip hop': {
    characters: ['gritty', 'gravelly', 'smooth', 'nasal', 'husky', 'dark', 'bright'],
    deliveries: ['behind-the-beat', 'commanding', 'conversational', 'laid-back', 'rapid-fire', 'half-spoken'],
    effects: ['close-mic', 'compressed', 'dry studio', 'lo-fi', 'broadcast-quality'],
  },
  'indie': {
    characters: ['breathy', 'thin', 'reedy', 'ethereal', 'nasal', 'warm', 'airy'],
    deliveries: ['conversational', 'whispered', 'intimate', 'detached', 'laid-back', 'behind-the-beat'],
    effects: ['close-mic', 'reverb-drenched', 'lo-fi', 'tape-saturated', 'dry studio'],
  },
  'country': {
    characters: ['raspy', 'warm', 'twangy', 'gravelly', 'husky', 'velvety', 'gritty'],
    deliveries: ['storytelling', 'conversational', 'behind-the-beat', 'belted', 'intimate', 'drawled'],
    effects: ['close-mic', 'dry studio', 'room-mic', 'tape-saturated', 'broadcast-quality'],
  },
  'jazz': {
    characters: ['smoky', 'silky', 'breathy', 'dark', 'warm', 'sultry', 'velvety'],
    deliveries: ['behind-the-beat', 'intimate', 'conversational', 'restrained', 'soaring', 'laid-back'],
    effects: ['close-mic', 'room-mic', 'reverb-drenched', 'tape-saturated', 'dry studio'],
  },
  'blues': {
    characters: ['gravelly', 'raspy', 'gritty', 'dark', 'husky', 'raw', 'weathered'],
    deliveries: ['belted', 'behind-the-beat', 'commanding', 'intimate', 'storytelling', 'laid-back'],
    effects: ['close-mic', 'room-mic', 'tape-saturated', 'lo-fi', 'dry studio'],
  },
  'soul': {
    characters: ['silky', 'warm', 'raspy', 'dark', 'sultry', 'velvety', 'breathy'],
    deliveries: ['intimate', 'soaring', 'behind-the-beat', 'powerful', 'restrained', 'conversational'],
    effects: ['close-mic', 'reverb-drenched', 'tape-saturated', 'room-mic', 'compressed'],
  },
  'folk': {
    characters: ['breathy', 'warm', 'thin', 'reedy', 'airy', 'ethereal', 'clear'],
    deliveries: ['intimate', 'storytelling', 'whispered', 'conversational', 'soft-spoken', 'laid-back'],
    effects: ['close-mic', 'room-mic', 'dry studio', 'tape-saturated', 'lo-fi'],
  },
  'rock': {
    characters: ['gritty', 'raspy', 'gravelly', 'raw', 'husky', 'bright', 'dark'],
    deliveries: ['belted', 'commanding', 'powerful', 'soaring', 'behind-the-beat', 'declarative'],
    effects: ['close-mic', 'compressed', 'room-mic', 'dry studio', 'wide stereo'],
  },
  'electropop': {
    characters: ['breathy', 'silky', 'ethereal', 'bright', 'airy', 'thin', 'dark'],
    deliveries: ['detached', 'whispered', 'intimate', 'declarative', 'conversational', 'laid-back'],
    effects: ['compressed', 'wide stereo', 'close-mic', 'reverb-drenched', 'dry studio'],
  },
  'ambient': {
    characters: ['ethereal', 'breathy', 'airy', 'thin', 'warm', 'distant', 'ghostly'],
    deliveries: ['whispered', 'intimate', 'restrained', 'soft-spoken', 'soaring', 'detached'],
    effects: ['reverb-drenched', 'wide stereo', 'distant-mic', 'tape-saturated', 'lo-fi'],
  },
  'reggaeton': {
    characters: ['nasal', 'gritty', 'smooth', 'bright', 'husky', 'dark'],
    deliveries: ['rapid-fire', 'half-spoken', 'conversational', 'commanding', 'behind-the-beat', 'laid-back'],
    effects: ['compressed', 'close-mic', 'dry studio', 'broadcast-quality'],
  },
  'gospel': {
    characters: ['warm', 'raspy', 'powerful', 'bright', 'dark', 'silky', 'gravelly'],
    deliveries: ['belted', 'soaring', 'powerful', 'commanding', 'intimate', 'declarative'],
    effects: ['room-mic', 'reverb-drenched', 'close-mic', 'wide stereo', 'broadcast-quality'],
  },
  'funk': {
    characters: ['gritty', 'nasal', 'raspy', 'bright', 'husky', 'raw'],
    deliveries: ['commanding', 'behind-the-beat', 'half-spoken', 'belted', 'conversational', 'rapid-fire'],
    effects: ['close-mic', 'compressed', 'dry studio', 'room-mic', 'tape-saturated'],
  },
  'soft rock': {
    characters: ['warm', 'smooth', 'velvety', 'silky', 'breathy', 'clear'],
    deliveries: ['intimate', 'conversational', 'restrained', 'laid-back', 'soft-spoken', 'soaring'],
    effects: ['close-mic', 'reverb-drenched', 'room-mic', 'tape-saturated', 'dry studio'],
  },
  'smooth jazz': {
    characters: ['silky', 'warm', 'breathy', 'sultry', 'velvety', 'dark'],
    deliveries: ['intimate', 'laid-back', 'behind-the-beat', 'restrained', 'conversational'],
    effects: ['close-mic', 'reverb-drenched', 'room-mic', 'tape-saturated'],
  },
  'edm': {
    characters: ['breathy', 'ethereal', 'bright', 'thin', 'airy', 'silky'],
    deliveries: ['declarative', 'whispered', 'soaring', 'detached', 'intimate', 'belted'],
    effects: ['compressed', 'wide stereo', 'reverb-drenched', 'close-mic', 'dry studio'],
  },
}

async function main() {
  const rules = await p.genreGravityRule.findMany({
    where: { active: true },
    select: { id: true, tag: true },
  })
  let updated = 0
  for (const rule of rules) {
    const seed = seeds[rule.tag]
    if (!seed) {
      console.log('SKIP (no seed):', rule.tag)
      continue
    }
    await p.$executeRawUnsafe(
      `UPDATE genre_gravity_rules
       SET vocal_characters = $1::text[],
           vocal_deliveries = $2::text[],
           vocal_effects = $3::text[]
       WHERE id = $4::uuid`,
      seed.characters,
      seed.deliveries,
      seed.effects,
      rule.id,
    )
    const combos = seed.characters.length * seed.deliveries.length * seed.effects.length
    console.log('SEEDED:', rule.tag, '|', seed.characters.length, 'chars x', seed.deliveries.length, 'deliv x', seed.effects.length, 'effects =', combos, 'combos')
    updated++
  }
  console.log('Done:', updated, 'rules updated')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
