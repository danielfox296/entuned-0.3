// v2 vocal triple-stack seed — broader, weirder palette.
//
// v1 was too safe: breathy/warm/silky/smooth/dark appeared in 6+ genres
// (they ARE Suno's centroid). Delivery was polite (behind-the-beat, laid-back
// = table stakes). Effects were standard studio production Suno bakes in anyway.
//
// v2 principles:
//   Character: specific physical textures, not vibes. Remove anything in 4+ genres.
//   Delivery: lean into mumbled/illegible/tossed-off. Cut non-working terms.
//   Effect: only things Suno would NEVER produce unprompted. No compression,
//           reverb, mic choice, stereo width — those are table stakes.

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

const seeds = {
  'hip hop': {
    characters: ['gravelly', 'nasal', 'sandpaper', 'hollow', 'buzzy', 'wiry', 'cracked'],
    deliveries: ['mumbled', 'half-spoken', 'tossed-off', 'sneering', 'slurred', 'rapid-fire', 'barked'],
    effects: ['telephone-filtered', 'bit-crushed', 'chopped and screwed', 'megaphone', 'lo-fi cassette', 'pitch-shifted down', 'overdriven'],
  },
  'indie': {
    characters: ['reedy', 'nasal', 'pinched', 'brittle', 'papery', 'glassy', 'hollow'],
    deliveries: ['mumbled', 'tossed-off', 'sing-spoken', 'swallowed', 'droned', 'slurred', 'staccato'],
    effects: ['telephone-filtered', 'lo-fi cassette', 'bit-crushed', 'slapback echo', 'AM radio', 'spring reverb', 'mono center'],
  },
  'country': {
    characters: ['twangy', 'gravelly', 'weathered', 'cracked', 'honeyed', 'sandpaper', 'woody'],
    deliveries: ['drawled', 'mumbled', 'tossed-off', 'sing-spoken', 'crooned', 'storytelling', 'slurred'],
    effects: ['slapback echo', 'spring reverb', 'lo-fi cassette', 'AM radio', 'telephone-filtered', 'overdriven', 'mono center'],
  },
  'jazz': {
    characters: ['smoky', 'sultry', 'foggy', 'grainy', 'resinous', 'cracked', 'hollow'],
    deliveries: ['mumbled', 'tossed-off', 'crooned', 'sing-spoken', 'swallowed', 'slurred', 'staccato'],
    effects: ['telephone-filtered', 'spring reverb', 'lo-fi cassette', 'slapback echo', 'mono center', 'vinyl-crackle', 'AM radio'],
  },
  'blues': {
    characters: ['gravelly', 'sandpaper', 'weathered', 'cracked', 'gritty', 'raspy', 'foggy'],
    deliveries: ['mumbled', 'slurred', 'barked', 'tossed-off', 'crooned', 'pleading', 'sing-spoken'],
    effects: ['overdriven', 'spring reverb', 'lo-fi cassette', 'AM radio', 'telephone-filtered', 'slapback echo', 'mono center'],
  },
  'soul': {
    characters: ['honeyed', 'grainy', 'resinous', 'cracked', 'metallic', 'foggy', 'velvety'],
    deliveries: ['crooned', 'pleading', 'mumbled', 'tossed-off', 'sing-spoken', 'swallowed', 'slurred'],
    effects: ['spring reverb', 'lo-fi cassette', 'slapback echo', 'vinyl-crackle', 'telephone-filtered', 'mono center', 'overdriven'],
  },
  'folk': {
    characters: ['reedy', 'thin', 'woody', 'papery', 'brittle', 'pinched', 'glassy'],
    deliveries: ['mumbled', 'tossed-off', 'sing-spoken', 'whispered', 'swallowed', 'droned', 'storytelling'],
    effects: ['lo-fi cassette', 'spring reverb', 'AM radio', 'slapback echo', 'mono center', 'telephone-filtered', 'vinyl-crackle'],
  },
  'rock': {
    characters: ['gritty', 'raspy', 'gravelly', 'cracked', 'sandpaper', 'metallic', 'acidic'],
    deliveries: ['barked', 'yelped', 'sneering', 'mumbled', 'tossed-off', 'slurred', 'belted'],
    effects: ['overdriven', 'megaphone', 'slapback echo', 'telephone-filtered', 'spring reverb', 'bit-crushed', 'lo-fi cassette'],
  },
  'electropop': {
    characters: ['glassy', 'metallic', 'brittle', 'pinched', 'hollow', 'buzzy', 'bell-like'],
    deliveries: ['tossed-off', 'droned', 'staccato', 'sing-spoken', 'mumbled', 'whispered', 'detached'],
    effects: ['vocoder', 'bit-crushed', 'pitch-shifted down', 'telephone-filtered', 'talk-box', 'chopped and screwed', 'lo-fi cassette'],
  },
  'ambient': {
    characters: ['ghostly', 'glassy', 'hollow', 'foggy', 'papery', 'bell-like', 'distant'],
    deliveries: ['droned', 'whispered', 'swallowed', 'chanted', 'mumbled', 'sing-spoken', 'detached'],
    effects: ['pitch-shifted down', 'granular', 'underwater', 'vocoder', 'bit-crushed', 'vinyl-crackle', 'lo-fi cassette'],
  },
  'reggaeton': {
    characters: ['nasal', 'gritty', 'buzzy', 'metallic', 'wiry', 'sandpaper'],
    deliveries: ['rapid-fire', 'half-spoken', 'sneering', 'mumbled', 'tossed-off', 'barked'],
    effects: ['telephone-filtered', 'megaphone', 'bit-crushed', 'pitch-shifted down', 'overdriven', 'vocoder'],
  },
  'gospel': {
    characters: ['thunderous', 'cracked', 'honeyed', 'gravelly', 'resinous', 'metallic', 'bell-like'],
    deliveries: ['belted', 'pleading', 'chanted', 'crooned', 'yelped', 'sing-spoken', 'barked'],
    effects: ['spring reverb', 'slapback echo', 'overdriven', 'mono center', 'megaphone', 'AM radio', 'lo-fi cassette'],
  },
  'funk': {
    characters: ['nasal', 'wiry', 'buzzy', 'acidic', 'gritty', 'sandpaper'],
    deliveries: ['barked', 'half-spoken', 'tossed-off', 'sneering', 'mumbled', 'rapid-fire', 'yelped'],
    effects: ['talk-box', 'megaphone', 'overdriven', 'slapback echo', 'telephone-filtered', 'spring reverb', 'bit-crushed'],
  },
  'soft rock': {
    characters: ['honeyed', 'woody', 'foggy', 'papery', 'glassy', 'resinous', 'cracked'],
    deliveries: ['crooned', 'mumbled', 'tossed-off', 'sing-spoken', 'swallowed', 'slurred', 'whispered'],
    effects: ['spring reverb', 'slapback echo', 'lo-fi cassette', 'vinyl-crackle', 'AM radio', 'mono center', 'telephone-filtered'],
  },
  'smooth jazz': {
    characters: ['smoky', 'honeyed', 'foggy', 'resinous', 'grainy', 'glassy'],
    deliveries: ['crooned', 'mumbled', 'tossed-off', 'sing-spoken', 'swallowed', 'slurred'],
    effects: ['spring reverb', 'vinyl-crackle', 'slapback echo', 'lo-fi cassette', 'AM radio', 'mono center'],
  },
  'edm': {
    characters: ['glassy', 'metallic', 'buzzy', 'hollow', 'bell-like', 'brittle'],
    deliveries: ['chanted', 'droned', 'staccato', 'tossed-off', 'mumbled', 'sing-spoken'],
    effects: ['vocoder', 'bit-crushed', 'pitch-shifted down', 'chopped and screwed', 'talk-box', 'telephone-filtered', 'granular'],
  },
}

