# CLAUDE.md — entuned-0.3 player

In-store player ("Oscar"). React 18 + Vite 5 + Howler + TS strict, ESM. Deploys to GitHub Pages at `music.entuned.co`. Runs on tablet, phone, and desktop in-shop.

## Read first

- `../../CLAUDE.md` — monorepo rules (deploy, tests, verification auth)
- `../admin/CLAUDE.md` — design-token convention and no-CSS-framework rule are the same here
- `../server/src/routes/hendrix.ts` — the only API surface this app calls in steady state

## Stack

- React 18 + Vite 5 + TS strict, ESM
- Howler for audio
- Service worker (`src/sw.ts`) for PWA installability
- Port **5177** (server 3000, admin 5178, dashboard 5179)
- Talks to Railway server via `VITE_API_URL`

## Auth

- **Bearer JWT, same operator table as admin.** Login at `/auth/login`.
- **`localStorage` key is `entuned.admin.token` — shared with admin.** Don't rename. If you set the key from a `/dev-login` flow, use that exact name.

## Verification — adaptive

The player ships on tablets, phones, and shop desktops. Any visual change has to be verified at all three viewports **and** in both the prompt-screen and active-player states:

| Viewport | Width | Why |
|---|---|---|
| Phone | ~390 | iPhone / shop-staff phone |
| Tablet | ~768 | Primary deploy target — in-shop iPad |
| Desktop | ~1280 | Operator browser preview |

Use `preview_resize` between states and `preview_snapshot` / `preview_screenshot` to verify both empty-prompt and mid-playback layouts. A visual fix that works on desktop but breaks on tablet is a regression.

## Visual judgement

When Daniel gives a vague brief like "tighten the spacing" or "the title feels off" — that's full delegation. Ship one coherent pass and verify across the three viewports above. Don't ping back with three options; pick one, ship it, show proof.

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **No CSS frameworks, no component libraries.** Inline styles via design tokens. Mirror admin's conventions.
- **No router library.** Screen state is in `App.tsx`. Two screens: `LoginScreen`, `PlayerScreen`.
- **Service worker:** if you touch `sw.ts`, bump the cache version or installed players will serve stale JS.

## Deploy

GitHub Pages, **combined artifact with admin**. Workflow `.github/workflows/pages.yml` builds both `player` and `admin` and stitches one upload — player at site root, admin at `/admin/`. Vite `base: './'` keeps assets relative.

`VITE_API_URL` is a GitHub Actions repo variable (not `.env`, which is local-only).
