# CLAUDE.md — entuned-0.3 dashboard

Customer-facing dashboard for v0.3. Companion to `apps/admin` (operator) and
`apps/player` (in-store). Lives at **app.entuned.co**.

## Read first

- `./README.md` — dev/build/deploy instructions, env vars, manual setup
- `../admin/CLAUDE.md` — design-token rules, no-CSS-framework rule (same here)
- `../admin/src/api.ts` — reference shape for server payload types
- `../server/src/index.ts` — auth lives here; cookies, magic link, Google OAuth

## Stack (locked)

- React 18 + Vite 5 + TS strict, ESM
- `react-router-dom` v6 — first v0.3 app to use a router
- Auth: **session cookies** (not Bearer tokens like admin). Every fetch goes
  out with `credentials: 'include'`.
- Port **5179** (server 3000, player 5177, admin 5178, dashboard 5179)

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **No CSS frameworks.** Inline styles via the `T` design tokens object in
  `src/tokens.ts`. Mirrors admin's tokens; keep them in sync if either side
  evolves the palette.
- **No component libraries.** Build small components in `src/ui/` and reuse them.
- **Cookies, not tokens.** Do not introduce `localStorage` auth here. The
  dashboard is customer-facing on a public domain — magic-link / OAuth
  cookies are the security model.
- **Match admin's TypeScript strictness.** `tsconfig.json` is identical to
  admin's; do not loosen.

## Routing

`react-router-dom` v6, `BrowserRouter`. Routes:

- `/start` — magic-link request + Google OAuth (public)
- `/welcome` — Stripe Checkout return landing (public, reads `?session=`)
- `/` — Home (Now Playing per location)
- `/intake` — first-run ICP intake (7 Core questions)
- `/locations` — location list + add
- `/account` — profile, billing portal, indemnification cert

Auth gate: wrap any private route in `<RequireAuth>` (from `src/lib/auth.ts`).

## Deploy

GitHub Pages **on a separate publish repo** (`danielfox296/entuned-0.3-dashboard`),
because this monorepo's own Pages slot already serves the admin
(dash.entuned.co). See `README.md` for the one-time setup Daniel does after
the first workflow run.

Workflow: `.github/workflows/deploy-dashboard.yml`. Triggers on push to main
under `apps/dashboard/**`. Uses the player's deploy pattern as the model.
