---
name: make-song-seeds
description: Run Eno (the per-seed orchestrator — Mars style + Bernie lyrics + form archetype + outcome prepend) for one or more (ICP × outcome × n) tuples without opening a browser. Produces `SongSeed` rows in the `queued` state, ready for `populate-songs`. Use when Daniel says "make song seeds for X", "seed N for [outcome]", "fill the song queue", or "queue up some prompts for [ICP]." Browser-free — runs against the prod server over `railway ssh`. Requires approved hooks; if pool is empty, run `draft-hooks` first.
---

# make-song-seeds

Browser-free `runEno` invocation. Replaces the manual Dash flow ("Workflows → Pipeline → click outcome card → build N") with one `railway ssh` call per (ICP × outcome).

The artifacts produced are **byte-identical** to what the browser writes: same `runEno()` call, same `SongSeedBatch` row with full provenance (icpId, outcomeId, requestedN, producedN, reason, triggeredBy, triggeredByUser, pipeline, startedAt, finishedAt), same `SongSeed` rows with hook/refTrack/outcome IDs + style + negativeStyle + lyrics + all version snapshots (lyricDraftPromptVersion, lyricEditPromptVersion, styleTemplateVersion, outcomeFactorPromptVersion, marsPromptVersion, hookWriterPromptVersion, formArchetypeVersion, arrangementTemplateVersion).

## Pre-flight (read this first)

**Working directory:** every `railway ssh` call must run from the monorepo root (`entuned-0.3/`). From `~/Desktop/entuned/` one level up, `railway ssh` fails with `No linked project found`. Always prefix with `cd entuned-0.3 &&`.

**SSH auth:** `railway ssh` uses `~/.ssh/railway_ed25519` (passphrase-less ed25519). `~/.ssh/config` has a `Host ssh.railway.com` block pinning that key with `IdentitiesOnly yes`, so auth works flag-free. Do NOT pass `--identity-file`. If you get `Permission denied (publickey)`, check `~/.ssh/config` still has the Host block and `railway ssh keys list` still shows the `railway-cli` key — see `entuned-0.3/CLAUDE.md` → Railway SSH.

## railway ssh escaping rules (read this first)

Every script in this skill is shell-wrapped like:
```
cd entuned-0.3 && railway ssh "cd /app && node -e '<JS-here>'"
```

Three quoting layers nest: outer `"..."` (shell arg) → inner `'...'` (node -e arg) → `\"` (JS string literals). Two `$` rules:

- **`\$` (escaped)** when you want the JS code to use `$` — e.g., `await p.\$disconnect()`. Without the backslash, the shell would substitute `$disconnect` as an empty env var.
- **`$VAR` (unescaped)** when you want the shell to substitute a variable you set in the same line — e.g., `\"$ICP_ID\"` inserts the value of `$ICP_ID` from your local shell.

Prisma model names are **camelCase with lowercased acronyms**: `prisma.iCP` (not `prisma.ICP`), `prisma.hook`, `prisma.songSeed`, `prisma.account`.

## When to use

Triggers (auto-fire — no need to ask permission):
- "make song seeds for [ICP/outcome]"
- "seed N for [outcome]"
- "queue up some prompts for [ICP]"
- "fill the song queue"
- `populate-songs` reported the queue is short — call this first
- The Dash Pool Depth panel shows a critical (ICP × outcome) cell

Do NOT use for:
- Generating hooks — that's `draft-hooks`
- Pushing seeds to Suno + accepting takes — that's `populate-songs` (browser, Chrome MCP)
- Editing Mars / Bernie / Outcome prompts — those are Dash → Prompts & Rules panels

## Step 0 — Resolve targets (REQUIRED)

`ARGUMENTS` must specify all three of `client`, `location`, `icp` (or IDs directly), plus `outcomes` (csv of `Outcome.title`). No name-guessing, no silent defaults. If anything is missing or ambiguous, fail loudly with the candidate list — never pick.

Canonical rule + rationale: [GENERATION.md](../../../../../GENERATION.md) → "Canonical target resolution". Memory pins: `feedback_pipeline_target_specification`, `project_free_tier_vs_song_builder`.

