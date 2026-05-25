# `apps/server/src/lib/` — subsystem index

Domain logic for the server. Most subsystems use codenames; the table below maps codename → role + main entrypoint so you can grep the right file fast.

For the load-bearing rules that apply across these subsystems (Outcome-prepend wrap, anchor-and-carve, lyric repetition, tier display rename, etc.), see `../../CLAUDE.md` → "Load-bearing rules".

## Generation pipeline (per-seed)

| Dir / file | Role | Entrypoint |
|---|---|---|
| `eno/` | Per-seed orchestrator — turns one queued `SongSeed` into a resolved Suno payload (style + lyric + arrangement + outcome-factor prepend). | `runEno` ([eno/eno.ts](eno/eno.ts)). See `eno/README.md`. |
| `mars/` | Style-prompt builder for Suno. Anchor-and-carve: genre anchor + negative-style axes. Every output is wrapped by `applyOutcomeFactorPrompt` from `eno`. | `marsAssemble` ([mars/mars.ts](mars/mars.ts)); per-portion router `routeStylePortion` ([mars/style-router.ts](mars/style-router.ts)) |
| `bernie/` | Lyric generator — draft + edit passes. Draft is genre-aware via the `genreBrief` Eno builds from the reference track. | `generateLyrics` ([bernie/bernie.ts](bernie/bernie.ts)) |
| `decomposer/` | Reference-track analysis — turns a track into a structured `StyleAnalysis`. Feeds Mars. | `decompose` ([decomposer/decomposer.ts](decomposer/decomposer.ts)) |
| `arranger/` | Injects arrangement section markers (`[verse]`, `[chorus]`, etc.) into Bernie's lyric output before Suno. | `injectArrangement` ([arranger/arranger.ts](arranger/arranger.ts)) |
| `hooks/` | Hook writer — drafts hooks for an (ICP, Outcome). Universal craft system prompt + per-outcome behavioral overlay from `OutcomeLyricFactor.templateText`. No ICP psychographics injected. Consumed by `/admin/icps/:id/hook-writer/run`. | `draftHooks` ([hooks/drafter.ts](hooks/drafter.ts)) |
| `ref-tracks/` | Reference-track ingest + dedupe. | — |

## Playback + scheduling

| File | Role |
|---|---|
| `hendrix.ts` | Outcome resolution + queue building. The `/hendrix` routes thin-wrap this. **The player's only steady-state dependency.** |
| `outcomes.ts` | Outcome catalogue + per-store selection logic. |
| `outcomeSchedule.ts` | Outcome Scheduling — time-of-day outcome rotation. **Never call this "day-parting" in user-facing copy.** |
| `scheduleSlots.ts` | Schedule-slot persistence + validation. |
| `playbackHeartbeat.ts` | 5-min cron — detects stalled players and emits health events. |

## Tier / billing / lifecycle

| File | Role |
|---|---|
| `tier.ts` | Tier resolution. DB values: `free`, `core`, `pro`. Display: "Entuned Free", "Boost", "Pro". Don't conflate the two. |
| `freeTier.ts` | Free-tier feature gates. See `../../../HANDOFF-free-tier-outcome-leakage.md` for the known leakage class. |
| `boostTrialClock.ts` | Boost trial clock activation (daily cron). |
| `compExpiry.ts` | Complimentary access expiry (daily cron). |
| `pauseAutoResume.ts` | Auto-resume pause cron — fires `pauseEnding` template. |
| `lifecycleEmails.ts` | Time- and behavior-triggered email dispatch (daily cron). See `../email-templates/README.md` for the trigger → template map. |
| `email.ts` | Template seeding + send wrapper. Templates live in `../email-templates/`. |

## Infra / cross-cutting

| File | Role |
|---|---|
| `auth.ts` | JWT verification + Bearer/cookie helpers. |
| `session.ts` | Fastify cookie-session plugin (dashboard). |
| `account.ts` | Account resolution + multi-store helpers. |
| `push.ts` | Web push (player). |
| `r2.ts` | Cloudflare R2 upload + signed URL. |
| `variance/` | Reliability telemetry. See `../../../HANDOFF-dash-reliability-telemetry.md`. |
| `retailnext/` | RetailNext POS ingest. Inbound traffic data. |

## Conventions

- Every `.ts` here has a colocated `.test.ts` (or should — see `../../../TESTING.md`).
- New subsystems get a `<name>/README.md` if they're more than two files. Match the style of `eno/README.md`.
