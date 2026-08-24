import { describe, it, expect } from 'vitest'
import { EMPTY_ATTRIBUTION, type Attribution } from './attribution.js'
import {
  ENGAGEMENT_GRACE_DAYS,
  attributionCoverage,
  buildSpamContext,
  canonicalEmail,
  channelOf,
  creativeOf,
  DIRECT_CHANNEL,
  funnelTotals,
  furthestStage,
  isDisposableDomain,
  isFreemail,
  looksMachineGenerated,
  materialOf,
  pct,
  reachedStage,
  rollup,
  scoreCohort,
  spamVerdict,
  UNKNOWN_MATERIAL,
  type SignupRecord,
} from './signupInsights.js'

const NOW = new Date('2026-08-24T12:00:00Z')

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000)
}

function attr(overrides: Partial<Attribution> = {}): Attribution {
  return { ...EMPTY_ATTRIBUTION, ...overrides }
}

function record(overrides: Partial<SignupRecord> = {}): SignupRecord {
  return {
    clientId: 'c1',
    companyName: 'acme',
    email: 'jane@acmeretail.com',
    signedUpAt: daysAgo(10),
    lastLoginAt: null,
    industry: null,
    attribution: attr(),
    ownIcpCount: 0,
    playbackCount: 0,
    firstPlaybackAt: null,
    paid: false,
    ...overrides,
  }
}

describe('furthestStage', () => {
  it('returns signed_up for a bare new account', () => {
    expect(furthestStage(record())).toBe('signed_up')
  })

  it('returns onboarded once industry is set', () => {
    expect(furthestStage(record({ industry: 'apparel' }))).toBe('onboarded')
  })

  it('returns audience_built once the customer made their own ICP', () => {
    expect(furthestStage(record({ industry: 'apparel', ownIcpCount: 1 }))).toBe('audience_built')
  })

  it('returns activated once anything played', () => {
    expect(furthestStage(record({ ownIcpCount: 1, playbackCount: 12 }))).toBe('activated')
  })

  it('returns paid regardless of the earlier steps', () => {
    expect(furthestStage(record({ paid: true }))).toBe('paid')
  })
})

describe('reachedStage', () => {
  it('is monotonic — a paid customer counts as reaching every earlier stage', () => {
    const r = record({ paid: true, industry: null, ownIcpCount: 0, playbackCount: 0 })
    expect(reachedStage(r, 'onboarded')).toBe(true)
    expect(reachedStage(r, 'audience_built')).toBe(true)
    expect(reachedStage(r, 'activated')).toBe(true)
    expect(reachedStage(r, 'paid')).toBe(true)
  })

  it('does not credit stages beyond the one reached', () => {
    const r = record({ industry: 'apparel' })
    expect(reachedStage(r, 'onboarded')).toBe(true)
    expect(reachedStage(r, 'audience_built')).toBe(false)
  })
})

describe('channelOf', () => {
  it('prefers UTM tags and includes the campaign when present', () => {
    expect(
      channelOf(attr({ utmSource: 'reddit', utmMedium: 'social', utmCampaign: 'spring' })),
    ).toBe('reddit / social / spring')
  })

  it('marks a missing medium rather than dropping the source', () => {
    expect(channelOf(attr({ utmSource: 'newsletter' }))).toBe('newsletter / (no medium)')
  })

  it('falls back to the referral code before the referrer', () => {
    expect(
      channelOf(attr({ referralCode: 'X7K9QW2Z', referrer: 'https://google.com/' })),
    ).toBe('referral / X7K9QW2Z')
  })

  it('falls back to the referrer host with www stripped', () => {
    expect(channelOf(attr({ referrer: 'https://www.google.com/search?q=store+music' }))).toBe(
      'google.com',
    )
  })

  it('reports direct when nothing was captured', () => {
    expect(channelOf(EMPTY_ATTRIBUTION)).toBe(DIRECT_CHANNEL)
  })
})

describe('materialOf', () => {
  it('drops the query string so one page groups as one row', () => {
    expect(materialOf(attr({ landingPath: '/for-apparel?utm_source=reddit' }))).toBe('/for-apparel')
  })

  it('drops a trailing slash but keeps the bare root', () => {
    expect(materialOf(attr({ landingPath: '/pricing/' }))).toBe('/pricing')
    expect(materialOf(attr({ landingPath: '/' }))).toBe('/')
  })

  it('labels the missing case explicitly', () => {
    expect(materialOf(EMPTY_ATTRIBUTION)).toBe(UNKNOWN_MATERIAL)
  })
})

