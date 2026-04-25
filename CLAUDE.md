# CLAUDE.md — entuned-0.3

Production-seed for entune v0.3. Supersedes Mingus. Greenfield, no Mingus data migration.

## Read first

- `../entune v0.3/system-cards/` — frozen contracts (16 cards)
- `../entune v0.3/schema/` — schema SSOT; Prisma schema must match
- `../entune v0.3/NEXT.md` — current phase + roadmap

## Stack (locked)

- Node 20+, TypeScript strict, ESM
- Fastify (server), Prisma (ORM), Postgres (Railway)
- React + Vite + Howler (player), GitHub Pages
- pnpm workspaces

## Operating rules

- **Push after edits.** Daniel runs everything live.
- **Schema changes:** update `../entune v0.3/schema/` first (the SSOT), then mirror into `apps/server/prisma/schema.prisma`, then `prisma migrate`.
- **Railway deploy:** server only. `cd apps/server && railway up --path-as-root .` (mirror Mingus's monorepo deploy lesson — without `--path-as-root` Railway uploads the whole repo).
- **No Mingus features.** All new music-system work goes here, not in `../mingus/`.

## Phase 0 scope

Flow 3 (playback tick) only. Hendrix endpoint, AudioEvent ingest, override helpers, minimal player. No Eno/Mars/Bernie/Operator Seeding/Duke admin/POS yet.
