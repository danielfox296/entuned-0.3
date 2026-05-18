# ASSESSMENT — entuned-0.3 frontends

Read-only audit of the three frontend apps (`apps/player`, `apps/admin`, `apps/dashboard`).
No `packages/` workspace exists; each app is a self-contained React + Vite + TS project
with its own `api.ts`, `tokens.ts`, and `ui/` (or `components/`) folder.

Confidence tiers:
- **HIGH** — the same operation is implemented in 2+ places with measurable drift, or the same shape is defined 3 different ways.
- **MEDIUM** — patterns are similar but localised; sharing is plausible but not forced by drift.
- **LOW** — smell only; flagged for awareness, not action.

---

## 1. Inventory per app

### apps/player — 4,303 LOC

| Subdir | LOC |
|---|---|
| `src/screens/` | 1,537 |
| `src/components/` | 1,491 |
| `src/lib/` | 565 |
| `src/audio/` | 277 |
| `src/` (top-level: `App.tsx`, `api.ts`, `main.tsx`, `sw.ts`, `index.css`) | 387 |

Top 10 files (path : LOC):
- `src/screens/PlayerScreen.tsx` : 1,436
- `src/components/UpgradeRail.tsx` : 455
- `src/components/OutcomeModal.tsx` : 350
- `src/components/TooltipTour.tsx` : 300
- `src/api.ts` : 208
- `src/audio/loudness-sampler.ts` : 194
- `src/lib/audio-cache.ts` : 191
- `src/components/PWAInstallTip.tsx` : 143
- `src/lib/event-buffer.ts` : 133
- `src/lib/push-client.ts` : 112

Build/framework: Vite 6, React 18, TS strict, ESM. Key deps: `howler` (audio), `workbox-precaching` / `workbox-window` / `vite-plugin-pwa` (service worker + offline).

API call origin: **single client** at `src/api.ts` (the `api` const, 77 entries). One non-`api.ts` `fetch` exists at `src/lib/audio-cache.ts:128` — it fetches R2 audio URLs directly (not the API server). Fully consistent.

### apps/admin — 15,296 LOC

| Subdir | LOC |
|---|---|
| `src/panels/` | 11,723 |
| `src/` (`App.tsx`, `api.ts`, `nav.ts`, `tokens.ts`, `main.tsx`) | 2,464 |
| `src/ui/` | 1,101 |

Panel breakdown (LOC):
- `brand/` : 2,763 — IcpEditor, ClientDetail, StoreEditor, LoginsPanel, Campaigns, HookQueue, TierPanel, HookRefresh
- `workflow/` : 2,282 — WorkflowRouter, PreLaunchChecklist, ReferenceTrackRefresh, HookRefresh
- `engine/` : 1,590 — DecomposerRules, FailureRules, LyricPrompts, LyricBanList, OutcomeFactorPrompt, OutcomeLyricFactor, ReferenceTrackPrompt, HookDrafterPrompt, FormArchetypes
- `seeding/` : 1,082 — SongSeed, SongSeedQueue
- `schedule/` : 1,019 — OutcomeSchedule, OutcomeLibrary, DryRun
- `catalogue/` : 841 — PoolDepth, SongBrowser, FlaggedReview, FreeTierOutcomes
- `playback/` : 635 — LiveStoreView
- `email/` : 526 — EmailTemplates
- `monitoring/` : 496 — RetentionDashboard, PlayerReliability
- `salesdata/` : 489 — SalesDataIngest

Top 10 files:
- `src/api.ts` : 1,489
- `src/panels/workflow/ReferenceTrackRefresh.tsx` : 1,078
- `src/App.tsx` : 867
- `src/panels/brand/HookQueue.tsx` : 674
- `src/panels/playback/LiveStoreView.tsx` : 635
- `src/panels/seeding/SongSeed.tsx` : 548
- `src/panels/workflow/PreLaunchChecklist.tsx` : 541
- `src/panels/seeding/SongSeedQueue.tsx` : 534
- `src/panels/email/EmailTemplates.tsx` : 526
- `src/panels/engine/FormArchetypes.tsx` : 494