describe('creativeOf', () => {
  it('joins campaign, content, and term into one creative label', () => {
    expect(creativeOf(attr({ utmCampaign: 'spring', utmContent: 'video-a', utmTerm: 'bar music' }))).toBe(
      'spring · video-a · bar music',
    )
  })

  it('returns null when nothing is tagged', () => {
    expect(creativeOf(EMPTY_ATTRIBUTION)).toBeNull()
  })
})

describe('email helpers', () => {
  it('recognises freemail and disposable domains', () => {
    expect(isFreemail('gmail.com')).toBe(true)
    expect(isFreemail('acmeretail.com')).toBe(false)
    expect(isDisposableDomain('mailinator.com')).toBe(true)
    expect(isDisposableDomain('team.mailinator.com')).toBe(true)
    expect(isDisposableDomain('acmeretail.com')).toBe(false)
  })

  it('collapses gmail dots and plus tags to one inbox', () => {
    expect(canonicalEmail('Jane.Doe+entuned@gmail.com')).toBe('janedoe@gmail.com')
    expect(canonicalEmail('jane.doe@googlemail.com')).toBe('janedoe@gmail.com')
  })

  it('strips only the plus tag on non-gmail domains', () => {
    expect(canonicalEmail('jane.doe+x@acmeretail.com')).toBe('jane.doe@acmeretail.com')
  })
})

describe('looksMachineGenerated', () => {
  it('does not flag ordinary human local parts', () => {
    const humanShapes = [
      'jane',
      'jane.doe',
      'john_smith',
      'daniel',
      'krzysztof',
      'info',
      'jsmith84', // initial + surname + year — a very common real shape
      'mcdonald',
      'schwartz',
      'thecornershop',
    ]
    for (const local of humanShapes) {
      expect(looksMachineGenerated(local), local).toBe(false)
    }
  })

  it('flags long consonant runs', () => {
    expect(looksMachineGenerated('xkcdrqtplm')).toBe(true)
  })

  it('flags a long, vowel-starved string that has no long consonant run', () => {
    expect(looksMachineGenerated('bkrtlamspzte')).toBe(true)
  })

  it('flags a long letter stem with a long digit tail', () => {
    expect(looksMachineGenerated('bxtrqa8472619')).toBe(true)
  })

  it('ignores short local parts entirely', () => {
    expect(looksMachineGenerated('qwrtz')).toBe(false)
  })
})

describe('spamVerdict', () => {
  function verdictFor(r: SignupRecord, cohort: SignupRecord[] = [r]) {
    return spamVerdict(r, buildSpamContext(cohort, NOW))
  }

  it('leaves a quiet but plausible brand-new signup clean', () => {
    const r = record({ signedUpAt: daysAgo(1) })
    const v = verdictFor(r)
    expect(v.level).toBe('clean')
    expect(v.engagement).toBe('too_early')
  })

  it('does not call a dormant real-looking lead spam', () => {
    const r = record({ signedUpAt: daysAgo(30) })
    const v = verdictFor(r)
    expect(v.engagement).toBe('dormant')
    expect(v.level).toBe('clean')
  })

  it('flags a disposable inbox as likely spam on identity alone', () => {
    const r = record({ email: 'asdf@mailinator.com', signedUpAt: daysAgo(1) })
    const v = verdictFor(r)
    expect(v.level).toBe('likely_spam')
    expect(v.reasons.join(' ')).toContain('disposable')
  })

  it('escalates a generated-looking address that also went dormant', () => {
    const r = record({ email: 'bxtrqa8472619@gmail.com', signedUpAt: daysAgo(20) })
    const v = verdictFor(r)
    expect(v.engagement).toBe('dormant')
    expect(v.level).toBe('likely_spam')
  })

  it('flags two signups that resolve to the same gmail inbox', () => {
    const a = record({ clientId: 'a', email: 'jane.doe@gmail.com' })
    const b = record({ clientId: 'b', email: 'janedoe+two@gmail.com' })
    const v = verdictFor(a, [a, b])
    expect(v.reasons.join(' ')).toContain('same inbox')
    expect(v.score).toBeGreaterThanOrEqual(3)
  })

  it('flags three signups on one corporate domain inside an hour', () => {
    const cohort = [0, 10, 20].map((mins, i) =>
      record({
        clientId: `c${i}`,
        email: `user${i}@somecorp.io`,
        signedUpAt: new Date(daysAgo(5).getTime() + mins * 60_000),
      }),
    )
    const v = verdictFor(cohort[0], cohort)
    expect(v.reasons.join(' ')).toContain('somecorp.io within an hour')
  })

  it('does not treat a gmail cluster as a burst', () => {
    const cohort = [0, 10, 20].map((mins, i) =>
      record({
        clientId: `c${i}`,
        email: `person${i}@gmail.com`,
        signedUpAt: new Date(daysAgo(5).getTime() + mins * 60_000),
      }),
    )
    const v = verdictFor(cohort[0], cohort)
    expect(v.reasons.join(' ')).not.toContain('within an hour')
  })

  it('treats engagement as engaged the moment anything played', () => {
    const r = record({ signedUpAt: daysAgo(30), playbackCount: 4 })
    expect(verdictFor(r).engagement).toBe('engaged')
  })

  it('treats a much-later sign-in as engagement', () => {
    const r = record({ signedUpAt: daysAgo(30), lastLoginAt: daysAgo(2) })
    expect(verdictFor(r).engagement).toBe('engaged')
  })

  it('does not count the sign-in that created the account as returning', () => {
    const signedUpAt = daysAgo(30)
    const r = record({ signedUpAt, lastLoginAt: new Date(signedUpAt.getTime() + 1000) })
    expect(verdictFor(r).engagement).toBe('dormant')
  })

  it('holds the dormant call until the grace window has passed', () => {
    const justInside = record({ signedUpAt: daysAgo(ENGAGEMENT_GRACE_DAYS - 0.5) })
    const justOutside = record({ signedUpAt: daysAgo(ENGAGEMENT_GRACE_DAYS + 0.5) })
    expect(verdictFor(justInside).engagement).toBe('too_early')
    expect(verdictFor(justOutside).engagement).toBe('dormant')
  })
})

