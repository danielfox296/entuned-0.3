# CLAUDE.md — entuned-0.3 admin

Operator-facing admin shell for entune v0.3. Separate Vite app from `apps/player`, separate deploy target.

## Read first

- `../../../entune v0.3/entuned-admin-ui.md` — the 8 surface groups (Seeding, Playback, Brand, Schedule, Catalogue, Experiments, Hypotheses, Monitoring) and the sub-panel cards inside each. The sidebar maps 1:1 to this spec.
- `../../../entune v0.3/system-cards/` — frozen contracts. Panel behavior must match.
- `../server/src/index.ts` — auth lives here (`/auth/login`, `/auth/me`). Same JWT system as the player.

## Stack

- React 18 + Vite 5 + TS strict, ESM
- Port **5178** (player is 5177, server is 3000)
- Talks to Railway server via `VITE_API_URL` (set in `apps/admin/.env`)
- Auth: Bearer JWT, same operator table as the player

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **No router library.** Navigation is state-based via the sidebar (`active` state in `App.tsx`). Deliberate — do not add `react-router` or similar.
- **No CSS frameworks or component libraries.** Styling is inline via the `T` design tokens object in `App.tsx`. No Tailwind, no shadcn, no MUI.
- **Don't restructure the shell.** `App.tsx` (login, sidebar, status bar, panel routing) is intentional. Build new panel components and slot them in; don't rewrite the shell.

## Building a panel

Each surface group in the sidebar shows placeholder sub-cards labeled "ready for build →". To build a panel:

1. Read the matching section of `entuned-admin-ui.md` for that group.
2. Add the corresponding Fastify route in `apps/server/src/` (or use an existing one).
3. Uncomment the matching API method in `apps/admin/src/api.ts` (admin-specific routes are commented out until their server side exists).
4. Create the panel component in `apps/admin/src/panels/<group>/<Card>.tsx`.
5. Replace the placeholder card in `App.tsx`'s `PanelShell` with the real component for that group.

## Known gaps

- **No logout button yet.** A `handleLogout` placeholder was removed during shell setup to satisfy `noUnusedLocals`. When the shell gets a logout affordance, re-add it: `clearToken(); setTokenState(null); setMe(null)`.
- **Experiments / Hypotheses / Monitoring** are deferred groups — sidebar entries exist but Phase 0 doesn't ship those panels.

## Deploy

GitHub Pages, combined artifact with the player.

- Workflow: `.github/workflows/pages.yml` (builds both `player` and `admin`, stitches into one upload).
- URLs: player at `https://danielfox296.github.io/entuned-0.3/`, admin at `https://danielfox296.github.io/entuned-0.3/admin/`.
- `VITE_API_URL` is set as a GitHub Actions repository variable, not in `.env` (which is local-only).
- Vite `base: './'` keeps assets relative — works at any subpath.
