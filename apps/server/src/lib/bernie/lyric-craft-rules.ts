// Lyric-craft rules — overused words + AI-cliché patterns + structural defaults.
//
// These are pattern-recognition signals, not strict bans. The edit pass uses them to
// scrutinize draft lines for abstract-emotional placeholder use and rewrite toward
// concrete sensory imagery.
//
// Sources: external Suno-prompt research files (lyric-craft / overused-words / ai-cliches),
// adapted for brand in-store music.

// ──────────────────────────────────────────────────────────────────────────────
// 1) Overused single words / short phrases — flag for concrete-vs-abstract check.
// Applies to all morphological variants (plurals, possessives, conjugations).
// ──────────────────────────────────────────────────────────────────────────────
export const OVERUSED_WORDS: readonly string[] = [
  'abode', 'ancient', 'ascend', 'ashes', 'awakening', 'beyond compare',
  'beyond the horizon', 'binary', 'boundless sky', 'breaking chains', 'breaking free',
  'breathtaking', 'breeze', 'burning embers', 'burning passion', 'cascade',
  'caught in dreams', 'celestial', 'celestial bodies', 'celestial dance', 'chains',
  'chasing dreams', 'chasing shadows', 'cities crumble', 'city lights',
  'concrete jungles', 'cosmic journey', 'cosmic light', 'crescendo', 'crimson sky',
  'cyber heartbeat', 'dancing shadows', 'daring flight', 'delve', 'digital',
  'digital love', 'distant echoes', 'divine', 'dreaming awake', 'dreamscape',
  'drifting', 'dusk', 'echo', 'echo chamber', 'echoed past', 'echoes of',
  'electric dreams', 'electric heart', 'electric pulse', 'electric surge', 'embrace',
  'enchanted', 'eternal', 'ethereal glow', 'everlasting', 'fade away', 'fading light',
  'fading memories', 'flame', 'fleeting moments', 'flickering', 'fluid motion',
  'forgotten tales', 'fractured reality', 'ghosts', 'gleam', 'glow', 'gritty',
  'guide', 'guiding', 'harmony', 'hazy', 'heart of steel', 'heartbeat', 'hidden',
  'hollow', 'illuminated', 'illusive', 'in a dream', 'in my mind', 'in the dark',
  'in the shadows', 'in this journey', 'infinite', 'infinite night', 'inner fire',
  'into the night', 'kin', 'labyrinths', 'loose chains', 'lost in dreams',
  'lost in the shadows', 'lunar light', 'maze', 'melancholy', 'melodic', 'melodies',
  'midnight haze', 'midnight love', 'midnight rebellion', 'mirrors', 'moonlight',
  'mysterious', 'mystic', 'mystic shadows', 'neon', 'neon dreams', 'neon heartbeat',
  'neon lights', 'phantom light', 'pulse', 'racing heart beats', 'radiant', 'radiate',
  'raging storm', 'rebel spirit', 'reborn', 'refrain', 'reprieve', 'resonate',
  'rhythm', 'rhythm of life', 'rise above', 'rise again', 'rise like a phoenix',
  'rise up', 'rising', 'river', 'roar', 'seams', 'secret', 'shadows', 'shadows dance',
  'shattered dreams', 'shattered glass', 'shifting tides', 'shimmering',
  'shimmering city', 'shining bright', 'silent', 'silent whispers', 'soaring echoes',
  'sonic waves', 'soulful echoes', 'stand strong', 'stark', 'stark reality',
  'starlit path', 'starry skies', 'static', 'stories unfold', 'stories untold',
  'strife', 'superman', 'surge of hope', 'surrender', 'symphony', 'syntax', 'tapestry',
  'the fray', 'through the darkness', 'timeless', 'timeless soul', 'transcend',
  'twilight', 'unbound', 'unchained', 'under the stars', 'unfold', 'untold', 'urban',
  'urban decay', 'urban legends', 'veiled', 'velvet night', 'vibrant hues', 'wake up',
  'waking life', 'wandering souls', 'whirl', 'whispered lies', 'whispered secrets',
  'whispering rain', 'whispering winds', 'whispers', 'wild', 'win the fight',
  'young and free',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// 2) AI-cliché phrase patterns — sentence-level red flags.
// Recognize the *shape*, not just the literal phrases. Variants are equally clichéd.
// ──────────────────────────────────────────────────────────────────────────────
export const AI_CLICHE_PATTERNS: readonly string[] = [
  // Heartbreak / devotion
  'I can\'t [live/breathe/exist/function] without you',
  'You\'re my [everything/world/reason/oxygen/north star/lighthouse]',
  'My heart [is breaking/is torn/aches/belongs to you/beats for you]',
  'I\'ll [love/wait/be here/hold on] forever',
  'You [complete me/make me whole/are the one]',
  'I\'m [nothing/lost/empty/broken] without you',
  'Don\'t [leave/let go/walk away/break my heart]',
  'Take me back / Come back to me / I want you back',
  'I\'ll never love again / love you till I die',
  'We were meant to be / You\'re the one that got away',
  // Pain / isolation
  'I\'m [drowning/lost/stuck/trapped] in [tears/darkness/sorrow/regret/silence/the void]',
  'I\'m [empty/hollow/numb/shattered/broken] inside',
  'I can\'t [stop/find/see/take/escape] [crying/the pain/the light/it/this]',
  'I\'m a [ghost/shell/mess] of myself',
  'I feel [invisible/unwanted/dead inside/nothing]',
  'I\'m [fading/sinking/falling/spiraling] [away/into darkness/deeper]',
  'Tears fall like rain',
  'I\'m haunted by memories / lost in my [mind/thoughts]',
  // Time / forever
  'For [the rest of my life/all my days/all time/all eternity]',
  'Until [the end of days/the end of time/forever/sunrise/sunset]',
  'Till [my dying breath/kingdom come/the stars burn out/time stands still]',
  '[Day/night/year] after [day/night/year]',
  'From [dusk till dawn/now until forever/here to eternity]',
  'Through [endless time/the passing years/the hands of time]',
  'Forever [and always/and ever/more]',
  '[Endless/timeless/boundless] [nights/days/time/sky]',
  'I\'ll wait [a lifetime/as long as it takes/forever]',
  'When [tomorrow comes/yesterday fades/morning breaks/the stars align]',
  // Worn metaphors
  'Heart-as-object: my heart\'s on fire / aches / beats for you',
  'Body-as-metaphor: ice in my veins, butterflies in my stomach',
  'Light/dark: you\'re my light, guiding light, light at the end of the tunnel',
  'Weather: love is a storm, hurricane in my heart',
  'Astronomy: north star, shooting star, sun in my sky',
  'Drugs/poison: your love is my drug, under your spell',
  'Travel: love is a journey, sailing stormy seas',
  'Battle: love is a battlefield, armor around my heart',
  'Glass/breaking: broken like glass, pieces of my heart',
  'Royalty: king and queen of hearts, knight in shining armor',
  'Fairy tale: pages of a fairytale, phoenix from the ashes',
  'Falling: head over heels, swept off my feet, floating on cloud nine',
  // Structural fill-in templates
  '"I\'m so [emotion] without you"',
  '"My heart is [adjective]"',
  '"I can\'t [verb] without your love"',
  '"I\'m lost in your [noun]"',
  '"You left me [feeling]"',
  '"I\'ll never [verb] again"',
  '"Without you I\'m [adjective]"',
  '"Every night I [verb]"',
  // Bridging clichés
  '"Love will find a way"',
  '"Nothing lasts forever"',
  '"You and I were meant to be"',
  '"It was always you"',
  '"Everything reminds me of you"',
  '"I still hear your voice"',
  '"Wish you were here"',
  '"Can\'t stop thinking of you"',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// 3) Format the rules into a prompt-ready block.
// Kept compact so the system prompt doesn't balloon.
// ──────────────────────────────────────────────────────────────────────────────
export function formatNoGoBlock(): string {
  return `
NO-GO list — these are pattern-recognition red flags, not strict bans. When you write a line that contains a flagged word OR matches a flagged shape, ask: am I describing a concrete sensory thing in a specific moment, or am I gesturing at an abstract emotion? If concrete and grounded, fine. If abstract or gestural, rewrite with specific imagery (a particular place, time, object, sensation). Do NOT swap one abstract synonym for another (don't replace "shadows" with "darkness" or "you complete me" with "you make me whole"). The fix is always specificity.

Overused words to scrutinize (apply to plurals, possessives, all conjugations):
${OVERUSED_WORDS.join(', ')}.

AI-cliché shapes to avoid (recognize the pattern, variants are equally clichéd):
${AI_CLICHE_PATTERNS.map((p) => `- ${p}`).join('\n')}
`.trim()
}

// ──────────────────────────────────────────────────────────────────────────────
// 4) Structural craft rules — syllable matching, rhyme schemes, section length,
// performance typography, transitions, chorus escalation.
// ──────────────────────────────────────────────────────────────────────────────
export const CRAFT_RULES_BLOCK = `
STRUCTURAL CRAFT — Suno aligns musical phrases to lyrical phrases, so structure encodes performance.

Syllable counts:
- Within a section, keep line syllable counts within ±2 of each other (verse: 8/8/9/7 fine; 8/12/5/9 not).
- Vary syllable count *between* sections to differentiate energy. Verses often 7–10 syl; choruses tighter at 4–8 syl.
- Genre exception: hip-hop, prog rock, and free-form folk may break this on purpose.

Rhyme scheme by function:
- Verse (storytelling): ABAB, ABCB, AABA, or ABCA. Forward motion without strong closure.
- Pre-chorus (building tension): ABAB or ABXB with shorter lines.
- Chorus (memorable, hookable): AABB or ABAB.
- Bridge (contrast): a scheme different from both verse and chorus.
- Avoid AABB everywhere — if chorus is AABB, verses must be something else, and vice versa.
- Mix in slant rhymes, internal rhymes, pararhymes, feminine endings to add texture.

Line endings (stress pattern):
- Masculine ending (stressed final syllable, e.g. "stone") = closed, lands hard.
- Feminine ending (unstressed final syllable, e.g. "waiting") = tapering, open, continues.
- Be consistent within a section. Switch between sections to mark transitions.

Default section shapes:
- Verse: 4–8 lines, 7–10 syllables/line.
- Pre-Chorus: 2–4 lines, 4–7 syllables (shorter, building).
- Chorus: 4–6 lines, 4–8 syllables (chantable).
- Bridge: 4–8 lines, often contrasting line length.
- Outro: 2–4 lines, variable.
- Default to even line counts (4, 6, 8). Use odd counts (5, 7) only when the disruption serves a purpose.

Engineering transitions:
- Smooth transition: matched line counts + consistent endings → Suno produces clean, expected transition.
- Drop / energy shift: disrupt the final line of the preceding section — break the rhyme, switch stress pattern, use a much shorter or longer line, or break the punctuation pattern. Without disruption, [Drop] tags are often ignored.

Chorus escalation across repeats:
- The first chorus and the last chorus should not feel identical. Default approach: keep the hook line verbatim, but on the FINAL chorus optionally modify 1–2 of the non-hook surrounding lines to signal climax. Production-cue escalation is handled downstream by the arranger; that's not your concern.
- If you do vary the final chorus, label that section [Final Chorus] (not [Chorus]) so the downstream arranger knows.

Performance typography (use deliberately, not decoratively):
- ALL CAPS = emphasis or shouted delivery on that word.
- Elongated vowels ("lo-o-ove") = stretched note.
- Ellipsis "…" = pause / hesitation / slowdown.
- Em dash "—" = longer pause than a comma.
- Hyphenated word ("d-a-s-h-e-d") = sung as one continuous flow.
- Parentheses "( )" around words = backing-vocal / harmony / call-and-response performance of those words. Square brackets "[ ]" are NEVER performed.
- An extra blank line within a section = sonic pause for instrumental fill or vocal reset. Do not use blank lines for visual spacing only — they have an audible effect.

Default Suno section markers:
[Intro], [Verse 1], [Pre-Chorus] (optional), [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], [Outro].
The hook becomes the chorus and is delivered verbatim every time it appears (including [Final Chorus]); the hook line itself never changes.
`.trim()
