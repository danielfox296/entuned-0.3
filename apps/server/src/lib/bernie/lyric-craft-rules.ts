// Lyric-craft rules — overused words + AI-cliché phrases + structural defaults.
//
// The blocks are split between draft and edit pass so each pass only carries the
// rules it actually needs. The draft pass focuses on shape (syllable matching,
// rhyme-by-function, line endings, even-count defaults). The edit pass focuses on
// polish (no-go list, replacement strategy, performance typography). This keeps
// each system prompt well below the cache threshold and prevents the editor from
// re-litigating structural decisions the draft already made.
//
// Sources: external Suno-prompt research (lyric-craft / overused-words / ai-cliches),
// adapted for brand in-store music. The wordlist is trimmed to the high-frequency
// AI-emitted offenders rather than the full source list — long flat dumps are
// weakly conditioned at inference time, so a tighter list with sentence-level
// patterns does more work per token.

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
// 5) EDIT-pass craft block — polish rules + performance typography. Performance
// typography belongs in the edit pass (not draft) so the editor adds it
// deliberately on lines that earn it, rather than the draft sprinkling it as
// decoration.
// ──────────────────────────────────────────────────────────────────────────────
export const EDIT_CRAFT_BLOCK = `
EDITING TOWARD PLAYABILITY:
- Stronger imagery, fewer abstractions.
- Conversational diction; no slogans, no jargon.
- Shorter lines where lines feel cluttered.
- Each verse landing on a phrase that sets up the chorus.
- Within-section line consistency; between-section variation. (The draft pass should already have this — only adjust lines that visibly break it.)
- The hook line never changes, anywhere it appears, including [Final Chorus].

PERFORMANCE TYPOGRAPHY — add deliberately on lines that earn it, not decoratively:
- ALL CAPS = emphasis or shouted delivery on that word. Use rarely.
- Em dash "—" = longer pause than a comma.
- Ellipsis "…" = pause / hesitation / slowdown.
- Hyphenated word ("d-a-s-h-e-d") = sung as one continuous flow.
- Parentheses "( )" around words = backing-vocal / call-and-response performance of those words. Square brackets "[ ]" are NEVER performed — they are direction to Suno only.
- An extra blank line within a section = sonic pause for instrumental fill or vocal reset. Do not use blank lines for visual spacing only — they have an audible effect.
`.trim()

// ──────────────────────────────────────────────────────────────────────────────
// 6) NO-GO block — wordlist + cliché phrases + cliché shapes. Used by the EDIT
// pass only.
// ──────────────────────────────────────────────────────────────────────────────
export function formatNoGoBlock(): string {
  return `
NO-GO list — pattern-recognition red flags, not strict bans. When a draft line contains a flagged word OR matches a flagged shape, ask: am I describing a concrete sensory thing in a specific moment, or am I gesturing at an abstract emotion? If concrete and grounded, fine. If abstract or gestural, rewrite with specific imagery (a particular place, time, object, sensation). Do NOT swap one abstract synonym for another (don't replace "shadows" with "darkness", or "you complete me" with "you make me whole"). The fix is always specificity.

Overused words (apply to plurals, possessives, all conjugations):
${OVERUSED_WORDS.join(', ')}.

Cliché phrases:
${AI_CLICHE_PHRASES.map((p) => `- ${p}`).join('\n')}

Cliché shapes (variants of these structures are equally clichéd):
${AI_CLICHE_SHAPES.map((s) => `- ${s}`).join('\n')}
`.trim()
}