async function main() {
  const rules = await p.genreGravityRule.findMany({
    where: { active: true },
    select: { id: true, tag: true },
  })
  let updated = 0
  for (const rule of rules) {
    const seed = seeds[rule.tag]
    if (!seed) {
      console.log('SKIP (no seed):', rule.tag)
      continue
    }
    await p.$executeRawUnsafe(
      `UPDATE genre_gravity_rules
       SET vocal_characters = $1::text[],
           vocal_deliveries = $2::text[],
           vocal_effects = $3::text[]
       WHERE id = $4::uuid`,
      seed.characters,
      seed.deliveries,
      seed.effects,
      rule.id,
    )
    const combos = seed.characters.length * seed.deliveries.length * seed.effects.length
    console.log('SEEDED:', rule.tag, '|', seed.characters.length, 'C x', seed.deliveries.length, 'D x', seed.effects.length, 'E =', combos, 'combos')
    updated++
  }
  console.log('\nDone:', updated, 'rules updated')

  // Print unique terms across all genres for audit
  const allC = new Set(), allD = new Set(), allE = new Set()
  for (const s of Object.values(seeds)) {
    s.characters.forEach(t => allC.add(t))
    s.deliveries.forEach(t => allD.add(t))
    s.effects.forEach(t => allE.add(t))
  }
  console.log('\nUnique characters (' + allC.size + '):', [...allC].sort().join(', '))
  console.log('\nUnique deliveries (' + allD.size + '):', [...allD].sort().join(', '))
  console.log('\nUnique effects (' + allE.size + '):', [...allE].sort().join(', '))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
