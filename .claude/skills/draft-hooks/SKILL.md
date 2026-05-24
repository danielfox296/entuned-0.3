---
name: draft-hooks
description: Generate and approve hooks for one or more (ICP × outcome) pairs without opening a browser. Calls the same `draftHooks()` LLM that Dash's Hook Writing button uses, then persists results as approved Hook rows via Prisma. Use when Daniel says "draft hooks for X", "write hooks for [outcome]", "generate hooks for [ICP]", or "the hook pool for X is empty." Browser-free — runs against the prod server over `railway ssh`. Hand off to `make-song-seeds` after this completes.
---

# draft-hooks

Browser-free hook drafting. Replaces the manual Dash flow ("Workflows → Hook Writing → click outcome → Draft → click each Accept") with one `railway ssh` call per (ICP × outcome).

The artifact produced is **byte-identical** to what the browser writes: same `prisma.hook.create` shape, same `status='approved'`, same `approvedById`/`approvedAt`. The HTTP route's only added work is Zod validation + auth — both are operator-owned concerns this skill handles at the script layer.

## When to use

Triggers (auto-fire — no need to ask permission):
- "draft hooks for [ICP/outcome]"
- "write hooks for [outcome]"
- "generate hooks for [ICP]"
- "fill the hook pool for X"
- "Gary needs hooks for Brand Match"
- `make-song-seeds` reported `pool_exhausted_hooks` for a target — call this first, then retry

Do NOT use for:
- Editing the hook drafter prompt itself — that's `Dash → Prompts & Rules → Hook Prompts` (a separate per-outcome `OutcomeLyricFactor.hookPrompt` row, or per-ICP `HookWriterPrompt` row for the legacy ICP-entangled path)
- Rejecting / retiring existing hooks — that's an admin route call, not this skill

## Resolve targets from ARGUMENTS

`ARGUMENTS` should specify (or imply) one or more `(icpId, outcomeId, n)` tuples. Resolve from human names if needed:

```bash
# Map ICP name → id
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const icps=await p.iCP.findMany({where:{name:{contains:\"<NAME>\",mode:\"insensitive\"}},include:{client:true}});
  console.log(icps.map(i=>({id:i.id,name:i.name,client:i.client?.companyName})));
  await p.\$disconnect();
})'"

# Map outcome title → id
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const outs=await p.outcome.findMany({where:{supersededAt:null,title:{contains:\"<TITLE>\",mode:\"insensitive\"}},select:{id:true,title:true,displayTitle:true}});
  console.log(outs);
  await p.\$disconnect();
})'"
```

Default `n` is **5** unless Daniel specifies. Cap at 20 (the Zod limit in the admin route).

## Operator attribution

Get Daniel's `accountId` once at the start of the skill so `Hook.approvedById` matches what the browser writes. Hard-code if you know it; otherwise:

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const a=await p.account.findUnique({where:{email:\"daniel@entuned.co\"}});
  console.log(a?.id);
  await p.\$disconnect();
})'"
```

Cache this value for the rest of the skill session.

## Step 1 — Pre-flight check

For each (icpId, outcomeId) target, count existing approved hooks and decide whether drafting is needed:

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const c=await p.hook.count({where:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\",status:\"approved\"}});
  console.log(\"approved hooks:\",c);
  await p.\$disconnect();
})'"
```

A reasonable target is **8–12 approved hooks per (ICP × outcome)** for healthy `make-song-seeds` headroom. If already above target, ask Daniel before topping up — he may not want more.

## Step 2 — Call the drafter + persist

One `railway ssh` per target. Inline the IDs and `n`:

```bash
ICP_ID="..."; OUTCOME_ID="..."; N=5; APPROVED_BY="<daniel-account-id>"
railway ssh "cd /app && node --import tsx -e '
import(\"./dist/lib/hooks/drafter.js\").then(async d => {
  const { PrismaClient } = await import(\"@prisma/client\");
  const p = new PrismaClient();
  const result = await d.draftHooks({ icpId: \"$ICP_ID\", outcomeId: \"$OUTCOME_ID\", n: $N });
  console.log(\"drafted:\", result.hooks.length);
  if (result.hooks.length === 0) { console.log(\"no hooks survived dedup; nothing persisted\"); await p.\$disconnect(); return; }
  const now = new Date();
  const created = await p.hook.createMany({
    data: result.hooks.map(h => ({
      icpId: \"$ICP_ID\",
      outcomeId: \"$OUTCOME_ID\",
      text: h.text,
      vocalGender: h.vocalGender,
      status: \"approved\",
      approvedAt: now,
      approvedById: \"$APPROVED_BY\",
    })),
    skipDuplicates: false,
  });
  console.log(\"persisted:\", created.count);
  console.log(\"sample:\", result.hooks.slice(0, 3).map(h => h.text));
  await p.\$disconnect();
})
'"
```

`draftHooks` returns hooks that have already passed:
- The trigram dedup vs existing hooks for the same (ICP × outcome)
- Any vocal-gender normalization the drafter prompt requires

The script then persists them with `status='approved'` (matching the Dash "approve all drafts" workflow). If Daniel wants drafts-for-review-first rather than auto-approve, persist with `status: 'draft'` + omit `approvedAt`/`approvedById`. **Default is auto-approve** because that's what the existing browser-driven `seed-hooks` skill does at the end of its flow.

## Step 3 — Show Daniel the result

Print:
- Total drafted count
- Total persisted count
- 3 sample hooks per target (so he can sanity-check tone before they get consumed by `make-song-seeds`)
- Total approved-hooks count for each target after persistence

If any hooks look obviously off (gimmicky rhyme schemes, product-imagery leaks, mismatch with outcome intent), surface them and ask Daniel whether to retire them. The Dash retire-hook endpoint is `POST /admin/hooks/:id/reject`.

## Failure modes

| Symptom | What it means | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY is not set` from drafter | The prod container env is missing the key | Surface to Daniel; this would also break the browser path |
| `drafted: 0` after the call | All drafts collided with existing hooks (trigram dedup) | Hook pool is saturated with similar phrasings — Daniel should rotate / retire some, or tune the outcome's `OutcomeLyricFactor.hookPrompt` to push the drafter into a fresher region |
| `drafted: N`, `persisted: 0` (with no Prisma error) | Shouldn't happen — `createMany` with `skipDuplicates: false` either persists or throws | Investigate; should never silently lose hooks |
| `outcome not found` from `draftHooks` | Outcome row doesn't exist or is superseded | Re-resolve the outcomeId — display vs title vs key |

## What this skill does NOT do

- Does not seed the Suno prompt queue. That's `make-song-seeds` (which calls `runEno` → produces `SongSeed` rows ready for `make-final-songs`).
- Does not write to the hook drafter's prompt tables. Use Dash → Prompts & Rules → Hook Prompts for that.
- Does not delete or retire hooks. Hooks accumulate; rotate manually if a target gets stale.

## Handoff

After this completes, the next step in the pipeline is:
```
draft-hooks  →  make-song-seeds  →  make-final-songs (browser, Suno)
```

Tell Daniel the count of approved hooks now available per (ICP × outcome) so he knows whether to proceed straight to `make-song-seeds`.