Build/framework: Vite 6, React 18, TS strict, ESM. Key deps: `lucide-react` only. No router (single-page panel switcher driven by `nav.ts`).

API call origin: **single client** at `src/api.ts` (the `api` const, 790 method-shaped lines; the file holds ~50 distinct typed RPC wrappers and ~70 exported interfaces). All in-panel calls go through `api`; no scattered `fetch` calls (`ReferenceTrackRefresh.tsx` "refetch" hits are local function calls, not raw `fetch`). Confirmed via `grep "fetch(" --include="*.tsx" panels/`. Fully consistent.

### apps/dashboard — 5,674 LOC

| Subdir | LOC |
|---|---|
| `src/routes/` | 3,784 |
| `src/ui/` | 1,179 |
| `src/` (`App.tsx`, `api.ts`, `tokens.ts`, `main.tsx`) | 480 |
| `src/lib/` | 217 |
| `src/content/` (YAML) | — |

Top 10 files:
- `src/routes/IcpIntake.tsx` : 830
- `src/routes/Locations.tsx` : 446
- `src/routes/Upgrade.tsx` : 440
- `src/routes/Schedule.tsx` : 405
- `src/api.ts` : 362
- `src/routes/Account.tsx` : 340
- `src/routes/Start.tsx` : 309
- `src/ui/Layout.tsx` : 300
- `src/routes/Home.tsx` : 291
- `src/routes/BoostTrial.tsx` : 231
- `src/ui/LockScreen.tsx` : 178

Build/framework: Vite 6, React 18, TS strict, ESM. Key deps: `lucide-react`, `react-router-dom` v6 (only app with a router), `@modyfi/vite-plugin-yaml` (content YAML).

API call origin: **single client** at `src/api.ts` (the `api` const, 128 method-shaped lines). Zero raw `fetch()` calls outside `api.ts`. Fully consistent.

---

## 2. API client patterns

Every app has one `req<T>()` helper inside `src/api.ts`, used by every method on the exported `api` object. No scattered fetch — clean.

But the three `req<T>()` implementations have **drifted in a load-bearing way**:

| App | File:line | Auth mechanism | `credentials` | Error shape parsing |
|---|---|---|---|---|
| player | `apps/player/src/api.ts:144` | optional Bearer (`token?` param) | not set | text-only: `throw new Error('${status}: ${body}')` |
| admin | `apps/admin/src/api.ts:20` | Bearer from `localStorage` (passed in as `token?`) | not set | text-only: `throw new Error('${status}: ${body}')` |
| dashboard | `apps/dashboard/src/api.ts:14` | session cookie | `'include'` (always) | JSON-aware: tries to parse `{error, message}` and surfaces `message` on the thrown Error with `.status` and `.code` attached |

Base URL: identical pattern in all three — `import.meta.env.VITE_API_URL ?? 'http://localhost:3000'` (player api.ts:4, admin api.ts:4, dashboard api.ts:11). Consistent.

`Content-Type` handling: player always sets it (api.ts:145); admin and dashboard only set it when there's a body (admin api.ts:23, dashboard api.ts:18). Player comment notes Fastify rejects empty JSON bodies with the header present — so player's version is **already a latent bug** for any future POST-with-no-body endpoint. **MEDIUM**.

Error handling: admin and player throw `Error('${status} ${statusText}: ${body}')` and lose any structured `{error, message}` server payload. Dashboard's `req<T>` parses JSON, extracts `.message`, and stashes `.status` / `.code` on the thrown Error (dashboard api.ts:25–34). This is observable in admin: every `setError(e.message ?? '...')` site (e.g. `App.tsx:582`) shows raw status text instead of the friendly server message. **HIGH** — same operation, three implementations, one strictly better.

Upload helper: admin alone has a separate `upload<T>()` for `FormData` (admin api.ts:37). Not duplicated yet but will be when player needs an upload (e.g. operator-recorded voice notes — flagged in the v1.5 handoff). **LOW**.

Tag: **HIGH (error parsing), MEDIUM (Content-Type handling, base URL is consistent), LOW (upload)**.

---

## 3. Auth & session handling

Three apps, three auth models:

