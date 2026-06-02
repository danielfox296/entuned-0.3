// Uniform HTTP error envelope + tiny throwable error type.
//
// This is the *global safety net* layer. Routes throughout the codebase still
// write their own `reply.code(...).send({ error: '...' })` envelopes by hand,
// and those keep working untouched — the global error handler in `index.ts`
// only catches what propagates as a *throw* (an uncaught exception, a rejected
// promise, a thrown `AppError`, a thrown `ZodError`, a Prisma known error).
//
// The envelope shape is `{ error: <code>, details?: <anything> }`, matching the
// hand-rolled envelopes already in the routes (key is always `error`).

import type { FastifyReply } from 'fastify'

/**
 * A throwable application error carrying an HTTP status + a stable machine code.
 *
 * Throw this from anywhere below a route handler to surface a specific status +
 * code through the global error handler without threading a `reply` down the
 * call stack:
 *
 *   throw new AppError(404, 'store_not_found')
 *   throw new AppError(403, 'forbidden', { reason: 'tier' })
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, details?: unknown) {
    super(code)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Write the uniform error envelope to a Fastify reply.
 *
 * `{ error: code }`, plus `details` only when provided (so existing tests that
 * assert exact envelope shapes without a `details` key keep passing).
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  details?: unknown,
): FastifyReply {
  const body: { error: string; details?: unknown } = { error: code }
  if (details !== undefined) body.details = details
  return reply.code(status).send(body)
}