```bash
CLIENT="*Free Tier Song Builder*"
LOCATION="Free"
ICP_NAME="Free Tier"
OUTCOMES_CSV="Chill,Steady,Upbeat"

cd entuned-0.3 && railway ssh "cd /app && node -e '
import(\"@prisma/client\").then(async m=>{
  const p = new m.PrismaClient();
  const fail = (stage, info) => { console.error(JSON.stringify({stage, ...info})); process.exit(1); };

  const clients = await p.client.findMany({ where: { companyName: { equals: \"$CLIENT\", mode: \"insensitive\" } } });
  if (clients.length !== 1) fail(\"client\", { candidates: clients.map(c => c.companyName) });

  const stores = await p.store.findMany({
    where: { clientId: clients[0].id, name: { equals: \"$LOCATION\", mode: \"insensitive\" } },
    include: { icpLinks: { include: { icp: true } } },
  });
  if (stores.length !== 1) {
    const all = await p.store.findMany({ where: { clientId: clients[0].id }, select: { name: true } });
    fail(\"location\", { candidates: all.map(s => s.name) });
  }

  const matches = stores[0].icpLinks.filter(l => l.icp.name.toLowerCase() === \"$ICP_NAME\".toLowerCase());
  if (matches.length !== 1) fail(\"icp\", { candidates: stores[0].icpLinks.map(l => l.icp.name) });

  const wanted = \"$OUTCOMES_CSV\".split(\",\").map(s => s.trim()).filter(Boolean);
  const outs = await p.outcome.findMany({
    where: { supersededAt: null, title: { in: wanted, mode: \"insensitive\" } },
    select: { id: true, title: true, mode: true, tempoBpm: true },
  });
  if (outs.length !== wanted.length) fail(\"outcomes\", { missing: wanted.filter(t => !outs.find(o => o.title.toLowerCase() === t.toLowerCase())) });

  console.log(JSON.stringify({ clientId: clients[0].id, storeId: stores[0].id, icpId: matches[0].icp.id, outcomes: outs }));
  await p.\$disconnect();
})
'"
```

Capture the JSON output → set `CLIENT_ID`, `STORE_ID`, `ICP_ID`, plus an outcome map (with tempo) for the loop below.

Default `n` is **3** for a sanity-check run, **5** for a real fill. Cap at 20 (Zod limit in the admin route). For multi-target fills, run them sequentially (parallel would compete on hook + ref pool).

## Operator attribution