### apps/player
- **Two modes**, both managed in `src/App.tsx:10–95`:
  - **Slug mode**: `music.entuned.co/<slug>` — slug in URL is the auth. `App.tsx:25–48` calls `api.storeBySlug(slug)`, synthesises a `Session` with `mode:'slug'` and an empty token (`storage.ts:1–25`). No login screen.
  - **Operator mode**: `loadSession()` reads `localStorage['entuned.session.v1']` (`storage.ts:26–37`); falls back to `LoginScreen` (`screens/LoginScreen.tsx:1–80`) which POSTs `/auth/login` and saves the Bearer token + store metadata into the same localStorage key.
- Persisted blob: `Session { mode, token, storeId, slug?, storeName, clientName, tier?, operatorId, email, displayName?, isAdmin, availableStores? }` — `lib/storage.ts:3–24`.

### apps/admin
- Bearer token only, in a **different** localStorage key (`'entuned.admin.token'`, `apps/admin/src/api.ts:6`).
- Boot: `App.tsx:792` reads `getToken()`; if present, `App.tsx:805` calls `api.me(token)` and on failure clears the token.
- Login: `Login` component at `App.tsx:568–660`. Email+password against `/auth/login`. Also supports a magic-link-style **password reset** flow: `readResetTokenFromHash()` at `App.tsx:557` reads `#reset-password?token=...`, lets the user POST `/auth/reset-password` (`api.resetPassword`, used at `App.tsx:690`), and on success replaces the URL hash and signs in.
- Password reset and `change password` are admin-specific; dashboard has neither.

### apps/dashboard
- Session cookie only. `req<T>` always sends `credentials: 'include'` (api.ts:20). No token, no localStorage.
- Boot: `useAuth()` hook at `apps/dashboard/src/lib/auth.tsx:16–38` calls `api.me()` (which hits `/login/me`); 401 → `user=null, loading=false`.
- Login: magic link (`api.magicLink`, dashboard api.ts:228) or Google OAuth redirect (`api.googleLoginUrl`, dashboard api.ts:236–239). No password.
- Gating: `<RequireAuth>` wrapper at `lib/auth.tsx:43–52` — redirects to `/start?next=...` if unauthenticated. The only router in any of the three apps.
- Logout: `api.logout` POSTs `/login/logout` (dashboard api.ts:241) → server clears the cookie.

### Coexistence
- Admin and dashboard never confuse each other because they're served from **different origins** (`dash.entuned.co` vs `app.entuned.co`). Cookies are scoped per origin; localStorage is scoped per origin. No bleed-through possible.
- Player at `music.entuned.co` also separate. Note: the player's operator login uses the same `/auth/login` endpoint as admin (player api.ts:156, admin api.ts:790-ish in `api.login`), so an operator can mint a Bearer token from either UI — they just won't share the token across origins.
- However: **the same operator can simultaneously have an admin Bearer in `dash.entuned.co` localStorage AND a customer cookie in `app.entuned.co`.** They're separate identities at the server level (operator vs user). Daniel reportedly has both. Not a confusion bug, but worth flagging when reading server logs ("which session decided this?"). **LOW**.
- The MEMORY note "Dash auth screen flashes on login" reflects admin's `App.tsx:803–810` pattern: on boot it always renders `<Login>` until `api.me()` resolves, even if a valid token is in localStorage. Dashboard's `RequireAuth` has the same flash (`loading=true` returns `null`, `lib/auth.tsx:46`). Player's pattern is the same (`App.tsx:19` → `slugLoading=true` while resolving). Three apps, three near-identical "loading flash on auth boot" implementations. **MEDIUM**.

Tag: **HIGH (three distinct auth wrappers around the same `/auth/login` and `/auth/me` server-side machinery; each app rolls its own auth-state hook)**.

---

## 4. Shared component / utility duplication

### Button — HIGH drift
- `apps/admin/src/ui/Button.tsx` (96 LOC) — variants `'primary' | 'ghost' | 'danger' | 'tiny' | 'tinyDanger'`. Imports `S` (sizes) from `./sizes.js`.
- `apps/dashboard/src/ui/Button.tsx` (— LOC, similar prelude) — variants `'primary' | 'ghost' | 'danger'`. No `'tiny'` variants. No `S` dependency.
- Player: **no `Button` component** — uses `<button>` with inline styles in PlayerScreen.tsx (e.g. the play/skip/love icon buttons in `IconButton.tsx`).
- The header, props (`children, onClick, disabled, busy, variant, type, title, style`), and structural body are byte-for-byte identical between admin and dashboard. Only the variant union and the size-token import differ. **HIGH**.

