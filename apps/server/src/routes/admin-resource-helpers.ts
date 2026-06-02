// Factory helpers for the repetitive admin "Prompts & Rules" CRUD surfaces.
//
// admin.ts had ~9 byte-identical "versioned text row" route pairs (GET latest +
// history, POST a new version) and a forked professor/music-professor module
// CRUD block. These factories collapse that duplication while preserving the
// exact wire behavior (paths, response shapes, error envelopes, version/sortOrder
// math, createdById). See admin-prompt-resources.test.ts for the equivalence gate.
//
// `model` is typed `any` deliberately: Prisma's per-delegate generic method
// signatures don't assign cleanly to a single shared structural interface, and
// admin.ts already constructs `create` data dynamically. Everything else
// (paths, field name, schema) stays strongly typed.

import type { FastifyInstance } from 'fastify'
import type { ZodType } from 'zod'

/** The text column name — identical to the body field key in every resource. */
export type VersionedTextField = 'rulesText' | 'templateText' | 'promptText'

export interface VersionedTextOptions {
  /** GET path (returns latest + history). */
  getPath: string
  /** POST path (creates a new version). Defaults to `getPath`. */
  postPath?: string
  /** Prisma delegate with findMany / aggregate / create. */
  model: any
  /** Body key AND DB column holding the text (they match in every resource). */
  field: VersionedTextField
  /** Zod body schema. Must yield `{ [field]: string; notes?: string | null }`. */
  schema: ZodType<any>
  /** Override the GET response shape (default `{ latest, history }`). */
  wrapGet?: (history: any[]) => unknown
}

/**
 * Register the GET-latest/history + POST-new-version pair for an append-only,
 * version-bumped text row (musicological rules, prompt personas, etc.).
 *
 * Behavior preserved verbatim from the hand-written handlers:
 *   GET  → `{ latest: rows[0] ?? null, history: rows }` (newest first)
 *   POST → validate body → next = (max version ?? 0) + 1 → create with
 *          `{ version, [field], notes: notes ?? null, createdById: op.accountId }`
 *   bad body → 400 `{ error: 'bad_body', details }`
 */
export function registerVersionedText(app: FastifyInstance, opts: VersionedTextOptions): void {
  const postPath = opts.postPath ?? opts.getPath

  app.get(opts.getPath, async () => {
    const all = await opts.model.findMany({ orderBy: { version: 'desc' } })
    return opts.wrapGet ? opts.wrapGet(all) : { latest: all[0] ?? null, history: all }
  })

  app.post(postPath, async (req, reply) => {
    const op = req.operator!
    const parsed = opts.schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await opts.model.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    return opts.model.create({
      data: {
        version: next,
        [opts.field]: (parsed.data as any)[opts.field],
        notes: (parsed.data as any).notes ?? null,
        createdById: op.accountId,
      },
    })
  })
}

export interface ModuleCrudOptions {
  /** Path prefix; routes mount at `${basePath}/modules[/:id]`. */
  basePath: string
  /** Prisma delegate with findMany / aggregate / create / update / delete. */
  model: any
  postSchema: ZodType<any>
  patchSchema: ZodType<any>
  /** Extra create fields beyond `{ name, body, active, sortOrder }` (e.g. `tier`). */
  extraCreate?: (data: any) => Record<string, unknown>
}

/**
 * Register the list / create / patch / delete CRUD for a "curriculum module"
 * list ordered by sortOrder (Professor + Music Professor modules).
 *
 * Behavior preserved verbatim:
 *   GET    → findMany ordered by sortOrder asc
 *   POST   → next sortOrder = body.sortOrder ?? (max sortOrder ?? 0) + 10;
 *            create `{ name, body, active ?? true, sortOrder, ...extraCreate }`
 *   PATCH  → update by id; missing → 404 `{ error: 'not_found' }`
 *   DELETE → delete by id → `{ ok: true }`; missing → 404 `{ error: 'not_found' }`
 *   bad body → 400 `{ error: 'bad_body', details }`
 */
export function registerModuleCrud(app: FastifyInstance, opts: ModuleCrudOptions): void {
  const base = `${opts.basePath}/modules`

  app.get(base, async () => {
    return opts.model.findMany({ orderBy: { sortOrder: 'asc' } })
  })

  app.post(base, async (req, reply) => {
    const parsed = opts.postSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await opts.model.aggregate({ _max: { sortOrder: true } })
    const nextSort = (parsed.data as any).sortOrder ?? ((max._max.sortOrder ?? 0) + 10)
    return opts.model.create({
      data: {
        name: parsed.data.name,
        body: parsed.data.body,
        active: (parsed.data as any).active ?? true,
        sortOrder: nextSort,
        ...(opts.extraCreate?.(parsed.data) ?? {}),
      },
    })
  })

  app.patch(`${base}/:id`, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const parsed = opts.patchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      return await opts.model.update({ where: { id }, data: parsed.data })
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete(`${base}/:id`, async (req, reply) => {
    const id = (req.params as { id: string }).id
    try {
      await opts.model.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })
}
