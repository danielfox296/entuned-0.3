# Tier-Bug Drill-Down

Follow-up to `ASSESSMENT.md` section 2 #6 ("Tier type drifted across three
files"). Read-only investigation. No code modified. Every claim is grounded
in a direct read of the cited file:line. Verified on 2026-05-17.

---

## 1. Tier value canonical sources

| File:line | Declared values | Notes |
|---|---|---|
| `apps/server/src/lib/tier.ts:8` | `'free' \| 'core' \| 'pro' \| 'enterprise' \| 'mvp_pilot'` | **Canonical server union**. Used by `effectiveTier`, `applyTierChange`, `tierRank`. `RANK` map (`tier.ts:12-18`) explicitly enumerates all 5. |
| `apps/server/src/lib/email.ts:27` | `'free' \| 'core' \| 'pro'` | Narrowed alias used only by `sendWelcome` (`email.ts:268-279`). |
| `apps/dashboard/src/api.ts:45` | `'free' \| 'core' \| 'pro' \| 'enterprise'` | Customer-app union. `TIER_RANK`, `TIER_LABEL`, `TIER_PRICE` (lines 184-203) all enumerate exactly these 4 — **no `mvp_pilot` mapping**. |
| `apps/admin/src/api.ts:355,407` | `'free' \| 'core' \| 'pro' \| 'enterprise' \| 'mvp_pilot'` | Admin DTO union — matches server. Same 5 values appear inline at `StoreEditor.tsx:22`. `api.ts:877` and `api.ts:920` widen back to `string`. |
| `apps/admin/src/panels/brand/TierPanel.tsx:19-25` | `'free' \| 'mvp_pilot' \| 'core' \| 'pro' \| 'enterprise'` (local `TIER_LABEL` map) | Admin operator label map — covers all 5. |
| `apps/player/src/screens/PlayerScreen.tsx:46-51` | `'free' \| 'core' \| 'pro' \| 'enterprise'` (local `TIER_LABEL`/`TIER_COLOR`) | **No `mvp_pilot` mapping.** Fall-through uses `tier` raw string as label (`PlayerScreen.tsx:59`). |
| `apps/server/prisma/schema.prisma:159` | `String @default("mvp_pilot")` with inline comment listing the same 5 strings | DB stores `tier` as a free-form string. **Default value is `mvp_pilot`** for any row that doesn't override at insert time. Schema does not constrain values. |
| `apps/server/prisma/schema.prisma:40,113` | `ClientPlan` enum on `Client.plan`: includes `mvp_pilot` (`schema.prisma:40`). | Separate field on `Client`, not `Store.tier`. Confusing naming — `Client.plan` is the legacy enum; `Store.tier` is the live billing-driver. |

Confidence: HIGH. The server lib defines 5 tiers; the DB default is 1 of those; the email lib narrows to 3; the dashboard frontend uses 4. The drift is real.

---

## 2. Where tiers get assigned

Every write to `Store.tier` or `Store.compTier` found in `apps/server/src/`:

