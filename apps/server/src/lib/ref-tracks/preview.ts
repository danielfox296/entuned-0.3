/**
 * Resolves a 30s preview URL + album art for a (artist, title) pair.
 *
 * Strategy:
 *   1. iTunes Search API. Unauthenticated; `previewUrl` (30s) and
 *      `artworkUrl100` which we upscale to 600x600. URLs are stable —
 *      they don't expire, so the cached previewUrl stays playable
 *      indefinitely.
 *   2. Deezer Search API fallback. Broader catalog but URLs are signed
 *      with an `hdnea=exp=<unix>` token (~24h TTL), so cached Deezer
 *      previewUrls go stale and need re-resolving.
 *
 * Both URLs are MP3/AAC playable in a plain <audio> element.
 *
 * Result is cached on the ReferenceTrack row (preview_url +
 * preview_source + cover_url) so we don't re-hit either API.
 */

type Resolved = {
  previewUrl: string | null
  coverUrl: string | null
  source: 'deezer' | 'itunes' | 'none'
}

async function tryDeezer(artist: string, title: string): Promise<{ preview: string; cover: string | null } | null> {
  const term = `${artist} ${title}`
  const r = await fetch(
    `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(term)}`,
  )
  if (!r.ok) return null
  const j: any = await r.json()
  const items: any[] = j?.data ?? []
  for (const it of items) {
    if (it?.preview) {
      const cover = it?.album?.cover_xl
        ?? it?.album?.cover_big
        ?? it?.album?.cover_medium
        ?? null
      return { preview: it.preview as string, cover }
    }
  }
  return null
}

async function tryItunes(artist: string, title: string): Promise<{ preview: string; cover: string | null } | null> {
  const term = `${artist} ${title}`
  const r = await fetch(
    `https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(term)}`,
  )
  if (!r.ok) return null
  const j: any = await r.json()
  const results: any[] = j?.results ?? []
  for (const it of results) {
    if (it?.previewUrl) {
      // iTunes returns 100x100; trivially upscale by string-replace.
      const small: string | null = it?.artworkUrl100 ?? it?.artworkUrl60 ?? null
      const cover = small ? small.replace(/\/(\d+)x\1bb\./, '/600x600bb.') : null
      return { preview: it.previewUrl as string, cover }
    }
  }
  return null
}

export async function resolvePreview(artist: string, title: string): Promise<Resolved> {
  try {
    const it = await tryItunes(artist, title)
    if (it) return { previewUrl: it.preview, coverUrl: it.cover, source: 'itunes' }
  } catch {}
  try {
    const dz = await tryDeezer(artist, title)
    if (dz) return { previewUrl: dz.preview, coverUrl: dz.cover, source: 'deezer' }
  } catch {}
  return { previewUrl: null, coverUrl: null, source: 'none' }
}
