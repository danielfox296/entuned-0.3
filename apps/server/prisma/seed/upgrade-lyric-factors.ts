// Upgrade outcome lyric factor prompts to break phrase-level ruts.
// See HANDOFF-lyric-repetition.md for the root-cause analysis.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/upgrade-lyric-factors.ts');
//   \""

import { PrismaClient } from '@prisma/client'

const FACTORS: Record<string, string> = {

  'Calm': `
Hooks for this outcome should land the listener in a specific still moment — not "relaxation" as a concept, but the physical experience of being settled.

## Sensory seeds (use as launching pads, not templates)
- Morning fog sitting on a lake, the water so flat it looks solid
- Bare feet on cool tile after a long day
- A dog asleep on the porch, one ear twitching
- The weight of a warm mug held in both hands
- Watching rain slide down a window from inside

## Anti-clustering rules
- Each hook must use a DIFFERENT physical setting than every other hook for this outcome. No two hooks in the same room, landscape, or time of day.
- Each hook must use a different verb tense (present, past, future) AND a different sentence structure (declaration, question, fragment, observation, imperative) than the hook immediately before it.
- If you catch two hooks sharing a rhythm (same syllable count, same stressed positions), rewrite one with a fundamentally different cadence.

## Spread vectors
Rotate deliberately across these levers — no two consecutive hooks should share more than one:
1. Verb type: stative (is, sits, rests) vs. motion (drifts, settles, lands) vs. sensory (feels, sounds, tastes)
2. Scale: body-close (skin, hands, breath) vs. room-scale (window, chair, doorway) vs. landscape (horizon, field, shore)
3. Sense: touch vs. sight vs. sound vs. smell
4. Agency: things happening TO the speaker vs. speaker choosing stillness vs. impersonal observation

## Do NOT use
- "learning how to" or "I'm learning how"
- "slow down" or "slowing down"
- Any hook that frames calm as a lesson being learned — calm is a state arrived at, not a skill being practiced
- Abstract nouns: peace, serenity, tranquility, stillness (as a word — the feeling is fine)
`.trim(),

  'Add More Items': `
Hooks for this outcome capture the small private thrill of adding one more thing — not retail greed, but the pleasure of abundance when it costs nothing emotionally.

## Sensory seeds
- Tossing an extra lime into the bag at a farmers market without checking the price
- The satisfying click of a latch closing on a full suitcase
- Stacking one more record on a turntable pile on a Saturday afternoon
- Pulling a warm roll from the basket before anyone else notices
- Finding a forgotten twenty in a coat pocket and spending it immediately

## Anti-clustering rules
- Each hook must name a DIFFERENT object or action than every other hook. No two hooks about "grabbing" or "adding" the same category of thing.
- Alternate between hooks where the speaker is the actor (I/me doing the grabbing) and hooks where the object is the subject (the thing calling out, presenting itself).
- No two hooks should use the same verb of acquisition. Vary: reach, toss, slide, stack, fold, pocket, scoop — never repeat within a batch.

## Spread vectors
1. Impulse type: planned treat vs. spontaneous grab vs. "why not" shrug
2. Object weight: light/small (a candy, a song) vs. medium (a shirt, a book) vs. heavy/committed (furniture, a trip)
3. Social context: solo indulgence vs. sharing/gifting vs. competitive (before someone else gets it)
4. Emotional register: giddy vs. casual vs. conspiratorial vs. satisfied

## Do NOT use
- "take one more" or "one more" as a standalone phrase
- "might as well" or "might as well add it"
- "grab it" / "get it" / "take it" as the core verb phrase
- Any hook that sounds like a retail prompt or upsell CTA
`.trim(),

  'Convert Browsers': `
Hooks for this outcome crystallize the private moment of decision — not "confidence" as a trait, but the specific instant when someone stops comparing and starts owning their choice.

## Sensory seeds
- Pulling a jacket off the hanger and putting it on without checking the mirror again
- The sound of a car door closing when you've already decided where you're going
- Setting down a menu and looking up at the waiter — done choosing
- Peeling the plastic film off something new
- Walking past every other option without slowing down

## Anti-clustering rules
- Each hook must depict a DIFFERENT act of choosing. No two hooks about the same type of decision (no two about clothing, no two about food, no two about direction).
- Alternate between the moment BEFORE the decision locks (anticipation, narrowing) and the moment AFTER (relief, momentum, ownership).
- No two hooks should end on the same word class. If one ends on a noun, the next ends on a verb or adverb.

## Spread vectors
1. Decision type: purchase vs. direction/path vs. relationship vs. self-definition
2. Finality: soft commit (leaning in) vs. hard commit (done, irreversible) vs. retrospective (already chose, looking back)
3. Speed: snap decision vs. slow certainty vs. relief after deliberation
4. Evidence: tactile proof (holding it, wearing it) vs. spatial (walking toward) vs. verbal (saying it aloud)

## Do NOT use
- "everything I need is right here" or any variant of "all I need"
- "right here right now" as a phrase
- "choice" / "confidence" / "decision" as named abstractions — show the act, don't label the feeling
- Any hook that works as a motivational poster caption
`.trim(),

  'Move Through': `
Hooks for this outcome capture forward motion — not "going somewhere" abstractly, but the physical sensation of a body in transit, unburdened.

## Sensory seeds
- The pull of a revolving door pushing you onto the sidewalk
- Headphones on, crossing an intersection on the green without breaking stride
- The last sip of coffee before standing up and heading out
- Wind hitting your face the second you step off a bus
- Keys already in hand three steps before the door

## Anti-clustering rules
- Each hook must use a DIFFERENT mode of movement. No two about walking, no two about driving, no two about doors.
- Vary the direction: forward, upward, outward, through, past. Never repeat the same directional vector in consecutive hooks.
- No two hooks should place the speaker in the same environment (street, hallway, vehicle, stairway, threshold).

## Spread vectors
1. Speed: brisk walk vs. run vs. drift vs. purposeful stride
2. Terrain: urban (sidewalk, elevator, subway) vs. interior (hallway, staircase, aisle) vs. open (field, parking lot, bridge)
3. Motivation: escaping FROM vs. heading TOWARD vs. just moving (no destination)
4. Body awareness: legs/feet vs. whole body vs. breath vs. the space opening up ahead

## Do NOT use
- "out the door" or any variant with "door" as the exit metaphor
- "one more step" or "step by step"
- "on my way" as a standalone phrase
- Abstract motion words: journey, path, road (unless naming a literal road in a scene)
`.trim(),

  'Reinforce Brand': `
Hooks for this outcome embed the feeling of belonging to something worth belonging to — not loyalty as a concept, but the private satisfaction of recognition, of being known by a place or thing.

## Sensory seeds
- The bartender already pouring your usual before you sit down
- Wearing a shirt so long the collar sits exactly right
- Recognizing a song from across a parking lot and knowing which store it's coming from
- The way a regular's name sounds different than a stranger's name in the same greeting
- A logo on a bag you're not embarrassed to carry

## Anti-clustering rules
- Each hook must depict a DIFFERENT relationship between person and brand/place/thing. No two about recognition, no two about familiarity, no two about pride.
- Alternate between the brand coming to the person (recognition, anticipation) and the person going to the brand (returning, choosing again, defending).
- No two hooks should share the same emotional temperature. Vary: warm/nostalgic, cool/assured, defiant/proud, quiet/understated.

## Spread vectors
1. Relationship stage: first real click vs. deep familiarity vs. explaining it to someone else vs. defending the choice
2. Evidence type: sensory (smell, texture, sound) vs. social (how others react) vs. internal (private satisfaction)
3. Brand manifestation: physical product vs. place/space vs. experience vs. community
4. Speaker stance: grateful vs. matter-of-fact vs. protective vs. evangelical

## Do NOT use
- "nothing left to prove" or "don't need to prove"
- "trust the" + any noun
- "this is who I am" or identity-declaration statements
- Any hook that sounds like a brand manifesto or ad copy
`.trim(),

  'Linger': `
Hooks for this outcome stretch a moment — not "take your time" as advice, but the physical experience of time slowing because you're absorbed in where you are.

## Sensory seeds
- Tracing a finger along a shelf edge while your eyes catch something three rows down
- The second glass of wine when you've stopped counting
- Sunlight moving across a table so slowly you only notice when your hand is warm
- Flipping a book open in a store and reading a full page standing up
- The smell of something cooking that makes you forget you were about to leave

## Anti-clustering rules
- Each hook must anchor in a DIFFERENT reason for staying. No two about browsing, no two about comfort, no two about distraction.
- Alternate between active lingering (choosing to stay, noticing something new) and passive lingering (forgetting to leave, losing track of time).
- No two hooks should have the same temporal relationship to departure: some should be pre-departure (haven't thought about leaving yet), some mid-departure (were about to go but stopped), some post-departure (came back).

## Spread vectors
1. Attention type: focused (locked on one thing) vs. diffuse (drifting, scanning) vs. arrested (something stopped you)
2. Sense: visual (seeing something) vs. tactile (touching, holding) vs. olfactory (smell pulling you) vs. auditory (a sound that holds you)
3. Social: alone vs. with someone vs. crowd-ambient
4. Awareness: conscious choice to stay vs. unconscious (time just passed) vs. moment of realization (oh, I'm still here)

## Do NOT use
- "before you think about it" or "before you know it"
- "take my time" or "taking my time"
- "no rush" or "what's the rush"
- Any hook that sounds like advice or instruction to the listener
- Abstract time words: moment, forever, eternity (unless grounded in a physical scene)
`.trim(),

}