| File:line | Field | Value(s) writeable | Trigger |
|---|---|---|---|
| `apps/server/src/lib/account.ts:73` | `tier` | literal `'free'` | First sign-in: auto-provisions a free Store for a new Account (`ensureFreeClientForUser`). |
| `apps/server/src/routes/me.ts:171` | `tier` | literal `'free'` | Self-heal: pre-2026-05-04 session with zero stores → provisions a free Store inline on `GET /me/stores` (`me.ts:148`). |
| `apps/server/src/routes/me.ts:729` | `compTier` | literal `'core'` | Boost trial (`POST /me/boost-trial`) — sets a 14-day Core comp. |
| `apps/server/src/routes/billing.ts:655` | `tier` | literal `'free'` | Pause flow: `POST /billing/pause` rewrites paid Store to `tier:'free'` while `pausedUntil` is set; comp is cleared in same write (`billing.ts:656`). |
| `apps/server/src/routes/billing.ts:705` | `tier` | `'core'` or `'pro'` (computed) | `POST /billing/resume`: `restoredTier` from `STRIPE_PRICE_ID_PRO/CORE` map (`billing.ts:695-696`). |
| `apps/server/src/routes/billing.ts:768` | `tier` | literal `'free'` (selector only — same orphan-finding query) | Read path; not a write. |
| `apps/server/src/routes/billing.ts:788-808` | `tier`, `compTier` | `tier` ← Zod-narrowed `'core' \| 'pro'` from checkout `metadata`; `compTier` ← `null` when auto-clearing | Stripe `checkout.session.completed` webhook on existing orphan free store. `tier` source: `session.metadata.tier ?? 'core'` (`billing.ts:724`). Source values were set by `POST /billing/checkout` (`billing.ts:111` Zod schema = `z.enum(['core','pro'])`), `GET /billing/checkout` (`billing.ts:190` same check), `GET /billing/upgrade-from-comp` (`billing.ts:431-434` casts to `'core'\|'pro'`, explicitly rejects enterprise), or `GET /billing/upgrade` (`billing.ts:540`). |
| `apps/server/src/routes/billing.ts:819` | `tier` | `'core' \| 'pro'` (from metadata, default `'core'`) | Stripe webhook on fresh Store creation (no orphan). |
| `apps/server/src/routes/billing.ts:953` | `tier` | `'core' \| 'pro'` (`tierFromPriceId` only returns one of these — `billing.ts:906-911`) | `customer.subscription.updated` reconciliation via `syncStoreTierFromSubscription`. Plan-swap in Customer Portal. |
| `apps/server/src/lib/pauseAutoResume.ts:65,97` | `tier` | `'core' \| 'pro'` (from price-id map) | Daily 9am cron — auto-resume after pause window expires. |
| `apps/server/src/lib/boostTrialClock.ts:39` | `compTier` | literal `'core'` | Daily cron — activates Boost-trial Core comp when first generation lands. |
| `apps/server/src/lib/lifecycleEmails.ts:534,601` | `compTier` | literal `'core'` | Selector inside drip queries — finds stores comped to Core. (Not a write — these are `where` clauses; `lifecycleEmails.ts:534` `compTier: 'core'`, `compTier: 'core'` at line 601, both inside `prisma.store.findMany({ where: { compTier: 'core', ... } })`.) |
| `apps/server/src/lib/compExpiry.ts:197` | `compTier` | `null` | Cron — clears comp when `compExpiresAt` <= now. |
| `apps/server/src/routes/admin.ts:4349-4358` | `compTier` | Zod-narrowed `'core' \| 'pro'` (`admin.ts:4318`) | `POST /admin/stores/:id/comp` — explicit operator grant. Body schema rejects everything else. |
| `apps/server/src/routes/admin.ts:4400-4408` | `compTier` | `null` | `DELETE /admin/stores/:id/comp` — operator revoke. |
| `apps/server/prisma/schema.prisma:159` | `tier` | default `'mvp_pilot'` when omitted at `INSERT` time | Any `prisma.store.create` that doesn't pass `tier` — currently none in app code do; seed scripts could. |

**Is `'enterprise'` ever assigned by code?** **No.** Every assignment site
above writes one of `'free'`, `'core'`, `'pro'`, or `null`. The two paths
that *could* in principle write `'enterprise'` both reject it explicitly:

- `POST /admin/stores/:id/comp` (`admin.ts:4318`) — Zod enum is
  `['core','pro']`. Inline comment at `admin.ts:4308-4310` documents the
  exclusion ("Enterprise is excluded — there's no self-serve Stripe price
  for it…").
- `GET /billing/upgrade-from-comp` (`billing.ts:431-434`) — defensive
  rejection branch if a legacy enterprise comp exists in the DB.

The only way a Store can have `tier='enterprise'` today is:

1. A direct SQL UPDATE in Railway Postgres (operator manual override), or
2. A legacy row from before 2026-05-04 (pre-monorepo) that was migrated in.

The schema constraint is `String` (`schema.prisma:159`) — no CHECK
constraint, no enum at the DB layer. So the value is *representable* but
not *reachable through application code*.

Confidence: HIGH for "no code path writes `'enterprise'`". MEDIUM for "no
production row currently has `tier='enterprise'`" (would need a DB query
to confirm; not done in this read-only pass).

---

## 3. Where tier drives behavior

### `sendWelcome` — `apps/server/src/lib/email.ts:268-279`

```
const name: TemplateName =
  tier === 'pro' ? 'welcomePro'
  : tier === 'core' ? 'welcomeCore'
  : 'welcomeFree'
```

