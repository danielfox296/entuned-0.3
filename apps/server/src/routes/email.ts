// Public email routes — currently just the unsubscribe endpoint.
//
// One-click unsub from lifecycle / behavioral mail. Token is a JWT signed
// with JWT_SECRET, embedded in every drip's footer link. No expiry — old
// emails should keep working as opt-out triggers indefinitely.

import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../db.js'
import { verifyUnsubToken } from '../lib/email.js'

export const emailRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { token?: string } }>('/unsubscribe', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.code(400).type('text/html').send(htmlPage('Missing token.', false))
    const userId = verifyUnsubToken(token)
    if (!userId) return reply.code(400).type('text/html').send(htmlPage('That link isn’t valid anymore.', false))

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    if (!user) return reply.code(404).type('text/html').send(htmlPage('Account not found.', false))

    await prisma.user.update({
      where: { id: user.id },
      data: { lifecycleEmailsOptOut: true },
    })

    return reply.type('text/html').send(htmlPage(
      `You’re unsubscribed from product nudges. Sign-in links, billing notices, and account mail will keep working.`,
      true,
    ))
  })
}

function htmlPage(message: string, success: boolean): string {
  const accent = '#d7af74'
  const bg = '#0a0a0a'
  const text = '#E8E4DE'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Entuned</title>
</head>
<body style="margin:0;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:80px auto;padding:32px;border:1px solid #222;background:#111;">
<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${accent};font-weight:600;margin-bottom:18px;">Entuned</div>
<p style="margin:0 0 14px 0;font-size:18px;font-weight:600;">${success ? 'Done.' : 'Couldn’t process that.'}</p>
<p style="margin:0;font-size:15px;line-height:1.55;color:#cfc9bf;">${message}</p>
</div>
</body>
</html>`
}