### Modal / Toast — admin-only
- `apps/admin/src/ui/Modal.tsx` (73 LOC) and `apps/admin/src/ui/Toast.tsx` (88 LOC, with `ToastProvider` Context + `useToast` hook) exist nowhere else.
- Dashboard has no Modal — `Upgrade.tsx`, `Schedule.tsx`, `IcpIntake.tsx` build modal-shaped UI inline.
- Dashboard has no Toast — error states use inline `<div>` boxes via `LockScreen.tsx` and route-level state.
- Player has `OutcomeModal.tsx` and `ReportModal.tsx` as bespoke implementations under `components/` (350 + 112 LOC), not generic.
- **HIGH** — three teams reinvented "modal/toast" three different ways.

### Layout
- `apps/admin/src/ui/Layout.tsx` (87 LOC) — generic layout primitives (`Section`, `Row`, etc.).
- `apps/dashboard/src/ui/Layout.tsx` (300 LOC) — **a different concept**: the full dashboard chrome (sidebar nav, tier badge, lock indicators). Imports `useAuth`, tier helpers.
- Player has no `Layout` — `PlayerScreen.tsx` is the layout.
- Same filename, unrelated purpose. **LOW** (naming collision, not a duplication target).

### LockScreen
- Only `apps/dashboard/src/ui/LockScreen.tsx` (178 LOC). Not duplicated.

### StorePicker / HeaderSelect / Pill / Tabs / ConfirmDelete / PanelHeader / VersionedPromptEditor / Inputs / sizes / clientLogo / LlmProgress
- All admin-only (`apps/admin/src/ui/`). Not duplicated. Eight of them (`Button, Modal, Toast, StorePicker, Pill, HeaderSelect, Tabs, Layout primitives`) are re-exported through `apps/admin/src/ui/index.ts`.

### useAuth
- Only `apps/dashboard/src/lib/auth.tsx:16` exposes a `useAuth()` hook. Admin and player do the same work inline in `App.tsx` (admin App.tsx:792–820; player App.tsx:15–55). **MEDIUM** — same conceptual thing, three implementations.

### ga4.ts — MEDIUM drift
- `apps/player/src/lib/ga4.ts` and `apps/dashboard/src/lib/ga4.ts` share the same skeleton (`fire()` helper, `typeof gtag` guard) but ship different event sets (`trackPlayerLanding`, `trackFirstPlay`, `trackTrackComplete` in player; `trackDashboardLanding`, `trackSignUp`, `trackOnboardingComplete`, `trackPageView`, `trackLockedNavClick` in dashboard).
- Admin has no `ga4.ts` — no analytics on the operator surface.
- The `fire()` helper itself looks copy-pasted (identical typeof-guard pattern, identical comment phrasing). Worth pulling out. **MEDIUM**.

### tokens.ts — near-zero drift
- `apps/admin/src/tokens.ts` (42 LOC) vs `apps/dashboard/src/tokens.ts` (43 LOC). `diff` shows two header-comment differences and **one real diff**: dashboard adds `slate: '#829eac'` (line 32). Otherwise byte-identical.
- Player has **no** `tokens.ts` — colors are hardcoded inline (e.g. `#20201c`, `#d4e1e5` in `App.tsx:88–96`). The brand palette is replicated by hand.
- The `apps/dashboard/CLAUDE.md` explicitly says "Keep in sync with admin's tokens.ts when either side evolves." This is a documented manual-sync hazard. **HIGH** for admin↔dashboard, **MEDIUM** for player (inline palette).

### Polling / fetch-on-interval
- `usePolling` doesn't exist as a shared hook. `apps/admin/src/panels/playback/LiveStoreView.tsx` and dashboard's `Home.tsx` each implement their own `setInterval` + `clearInterval` patterns inline. **LOW** (small, isolated).

