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

## Editable text content (YAML)

User-visible copy lives in `src/content/<route>.yaml`, mirroring the
brand site (`bowie`) pattern. Components import the YAML directly:

```ts
import content from '../content/welcome.yaml'
// ...
<Headline>{content.pending.headline}</Headline>
```

To change copy, edit the YAML — Vite HMR refreshes the page instantly
in dev. Production picks it up on the next `vite build` (runs in CI).

Wired via `@modyfi/vite-plugin-yaml` in `vite.config.ts`. Type shim for
`*.yaml` imports lives in `src/vite-env.d.ts`.

**Currently YAML-ified:** all routes. `Welcome`, `Start`, `Home`,
`Account`, `Locations`, `IcpIntake`, `Schedule`, `Reports`, `Integrations`.
When adding a new route, create `src/content/<route>.yaml` alongside it.

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

## Load-bearing rules

Rules that have bitten in the past and aren't enforceable by types or tests.

- **App-created ICPs are first-class.** When a customer completes intake at `/intake`, the resulting ICP starts with empty `ReferenceTrack` / `Hook` / voice-note rows. **This is not a gap.** The `run-pipeline` skill is the automation that fills them — kicked off automatically after intake / on operator request from Dash. Don't gate any dashboard flow on these rows being non-empty, and don't add a "your library is incomplete" warning for an ICP that's just waiting on pipeline output. The intake → pipeline → playback handoff is the whole point of this surface.
- **v1.5 intake + locations is shipped — don't re-design.** Intake persistence, add-location, rename, and mixed-tier cleanup all landed. If a task touches `/intake`, `/locations`, or the location-rename flow, read the v1.5 handoff entry in `MEMORY.md` (or ask Daniel) before refactoring — the current shape is intentional.
- **Pricing CTA topology is locked.** Entuned Free → `app.entuned.co/start`. Boost / Pro → direct Stripe checkout (not via this app). Enterprise → contact form. **The asymmetry is intentional** — don't unify the CTAs or add a "select tier" step inside the dashboard. The brand site (`entuned.co`) owns the entry funnel; this app owns post-signup.
- **Tier display in customer copy:** `'free'` → "Entuned Free", `'core'` → "Boost", `'pro'` → "Pro". DB values and API params are unchanged. Customers see these labels everywhere — never reintroduce "Essentials" or "Core" in YAML content, billing copy, or account-page strings.
- **No "zones".** Not a product concept; don't reference it in any dashboard label, tooltip, or YAML content.
- **No "day-parting"** except in the explainer phrase "like day-parting, but better". Use **"Outcome Scheduling"** in customer copy.
- **No fake or estimated metrics on `/reports`.** Customer-facing dashboards must only show numbers derivable from real logged events. If you can't compute it honestly, drop the panel.

## Deploy

GitHub Pages **on a separate publish repo** (`danielfox296/entuned-0.3-dashboard`),
because this monorepo's own Pages slot already serves the admin
(dash.entuned.co). See `README.md` for the one-time setup Daniel does after
the first workflow run.

Workflow: `.github/workflows/deploy-dashboard.yml`. Triggers on push to main
under `apps/dashboard/**`. Uses the player's deploy pattern as the model.