Get Daniel's `accountId` once so `SongSeedBatch.triggeredByUser` matches what the browser writes:

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const a=await p.account.findUnique({where:{email:\"daniel@entuned.co\"}});
  console.log(a?.id);
  await p.\$disconnect();
})'"
```

Cache for the session.

## Step 1 — Pre-flight check

For each target, verify there's hook headroom (`runEno` will return `pool_exhausted_hooks` otherwise). The right metric is `available = approved - inflight` (this matches the calc `draft-hooks` uses):

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const approved=await p.hook.count({where:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\",status:\"approved\"}});
  const inflight=await p.songSeed.count({where:{hook:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\"},status:{in:[\"assembling\",\"queued\",\"accepted\"]}}});
  console.log({approved, inflight, available: approved - inflight});
  await p.\$disconnect();
})'"
```

**Decision gate** (apply per target, auto-resolve — no operator stops):

- `available >= n` → proceed at full `n`.
- `available < n` but `> 0` → auto-top-up: run `draft-hooks` with `n = (n - available) + 5` for that target, then re-check and proceed. Print one-line note for the transcript ("topped up hooks for <outcome>"); don't ask.
- `available == 0` → auto-top-up: run `draft-hooks` with `n` for that target, then proceed. Same one-line note.

Also worth a quick ref-track sanity check at the outcome's tempo (the only ref-track gate now):

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const refs=await p.referenceTrack.findMany({where:{icpId:\"<ICP>\",status:\"approved\",styleAnalysis:{isNot:null}},include:{styleAnalysis:true}});
  const bpm = <OUTCOME_BPM>;
  const eligible = refs.filter(r => r.styleAnalysis?.bpm == null || Math.abs(r.styleAnalysis.bpm - bpm) <= 7);
  console.log({totalDecomposed: refs.length, eligibleAtBpm: eligible.length, bpm});
  await p.\$disconnect();
})'"
```

If `eligibleAtBpm < 3`, expect ref-pile-up (same track picked multiple times). Surface this so Daniel can either (a) accept the pile-up, (b) widen the decomposed pool, or (c) try a different outcome bpm.

## Step 2 — Run Eno

One `railway ssh` per (ICP × outcome). **Two requirements baked into the template below — do NOT omit either:**

1. **`node --import tsx -e`** (not plain `node -e`). runEno imports TS source from `./dist/lib/eno/eno.js`; plain node fails with `Unknown file extension '.ts'`.
2. **`process.exit(0)`** at the end of the inner async function. runEno uses the long-lived shared prisma client (no per-call `$disconnect`); without explicit exit, the Node process hangs past completion until something kills it (you'll see your CLI freeze for minutes).

Use this exact template:

```bash
ICP_ID="..."; OUTCOME_ID="..."; N=3; TRIGGERED_BY_USER="<daniel-account-id>"
cd entuned-0.3 && railway ssh "cd /app && node --import tsx -e '
import(\"./dist/lib/eno/eno.js\").then(async e => {
  const result = await e.runEno({
    icpId: \"$ICP_ID\",
    outcomeId: \"$OUTCOME_ID\",
    n: $N,
    triggeredBy: \"manual\",
    triggeredByUser: \"$TRIGGERED_BY_USER\",
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})
'"
```

Result shape:
```
{
  songSeedBatchId: "...",
  requestedN: 3,
  producedN: 3,
  reason: "complete" | "pool_exhausted",
  errors: []
}
```

`reason: "pool_exhausted"` with `producedN < requestedN` means runEno ran out of hooks or refs partway through. `errors` lists the per-seed failure reasons (`pool_exhausted_hooks`, `pool_exhausted_reference_tracks_outcome_tempo_<bpm>`, etc.).

## Step 3 — Show Daniel the seeds

After every batch, dump the produced seeds so Daniel can sanity-check before they ship to Suno. The block to inline (replace `<BATCH_ID>`):

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const seeds=await p.songSeed.findMany({
    where:{songSeedBatchId:\"<BATCH_ID>\"},
    include:{hook:true,referenceTrack:true,outcome:true},
    orderBy:{createdAt:\"asc\"}
  });
  for (let i=0; i<seeds.length; i++) {
    const s = seeds[i];
    const lines = s.lyrics.split(\"\\n\").filter(l => l.trim() && !l.startsWith(\"[\")).length;
    console.log(\"\\n========== SEED \"+(i+1)+\" ==========\");
    console.log(\"hook:\", s.hook.text);
    console.log(\"ref:\", s.referenceTrack.title, \"/\", s.referenceTrack.artist, \"(\", s.referenceTrack.year, \")\");
    console.log(\"outcome:\", s.outcome.title, \"·\", s.outcome.mode, \"·\", s.outcome.tempoBpm+\"bpm\");
    console.log(\"sung lines:\", lines);
    console.log(\"\\n-- POSITIVE STYLE --\");
    console.log(s.style);
    console.log(\"\\n-- NEGATIVE STYLE --\");
    console.log(s.negativeStyle);
    console.log(\"\\n-- LYRICS --\");
    console.log(s.lyrics);
    console.log(\"\\n-- META --\");
    console.log(\"draft v:\", s.lyricDraftPromptVersion, \" edit v:\", s.lyricEditPromptVersion, \" style v:\", s.styleTemplateVersion);
  }
  await p.\$disconnect();
})'"
```

Present the dump to Daniel formatted (markdown headings, code-fence the lyrics). Flag anything that looks off:
- Sung-line count < 18 (Bernie's tempo-shape rule expects ≥18 for chorus-based forms; might be a too-short hook)
- Stage-direction parens — `(ukulele groove, 4 bars)`, `(fade on groove)` — these would be Bernie ignoring the parens-discipline rule
- Product/retail imagery — shirt / seam / shelf / rack / fitting / aisle
- Same ref picked >1 time across the batch — pool-depth issue (see step 1 pre-flight)

## Step 4 — Auto-proceed (no discretionary gates)

After Step 3's dump, **auto-proceed to `populate-songs`**. Flag any issues you see in the dump for Daniel's awareness, but do not stop. The pipeline runs end-to-end without per-batch operator approval.

What to print (one line per seed at most) so Daniel can spot-check from the transcript:

- Sung-line count if below 18 (chorus-based forms expect ≥18)
- Stage-direction parens detected (e.g., `(ukulele groove, 4 bars)`, `(fade on groove)`) — distinct from vocal ad-libs like `(ooh)`, `(yeah)`, `(dale)` which are legitimate
- Product/retail imagery hits — use bounded word regex `\b(shirt|seam|shelf|rack|fitting|aisle)\b`; substring matches (e.g., "track" containing "rack") are false positives, ignore them
- Same ref picked >1× across the batch

These are informational. Even if all four conditions trigger, continue to `populate-songs`. The cost of one bad song reaching R2 is lower than the cost of a stop-and-wait cycle.

Only stop the pipeline if `runEno` itself returned `producedN: 0` (zero seeds produced) — there's nothing to ship.

## Failure modes

| Symptom | What it means | Fix |
|---|---|---|
| Node process hangs after `runEno` output prints | Missing `process.exit(0)` in the inner async function | Add `process.exit(0)` after `console.log(JSON.stringify(result, ...))`. runEno uses the shared prisma client and won't auto-disconnect. See Step 2 template. |
| `Unknown file extension '.ts' for ./dist/lib/eno/eno.js` | Plain `node -e` instead of `node --import tsx -e` | Use `node --import tsx -e '...'` for the runEno call. See Step 2 template. |
| `pool_exhausted_hooks` | No approved hooks remaining for the (ICP × outcome) | Run `draft-hooks` first |
| `pool_exhausted_reference_tracks_outcome_tempo_<bpm>` | No approved + decomposed refs within ±7bpm of the outcome | Either widen the decomposed ref pool, decompose new candidate tracks, or pick an outcome with closer-tempo refs |
| `producedN < requestedN`, `reason: pool_exhausted` | Ran dry partway through the batch | The seeds that DID produce are valid — keep them, surface the gap in passing, continue to `populate-songs` with whatever produced. |
| `Cannot read properties of null` on `outcome.tempoBpm`/`outcome.mode`/`outcome.mood` | The Outcome row is missing fields the OutcomeFactorPrompt prepend needs | Open in Dash → Outcomes → Outcome Library — the row is misconfigured. Tempo, mode, mood are all required. |
| Repeated `runEno` calls produce same hook order across calls | Hook picker uses `createdAt asc` for selection within tied scores — the same approved hook will get picked first every time until it's consumed. Expected behavior. | Not a bug — finish consuming the pool or rotate |
| Same ref picked N times in a single batch | The eligible ref pool (post-BPM filter) is narrow; the picker spreads with random tiebreak but small pools have small spreads | Decompose more refs at that tempo |
| Shell parse error on `'...)'` or `"..."` in the runEno script | Triple-quote escaping broke; usually an apostrophe in an inlined value | Move the value into an env var: `MY_VAR='value'` in the shell line, then reference as `\"$MY_VAR\"` inside the inner JS. Avoid hand-escaping apostrophes inside JS string literals — they're the most common shell-parse-error source. |
| `prisma.ICP is not a function` or similar | Wrong model casing | Prisma accessors are **camelCase with lowercased acronyms**: `prisma.iCP`, `prisma.hook`, `prisma.songSeed`, `prisma.referenceTrack`, `prisma.account`. Not `prisma.ICP`. |

## What this skill does NOT do

- Does not generate hooks. Use `draft-hooks` first.
- Does not push seeds to Suno or accept takes. Use `populate-songs` (browser, Chrome MCP).
- Does not retire / delete existing seeds beyond cleanup of bad ones in step 4.
- Does not edit any prompt. Operator-editable prompts live in Dash → Prompts & Rules.

## Handoff

After this completes:
```
draft-hooks  →  make-song-seeds (YOU ARE HERE)  →  populate-songs (browser, Suno)
```

Tell Daniel:
- Batch ID
- Produced count
- Anything flagged in step 3
- Whether the queue is now ready for `populate-songs`