---

## 5. State management patterns

**Global state**

| App | Mechanism | Where |
|---|---|---|
| player | None — all state is per-screen `useState` in `App.tsx` / `PlayerScreen.tsx`. Session lives in localStorage, not React state. | n/a |
| admin | Only Context is `ToastProvider` (admin `ui/Toast.tsx:15`). Three small selection hooks read URL hash directly: `useClientSelection`, `useStoreSelection`, `useIcpSelection` (`src/ui/use*Selection.ts`). All other panel state is local. | `ui/Toast.tsx:15`, `ui/useStoreSelection.ts:1` |
| dashboard | One Context: `TierContext` (`lib/tier.tsx:12`). Auth state via the `useAuth()` hook (`lib/auth.tsx:16`) — fresh React state per consumer, no Context. | `lib/tier.tsx:12` |

No Zustand, no Redux, no Jotai anywhere. Confirmed via grep. **Consistent across all three apps.**

**Server state**

| App | Mechanism |
|---|---|
| All three | Manual — `useEffect` + `useState`, with cancellation flags. No React Query / SWR / Apollo. |

Canonical examples:
- player: `App.tsx:24–48` (`api.storeBySlug → setSlugSession`)
- admin: `App.tsx:803–810` (`api.me(token) → setMe`)
- dashboard: `lib/auth.tsx:21–28` (`api.me() → setMe`)

All three implement the same `let cancelled = false; ... return () => { cancelled = true }` pattern. No drift. **Consistent.**

**Form state**

| App | Mechanism |
|---|---|
| All three | Controlled inputs via `useState`. No `react-hook-form`, no Formik, no `zod` for validation (server returns validation errors which the dashboard surfaces nicely via the `req<T>` error parser; admin and player swallow them as plain `Error.message`). |

Canonical examples:
- player: `screens/LoginScreen.tsx:11–18`
- admin: `App.tsx:570–576` (Login form)
- dashboard: `routes/Start.tsx:1–60` (magic-link form)

Consistent.

---

## 6. Domain type definitions

### Tier
- **Defined**: `apps/dashboard/src/api.ts:45` — `export type Tier = 'free' | 'core' | 'pro' | 'enterprise'`.
- **Re-declared inline (4-place drift)**:
  - `apps/admin/src/api.ts:355` — `tier: 'free' | 'core' | 'pro' | 'enterprise' | 'mvp_pilot'` (includes `mvp_pilot`).
  - `apps/admin/src/api.ts:407` — same inline literal.
  - `apps/admin/src/panels/brand/StoreEditor.tsx:22` — same inline literal again.
  - `apps/player/src/lib/storage.ts:21` — typed as plain `string` (no enum).
  - `apps/player/src/api.ts:72` — typed as plain `string`.
- Server side: defined as a Prisma enum (per ASSESSMENT.md §5).
- **HIGH** — already covered in server ASSESSMENT.md, extends here with admin's extra `mvp_pilot` value the dashboard's `Tier` type would silently reject.
- MEMORY note "Core renamed to Boost" confirms the public label is "Boost" while the DB value stays `'core'`. The dashboard `TIER_LABEL` at `apps/dashboard/src/api.ts:191` is the only place that maps; the player and admin's inline tier strings have no display mapping at all.

### OutcomeOption — HIGH (same name, different shape)

| App | File:line | Shape |
|---|---|---|
| player | `api.ts:53–62` | `{ outcomeId, outcomeKey, title, tempoBpm, mode, poolSize, availableOnFree }` |
| dashboard | `api.ts:101–105` | `{ id, title, displayTitle }` |

Both are named `OutcomeOption`. Both come from outcome-list endpoints. Player calls `/hendrix/outcomes`; dashboard calls `/me/outcomes`. The server returns **different shapes for these two routes** — confirmed by inspection. So the type duplication reflects a real server divergence, not just frontend drift. **HIGH** — caller-facing identical name, two unrelated shapes; rename one.

