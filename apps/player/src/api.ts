// API client for the entuned-0.3 server.
// Switch base URL with VITE_API_URL at build time.

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface QueueItem {
  songId: string
  audioUrl: string
  hookId: string
  outcomeId: string
}

export interface ActiveOutcome {
  outcomeId: string
  source: 'override' | 'schedule' | 'default'
  expiresAt?: string
}

export interface NextResponse {
  storeId: string
  decidedAt: string
  activeOutcome: ActiveOutcome | null
  queue: QueueItem[]
  fallbackTier: 'none' | 'daily_cap' | 'sibling_spacing' | 'no_repeat_window'
  reason: 'no_pool' | null
}

export interface OutcomeOption {
  outcomeId: string
  title: string
  tempoBpm: number
  mode: string
  poolSize: number
}

export interface AuthResponse {
  token: string
  operator: { id: string; email: string; isAdmin: boolean }
}

export interface MeResponse {
  operator: { id: string; email: string; displayName: string | null; isAdmin: boolean }
  stores: { id: string; name: string }[]
}

export type AudioEventType =
  | 'song_start' | 'song_complete' | 'song_skip' | 'song_report' | 'song_love'
  | 'outcome_override' | 'outcome_override_cleared' | 'playback_starved'
  | 'operator_login' | 'operator_logout'

export interface OutgoingEvent {
  event_type: AudioEventType
  store_id: string
  occurred_at: string
  operator_id?: string | null
  song_id?: string | null
  hook_id?: string | null
  report_reason?: string | null
  outcome_id?: string | null
}

async function req<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) =>
    req<MeResponse>('/auth/me', {}, token),
  next: (storeId: string) =>
    req<NextResponse>(`/hendrix/next?store_id=${encodeURIComponent(storeId)}`),
  outcomes: (storeId: string) =>
    req<OutcomeOption[]>(`/hendrix/outcomes?store_id=${encodeURIComponent(storeId)}`),
  override: (storeId: string, outcomeId: string, token: string) =>
    req<{ outcomeId: string; expiresAt: string }>('/hendrix/override', {
      method: 'POST',
      body: JSON.stringify({ store_id: storeId, outcome_id: outcomeId }),
    }, token),
  clearOverride: (storeId: string, token: string) =>
    req<{ ok: true }>('/hendrix/override/clear', {
      method: 'POST',
      body: JSON.stringify({ store_id: storeId }),
    }, token),
  emit: (event: OutgoingEvent | OutgoingEvent[]) => {
    const body = Array.isArray(event) ? { events: event } : event
    return req<{ accepted: number }>('/events', { method: 'POST', body: JSON.stringify(body) })
  },
}
