// API client for the entuned-0.3 server.
// Switch base URL with VITE_API_URL at build time.

import { createRequestClient } from '@entuned/api-client'
// Auth/me response shapes are owned by the server via @entuned/contracts.
import type { AuthResponse, MeResponse } from '@entuned/contracts'
export type { AuthResponse, MeResponse }

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface QueueItem {
  type?: 'song' | 'ad'
  songId: string
  audioUrl: string
  // hookId / icpId are nullable: rows from the general pool (free-tier
  // Stores with no ICPs) have neither.
  hookId: string | null
  // songSeedId: cross-take generation id — two cuts of the same Suno
  // generation share it even when hookId is null. Used for sibling-aware
  // queue merging in the player.
  songSeedId: string | null
  outcomeId: string
  icpId: string | null
  icpName: string | null
  title: string | null
  hookText: string | null
  // Present when type === 'ad'
  assetId?: string
  campaignId?: string
}

export interface StoreBySlug {
  id: string
  name: string
  slug: string
  tier: string
  timezone: string
  pausedUntil: string | null
}

export interface ActiveOutcome {
  outcomeId: string
  title: string
  source: 'selection' | 'schedule' | 'default'
  expiresAt?: string
}

export interface NextResponse {
  storeId: string
  decidedAt: string
  activeOutcome: ActiveOutcome | null
  queue: QueueItem[]
  fallbackTier: 'normal' | 'panic'
  reason: 'no_pool' | null
  roomLoudnessSamplingEnabled: boolean
}

export interface OutcomeOption {
  outcomeId: string
  outcomeKey: string
  title: string
  tempoBpm: number
  mode: string
  poolSize: number
  /** Curated allowlist for free-tier visibility — operator toggles in Dash. */
  availableOnFree: boolean
}

// AuthResponse + MeResponse are imported from @entuned/contracts (re-exported above).

export type AudioEventType =
  | 'song_start' | 'song_complete' | 'song_skip' | 'song_report' | 'song_love'
  | 'outcome_selection' | 'outcome_selection_cleared' | 'playback_starved'
  | 'operator_login' | 'operator_logout' | 'ad_play'
  | 'room_loudness_sample'
  // Phase-1 reliability telemetry (2026-05-16).
  | 'mediasession_action'
  | 'wake_lock_acquired' | 'wake_lock_failed' | 'wake_lock_released'
  | 'playback_stalled' | 'playback_resumed_after_stall'
  | 'visibility_hidden' | 'visibility_visible'
  | 'interruption_suspected'
  | 'pwa_standalone_launch'
  // Phase-2 (2026-05-16): IndexedDB audio cache, explicit pause/resume,
  // Web Push subscription lifecycle.
  | 'audio_cache_hit' | 'audio_cache_miss'
  | 'operator_pause' | 'operator_resume'
  | 'push_subscribed' | 'push_unsubscribed'
  // Phase-3 (2026-05-17). song_load_failed: audio URL refused to load
  // (404 / CORS / decode). heartbeat: 60s liveness ping while playing —
  // lets analytics distinguish "music stopped" from "device died" without
  // waiting for the next song-event.
  | 'song_load_failed'
  | 'heartbeat'
  // Hendrix rotation debugging (2026-05-17). Emitted on every successful
  // /hendrix/next response so 'panic' fallback frequency is queryable.
  | 'queue_refill'

// Typed `extra` shape per event_type. Add entries here when you introduce a
// new event with structured payload; events not listed here default to
// `Record<string, unknown>`. Documents the wire format in one place instead
// of scattering it across emit() call sites.
export type EventExtra = {
  song_load_failed: { reason: 'aborted' | 'network' | 'decode' | 'src_unsupported' | 'unknown'; audio_url: string; media_error_code: number | null }
  song_complete: { /* completion_reason + play_duration_ms are first-class columns, not extra */ }
  heartbeat: { is_playing: boolean; queue_depth: number; current_outcome_id: string | null }
  pwa_standalone_launch: { is_standalone: boolean; user_agent: string }
  playback_stalled: { elapsed: number; duration: number }
  playback_resumed_after_stall: { stall_duration_ms: number; elapsed: number }
  room_loudness_sample: { dbfs_a: number; sample_window_ms: number; weighted: 'A' }
  ad_play: { assetId: string; campaignId: string }
  mediasession_action: { action: string; seekTime?: number | null }
  queue_refill: { fallback_tier: 'normal' | 'panic'; queue_size: number; all_outcomes: boolean; active_outcome_id: string | null; reason: 'no_pool' | null }
}

