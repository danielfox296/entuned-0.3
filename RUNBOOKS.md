# Entuned v0.3 — Operator Runbooks

API base: `https://entuned-03-production.up.railway.app`  
All routes require `Authorization: Bearer $TOKEN` except `/auth/login`.  
All POST/PUT bodies are `Content-Type: application/json`.  
POST bodies with no request body must omit the Content-Type header entirely (Fastify rejects empty JSON bodies).

---

## Runbook 1 — Full Client Program Build

Builds a client from scratch: client → store → ICP → reference tracks → decompose → hooks → Eno seed assembly → schedule. Ends with queued SongSeeds ready for Suno generation.

**State variables** (capture from each step, pass into subsequent ones):

```
$TOKEN
$CLIENT_ID
$STORE_ID
$ICP_ID
$OUTCOME_ID          (repeat per outcome)
$SEED_ID             (repeat per seed)
```

---

### Step 1 — Authenticate

```
POST /auth/login
{ "email": "daniel@entuned.co", "password": "1" }
→ save token as $TOKEN
```

---

### Step 2 — Create Client

```
POST /admin/clients
{
  "companyName": "...",
  "plan": "mvp_pilot",
  "brandLyricGuidelines": "..."
}
→ save id as $CLIENT_ID
```

`brandLyricGuidelines`: 2–4 sentences. What the brand voice is, what to avoid, what subject matter fits. This feeds directly into lyric generation.

---

### Step 3 — Create Store

```
POST /admin/stores
{
  "clientId": $CLIENT_ID,
  "name": "...",
  "timezone": "America/Denver",
  "goLiveDate": null,
  "defaultOutcomeId": $OUTCOME_ID   (set after outcomes are confirmed — update later if needed)
}
→ save id as $STORE_ID
```

`timezone`: IANA timezone string for the location. Used by the schedule engine.

---

### Step 4 — Create ICP

```
POST /admin/icps
{ "storeId": $STORE_ID, "name": "..." }
→ save id as $ICP_ID
```

One ICP per store. Returns 409 if a store already has one.

---

### Step 5 — Fill ICP Psychographic Fields

```
PUT /admin/icps/$ICP_ID
{
  "ageRange": "35–55",
  "location": "...",
  "politicalSpectrum": "...",
  "openness": "...",
  "fears": "...",
  "values": "...",
  "desires": "...",
  "unexpressedDesires": "...",
  "turnOffs": "..."
}
```

All fields optional but the more complete the ICP, the better the hook writer output. Write these as you would brief a copywriter — specific, opinionated, in plain English.

---

### Step 6 — Add Reference Tracks

Repeat for each track. Aim for 9 total: 3 per bucket.

```
POST /admin/icps/$ICP_ID/reference-tracks
{
  "bucket": "FormationEra" | "Subculture" | "Aspirational",
  "artist": "...",
  "title": "...",
  "year": 1999,
  "operatorNotes": "..."
}
→ save id as $TRACK_ID
```

**Buckets:**
- `FormationEra` — music the customer grew up with (defines their sonic baseline)
- `Subculture` — genre/community identity signals (who they see themselves as)
- `Aspirational` — emotional destination (where the brand wants to take them)

`operatorNotes`: why this track for this ICP. One sentence. Feeds into decomposition context.

---

### Step 7 — Decompose Reference Tracks

Run once per track. No request body — omit Content-Type header.

```
POST /admin/reference-tracks/$TRACK_ID/decompose
→ returns StyleAnalysis with status="draft"
```

Calls Claude with web search. Takes 10–30 seconds per track. Writes to `style_analyses` table. Fields populated: `vibe_pitch`, `era_production_signature`, `instrumentation_palette`, `standout_element`, `arrangement_shape`, `dynamic_curve`, `vocal_character`, `vocal_arrangement`, `harmonic_and_groove`.

Run all 9 tracks. Eno will fail to assemble seeds for any ICP with no decomposed tracks.

---

### Step 8 — Confirm Active Outcomes

```
GET /admin/outcomes
→ array of Outcome objects (only non-superseded ones matter)
```

Each Outcome has: `id`, `title`, `tempoBpm`, `mode`, `dynamics`, `instrumentation`.  
The global library ships with 9 outcomes. Identify which ones the schedule will use.  
Save the IDs you'll need as `$LINGER_OUTCOME_ID`, `$MOVE_OUTCOME_ID`, etc.

To create a new outcome:
```
POST /admin/outcomes
{
  "title": "...",
  "tempoBpm": 88,
  "mode": "major" | "minor" | "modal",
  "dynamics": "soft" | "medium" | "loud" | "soft-medium" | "medium-loud",
  "instrumentation": "..."
}
→ save id as $OUTCOME_ID
```

