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
- `TESTING.md` — test conventions, mocking patterns, CI gate. **Read before adding any feature, fix, or refactor in `apps/server` or `packages/`.**

## Stack (locked)

- Node 20+, TypeScript strict, ESM
- Fastify (server), Prisma (ORM), Postgres (Railway)
- React + Vite + Howler (player), GitHub Pages
- pnpm workspaces
- Cloudflare R2 for audio storage

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **All new code in `apps/server/` and `packages/` ships with tests in the same PR.** Bug fixes ship with a test that failed before the fix. Cleanup/refactor PRs ship with regression tests proving behavior equivalence. Frontend component tests are out of scope by current policy. See `TESTING.md`.
- **Tests gate every production deploy.** Railway and both Pages workflows run `pnpm test`; if anything fails, no new deploy is promoted. There is no skip flag — if the gate blocks you, fix or revert.
- **Schema changes:** update `../entune v0.3/schema/` first (the SSOT), then mirror into `apps/server/prisma/schema.prisma`, then `prisma migrate`.
- **Railway deploy:** server only. `railway up` from the **monorepo root** (`entuned-0.3/`). The Railway service has Root Directory=`apps/server` set in the dashboard, so the upload must contain that path. Do NOT use `--path-as-root` — that flag conflicts with the dashboard's Root Directory setting and breaks the build.
- **Customer dashboard deploys to a separate publish repo** (`danielfox296/entuned-0.3-dashboard`). Workflow: `.github/workflows/deploy-dashboard.yml`.
- **Cloudflare DNS for app subdomains MUST be DNS-only (gray cloud)** — Railway and GitHub Pages terminate SSL themselves.

## Verification auth (for Claude Code)

When verifying admin/player/dashboard flows via `preview_*` tools, do NOT stop at the login screen. The `POST /dev-login` route (`apps/server/src/routes/dev-login.ts`) exists for this. Flow:

1. **One-time setup (Daniel):** `DEV_LOGIN_TOKEN` is set in `apps/server/.env` (see `.env.example`). If unset, the route 404s and this flow won't work — ask Daniel before doing anything else.
2. **Spin up local server + admin (admin variant points API at localhost):**
   ```
   preview_start("entuned-0.3-server")        # port 3000, reads apps/server/.env
   preview_start("entuned-0.3-admin-local")   # port 5178, VITE_API_URL=http://localhost:3000
   ```
   `entuned-0.3-admin-local` exists specifically to override the prod `.env.local` baseURL. Don't use plain `entuned-0.3-admin` for verification — it talks to prod.
3. **Read the token:** `grep '^DEV_LOGIN_TOKEN=' apps/server/.env | cut -d= -f2`
4. **Mint a Bearer JWT:**
   ```
   curl -s -X POST http://localhost:3000/dev-login \
     -H 'content-type: application/json' \
     -d '{"token":"<TOKEN>","email":"daniel@entuned.co","mode":"bearer"}'
   ```
   Returns `{ token, account }`.
5. **Inject + reload** via `preview_eval`:
   ```js
   localStorage.setItem('entuned.admin.token', '<bearer>')
   location.reload()
   ```
   The admin's storage key is `entuned.admin.token`. The player uses the same key. The customer dashboard uses cookie sessions — call `/dev-login` with `mode:'cookie'` and the cookie will be set on the response (use `-c jar` via curl or pass through fetch with credentials).
6. **Verify.** The local server connects to the prod Railway DB (no separate dev DB), so write actions hit real data. For read-only flows this is fine. For write tests, scope to a designated test ICP/Store or restrict to the just-created records you intend to mutate. Surface the risk to Daniel before mutating shared records.

If `DEV_LOGIN_TOKEN` isn't set, say so explicitly and ask Daniel to provision one (e.g. `openssl rand -hex 32` into `apps/server/.env`). Don't silently fall back to "you'll need to log in manually."
