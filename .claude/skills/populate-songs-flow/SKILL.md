---
name: populate-songs-flow
description: Round-trip queued Flow (Google Lyria) SongSeeds through flowmusic.app — read engine='flow' prompts from DB → fill the Compose page Sound + Lyrics boxes → Generate → grab the public media URL from the network → download + re-host on R2 as a Song(engine=flow) + LineageRow. The Flow counterpart to populate-songs (which does Suno). Use when Daniel says "populate flow songs", "round-trip the flow seeds", "fill the library from flow", or after `make-song-seeds ENGINE=flow` produces queued Flow prompts.
---

# populate-songs-flow

The Flow (Google Lyria) counterpart to `populate-songs`. Flow has no API, so the browser is the only interface — same constraint as Suno. This skill drives the **Compose** page at https://www.flowmusic.app/, generates each queued Flow seed, and re-hosts the result on R2.

```
make-song-seeds (ENGINE=flow)  →  populate-songs-flow (YOU ARE HERE)
   (CLI, engine='flow' seeds)      (Chrome MCP + flowmusic.app)
```

A Flow Song lands in the SAME `Song` table + `LineageRow` as Suno — `engine='flow'` is the only difference. Hendrix serves both identically.

## Prerequisites

- Queued Flow seeds: `SongSeed` rows with `engine='flow'` AND `status='queued'`. If none, run `make-song-seeds` with `engine='flow'` first.
- Logged into **flowmusic.app** in the Chrome the MCP drives (account fox296). The Compose page needs the session.

## What's different from Suno (the hard-won facts)

