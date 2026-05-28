# Lyric Ban List Audit — 2026-05-27

**Total entries:** 128
**Recommended retire:** 45
**Keep:** 80
**Requires Daniel's judgment:** 3

## Methodology

Entuned songs are consumed in a retail moment but must not be *about* a retail moment. The hypothesis driving this audit: many entries in `LyricBanEntry` are post-hoc patches for retail-scene contamination that originated upstream in `OutcomeLyricFactor.templateText` and the Hook Drafter system prompt — both of which are being rewritten in parallel. With the upstream contamination fixed, those patches likely become unnecessary and may even over-constrain vocabulary for outcomes that legitimately need everyday-life imagery (a porch, a coffee, a road) rendered as universal human scene rather than retail-floor scene.

Classification rules applied:
- **A (KEEP)** — appears in `OVERUSED_WORDS` / `AI_CLICHE_PHRASES` / `AI_CLICHE_SHAPES` cold-start fallback, or note explicitly says "migrated from inline Hook System Prompt". Universal AI-generation tells.
- **B (KEEP)** — specific phrases banned by Daniel's editorial decision, no domain-overlap concern.
- **C (RETIRE CANDIDATE)** — words/phrases with the "over-relied on in recent batches" note from 2026-05-25 (the post-hoc-patch wave) OR null-note entries whose surface meaning maps directly onto retail still-life vocabulary (kitchen, coffee, window, door, shift, the morning) that the upstream rewrite specifically targets.
- **D (JUDGMENT)** — ambiguous; not clean retail-leak but not classical AI slop either.

## Category A — Universal AI slop (KEEP)

Count: **79**

| text | category | rationale |
|---|---|---|
| "Every night I [verb]" | cliche_shape | AI-lyric cliché shape; banned regardless of domain. |
| "I'll never [verb] again" | cliche_shape | AI-lyric cliché shape; banned regardless of domain. |
| afternoon glow | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| air sat heavy | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| ancient | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| ascend | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| ashes | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| awakening | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| breaking chains | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| breaking free | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| cascade | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| celestial | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| chains | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| chasing dreams | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| chasing shadows | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| city lights | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| concrete jungles | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| cosmic | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| crescendo | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| dancing shadows | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| distant echoes | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| divine | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| dreamscape | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| dreamy | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| dusk | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| easy | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| echo chamber | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| echoes of | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| electric dreams | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| embrace | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| enchanted | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| eternal | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| ethereal | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| everlasting | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| fading light | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| flame | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| flickering | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| forgotten tales | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| gentle | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| ghosts | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| glow | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| golden | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| groove | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| guiding light | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| harmony | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| hazy | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| heartbeat | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| hidden | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| hollow | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| illuminated | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| in the shadows | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| infinite | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| into the night | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| labyrinths | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| let it ___ | cliche_shape | AI-lyric cliché shape; banned regardless of domain. |
| lost in the shadows | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| magical | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| midnight | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| mirrors | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| moonlight | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| mystic | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| neon | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| peace | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| phantom | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| pulse | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| radiant | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| raging storm | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| rebel spirit | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| reborn | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| resonate | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| rise above | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| rise like a phoenix | cliche_phrase | Stock AI-lyric cliché phrase migrated from Hook System Prompt; cross-domain reach. |
| shadows | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| silence | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| starlit | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| surrender | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| there was a time when | cliche_shape | AI-lyric cliché shape; banned regardless of domain. |
| weightless | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |
| whispers | overused_word | Generic AI-lyric reach word; present in OVERUSED_WORDS cold-start fallback. |

## Category B — Brand/editorial bans (KEEP)

Count: **1**

| text | category | rationale |
|---|---|---|
| good with that, just the way you are | cliche_phrase | Daniel editorial ban — specific anti-platitude rule, no domain-overlap concern. |

## Category C — Patches for upstream retail contamination (RETIREMENT CANDIDATES)

Count: **45**

Confidence convention: **high** = note explicitly says "over-relied on in recent batches" (the post-hoc wave) OR text is a literal retail-floor noun (kitchen, shift, door, jacket, dashboard, the morning, out the door). **medium** = null-note but tightly clustered with the high-confidence retail-leak vocabulary (chair, cup, coffee, dust, tea, window, pavement, road, glass). **low** = ambiguous retrospective/tonal phrases that *could* still recur after upstream rewrite (gone cold, i used to, something shifted).

