// One-shot bump: append NO PRODUCT / RETAIL / BRAND IMAGERY hard
// constraint to the currently-active LyricDraftPrompt + LyricEditPrompt.
//
// Why: live render observation surfaced product/retail imagery creeping
// into verse text — "Shelf in the light, same order", "Shirt still warm",
// "Every seam in place", "Every joint — exactly meant". Bernie wasn't
// passed any apparel context (brandLyricGuidelines was empty, ICP
// psychographic fields don't reach Bernie). The model defaults to
// product-frame imagery on its own when hook tone reads as "describing
// something well-made" — Sonnet's most common training-data association
// is consumer copy. The fix is an explicit forbidden-imagery rule.
//
// The entuned product thesis: in-store music creates ATMOSPHERE that
// reinforces brand identity implicitly. Songs that double as product
// jingles ("look at the seam, feel the fit") fail the brief — they read
// as ads instead of ambient brand voice.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/bump-bernie-no-product-imagery.ts');
//   \""

import { PrismaClient } from '@prisma/client'

const RULE_HEADER = 'NO RETAIL / PRODUCT / BRAND IMAGERY'

const NO_PRODUCT_RULE = `
NO RETAIL / PRODUCT / BRAND IMAGERY — hard constraint:

These lyrics are PLAYED IN STORES. They create atmosphere for the brand's customers. They are NOT advertisements, not product copy, not testimonials. They must NEVER describe the act of shopping, buying, wearing-as-purchase, owning a product, or evaluating a manufactured object.

FORBIDDEN imagery (case-insensitive — applies to morphological variants and direct synonyms):

Apparel: shirt, shirts, dress, dresses, pants, jeans, suit, jacket, coat, sweater, hoodie, sneakers, shoes, boots, hat, scarf, garment, fabric, thread, seam, hem, collar, cuff, sleeve, button, zipper, fit (as in garment fit), fitted, "the right fit".

Other product categories: jewelry, ring, necklace, bracelet, watch, handbag, purse, makeup, lipstick, mascara, perfume, fragrance, packaging, label, the tag, the box.

Retail surfaces: shelf, shelves, the rack, the racks, hanger, hangers, aisle, aisles, register, checkout, fitting room, dressing room, mirror (in a try-on context), store, storefront, window display.

Manufactured-object description: "Every seam in place", "every joint", "every edge", "every corner", "the grain", "the build", "the make", "the craft" used to describe a constructed object's physical merit. "Built right" / "made right" / "stitched right" / "cut right" describing things.

Commerce events: "what you bought", "what you picked up", "what you took home", "rang it up", "in the bag", "in the cart", "off the rack", "off the shelf", "the price", "the tag".

Brand-name namechecking: any reference to the brand, the company, the store, "they made", "their", "ours" (in a product-ownership sense).

Substitution strategy — when the hook implies a tangible thing (e.g., "Built right, feels right"), do NOT write about a manufactured object. Write about a HUMAN MOMENT that has the same emotional register:
- Weather / light: "morning light through the kitchen window", "afternoon heat off the pavement"
- Place: "the porch", "the kitchen", "the road", "the kitchen counter at 6am", "the front step"
- Body / movement: "shoulders dropping", "deep breath in", "feet on cool tile"
- Decision / interior: "the moment of choosing", "the second after deciding", "knowing without checking"
- Relationship: "the look across the table", "the silence between two people who agree"
- Object — non-commercial: a stone, a key, a window, a door, water, a road, a cup of coffee, a worn book, a chair

TEST before finalizing every line: if the listener could imagine this line appearing in a commercial for a product, it has crossed the line — rewrite to a universal human moment that names no product category and no retail context. The brand's character lives in mood, tempo, and the emotional shape of the moment — never in product imagery.
`.trim()

const EDIT_PASS_ADDENDUM = `

When polishing the draft: SCAN every line for FORBIDDEN imagery above. If a line names any apparel item, retail surface, manufactured-object descriptor, or commerce event — REWRITE that line into a universal human moment per the substitution strategy. Do not negotiate or soften — replace entirely. Stage-direction parens, hook-only choruses, and product imagery are the three things the editor is required to fix.`

async function bumpDraft(p: PrismaClient) {
  const latest = await p.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricDraftPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricDraftPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${NO_PRODUCT_RULE}`
  const row = await p.lyricDraftPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append no-product/retail/brand-imagery hard constraint. Lyrics create atmosphere, not product jingles.',
    },
  })
  console.log(`  Inserted LyricDraftPrompt v${row.version} (was v${latest.version}). +${NO_PRODUCT_RULE.length} chars.`)
}

async function bumpEdit(p: PrismaClient) {
  const latest = await p.lyricEditPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) throw new Error('no existing LyricEditPrompt rows; expected at least v1')
  if (latest.promptText.includes(RULE_HEADER)) {
    console.log(`  LyricEditPrompt v${latest.version} already contains the rule — skipping.`)
    return
  }
  const newVersion = latest.version + 1
  const newText = `${latest.promptText}\n\n${NO_PRODUCT_RULE}${EDIT_PASS_ADDENDUM}`
  const row = await p.lyricEditPrompt.create({
    data: {
      version: newVersion,
      promptText: newText,
      notes: 'Append no-product-imagery hard constraint + scan-and-rewrite directive for the edit pass.',
    },
  })
  console.log(`  Inserted LyricEditPrompt v${row.version} (was v${latest.version}). +${(NO_PRODUCT_RULE + EDIT_PASS_ADDENDUM).length} chars.`)
}

async function main() {
  const p = new PrismaClient()
  try {
    console.log('Bumping Bernie prompts with NO PRODUCT / RETAIL / BRAND IMAGERY rule...')
    await bumpDraft(p)
    await bumpEdit(p)
    console.log('Done.')
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
