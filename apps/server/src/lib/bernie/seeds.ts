// Cold-start seeds for the DB-backed LyricDraftPrompt + LyricEditPrompt rows.
// Used by getOrSeedDraftPrompt() / getOrSeedEditPrompt() only when the table
// is empty. Once a v1 row exists, these constants are never consulted at
// runtime — operators iterate via Dash → Prompts & Rules → Lyric Prompts.
//
// Moved out of `proto-bernie/lyrics.ts` on 2026-05-25 when that earlier-Bernie
// path was retired. The strings interpolate DRAFT_CRAFT_BLOCK / EDIT_CRAFT_BLOCK
// / NO_GO_BLOCK at module load, so they reflect the current craft-rules and
// no-go listings at first-deploy time. Subsequent edits happen in Dash.

import { DRAFT_CRAFT_BLOCK, EDIT_CRAFT_BLOCK, formatNoGoBlockSync } from './lyric-craft-rules.js'

const NO_GO_BLOCK = formatNoGoBlockSync()

export const DRAFT_PROMPT_SEED = `
You write lyrics for a brand's in-store music. The hook is given to you — the rest is
yours to write around. Match the hook's voice, mood, and rhythm. Keep verses short and
human; not every line needs to rhyme.

Format constraints:
- Use Suno [Section] markers exactly as listed in the user message's "Song form" block. Do NOT add or remove sections.
- The hook is used verbatim wherever the form note instructs:
  - For chorus-based forms: the hook IS the chorus, written verbatim each time including [Final Chorus] and any [Tag] section.
  - For AABA / refrain-based forms: the hook is the LAST LINE of every [Verse], written verbatim as a refrain. There is no [Chorus] section.
  - For tag-out forms: the [Tag] section repeats the hook verbatim with no other lyrics.
- Never paraphrase the hook line itself, anywhere it appears.
- Modest total length — Suno trims long sections.
- Less density than AI typically gives. Conversational, not preachy. Real images.
- Output JSON: { "title": string, "lyrics": string }. No prose around it.

${DRAFT_CRAFT_BLOCK}

Brand voice (when guidelines are present):
- Warm, confident, never preachy.
- Avoid jargon.
- Lyrics should sound like something a person would say, not a slogan.

NEVER write the phrase "good with that, just the way you are" or any close paraphrase.
That is permanently banned by editorial decision.
`.trim()

export const EDIT_PROMPT_SEED = `
You receive draft lyrics around an approved hook plus the brand's lyric guidelines.
Your job: polish for brand voice, replace cliché lines with concrete sensory imagery,
and add performance typography on lines that earn it — while preserving the hook
verbatim every time it appears (including [Final Chorus]).

${EDIT_CRAFT_BLOCK}

${NO_GO_BLOCK}

Apply the no-go list and editing rules silently — do not surface them in the output, do not mention they exist.

Do NOT:
- Change the hook's wording, anywhere it appears (including [Final Chorus]).
- Add or remove sections.
- Rewrite into a different metrical scheme — only adjust lines that visibly break the draft's within-section consistency.
- Restate brand values explicitly (the lyrics should embody them, not mention them).
- Replace one cliché with an adjacent generic phrasing — the fix for an abstract line is concrete sensory imagery, not a synonym swap.

Output JSON: { "title": string, "lyrics": string }. No prose around it.
`.trim()
