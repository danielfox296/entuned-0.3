// GA4 event helpers for the player app (music.entuned.co).
//
// All events use the global `gtag` function injected in index.html.
// The module is safe to import even if the snippet hasn't loaded —
// every call guards on `typeof gtag`.

declare global {
  // eslint-disable-next-line no-var
  var gtag: ((...args: unknown[]) => void) | undefined
}

function fire(event: string, params?: Record<string, unknown>) {
  if (typeof gtag === 'function') gtag('event', event, params)
}

// ── Landing ─────────────────────────────────────────────────────────
// Fires once per page-load when the player renders.
let landingFired = false
export function trackPlayerLanding(slug?: string) {
  if (landingFired) return
  landingFired = true
  fire('player_landing', { player_slug: slug ?? '(direct)' })
}

// ── First play ──────────────────────────────────────────────────────
// Fires once per session when the user starts their first track.
let firstPlayFired = false
export function trackFirstPlay(songTitle?: string | null) {
  if (firstPlayFired) return
  firstPlayFired = true
  fire('player_first_play', { song_title: songTitle ?? '(unknown)' })
}

// ── Track complete ──────────────────────────────────────────────────
// Fires every time a non-ad track plays to completion.
export function trackTrackComplete(songTitle?: string | null) {
  fire('player_track_complete', { song_title: songTitle ?? '(unknown)' })
}
