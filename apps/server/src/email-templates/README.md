# `apps/server/src/email-templates/` — template index

One file per template. Bodies are pure functions: `(data) => { subject, html, text }`. Layout chrome lives in [`_layout.ts`](_layout.ts).

## Where templates are fired from

| Template file | Fired by | Trigger |
|---|---|---|
| `magicLink.ts` | `routes/login.ts` | User requests magic-link login |
| `operatorPasswordReset.ts` | `routes/auth.ts` | Operator password reset (admin/player) |
| `welcomeFree.ts` | `routes/billing.ts` (Stripe webhook) | Account created on free tier |
| `welcomeCore.ts` | `routes/billing.ts` (Stripe webhook) | Account upgraded to Boost (`core`) |
| `welcomePro.ts` | `routes/billing.ts` (Stripe webhook) | Account upgraded to Pro |
| `adminSignupNotification.ts` | `routes/billing.ts` | Operator-facing — new signup notification |
| `catalogueReady.ts` | `lib/lifecycleEmails.ts` (cron) | Pool reaches "ready" threshold |
| `icpUnfilled.ts` | `lib/lifecycleEmails.ts` (cron) | Account created but ICP not filled out |
| `pauseEnding.ts` | `lib/pauseAutoResume.ts` (cron) | Paused subscription nearing auto-resume |
| `compEnding.ts`, `compEnded.ts` | `lib/compExpiry.ts` (cron) | Complimentary access lifecycle |
| `boostTrialStreamReady.ts` | `lib/lifecycleEmails.ts` (cron) | Boost trial pool ready to stream |
| `boostTrialEngagement.ts` | `lib/lifecycleEmails.ts` (cron) | Boost trial mid-window nudge |
| `boostTrialEnding.ts`, `boostTrialExpired.ts` | `lib/boostTrialClock.ts` (cron) | Trial clock |
| `freeToCoreNudge.ts`, `engagedFreeToCore.ts` | `lib/lifecycleEmails.ts` (cron) | Free → Boost upsell drips |
| `scalingCoreToPro.ts`, `establishedCoreToPro.ts` | `lib/lifecycleEmails.ts` (cron) | Boost → Pro upsell drips |
| `postConversionBenchmark.ts` | `lib/lifecycleEmails.ts` (cron) | Post-conversion follow-up |
| `dunning1.ts`, `dunning2.ts`, `dunning3.ts` | `routes/billing.ts` (Stripe webhook) | Failed-payment dunning sequence |
| `indemnificationCert.ts` | `routes/me.ts` | On-demand from dashboard |
| `seeds.ts` | `lib/email.ts` `seedEmailTemplates` | Initial DB seed of editable templates |

## Conventions

- **Templates are DB-editable.** The `EmailTemplate` table holds the canonical subject/body strings; these `.ts` files seed defaults and provide the variable-interpolation function. Operator edits in Dash override the seed body for that account/template.
- **Use "Entuned Free" / "Boost" / "Pro"** in copy. Never "Essentials" or "Core" (DB values are unchanged — `free`, `core`, `pro` — but display strings are different; see `../CLAUDE.md`).
- **One trigger per template.** If a new lifecycle moment needs an email, add a new template — don't reuse an existing one with a flag.
- **Idempotency:** `lib/lifecycleEmails.ts` uses `(accountId, templateName, contextKey)` upserts to prevent re-sends. New cron-fired templates must follow this pattern.
