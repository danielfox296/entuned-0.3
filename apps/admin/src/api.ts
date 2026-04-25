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

// --- Brand: stores, ICPs, reference tracks, decompositions ---

export type Bucket = 'FormationEra' | 'Subculture' | 'Aspirational'

export interface StoreSummary {
  id: string
  name: string
  timezone: string
  clientId: string
  clientName: string
  icpId: string
}

export interface IcpRow {
  id: string
  clientId: string
  name: string
  ageRange: string | null
  location: string | null
  politicalSpectrum: string | null
  openness: string | null
  fears: string | null
  values: string | null
  desires: string | null
  unexpressedDesires: string | null
  turnOffs: string | null
  createdAt: string
  updatedAt: string
}

export interface DecompositionRow {
  id: string
  referenceTrackId: string
  musicologicalRulesVersion: number
  status: string
  verifiedAt: string | null
  verifiedById: string | null
  confidence: string | null
  vibePitch: string | null
  eraProductionSignature: string | null
  instrumentationPalette: string | null
  standoutElement: string | null
  arrangementShape: string | null
  dynamicCurve: string | null
  vocalCharacter: string | null
  vocalArrangement: string | null
  harmonicAndGroove: string | null
  createdAt: string
  updatedAt: string
}

export interface ReferenceTrackRow {
  id: string
  icpId: string
  bucket: Bucket
  artist: string
  title: string
  year: number | null
  operatorNotes: string | null
  useCount: number
  createdAt: string
  decomposition: DecompositionRow | null
}

export interface StoreDetail {
  store: { id: string; name: string; timezone: string; clientId: string; clientName: string }
  icp: IcpRow & { referenceTracks: ReferenceTrackRow[] }
  sharedWith: { id: string; name: string; clientName: string }[]
}

export interface NewReferenceTrack {
  bucket: Bucket
  artist: string
  title: string
  year?: number | null
  operatorNotes?: string | null
}

export type IcpUpdate = Partial<Omit<IcpRow, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>
export type RefTrackUpdate = Partial<NewReferenceTrack>
// --- Operator Seeding (Submissions / EnoRuns) ---

export type SubmissionStatus = 'assembling' | 'queued' | 'accepted' | 'abandoned' | 'skipped' | 'failed'

export interface SubmissionListRow {
  id: string
  enoRunId: string
  icpId: string
  hookId: string
  outcomeId: string
  referenceTrackId: string | null
  status: SubmissionStatus
  style: string | null
  negativeStyle: string | null
  vocalGender: string | null
  lyrics: string | null
  title: string | null
  errorText: string | null
  claimedById: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
  terminalAt: string | null
  hook: { id: string; text: string }
  outcome: { id: string; title: string; version: number }
  referenceTrack: { id: string; artist: string; title: string } | null
  enoRun: { id: string; startedAt: string; triggeredBy: string }
}

export interface SubmissionDetail extends SubmissionListRow {
  stylePortionRaw: string | null
  outcomePrependTemplateVersion: number | null
  marsPromptVersion: number | null
  bernieDraftPromptVersion: number | null
  bernieEditPromptVersion: number | null
  firedFailureRuleIds: string[]
  outcome: any
  referenceTrack: any
  enoRun: any
  lineageRows: any[]
}

export interface EnoRunResult {
  enoRunId: string
  requestedN: number
  producedN: number
  reason: 'complete' | 'pool_exhausted' | 'precheck_failed'
  errors: string[]
}

export interface ScheduleRow {
  id: string
  storeId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
  outcomeTitle: string
  outcomeVersion: number
}

export type ScheduleRowInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
}

export interface OutcomeWithPool {
  outcomeId: string
  title: string
  version: number
  tempoBpm: number
  mode: string
  poolSize: number
}

export interface QueueEntry {
  songId: string
  audioUrl: string
  hookId: string
  outcomeId: string
  hookText: string | null
  outcomeTitle: string | null
}

export interface AudioEventRow {
  id: string
  eventType: string
  occurredAt: string
  songId: string | null
  hookId: string | null
  outcomeId: string | null
  outcomeTitle: string | null
  operatorId: string | null
  operatorEmail: string | null
  reportReason: string | null
}

export interface LiveStoreView {
  store: {
    id: string
    name: string
    clientName: string
    timezone: string
    icpId: string
    defaultOutcomeId: string | null
    manualOverrideOutcomeId: string | null
    manualOverrideExpiresAt: string | null
  }
  active: {
    outcomeId: string
    outcomeTitle: string | null
    source: 'override' | 'schedule' | 'default'
    expiresAt: string | null
  } | null
  queue: QueueEntry[]
  fallbackTier: 'none' | 'daily_cap' | 'sibling_spacing' | 'no_repeat_window'
  reason: 'no_pool' | null
  outcomes: OutcomeWithPool[]
  recentEvents: AudioEventRow[]
}

export interface OutcomeRowFull {
  id: string
  outcomeKey: string
  version: number
  title: string
  tempoBpm: number
  mode: string
  dynamics: string | null
  instrumentation: string | null
  supersededAt: string | null
  createdAt: string
}

export interface HookRowFull {
  id: string
  icpId: string
  outcomeId: string
  text: string
  status: 'draft' | 'approved'
  approvedAt: string | null
  approvedById: string | null
  createdAt: string
  updatedAt: string
  outcome: { id: string; title: string; version: number }
}

