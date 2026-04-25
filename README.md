# entuned-0.3

Production-seed implementation of the entune v0.3 system-cards + schema design. Supersedes Mingus.

## Layout

- `apps/server/` — Node 20 + TypeScript + Fastify + Prisma. REST API + (eventually) MCP server. Deployed to Railway.
- `apps/player/` — React + Vite + Howler. In-store player ("Oscar"). Deployed to GitHub Pages.

## Phase 0 — Flow 3 vertical slice

Playback tick: Hendrix endpoint resolves outcome, filters song pool, applies rotation rules, returns 3-song queue. Player pulls the queue, plays audio, emits events to the audio event stream.

Subsequent phases layer on Eno (generation), Mars/Bernie (style + lyrics), Operator Seeding, Duke admin, POS Ingestion.

## Source of truth

- System cards: `../entune v0.3/system-cards/`
- Schema spec: `../entune v0.3/schema/` (translated into `apps/server/prisma/schema.prisma`)
- Roadmap: `../entune v0.3/NEXT.md`