- Handled: `'pro'` → `welcomePro`. `'core'` → `welcomeCore`.
- Falls through: everything else (`'free'`, `'enterprise'`, `'mvp_pilot'`, or any other string) → `welcomeFree`.
- TypeScript signature narrows the param to `Tier = 'free' | 'core' | 'pro'` (`email.ts:27,270`). That widens at the boundary because both callers pass values not in that union (see below) — TS catches the call from `account.ts` (passes literal `'free'`, fits), but the `billing.ts:859` call passes the runtime-only `tier` value from Stripe metadata which is statically typed as `Tier` from `lib/tier.ts` (5 values). The compile would normally fail; the `(session.metadata?.tier as Tier | undefined) ?? 'core'` cast at `billing.ts:724` uses the 5-value `Tier` from `lib/tier.ts` (imported at `billing.ts:18`), and that 5-value type is structurally assignable to the 3-value `Tier` at the `sendWelcome` call site only because TS does not narrow between same-named imported types from different modules. End result: `sendWelcome` is reachable with `'enterprise'`/`'mvp_pilot'` and would fall through to `welcomeFree`.

**Actual production callers** (`sendWelcome`):

- `apps/server/src/lib/account.ts:91` — passes literal `'free'`. Hits the `welcomeFree` branch deliberately.
- `apps/server/src/routes/billing.ts:859` — passes `tier` derived from `session.metadata?.tier ?? 'core'` (`billing.ts:724`). The metadata is *only* set by paths that constrain to `'core'|'pro'` (see §2). So in practice this call receives only `'core'` or `'pro'`.

**Verdict on the "silently routes enterprise to welcomeFree" claim**: the
fall-through is real in source (`email.ts:277`) and reachable through the
type system, but **no production code path currently invokes
`sendWelcome` with `'enterprise'`** (or `'mvp_pilot'`). The bug is latent.

### `slotsForTier` — `apps/player/src/components/UpgradeRail.tsx:194-205`

Handled: `'free'`, `'core'`, `'pro'`. `default:` returns `[]` — no
upgrade rail shown. Documented at `PlayerScreen.tsx:175-176`
("Enterprise has nothing to upsell to and skips the surface"). For
`'mvp_pilot'`, the fall-through is the same → no rail. The store ranks
equal to Core (per `tier.ts:14-15` `RANK.mvp_pilot = 1`) but gets no
upsell rail. Possibly desirable (legacy seed stores shouldn't be
upsold), possibly not (they're effectively Core users who would
benefit from Pro upsell). Documented intent is unclear.

### `showPromo` — `apps/player/src/screens/PlayerScreen.tsx:177`

`session.tier === "free" || session.tier === "core" || session.tier === "pro"`.
`'enterprise'` and `'mvp_pilot'` both fall to `false`, so the promo
panel is hidden. For enterprise this is documented intent
(`PlayerScreen.tsx:175-176`). For `mvp_pilot` it's an accident — but
`session.tier` here is the **effective tier** from
`/auth/me`/`/login/me`, both of which call `effectiveTier(s)` (`auth.ts:90`,
`me.ts:197`); `effectiveTier` returns `'mvp_pilot'` only when both paid
and comp are `'mvp_pilot'` (rare; seed stores typically have no comp,
so paid `'mvp_pilot'` returns as-is — see `tier.ts:42-48`).

### `useTier` / `TIER_RANK` — `apps/dashboard/src/api.ts:184`

```
export const TIER_RANK: Record<Tier, number> = {
  free: 0, core: 1, pro: 2, enterprise: 3,
}
```

No `mvp_pilot`. `TIER_RANK[s.tier]` where `s.tier === 'mvp_pilot'` →
`undefined`. Consumers:

- `Locations.tsx:15-16`: `TIER_RANK[tier] >= TIER_RANK.core` →
  `undefined >= 1` → **`false`**. A `mvp_pilot` store gets
  `canAdd=false`, `canPause=false` — i.e. treated as free.
- `Account.tsx:40`: `isPaid = TIER_RANK[tier] >= TIER_RANK.core` →
  `false` for `'mvp_pilot'`. Treated as free.
- `SetupChecklist.tsx:26`: same pattern.
- `Upgrade.tsx:23`: same pattern.
- `Layout.tsx:38`: `TIER_RANK[currentTier] >= TIER_RANK[requires]` →
  `false` for `'mvp_pilot'`. Locks all paid surfaces.
- `api.ts:208,216` (`highestTier`, `primaryStore`):
  `TIER_RANK[s.tier] > TIER_RANK[best]` → `undefined > 0` is **`false`**.
  Pre-seeded with `'free'`, so a sole `mvp_pilot` store gets reported
  as the primary but `highestTier` returns `'free'`. Minor inconsistency.

