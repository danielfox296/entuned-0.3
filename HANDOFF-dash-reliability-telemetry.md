# Handoff — Dash surface for player reliability telemetry

**Status:** Open. Phase 1 (player + server changes) shipped 2026-05-16. This document captures the deferred Dash work.

## What shipped on 2026-05-16

Phase-1 player reliability adds 10 new `event_type` values that flow through the existing `POST /events` ingest at [apps/server/src/routes/events.ts](apps/server/src/routes/events.ts):

| Event type | Emitted when | `extra` payload |
|---|---|---|
| `mediasession_action` | OS / lockscreen drives play/pause/next/seek | `{ action: 'play' \| 'pause' \| 'nexttrack' \| 'seekto', seekTime? }` |
| `wake_lock_acquired` | Screen Wake Lock granted | — |
| `wake_lock_failed` | Screen Wake Lock request rejected | `{ error }` |
| `wake_lock_released` | Wake Lock released (auto on iOS background, or explicit) | — |
| `playback_stalled` | Audio hasn't advanced for ≥6s while Howler thinks it's playing | `{ elapsed, duration }` |
| `playback_resumed_after_stall` | Progress moves again after a stall emit | `{ stall_duration_ms, elapsed }` |
| `visibility_hidden` | Tab/PWA backgrounded | `{ was_playing }` |
| `visibility_visible` | Tab/PWA foregrounded | `{ hidden_duration_ms, was_playing_on_hide, is_playing_on_show }` |
| `interruption_suspected` | Visibility back + was-playing + not-playing-now + operator didn't pause | `{ hidden_duration_ms }` |
| `pwa_standalone_launch` | Player mount; fires for every launch regardless of mode | `{ is_standalone, user_agent }` |

DB schema change: `playback_events.event_type` was demoted from a Postgres enum (`PlaybackEventType`) to plain `TEXT`. The allow-list lives at the Zod boundary in [apps/server/src/routes/events.ts](apps/server/src/routes/events.ts). Future event types ship as code-only deploys. Migration: [apps/server/prisma/migrations/20260516120000_demote_playback_event_type/](apps/server/prisma/migrations/20260516120000_demote_playback_event_type/).

## What Dash should build (when ready)

Daniel's directive 2026-05-16: defer Dash UI until phase-1 telemetry has accumulated a week of real data. Goals when we revisit:

1. **Interruption-rate panel per store.** Daily/weekly count of `interruption_suspected` events, normalized by listening hours. Drilldown by hour-of-day and weekday. Surfaces which stores have flaky wifi vs which have OS-driven kills.

2. **PWA install-adoption metric.** Ratio of `pwa_standalone_launch` events with `is_standalone=true` vs `false`, per store. Phase-2 decision input: if iOS standalone adoption is high but interruption rate is still bad, that's the signal to invest in native (Capacitor). If standalone adoption is low, the lever is operator coaching, not engineering.

3. **Stall heatmap.** `playback_stalled` count per store, faceted by hour-of-day. Distinguishes CDN/wifi blips from OS-driven kills.

4. **Wake-lock support panel.** Count of `wake_lock_failed` per store/UA — surfaces fleets stuck on old iOS where Wake Lock is unavailable.

5. **OS-mediated control share.** % of play/pause/skip events that came in via `mediasession_action` vs the in-app controls. Sanity-checks how often operators actually use the lock-screen surface.

All queries should filter on `event_type` and `store_id` — the existing partial index `idx_event_store_type_occurred` (Card 20) supports this.

## Phase-2 decision gates (informed by this telemetry)

- **If interruption_suspected rate < 5% of sessions:** the web reliability work was enough. Don't build Capacitor.
- **If interruption_suspected rate is 5-15% AND stalls dominate:** prioritize IndexedDB pre-buffer (item 4 in original strategy).
- **If interruption_suspected rate is 5-15% AND OS-mediated kills dominate (visibility-driven):** prioritize iOS 16.4+ Web Push resume nudges (item 6).
- **If interruption_suspected rate is >15% and persistent:** justify the $99/yr Apple Developer account and ship the Capacitor wrapper.

## Open questions for Dash build

- Should `interruption_suspected` be its own counter, or rolled into a broader "reliability score" composite (penalize stalls + interruptions + skip rate)?
- Time-window for normalization: per-day, per-hour, or per-session?
- Operator-visible vs internal-only? The honest answer might be "this is internal until we have enough data to talk about it without sounding defensive."
