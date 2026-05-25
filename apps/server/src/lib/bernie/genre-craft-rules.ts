// Genre-conditioned lyric craft rules for Bernie-v2.
//
// Maps genre families to lyric craft overrides that supersede the default
// pop structural guidance in the draft prompt. Unknown genres return null →
// Bernie falls back to the pop defaults from the system prompt.
//
// DB-backed via the `genre_craft_rules` table. Operators edit live in
// Dash → Prompts & Rules → Genre Craft Rules. The const seed below is
// bootstrap-only — it populates the table on cold-start (first deploy / fresh
// dev DB) and is never consulted at runtime once rows exist.
//
// Migrated from a hardcoded `GENRE_FAMILIES` array on 2026-05-25 per the
// no-prompt-content-in-code rule (see apps/server/CLAUDE.md Load-bearing rules).

import { prisma } from '../../db.js'

export interface GenreCraftOverrides {
  familyName: string
  densityGuidance: string
  rhymeGuidance: string
  lineStructureGuidance: string
  voiceGuidance: string
  typographyGuidance: string
}

interface SeedFamily {
  tags: string[]
  overrides: GenreCraftOverrides
}

// Cold-start seed only. Live data is in `genre_craft_rules`; edit there.
export const GENRE_FAMILIES_SEED: SeedFamily[] = [
  {
    tags: [
      'hip-hop', 'hip hop', 'rap', 'trap', 'boom-bap', 'boom bap',
      'drill', 'grime', 'crunk', 'g-funk', 'lo-fi hip-hop', 'conscious rap',
      'gangsta rap', 'mumble rap', 'cloud rap', 'emo rap', 'jazz rap',
      'alternative hip-hop', 'southern hip-hop', 'west coast hip-hop',
      'east coast hip-hop',
    ],
    overrides: {
      familyName: 'hip-hop',
      densityGuidance: `Dense bars. Hip-hop verses are word-heavy — pack syllables, stack internal rhymes, use enjambment. Choruses can be sparser and more chantable, but verses should feel full. Do NOT thin out the writing to match pop density.`,
      rhymeGuidance: `Rhyme schemes for hip-hop:
- Verse: dense internal rhyme + end rhyme. Multisyllabic rhymes are the mark of craft (e.g., "decorated" / "never faded"). Slant rhymes, assonance chains, and consonance clusters are all valid.
- Chorus/hook: simpler, more repetitive — designed to be shouted/chanted. AABB or call-response.
- Bridge/breakdown: shift flow — halftime, double-time, or stripped.
- Avoid nursery-rhyme couplets. If the rhyme sounds like it belongs in a children's book, rewrite it.`,
      lineStructureGuidance: `Verses are typically 8 or 16 bars. A "bar" is one line — not two. Lines can be long; flow is more important than visual tidiness. Odd line counts are normal. Chorus can be 4-8 lines. The hook lands harder when it's short.`,
      voiceGuidance: `Hip-hop is declarative, narrative, or observational. Braggadocio, storytelling, street reportage, and introspection are all valid registers. Don't sand down the voice to be "conversational and warm" — match the energy of the genre. Concrete specifics over abstract feelings. Brand alignment comes from imagery and stance, not politeness.`,
      typographyGuidance: `Performance typography for hip-hop:
- Parentheses = ad-libs or background vocals: "(yeah)", "(uh)", "(let's go)". Use sparingly — 1-3 per verse max.
- ALL CAPS = emphasis on a punchline word or phrase. Land it on the bar that earns it.
- Em dash "—" = flow break or beat pause.
- Avoid ellipsis — hip-hop doesn't hesitate, it lands or pivots.`,
    },
  },
  {
    tags: [
      'country', 'americana', 'alt-country', 'country rock', 'outlaw country',
      'country pop', 'bro-country', 'bluegrass', 'honky-tonk', 'western swing',
      'red dirt', 'texas country', 'country folk', 'southern rock',
    ],
    overrides: {
      familyName: 'country',
      densityGuidance: `Medium density. Country verses tell a story — they need enough lines to set a scene, but each line should pull its weight. No filler. Choruses are tighter, built around the hook as a thesis statement. Bridges pivot the perspective or reveal the turn.`,
      rhymeGuidance: `Rhyme schemes for country:
- Verse (storytelling): ABAB or ABCB — forward narrative motion. Masculine endings (stressed final syllable) on the rhyming lines.
- Chorus: AABB or ABAB — the hook phrase anchors every pass.
- Bridge: contrast scheme — if verses are ABAB, bridge might be AABB or free.
- Country rewards perfect rhymes on strong words. Slant rhymes work in verses but choruses want clean landings.`,
      lineStructureGuidance: `Even line counts (4 or 8 per section). Country is structured — the form is part of the tradition. Lines are medium-length; long enough to tell a story beat, short enough to sing clean. Avoid run-on lines.`,
      voiceGuidance: `Conversational storytelling. The singer is talking to someone — a lover, a bartender, themselves in the rearview mirror. Concrete imagery: truck beds, screen doors, two-lane highways at dusk, Friday nights. Specific places and objects, not abstract emotions. The brand message lives inside the story, never as a thesis statement.`,
      typographyGuidance: `Performance typography for country:
- Parentheses = harmony vocal or call-back: "(mmhmm)", "(that's right)". Very sparse.
- Em dash = conversational pause, like trailing off mid-thought.
- Ellipsis = rare, only for a genuine trailing-off moment.
- ALL CAPS = almost never. Country understatement > shouting.`,
    },
  },
  {
    tags: [
      'edm', 'electronic', 'house', 'deep house', 'tech house',
      'progressive house', 'electro', 'techno', 'trance', 'dubstep',
      'drum and bass', 'drum & bass', 'dnb', 'future bass', 'tropical house',
      'dance', 'dance-pop', 'electropop', 'synthwave', 'synthpop',
      'electronica', 'ambient', 'idm', 'garage',
    ],
    overrides: {
      familyName: 'edm',
      densityGuidance: `Minimal lyrics. EDM tracks are production-driven — lyrics exist as texture, not narrative. Short phrases, repeated. A full verse might be 2-4 lines. The hook is everything; verses are brief emotional setup. Do NOT write dense storytelling — it will fight the production.`,
      rhymeGuidance: `Rhyme in EDM is secondary to rhythm and repetition:
- Chorus/hook: repetitive, chantable. Same phrase structure each time. AABB or mono-rhyme.
- Verse (if present): loose rhyme, 2-4 lines max. Serves as a breath before the drop.
- No complex rhyme schemes. The simpler and more hypnotic, the better.`,
      lineStructureGuidance: `Short sections. Chorus: 2-4 lines, heavily repeated. Verse: 2-4 lines. Bridge/breakdown: 1-2 lines or wordless. The lyric footprint is small — leave room for the production to breathe. Repetition is a feature, not a flaw.`,
      voiceGuidance: `Anthemic, euphoric, or trance-like. The voice is not a storyteller — it's a feeling-carrier. Simple, universal emotions: freedom, release, togetherness, the night. One core image or phrase per section. Don't try to be clever or narrative; be direct and hypnotic.`,
      typographyGuidance: `Performance typography for EDM:
- Parentheses = vocal chops or echoed fragments: "(oh-oh)", "(hey)".
- ALL CAPS = the drop moment or peak phrase.
- Blank lines within sections = space for builds and drops.
- Ellipsis = vocal fade or filter sweep moment.`,
    },
  },
  {
    tags: [
      'r&b', 'rnb', 'neo-soul', 'neo soul', 'soul', 'contemporary r&b',
      'alternative r&b', 'quiet storm', 'new jack swing', 'funk',
      'motown', 'philly soul', 'psychedelic soul', 'gospel',
    ],
    overrides: {
      familyName: 'r&b',
      densityGuidance: `Medium-to-full density with breathing room. R&B lyrics are emotionally direct but leave space for vocal runs and melisma. Lines should be singable with room to stretch syllables. Don't pack so tight that the vocalist can't interpret — but don't go sparse either.`,
      rhymeGuidance: `Rhyme schemes for R&B:
- Verse: ABAB or ABCB with feminine endings (unstressed final syllable) to create flow. Internal rhyme and assonance chains add smoothness.
- Chorus: AABB or ABAB — the hook repeats with slight melodic variation.
- Bridge: break the established scheme — surprise the ear.
- Slant rhymes and near-rhymes feel more natural than forced perfect rhymes.`,
      lineStructureGuidance: `Medium-length lines — long enough for a vocal phrase, short enough that the singer can add runs and ad-libs. 4-6 lines per section. Odd line counts are fine when the extra line is a vocal tag or repeated hook fragment.`,
      voiceGuidance: `Emotionally direct. R&B doesn't hide behind metaphor — it says what it feels. Vulnerability, desire, confidence, heartbreak — stated plainly with sensory detail. "I" and "you" are the pronouns. The brand message lives in the emotional stance, not in clever wordplay.`,
      typographyGuidance: `Performance typography for R&B:
- Parentheses = ad-libs, vocal runs, backing responses: "(ooh)", "(baby)", "(yeah yeah)".
- Em dash = vocal pause for emphasis.
- Ellipsis = vocal slowdown, stretching a syllable.
- ALL CAPS = rare, only on a belt-it-out climax line.`,
    },
  },
  {
    tags: [
      'latin', 'reggaeton', 'latin pop', 'latin trap', 'dembow',
      'bachata', 'salsa', 'merengue', 'cumbia', 'urbano',
      'latin urban', 'tropical', 'bossa nova', 'samba', 'afrobeats',
    ],
    overrides: {
      familyName: 'latin',
      densityGuidance: `Medium density, rhythm-first. Every syllable should land on or between beats — the rhythmic placement of words matters more than their literary weight. Choruses are repetitive and chantable. Verses can be denser but must stay danceable when sung.`,
      rhymeGuidance: `Rhyme for Latin genres:
- Verse: AABB or ABAB. Clean end-rhymes — the rhythmic landing needs to be crisp.
- Chorus: repetitive, often mono-rhyme or AABB. The hook phrase repeats with rhythmic emphasis.
- Assonance (vowel-matching) is as important as consonant rhyme in these genres.
- Bridge: flow change — halftime, double-time, or spoken-word break.`,
      lineStructureGuidance: `Lines are short-to-medium. 4-8 lines per section. Syllable count per line should be consistent within a section — rhythmic regularity is critical. The music is danceable; the lyrics must be too.`,
      voiceGuidance: `Confident, sensual, or celebratory. The voice moves between intimate and anthemic. Concrete sensory detail — heat, motion, bodies, night, rhythm. The brand lives in the energy and confidence, not in explicit messaging.`,
      typographyGuidance: `Performance typography for Latin genres:
- Parentheses = ad-libs, shout-outs, or crowd calls: "(dale)", "(ey)".
- ALL CAPS = hype moments or crowd-chant lines.
- No ellipsis — Latin genres don't hesitate.
- Em dash = beat accent or rhythmic break.`,
    },
  },
]