To edit an existing outcome (creates new version, supersedes old — immutable history):
```
PUT /admin/outcomes/$OUTCOME_ID
{ same shape as POST }
→ returns new version record with new id
→ re-save new id as $OUTCOME_ID
```

---

### Step 9 — Build Schedule

One slot per time window per day. Windows that aren't covered by a slot fall back to the store's `defaultOutcomeId`.

```
POST /admin/stores/$STORE_ID/schedule
{
  "dayOfWeek": 1,          (1=Mon … 7=Sun)
  "startTime": "10:00",
  "endTime": "14:00",
  "outcomeId": $OUTCOME_ID
}
```

Repeat for every window. Common pattern for retail:
- Opening 2 hrs → Linger
- Lunch window → Move Through
- Afternoon prime → Move
- Evening wind-down → Linger
- Saturday peak all-day → Move

Update store default to the outcome with the most coverage so gaps don't produce silence:
```
PUT /admin/stores/$STORE_ID
{ "defaultOutcomeId": $OUTCOME_ID }
```

---

### Step 10 — Run Hook Writer

Runs Claude against the ICP + outcome to draft hooks. Returns an array of strings.

```
POST /admin/icps/$ICP_ID/hook-writer/run
{ "outcomeId": $OUTCOME_ID, "n": 8 }
→ { "hooks": ["text 1", "text 2", ...] }
```

Review the hooks. Discard any that feel off. Then bulk-create and approve in one call:

```
POST /admin/icps/$ICP_ID/hooks/bulk
{
  "outcomeId": $OUTCOME_ID,
  "texts": ["text 1", "text 2", ...],
  "approve": true
}
→ { "created": 8 }
```

Run for each outcome that will receive seeds. Aim for at least 6 approved hooks per outcome — Eno needs one hook per seed, and it won't reuse a hook that already has a queued/accepted seed against it.

---

### Step 11 — Run Eno (Seed Assembly)

Eno picks hooks + reference tracks, runs Mars (style builder) + Bernie (lyric writer), and produces fully-assembled SongSeeds ready to paste into Suno. One call per outcome.

```
POST /admin/eno/run
{
  "icpId": $ICP_ID,
  "outcomeId": $OUTCOME_ID,
  "n": 8
}
→ {
    "songSeedBatchId": "...",
    "producedN": 8,
    "reason": "complete" | "pool_exhausted" | "precheck_failed",
    "errors": []
  }
```

If `reason` is `pool_exhausted`, there aren't enough approved hooks or decomposed reference tracks. Add more of whichever is missing and re-run.

Run for each outcome.

---

### Step 12 — Retrieve Queued Seeds for Suno

```
GET /admin/song-seeds?icpId=$ICP_ID&status=queued&limit=100
→ array of SongSeed objects
```

Each seed has:
- `id` — needed for the accept call
- `style` — paste into Suno's Style field
- `negativeStyle` — paste into Suno's Exclude field
- `lyrics` — paste into Suno's Lyrics field
- `title` — suggested song title
- `hook.text` — the hook this seed was built on
- `outcome.title` — which outcome this seed belongs to

Get full detail for any seed:
```
GET /admin/song-seeds/$SEED_ID
```

---

### Step 13 — Generate in Suno (manual)

For each queued seed:
1. Open Suno → Custom mode
2. Paste `style` → Style field
3. Paste `negativeStyle` → Exclude field
4. Paste `lyrics` → Lyrics field
5. Set title from `title` field
6. Generate 2 takes
7. Copy the share link for each take (`suno.com/s/<code>`)

Suno share links (`suno.com/s/<code>`) are automatically resolved to CDN audio on accept. Direct CDN URLs (`cdn1.suno.ai/<uuid>.mp3`) also work.

---

### Step 14 — Accept Seeds (creates LineageRows)

One call per seed. Pass both takes as an array.

```
POST /admin/song-seeds/$SEED_ID/accept
{
  "takes": [
    { "sourceUrl": "https://suno.com/s/XXXXXXXXXXXXXXXX" },
    { "sourceUrl": "https://suno.com/s/YYYYYYYYYYYYYYYY" }
  ]
}
→ {
    "songSeed": { "status": "accepted", ... },
    "lineageRows": [ { "id": "...", "r2Url": "...", ... }, ... ]
  }
```

The server downloads each take, verifies it's real audio (rejects HTML/expired links), re-uploads to R2, and creates a `LineageRow` pointing to the stable R2 URL. After this call the song is in the active pool for this ICP + outcome.

Accept is terminal — an accepted seed cannot be un-accepted via API. Revert via DB if needed.

---

