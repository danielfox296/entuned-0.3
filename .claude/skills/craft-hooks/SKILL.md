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

## Cliché — the primary anchor

A well-worn phrase is the hook's strongest move. Familiarity carries its own weight — the listener recognizes the line before parsing it; the music gives it context; the entendre is automatic. Hit rates from testing: cliché-anchored hooks ship at roughly **85%**; invention-anchored ("strangeness") hooks ship at roughly **40%** and almost always require editing. **Cliché is the lead mode.** Reach for invention only when no cliché captures the feeling.

What lands:

- Folk wisdom, proverbs, working-class idioms, mid-century domestic phrases
- Idioms with concrete or visceral imagery — "cutting corners" beats "scrimping"
- Cultural-specific phrases with folk-weight — "the real McCoy" beats "the real article"
- Phrases from a grandmother, a job site, a porch, a poker table, a kitchen counter

What doesn't:

- Corporate / inspirational / aspirational ("just do it," "believe in yourself")
- Therapy / self-help ("self-care," "boundaries," "showing up")
- Hashtag-flavored ("#blessed," "treat yourself")
- Decorum-language without grit

**Already-a-famous-song lint.** Clichés that are well-established song titles get cut — the listener will be pulled to the existing song, not the new one. Watch for: Putting on the Ritz, Walking on Sunshine, On the Road Again, Let It Ride, Steady As She Goes, Killing Me Softly, Don't Stop Believin', Cream of the Crop. If the cliché has a famous song attached, find another cliché.

**Cliché hierarchy.** Folk-weight beats decorum. Concrete imagery beats abstract quality. Specific cultural reference beats generic phrase. When choosing between two clichés that fit the feeling, pick the one with more grit.

The test: if the line could be the title of a self-help book, cut it. If it could be the title of a country song that doesn't already exist, keep it.

## Strangeness — the secondary mode

When no cliché captures the feeling, the hook can anchor on a small strangeness — an off-note, a slight tilt, an unexpected pairing. This is the *secondary* mode. Use it when cliché won't reach the feeling, not as the default move.

Three rules:

1. **It must serve the outcome.** A strange image that contradicts the outcome's emotional vector gets cut. "Freight train at idle" is strange — but if the outcome is forward motion, the strangeness undercuts the outcome and dies.

2. **Honest, not clever.** Strangeness that *reveals* something true about the feeling survives. Strangeness that *performs* cleverness gets cut. Test: would removing the strangeness flatten the feeling, or just make the line plainer? If just plainer, it was performance.

3. **Wear cliché-cadence.** Strangeness that survives sounds like a folk-saying that *could* exist, not a literary construction. Lines with the rhythm of a real idiom hold; authored constructions die.

## Length and grammar

Hooks are **weighted fragments**, not complete sentences. Inner voice doesn't narrate to completion — it catches itself mid-thought. Default range is **2–5 words**; full sentences are suspect.

Cut aggressively: drop subjects, drop articles, drop elaborating second clauses, drop costume details, drop modifiers that aren't load-bearing. The implied first-person often carries the meaning; the explicit pronoun can kill the cadence.

**But not always.** Keep "I'm" / "I" when natural speech includes it — *"I'm calling it"* reads as the moment of decision; *"calling it"* alone reads as observation. When the pronoun marks the speech-act register, keep it. The rule isn't "always cut the pronoun" — it's "cut the pronoun when it's filler, keep it when it's cadence."

A line that says one thing well beats a line that says two things in a row.

## Inner-voice cadence

Inner voice has rhythm. The hook can mark its rhythm with punctuation — not for grammar, for cognition. Mid-thought pauses (commas), arrival points (periods inside short lines), and em-dash interruptions all signal a real person catching their own thinking.

A comma is the speaker reaching the thought; a period inside a 3-word line is the conclusion landing; an em-dash is the interruption that always happens when thinking. Punctuation choices are content. Trust them.

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

## Idiom and cliché — recognition as an alternative anchor

A well-worn phrase can be the hook. Familiarity carries its own weight — the listener recognizes the line before parsing it; the music gives it context; the entendre is automatic. "Keeping up with the Joneses," "made up my mind," "what the hell," "cut from the same cloth," "while we're at it" — these land instantly because the listener has heard them their whole life.

This is an **alternative anchor to the strangeness floor**. Strangeness anchors via *revelation* (the listener notices something new). Cliché anchors via *recognition* (the listener feels something already known). A hook can use either. A cliché tilted slightly does both.

**Works:** folk wisdom, proverbs, working-class idioms, mid-century domestic phrases, idioms with concrete imagery. The kind of thing a listener would hear from their grandmother, their job site, their porch.

