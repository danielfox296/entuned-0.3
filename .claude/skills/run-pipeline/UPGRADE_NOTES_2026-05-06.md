# run-pipeline upgrade notes — 2026-05-06 run

Issues found during a pipeline run for Marissa (hello@entuned.co / Core / ICP `df867e51`). Capture every friction point here so the skill can be upgraded after the run.

## Findings

### 1. Login screen flashes on dash load even when authed
- Symptom: navigating to `dash.entuned.co` first paints the sign-in form (email prefilled, password empty) for ~1 frame before the authed UI mounts.
- Why it tripped me up: I tried to wait for Daniel to enter a password.
- Fix for skill: add a "Login screen briefly flashes on `/` even when authenticated — wait ~500ms and re-screenshot before deciding to halt for credentials. If `#workflows` (or any authed hash) is in the URL, treat as logged in." note in Setup.

### 2. Skill is hardcoded to Untuckit / Park Meadows / Gary
- The Setup section names a single client/location/ICP. The skill must accept any client + store + ICP via arguments.
- Hook→Prompt and Pool Depth filters reference "Gary" by name; needs to read the ICP arg and apply that filter instead.
- Fix for skill: replace the static "Setup" with a "Resolve targets from ARGUMENTS" step (clientId / storeId / icpId / icpName). All filter steps reference these vars.

### 3. ICPs created via app surface have empty refs / hooks / voiceNotes
- Self-serve intake captures psychographic + free-text musical-taste descriptors but does NOT seed reference tracks, hooks, or voice notes.
- The pipeline must handle that bootstrap (likely: derive reference tracks from the free-text "desires" + "turn-offs" fields, write voice notes from psychographic profile, then fall through to seed-hooks).
- Fix for skill: add Step 0 — "Bootstrap an empty ICP" — before Step 1 assessment.

### 4. Outcome taxonomy — RESOLVED
- GENERATION.md updated to use the current 9 display names: Calm, Lift Energy, Reinforce Brand, Convert Browsers, Move Through, Linger, Impulse Buy, Increase Order Value, Add More Items.
- Legacy 4-mode slugs removed from all docs. Hendrix API now returns `displayTitle` to player.

### 5. Default-outcome picker should be psychographic-driven (not operator guess)
- Picked "Convert Browsers" for Marissa from her stated desires ("just browsing… looking for a good value on a wow item") — a 5-second judgment call but currently fully manual.
- Fix for skill: derive default outcome from ICP intake fields (desires + openness + age) and propose it; operator just confirms.

### 6. Bulk decompose endpoint exists but UI only does single-track
- Reference Tracks tab only exposes per-track decompose via the modal. With 32 approved tracks for Marissa that's untenable through UI.
- Server already has `POST /admin/reference-tracks/decompose-all` (sequential) and per-track `POST /admin/reference-tracks/:id/decompose`.
- This run: hit per-track endpoint 32× from browser console with `Authorization: Bearer ${localStorage['entuned.admin.token']}`, in waves of 8. Total elapsed: 135s. All 200 OK.
- Fix for skill: codify "fire 8 parallel decompose calls until empty" as the reference-decompose step; auth via `entuned.admin.token` localStorage key. Also: surface a "decompose all" button in the UI (probably ICP-scoped, not global).

### 7. Approve-all suggested 33 tracks for an ICP — too many, no curation
- "approve all (33)" button auto-approved every suggestion. Spread looked good (Carly Simon, Carole King, Fleetwood Mac, Carpenters, Avett Brothers, Sade, Norah Jones, Iron & Wine for Marissa) but 33 is overkill for a single ICP — system will probably never use 25+ of them.
- Fix for skill: cap suggestion count at ~12-15, or apply a curation step that scores candidates against the ICP's psychographic vector and only auto-approves the top N.

### 8. Schema has dropped `voiceNotes` field
- GENERATION.md says voiceNotes is a Lane C lyric input from `corporateIcp.voiceNotes` or `storeIcp.voiceNotes`.
- Live ICP model has no `voiceNotes` column. Psychographic fields (values, desires, unexpressedDesires, turnOffs, fears) appear to have absorbed that role.
- Fix for skill + GENERATION.md: drop voice-notes step entirely. Update lyric-generation skill to read psychographic fields directly.

### 9. populate-songs Suno Create silently no-ops on freshly-configured tab
- Tabs 73 and 74 (Choose This Right, Something in Me) had clean inject + verified vocal toggle, but Create button did nothing — sidebar stayed empty after 10s.
- Workaround that fixed it: vocal-toggle trick (click opposite gender to deselect target, click target again to re-select) THEN Create.
- Side effect: original Create attempt also eventually fired, producing 4 takes per tab. Accepted top 2 only.
- This is already documented in populate-songs friction note 19 — confirmed real and required.

### 10. Auth: API needs Authorization header — cookies alone don't auth
- First parallel decompose attempt with `credentials: 'include'` returned 32× 401.
- Adding `Authorization: Bearer ${localStorage['entuned.admin.token']}` fixed all 32. Retry: 32× 200, 135s elapsed.
- Fix for skill: ALWAYS include the bearer header; cookies are insufficient for admin routes.

### 11. Final result of this run
- 5 hooks generated + approved for Marissa under Convert Browsers
- 5 song-seed prompts produced via Eno seed builder
- 10 Suno takes generated (5 prompts × 2 takes), all accepted into Marissa's library
- Pool depth for [Marissa × Convert Browsers]: CRITICAL (0) → THIN (10)
- Total R2 audio added: 35.1 MB
- End-to-end elapsed: ~30 min

### 12. Skill rewrite shipped
- `SKILL.md` rewritten 2026-05-06 to support arbitrary client/store/ICP, document the bootstrap step, reference the live 9-outcome taxonomy, and codify the API-batch shortcuts (decompose-all, hook-approve-all, song-seed-accept) instead of clicking through the UI.

(continue appending as we hit more issues)