### Step 15 — Verify Store is Ready to Play

```
GET /hendrix/next?store_id=$STORE_ID
Authorization: Bearer $TOKEN
→ {
    "storeId": "...",
    "activeOutcome": { "outcomeId": "...", "source": "schedule" | "override" | "default" },
    "queue": [ { "songId": "...", "audioUrl": "...", "hookId": "...", "outcomeId": "..." }, ... ],
    "fallbackTier": "sibling_spacing" | "none",
    "reason": null
  }
```

Queue length > 0 means the store is playable. `source=schedule` means the current time matched a schedule slot. `source=default` means it fell back to the store's default outcome. If queue is empty, at least one of: no accepted seeds for the active outcome, no schedule/default configured, or the store doesn't exist.

---

## Runbook 2 — Engine Prompt CRUD Smoke Test

Verifies every editable engine prompt is writable. Run after any schema migration or server deploy.

```
GET  /admin/musicological-rules          → { latest: { rulesText, version, ... }, history: [...] }
POST /admin/musicological-rules          { rulesText: "...", notes: "..." }

GET  /admin/style-template               → { latest: { templateText, version, ... }, history: [...] }
POST /admin/style-template               { templateText: "...", notes: "..." }

GET  /admin/outcome-factor-prompt        → { latest: { templateText, version, ... }, history: [...] }
POST /admin/outcome-factor-prompt        { templateText: "...", notes: "..." }

GET  /admin/lyric-prompts                → { draft: { latest, history }, edit: { latest, history } }
POST /admin/lyric-prompts/draft          { promptText: "...", notes: "..." }
POST /admin/lyric-prompts/edit           { promptText: "...", notes: "..." }

GET  /admin/style-exclusion-rules        → array of rules
POST /admin/style-exclusion-rules        { triggerField, triggerValue, exclude, overrideField?, overridePattern?, note? }
PUT  /admin/style-exclusion-rules/$ID    same shape as POST
DELETE /admin/style-exclusion-rules/$ID  no body
```

All prompt endpoints create a new versioned row on POST — they never mutate in place. History is preserved. `latest` is always the highest version.

---

## Runbook 3 — Operator Management

### Create operator

```
POST /admin/operators
{
  "email": "store@client.com",
  "password": "...",
  "displayName": "Park Meadows",
  "storeIds": ["$STORE_ID"]
}
→ OperatorRow
```

### Update operator (email / password / stores / disable)

```
PUT /admin/operators/$OPERATOR_ID
{
  "email": "...",          (optional)
  "password": "...",       (optional — omit to keep current)
  "displayName": "...",    (optional)
  "storeIds": ["..."],     (optional — full replacement, not append)
  "disabled": true | false (optional)
}
→ OperatorRow
```

Disabled operators cannot log in. Admin operators (`isAdmin=true`) cannot be disabled via this route.

### List operators

```
GET /admin/operators
→ array of { id, email, displayName, isAdmin, disabledAt, stores: [{ id, name }] }
```

---

## Runbook 4 — Outcome Override (Oscar player)

Set a manual outcome override for a store (bypasses schedule for 4 hours):

```
POST /hendrix/outcome-selection
{ "store_id": $STORE_ID, "outcome_id": $OUTCOME_ID }
→ { "outcomeId": "...", "expiresAt": "ISO8601" }
```

Clear the override (returns to schedule):

```
POST /hendrix/outcome-selection/clear
{ "store_id": $STORE_ID }
→ { "ok": true }
```

Both endpoints require an operator token (not admin-only). The operator must be assigned to the store.

---

## Notes

**Eno preconditions** — `POST /admin/eno/run` will return `pool_exhausted` if:
- No approved hooks exist for the ICP + outcome combination, or
- No reference tracks with completed style analyses exist for the ICP.
Run Steps 7, 10 before Step 11.

**Outcome versioning** — `PUT /admin/outcomes/$ID` supersedes the old record and creates a new one with a new `id`. All existing hooks, schedule slots, and lineage rows stay pinned to the old version's ID. New seeds pick up the new version. Always re-save the returned `id` after an outcome edit.

**Token expiry** — JWTs are long-lived but not permanent. Re-authenticate if you get 401s mid-run.

**DB wipe pattern** — To reset to a clean state (keep system prompts + outcomes + admin operator, wipe all content):
```sql
TRUNCATE lineage_rows, songs, hooks, hook_writer_prompt_versions,
         hook_writer_prompts, song_seeds, song_seed_batches,
         playback_events, schedule_slots, reference_tracks,
         style_analyses, icps, operator_store_assignments,
         stores, clients CASCADE;
DELETE FROM operators WHERE is_admin = false;
```
