// Random UUID stamped on every audio event so multi-device stores (front-of-
// house iPad + back-of-house phone) don't collapse into one stream. Survives
// session restarts; only resets if the user clears site data.

const KEY = 'entuned.device_id'

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    // Private mode or quota — fall back to a per-tab id. Better than nothing.
    return crypto.randomUUID()
  }
}