function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9&\s-]/g, '').trim()
}

interface ActiveRuleRow {
  familyName: string
  tags: string[]
  densityGuidance: string
  rhymeGuidance: string
  lineStructureGuidance: string
  voiceGuidance: string
  typographyGuidance: string
}

/** One-shot cold-start: if `genre_craft_rules` is empty, seed it from
 *  GENRE_FAMILIES_SEED. Idempotent — runs at most once per process. */
let seedAttempted = false
async function seedIfEmpty(): Promise<void> {
  if (seedAttempted) return
  seedAttempted = true
  const count = await prisma.genreCraftRule.count()
  if (count > 0) return
  for (let i = 0; i < GENRE_FAMILIES_SEED.length; i++) {
    const f = GENRE_FAMILIES_SEED[i]
    await prisma.genreCraftRule.create({
      data: {
        familyName: f.overrides.familyName,
        tags: f.tags,
        densityGuidance: f.overrides.densityGuidance,
        rhymeGuidance: f.overrides.rhymeGuidance,
        lineStructureGuidance: f.overrides.lineStructureGuidance,
        voiceGuidance: f.overrides.voiceGuidance,
        typographyGuidance: f.overrides.typographyGuidance,
        sortOrder: i,
        notes: 'Auto-seeded from GENRE_FAMILIES_SEED (cold-start).',
      },
    })
  }
}

