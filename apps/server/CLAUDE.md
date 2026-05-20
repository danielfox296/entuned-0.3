# CLAUDE.md — entuned-0.3 server

Fastify + Prisma API. Deploys to Railway → `api.entuned.co`. Talks to: player (`music.entuned.co`), admin (`dash.entuned.co`), customer dashboard (`app.entuned.co`).

## Read first

- `../../CLAUDE.md` — monorepo rules (deploy, tests, schema mirror, verification auth)
- `../../TESTING.md` — required reading before writing any server code
- `../../NAMES.md` — legacy → canonical name map (grep here before assuming a name is current)
- `./src/lib/README.md` — subsystem index for `lib/` (Eno, Mars, Bernie, Hendrix, etc.)
- `./src/email-templates/README.md` — template index + which lib file fires each one

## Layout

| Dir | What |
|---|---|
| `src/index.ts` | Plugin registration + cron registration. Single source of truth for which route modules are mounted under which prefix. |
| `src/routes/` | Fastify route modules. One file per surface; see "Route map" below. |
| `src/lib/` | Domain logic — generation pipeline, lifecycle, scheduling, tier, auth. Most non-trivial work happens here. See `lib/README.md`. |
| `src/email-templates/` | Plain-text/HTML email body builders. One file per template. |
| `src/test-utils/` | Shared test helpers — DB resets, fixture builders. |
| `prisma/schema.prisma` | Mirror of `../../../entune v0.3/schema/` SSOT. Header points to it. |
| `scripts/` | One-off ops scripts (seeding, audits). Not deployed. |

## Route map

All registered in [`src/index.ts`](src/index.ts).

| Prefix | File | Auth | Consumer |
|---|---|---|---|
| `/health` | `routes/health.ts` | none | Railway healthcheck |
| `/hendrix` | `routes/hendrix.ts` | Bearer | player |
| `/stores` | `routes/stores.ts` | Bearer | player, admin |
| `/events` | `routes/events.ts` | Bearer | player |
| `/auth` | `routes/auth.ts` | mixed | admin, player (operator login) |
| `/login` | `routes/login.ts` | none | dashboard (magic link, Google OAuth) |
| `/admin` | `routes/admin.ts` + `admin-retention.ts` + `admin-reliability.ts` | Bearer | admin |
| (no prefix — see file) | `routes/billing.ts` | cookie | dashboard (Stripe webhooks too) |
| `/me` | `routes/me.ts` | cookie | dashboard |
| `/email` | `routes/email.ts` | mixed | dashboard (unsubscribe), webhooks |
| `/push` | `routes/push.ts` | Bearer | player (web push) |
| `/dev-login` | `routes/dev-login.ts` | token | local verification only — disabled in prod when `DEV_LOGIN_TOKEN` unset |

## Crons (registered in `src/index.ts`)

- **Daily 9am America/Denver:** `runPauseAutoResume` + `runBoostTrialClockActivation` + `runLifecycleEmails` + `runCompExpiryCron`
- **Every 5 min:** `runPlaybackHeartbeat`

## Load-bearing rules

These are rules that have bitten in the past and are not enforceable by types or tests. Read before changing anything in the relevant area.

### Generation pipeline (`lib/eno`, `lib/mars`, `lib/bernie`, `lib/decomposer`, `lib/hooks`)

- **`applyOutcomeFactorPrompt` wraps every Mars style builder's output.** Tempo, mode, mood live on the prepend — never inline them in a Mars style builder, never skip the wrap. This is the most load-bearing rule in the pipeline. See `lib/eno/README.md`.
- **Suno reads genre tags as the dominant signal** and ignores ~90% of technical vocab. Steering is "anchor and carve": pick a genre anchor, use negative-style axes to carve sub-centroids. Don't pile on adjectives expecting them to land.
- **Lyric repetition is phrase-level rut from thin factor prompts, not ban-list failure.** Before adding a banned-phrase rule, check `../../HANDOFF-lyric-repetition.md` — the fix usually lives upstream in the factor prompt, not in a post-hoc filter.
- **`run-pipeline` works on app-created ICPs.** Empty `ReferenceTrack` / `Hook` / voice-note rows on an app-created ICP are **not** a gap — `run-pipeline` is the automation that fills them. Don't gate on their presence or treat them as "admin-only" prerequisites.

### LLM suggestion prompts (anywhere we call an LLM for "off-axis" picks)

- **Adjacency prompts collapse to the centroid by default.** Asking for "different but related" picks produces safe near-duplicates of the existing pool. Counter with: explicit vector-spread instructions, anti-cluster rules, and "stranger trust" framing. Don't ship a new suggester without these.

### Tier system (`lib/tier.ts`, `lib/freeTier.ts`)

- **DB values are unchanged: `free`, `core`, `pro`.** API params and Prisma enum stay `tier=core`.
- **Display names are different:** `free` → "Entuned Free", `core` → "Boost", `pro` → "Pro". Don't reintroduce "Essentials" or "Core" in any user-facing string (UI, emails, error messages, log lines that surface to operators).
- See `marketing/ICP/` and the tier-rename memory entries if you need more context.

### Naming hygiene in copy

- **No "zones".** Not a product concept. Don't reference it anywhere user-facing.
- **No "day-parting"** except in the single allowed phrase: "like day-parting, but better". Otherwise use **"Outcome Scheduling"**.

### Don't fork code paths for new siblings

When adding a new option/category/bucket sibling to existing ones (a new outcome category, a new suggestion bucket, a new tier behavior), **extend the existing pathway**. Don't build a parallel suggester/route/prompt just because the new option needs more elaborate logic. One button, one call, one consistent UX.

### Dashboards / metrics surfaces

- **No fake or estimated data in operator/customer dashboards.** Only show metrics derivable from real logged `PlaybackEvent` / billing / lifecycle rows. If you can't compute it honestly, drop the panel or reframe it.

## Verification

Use the `/dev-login` flow documented in `../../CLAUDE.md` ("Verification auth"). Don't stop at a login screen during `preview_*` verification.

## Deploy

`cd ../.. && railway up` from monorepo root. **Don't** pass `--path-as-root` — Railway's dashboard already has Root Directory=`apps/server`, the flag conflicts and breaks the build. Tests must pass; the Railway build runs `pnpm test`.
