# Handoff — Player reliability work

**Status:** Phase 1 + Phase 2 shipped 2026-05-16. This doc now tracks only the deferred native-app decision.

---

## What's live (2026-05-16)

### Phase 1 — telemetry foundation

- **Screen Wake Lock** lifecycle tied to `isPlaying`; re-acquires on visibility-visible (iOS auto-releases on background).
- **MediaSession** handlers emit `mediasession_action` so Dash sees OS-mediated control share; `seekto` wired.
- **Stall detector** at [PlayerScreen.tsx](apps/player/src/screens/PlayerScreen.tsx) now emits `playback_stalled` + `playback_resumed_after_stall` instead of console-warning into the void.
- **Visibility telemetry** + `interruption_suspected` heuristic (audio was playing on hide, not playing on show, operator didn't pause).
- **PWA install coach** ([PWAInstallTip.tsx](apps/player/src/components/PWAInstallTip.tsx)) for iOS Safari / Android Chrome; emits `pwa_standalone_launch` on every mount.
- **DB schema** demoted `playback_events.event_type` from Postgres enum to TEXT; allow-list at Zod boundary in [routes/events.ts](apps/server/src/routes/events.ts).
- Migration: [20260516120000_demote_playback_event_type](apps/server/prisma/migrations/20260516120000_demote_playback_event_type/migration.sql).

### Phase 2 — service worker, audio cache, web push, Dash

- **Service worker** via `vite-plugin-pwa` ([sw.ts](apps/player/src/sw.ts), [sw-register.ts](apps/player/src/lib/sw-register.ts)). App-shell precaching + push handlers.
- **IndexedDB audio cache** ([audio-cache.ts](apps/player/src/lib/audio-cache.ts)). Pre-fetches next 2 tracks on every queue refill; LRU eviction at ~100MB. Survives 60+ second wifi/CDN blips. Emits `audio_cache_hit` / `audio_cache_miss`.
- **Web Push resume nudge.** Server: [push.ts](apps/server/src/lib/push.ts), [routes/push.ts](apps/server/src/routes/push.ts), heartbeat cron [playbackHeartbeat.ts](apps/server/src/lib/playbackHeartbeat.ts) (runs every 5 min). Player: [push-client.ts](apps/player/src/lib/push-client.ts) auto-enrolls once permission is granted and the operator has listened to ≥1 song. iOS gates push to installed PWAs; Android works in either mode.
- **Dash Player Reliability panel** at Monitoring → Player Reliability ([PlayerReliability.tsx](apps/admin/src/panels/monitoring/PlayerReliability.tsx)). Per-store rollup: interruptions/session, stalls, wake-lock failures, install adoption, OS-mediated control share, audio cache hit-rate, net push subscriptions.
- Migration: [20260516130000_push_subscriptions](apps/server/prisma/migrations/20260516130000_push_subscriptions/migration.sql).

### Event-type allow-list (current)

```
// Card 19 originals (12):
song_start, song_complete, song_skip, song_report, song_love,
outcome_selection, outcome_selection_cleared, playback_starved,
operator_login, operator_logout, ad_play, room_loudness_sample

// Phase-1 reliability (10):
mediasession_action, wake_lock_acquired, wake_lock_failed, wake_lock_released,
playback_stalled, playback_resumed_after_stall,
visibility_hidden, visibility_visible,
interruption_suspected, pwa_standalone_launch

// Phase-2 reliability (6):
audio_cache_hit, audio_cache_miss,
operator_pause, operator_resume,
push_subscribed, push_unsubscribed
```

### Required Railway env vars

For Web Push to function, the server needs:

| Var | Value |
|---|---|
| `PUSH_VAPID_PUBLIC_KEY` | from `pnpm exec web-push generate-vapid-keys` |
| `PUSH_VAPID_PRIVATE_KEY` | from same command |
| `PUSH_VAPID_SUBJECT` | optional; defaults to `mailto:hi@entuned.co` |

The heartbeat cron + the `/push/vapid-public-key` endpoint both feature-detect on `PUSH_VAPID_PUBLIC_KEY` presence — if it's unset, push is silently skipped and the rest of the server runs normally.

To disable the heartbeat cron without removing VAPID keys, set `PLAYBACK_HEARTBEAT_DISABLED=1`.

---

## What's deferred — native Capacitor wrapper

This is the only remaining piece from the original strategy. The decision gates depend on data the new telemetry will surface:

- **Interruption rate < 5% of sessions:** the web work was enough. Don't build Capacitor.
- **Interruption rate 5–15%, stalls dominate:** the IndexedDB cache should be catching these. If not, debug the cache before building native.
- **Interruption rate 5–15%, OS-mediated kills dominate:** Web Push is now catching the recovery. If push delivery rate is high but operators aren't returning to the tab, that's the trigger for Capacitor.
- **Interruption rate > 15% persistent:** justify the $99/yr Apple Developer account, ship Capacitor.

Worth watching alongside: **PWA install adoption ratio**. If it's stuck below ~30% after a month of the in-app coach, the conversion friction of "Add to Home Screen" is itself the bottleneck, and Capacitor (with a real App Store listing) bypasses it. That's a different argument for native than reliability gaps.

## Open questions

- Should the reliability panel let operators drill into a single store's event-stream timeline? Today it's roll-ups only.
- Operator-visible vs internal-only for the reliability data? Currently admin-only.
- Push delivery telemetry — we emit `push_subscribed` from the client but don't log actual push send/deliver events server-side. Worth adding a `PushDelivery` table if we want delivery-rate stats by user-agent.
