import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify'
import { z, ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError, sendError } from './http-errors.js'

// Build a tiny Fastify instance that mirrors the global error handler +
// not-found handler registered in `index.ts`. We can't import `index.ts`
// directly (it boots crons, registers every route, and calls `app.listen`),
// so the handler logic is reproduced here against the same helpers. The
// assertions pin the envelope shape every route relies on.
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, 400, 'bad_body', error.flatten())
    }
    if (error instanceof AppError) {
      return sendError(reply, error.status, error.code, error.details)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return sendError(reply, 404, 'not_found')
      if (error.code === 'P2002') return sendError(reply, 409, 'duplicate')
    }
    if (error.validation) {
      return sendError(reply, 400, 'bad_body', error.validation)
    }
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      return sendError(reply, status, error.code ?? 'bad_request')
    }
    request.log.error({ err: error }, 'unhandled_error')
    return sendError(reply, 500, 'internal')
  })

  app.setNotFoundHandler((_request, reply) => {
    return sendError(reply, 404, 'not_found')
  })

  // Routes that throw each error kind, so we exercise the handler end-to-end.
  app.get('/zod', () => {
    z.object({ name: z.string() }).parse({ name: 123 })
  })
  app.get('/app-error', () => {
    throw new AppError(403, 'forbidden', { reason: 'tier' })
  })
  app.get('/app-error-no-details', () => {
    throw new AppError(404, 'store_not_found')
  })
  app.get('/p2025', () => {
    throw new Prisma.PrismaClientKnownRequestError('record not found', {
      code: 'P2025',
      clientVersion: 'test',
    })
  })
  app.get('/p2002', () => {
    throw new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
    })
  })
  app.get('/boom', () => {
    throw new Error('super secret internal detail: DB password is hunter2')
  })

  await app.ready()
  return app
}

describe('global error handler', () => {
  it('maps a thrown ZodError to 400 bad_body with flattened details', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/zod' })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toBe('bad_body')
    expect(body.details).toBeDefined()
    // flatten() shape: { formErrors, fieldErrors }
    expect(body.details.fieldErrors).toBeDefined()
  })

  it('maps an AppError to its own status + code + details', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/app-error' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden', details: { reason: 'tier' } })
  })

  it('omits details when AppError has none', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/app-error-no-details' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'store_not_found' })
  })

  it('maps Prisma P2025 to 404 not_found', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/p2025' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
  })

  it('maps Prisma P2002 to 409 duplicate', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/p2002' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'duplicate' })
  })

  it('maps an unknown throw to 500 internal and does not leak internals', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal' })
    // The real error message must never reach the client.
    expect(res.payload).not.toContain('hunter2')
    expect(res.payload).not.toContain('super secret')
  })

  it('returns 404 not_found for unmatched routes', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/no-such-route' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
  })
})

describe('sendError', () => {
  it('writes only { error } when no details given', async () => {
    const app = Fastify({ logger: false })
    app.get('/x', (_req, reply) => sendError(reply, 422, 'unprocessable'))
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: 'unprocessable' })
  })

  it('includes details when provided', async () => {
    const app = Fastify({ logger: false })
    app.get('/x', (_req, reply) => sendError(reply, 400, 'bad', { field: 'name' }))
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/x' })
    expect(res.json()).toEqual({ error: 'bad', details: { field: 'name' } })
  })
})