**Doesn't work:** corporate / inspirational / aspirational ("just do it," "believe in yourself"), therapy / self-help ("self-care," "boundaries," "showing up"), hashtag-flavored ("#blessed," "treat yourself").

The test: if the line could be the title of a self-help book, cut it. If it could be the title of a country song, keep it.

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

## POV — first person is the home register

Hooks mimic the shopper's internal dialogue — the half-said sentence inside the customer's head as they stand in the moment. **First person is the default register**, because that's where the listener lives. Third and second person are valid and produce structural variance, but most hooks live in first.

First-person ≠ confessional. The therapy filter applies *hardest* here, because first-person is the surface most likely to slip into recovery cadence. Hold the distinction:

- **Living first-person** — the inner voice of someone noticing the world; the speaker is inside the moment, observing.
- **Reflecting first-person** — a person describing their relationship to themselves ("I let myself enjoy it," "Turns out I do live this way"). This is the therapy register. Cut.

Also watch for **assertion-mode identity claims** — both the negations ("I don't X," "I am not Y") *and* the affirmations ("I am X," "I am like Y"). These tend toward thin claim regardless of polarity. The fix: convert identity to action. *"I am efficient as a small appliance"* → *"I work tight like a small appliance."* Verbs of doing beat verbs of being. First-person should be **doing**, not **being**.

## Process

When invoked:

1. **Resolve the outcome.** Get three things:
   - The *action* — the behavior the music is trying to drive.
   - The *emotional shape* — the specific feeling underneath that behavior.
   - The *use-of-witness* — most hooks have **no third-party character.** Even in outcomes where seen-ness is part of the feeling (trade-up, swagger-spend, brand-match), a named witness gets cut unless it carries **specific context** — a *relation* + a *place* (Aunt Janelle at the wedding, Patsy in the back room, Marie at the corner store). A naked name (Velma, Sal, Carrie) reads invented and dies. Default disposition: **no witness.** Reach for a named witness only when the line genuinely cannot carry the feeling without one, and even then earn the name with context. Most batches should have zero or one witness line, not five.

   If any of these is unclear, ask Daniel before generating.

2. **Select 3–5 voices** from the library whose angle of approach maps to the emotional shape. Justify each pick in one sentence — name the mechanic, not the vibe. ("Billy Joel for the dignity of the small working moment" — not "Billy Joel because it feels right.")

3. **Generate N hooks** (default 10) using a mix of the selected voices and the craft principles. Tag each candidate with its anchoring voice or principle in brackets so Daniel can see the source:

   ```
   [Bernie Taupin · principle 10] <hook text>
   [Aimee Mann · principle 7]     <hook text>
   ```

4. **Filter the candidate set.** Two passes, both applied harshly:
   - **Therapy filter.** Cut anything that hits a marker from the therapy anti-pattern section.
   - **Revelation test.** Ask of each surviving line: *does this make the listener notice something they hadn't seen, or feel something they hadn't named?* If it's pure description — clean but flat — cut. The therapy filter doesn't catch description; it needs its own pass.

   Lines failing either filter do not get a rewrite pass in this skill; they get dropped.

5. **Present survivors as a flat list.** Daniel curates from there. Do not pre-rank, do not annotate quality, do not suggest the "best" one.

## Skill-level bans

In addition to the production drafter's `lyric_ban_entries` DB list, the following are banned at the skill level (Daniel's veto — do not use in any form):

- **"heavy"** — the model defaults to "heavy" as the universal weight-signaling word (heavy thing, heavy coat, heavy hour). Cut it. If weight matters, find a more specific word.

## LLM-default lint

Watch for words the model defaults to without reason. Not bans — flags for *variation*. If a batch returns the same default twice, vary it.

- **"Tuesday" / "Wednesday" / "Thursday"** — the model's default weekday rotation. The lint isn't about a specific day; if a day name isn't load-bearing to the scene (i.e., the line still works with the day removed), cut it.

This list grows as patterns emerge. Add to it.

## What this skill does NOT do

- **No DB writes, no admin-route calls, no `railway ssh`.** Daniel pastes hooks into Dash manually. If he wants the production drafter pathway, that's `draft-hooks`.
- **No exemplar hook lines anywhere.** Not in the principles, not in the voice library, not as positive shots, not as negative shots. Exemplars collapse output to themselves (`feedback_dont_default_to_shots.md`). The methodology communicates via principles and voice references only — never via "here's what a good hook looks like."
- **No iteration on rejected lines in the same pass.** If a candidate hits the therapy filter, it's dropped. The next pass — if Daniel asks for more — is a fresh batch with possibly different voice picks.
- **No editing the production drafter prompt.** That's Dash → Prompts & Rules → Hook Drafter. This skill is the in-chat alternative, not a writer for the DB-backed prompt.
