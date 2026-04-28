/**
 * Resolves a 30s preview URL for a (artist, title) pair.
 *
 * Strategy:
 *   1. Deezer Search API. No auth, broad catalog, returns a 30s mp3 in
 *      the `preview` field. Most reliable post-Spotify's preview_url
 *      deprecation (Spotify nulled that field for client-credentials
 *      apps in late 2024 — Search returns the track but preview_url
 *      is null, so it's useless for our case).
 *   2. iTunes Search API. Unauthenticated, 30s `previewUrl` field.
 *
 * Both URLs are MP3/AAC playable in a plain <audio> element.
 *
 * Result is cached on the ReferenceTrack row (preview_url +
 * preview_source) so we don't re-hit either API.
 */

type Resolved = {
  url: string | null
  source: 'deezer' | 'itunes' | 'none'
}

async function tryDeezer(artist: string, title: string): Promise<string | null> {
  const term = `${artist} ${title}`
  const r = await fetch(
    `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(term)}`,
  )
  if (!r.ok) return null
  const j: any = await r.json()
  const items: any[] = j?.data ?? []
  for (const it of items) {
    if (it?.preview) return it.preview as string
  }
  return null
}

async function tryItunes(artist: string, title: string): Promise<string | null> {
  const term = `${artist} ${title}`
  const r = await fetch(
    `https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(term)}`,
  )
  if (!r.ok) return null
  const j: any = await r.json()
  const results: any[] = j?.results ?? []
  for (const it of results) {
    if (it?.previewUrl) return it.previewUrl as string
  }
  return null
}

export async function resolvePreview(artist: string, title: string): Promise<Resolved> {
  try {
    const dz = await tryDeezer(artist, title)
    if (dz) return { url: dz, source: 'deezer' }
  } catch {}
  try {
    const it = await tryItunes(artist, title)
    if (it) return { url: it, source: 'itunes' }
  } catch {}
  return { url: null, source: 'none' }
}
