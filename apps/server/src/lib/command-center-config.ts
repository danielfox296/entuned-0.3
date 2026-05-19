// Command Center configuration.
//
// Keywords, subreddits, queries, narrative + format catalogs for the
// agentic growth subsystems. Checked into git (not DB) so iteration is a
// code edit, not a Dash CRUD operation. If a value starts needing to be
// edited by non-developers, promote it to a DB-backed model.
//
// Spec: morning-command-center-spec.md

// ---- Discriminator values used across QueueItem / ContentPiece ------------

export const QUEUE_TYPES = [
  'signal',
  'outreach',
  'content',
  'trigger',
  'seo',
  'nurture',
] as const
export type QueueType = (typeof QUEUE_TYPES)[number]

export const QUEUE_STATUSES = [
  'pending',
  'approved',
  'skipped',
  'snoozed',
  'sent',
  'failed',
] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

export const QUEUE_ACTIONS = ['approved', 'skipped', 'edited', 'snoozed'] as const
export type QueueAction = (typeof QUEUE_ACTIONS)[number]

export const PROOF_CATEGORIES = [
  'testimonial',
  'data_point',
  'staff_quote',
  'customer_quote',
] as const
export type ProofCategory = (typeof PROOF_CATEGORIES)[number]

export const CONTENT_FORMATS = [
  'linkedin',
  'reddit_comment',
  'blog',
  'email_snippet',
  'tweet',
  'video_script',
  'cold_email_opener',
] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