### ScheduleSlot — MEDIUM drift
- admin `api.ts:576–585` — `{ id, storeId, dayOfWeek, startTime, endTime, outcomeId, outcomeTitle, outcomeDisplayTitle, outcomeVersion }`
- dashboard `api.ts:83–92` — `{ id, storeId, dayOfWeek, startTime, endTime, outcomeId, outcomeTitle, outcomeDisplayTitle }`

Identical except `outcomeVersion` (admin only). Dashboard hits `/me/stores/:id/schedule`; admin hits `/admin/stores/:id/schedule`. Same logical row, different fields — drift is real but small. **MEDIUM** — unify.

### ScheduleSlotInput — identical
- admin `api.ts:587–592` and dashboard `api.ts:94–99` — same four fields. **HIGH (identical, just duplicated)**.

### StoreRow — same name, three unrelated shapes (HIGH)

| App | File:line | Fields |
|---|---|---|
| admin | `api.ts:65–75` | `id, name, timezone, clientId, icpId, defaultOutcomeId, outcomeSelectionId, outcomeSelectionExpiresAt, goLiveDate` |
| dashboard | `api.ts:113–127` | `id, name, slug, tier, paidTier, compTier, compExpiresAt, pausedUntil, subscription` |
| player (`StoreBySlug`) | `api.ts:27–34` | `id, name, slug, tier, timezone, pausedUntil` |

Same conceptual entity (a row in the `Store` table), wildly different field sets — each is the server's response for *that frontend's* lookup endpoint. Server has one underlying model. **HIGH** — operators looking for "the canonical Store shape" can't find one.

### MeResponse — HIGH (three distinct shapes)
- player `api.ts:69–74`: `{ operator, store, stores }`
- admin `api.ts:54–57`: `{ operator, stores }`
- dashboard `api.ts:68–72`: `{ user, account, role }`

Different routes (player and admin → `/auth/me`; dashboard → `/login/me`), so the divergence is server-driven. But the **name collision is misleading**: a "MeResponse" type changes meaning per app. **HIGH** — rename per route, or define `OperatorMeResponse` vs `UserMeResponse`.

### AudioEventType / OutgoingEvent (event ingest)
- Defined only in `apps/player/src/api.ts:75–142` (the player is the only emitter).
- A comment at `apps/admin/src/panels/playback/LiveStoreView.tsx:11` says "Keep in sync with the AudioEventType union in api.ts" — but the admin doesn't actually import it. Admin must hard-code its own copy somewhere when it parses event-stream payloads. **MEDIUM** — the comment is an honest admission of duplication risk.

### Hook / HookRow / HookRowFull
- Defined in admin only (`api.ts:108, 806`). Dashboard doesn't model hooks. Player doesn't (hooks are server-internal once the song is generated). **No drift.**

### Song / SongSeed
- Admin only (`api.ts:507–582`). Player uses `QueueItem` (`api.ts:6–25`) which projects only the fields needed for playback (`songId, audioUrl, hookId, hookText, title, outcomeId, icpId, icpName`). Two unrelated shapes by design. **No drift.**

### ReferenceTrack / RefTrack
- Admin only (`api.ts:239, 306`). Not in player or dashboard. **No drift.**

### User / Account
- `MeUser` and `MeAccount` only in dashboard (`api.ts:48–62`). Admin's `UserRow` (`api.ts:446`) is operator-facing — different table (Operator vs User). **No frontend drift; potential confusion between two SSOT-level entities** that share informal names. **MEDIUM**.

### Catalog / Playlist / PlayEvent / OutcomeChange
- **None** of these are defined in any frontend type. Confirmed via grep. They're server-internal. **No drift; flag the absence** — if any frontend ever needs to render a Playlist or surface OutcomeChange history, there's no shared starting type.

---

## 7. Why is admin 3.5× the size of player?

Admin's 15.3k LOC vs player's 4.3k LOC is **mostly justified by surface area, not duplication.** Breakdown:

### Surface count
- Player ships **two screens**: `LoginScreen` (80 LOC) and `PlayerScreen` (1,436 LOC). That's the whole product.
- Admin ships **~30+ distinct operator panels** across 10 surface groups (Workflows, Clients, Schedule, Outcomes, Prompts & Rules, Library, Sales Data, Email, Monitoring, plus deferred Experiments/Hypothesis). Each panel is a separate file under `src/panels/<group>/`.
- 15.3k / 30 panels ≈ 510 LOC/panel. That's reasonable.

