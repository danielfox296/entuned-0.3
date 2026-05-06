# CLAUDE.md — entuned-0.3

Production monorepo. 4 apps: `apps/server` (Fastify + Prisma) → `api.entuned.co` on Railway · `apps/player` → `music.entuned.co` (in-browser, React + Vite + Howler) · `apps/admin` (Dash) → `dash.entuned.co` · `apps/dashboard` (customer self-serve) → `app.entuned.co`.

## Read first

- `../entune v0.3/system-cards/` — frozen contracts
- `../entune v0.3/schema/` — schema SSOT; Prisma schema must match
- `../entune v0.3/OPEN_QUESTIONS.md` — open questions sweep
- `../product-spec/SSOT.md` — current architecture overview
- `../GENERATION.md` — generation pipeline (Hook × Outcome × ReferenceTrack, 3-lane Stage 4)
- `RUNBOOKS.md` — operator runbooks for end-to-end flows
- `NAMES.md` — canonical model/route names (always check before referencing legacy names)

## Stack (locked)

- Node 20+, TypeScript strict, ESM
- Fastify (server), Prisma (ORM), Postgres (Railway)
- React + Vite + Howler (player), GitHub Pages
- pnpm workspaces
- Cloudflare R2 for audio storage

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **Schema changes:** update `../entune v0.3/schema/` first (the SSOT), then mirror into `apps/server/prisma/schema.prisma`, then `prisma migrate`.
- **Railway deploy:** server only. `railway up` from the **monorepo root** (`entuned-0.3/`). The Railway service has Root Directory=`apps/server` set in the dashboard, so the upload must contain that path. Do NOT use `--path-as-root` — that flag conflicts with the dashboard's Root Directory setting and breaks the build.
- **Customer dashboard deploys to a separate publish repo** (`danielfox296/entuned-0.3-dashboard`). Workflow: `.github/workflows/deploy-dashboard.yml`.
- **Cloudflare DNS for app subdomains MUST be DNS-only (gray cloud)** — Railway and GitHub Pages terminate SSL themselves.
