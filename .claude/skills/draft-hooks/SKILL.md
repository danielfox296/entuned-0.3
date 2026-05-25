---
name: draft-hooks
description: Generate and approve hooks for one or more (ICP × outcome) pairs without opening a browser. Calls the same `draftHooks()` LLM that Dash's Hook Writing button uses, then persists results as approved Hook rows via Prisma. Use when Daniel says "draft hooks for X", "write hooks for [outcome]", "generate hooks for [ICP]", or "the hook pool for X is empty." Browser-free — runs against the prod server over `railway ssh`. Hand off to `make-song-seeds` after this completes.
---

# draft-hooks

Browser-free hook drafting. Replaces the manual Dash flow ("Workflows → Hook Writing → click outcome → Draft → click each Accept") with one `railway ssh` call per (ICP × outcome).

The artifact produced is **byte-identical** to what the browser writes: same `prisma.hook.create` shape, same `status='approved'`, same `approvedById`/`approvedAt`. The HTTP route's only added work is Zod validation + auth — both are operator-owned concerns this skill handles at the script layer.

## railway ssh escaping rules (read this first)

Every script in this skill is shell-wrapped like:
```
railway ssh "cd /app && node -e '<JS-here>'"
```

Three quoting layers nest: outer `"..."` (shell arg) → inner `'...'` (node -e arg) → `\"` (JS string literals). Two `$` rules:

- **`\$` (escaped)** when you want the JS code to use `$` — e.g., `await p.\$disconnect()`. Without the backslash, the shell would substitute `$disconnect` as an empty env var.
- **`$VAR` (unescaped)** when you want the shell to substitute a variable you set in the same line — e.g., `\"$ICP_ID\"` inserts the value of `$ICP_ID` from your local shell.

Prisma model names are **camelCase with lowercased acronyms**: `prisma.iCP` (not `prisma.ICP`), `prisma.hook`, `prisma.account`.

## When to use

Triggers (auto-fire — no need to ask permission):
- "draft hooks for [ICP/outcome]"
- "write hooks for [outcome]"
- "generate hooks for [ICP]"
- "fill the hook pool for X"
- "the hook pool for [client/location/icp × outcome] is empty"
- `make-song-seeds` reported `pool_exhausted_hooks` for a target — call this first, then retry

Do NOT use for:
- Editing the hook drafter prompt itself — that's `Dash → Prompts & Rules → Hook Prompts` (a separate per-outcome `OutcomeLyricFactor.hookPrompt` row, or per-ICP `HookWriterPrompt` row for the legacy ICP-entangled path)
- Rejecting / retiring existing hooks — that's an admin route call, not this skill

## Step 0 — Resolve targets (REQUIRED)

`ARGUMENTS` must specify all three of `client`, `location`, `icp` (or pass IDs directly via `client_id` / `store_id` / `icp_id`), plus `outcomes` (csv of `Outcome.title`). No name-guessing, no silent defaults. If anything is missing or ambiguous, fail loudly with the candidate list — never pick.

Canonical rule + rationale: [GENERATION.md](../../../../../GENERATION.md) → "Canonical target resolution". Memory pins: `feedback_pipeline_target_specification`, `project_free_tier_vs_song_builder`.

```bash
CLIENT="*Free Tier Song Builder*"
LOCATION="Free"
ICP_NAME="Free Tier"
OUTCOMES_CSV="Chill,Steady,Upbeat"

railway ssh "cd /app && node -e '
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
    select: { id: true, title: true },
  });
  if (outs.length !== wanted.length) fail(\"outcomes\", { missing: wanted.filter(t => !outs.find(o => o.title.toLowerCase() === t.toLowerCase())) });

  console.log(JSON.stringify({ clientId: clients[0].id, storeId: stores[0].id, icpId: matches[0].icp.id, outcomes: outs }));
  await p.\$disconnect();
})
'"
```

Capture the JSON output → set `CLIENT_ID`, `STORE_ID`, `ICP_ID`, plus an outcome map for the loop below.

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

