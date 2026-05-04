# @entuned/dashboard

Customer-facing dashboard for Entuned. Lives at **app.entuned.co**.

Companion to:
- `apps/admin` — operator-facing admin (dash.entuned.co)
- `apps/player` — in-store player (music.entuned.co — actually served via the `entuned-0.3-player` repo)
- `apps/server` — Fastify API on Railway (api.entuned.co)

## Stack

- React 18 + Vite 5, TypeScript strict, ESM
- `react-router-dom` v6 — first v0.3 app to use a router (admin uses state-based nav)
- Auth: session cookies (httpOnly), set by the server's magic-link / Google OAuth handlers
- No CSS framework — inline styles via the `T` design tokens (mirrors `apps/admin/src/tokens.ts`)
- Dev port: **5179** (server 3000, player 5177, admin 5178, dashboard 5179)

## Develop

```bash
pnpm --filter @entuned/dashboard dev
```

Then open http://localhost:5179.

The dashboard talks to whatever URL `VITE_API_URL` points at. Locally that
defaults to `http://localhost:3000` if unset — start the server separately
with `pnpm --filter server dev`.

## Build

```bash
pnpm --filter @entuned/dashboard build
```

Outputs to `apps/dashboard/dist/`.

## Env vars

| Var | Purpose | Example |
| --- | --- | --- |
| `VITE_API_URL` | Fastify server base URL | `http://localhost:3000` (dev) / `https://api.entuned.co` (prod) |

In production the value comes from the GitHub Actions repo variable
`VITE_API_URL` (set under repo Settings -> Secrets and variables -> Actions
-> Variables). Locally, set it in `apps/dashboard/.env` (gitignored) if you
need to override the default.

## Deploy (GitHub Pages -> app.entuned.co)

Custom domain. Built by `.github/workflows/deploy-dashboard.yml` on every
push to `main` that touches `apps/dashboard/**`.

The build artifact is force-pushed to a **separate repo**,
`danielfox296/entuned-0.3-dashboard`, whose GitHub Pages slot serves
app.entuned.co. We cannot host the dashboard from this monorepo's own Pages
slot because it is already in use by the admin (dash.entuned.co) — each
repo can publish only one Pages site.

The custom domain is wired via the `public/CNAME` file (which Vite copies
into `dist/`) plus the GitHub repo's Pages settings. The workflow also
writes `404.html` (a copy of `index.html`) so client-side routing handles
deep links cleanly.

### One-time manual setup (Daniel, after first deploy lands)

1. **Create the publish repo**: create `danielfox296/entuned-0.3-dashboard`
   on GitHub. It can be empty — the workflow force-pushes an orphan branch.

2. **Create the deploy token**: a fine-grained PAT with
   `contents: write` on `entuned-0.3-dashboard`. Save it as the
   `DASHBOARD_DEPLOY_TOKEN` secret in this monorepo (Settings -> Secrets
   and variables -> Actions -> New repository secret).

3. **Confirm `VITE_API_URL`**: ensure the Actions repo variable
   `VITE_API_URL` points at `https://api.entuned.co` for production.

4. **First deploy**: push to `main` (any change under `apps/dashboard/**`)
   or run the workflow manually. The first run creates the Pages site on
   the publish repo.

5. **Set the custom domain**: in `entuned-0.3-dashboard` -> Settings ->
   Pages, under **Custom domain** enter `app.entuned.co` and save. GitHub
   reads the CNAME file and provisions a Let's Encrypt cert.

6. **Enforce HTTPS**: once the cert is provisioned (usually a few minutes,
   sometimes up to ~24 hours), tick **Enforce HTTPS** on the same Pages
   settings page.

7. **DNS**: confirm a `CNAME` record on entuned.co for the `app` subdomain
   pointing at `danielfox296.github.io`. (Already required if anything
   else under entuned.co is on Pages.)