For the dashboard, the unhandled `'mvp_pilot'` tier silently downgrades
to free-tier behavior across the entire customer surface.

### `TIER_LABEL` — `apps/dashboard/src/api.ts:191`

Lookups in `Account.tsx:174,177,281`, `LockScreen.tsx:40,41,173`,
`Layout.tsx:152,204,284` use `TIER_LABEL[s.tier] ?? s.tier` in some
places (`Account.tsx:174`) and bare `TIER_LABEL[tier]` in others
(`Account.tsx:281`, `Layout.tsx:152` — `.replace('Entuned ', '')` on
`undefined` would throw). For a `'mvp_pilot'` tier these bare lookups
return `undefined`, then `.replace` on `undefined` → **runtime
TypeError**.

- `Layout.tsx:152` — `TIER_LABEL[tier].replace('Entuned ', '')`. If
  `tier='mvp_pilot'`, this throws.
- `Layout.tsx:204` — same pattern.

### Tier checks on the server with explicit fallback

| File:line | Handled set | Unhandled fall-through behavior |
|---|---|---|
| `lib/outcomes.ts:62` | `if (tier === 'free')` | Non-free: skips the free-tier allowlist gate; default-outcome picker continues with any version. Intentional. |
| `lib/outcomeSchedule.ts:58` | `const isFree = store.tier === 'free'` | Non-free is the affirmative case. Intentional. |
| `lib/hendrix.ts:301` | `effectiveTier(store, now) === 'free' ? FREE_TIER_AD_STORE_ID : store.id` | Non-free uses the store's own id. Intentional. |
| `lib/lifecycleEmails.ts:411-413, 485-487` | `eff === 'pro' \|\| eff === 'enterprise'` → skip drip | `'mvp_pilot'` is NOT in this set. **`mvp_pilot` stores would receive Core→Pro drips even though they're functionally Core-equivalent** per the `RANK` table. |
| `routes/admin.ts:699` | `if (target?.tier === 'free') { ... }` | Branch is the include-free-pool gate; non-free skips. Intentional. |
| `routes/admin.ts:2497, 2580, 2630` | `if (target?.tier === 'free' && ...)` | Non-free skips free-tier outcome allowlist. Intentional. |
| `email-templates/compEnding.ts:36` | `paidTier === 'free' \|\| paidTier === 'mvp_pilot'` → "drops back to Entuned Free" copy | Handles mvp_pilot correctly. |
| `email-templates/compEnded.ts:26` | same | Handles mvp_pilot correctly. |

---

## 4. Other mis-routings (silent fallbacks on tier)

| File:line | Function | Fallback values | Behavior |
|---|---|---|---|
| `apps/server/src/lib/email.ts:274-277` | `sendWelcome` | `'enterprise'`, `'mvp_pilot'`, any other string → `'welcomeFree'` | Silent route to free welcome. |
| `apps/server/src/lib/lifecycleEmails.ts:411-413, 485-487` | `scalingCoreToPro` / `establishedCoreToPro` drips | `'free'`, `'core'`, `'mvp_pilot'` all pass the "not-Pro/Enterprise" filter | `mvp_pilot` stores are pitched the Core→Pro upgrade despite being legacy seed stores. |
| `apps/player/src/components/UpgradeRail.tsx:194-205` | `slotsForTier` | `'enterprise'`, `'mvp_pilot'`, any other → `[]` | No upgrade rail shown for mvp_pilot. |
| `apps/dashboard/src/api.ts:208` | `highestTier` | `'mvp_pilot'` → `TIER_RANK[s.tier]` is `undefined`; comparison `undefined > 0` is false; mvp_pilot store is treated as ≤ free | Customer surface reports lower-than-actual tier. |
| `apps/dashboard/src/api.ts:216` | `primaryStore` | same | Same — primary-store pick can downgrade mvp_pilot. |
| `apps/dashboard/src/ui/Layout.tsx:152, 204` | label render | `TIER_LABEL[mvp_pilot]` is `undefined`; `.replace` on undefined → runtime `TypeError` | Would crash the layout if a mvp_pilot tier reaches the customer dashboard. |

---

## 5. Frontend tier handling

### `apps/dashboard/` (customer-facing, app.entuned.co)

