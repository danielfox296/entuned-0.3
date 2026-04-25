// API client for entuned-0.3 admin.
// Mirrors the player's req<T>() pattern; extends with admin-specific endpoints.

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const TOKEN_KEY = 'entuned.admin.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

// --- Types matching Prisma schema ---

export interface AuthResponse {
  token: string
  operator: { id: string; email: string; isAdmin: boolean }
}

export interface MeResponse {
  operator: { id: string; email: string; displayName: string | null; isAdmin: boolean }
  stores: { id: string; name: string }[]
}

export interface HealthResponse {
  ok: boolean
  service: string
  ts: string
}

export interface StoreRow {
  id: string
  name: string
  timezone: string
  clientId: string
  icpId: string
  defaultOutcomeId: string | null
  manualOverrideOutcomeId: string | null
  manualOverrideExpiresAt: string | null
  goLiveDate: string | null
}

export interface OutcomeRow {
  id: string
  outcomeKey: string
  version: number
  title: string
  tempoBpm: number
  mode: string
  dynamics: string | null
  instrumentation: string | null
  supersededAt: string | null
}

export interface LineageRowSummary {
  outcomeId: string
  count: number
}

export interface HookRow {
  id: string
  icpId: string
  outcomeId: string
  text: string
  status: string
  approvedAt: string | null
}

// --- API methods ---
// health + auth reuse existing server routes.
// Admin-specific data queries will need new server routes — stubbed here
// with the endpoint shape so the admin app compiles and runs against /health
// and /auth now, and we add data routes as we build panels.

export const api = {
  // Auth (same as player)
  login: (email: string, password: string) =>
    req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) =>
    req<MeResponse>('/auth/me', {}, token),

  // Health
  health: () =>
    req<HealthResponse>('/health'),

  // --- Admin data routes (to be added to server) ---
  // These will 404 until we add the corresponding Fastify routes.
  // Uncomment and wire as each panel gets built.

  // stores: (token: string) =>
  //   req<StoreRow[]>('/admin/stores', {}, token),
  // outcomes: (token: string) =>
  //   req<OutcomeRow[]>('/admin/outcomes', {}, token),
  // poolSummary: (storeId: string, token: string) =>
  //   req<LineageRowSummary[]>(`/admin/stores/${storeId}/pool-summary`, {}, token),
  // hooks: (icpId: string, token: string) =>
  //   req<HookRow[]>(`/admin/icps/${icpId}/hooks`, {}, token),
}
