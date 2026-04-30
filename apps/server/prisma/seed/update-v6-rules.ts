import { PrismaClient } from '@prisma/client'
import { MUSICOLOGICAL_RULES_V6 } from '../../src/lib/decomposer/rules-v6.js'

;(async () => {
  const p = new PrismaClient()
  const r = await p.styleAnalyzerInstructions.update({
    where: { version: 6 },
    data: { rulesText: MUSICOLOGICAL_RULES_V6, notes: 'v6 — strengthened arrangement_sections is OBJECT' },
  })
  console.log('Updated v6 rules row, length=', r.rulesText.length)
  await p.$disconnect()
})()
