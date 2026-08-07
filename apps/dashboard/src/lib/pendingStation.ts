// Carries the signup station pick across the magic-link / OAuth round trip.
//
// The picker lives on /start, which is pre-auth — no Store exists yet, so there
// is nothing to write the choice to. We hold it in localStorage and apply it via
// POST /me/stations once the account is provisioned.
//
// This is a UI preference, not auth. The dashboard's "cookies, not tokens" rule
// (apps/dashboard/CLAUDE.md) is about credentials; a station key is neither a
// credential nor sensitive.

const KEY = 'entuned.station.pending'

/** Remember the station picked at signup. */
export function setPendingStation(stationId: string): void {
  try {
    localStorage.setItem(KEY, stationId)
  } catch {
    // Private-mode / storage-disabled browsers: the pick is simply not carried
    // across the auth hop. Signup must not break over a preference.
  }
}

export function readPendingStation(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearPendingStation(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op — see setPendingStation.
  }
}
