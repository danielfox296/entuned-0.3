// Tests for the nurture-drip worker.
//
// Covers: drip cadence (matches step day), idempotency via LifecycleEmailLog,
// opt-out short-circuit, multi-store-per-Client dedupe, one-drip-per-run cap.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    store: { findMany: vi.fn() },
    lifecycleEmailLog: { findUnique: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('../lib/email.js', () => ({
  sendLifecycle: vi.fn(),
}))

import { runNurtureDrip } from './nurture-drip.js'
import { prisma } from '../db.js'
import { sendLifecycle } from '../lib/email.js'

const storeFindMany = prisma.store.findMany as ReturnType<typeof vi.fn>
const logFindUnique = prisma.lifecycleEmailLog.findUnique as ReturnType<typeof vi.fn>
const logCreate = prisma.lifecycleEmailLog.create as ReturnType<typeof vi.fn>
const sendMock = sendLifecycle as ReturnType<typeof vi.fn>

const NOW = new Date('2026-05-19T15:00:00Z')
const DAY_MS = 86_400_000

beforeEach(() => {
  vi.resetAllMocks()
})

function freeStore(opts: { id: string; clientId: string; daysAgo: number; accountId: string; email: string }) {
  return {
    id: opts.id,
    slug: `slug-${opts.id}`,
    createdAt: new Date(NOW.getTime() - opts.daysAgo * DAY_MS),
    clientId: opts.clientId,
    client: {
      memberships: [{ account: { id: opts.accountId, email: opts.email } }],
    },
  }
}

describe('runNurtureDrip', () => {
  it('sends the day-2 template at exactly day 2', async () => {
    storeFindMany.mockResolvedValue([
      freeStore({ id: 's1', clientId: 'c1', daysAgo: 2, accountId: 'a1', email: 'u1@x.com' }),
    ])
    logFindUnique.mockResolvedValue(null)
    sendMock.mockResolvedValue({ ok: true })
    logCreate.mockResolvedValue({})

    const stats = await runNurtureDrip(NOW)
    expect(stats.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledWith(
      'free_drip_invisible_channel',
      { accountId: 'a1', email: 'u1@x.com' },
      expect.objectContaining({ playerUrl: expect.stringContaining('slug-s1') }),
    )
  })

  it('sends only ONE drip per run even when multiple days have passed without a send', async () => {
    // 10-day-old Store, nothing sent → worker picks the latest-eligible
    // unsent drip (day 10 — free_drip_case_study) and stops.
    storeFindMany.mockResolvedValue([
      freeStore({ id: 's1', clientId: 'c1', daysAgo: 10, accountId: 'a1', email: 'u1@x.com' }),
    ])
    logFindUnique.mockResolvedValue(null)
    sendMock.mockResolvedValue({ ok: true })

    const stats = await runNurtureDrip(NOW)
    expect(stats.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    // First unsent step is day-2 (invisible_channel); the worker sends that
    // then stops. (Catch-up is intentional: next run will send the next.)
    expect(sendMock).toHaveBeenCalledWith(
      'free_drip_invisible_channel',
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('skips a drip that was already logged in LifecycleEmailLog', async () => {
    storeFindMany.mockResolvedValue([
      freeStore({ id: 's1', clientId: 'c1', daysAgo: 4, accountId: 'a1', email: 'u1@x.com' }),
    ])
    // Day-2 was sent yesterday → log row exists for it. Day-4 has no row →
    // worker should send day-4.
    logFindUnique.mockImplementation(async (args: { where: { accountId_templateName_contextKey: { templateName: string } } }) => {
      const tmpl = args.where.accountId_templateName_contextKey.templateName
      if (tmpl === 'free_drip_invisible_channel') return { id: 'logged' }
      return null
    })
    sendMock.mockResolvedValue({ ok: true })

    const stats = await runNurtureDrip(NOW)
    expect(stats.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledWith(
      'free_drip_proof',
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('logs the attempt on opt-out so we do not re-consider it daily', async () => {
    storeFindMany.mockResolvedValue([
      freeStore({ id: 's1', clientId: 'c1', daysAgo: 2, accountId: 'a1', email: 'u1@x.com' }),
    ])
    logFindUnique.mockResolvedValue(null)
    sendMock.mockResolvedValue({ ok: true, skipped: true })

    const stats = await runNurtureDrip(NOW)
    expect(stats.skipped).toBe(1)
    expect(stats.sent).toBe(0)
    expect(logCreate).toHaveBeenCalledWith({
      data: { accountId: 'a1', templateName: 'free_drip_invisible_channel' },
    })
  })

  it('only sends to one Store per Client per run (multi-Store dedupe)', async () => {
    storeFindMany.mockResolvedValue([
      freeStore({ id: 's1', clientId: 'c-shared', daysAgo: 2, accountId: 'a1', email: 'u@x.com' }),
      freeStore({ id: 's2', clientId: 'c-shared', daysAgo: 2, accountId: 'a1', email: 'u@x.com' }),
    ])
    logFindUnique.mockResolvedValue(null)
    sendMock.mockResolvedValue({ ok: true })

    const stats = await runNurtureDrip(NOW)
    // First Store sends; second Store under the same Client is skipped by
    // the in-memory dedupe.
    expect(stats.sent).toBe(1)
    expect(stats.skipped).toBeGreaterThanOrEqual(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('skips a Store with no owner/manager membership', async () => {
    storeFindMany.mockResolvedValue([
      {
        id: 's1', slug: 's1', createdAt: new Date(NOW.getTime() - 5 * DAY_MS),
        clientId: 'c1', client: { memberships: [] },
      },
    ])
    const stats = await runNurtureDrip(NOW)
    expect(stats.sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
