# Follow-ups — entuned-0.3

Code/behavior items that surfaced during cleanup + test work and were deliberately deferred. Not test work — actual code or behavior to fix later. Each item is keyed by file/module so you can grep into it from a future PR.

When you fix something here, delete the item (don't strike-through). Keep this list short and load-bearing.

Last updated: 2026-05-18 (post Sweeps A+B+C; cleared 3 trivials — lifecycleEmails doc drift, pauseAutoResume guard annotated, tsconfig cruft file). Suite at 677.

---

## High-leverage

### `apps/server/src/lib/outcomes.ts` — empty-allowlist fall-through

`pickSystemDefaultOutcomeId` for a free Store falls through to the **unfiltered global default** when the `FreeTierOutcome` allowlist is empty. The "free Stores never get an outcome outside allowlist" invariant only holds when the allowlist is non-empty. If a future seed/migration ever produces an empty allowlist (e.g. an admin deletes all FreeTierOutcome rows), new free Stores get initialized with paid-only outcomes silently.

**Fix**: defensive guard — when free tier AND allowlist empty, return `null` rather than falling through. Caller already handles `null` (leaves field blank).

**Pinned in**: `apps/server/src/lib/outcomes.test.ts` (current behavior is locked, deliberate-change required to fix).

---

## Medium

### `apps/server/src/routes/me.ts` — `requireAuth` / `getClient` field mismatch

`requireAuth` (in `lib/session.ts`) populates `request.user`. The local `getClient` helper in `me.ts` reads `request.account`. Today both are set consistently by the same `attachSession` Fastify hook, so the mismatch is invisible. If auth shape ever drifts (e.g. someone changes `attachSession` to stop setting one field), routes would 401 with `unauthorized` from `getClient` even though `requireAuth` passed.

**Fix**: pick one field name across the codebase. Either rename `request.user` → `request.account` in session.ts, or change me.ts's `getClient` to read `request.user`. Coordinate with `apps/server/src/routes/auth.ts` and any other consumer.

### `apps/server/src/routes/admin.ts` — opaque `store_or_outcome_not_found`

POST `/stores/:id/schedule` returns `error: 'store_or_outcome_not_found'` for two distinct failure modes: (a) store deleted, (b) outcome deleted/superseded. Surfaces as a single 404 via Prisma `P2003` foreign-key violation. Operators reporting the error can't distinguish which entity is the problem.

**Fix**: pre-check both with a single `prisma.store.findUnique` + `prisma.outcome.findUnique` before the create. Return distinct codes `store_not_found` / `outcome_not_found`.

### `apps/server/src/routes/admin.ts` — free-tier outcome guard returns 409

The free-tier outcome allowlist guard responds with HTTP 409 `outcome_not_in_free_tier_allowlist`. 409 ("Conflict") is semantically odd here — the request is well-formed and there's no state conflict; the resource just isn't allowed. 403 ("Forbidden") or 422 ("Unprocessable") would be more conventional.

**Fix**: audit the entire codebase's error-status conventions first. If the project consistently uses 409 for "policy-blocked" cases, keep this. If 403/422 are used elsewhere, normalize.

### `apps/server/packages/api-client/src/index.ts` — `buildError` drops `.code` on `{error}`-only responses

When the server returns `{error: 'unauthorized'}` with no `message` field, `buildError` falls through to the raw `${status} ${statusText}: ${body}` shape AND `.code` is left undefined. Callers can't reliably read `.code` on errors unless the server also sent `message`.

**Fix**: always set `.code = parsed.error` if parsed JSON had an `error` field, regardless of `message` presence.

**Pinned in**: `packages/api-client/src/index.test.ts` (current behavior locked).

### `apps/server/src/lib/compExpiry.ts` — inlines `$transaction` instead of calling `applyTierChange`

The cron writes the audit row + store update with its own `prisma.$transaction([store.update, tierChangeLog.create])` instead of routing through `applyTierChange`. Output is equivalent today, but every other tier-change path (admin, billing, pauseAutoResume) goes through `applyTierChange`. Drift risk if `applyTierChange` grows new responsibilities (e.g. emitting an event, calling a webhook) and compExpiry doesn't get the update.

**Fix**: refactor `compExpiry` pass 2 to call `applyTierChange` with `source: 'comp_expired'`. Both behaviors are pinned by tests, so equivalence will surface immediately.

**Pinned in**: `apps/server/src/lib/compExpiry.test.ts` (current inline-transaction shape locked).

### `apps/server/src/lib/pauseAutoResume.ts` — `STRIPE_PRICE_ID_PRO=''` empty-string match

If `STRIPE_PRICE_ID_PRO` is unset, the env default of `''` would match a (theoretical) subscription with `stripePriceId: ''` and incorrectly restore tier=`'pro'`. In practice every real `stripePriceId` is non-empty, so this never trips. Defense-in-depth fix: require both sides non-empty before treating as Pro.

**Pinned in**: `apps/server/src/lib/pauseAutoResume.test.ts` (current "empty env → core" behavior locked).

### `apps/server/src/routes/events.ts` — strict UTC contract silently quarantines non-`Z` timestamps

`z.string().datetime()` (without `{ offset: true }`) rejects any timestamp with an explicit offset like `2026-05-18T12:00:00.000-06:00`. Such events route into the `PlaybackEventRaw` quarantine table rather than ingesting. Today every Entuned-shipped client sends `Z`, so this is invisible. Risk surfaces if a third party ever wires their POS directly into `/events`, or if a future SDK accidentally emits offsets — every event silently disappears into the raw table.

**Decided 2026-05-18**: accept offsets and normalize to UTC on insert. Pass `{ offset: true }` to the zod `datetime()` validator; convert to UTC `Date` via the standard `new Date(str)` constructor (JS Date stores UTC internally regardless of input offset). Update the strict-Z tests accordingly.

**Pinned in**: `apps/server/src/routes/events.test.ts` (current strict-Z behavior locked — will need to flip when this is implemented).

### `apps/server/src/routes/events.ts` — `/events/loved` bypasses `requireAuth`

Every other protected route in the codebase uses `requireAuth` as a preHandler. `GET /events/loved` inlines its own `Bearer` parsing + `verify()` + `isAccountAuthorizedForStore`. Divergent style only — no security gap — but if `requireAuth` ever grows new logic (rate-limiting, audit logging, session-rotation), `/events/loved` won't pick it up.

**Fix**: refactor `/events/loved` to use `{ preHandler: requireAuth }` like everything else.

### `apps/server/src/routes/hendrix.ts` — `setOverride` error string becomes the public 404 body

The `POST /outcome-selection` 404 handler uses `e.message ?? 'failed'` straight from `lib/outcomeSchedule.setOverride`. So the public API's error wording is whatever string the lib happened to throw. Changes to the lib's error messages silently change the API.

**Fix**: map known lib error codes to stable public strings in the route handler. Or have setOverride throw a typed error with a stable `.code`.

**Pinned in**: `apps/server/src/routes/hendrix.test.ts`.

### `apps/server/src/lib/account.ts` — `uniqueStoreSlug` exhaustion fallback has no uniqueness check

After 5 collision retries the function returns `${slugify(name)}-${randomBytes(3).toString('hex')}` with NO `findUnique` on the final string. Collision probability is ~1/2^48 — vanishingly small — but non-zero, and on collision the caller gets a Prisma unique-constraint error rather than a friendly retry.

**Fix**: either tighten the retry budget contract (acknowledge the rare-throw path in JSDoc) or add a final findUnique + escalate suffix length on miss.

**Pinned in**: `apps/server/src/lib/account.test.ts` (current "no uniqueness check on final" behavior locked).

### `apps/server/src/lib/account.ts` — `slugify` keeps only the first whitespace token

`slugify` does `name.split(/\s+/)[0]` before lowering/stripping. So `"Big Sky Outfitters"` → `big-...` (the "sky" and "outfitters" tokens vanish). Probably intentional (short slugs), but worth knowing if a customer ever asks why their slug doesn't include their full business name.

**Fix (optional)**: document the contract in JSDoc, or change to join all tokens with `-` and cap length.

**Pinned in**: `apps/server/src/lib/account.test.ts` (current first-token-only behavior locked).

### `apps/server/packages/api-client/src/index.ts` — `baseUrl` naive concat

`fetch(`${opts.baseUrl}${path}`, ...)` does no slash normalization. If a caller ever passes `baseUrl: 'https://x.com/'` (trailing slash) and `path: '/y'` (leading slash), result is `https://x.com//y`. Today every caller passes the canonical shape so it works, but the contract is brittle.

**Fix**: either strip trailing slash from baseUrl or document the contract in JSDoc.

---

## Low / housekeeping

### Schedule `schedule_overlap` message wording diverges between admin and me

- Operator surface: `"Overlaps with existing slot HH:MM–HH:MM"`
- Customer surface: `"Overlaps with HH:MM–HH:MM"`

Pinned by tests on both surfaces. If you ever want to unify, do it deliberately and update both test files.

---

## Notes on workflow

- The `Tier` enum legacy `mvp_pilot` value was ripped out as of 2026-05-18 (migration `20260518000000_remove_mvp_pilot_store_tier`). `ClientPlan.mvp_pilot` is a separate concept and stays.
- The Eno-1 vs Eno-2 split and the decomposer v1–v8 sweep are documented as intentional experiment surfaces — see `apps/server/src/lib/eno/README.md` and `apps/server/src/lib/decomposer/README.md`. Do not treat as cleanup targets.
- See also `ASSESSMENT.md` and friends at repo root for the codebase audit that drove the cleanup sprint.