describe('rollup', () => {
  // Distinct emails and signup times — a shared address or a shared minute
  // would trip the alias-collision and same-domain-burst rules and flag the
  // whole fixture, which is exactly what those rules are for.
  const cohort = scoreCohort(
    [
      record({
        clientId: '1',
        email: 'jane@apparelco.com',
        signedUpAt: daysAgo(12),
        attribution: attr({ landingPath: '/for-apparel' }),
        industry: 'apparel',
        playbackCount: 5,
      }),
      record({
        clientId: '2',
        email: 'marco@thecornershop.com',
        signedUpAt: daysAgo(9),
        attribution: attr({ landingPath: '/for-apparel?x=1' }),
        industry: 'apparel',
      }),
      record({
        clientId: '3',
        email: 'owner@thirdwavecoffee.com',
        signedUpAt: daysAgo(6),
        attribution: attr({ landingPath: '/pricing' }),
        paid: true,
      }),
      record({
        clientId: '4',
        email: 'zz@mailinator.com',
        signedUpAt: daysAgo(4),
        attribution: attr({ landingPath: '/pricing' }),
      }),
    ],
    NOW,
  )

  it('groups landing paths after normalisation and counts the funnel', () => {
    const rows = rollup(cohort, (r) => materialOf(r.attribution))
    const apparel = rows.find((r) => r.key === '/for-apparel')
    expect(apparel).toBeDefined()
    expect(apparel!.signups).toBe(2)
    expect(apparel!.onboarded).toBe(2)
    expect(apparel!.activated).toBe(1)
    expect(apparel!.paid).toBe(0)
  })

  it('reports flagged and clean counts alongside the funnel', () => {
    const rows = rollup(cohort, (r) => materialOf(r.attribution))
    const pricing = rows.find((r) => r.key === '/pricing')!
    expect(pricing.signups).toBe(2)
    expect(pricing.paid).toBe(1)
    expect(pricing.likelySpam).toBe(1)
    expect(pricing.flagged).toBe(1)
    expect(pricing.clean).toBe(1)
  })

  it('sorts busiest first with a stable alphabetical tiebreak', () => {
    const rows = rollup(cohort, (r) => materialOf(r.attribution))
    expect(rows.map((r) => r.key)).toEqual(['/for-apparel', '/pricing'])
  })

  it('funnelTotals sums the whole cohort', () => {
    const totals = funnelTotals(cohort)
    expect(totals.signups).toBe(4)
    expect(totals.paid).toBe(1)
    expect(totals.likelySpam).toBe(1)
  })

  it('funnelTotals returns a zeroed row for an empty cohort', () => {
    const totals = funnelTotals([])
    expect(totals.signups).toBe(0)
    expect(totals.paid).toBe(0)
  })
})

describe('attributionCoverage', () => {
  it('counts how much of the cohort carries usable attribution', () => {
    const c = attributionCoverage([
      record({ attribution: attr({ utmSource: 'reddit', landingPath: '/x' }) }),
      record({ attribution: attr({ referrer: 'https://google.com/' }) }),
      record({ attribution: EMPTY_ATTRIBUTION }),
    ])
    expect(c).toEqual({ total: 3, withAny: 2, withUtm: 1, withLandingPath: 1 })
  })
})

describe('pct', () => {
  it('rounds and guards a zero denominator', () => {
    expect(pct(1, 3)).toBe('33%')
    expect(pct(0, 0)).toBe('—')
  })
})
