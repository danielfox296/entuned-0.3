---
name: craft-hooks
description: Chat-time hook writing for an Entuned outcome — generates candidate hook lines in conversation using a craft-principle + voice-library methodology, NOT a wrapper around the production drafter. Use when Daniel says "craft hooks for [outcome]", "write me some hooks for [outcome]", "give me hook ideas for X", or wants to riff on hooks in chat before pasting curated lines into Dash. This is the in-chat methodology that was landed on after the production drafter (DB-backed templateText + system prompt) kept producing therapy-coded, flattened output. If Daniel wants hooks persisted to the DB via the production drafter, use `draft-hooks` instead.
---

# craft-hooks

In-chat hook writing. Not a DB skill, not an admin-route caller. The output is a list of candidate hook lines pasted into the chat; Daniel curates and enters survivors into Dash by hand.

This skill exists because the production drafter — DB-backed `templateText` + universal system prompt + per-outcome overlay — consistently produces flattened, therapy-coded hooks even with sharpened prompts. The methodology below is what worked when I iterated with Daniel in chat: a small set of transferable craft principles plus voice-first register selection, run with a hard therapy-code filter on the back end.

Craft baseline (what a great hook is, mouth-feel, mode/tempo coupling, banned diction) lives in [`apps/server/src/lib/hooks/drafter.ts`](../../apps/server/src/lib/hooks/drafter.ts) → `HOOK_SYSTEM_PROMPT_SEED`. Do not duplicate it here. The hard runtime bans live in the `lyric_ban_entries` DB table; this skill operates at chat-time, so I keep those bans in mind manually.

## What a hook is

A hook is an *angle of approach* into a specific emotional truth — not the emotion itself, and not a scene without an emotion underneath.

A good hook makes a felt thing visible through something concrete. The line "I miss you when you're gone" has the emotion right and dies on the page. The reason the canonical all-time-great hooks live forever is they never name the emotion; the indirect object — a place, a small action, a color, a named person — IS the metaphor for the state. The craft is choosing the indirect object that makes the emotion enter-able for the listener.

If a candidate names the feeling instead of the cause of the feeling, it is not yet a hook. It's a draft of what the hook should be about.

## The therapy-code anti-pattern

This is the dominant failure mode. Hooks die the moment they sound like recovery / self-help / therapy cadence. Apply harshly — borderline lines fail.

Markers to flag and cut:

- **Reflexive verbs:** "I let myself ___," "I made myself ___," "I'm talking myself out of ___"
- **Permission cadence:** "I'm allowed," "I let go," "I'm done [verbing] myself"
- **Self-categorization:** "the kind of person who," "turns out I [verb]"
- **Direct emotional declaration:** "I'm not pretending anymore," "I'm not making myself smaller"
- **Pattern-naming reflection:** "I always end up ___ing"
- **Reframe language:** "It's enough to ___," "I belong to what I ___"

Any line that reads like a sentence from a recovery meeting or a CBT worksheet is out, regardless of how true it is. The hook should sound like the *world*, not like a person describing their relationship to it.

## The 10 craft principles

State the principle, then write. Do not seed exemplar lines into the working set — the model collapses to them. See `feedback_dont_default_to_shots.md`.

1. Name a place; let the place do the work of the emotion.
2. Pair a small visible image with an invisible large one.
3. Address a thing as if it could grant a wish.
4. Place an internal state inside an external geography.
5. Use a word from a different register; let the dissonance carry meaning.
6. Turn a person into an object in motion.
7. Speak a hard truth as if quoting received wisdom.
8. Use a color to name a state language can't reach.
9. Name what's missing rather than what's present.
10. Specific person + specific place makes the universal enter-able.

## The voice library

Voice selection is per-outcome. Different outcomes call for different angles of approach. Using multiple voices in a single batch is a feature, not a bug — it produces structural variance for free.

Do not quote these writers. Let their angle of approach shape the model's choices.

| Voice | Angle of approach |
|---|---|
| **Bernie Taupin** | Vivid third-person scene-paintings, named characters in named places |
| **Lennon / McCartney** | The unsentimental specific detail that breaks your heart; ordinary nouns made luminous |
| **Billy Joel** | Named characters in working-class settings; the dignity of the small life observed |
| **Kanye West** | Public/private flip; mundane object meets cosmic claim; confession braided with bravado |
| **Aimee Mann** | Surgical self-knowledge without therapy cadence; names self-delusion coldly |
| **Tom Waits** | Character voice + surreal domestic; the world made strange |
| **Randy Newman** | Speaks AS a character with a position; ironic distance, the most anti-confessional craftsman |
| **Stephin Merritt (Magnetic Fields)** | Formal constraints + arch wit; the hook as epigram |
| **André 3000** | Surreal + plainspoken at once; collage of registers in a single line |
| **Lou Reed** | Second-person address; flat voice with quiet menace |
| **Dolly Parton** | Narrative third-person ballads; working-class specificity; devotion-as-pragmatism |
| **Lucinda Williams** | Quiet defiance; settled decision; Southern-domestic specificity |
| **Raymond Carver** (poetry/short fiction) | Terse domestic recognition; small objects carrying large weight |
| **Mary Oliver** | Close attention, the small holy of paying attention. NOTE: Oliver leaked therapy in testing. Use only when the outcome's emotional shape is genuine attention/permission, and screen output extra-hard. |

## Structural preference

Third-person and second-person voices are the most therapy-resistant by structure — you can't talk like a therapist about someone else, only about yourself.

When choosing across the voice library for a batch, lean toward voices that naturally write in third or second person. First-person is allowed, but the therapy filter applies harder on first-person lines.

## Process

When invoked:

1. **Resolve the outcome.** Get both the *action* (the behavior the music is trying to drive) and the *emotional shape* (the specific feeling underneath that behavior). If either is unclear, ask Daniel before generating.

2. **Select 3–5 voices** from the library whose angle of approach maps to the emotional shape. Justify each pick in one sentence — name the mechanic, not the vibe. ("Billy Joel for the dignity of the small working moment" — not "Billy Joel because it feels right.")

3. **Generate N hooks** (default 10) using a mix of the selected voices and the craft principles. Tag each candidate with its anchoring voice or principle in brackets so Daniel can see the source:

   ```
   [Bernie Taupin · principle 10] <hook text>
   [Aimee Mann · principle 7]     <hook text>
   ```

4. **Run the therapy-code filter** on the candidate set. Cut anything that hits a marker from the anti-pattern section. Apply harshly — when in doubt, cut. Lines failing the filter do not get a rewrite pass in this skill; they get dropped.

5. **Present survivors as a flat list.** Daniel curates from there. Do not pre-rank, do not annotate quality, do not suggest the "best" one.

## What this skill does NOT do

- **No DB writes, no admin-route calls, no `railway ssh`.** Daniel pastes hooks into Dash manually. If he wants the production drafter pathway, that's `draft-hooks`.
- **No exemplar hook lines anywhere.** Not in the principles, not in the voice library, not as positive shots, not as negative shots. Exemplars collapse output to themselves (`feedback_dont_default_to_shots.md`). The methodology communicates via principles and voice references only — never via "here's what a good hook looks like."
- **No iteration on rejected lines in the same pass.** If a candidate hits the therapy filter, it's dropped. The next pass — if Daniel asks for more — is a fresh batch with possibly different voice picks.
- **No editing the production drafter prompt.** That's Dash → Prompts & Rules → Hook Drafter. This skill is the in-chat alternative, not a writer for the DB-backed prompt.