- `TIER_RANK` and `TIER_LABEL` enumerate `'free' \| 'core' \| 'pro' \| 'enterprise'` only (`api.ts:184-203`). `mvp_pilot` is **unrecognized**.
- Unrecognized → `TIER_RANK[…]` is `undefined`. Gate checks `>= TIER_RANK.core` evaluate to **false**, so the store is treated as free.
- Unrecognized → `TIER_LABEL[…]` is `undefined`. Some call sites use `?? s.tier` fallback (`Account.tsx:174`), others assume defined (`Layout.tsx:152`, `Layout.tsx:204`) — those would throw a `TypeError` on `.replace`.
- Net: a `mvp_pilot` store reaching this surface either silently behaves as free (gating) or crashes the layout (label render). The dashboard is the *only* surface that crashes on an unknown tier value.

### `apps/admin/` (operator, dash.entuned.co)

- Inline tier unions include all 5 values (`api.ts:355,407`, `StoreEditor.tsx:22`).
- `TierPanel.tsx:19-25` `TIER_LABEL` has all 5 values explicitly.
- Tier checks (`StoreEditor.tsx:184` etc) test `tier === 'free'`. Non-free falls through correctly.
- No crash path identified.

### `apps/player/` (in-store)

- `TIER_LABEL`/`TIER_COLOR` lookup uses `?? s.tier`/`?? TIER_COLOR.free` fallback (`PlayerScreen.tsx:59-60`). Safe.
- `slotsForTier` (`UpgradeRail.tsx:194`) returns `[]` for unknown tiers — degrades to "no upgrade rail" gracefully.
- `showPromo` (`PlayerScreen.tsx:177`) is a positive enumeration of `'free' | 'core' | 'pro'`. Unknown tiers skip the promo panel. Documented for enterprise.

---

## 6. Production reality check

**Is `'enterprise'` a real assignable state in current production?**

Evidence from code:

- No code path writes `'enterprise'` to `Store.tier` or `Store.compTier` (§2).
- No Stripe price id maps to `'enterprise'` (`billing.ts:906-911` `tierFromPriceId` returns only `'core'|'pro'|null`).
- Admin comp-grant API rejects `'enterprise'` (`admin.ts:4318`, comment `admin.ts:4308-4310`).
- Customer checkout rejects everything except `'core'|'pro'` (`billing.ts:111,190`).
- The dashboard surfaces an "Enterprise" label and price ("Custom" — `api.ts:202`) in `TIER_LABEL`/`TIER_PRICE`, but no flow leads there.
- Player has an "Enterprise" color and label (`PlayerScreen.tsx:55-56`), but no upgrade flow ends at it.
- Lifecycle email skip filter treats Pro and Enterprise as equivalent stop-state (`lifecycleEmails.ts:411-413, 485-487`).

Memory-confirmed: bootstrapper GTM, no enterprise sales motion
(`project_bootstrapper_gtm.md`).

**Conclusion**: `'enterprise'` is a **vestigial enum value** in current
production. It appears in:
- The type union (`tier.ts:8`) — so `effectiveTier` *could* return it.
- The audit-log readers and label renders (admin, player) — so a row
  manually set to enterprise via SQL would render correctly there.
- The lifecycle-drip skip filter — so a manual enterprise grant would
  correctly stop nudge emails.

But no code creates one, no UI offers one, no Stripe price maps to one.

Confidence: HIGH that `'enterprise'` is currently vestigial.

---

## 7. Bug verdict

### `sendWelcome` falls through to `welcomeFree` for `'enterprise'`/`'mvp_pilot'`
`apps/server/src/lib/email.ts:274-277`.

- **LATENT BUG.** No production call site of `sendWelcome` passes a tier outside `{'free','core','pro'}` today.
  - `account.ts:91` passes literal `'free'`.
  - `billing.ts:859` passes the Stripe-metadata-derived `tier`, which originates only from `'core'|'pro'`-constrained writes (`billing.ts:111,190,431-434,540`).
- Cannot fire unless either (a) a future code path passes an `enterprise`/`mvp_pilot` value to `sendWelcome`, or (b) a future Stripe checkout writes a non-`'core'|'pro'` value into `session.metadata.tier`.
- Note: the `enterprise` rejection at `billing.ts:431-434` is in the *redirect* path; a future enterprise-checkout flow that bypassed that guard would route through `handleCheckoutCompleted` and call `sendWelcome(..., 'enterprise', ...)`, falling through to `welcomeFree`.