;(async () => {
  const p = new PrismaClient()
  try {
    const outcomes = await p.outcome.findMany({
      where: { supersededAt: null },
      select: { outcomeKey: true, displayTitle: true, title: true },
    })

    const keyByDisplay = new Map<string, string>()
    for (const o of outcomes) {
      const label = o.displayTitle ?? o.title
      keyByDisplay.set(label, o.outcomeKey)
    }

    let updated = 0
    let skipped = 0
    for (const [displayTitle, templateText] of Object.entries(FACTORS)) {
      const outcomeKey = keyByDisplay.get(displayTitle)
      if (!outcomeKey) {
        console.warn(`⚠ No active outcome found for "${displayTitle}" — skipping`)
        skipped++
        continue
      }

      await p.outcomeLyricFactor.upsert({
        where: { outcomeKey },
        update: { templateText, notes: 'v2 — sensory seeds + anti-clustering (lyric repetition fix)' },
        create: { outcomeKey, templateText, notes: 'v2 — sensory seeds + anti-clustering (lyric repetition fix)' },
      })
      console.log(`✓ ${displayTitle} (${outcomeKey})`)
      updated++
    }

    console.log(`\nDone: ${updated} updated, ${skipped} skipped`)
  } finally {
    await p.$disconnect()
  }
})()