### The biggest three pages

- **`src/panels/workflow/ReferenceTrackRefresh.tsx` (1,078 LOC)** — operator UI for the Reference Track queue: pulls suggested tracks from the LLM, lets the operator approve/edit/analyze them per taste bucket (PreFormation / FormationEra / Subculture / Aspirational / Adjacent). Justified by the multi-bucket UX and the inline style-analysis editing.
- **`src/App.tsx` (867 LOC)** — the shell: groups + nav + sidebar + login + password reset + change-password modal. Big because it covers the full auth lifecycle and the surface-group routing logic.
- **`src/panels/brand/HookQueue.tsx` (674 LOC)** — operator review of generated hooks per ICP per outcome, with draft/approved filters. Justified.

### Honest signs of admin-internal duplication

- **Header chrome** — every panel re-implements its own `PanelHeader` + `StorePicker` import block. The shared `PanelHeader` at `src/ui/PanelHeader.tsx` is only 15 LOC and most panels don't use it; they hand-roll a styled `<div>` instead. **MEDIUM**.
- **Hook-related panels overlap** — `HookQueue.tsx` (674), `HookRefresh.tsx` (in `workflow/`), `HookDrafterPrompt.tsx` (in `engine/`) all deal with hooks at different lifecycle stages. Daniel may want to consolidate, or may want them separate; from code alone they're distinct workflows. **LOW** — flag for product judgment.
- **Outcome editing** is split between `panels/schedule/OutcomeSchedule.tsx`, `panels/schedule/OutcomeLibrary.tsx`, and `panels/engine/OutcomeFactorPrompt.tsx` / `OutcomeLyricFactor.tsx`. Each panel hits different endpoints on the same `Outcome` row. **LOW** — by design (Schedule vs Library vs Engine view).

**Verdict: admin's bulk is mostly real operator surface. The drift is in (1) per-panel style/header replication and (2) the 1,489-LOC `api.ts` carrying 70 interface definitions because no shared types package exists.**

---

## 8. Dead routes / dead components

Method: grepped for every panel/route filename being imported elsewhere. Tag: **MEDIUM** — confidence is grep-based, not `ts-prune`.

### Unreachable routes/panels: **none found**.
- Admin: every `panels/**/*.tsx` is imported in `apps/admin/src/App.tsx` (lines 13–39, verified). The deferred surface groups (`experiments`, `hypothesis`) are flagged in `GROUPS` but have no panel files yet, so nothing to garbage-collect.
- Dashboard: every `routes/*.tsx` is registered in `apps/dashboard/src/App.tsx:32–60`.
- Player: only two screens, both used.

### Possibly stale
- `apps/admin/src/ui/PanelHeader.tsx` (15 LOC) — imported by some panels, others hand-roll their own. Not dead, but underused. **LOW**.
- `apps/admin/src/ui/ConfirmDelete.tsx` (43 LOC) — grep shows it's imported in `Toast.tsx`'s sibling re-export; spot-check shows it's still used by `IcpEditor.tsx`. Live.

### Note
- The MEMORY note about "deferred experiments/hypothesis surfaces" matches admin's `App.tsx` `GROUPS` declaration (`deferred: true` at the group level) — these are intentional placeholders, not dead code.

---

## 9. Open questions for Daniel

1. **Auth model unification.** Admin uses Bearer-in-localStorage; dashboard uses cookies; player uses both (operator localStorage + slug URL). Is this divergence intentional (different threat models per audience), or accumulated drift? If intentional, can the **operator login in `apps/player`** move to cookies too so we're not maintaining two auth code paths against `/auth/login`?