export const CONTENT_STATUSES = ['draft', 'approved', 'published', 'rejected'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

// Free-text narrative codes. New ones get added here as the playbook grows.
export const NARRATIVES = [
  'floor-job',
  'invisible-channel',
  'data-company',
  'add-to-pile',
  'kari-lift',
  'two-channels',
  'origin-story',
  'competitor-alternative',
  'licensing-confusion',
  'outcome-optimization',
  'sensory-retail',
] as const
export type Narrative = (typeof NARRATIVES)[number]

// ---- Format generation constraints --------------------------------------
//
// Used by the content-multiplier worker to shape each Claude generation
// call. Keep instructions terse — the writing-voice skill carries the tone.

export const FORMAT_CONSTRAINTS: Record<
  ContentFormat,
  { maxWords?: number; maxChars?: number; style: string }
> = {
  linkedin: {
    maxWords: 300,
    style: 'professional but warm, first person, paragraph breaks, no hashtags',
  },
  reddit_comment: {
    maxWords: 150,
    style: 'ultra casual, lowercase ok, typos ok, sounds typed fast by a real person',
  },
  blog: {
    maxWords: 1200,
    style: "Daniel's writing voice; story-driven; no marketing fluff; subheads optional",
  },
  email_snippet: {
    maxWords: 60,
    style: 'proof paragraph for cold emails; one tight sentence + one detail',
  },
  tweet: {
    maxChars: 280,
    style: 'one sharp observation; no hashtags; no emojis',
  },
  video_script: {
    maxWords: 150,
    style: '60-second short-form script; [bracketed] visual directions',
  },
  cold_email_opener: {
    maxWords: 40,
    style: 'first 1-2 sentences of a cold email; hook only; no introduction',
  },
}

// ---- Signal scanner (Reddit) --------------------------------------------

export const SIGNAL_KEYWORDS = [
  'background music',
  'in-store music',
  'store playlist',
  'retail music',
  'what do you play in your store',
  'music for my store',
  'store ambiance',
  'Mood Media',
  'Soundtrack Your Brand',
  'Cloud Cover',
  'Rockbot',
  'music licensing retail',
  'can I play Spotify in my store',
  'ASCAP BMI retail',
  'store vibe',
  'retail atmosphere',
  'increase dwell time',
  'customer experience retail',
  'background music service',
  'business music service',
]

export const SIGNAL_SUBREDDITS = [
  'smallbusiness',
  'retail',
  'Entrepreneur',
  'retailowners',
  'boutique',
  'restaurateur',
  'smallbusinessowner',
  'ecommerce',
  'shopify',
  'squareup',
  'marketing',
  'Music',
  'AskRetail',
  'RetailManagement',
  'EntrepreneurRideAlong',
  'Flipping',
  'BoutiqueOwners',
  'antiqueshop',
  'cafeowners',
  'restaurantowners',
]

// Auto-expire signal items older than this — stale Reddit posts aren't
// worth replying to.
export const SIGNAL_MAX_AGE_HOURS = 48

// Score thresholds for the signal scanner lanes (see workers/signal-scanner.ts):
//   ≥ MIN_SCORE_FOR_PITCH_DRAFT     → "you can mention Entuned if natural" lane
//   ≥ MIN_SCORE_FOR_HELPFUL_DRAFT   → "be helpful, no pitch" lane
//   below that                       → queue without a draft (Daniel reads + decides)
//
// Two-lane design: most adjacent retail conversation isn't a buying signal,
// but Daniel showing up helpfully in those threads still builds presence
// and reciprocity. The helpful lane explicitly forbids the LLM from naming
// Entuned at all — the goal is "store-floor guy who knows stuff", not pitch.
export const MIN_SCORE_FOR_PITCH_DRAFT = 50
export const MIN_SCORE_FOR_HELPFUL_DRAFT = 20

// ---- SEO content pipeline ------------------------------------------------

export const SEO_CLUSTERS: Record<Narrative, string[]> = {
  'competitor-alternative': [
    'mood media alternative',
    'soundtrack your brand alternative',
    'cloud cover music alternative',
    'rockbot alternative',
    'best background music service for retail',
  ],
  'licensing-confusion': [
    'can I play spotify in my store',
    'music licensing for retail stores',
    'ASCAP BMI retail',
    'is it legal to play music in my store',
    'how much does music licensing cost retail',
  ],
  'outcome-optimization': [
    'how to increase retail dwell time',
    'how to increase average order value retail',
    'retail conversion rate optimization',
    'how to increase foot traffic retail',
    'retail customer experience improvement',
  ],
  'sensory-retail': [
    'sensory marketing retail',
    'retail store atmosphere',
    'how does music affect shopping behavior',
    'retail store design psychology',
    'in store experience design',
  ],
  // Narratives below have no dedicated SEO cluster (they get picked up
  // through other formats). Empty arrays so the worker can iterate the full
  // record without special-casing.
  'floor-job': [],
  'invisible-channel': [],
  'data-company': [],
  'add-to-pile': [],
  'kari-lift': [],
  'two-channels': [],
  'origin-story': [],
}

// ---- Trigger monitor (Google web search) --------------------------------

export function triggerQueries(now: Date = new Date()): string[] {
  const month = now.toLocaleString('en-US', { month: 'long' })
  const year = now.getFullYear()
  return [
    `"new store" OR "grand opening" Denver retail ${month} ${year}`,
    `"now open" boutique OR clothing OR home Denver`,
    `site:businessden.com new store`,
    `site:denverite.com retail opening`,
    `"Mood Media" OR "Soundtrack Your Brand" review OR complaint OR switched`,
    `podcast "in-store experience" OR "retail music" new episode ${month}`,
  ]
}

export const TRIGGER_CATEGORIES = [
  'new_store',
  'renovation',
  'podcast_episode',
  'competitor_mention',
  'press',
  'event',
] as const
export type TriggerCategory = (typeof TRIGGER_CATEGORIES)[number]

// ---- Nurture drip --------------------------------------------------------
//
// Days-since-signup → template name. Sent if the row hasn't been sent
// already (checked via LifecycleEmailLog). Template bodies live in
// EmailTemplate (DB-editable, falls back to TS registry).

export interface DripStep {
  day: number
  template: string
}

export const NURTURE_DRIP: DripStep[] = [
  { day: 0, template: 'free_welcome' },
  { day: 2, template: 'free_drip_invisible_channel' },
  { day: 4, template: 'free_drip_proof' },
  { day: 7, template: 'free_drip_whats_missing' },
  { day: 10, template: 'free_drip_case_study' },
  { day: 12, template: 'free_drip_trial_offer' },
  { day: 14, template: 'free_drip_last_nudge' },
]

// ---- Monthly targets (scoreboard) ---------------------------------------

export const MONTHLY_TARGET = {
  freeSignups: 100, // ~3.3/day
  paidUsers: 10, // 10 paid/month is the headline goal
}

// ---- Outreach pitch angles ----------------------------------------------

export const PITCH_ANGLES = ['A', 'B', 'C'] as const
export type PitchAngle = (typeof PITCH_ANGLES)[number]

export const OUTREACH_TARGET_TYPES = [
  'podcast',
  'listicle',
  'blogger',
  'consultant',
  'association',
  'partner',
] as const
export type OutreachTargetType = (typeof OUTREACH_TARGET_TYPES)[number]