async function loadActiveRules(): Promise<ActiveRuleRow[]> {
  await seedIfEmpty()
  const rows = await prisma.genreCraftRule.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return rows.map((r) => ({
    familyName: r.familyName,
    tags: r.tags,
    densityGuidance: r.densityGuidance,
    rhymeGuidance: r.rhymeGuidance,
    lineStructureGuidance: r.lineStructureGuidance,
    voiceGuidance: r.voiceGuidance,
    typographyGuidance: r.typographyGuidance,
  }))
}

export async function getGenreCraftOverrides(genreTag: string): Promise<GenreCraftOverrides | null> {
  const normalized = normalizeTag(genreTag)
  if (!normalized) return null

  const rules = await loadActiveRules()
  const index = new Map<string, GenreCraftOverrides>()
  for (const r of rules) {
    const overrides: GenreCraftOverrides = {
      familyName: r.familyName,
      densityGuidance: r.densityGuidance,
      rhymeGuidance: r.rhymeGuidance,
      lineStructureGuidance: r.lineStructureGuidance,
      voiceGuidance: r.voiceGuidance,
      typographyGuidance: r.typographyGuidance,
    }
    for (const tag of r.tags) {
      index.set(normalizeTag(tag), overrides)
    }
  }

  const direct = index.get(normalized)
  if (direct) return direct

  for (const [key, overrides] of index) {
    if (normalized.includes(key) || key.includes(normalized)) return overrides
  }

  return null
}

export function formatGenreCraftBlock(overrides: GenreCraftOverrides): string {
  return `GENRE-SPECIFIC CRAFT RULES (${overrides.familyName}) — these SUPERSEDE the default structural rules above when they conflict.

DENSITY:
${overrides.densityGuidance}

RHYME:
${overrides.rhymeGuidance}

LINE STRUCTURE:
${overrides.lineStructureGuidance}

VOICE:
${overrides.voiceGuidance}

PERFORMANCE TYPOGRAPHY:
${overrides.typographyGuidance}`
}