export type DecompositionUpdate = Partial<{
  status: 'draft' | 'verified'
  confidence: 'low' | 'medium' | 'high' | null
  vibePitch: string | null
  eraProductionSignature: string | null
  instrumentationPalette: string | null
  standoutElement: string | null
  arrangementShape: string | null
  dynamicCurve: string | null
  vocalCharacter: string | null
  vocalArrangement: string | null
  harmonicAndGroove: string | null
}>

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

  // --- Brand ---

  stores: (token: string) =>
    req<StoreSummary[]>('/admin/stores', {}, token),
  storeDetail: (id: string, token: string) =>
    req<StoreDetail>(`/admin/stores/${id}`, {}, token),
  updateIcp: (id: string, body: IcpUpdate, token: string) =>
    req<IcpRow>(`/admin/icps/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  createReferenceTrack: (icpId: string, body: NewReferenceTrack, token: string) =>
    req<ReferenceTrackRow>(`/admin/icps/${icpId}/reference-tracks`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateReferenceTrack: (id: string, body: RefTrackUpdate, token: string) =>
    req<ReferenceTrackRow>(`/admin/reference-tracks/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteReferenceTrack: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/reference-tracks/${id}`, { method: 'DELETE' }, token),
  decomposeReferenceTrack: (id: string, force: boolean, token: string) =>
    req<DecompositionRow>(`/admin/reference-tracks/${id}/decompose${force ? '?force=1' : ''}`, { method: 'POST' }, token),
  updateDecomposition: (id: string, body: DecompositionUpdate, token: string) =>
    req<DecompositionRow>(`/admin/decompositions/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),

  // --- Hooks ---

  outcomes: (token: string) =>
    req<OutcomeRowFull[]>('/admin/outcomes', {}, token),
  outcomeLibrary: (token: string) =>
    req<(OutcomeRowFull & { lineageCount: number })[]>('/admin/outcomes?include=all', {}, token),
  icpHooks: (icpId: string, token: string) =>
    req<HookRowFull[]>(`/admin/icps/${icpId}/hooks`, {}, token),
  createHook: (icpId: string, body: { text: string; outcomeId: string; approve?: boolean }, token: string) =>
    req<HookRowFull>(`/admin/icps/${icpId}/hooks`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateHook: (id: string, body: { text?: string; outcomeId?: string }, token: string) =>
    req<HookRowFull>(`/admin/hooks/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  approveHook: (id: string, token: string) =>
    req<HookRowFull>(`/admin/hooks/${id}/approve`, { method: 'POST' }, token),
  deleteHook: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/hooks/${id}`, { method: 'DELETE' }, token),

  // --- Playback ---

  liveStore: (id: string, token: string) =>
    req<LiveStoreView>(`/admin/stores/${id}/live`, {}, token),
  setOverride: (id: string, outcomeId: string, token: string) =>
    req<{ outcomeId: string; expiresAt: string }>(`/admin/stores/${id}/override`, { method: 'POST', body: JSON.stringify({ outcomeId }) }, token),
  clearOverride: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/stores/${id}/override/clear`, { method: 'POST' }, token),

  // --- Schedule ---

  schedule: (storeId: string, token: string) =>
    req<ScheduleRow[]>(`/admin/stores/${storeId}/schedule`, {}, token),
  createScheduleRow: (storeId: string, body: ScheduleRowInput, token: string) =>
    req<ScheduleRow>(`/admin/stores/${storeId}/schedule`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateScheduleRow: (id: string, body: ScheduleRowInput, token: string) =>
    req<ScheduleRow>(`/admin/schedule-rows/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteScheduleRow: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/schedule-rows/${id}`, { method: 'DELETE' }, token),

  // --- Operator Seeding ---

  submissions: (token: string, params: { icpId?: string; status?: string; claimedBy?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.icpId) qs.set('icpId', params.icpId)
    if (params.status) qs.set('status', params.status)
    if (params.claimedBy) qs.set('claimedBy', params.claimedBy)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString() ? `?${qs.toString()}` : ''
    return req<SubmissionListRow[]>(`/admin/submissions${q}`, {}, token)
  },
  submissionDetail: (id: string, token: string) =>
    req<SubmissionDetail>(`/admin/submissions/${id}`, {}, token),
  runEno: (body: { icpId: string; outcomeId: string; n: number }, token: string) =>
    req<EnoRunResult>('/admin/eno/run', { method: 'POST', body: JSON.stringify(body) }, token),
  claimSubmission: (id: string, token: string) =>
    req<SubmissionListRow>(`/admin/submissions/${id}/claim`, { method: 'POST' }, token),
  releaseSubmission: (id: string, token: string) =>
    req<SubmissionListRow>(`/admin/submissions/${id}/release`, { method: 'POST' }, token),
  skipSubmission: (id: string, token: string) =>
    req<SubmissionListRow>(`/admin/submissions/${id}/skip`, { method: 'POST' }, token),
  abandonSubmission: (id: string, token: string) =>
    req<SubmissionListRow>(`/admin/submissions/${id}/abandon`, { method: 'POST' }, token),
  acceptSubmission: (id: string, body: { takes: { r2Url: string; r2ObjectKey?: string; byteSize?: number; contentType?: string }[] }, token: string) =>
    req<{ submission: SubmissionListRow; lineageRows: any[] }>(`/admin/submissions/${id}/accept`, { method: 'POST', body: JSON.stringify(body) }, token),
}