- **The media file is a PUBLIC Google Cloud Storage URL.** After a generation completes, the network shows `https://storage.googleapis.com/producer-app-public/clips/<clipId>.m4a` (content-type `audio/mp4`, range-enabled, no auth). No share-link resolution needed — read it straight off the network. The bucket is literally `producer-app-public`.
- **The Lyrics box hard-caps at 3000 chars** (`textarea.maxLength = 3000`). Our Flow `lyrics` (the `[mm:ss]` timeline) often exceeds this — React rejects an over-cap `setRV` outright (value stays empty, not truncated). **Trim to ≤3000 at a clean `\n\n` boundary** before setting.
- **One clip per generation** (vs Suno's 2 takes) → accept with `takes: [ <one url> ]`.
- **The status API needs a bearer** (`GET /__api/audio-create-song-status/<songId>` → `{"detail":"Unauthorized"}` from page JS). Don't poll it — detect completion from the UI (player shows a real duration) + the `.m4a` appearing in the network.
- **The admin bearer can't be grabbed from the browser** (same JWT-filter wall as populate-songs). Accept by **replicating the accept transaction over `railway ssh`** — see Step 6.

## Steps

### Step 0 — Read queued Flow seeds from the DB (browser-free)

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e '
(async()=>{
  const m=await import(\"@prisma/client\"); const p=new m.PrismaClient();
  const seeds=await p.songSeed.findMany({ where:{ engine:\"flow\", status:\"queued\" }, orderBy:{ createdAt:\"asc\" },
    select:{ id:true, title:true, vocalGender:true, resolvedTempoBpm:true, style:true, lyrics:true } });
  console.log(Buffer.from(JSON.stringify(seeds)).toString(\"base64\"));
  process.exit(0);
})();
'" | tail -1 | base64 -d > /tmp/flowseeds.json
```

Field → Compose box mapping:
- `style`  → **Sound** box (rich sound-world prose)
- `lyrics` → **Lyrics** box (the `[mm:ss]` timeline; trim to ≤3000)
- `vocalGender === 'instrumental'` → flip the **Instrumental** toggle ON
- `title` → Details → Title (optional; the DB `title` is canonical)
- `resolvedTempoBpm` → Sound → Advanced → BPM (optional)

### Step 1 — Open Compose

Navigate the MCP tab to `https://www.flowmusic.app/`, then click **Compose** (top-right). The panel shows **Lyrics** (+ Instrumental toggle), **Sound** (+ Advanced toggle → BPM/Length/Seed/Model), **Details** (Title), and **Generate**.

### Step 2 — Fill the boxes (React-controlled — use the native setter)

Identify the textareas by placeholder, not a fixed index (the chat box is also a textarea):
- Lyrics box: `placeholder` rendered as "Add lyrics…"
- Sound box: "Describe the sound…"

```js
// in javascript_tool, base64 the seed text (apostrophes, em-dashes, newlines) to inject safely
const dec=b=>new TextDecoder().decode(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));
const setRV=(el,val)=>{const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set;
  s.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));};
const tas=[...document.querySelectorAll('textarea')];
const lyricsTa=tas.find(t=>/add lyrics/i.test(t.placeholder)||t.parentElement?.textContent?.includes('Add lyrics'));
const soundTa =tas.find(t=>/describe the sound/i.test(t.placeholder)||t.parentElement?.textContent?.includes('Describe the sound'));
// trim lyrics to the 3000 cap at a clean boundary:
let ly=dec(LYRICS_B64); if(ly.length>3000){const c=ly.lastIndexOf('\n\n',2990); ly=ly.slice(0,c>0?c:2990);}
setRV(soundTa, dec(STYLE_B64));
setRV(lyricsTa, ly);
```

Verify both boxes show text (`lyricsTa.value.length`, `soundTa.value.length`) before generating.

### Step 3 — Generate

Clear the network log (`read_network_requests {clear:true}`), then click **Generate**. The session URL changes to `/session/<sessionId>` and the main area shows "Creating …".

### Step 4 — Wait for completion

Generation takes ~30–120s. Poll with a screenshot every ~15s: done when the bottom **player shows a real duration** (e.g. `2:50`) and is playing. Belt-and-suspenders: `read_network_requests` shows the clip `.m4a` fetched with a 200.

### Step 5 — Grab the media URL from the network

```
read_network_requests { tabId, urlPattern: "producer-app-public/clips" }
```
Take the `…/clips/<clipId>.m4a` URL. Confirm it's public if unsure: `curl -sI <url>` → `HTTP/2 200`, `content-type: audio/mp4`.

### Step 6 — Accept (download → R2 → Song + LineageRow), via railway ssh

Replicates `POST /admin/song-seeds/:id/accept` faithfully (the route's `downloadAndUploadFromUrl` passes non-Suno URLs straight through). Set `SEED_ID` and `URL`:

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e '
(async()=>{
  const seedId=\"<SEED_ID>\";
  const url=\"<CLIP_M4A_URL>\";
  const r2=await import(\"file:///app/dist/lib/r2.js\");
  const m=await import(\"@prisma/client\"); const p=new m.PrismaClient();
  const seed=await p.songSeed.findUnique({where:{id:seedId}});
  if(!seed||seed.status!==\"queued\"){ console.log(\"BAD_STATE\"); process.exit(1); }
  const key=\"song-seeds/\"+seedId+\"/take-1-\"+Date.now()+\".m4a\";
  const obj=await r2.downloadAndUploadFromUrl(url,key);
  const outcome=await p.outcome.findUnique({where:{id:seed.outcomeId},select:{version:true}});
  const result=await p.\$transaction(async(tx)=>{
    const song=await tx.song.upsert({where:{r2Url:obj.url},
      create:{r2Url:obj.url,r2ObjectKey:obj.key,byteSize:BigInt(obj.byteSize),contentType:obj.contentType,engine:seed.engine},update:{}});
    const row=await tx.lineageRow.create({data:{songId:song.id,r2Url:obj.url,icpId:seed.icpId,outcomeId:seed.outcomeId,
      outcomeVersion:outcome?outcome.version:null,hookId:seed.hookId,songSeedId:seed.id,active:true}});
    await tx.songSeed.update({where:{id:seedId},data:{status:\"accepted\",terminalAt:new Date()}});
    if(seed.referenceTrackId) await tx.referenceTrack.update({where:{id:seed.referenceTrackId},data:{useCount:{increment:1}}});
    await tx.hook.update({where:{id:seed.hookId},data:{useCount:{increment:1}}});
    return {songId:song.id,engine:song.engine,r2Url:obj.url};
  });
  console.log(\"OK \"+JSON.stringify(result));
  process.exit(0);
})().catch(e=>{console.log(\"ERR \"+(e&&e.message||e)); process.exit(1);});
'" | tail -2
```

Repeat Steps 1–6 per queued Flow seed. Start a **New session** (left sidebar) between seeds so each generates clean.

## Known nuances / follow-ups

- **Audio re-hosts as `content-type: audio/mpeg`** (uploadBuffer hardcodes it) even though the file is `.m4a`/AAC. Plays in most clients via the `.m4a` key extension; if Howler ever balks, fix `uploadBuffer`/the accept route to honor the real content-type.
- **Lyrics 3000 cap is a real constraint.** Ideal fix is upstream: have the Flow renderer/timeline keep `lyrics` ≤3000 so no trimming is needed (currently it can run ~3200). Until then, trim in Step 2.
- **Field mapping is unvalidated by ear.** We put the full `[mm:ss]` timeline (production descriptions + `Lyrics:` lines) in the Lyrics box. Lyria 3 Pro is documented to read timestamped lines as direction, but confirm by listening that it's not *singing* the descriptions. If it is, move the descriptions to the Sound box and keep only the `Lyrics:` lines in the Lyrics box.
- **Length field** (Sound → Advanced) directly controls song duration — set it from the timeline's last timestamp when you want to guarantee length, rather than relying on the timeline alone.
- **Don't route Flow through `run-pipeline` or `populate-songs`** — those filter/assume `engine='suno'`.
```