2. **`req<T>` error parsing.** Dashboard's `req<T>` parses `{error, message}` and surfaces a clean `Error.message` with `.status` and `.code`. Admin and player throw `"401 Unauthorized: {\"error\":\"...\",\"message\":\"...\"}"`. Should we promote dashboard's pattern to all three? Operator UX would noticeably improve. (We already saw admin's Login show raw `401 Unauthorized: { ... }` text in `setError(e.message)` at `App.tsx:582`.)

3. **`OutcomeOption` collision.** Same type name, two unrelated shapes (`/hendrix/outcomes` vs `/me/outcomes`). Is this intentional shape divergence at the server (different audiences need different fields), or should `/me/outcomes` grow to match `/hendrix/outcomes` so the type can be shared?

4. **`StoreRow` × 3.** admin, dashboard, and player each get a different Store projection. Some fields *cannot* leak across (e.g. the admin form needs `icpId`, the dashboard needs `subscription`, the player needs `pausedUntil`). Is the right answer a single `Store` base + projection types, or accept the drift?

5. **Design tokens manual sync.** `apps/dashboard/CLAUDE.md` says "Keep in sync with admin's tokens.ts." Admin↔dashboard differ by one color (`slate`); player has no tokens at all (palette inlined in `App.tsx`). Are we OK with three palettes drifting by hand, or should we extract `@entuned/tokens` (or just symlink) before the next palette tweak?

6. **Shared UI primitives (`Button`, `Modal`, `Toast`).** Admin's `ui/index.ts` exports ~14 primitives. Dashboard re-implements `Button` and `Layout` with the same prop interface; player has neither. Is the cost of setting up a `packages/ui` workspace lower than the cost of these three drifting? (Note: pnpm-workspace.yaml already exists for the server↔frontends split; adding a `packages/*` glob is one-line.)

7. **`MeResponse` ambiguity.** The same type name means three different things across apps. Is it worth renaming to `OperatorMeResponse` (player + admin) and `UserMeResponse` (dashboard) just for log-readability?

8. **Player slug-mode session persistence.** Slug mode synthesises a fresh `Session` on every reload by re-calling `api.storeBySlug(slug)` (player `App.tsx:25–48`). It does not save to localStorage. Is the round-trip on every reload acceptable, or should slug-mode sessions persist with a short TTL the way operator sessions do? Negligible for the freemium scale, but worth confirming.

---

## 10. Negative findings (worth saying out loud)

- **No app uses Redux/Zustand/MobX/Recoil/Jotai.** All three are pure React. That consistency is a real strength — easy to onboard, no global-state surprises.
- **No app uses React Query/SWR.** Server state is manual `useEffect + cancellation flag` everywhere, and the pattern is *byte-identically replicated* in all three. So a future shared `useApi` hook would have one obvious model to follow.
- **All three apps use `import.meta.env.VITE_API_URL ?? 'http://localhost:3000'` identically.** Env wiring is consistent.
- **All three apps use TS strict, ESM, Vite 6, React 18.** Stack is consistent — the cost of extracting `packages/ui` or `packages/api-client` is purely about workspace plumbing, not build-tool reconciliation.
- **No raw `fetch()` leaks anywhere.** Every backend call goes through each app's `api.ts`. This is rare and worth preserving.

---

## Executive summary

1. Three frontends, three `req<T>` helpers, one strictly better — **dashboard parses structured `{error, message}` errors; admin and player don't**, which is why admin's Login surfaces raw `"401 ..."` strings.
2. Three auth models (Bearer-in-localStorage in admin, two-mode token-or-slug in player, cookies in dashboard) all hit the same server endpoints; each app rolls its own `useAuth` equivalent inline.
3. `Button`, `Modal`, `Toast`, `tokens.ts`, the `ga4.ts` `fire()` helper, and `ScheduleSlotInput` are duplicated/drifted between admin and dashboard with high confidence — a `packages/ui` + `packages/tokens` extraction would be one-line workspace config and immediate payoff.
4. `OutcomeOption`, `StoreRow`, and `MeResponse` collide on name across apps with **different shapes** — symptomatic of server-side projection divergence, not just frontend sloppiness; fix at the source or rename per route.
5. Admin's 15k LOC is mostly real operator surface (~30 panels × ~510 LOC each), not duplication — the bulk is justified; the local drift is per-panel header/styling replication, not unreachable code.
6. State management, build stack, env wiring, and server-state patterns are **consistent** across all three apps — a real strength worth preserving when consolidating.

`/Users/fox296/Desktop/entuned/entuned-0.3/ASSESSMENT-frontends.md`