### `lifecycleEmails` drips treat `mvp_pilot` as not-yet-Pro
`apps/server/src/lib/lifecycleEmails.ts:411-413, 485-487`.

- **LATENT BUG.** `mvp_pilot` stores would pass the "is this client still Core-or-below?" filter and be eligible for Core→Pro upgrade drips. The eligibility queries (`lifecycleEmails.ts:392, 456`) gate on `tier: 'core'` for the *primary qualifier* and use `effectiveTier` for the *exclusion*. Since the primary qualifier is `tier: 'core'` (literal), `mvp_pilot` stores are not even fetched.
- **Verdict downgrade**: the upstream `where: { tier: 'core' }` filter excludes `mvp_pilot` rows from the queries entirely. So the exclusion-filter gap doesn't fire. Confirmed by reading `lifecycleEmails.ts:459` (`tier: 'core'` selector). NOT A BUG in practice.

### Dashboard `TIER_RANK[mvp_pilot]` is `undefined` → gates fail closed
`apps/dashboard/src/api.ts:184`, consumed at `Locations.tsx:15-16`, `Account.tsx:40`, `SetupChecklist.tsx:26`, `Upgrade.tsx:23`, `Layout.tsx:38`, `api.ts:208,216`.

- **LATENT BUG with one LIVE BUG path.** Whether this fires depends on whether any `mvp_pilot` Store can reach the customer dashboard:
  - `mvp_pilot` is the schema default (`schema.prisma:159`). Any `INSERT` that omits `tier` writes it.
  - No application code creates a Store without setting `tier` explicitly (every `prisma.store.create` reviewed in §2 supplies `tier:'free'` or a Zod-narrowed `'core'|'pro'`).
  - But: `apps/server/prisma/seed.ts` creates Outcomes/Clients but not Stores in the section I read. The legacy Untuckit seed pre-dates the unified schema and may have produced Store rows at the DB default — see migration `20260504165924_unify_client_account_store_location/migration.sql:22` which adds `tier text NOT NULL DEFAULT 'mvp_pilot'` to the Store table on the consolidation date.
  - Memory note `project_untuckit_pilot.md` confirms a real Untuckit pilot store exists in production. That store's `tier` value is unverified in this read-only pass — if it is `'mvp_pilot'`, and if any Account on that Client logs into the customer dashboard, the layout-render path crashes (`Layout.tsx:152`).
- LIVE BUG candidate is `Layout.tsx:152` and `Layout.tsx:204`: `TIER_LABEL[tier].replace('Entuned ', '')` — runtime `TypeError` if `tier` not in the 4-value map. Whether this is reachable today depends on whether any Account logged into the dashboard has a Store with `tier='mvp_pilot'`. Memory notes (`project_untuckit_pilot.md`: "low-volume technical system test") suggest the Untuckit operator does not use app.entuned.co — but this is the highest-risk uncertainty.

### Vestigial `'enterprise'` in `Tier` union
`apps/server/src/lib/tier.ts:8`.

- **NOT A BUG**, but a maintenance hazard. Keeping it as a string-literal union with no live code path means future readers may wire enterprise-specific logic that never fires. The lifecycle skip filter (`lifecycleEmails.ts:412,486`) is a precedent — code path that exists "just in case".

---

## 8. Minimum-blast-radius fix sketch

(For each LIVE/LATENT bug, the smallest safe shape. No code below.)

1. **`sendWelcome` enterprise/mvp_pilot fall-through (latent).**
   Two options, both small:
   (a) Widen the `Tier` alias at `email.ts:27` to the full 5-value union and add explicit `case 'enterprise'`/`case 'mvp_pilot'` arms with Daniel's chosen template (`welcomePro` is the likely candidate for both — enterprise is functionally pro-or-better; mvp_pilot is ranked equal to core).
   (b) Re-import `Tier` from `lib/tier.ts` and add an exhaustive `switch` so the TS compiler refuses to compile if a new tier is added without updating this function.
   Daniel picks (a) vs (b).

2. **Dashboard `mvp_pilot` not in `TIER_RANK`/`TIER_LABEL` (latent LayoutCrash risk).**
   Add `mvp_pilot` entries to `TIER_RANK` (`api.ts:184`), `TIER_LABEL` (`api.ts:191`), `TIER_PRICE` (`api.ts:198`) so the customer dashboard renders. Pick the right rank: server treats `mvp_pilot` as rank-1 (Core-equivalent) per `tier.ts:13-15` — mirror that so a `mvp_pilot` store gets Core-tier feature gating.
   Alternative (safer for the customer surface): server-side normalization at the API boundary — when `effectiveTier` returns `'mvp_pilot'` and the response is destined for a customer surface, return `'core'` instead. Adds one helper at the lib boundary. Avoids leaking the legacy enum out of the server. Smaller blast radius.

