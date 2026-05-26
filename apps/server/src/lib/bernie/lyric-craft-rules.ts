// Lyric-craft rules — overused words + AI-cliché phrases + structural defaults.
//
// As of 2026-05-25 Bernie is single-pass; the former edit-pass craft block and
// soft NO-GO block helpers (formatNoGoBlock / formatNoGoBlockSync) were retired
// with the edit pass. What remains: DRAFT_CRAFT_BLOCK (structural rules for the
// draft), the three ban-list constants (cold-start fallback for lyric_ban_entries),
// loadBanEntries, and formatHardBanBlock — the runtime FORBIDDEN block injected
// into both Bernie's and the Hook Drafter's user messages.
//
// Sources: external Suno-prompt research (lyric-craft / overused-words / ai-cliches),
// adapted for brand in-store music. The wordlist is trimmed to the high-frequency
// AI-emitted offenders rather than the full source list.

// ──────────────────────────────────────────────────────────────────────────────
// 1) Overused words — high-frequency AI-emitted offenders (trimmed from ~190 to
// ~60). Apply to all morphological variants (plurals, possessives, conjugations).
// ──────────────────────────────────────────────────────────────────────────────
export const OVERUSED_WORDS: readonly string[] = [
  'ancient', 'ascend', 'ashes', 'awakening', 'breaking chains', 'breaking free',
  'cascade', 'celestial', 'chains', 'chasing dreams', 'chasing shadows',
  'city lights', 'concrete jungles', 'cosmic', 'crescendo', 'dancing shadows',
  'distant echoes', 'divine', 'dreamscape', 'dusk', 'echo chamber', 'echoes of',
  'electric dreams', 'embrace', 'enchanted', 'eternal', 'ethereal',
  'everlasting', 'fading light', 'flame', 'flickering', 'forgotten tales',
  'ghosts', 'glow', 'guiding light', 'harmony', 'hazy', 'heartbeat', 'hidden',
  'hollow', 'illuminated', 'in the shadows', 'infinite', 'into the night',
  'labyrinths', 'lost in the shadows', 'midnight', 'mirrors', 'moonlight',
  'mystic', 'neon', 'phantom', 'pulse', 'radiant', 'raging storm',
  'rebel spirit', 'reborn', 'resonate', 'rise above', 'rise like a phoenix',
  'shadows', 'shattered', 'shimmering', 'silent whispers', 'soaring',
  'starlit', 'starry skies', 'stories untold', 'surrender', 'symphony',
  'tapestry', 'through the darkness', 'timeless', 'transcend', 'twilight',
  'unbound', 'unchained', 'under the stars', 'untold', 'urban decay',
  'velvet night', 'wandering souls', 'whispered secrets', 'whispering winds',
  'whispers',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// 2) AI-cliché phrases — literal phrases the editor should rewrite when they
// appear as abstract emotion rather than concrete sensory detail. Categories
// are organized for the model's scanning convenience; the categories themselves
// are not labels the model needs to act on.
// ──────────────────────────────────────────────────────────────────────────────
export const AI_CLICHE_PHRASES: readonly string[] = [
  // Devotion / heartbreak
  'I can\'t live without you', 'You\'re my everything', 'You complete me',
  'You make me whole', 'My heart is breaking', 'I\'ll love you forever',
  'I\'ll never let you go', 'You stole my heart', 'You mean the world to me',
  'I\'m nothing without you', 'My heart belongs to you', 'I can\'t breathe without you',
  'You\'re the love of my life', 'We were meant to be', 'You\'re the one that got away',
  // Pain / isolation
  'I\'m drowning in tears', 'I\'m lost in the darkness', 'I feel so alone',
  'I\'m numb to everything', 'I\'m falling apart', 'I\'m haunted by memories',
  'My world is empty', 'My heart feels hollow', 'I\'m a ghost of myself',
  'Tears fall like rain', 'I\'m barely holding on', 'I feel dead inside',
  // Time / forever
  'For the rest of my life', 'Until the end of time', 'Till my dying breath',
  'Forever and always', 'Through endless time', 'I\'ll wait forever',
  'From here to eternity', 'When the stars align',
  // Worn metaphors
  'My heart\'s on fire', 'Ice in my veins', 'You\'re my guiding light',
  'You\'re my north star', 'You take my breath away', 'Drowning in your love',
  'You\'re my anchor', 'A hurricane in my heart', 'Love is a battlefield',
  'Walking through fire', 'Your love is my drug', 'Butterflies in my stomach',
  'Head over heels', 'Swept off my feet', 'Floating on cloud nine',
  'Broken like glass', 'Pieces of my heart', 'Knight in shining armor',
  'Walls around my heart', 'Light at the end of the tunnel',
  'Sparks fly when we touch', 'Phoenix from the ashes', 'Castles in the air',
  'You\'re my angel', 'Our hearts beat as one',
  // Generic bridges
  'Love will find a way', 'Nothing lasts forever', 'It was always you',
  'Wish you were here', 'Can\'t stop thinking of you',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// 3) Cliché shapes — sentence-level templates. Recognizing the *shape* catches
// variants that wouldn't appear in the literal phrase list above.
// ──────────────────────────────────────────────────────────────────────────────
export const AI_CLICHE_SHAPES: readonly string[] = [
  '"I\'m so [emotion] without you"',
  '"My heart is [adjective]"',
  '"I can\'t [verb] without your love"',
  '"I\'m lost in your [noun]"',
  '"Without you I\'m [adjective]"',
  '"I\'ll never [verb] again"',
  '"Every night I [verb]"',
  '"Why did you leave me?"',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// 4) DRAFT-pass craft block — structural shape only. Qualitative principles
// rather than numeric recipes; numeric recipes flatten variety across a batch.
// ──────────────────────────────────────────────────────────────────────────────
export const DRAFT_CRAFT_BLOCK = `
STRUCTURAL CRAFT — Suno aligns musical phrases to lyrical phrases, so the structure encodes performance.

Within a section, keep line lengths similar to each other; vary line length between sections to differentiate energy. Verses can be more dense; choruses tighter and more chantable. Hip-hop, prog rock, and free-form folk are exceptions where intentional variation is the genre.

Pick rhyme schemes that fit each section's function:
- Verse (storytelling): ABAB, ABCB, AABA, or ABCA — forward motion without strong closure.
- Pre-chorus (building tension): ABAB or ABXB with shorter lines.
- Chorus (memorable, hookable): AABB or ABAB.
- Bridge (contrast): a scheme distinct from both verse and chorus.
- Avoid AABB everywhere — if chorus is AABB, verses use a different scheme; and vice versa.
- Mix in slant rhymes, internal rhymes, and feminine endings to add texture.

Line endings (stress pattern):
- Masculine ending (stressed final syllable, e.g. "stone") = closed, lands hard.
- Feminine ending (unstressed final syllable, e.g. "waiting") = open, continues.
- Be consistent within a section. Switch between sections to mark transitions.

Default to even line counts (4, 6, 8). Use odd counts (5, 7) only when the disruption serves a moment — typically to set up a drop or beat switch, where the section's final line breaks the established pattern (different rhyme, different line length, different stress).

Final-chorus variation (optional): if the song has a [Final Chorus], you may modify 1–2 of the non-hook surrounding lines to signal climax. The hook line itself remains verbatim. Production-cue escalation is handled downstream — that's not your concern.

Suno section markers, in approximate order of frequency:
[Intro] (optional), [Verse 1], [Pre-Chorus] (optional), [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], [Outro] (optional).
The hook becomes the chorus and is delivered verbatim every time it appears, including [Final Chorus].
`.trim()

// ──────────────────────────────────────────────────────────────────────────────
// 5) Ban-list loader — wordlist + cliché phrases + cliché shapes from DB
// (lyric_ban_entries), with the three TS constants above as cold-start fallback.
// ──────────────────────────────────────────────────────────────────────────────
import { prisma } from '../../db.js'

export async function loadBanEntries(): Promise<{ overusedWords: string[]; clichePhrases: string[]; clicheShapes: string[] }> {
  const rows = await prisma.lyricBanEntry.findMany({ orderBy: [{ category: 'asc' }, { text: 'asc' }] })
  if (rows.length === 0) {
    return {
      overusedWords: [...OVERUSED_WORDS],
      clichePhrases: [...AI_CLICHE_PHRASES],
      clicheShapes: [...AI_CLICHE_SHAPES],
    }
  }
  return {
    overusedWords: rows.filter((r) => r.category === 'overused_word').map((r) => r.text),
    clichePhrases: rows.filter((r) => r.category === 'cliche_phrase').map((r) => r.text),
    clicheShapes: rows.filter((r) => r.category === 'cliche_shape').map((r) => r.text),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 6) HARD-BAN block — strict-language version of the full ban list (overused
// words + cliché phrases + cliché shapes), for runtime injection into the draft
// + edit user messages. The seeded NO-GO block in the system prompt is soft
// ("pattern-recognition red flags") to preserve craft judgment on edge cases;
// this block is the hard "forbidden, never use" gate. The two co-exist on
// purpose: operators add hard bans (e.g. brand names to avoid, on-the-nose
// theme words, cliché phrases that keep leaking) via Dash → lyric_ban_entries,
// and those need stricter enforcement than the original AI-cliché flags. All
// three categories are enforced with FORBIDDEN-level framing — a cliché phrase
// or shape entry is not a soft advisory. Returns empty string only when every
// category is empty, so callers don't inject an empty header.
// ──────────────────────────────────────────────────────────────────────────────
export async function formatHardBanBlock(): Promise<string> {
  const { overusedWords, clichePhrases, clicheShapes } = await loadBanEntries()
  if (overusedWords.length === 0 && clichePhrases.length === 0 && clicheShapes.length === 0) return ''

  const sections: string[] = [
    `FORBIDDEN — the items below must not appear in the output. This is a hard constraint, not a stylistic preference. When a draft line would naturally include one, replace with concrete sensory imagery rather than a synonym swap.`,
  ]

  if (overusedWords.length > 0) {
    sections.push(`Forbidden words (apply to all morphological forms — plural, possessive, all conjugations, hyphenated compounds):
${overusedWords.join(', ')}.`)
  }

  if (clichePhrases.length > 0) {
    sections.push(`Forbidden phrases (must not appear verbatim or as near-paraphrase):
${clichePhrases.map((p) => `- ${p}`).join('\n')}`)
  }

  if (clicheShapes.length > 0) {
    sections.push(`Forbidden shapes (sentence templates — any variant filling these slots is equally forbidden):
${clicheShapes.map((s) => `- ${s}`).join('\n')}`)
  }

  return sections.join('\n\n')
}