For each (icpId, outcomeId) target, count approved hooks AND in-flight consumption. The right metric for "should I draft more" is `available = approved - inflight` — the count of approved hooks that `make-song-seeds` could still consume:

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const approved=await p.hook.count({where:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\",status:\"approved\"}});
  const inflight=await p.songSeed.count({where:{hook:{icpId:\"<ICP>\",outcomeId:\"<OUTCOME>\"},status:{in:[\"assembling\",\"queued\",\"accepted\"]}}});
  console.log({approved, inflight, available: approved - inflight});
  await p.\$disconnect();
})'"
```

A reasonable target is **8–12 available hooks per (ICP × outcome)** for healthy `make-song-seeds` headroom.

**Decision gate** (apply per target, do not auto-draft past the threshold):

- `available < 8` → drafting is warranted; proceed.
- `8 ≤ available ≤ 15` → top-up is reasonable; proceed.
- `available > 15` → **STOP. Do NOT auto-draft.** Surface to Daniel: "Pool at `<N>` available for `<outcome>`; target is 8–12. Top up anyway?" Wait for explicit confirmation. Drafting into a saturated pool wastes Anthropic API calls (most drafts will trigger trigram dedup and return `drafted: 0`), and the saturated phrasing doesn't get refreshed by adding more — only by retiring stale hooks.

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

The script then persists them with `status='approved'` (matching the Dash "approve all drafts" workflow). If Daniel wants drafts-for-review-first rather than auto-approve, persist with `status: 'draft'` + omit `approvedAt`/`approvedById`. **Default is auto-approve** because that matches the Dash Hook Writing UX (operator hits "approve all" after every draft pass).

## Step 3 — Print the new hooks (no gate)

Print every new hook for the record, grouped by `(ICP × outcome)`, then continue to the next pipeline stage. Format per line:

```
[<short id prefix>] <hook text>   · vocal=<gender>
```

Query to populate the dump (replace `<NEW_IDS>` with the array of ids returned by Step 2's `createMany`; or re-query by `approvedAt >= <step-2-start-time>` if ids weren't captured):

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p = new m.PrismaClient();
  const rows = await p.hook.findMany({
    where: { id: { in: <NEW_IDS> } },
    include: { icp: { select: { name: true } }, outcome: { select: { title: true } } },
    orderBy: [{ icpId: \"asc\" }, { outcomeId: \"asc\" }, { createdAt: \"asc\" }],
  });
  const grouped = {};
  for (const h of rows) {
    const key = h.icp.name + \" × \" + h.outcome.title;
    (grouped[key] ||= []).push(h);
  }
  for (const [key, hooks] of Object.entries(grouped)) {
    console.log(\"\\n## \" + key + \" (\" + hooks.length + \" new)\");
    for (const h of hooks) console.log(\"[\" + h.id.slice(0,8) + \"] \" + h.text.replace(/\\n/g,\" / \") + \"  · vocal=\" + (h.vocalGender || \"unknown\"));
  }
  await p.\$disconnect();
})'"
```

Drafted hooks are auto-approved and the skill auto-advances. If Daniel wants to retire one after the fact, the call is:

```bash
TOKEN='<from dash localStorage if not cached>'
for ID in <id-list>; do
  curl -sS -X POST "https://api.entuned.co/admin/hooks/$ID/reject" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"rejectionReason":"operator review"}' -w "\nHTTP %{http_code}\n"
done
```

Retire is terminal — rejected hooks aren't recoverable.

## Failure modes

| Symptom | What it means | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY is not set` from drafter | The prod container env is missing the key | Surface to Daniel; this would also break the browser path |
| `drafted: 0` after the call | All drafts collided with existing hooks (trigram dedup) | Hook pool is saturated with similar phrasings — Daniel should rotate / retire some, or tune the outcome's `OutcomeLyricFactor.hookPrompt` to push the drafter into a fresher region |
| `drafted: N`, `persisted: 0` (with no Prisma error) | Shouldn't happen — `createMany` with `skipDuplicates: false` either persists or throws | Investigate; should never silently lose hooks |
| `outcome not found` from `draftHooks` | Outcome row doesn't exist or is superseded | Re-resolve the outcomeId — display vs title vs key |
| `Unknown file extension '.ts' for ./dist/lib/hooks/drafter.js` | Missing `--import tsx` flag on `node` | Use `node --import tsx -e '...'` for the drafter call. Plain `node -e` works for simple Prisma queries but not for code that imports TS source. |
| `Cannot use import statement outside a module` | Either wrong node version or `--import tsx` missing | Check node version on prod container (should be 20+) and confirm `--import tsx` is in the command |
| Shell parse error on `'...)'` or `"..."` | Triple-quote escaping broke; usually an apostrophe in an inlined value | Move the value into an env var: `MY_VAR='value'` in the shell line, then reference as `\"$MY_VAR\"` inside the inner JS. Avoid hand-escaping apostrophes. |
| `prisma.ICP is not a function` or similar | Wrong model casing | Prisma model accessors are **camelCase with lowercased acronyms**: `prisma.iCP`, `prisma.hook`, `prisma.songSeed`, `prisma.referenceTrack`. Not `prisma.ICP`. Re-check the schema if unsure. |

## What this skill does NOT do

- Does not seed the Suno prompt queue. That's `make-song-seeds` (which calls `runEno` → produces `SongSeed` rows ready for `populate-songs`).
- Does not write to the hook drafter's prompt tables. Use Dash → Prompts & Rules → Hook Prompts for that.
- Does not delete or retire hooks. Hooks accumulate; rotate manually if a target gets stale.

## Handoff

After this completes, the next step in the pipeline is:
```
draft-hooks  →  make-song-seeds  →  populate-songs (browser, Suno)
```

Tell Daniel the count of approved hooks now available per (ICP × outcome) so he knows whether to proceed straight to `make-song-seeds`.
