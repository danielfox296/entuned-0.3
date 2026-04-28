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
    ...(init.headers as Record<string, string> | undefined),
  }
  // Only set Content-Type when there's actually a body — Fastify rejects empty JSON bodies
  // when the header is present.
  if (init.body != null) headers['Content-Type'] = 'application/json'
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
  outcomeSelectionId: string | null
  outcomeSelectionExpiresAt: string | null
  goLiveDate: string | null
}

export interface OutcomeRow {
  id: string
  outcomeKey: string
  version: number
  title: string
  displayTitle: string | null
  tempoBpm: number
  mode: string
  dynamics: string | null
  instrumentation: string | null
  supersededAt: string | null
}

// Operator-facing label for an outcome. Falls back to `title` (the LLM-prompt-facing
// identifier) when no displayTitle is set, e.g. on freshly-seeded rows.
export function outcomeLabel(o: { title: string; displayTitle?: string | null }): string {
  return o.displayTitle ?? o.title
}

// Same idea for the flattened `outcomeTitle`/`outcomeDisplayTitle` shape used in
// monitoring/playback/dry-run payloads.
export function outcomeLabelFromFlat(o: { outcomeTitle: string | null; outcomeDisplayTitle?: string | null }): string | null {
  return o.outcomeDisplayTitle ?? o.outcomeTitle
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

export interface StyleExclusionRuleRow {
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

export type PoolStatus = 'critical' | 'thin' | 'ok'

export interface PoolDepthCell {
  outcome: { id: string; title: string; displayTitle: string | null; version: number }
  count: number
  status: PoolStatus
}

export interface PoolDepthIcp {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
  stores: { id: string; name: string }[]
  outcomes: PoolDepthCell[]
}

export interface PoolDepthResponse {
  thresholds: { critical: number; thin: number }
  icps: PoolDepthIcp[]
}

export interface OutcomeFactorPromptRow {
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

export interface ReferenceTrackPromptRow {
  id: string
  version: number
  templateText: string
  notes: string | null
  createdAt: string
}

export interface SuggestReferenceTracksResult {
  createdCount: number
  promptVersion: number
}

// --- Brand: stores, ICPs, reference tracks, style analyses ---

export type TasteCategory = 'FormationEra' | 'Subculture' | 'Aspirational'

export interface StoreSummary {
  id: string
  name: string
  timezone: string
  clientId: string
  clientName: string
  icps: { id: string; name: string }[]
}

export interface IcpRow {
  id: string
  clientId: string
  storeId: string
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

export interface StyleAnalysisRow {
  id: string
  referenceTrackId: string
  styleAnalyzerInstructionsVersion: number
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

export type ReferenceTrackStatus = 'pending' | 'approved' | 'rejected'

export interface ReferenceTrackRow {
  id: string
  icpId: string
  bucket: TasteCategory
  artist: string
  title: string
  year: number | null
  operatorNotes: string | null
  status: ReferenceTrackStatus
  suggestedRationale: string | null
  suggestedPromptVer: number | null
  suggestedAt: string | null
  approvedAt: string | null
  useCount: number
  previewUrl: string | null
  previewSource: 'deezer' | 'itunes' | 'none' | null
  coverUrl: string | null
  createdAt: string
  styleAnalysis: StyleAnalysisRow | null
}

export interface StoreDetail {
  store: { id: string; name: string; timezone: string; clientId: string; clientName: string; goLiveDate: string | null; defaultOutcomeId: string | null }
  icps: (IcpRow & { referenceTracks: ReferenceTrackRow[] })[]
  sharedWith: { id: string; name: string; clientName: string }[]
}

export interface NewReferenceTrack {
  bucket: TasteCategory
  artist: string
  title: string
  year?: number | null
  operatorNotes?: string | null
}

export type IcpUpdate = Partial<Omit<IcpRow, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>
export type RefTrackUpdate = Partial<NewReferenceTrack>

export type ClientPlan = 'mvp_pilot' | 'trial' | 'paid_pilot' | 'production' | 'paused' | 'inactive'

export interface ClientListRow {
  id: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  plan: ClientPlan
  posProvider: string | null
  brandLyricGuidelines: string | null
  createdAt: string
  updatedAt: string
  storeCount: number
  icpCount: number
}

export interface ClientFull {
  id: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  plan: ClientPlan
  posProvider: string | null
  brandLyricGuidelines: string | null
  createdAt: string
  updatedAt: string
  stores: {
    id: string; name: string; timezone: string; goLiveDate: string | null
    icps: { id: string; name: string }[]
    defaultOutcome: { id: string; title: string; displayTitle: string | null; version: number } | null
  }[]
  icps: { id: string; name: string; hookCount: number; referenceTrackCount: number; storeCount: number }[]
}

export type ClientUpdate = Partial<{
  companyName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  plan: ClientPlan
  posProvider: string | null
  brandLyricGuidelines: string | null
}>

export interface OperatorRow {
  id: string
  email: string
  displayName: string | null
  isAdmin: boolean
  disabledAt: string | null
  stores: { id: string; name: string; clientName?: string | null }[]
}

export interface OperatorCreateBody {
  email: string
  password: string
  displayName?: string | null
  storeIds?: string[]
}

export interface OperatorUpdateBody {
  email?: string
  password?: string
  displayName?: string | null
  storeIds?: string[]
  disabled?: boolean
}

export interface StoreCreateBody {
  clientId: string
  name: string
  timezone: string
  goLiveDate?: string | null
  defaultOutcomeId?: string | null
}

export interface StoreUpdateBody {
  name?: string
  timezone?: string
  goLiveDate?: string | null
  defaultOutcomeId?: string | null
}

export interface IcpCreateBody {
  storeId: string
  name: string
}

// --- Song Creation ---

export type SongSeedStatus = 'assembling' | 'queued' | 'accepted' | 'abandoned' | 'skipped' | 'failed'

export interface SongSeedRow {
  id: string
  songSeedBatchId: string
  icpId: string
  hookId: string
  outcomeId: string
  referenceTrackId: string | null
  status: SongSeedStatus
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
  outcome: { id: string; title: string; displayTitle: string | null; version: number }
  referenceTrack: { id: string; artist: string; title: string } | null
  songSeedBatch: { id: string; startedAt: string; triggeredBy: string }
}

export interface SongSeedDetail extends SongSeedRow {
  stylePortionRaw: string | null
  outcomeFactorPromptVersion: number | null
  styleTemplateVersion: number | null
  lyricDraftPromptVersion: number | null
  lyricEditPromptVersion: number | null
  firedExclusionRuleIds: string[]
  outcome: any
  referenceTrack: any
  songSeedBatch: any
  lineageRows: any[]
}

export interface SeedBuilderResult {
  songSeedBatchId: string
  requestedN: number
  producedN: number
  reason: 'complete' | 'pool_exhausted' | 'precheck_failed'
  errors: string[]
}

export interface ScheduleSlot {
  id: string
  storeId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
  outcomeTitle: string
  outcomeDisplayTitle: string | null
  outcomeVersion: number
}

export type ScheduleSlotInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
}

export type DryRunSource = 'schedule' | 'default' | 'gap'
export type PoolStatusValue = 'critical' | 'thin' | 'ok'

export interface DryRunPeriod {
  startSec: number
  endSec: number
  startHHMM: string
  endHHMM: string
  source: DryRunSource
  outcomeId: string | null
  outcomeTitle: string | null
  outcomeDisplayTitle: string | null
  outcomeVersion: number | null
  outcomeSuperseded: boolean
  durationMin: number
  overlap: boolean
}

export interface DryRunDay {
  dayOfWeek: number
  label: string
  periods: DryRunPeriod[]
}

export interface DryRunOutcomeTotal {
  outcomeId: string
  outcomeTitle: string
  outcomeDisplayTitle: string | null
  outcomeVersion: number
  outcomeSuperseded: boolean
  scheduledMin: number
  defaultMin: number
  totalMin: number
  poolCount: number
  poolStatus: PoolStatusValue
}

export interface LineageRowFull {
  id: string
  active: boolean
  createdAt: string
  icpId: string
  icpName: string | null
  clientName: string | null
  storeName: string | null
  outcome: { id: string; title: string; displayTitle: string | null; version: number }
  hook: { id: string; text: string }
  song: { id: string; r2Url: string; byteSize: number | string | null }
}

export interface LineageRowList {
  total: number
  limit: number
  offset: number
  rows: LineageRowFull[]
}

export interface FlaggedSong {
  songId: string
  r2Url: string | null
  reportCount: number
  lastReportedAt: string
  reasons: Record<string, number>
  storeCount: number
  lineageRows: { id: string; active: boolean; hook: { id: string; text: string }; outcome: { id: string; title: string; displayTitle: string | null; version: number } }[]
  activeLineageCount: number
  anyActive: boolean
}

export interface FlaggedResponse {
  songs: FlaggedSong[]
}

export interface ScheduleDryRun {
  store: { id: string; name: string; timezone: string }
  icps: { id: string; name: string }[]
  defaultOutcome: { id: string; title: string; displayTitle: string | null; version: number; superseded: boolean } | null
  thresholds: { critical: number; thin: number }
  days: DryRunDay[]
  byOutcome: DryRunOutcomeTotal[]
  totals: { scheduledMin: number; defaultMin: number; gapMin: number; totalMin: number }
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
  outcomeDisplayTitle: string | null
}

export interface PlaybackEventRow {
  id: string
  eventType: string
  occurredAt: string
  songId: string | null
  hookId: string | null
  outcomeId: string | null
  outcomeTitle: string | null
  outcomeDisplayTitle: string | null
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
    outcomeSelectionId: string | null
    outcomeSelectionExpiresAt: string | null
  }
  active: {
    outcomeId: string
    outcomeTitle: string | null
    outcomeDisplayTitle: string | null
    source: 'selection' | 'schedule' | 'default'
    expiresAt: string | null
  } | null
  queue: QueueEntry[]
  fallbackTier: 'none' | 'daily_cap' | 'sibling_spacing' | 'no_repeat_window'
  reason: 'no_pool' | null
  outcomes: OutcomeWithPool[]
  recentEvents: PlaybackEventRow[]
}

export interface ProductionEraStub {
  id: string
  decade: string
  genreSlug: string
  genreDisplayName: string | null
}

export interface OutcomeRowFull {
  id: string
  outcomeKey: string
  version: number
  title: string
  displayTitle: string | null
  tempoBpm: number
  mode: string
  dynamics: string | null
  instrumentation: string | null
  familiarity: string | null
  productionEraId: string | null
  productionEra: ProductionEraStub | null
  supersededAt: string | null
  createdAt: string
}

export interface HookRowFull {
  id: string
  icpId: string
  outcomeId: string
  text: string
  status: 'draft' | 'approved' | 'retired'
  approvedAt: string | null
  approvedById: string | null
  createdAt: string
  updatedAt: string
  outcome: { id: string; title: string; displayTitle: string | null; version: number }
}

export type StyleAnalysisUpdate = Partial<{
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

export const api = {
  // Auth (same as player)
  login: (email: string, password: string) =>
    req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) =>
    req<MeResponse>('/auth/me', {}, token),

  // Health
  health: () =>
    req<HealthResponse>('/health'),

  // --- Engine (decomposer rules, style exclusion rules, style template, lyric prompts) ---

  musicologicalRules: (token: string) =>
    req<{ latest: MusicologicalRulesRow | null; history: MusicologicalRulesRow[] }>('/admin/musicological-rules', {}, token),
  saveMusicologicalRules: (rulesText: string, notes: string | undefined, token: string) =>
    req<MusicologicalRulesRow>('/admin/musicological-rules', { method: 'POST', body: JSON.stringify({ rulesText, notes }) }, token),

  styleExclusionRules: (token: string) =>
    req<StyleExclusionRuleRow[]>('/admin/style-exclusion-rules', {}, token),
  createStyleExclusionRule: (body: Omit<StyleExclusionRuleRow, 'id'>, token: string) =>
    req<StyleExclusionRuleRow>('/admin/style-exclusion-rules', { method: 'POST', body: JSON.stringify(body) }, token),
  updateStyleExclusionRule: (id: string, body: Omit<StyleExclusionRuleRow, 'id'>, token: string) =>
    req<StyleExclusionRuleRow>(`/admin/style-exclusion-rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteStyleExclusionRule: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/style-exclusion-rules/${id}`, { method: 'DELETE' }, token),

  styleTemplate: (token: string) =>
    req<{ latest: StyleTemplateRow | null; history: StyleTemplateRow[] }>('/admin/style-template', {}, token),
  saveStyleTemplate: (templateText: string, notes: string | undefined, token: string) =>
    req<StyleTemplateRow>('/admin/style-template', { method: 'POST', body: JSON.stringify({ templateText, notes }) }, token),
  outcomeFactorPrompt: (token: string) =>
    req<{ latest: OutcomeFactorPromptRow | null; history: OutcomeFactorPromptRow[] }>('/admin/outcome-factor-prompt', {}, token),
  saveOutcomeFactorPrompt: (templateText: string, notes: string | undefined, token: string) =>
    req<OutcomeFactorPromptRow>('/admin/outcome-factor-prompt', { method: 'POST', body: JSON.stringify({ templateText, notes }) }, token),

  referenceTrackPrompt: (token: string) =>
    req<{ latest: ReferenceTrackPromptRow | null; history: ReferenceTrackPromptRow[] }>('/admin/reference-track-prompt', {}, token),
  saveReferenceTrackPrompt: (templateText: string, notes: string | undefined, token: string) =>
    req<ReferenceTrackPromptRow>('/admin/reference-track-prompt', { method: 'POST', body: JSON.stringify({ templateText, notes }) }, token),
  suggestReferenceTracks: (icpId: string, token: string) =>
    req<SuggestReferenceTracksResult>(`/admin/icps/${icpId}/suggest-reference-tracks`, { method: 'POST' }, token),

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
  clients: (token: string) =>
    req<ClientListRow[]>('/admin/clients', {}, token),
  clientDetail: (id: string, token: string) =>
    req<ClientFull>(`/admin/clients/${id}`, {}, token),
  updateClient: (id: string, body: ClientUpdate, token: string) =>
    req<ClientFull>(`/admin/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  createClient: (body: { companyName: string }, token: string) =>
    req<ClientListRow>('/admin/clients', { method: 'POST', body: JSON.stringify(body) }, token),
  createStore: (body: StoreCreateBody, token: string) =>
    req<StoreSummary>('/admin/stores', { method: 'POST', body: JSON.stringify(body) }, token),
  updateStore: (id: string, body: StoreUpdateBody, token: string) =>
    req<StoreSummary & { goLiveDate: string | null; defaultOutcomeId: string | null }>(`/admin/stores/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  createIcp: (body: IcpCreateBody, token: string) =>
    req<IcpRow>('/admin/icps', { method: 'POST', body: JSON.stringify(body) }, token),
  updateIcp: (id: string, body: IcpUpdate, token: string) =>
    req<IcpRow>(`/admin/icps/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  createReferenceTrack: (icpId: string, body: NewReferenceTrack, token: string) =>
    req<ReferenceTrackRow>(`/admin/icps/${icpId}/reference-tracks`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateReferenceTrack: (id: string, body: RefTrackUpdate, token: string) =>
    req<ReferenceTrackRow>(`/admin/reference-tracks/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteReferenceTrack: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/reference-tracks/${id}`, { method: 'DELETE' }, token),
  resolveReferenceTrackPreview: (id: string, force: boolean, token: string) =>
    req<{ previewUrl: string | null; previewSource: 'deezer' | 'itunes' | 'none' | null; coverUrl: string | null }>(
      `/admin/reference-tracks/${id}/preview${force ? '?force=1' : ''}`,
      { method: 'POST' },
      token,
    ),
  decomposeReferenceTrack: (id: string, force: boolean, token: string) =>
    req<StyleAnalysisRow>(`/admin/reference-tracks/${id}/decompose${force ? '?force=1' : ''}`, { method: 'POST' }, token),
  rejectReferenceTrack: (id: string, token: string) =>
    req<ReferenceTrackRow>(`/admin/reference-tracks/${id}/reject`, { method: 'POST' }, token),
  approveReferenceTrack: (id: string, token: string) =>
    req<ReferenceTrackRow>(`/admin/reference-tracks/${id}/approve`, { method: 'POST' }, token),
  updateStyleAnalysis: (id: string, body: StyleAnalysisUpdate, token: string) =>
    req<StyleAnalysisRow>(`/admin/decompositions/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),

  // --- Hooks ---

  outcomes: (token: string) =>
    req<OutcomeRowFull[]>('/admin/outcomes', {}, token),
  outcomeLibrary: (token: string) =>
    req<(OutcomeRowFull & { lineageCount: number })[]>('/admin/outcomes?include=all', {}, token),
  createOutcome: (body: { title: string; displayTitle?: string | null; tempoBpm: number; mode: string; dynamics?: string | null; instrumentation?: string | null; familiarity?: string | null; productionEraId?: string | null }, token: string) =>
    req<OutcomeRowFull>('/admin/outcomes', { method: 'POST', body: JSON.stringify(body) }, token),
  editOutcome: (id: string, body: { title: string; displayTitle?: string | null; tempoBpm: number; mode: string; dynamics?: string | null; instrumentation?: string | null; familiarity?: string | null; productionEraId?: string | null }, token: string) =>
    req<OutcomeRowFull>(`/admin/outcomes/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  productionEras: (token: string) =>
    req<ProductionEraStub[]>('/admin/production-eras', {}, token),
  supersedeOutcome: (id: string, token: string) =>
    req<OutcomeRowFull>(`/admin/outcomes/${id}/supersede`, { method: 'POST' }, token),
  poolDepth: (token: string) =>
    req<PoolDepthResponse>('/admin/pool-depth', {}, token),
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
  bulkCreateHooks: (icpId: string, body: { outcomeId: string; texts: string[]; approve?: boolean }, token: string) =>
    req<{ created: number }>(`/admin/icps/${icpId}/hooks/bulk`, { method: 'POST', body: JSON.stringify(body) }, token),
  hookWriterPrompt: (icpId: string, token: string) =>
    req<{
      latest: { id: string; icpId: string; promptText: string; version: number; updatedAt: string }
      history: { id: string; icpId: string; version: number; promptText: string; notes: string | null; createdAt: string }[]
    }>(`/admin/icps/${icpId}/hook-writer-prompt`, {}, token),
  saveHookWriterPrompt: (icpId: string, promptText: string, notes: string | null, token: string) =>
    req<{ id: string; icpId: string; promptText: string; version: number }>(`/admin/icps/${icpId}/hook-writer-prompt`, { method: 'PUT', body: JSON.stringify({ promptText, notes }) }, token),
  retireHookPreview: (id: string, token: string) =>
    req<{ hookId: string; status: string; inFlightSongSeeds: number; activeLineageRows: number; warning: string | null }>(`/admin/hooks/${id}/retire-preview`, {}, token),
  retireHook: (id: string, force: boolean, token: string) =>
    req<HookRowFull>(`/admin/hooks/${id}/retire`, { method: 'POST', body: JSON.stringify({ force }) }, token),
  draftHooks: (icpId: string, body: { outcomeId: string; n: number }, token: string) =>
    req<{ hooks: string[] }>(`/admin/icps/${icpId}/hook-writer/run`, { method: 'POST', body: JSON.stringify(body) }, token),
  hookDrafterContext: (icpId: string, outcomeId: string, n: number, token: string) =>
    req<{ systemPrompt: string; userMessage: string }>(
      `/admin/icps/${icpId}/hook-writer/context?outcomeId=${encodeURIComponent(outcomeId)}&n=${n}`,
      {},
      token,
    ),

  // --- Playback ---

  liveStore: (id: string, token: string) =>
    req<LiveStoreView>(`/admin/stores/${id}/live`, {}, token),
  setOutcomeSelection: (id: string, outcomeId: string, token: string) =>
    req<{ outcomeId: string; expiresAt: string }>(`/admin/stores/${id}/outcome-selection`, { method: 'POST', body: JSON.stringify({ outcomeId }) }, token),
  clearOutcomeSelection: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/stores/${id}/outcome-selection/clear`, { method: 'POST' }, token),

  // --- Schedule ---

  schedule: (storeId: string, token: string) =>
    req<ScheduleSlot[]>(`/admin/stores/${storeId}/schedule`, {}, token),
  createScheduleSlot: (storeId: string, body: ScheduleSlotInput, token: string) =>
    req<ScheduleSlot>(`/admin/stores/${storeId}/schedule`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateScheduleSlot: (id: string, body: ScheduleSlotInput, token: string) =>
    req<ScheduleSlot>(`/admin/schedule-rows/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  deleteScheduleSlot: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/schedule-rows/${id}`, { method: 'DELETE' }, token),
  scheduleDryRun: (storeId: string, token: string) =>
    req<ScheduleDryRun>(`/admin/stores/${storeId}/schedule-dry-run`, {}, token),

  // --- Catalogue ---

  lineageRows: (
    params: { icpId?: string; outcomeId?: string; hookId?: string; active?: 'all' | 'true' | 'false'; limit?: number; offset?: number },
    token: string,
  ) => {
    const qs = new URLSearchParams()
    if (params.icpId) qs.set('icpId', params.icpId)
    if (params.outcomeId) qs.set('outcomeId', params.outcomeId)
    if (params.hookId) qs.set('hookId', params.hookId)
    if (params.active) qs.set('active', params.active)
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    const q = qs.toString() ? `?${qs.toString()}` : ''
    return req<LineageRowList>(`/admin/lineage-rows${q}`, {}, token)
  },
  setLineageRowActive: (id: string, active: boolean, token: string) =>
    req<LineageRowFull>(`/admin/lineage-rows/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }, token),
  flagged: (token: string) =>
    req<FlaggedResponse>('/admin/flagged', {}, token),
  retireFlagged: (songId: string, token: string) =>
    req<{ retired: number }>(`/admin/flagged/${songId}/retire`, { method: 'POST' }, token),

  // --- Song Creation ---

  songSeeds: (token: string, params: { icpId?: string; status?: string; claimedBy?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.icpId) qs.set('icpId', params.icpId)
    if (params.status) qs.set('status', params.status)
    if (params.claimedBy) qs.set('claimedBy', params.claimedBy)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString() ? `?${qs.toString()}` : ''
    return req<SongSeedRow[]>(`/admin/song-seeds${q}`, {}, token)
  },
  songSeedDetail: (id: string, token: string) =>
    req<SongSeedDetail>(`/admin/song-seeds/${id}`, {}, token),
  runSeedBuilder: (body: { icpId: string; outcomeId: string; n: number }, token: string) =>
    req<SeedBuilderResult>('/admin/eno/run', { method: 'POST', body: JSON.stringify(body) }, token),
  deleteSongSeed: (id: string, token: string) =>
    req<{ ok: true }>(`/admin/song-seeds/${id}`, { method: 'DELETE' }, token),
  acceptSongSeed: (id: string, body: { takes: { sourceUrl: string }[] }, token: string) =>
    req<{ songSeed: SongSeedRow; lineageRows: any[] }>(`/admin/song-seeds/${id}/accept`, { method: 'POST', body: JSON.stringify(body) }, token),

  // --- Operator management ---
  operators: (token: string) =>
    req<OperatorRow[]>('/admin/operators', {}, token),
  createOperator: (body: OperatorCreateBody, token: string) =>
    req<OperatorRow>('/admin/operators', { method: 'POST', body: JSON.stringify(body) }, token),
  updateOperator: (id: string, body: OperatorUpdateBody, token: string) =>
    req<OperatorRow>(`/admin/operators/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
}
