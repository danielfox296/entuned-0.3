---
name: make-song-seeds
description: Run Eno (the per-seed orchestrator — Mars style + Bernie lyrics + form archetype + outcome prepend) for one or more (ICP × outcome × n) tuples without opening a browser. Produces `SongSeed` rows in the `queued` state, ready for `populate-songs`. Use when Daniel says "make song seeds for X", "seed N for [outcome]", "fill the song queue", or "queue up some prompts for [ICP]." Browser-free — runs against the prod server over `railway ssh`. Requires approved hooks; if pool is empty, run `draft-hooks` first.
---

# make-song-seeds

Browser-free `runEno` invocation. Replaces the manual Dash flow ("Workflows → Pipeline → click outcome card → build N") with one `railway ssh` call per (ICP × outcome).

The artifacts produced are **byte-identical** to what the browser writes: same `runEno()` call, same `SongSeedBatch` row with full provenance (icpId, outcomeId, requestedN, producedN, reason, triggeredBy, triggeredByUser, pipeline, startedAt, finishedAt), same `SongSeed` rows with hook/refTrack/outcome IDs + style + negativeStyle + lyrics + all version snapshots (lyricDraftPromptVersion, lyricEditPromptVersion, styleTemplateVersion, outcomeFactorPromptVersion, marsPromptVersion, hookWriterPromptVersion, formArchetypeVersion, arrangementTemplateVersion).

## railway ssh escaping rules (read this first)

Every script in this skill is shell-wrapped like:
```
railway ssh "cd /app && node -e '<JS-here>'"
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

## Resolve targets from ARGUMENTS

`ARGUMENTS` should specify (or imply) one or more `(icpId, outcomeId, n)` tuples. If only human names are given, resolve via:

```bash
# ICP lookup
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const icps=await p.iCP.findMany({where:{name:{contains:\"<NAME>\",mode:\"insensitive\"}},include:{client:true}});
  console.log(icps.map(i=>({id:i.id,name:i.name,client:i.client?.companyName})));
  await p.\$disconnect();
})'"

# Outcome lookup (use title — Outcome.title is the stable internal name; displayTitle is operator-facing)
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const outs=await p.outcome.findMany({where:{supersededAt:null,OR:[{title:{contains:\"<X>\",mode:\"insensitive\"}},{displayTitle:{contains:\"<X>\",mode:\"insensitive\"}}]},select:{id:true,title:true,displayTitle:true,mode:true,tempoBpm:true}});
  console.log(outs);
  await p.\$disconnect();
})'"
```

Default `n` is **3** for a sanity-check run, **5** for a real fill. Cap at 20 (Zod limit in the admin route). For multi-target fills, run them sequentially (parallel would compete on hook + ref pool).

## Operator attribution

Get Daniel's `accountId` once so `SongSeedBatch.triggeredByUser` matches what the browser writes:

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
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
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const approved=await p.hook.count({where:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\",status:\"approved\"}});
  const inflight=await p.songSeed.count({where:{hook:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\"},status:{in:[\"assembling\",\"queued\",\"accepted\"]}}});
  console.log({approved, inflight, available: approved - inflight});
  await p.\$disconnect();
})'"
```

If `available < n`, surface to Daniel — recommend running `draft-hooks` first, then retry. Don't blindly proceed at a reduced `n`; that's silent under-production.

Also worth a quick ref-track sanity check at the outcome's tempo (the only ref-track gate now):

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
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

One `railway ssh` per (ICP × outcome). Inline the IDs and `n`:

```bash
ICP_ID="..."; OUTCOME_ID="..."; N=3; TRIGGERED_BY_USER="<daniel-account-id>"
railway ssh "cd /app && node --import tsx -e '
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

The explicit `process.exit(0)` matters — runEno uses the long-lived shared prisma client (no per-call `$disconnect`), so without it the Node process can hang past completion until something kills it.

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
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
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

## Step 4 — Decide next move

Outcomes from the batch dump:
- **All seeds look good** → ready for `populate-songs`
- **One or two need rework** → delete the bad ones (`prisma.songSeed.delete({ where: { id, status: 'queued' } })`) and re-run with `n: <count>` to top up
- **Whole batch shows a systemic problem** (lyric rule violation, style contradiction, etc.) → don't ship to Suno; tell Daniel what the systemic issue is and propose a prompt fix (Bernie via Dash → Lyric Prompts, or Mars via Dash → Mars Prompts)

## Failure modes

| Symptom | What it means | Fix |
|---|---|---|
| `pool_exhausted_hooks` | No approved hooks remaining for the (ICP × outcome) | Run `draft-hooks` first |
| `pool_exhausted_reference_tracks_outcome_tempo_<bpm>` | No approved + decomposed refs within ±7bpm of the outcome | Either widen the decomposed ref pool, decompose new candidate tracks, or pick an outcome with closer-tempo refs |
| `producedN < requestedN`, `reason: pool_exhausted` | Ran dry partway through the batch | The seeds that DID produce are valid — keep them, surface the gap |
| `Cannot read properties of null` on `outcome.tempoBpm`/`outcome.mode`/`outcome.mood` | The Outcome row is missing fields the OutcomeFactorPrompt prepend needs | Open in Dash → Outcomes → Outcome Library — the row is misconfigured. Tempo, mode, mood are all required. |
| Repeated `runEno` calls produce same hook order across calls | Hook picker uses `createdAt asc` for selection within tied scores — the same approved hook will get picked first every time until it's consumed. Expected behavior. | Not a bug — finish consuming the pool or rotate |
| Same ref picked N times in a single batch | The eligible ref pool (post-BPM filter) is narrow; the picker spreads with random tiebreak but small pools have small spreads | Decompose more refs at that tempo |

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