| text | category | original note | reason it's likely a patch | confidence |
|---|---|---|---|---|
| afternoon | overused_word | added 2026-05-25 — over-relied on in recent batches | Time-of-day word over-emitted because retail-scene context primed dayparts. | high |
| ceiling fan | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Quintessential 'still room' interior; patches retail-adjacent kitchen/home scene that Outcome prompts contaminated. | high |
| chair | overused_word | — | Retail-still-life noun (waiting/sitting room). | medium |
| coffee | overused_word | — | Retail-still-life noun (cafe/kitchen scene leak). | medium |
| coffee's | overused_word | — | Possessive variant of coffee — same root cause. | medium |
| cup | overused_word | — | Retail-still-life noun (cafe/kitchen scene leak). | medium |
| dashboard | overused_word | — | Car-dashboard noun, retail-commute scene leak. | high |
| dog | overused_word | added 2026-05-25 — over-relied on in recent batches | Domestic-scene noun appearing in kitchen/home retail-still-life lyrics. | high |
| door | overused_word | added 2026-05-25 — over-relied on in recent batches | Retail-store noun (customer/store entry) — direct retail-moment vocabulary. | high |
| dust | overused_word | — | Retail-still-life noun (untouched-shelf imagery). | medium |
| ease | overused_word | added 2026-05-25 — over-relied on in recent batches | Tonal-anchor word from Calm outcome templateText. | high |
| feet | overused_word | added 2026-05-25 — over-relied on in recent batches | Body-part word emitted in still-room domestic scenes. | high |
| glass | overused_word | — | Retail-still-life noun (window/glass image). | medium |
| going cold | cliche_phrase | — | Coffee/tea-getting-cold image; retail still-life leak. | low |
| gone cold | cliche_phrase | — | Same as 'going cold' — retail still-life. | low |
| i used to | cliche_phrase | — | Retrospective opener cliché from old transformation arc prompts. | low |
| I Used to | cliche_phrase | — | Capitalized variant of 'i used to' — same retrospective cliché. | low |
| i'm learning how to | cliche_phrase | — | Self-help opener phrase from contaminated outcome prompts. | low |
| Jacket | overused_word | — | Capitalized stray; clothing-retail vocabulary leak. | high |
| just this | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Tonal anchor phrase emitted by old Outcome.templateText 'present-moment' factor. | high |
| kitchen | overused_word | — | Retail-adjacent domestic scene noun — explicit place name. | high |
| my skin | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Body/sensation cliché from old Calm Anchor outcome prompts. | high |
| no deadline | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Direct retail/work-stress denial — appeared because retail-moment context leaked upstream. | high |
| no rush | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Retail/work-stress denial phrase from contaminated outcome prompts. | high |
| noise | overused_word | added 2026-05-25 — over-relied on in recent batches | Retail-floor-noise denial vocabulary leaked from outcome prompts. | high |
| nothing to prove | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Reassurance trope tied to retail-customer-anxiety upstream context. | high |
| out the door | cliche_phrase | — | Retail-store action vocabulary (customer leaving) — direct retail-moment leak. | high |
| pavement | overused_word | — | Street/retail-exterior noun. | medium |
| porch light | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Domestic still-life image — same kitchen/home centroid as ceiling fan. | high |
| quiet room | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Retail-store-interior proxy that hook drafter kept landing on. | high |
| road | overused_word | — | Driving/transit noun, leaks via 'on the way to work' opening-shift context. | medium |
| settled | overused_word | added 2026-05-25 — over-relied on in recent batches | Calm-outcome tonal anchor word. | high |
| shift | overused_word | added 2026-05-25 — over-relied on in recent batches | Retail-context vocabulary (work shift) — direct retail-moment leak. | high |
| shifted | overused_word | — | Same as 'shift' — retail-context past-tense. | high |
| something shifted | cliche_phrase | — | Generic transformation phrase from outcome 'change' factor language. | low |
| story untold | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Generic placeholder phrase from outcome templateText filler. | high |
| sun | overused_word | added 2026-05-25 — over-relied on in recent batches | Daypart cliché word from retail-scene-primed lyrics. | high |
| sun hits | cliche_phrase | — | Cinematic morning-light cliché tied to opening-shift outcomes. | medium |
| takes the time | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Retail-service phrase — leaked from customer-experience context. | high |
| tea | overused_word | — | Cafe/retail still-life noun. | medium |
| the morning | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Time-of-day stock opener appearing in opening-routine outcomes. | high |
| warm | overused_word | added 2026-05-25 — over-relied on in recent batches | Tonal-anchor adjective from Calm/Cozy outcome templateText. | high |
| warm in my skin | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Body-comfort cliché from Calm/Settled outcome prompts. | high |
| window | overused_word | — | Retail-storefront-window noun — direct retail-moment vocabulary. | medium |
| word unsaid | cliche_phrase | added 2026-05-25 — over-relied on in recent batches | Placeholder narrative phrase from outcome templateText filler. | high |

## Category D — Requires Daniel's judgment

Count: **3**

| text | category | original note | concern |
|---|---|---|---|
| reciept | overused_word | — | Misspelled 'receipt' — looks like a typo'd intentional ban on a specific noun. Unclear if the misspelling is intentional (catches model-emitted misspellings) or accidental. Worth a one-line Daniel decision. |
| settings in a house or kitchen | cliche_shape | — | Shape rule that explicitly forbids the kitchen-scene centroid. May become redundant once upstream is fixed — or it may be the load-bearing rule that prevents kitchen leaks regardless of upstream. Daniel should decide whether to keep as defense-in-depth. |
| traced | overused_word | — | Null-note, single past-tense verb. Could be an AI-slop reach word (traced lines, traced the edge) or a deliberate ban. Not clearly retail-scene, not clearly slop. Daniel's call. |

## Recommended next step

After OutcomeLyricFactor + Hook Drafter rewrites are live, generate ~20 hook+lyric pairs across multiple outcomes (Calm Anchor, Opening Shift, Closing Down, Slow Stretch — the outcomes most likely to have leaked retail-scene language) and observe whether the Category C words reappear. If they don't, retire Category C in bulk. If some do, retire the rest and keep the persistent ones. Re-audit Category D in the same pass.