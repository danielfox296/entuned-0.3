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

export interface MusicologicalRulesRow {
  id: string
  version: number
  rulesText: string
  notes: string | null
  createdAt: string
}

export interface FailureRuleRow {
  id: string
  triggerField: string
  triggerValue: string
  exclude: string
  overrideField: string | null
  overridePattern: string | null
  note: string | null
}

export interface StyleTemplateRow {
  id: string
  version: number
  templateText: string
  notes: string | null
  createdAt: string
}

export interface LyricPromptRow {
  id: string
  version: number
  promptText: string
  notes: string | null
  createdAt: string
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

  // --- Engine (decomposer rules, failure rules, style template, lyric prompts) ---

  musicologicalRules: (token: string) =>
    req<{ latest: MusicologicalRulesRow | null; history: MusicologicalRulesRow[] }>('/admin/musicological-rules', {}, token),
  saveMusicologicalRules: (rulesText: string, notes: string | undefined, token: string) =>
    req<MusicologicalRulesRow>('/admin/musicological-rules', { method: 'POST', body: JSON.stringify({ rulesText, notes }) }, token),

  failureRules: (token: string) =>
    req<FailureRuleRow[]>('/admin/failure-rules', {}, token),
  createFailureRule: (body: Omit<FailureRuleRow, 'id'>, token: string) =>
    req<FailureRuleRow>('/admin/failure-rules', { method: 'POST', body: JSON.stringify(body) }, token),
  updateFailureRule: (id: string, body: Omit<FailureRuleRow, 'id'>, token: string) =>
    req<FailureRuleRow>(`/admin/failure-rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteFailureRule: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/failure-rules/${id}`, { method: 'DELETE' }, token),

  styleTemplate: (token: string) =>
    req<{ latest: StyleTemplateRow | null; history: StyleTemplateRow[] }>('/admin/style-template', {}, token),
  saveStyleTemplate: (templateText: string, notes: string | undefined, token: string) =>
    req<StyleTemplateRow>('/admin/style-template', { method: 'POST', body: JSON.stringify({ templateText, notes }) }, token),

  lyricPrompts: (token: string) =>
    req<{ draft: { latest: LyricPromptRow | null; history: LyricPromptRow[] }; edit: { latest: LyricPromptRow | null; history: LyricPromptRow[] } }>('/admin/lyric-prompts', {}, token),
  saveDraftPrompt: (promptText: string, notes: string | undefined, token: string) =>
    req<LyricPromptRow>('/admin/lyric-prompts/draft', { method: 'POST', body: JSON.stringify({ promptText, notes }) }, token),
  saveEditPrompt: (promptText: string, notes: string | undefined, token: string) =>
    req<LyricPromptRow>('/admin/lyric-prompts/edit', { method: 'POST', body: JSON.stringify({ promptText, notes }) }, token),
}
