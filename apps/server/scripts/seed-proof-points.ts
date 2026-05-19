// One-shot seed for the Command Center ProofPoint table.
//
// Run once after the command-center migration lands. Idempotent — uses
// upsert keyed on `label` so re-runs don't duplicate rows.
//
// Usage:
//   cd apps/server && npx tsx scripts/seed-proof-points.ts
//
// Sources are checked into the marketing repo:
//   marketing/COPY/LANGUAGE_INVENTORY.md  (Kari quote, verbatim)
//   marketing/COPY/MENTAL_INVENTORY.md    (Kari context)
//   outreach/podcasts/podcast-target-list.md (add-to-pile customer story)

import { prisma } from '../src/db.js'

interface Seed {
  label: string
  quoteText: string
  attribution: string
  context: string | null
  category: 'testimonial' | 'data_point' | 'staff_quote' | 'customer_quote'
  eventDate: string | null
  tags: string[]
}

const SEEDS: Seed[] = [
  {
    label: 'kari-loop-pain',
    quoteText:
      "we hear the same songs 3 times a day on cloud cover. i'm sick of this shit. you know, some of them are actually good songs, but i've been hearing them on a 4 hour loop for 18 months.",
    attribution: 'Kari S., Assistant Manager (pilot store)',
    context:
      'Pain headline. The phrase "some of them are actually good songs" is what makes it land — she\'s not complaining about the music being bad, she\'s complaining about the loop being short.',
    category: 'staff_quote',
    eventDate: null,
    tags: ['repetition', 'cloud-cover', 'pilot', 'pain'],
  },
  {
    label: 'kari-conversion-lift',
    quoteText:
      'Conversion jumped from 18% to 28% on a day we ran the music in the store. Kari noticed it without knowing what we were testing.',
    attribution: 'Kari S., Assistant Manager (pilot store)',
    context:
      'Single-day uplift observed during a live pilot run. Cited in the Built-For-Retailers + pricing pages. Not a controlled study — anecdotal but staff-corroborated.',
    category: 'data_point',
    eventDate: null,
    tags: ['conversion', 'pilot', 'lift', 'kari'],
  },
  {
    label: 'add-it-to-the-pile',
    quoteText:
      'A customer was singing along to one of our tracks — the chorus says "add it to the pile" — and she grabbed another shirt off the rack and said "this is brilliant." She narrated the mechanism out loud without knowing it existed.',
    attribution: 'Customer at pilot store',
    context:
      'Live semantic-priming moment. The customer enacted the lyric in real time and identified it as the mechanism unprompted. Strongest single piece of evidence for lyric-level behavioral coupling.',
    category: 'customer_quote',
    eventDate: null,
    tags: ['semantic-priming', 'lyrics', 'pilot', 'conversion'],
  },
]

async function main() {
  let created = 0
  let updated = 0
  for (const s of SEEDS) {
    const existing = await prisma.proofPoint.findFirst({ where: { label: s.label } })
    if (existing) {
      await prisma.proofPoint.update({
        where: { id: existing.id },
        data: {
          quoteText: s.quoteText,
          attribution: s.attribution,
          context: s.context,
          category: s.category,
          eventDate: s.eventDate ? new Date(s.eventDate) : null,
          tags: s.tags,
        },
      })
      updated++
    } else {
      await prisma.proofPoint.create({
        data: {
          label: s.label,
          quoteText: s.quoteText,
          attribution: s.attribution,
          context: s.context,
          category: s.category,
          eventDate: s.eventDate ? new Date(s.eventDate) : null,
          tags: s.tags,
        },
      })
      created++
    }
  }
  console.log(`[seed-proof-points] done. created=${created} updated=${updated}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
