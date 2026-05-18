# Testing — entuned-0.3

How we test in this monorepo, when tests are required, and how the test gate blocks production deploys. Read this before adding a feature, fixing a bug, or doing any refactor that touches `apps/server/` or `packages/`.

---

## TL;DR

- **All new code in `apps/server/` and `packages/` ships with tests in the same PR.** No exceptions for "simple" code.
- **Bug fixes ship with a test that failed before the fix and passes after.**
- **Cleanup/refactor PRs ship with regression tests proving behavior equivalence.**
- **Production deploys are gated** — Railway (server) and both Pages workflows (admin, player, dashboard) run `pnpm test` and fail the deploy if any test fails.
- **Frontend component/UI tests are out of scope** by current policy. The customer-facing surfaces are smoke-tested manually + the `@entuned/api-client` package has full unit coverage as the wire-level contract layer.

---

## Running tests

```bash
# Whole monorepo
pnpm test

# Just one package
pnpm --filter server test
pnpm --filter @entuned/api-client test

# Watch mode while developing
pnpm --filter server test:watch
```

Both `apps/server/` and `packages/api-client/` have **vitest** wired up. Other packages don't have tests yet — `pnpm -r --if-present test` skips them silently.

---

## File conventions

**Co-located, `.test.ts` suffix:**

```
apps/server/src/lib/tier.ts          apps/server/src/lib/tier.test.ts
apps/server/src/routes/stores.ts     apps/server/src/routes/stores.test.ts
packages/api-client/src/index.ts     packages/api-client/src/index.test.ts
```

- Tests live next to the code they test. No `__tests__/` subdirectory.
- Test files are picked up by vitest's `include: ['src/**/*.test.ts']` glob.
- One `describe` block per exported function (unit tests) or per route (integration tests).

---

## Test types

### Unit tests — pure functions

What we have most of. Imports the module, calls the function, asserts. Mocks any I/O at the boundary.

Pattern (see `apps/server/src/lib/scheduleSlots.test.ts` for a worked example):

```ts
import { describe, it, expect } from 'vitest'
import { findOverlappingSlot } from './scheduleSlots.js'

describe('findOverlappingSlot', () => {
  it('returns null when existing is empty', () => {
    expect(findOverlappingSlot({ startTime: '09:00', endTime: '10:00' }, [])).toBeNull()
  })
})
```

### Integration tests — Fastify routes in-process

Routes mounted on a real Fastify instance, requests sent via `app.inject()`. Prisma mocked. No real DB connection ever. See `apps/server/src/routes/stores.test.ts` for the canonical example.

Pattern:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma BEFORE importing the routes module. Path is relative to the
// test file's location (the routes module imports prisma from '../db.js').
vi.mock('../db.js', () => ({
  prisma: {
    store: { findUnique: vi.fn() },
  },
}))

import { buildTestApp } from '../../test-utils/fastifyApp.js'
import { storeRoutes } from './stores.js'
import { prisma } from '../db.js'

