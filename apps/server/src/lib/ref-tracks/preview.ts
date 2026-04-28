/**
 * Resolves a 30s preview URL for a (artist, title) pair.
 *
 * Strategy:
 *   1. Spotify Search API (client-credentials). ~90% catalog coverage.
 *      Some Spotify rows have `preview_url: null` even when the track
 *      exists; for those we fall through to (2).
 *   2. iTunes Search API. Unauthenticated, 30s `previewUrl` field.
 *
 * Both sources return MP3-playable URLs that work in a plain <audio>.
 *
 * The result is cached on the ReferenceTrack row (preview_url +
 * preview_source) so we don't hit either API twice for the same track.
 */

type Resolved = {
  url: string | null
  source: 'spotify' | 'itunes' | 'none'
}

let spotifyToken: { access_token: string; expires_at: number } | null = null

async function getSpotifyToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID
  const secret = process.env.SPOTIFY_CLIENT_SECRET
  if (!id || !secret) return null
  // Refresh ~60s before expiry to avoid edge-case expiries mid-request.
  if (spotifyToken && Date.now() < spotifyToken.expires_at - 60_000) {
    return spotifyToken.access_token
  }
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!r.ok) return null
  const j: any = await r.json()
  spotifyToken = {
    access_token: j.access_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
  }
  return spotifyToken.access_token
}

async function trySpotify(artist: string, title: string): Promise<string | null> {
  const token = await getSpotifyToken()
  if (!token) return null
  const q = `track:${title} artist:${artist}`
  const r = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) return null
  const j: any = await r.json()
  const items: any[] = j?.tracks?.items ?? []
  // Prefer the first result that actually has a preview URL.
  for (const it of items) {
    if (it?.preview_url) return it.preview_url as string
  }
  return null
}

async function tryItunes(artist: string, title: string): Promise<string | null> {
  // iTunes is happier with a single combined term than the Spotify-style filter syntax.
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
    const spot = await trySpotify(artist, title)
    if (spot) return { url: spot, source: 'spotify' }
  } catch {}
  try {
    const it = await tryItunes(artist, title)
    if (it) return { url: it, source: 'itunes' }
  } catch {}
  return { url: null, source: 'none' }
}