3. **Vestigial `'enterprise'`.**
   Not urgent. If the GTM constraint "no enterprise sales motion" is stable, removing `'enterprise'` from `tier.ts:8` `Tier` union forces the compiler to delete the dead handler arms in `lifecycleEmails.ts`, `PlayerScreen.tsx:46-51,55-56,177`, dashboard `api.ts:45,184-203`. Daniel's call. This is hygiene, not a fix.

---

## 9. Open questions for Daniel

1. **Are there any production rows with `Store.tier='enterprise'` today?** A single SELECT against Railway Postgres would confirm. If zero, `'enterprise'` is fully vestigial and can be removed at any time. If non-zero, those rows are silently routing through code that never wrote that value.
2. **Is the Untuckit pilot store on `tier='mvp_pilot'` or has it been migrated?** Memory says low-volume tech test (`project_untuckit_pilot.md`); schema default is `mvp_pilot`; no app code writes that value. If the row still has the default and any Account from that Client ever opens app.entuned.co, the dashboard `Layout.tsx:152` `TIER_LABEL[tier].replace(...)` crashes. (Verifiable with one Postgres query + one membership check.)
3. **Should `sendWelcome` route `enterprise` to `welcomePro` or to a new `welcomeEnterprise` template?** Note that no `welcomeEnterprise` template exists today (verified by grepping `email-templates/` — only `welcomeFree`, `welcomeCore`, `welcomePro` are present alongside the layout and shared blocks).
4. **Is `'mvp_pilot'` worth keeping in the runtime type union, or should it be migrated to `'core'` at the DB level and removed from the code?** A one-line `UPDATE stores SET tier='core' WHERE tier='mvp_pilot'` would let every code-side reference to `mvp_pilot` be deleted. Memory `tier.ts:10` says it's "a legacy seed-tier; ranked equal to `core`" — sounds like nobody is defending the distinction.
5. **Customer dashboard layout: bare `TIER_LABEL[tier].replace('Entuned ', '')` at `Layout.tsx:152,204` — is the crash-on-unknown-tier behavior intentional (loud failure) or should it `?? tier` like `Account.tsx:174` does?**

---

## Constraints honored

- Every claim cites file:line on both sides where applicable.
- Confidence tiers stated where the claim is grep-based or one-sided.
- LIVE vs LATENT differentiated: no LIVE bug is identified in this pass — every silent fallback is currently unreachable through application code. The closest-to-live concern is dashboard label-render crashing if a `mvp_pilot` store reaches a logged-in customer surface; reachability is unverified without a DB query.
- No code changes.
- Time budget: ~20 min.

---

## Bug verdicts (one line each)

- `sendWelcome` enterprise/mvp_pilot fall-through (`email.ts:274-277`): **LATENT** — no production caller currently supplies those values.
- `lifecycleEmails` skip filter omits `mvp_pilot` (`lifecycleEmails.ts:411-413, 485-487`): **NOT A BUG** — upstream `where: { tier: 'core' }` selector (`lifecycleEmails.ts:459`) excludes `mvp_pilot` rows from the query in the first place.
- Dashboard `TIER_RANK[mvp_pilot]` undefined → gates fail closed (`apps/dashboard/src/api.ts:184` etc): **LATENT** — silent free-tier downgrade if a `mvp_pilot` store reaches the customer dashboard.
- Dashboard `TIER_LABEL[tier].replace(...)` crashes for unknown tier (`Layout.tsx:152, 204`): **LATENT-with-LIVE-risk** — would throw `TypeError` if a `mvp_pilot` (or other unrecognized) tier reaches the dashboard; reachability not confirmed in this pass.
- Player `slotsForTier` returns `[]` for `mvp_pilot` (`UpgradeRail.tsx:194-205`): **NOT A BUG** — graceful empty fallback is correct behavior.
- Vestigial `'enterprise'` in `Tier` union (`tier.ts:8`): **NOT A BUG** — code smell only.

---

Absolute path: `/Users/fox296/Desktop/entuned/entuned-0.3/ASSESSMENT-tier-bug.md`