describe('GET /by-slug/:slug', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when store is archived', async () => {
    ;(prisma.store.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      archivedAt: new Date(),
      // ...other fields
    })
    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/test' })
    expect(res.statusCode).toBe(404)
  })
})
```

### Frontend tests — out of scope (policy)

Player, admin, and dashboard apps do not have unit tests by current policy (decided 2026-05-18). The bet: the `@entuned/api-client` unit tests pin the wire-level contract, and manual `preview_start` + visual smoke catches everything else. Revisit if a frontend regression actually slips through.

---

## Mocking conventions

### Prisma — `vi.mock('../db.js', ...)` at the top of the test file

`vi.mock()` is hoisted by vitest, so it MUST be a literal call at top-level of the test file (cannot be extracted to a helper). The path string must be a literal too (relative to the test file).

```ts
// In apps/server/src/lib/foo.test.ts — foo.ts imports prisma from '../db.js'
vi.mock('../db.js', () => ({
  prisma: {
    store: { findUnique: vi.fn(), update: vi.fn() },
    scheduleSlot: { findMany: vi.fn() },
  },
}))
```

Inside test cases, cast the mocked methods:

```ts
;(prisma.store.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ /* row */ })
```

Reset mocks between tests:

```ts
beforeEach(() => vi.clearAllMocks())
```

**Gotcha — `clearAllMocks` vs `resetAllMocks`.** `vi.clearAllMocks()` only clears call history (`mock.calls`, `mock.results`). Per-test `.mockResolvedValue(...)` / `.mockRejectedValue(...)` implementations persist into the next test. If any test in the file sets a one-off implementation on a shared mock (e.g. `prisma.store.update.mockRejectedValue(new Error('db down'))`), use `vi.resetAllMocks()` in `beforeEach` instead — it clears history AND restores implementations to default. Confirmed leakage twice: `pauseAutoResume.test.ts` (Stripe ctor) and `billing.test.ts` (subscription.updateMany rejecting in every subsequent webhook test).

**Gotcha — ESM hoisting and `process.env`.** ESM `import` statements are hoisted above plain top-level statements. So `process.env.MY_VAR = 'x'` followed by `import { foo } from './foo.js'` runs imports FIRST. If `foo.ts` does `const MY_VAR = process.env.MY_VAR ?? ''` at module level, it captures the unset value. Wrap env mutations in `vi.hoisted(() => { ... })` so they run before imports. See `billing.test.ts` for the canonical pattern.

### Global `fetch` — `vi.stubGlobal`

See `packages/api-client/src/index.test.ts` for the canonical pattern.

```ts
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
```

`Response` bodies are single-read — for tests that make multiple requests to the same mocked response shape, use `mockImplementation(async () => new Response(...))` not `mockResolvedValue(new Response(...))`.

### Anthropic SDK / external APIs

Mock the SDK module the same way as Prisma. Pattern (untested example):

```ts
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))
```

---

## Test utilities

Shared helpers live in `apps/server/src/test-utils/`:

- **`fastifyApp.ts`** — `buildTestApp(plugin)` creates a Fastify instance, registers the plugin, returns the ready app. Used in every route integration test. **Note**: does NOT register `sessionPlugin`. Routes that use `requireAuth` as a preHandler are fine (mock `requireAuth` to populate `request.user`). Routes that read `request.user` / `request.account` *directly* (without `requireAuth` — e.g. `GET /billing/upgrade`, `GET /billing/upgrade-from-comp`) need a local Fastify wrapper that installs an `onRequest` hook mirroring `attachSession`. See the local `buildTestApp` in `billing.test.ts` for the pattern.
- **`fixtures.ts`** — fixture builders for common shapes: `makeStore(overrides)`, `makeOperator(overrides)`. Saves boilerplate when a test needs a complete row shape but only cares about a few fields.

Add to these as needed. Keep them small and focused — they should make tests shorter, not introduce abstractions.

---

## CI / production gate

Tests gate every production deploy:

1. **Server (Railway)** — `apps/server/railway.json` build command is `pnpm prisma generate && pnpm test && pnpm build`. If tests fail, the build fails, no new container is promoted, the previous deploy keeps serving.
2. **Admin + player (GitHub Pages)** — `.github/workflows/pages.yml` runs `pnpm test` before either build job. If tests fail, neither admin nor player is deployed.
3. **Dashboard (separate publish repo)** — `.github/workflows/deploy-dashboard.yml` runs `pnpm test` before the dashboard build. Same gate.

The gate is **strict and unconditional**. There is no skip flag. If you need to deploy urgently and tests are broken for an unrelated reason, fix or revert the breaking commit first.

### Why strict

Bypass switches always get abused. Once you have a `SKIP_TESTS=1` env var, you start using it for legitimate one-offs, then for "I'm in a hurry," then for "I know this is fine," and the gate stops being a gate. Better to keep the rule simple: green main = deployable, red main = not.

If you find this rule actively painful (recurring spurious failures, slow test runs), the fix is to improve the tests, not loosen the gate.

---

## Authorship — who writes tests

- **Default**: Claude writes tests as part of every feature, cleanup, or bug-fix PR. No special instruction needed.
- **Backfill sweeps**: periodically, when Daniel asks, 3–5 parallel agents target untested modules in dedicated test-writing passes. See `git log --grep "test("` for the pattern.
- **Daniel**: doesn't write tests. Decides when sweeps happen and what to prioritize.

This reflects that Daniel is a bootstrapper who can't afford to do everything himself but can authorize Claude/agents to operate inside well-defined practices.

---

## Backfill priority

Where untested surface gets covered first, in order:

1. `apps/server/src/lib/` rest of files (outcomeSchedule, freeTier, account, push, email, etc.)
2. `apps/server/src/routes/` integration tests, in order of risk: auth → me → admin (the 4.5k LOC monolith) → billing → stores (most done) → events
3. `apps/server/src/email-templates/` snapshot tests for HTML output
4. `apps/server/src/lib/` generation pipeline (decomposer, eno, bernie, mars, hendrix, ref-tracks) — lower priority because shapes change (these are documented "experiment surfaces"; see `apps/server/src/lib/eno/README.md` and `apps/server/src/lib/decomposer/README.md`)

Top of stack is what the next sweep targets unless Daniel says otherwise.

---

## Anti-patterns — things NOT to do

- **Don't write tests that touch a real database.** Mock Prisma. Tests must run in any environment with node + the source, no env vars, no setup scripts.
- **Don't write tests that hit external APIs.** Mock the SDK module. Tests must run offline.
- **Don't write tests that test the test framework.** Skip `expect(1+1).toBe(2)` smoke tests once vitest is wired.
- **Don't extract mock factories.** `vi.mock()` is hoist-based and the path must be a literal. Keep the mock inline at the top of each test file.
- **Don't write characterization tests for inline lambdas / private helpers.** Test the exported surface; let private implementation be free to change.
- **Don't snapshot-test text the user reads.** Snapshots of HTML emails make sense (catches accidental template breakage). Snapshots of UI strings tied to copy decisions just create noise on every legitimate copy change.
- **Don't add coverage thresholds.** Coverage % is a gameable metric. The gate is "tests for new code in the same PR" — that's the discipline. Coverage tools are fine for visibility, bad as gates.

---

## When to update this document

Update when the practice actually changes. Don't add aspirational rules that don't reflect what we do. Don't add aspirational rules at all — capture the conventions that have already settled. Keep this file shorter than 200 lines.