export type ExtraFor<T extends AudioEventType> = T extends keyof EventExtra ? EventExtra[T] : Record<string, unknown>

export interface OutgoingEvent {
  event_type: AudioEventType
  store_id: string
  occurred_at: string
  operator_id?: string | null
  song_id?: string | null
  hook_id?: string | null
  report_reason?: string | null
  outcome_id?: string | null
  extra?: Record<string, unknown> | null
  // Phase-3 correlation fields. Optional; older payloads still validate.
  playback_session_id?: string | null
  device_id?: string | null
  play_duration_ms?: number | null
  completion_reason?: 'ended' | 'skipped' | 'errored' | 'outcome_changed' | null
  effective_outcome_id?: string | null
  client_sent_at?: string | null
  client_build?: string | null
  idempotency_key?: string | null
}

const { req } = createRequestClient({ baseUrl: API_URL })

export const api = {
  login: (email: string, password: string) =>
    req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) =>
    req<MeResponse>('/auth/me', {}, token),
  next: (storeId: string, token: string, allOutcomes?: boolean) =>
    req<NextResponse>(`/hendrix/next?store_id=${encodeURIComponent(storeId)}${allOutcomes ? '&all_outcomes=true' : ''}`, {}, token),
  // Slug-mode: no Authorization header. The slug itself is the auth.
  nextBySlug: (slug: string, allOutcomes?: boolean) =>
    req<NextResponse>(`/hendrix/next?slug=${encodeURIComponent(slug)}${allOutcomes ? '&all_outcomes=true' : ''}`),
  storeBySlug: (slug: string) =>
    req<StoreBySlug>(`/stores/by-slug/${encodeURIComponent(slug)}`),
  outcomes: (storeId: string, token: string) =>
    req<OutcomeOption[]>(`/hendrix/outcomes?store_id=${encodeURIComponent(storeId)}`, {}, token),
  // Slug-mode: no Authorization header. Slug is the auth.
  outcomesBySlug: (slug: string) =>
    req<OutcomeOption[]>(`/hendrix/outcomes?slug=${encodeURIComponent(slug)}`),
  outcomeSelection: (storeId: string, outcomeId: string, token: string) =>
    req<{ outcomeId: string; expiresAt: string }>('/hendrix/outcome-selection', {
      method: 'POST',
      body: JSON.stringify({ store_id: storeId, outcome_id: outcomeId }),
    }, token),
  outcomeSelectionBySlug: (slug: string, outcomeId: string) =>
    req<{ outcomeId: string; expiresAt: string }>('/hendrix/outcome-selection', {
      method: 'POST',
      body: JSON.stringify({ slug, outcome_id: outcomeId }),
    }),
  clearOutcomeSelection: (storeId: string, token: string) =>
    req<{ ok: true }>('/hendrix/outcome-selection/clear', {
      method: 'POST',
      body: JSON.stringify({ store_id: storeId }),
    }, token),
  clearOutcomeSelectionBySlug: (slug: string) =>
    req<{ ok: true }>('/hendrix/outcome-selection/clear', {
      method: 'POST',
      body: JSON.stringify({ slug }),
    }),
  emit: (event: OutgoingEvent | OutgoingEvent[]) => {
    const body = Array.isArray(event) ? { events: event } : event
    return req<{ accepted: number }>('/events', { method: 'POST', body: JSON.stringify(body) })
  },
  loved: (storeId: string, token: string) =>
    req<{ songIds: string[] }>(`/events/loved?store_id=${encodeURIComponent(storeId)}`, {}, token),
  vapidPublicKey: () =>
    req<{ publicKey: string; configured: boolean }>(`/push/vapid-public-key`),
  pushSubscribe: (body: { store_id: string; endpoint: string; p256dh_key: string; auth_key: string; user_agent?: string; slug?: string }, token?: string) =>
    req<{ id: string }>(`/push/subscribe`, { method: 'POST', body: JSON.stringify(body) }, token),
  pushUnsubscribe: (endpoint: string) =>
    fetch(`${API_URL}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {}),
}
