import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueueItem, type ActiveOutcome, type OutcomeOption, type AudioEventType } from "../api.js";
import { CrossfadePlayer } from "../audio/crossfade-player.js";
import { LoudnessSampler } from "../audio/loudness-sampler.js";
import { bufferEvent, flushNow } from "../lib/event-buffer.js";
import { CircleButton } from "../components/CircleButton.js";
import { DarkHalo } from "../components/DarkHalo.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { OutcomeModal } from "../components/OutcomeModal.js";
import { ReportModal, type ReportReason } from "../components/ReportModal.js";
import { saveSession, type Session } from "../lib/storage.js";
import logoUrl from "/entuned_logo.png";
import lockscreenArtUrl from "/lockscreen-art.png";

const PRELOAD_SECONDS_BEFORE_END = 8;
const CROSSFADE_MS = 800;
// Ads are mastered ~15-20% quieter than the music. HTML5 audio caps at 1.0 so we
// can't boost ads; instead we bring songs down by the same margin so ads sit at full.
const SONG_VOLUME = 0.47;
const AD_VOLUME = 1.0;
const LOVED_KEY = "entuned.loved.v1";

function loadLoved(): Set<string> {
  try {
    const raw = localStorage.getItem(LOVED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}
function saveLoved(s: Set<string>) {
  try { localStorage.setItem(LOVED_KEY, JSON.stringify([...s])); } catch {}
}

function trackLabel(item: QueueItem | null): string {
  if (!item) return "";
  if (item.type === "ad") return item.title ?? "Advertisement";
  if (item.title) return item.title;
  if (item.hookText) return item.hookText;
  const tail = item.audioUrl.split("/").pop() ?? "";
  return tail.replace(/\.(mp3|wav|m4a|ogg)$/i, "").replace(/[_-]+/g, " ");
}

type Props = {
  session: Session;
  onLogout: () => void;
};

export function PlayerScreen({ session, onLogout }: Props) {
  const playerRef = useRef<CrossfadePlayer | null>(null);
  const samplerRef = useRef<LoudnessSampler | null>(null);
  const samplerStartedRef = useRef(false);
  const samplingEnabledRef = useRef(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [activeOutcome, setActiveOutcome] = useState<ActiveOutcome | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeOption[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [lovedIds, setLovedIds] = useState<Set<string>>(() => loadLoved());
  const [allOutcomesMode, setAllOutcomesModeState] = useState(false);

  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const currentRef = useRef<QueueItem | null>(null);
  currentRef.current = currentItem;
  const nextLoadedRef = useRef<QueueItem | null>(null);
  const preloadTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const intentionalPauseRef = useRef(false);
  const trackStartedAtRef = useRef<string | null>(null);
  const allOutcomesModeRef = useRef(false);
  const lastResumeAttemptRef = useRef(0);
  const stallRef = useRef<{ elapsed: number; since: number }>({ elapsed: -1, since: 0 });
  const bufferingRef = useRef(false);

  const setAllOutcomesMode = useCallback((v: boolean) => {
    allOutcomesModeRef.current = v;
    setAllOutcomesModeState(v);
  }, []);

  // Slug-mode (freemium) vs operator-mode dispatch helper. In slug mode we
  // call /hendrix/next with ?slug= (no Authorization header); operator mode
  // uses ?store_id= + Bearer token as before.
  const fetchNext = useCallback((allOutcomes: boolean) => (
    session.mode === 'slug' && session.slug
      ? api.nextBySlug(session.slug, allOutcomes)
      : api.next(session.storeId, session.token, allOutcomes)
  ), [session.mode, session.slug, session.storeId, session.token]);

  const emit = useCallback((event_type: AudioEventType, item?: QueueItem | null, extra?: { report_reason?: string; outcome_id?: string }) => {
    const isAd = item?.type === "ad";
    const event = {
      event_type,
      store_id: session.storeId,
      occurred_at: new Date().toISOString(),
      // operator_id must be null (not '') in slug mode — the server zod
      // validator rejects '' as a non-uuid.
      operator_id: session.operatorId || null,
      song_id: isAd ? null : (item?.songId ?? null),
      hook_id: isAd ? null : (item?.hookId ?? null),
      report_reason: extra?.report_reason ?? null,
      outcome_id: extra?.outcome_id ?? (isAd ? null : item?.outcomeId ?? null),
      extra: isAd ? { assetId: item.assetId, campaignId: item.campaignId } : undefined,
    };
    // Session-boundary events flush immediately; everything else batches.
    if (event_type === 'operator_login' || event_type === 'operator_logout') {
      api.emit(event).catch((e) => console.warn("[player] emit failed", e));
    } else {
      bufferEvent(event);
    }
  }, [session.storeId, session.operatorId]);

  // Returns the raw server queue so callers can use it immediately without
  // waiting for React to flush the setQueue state update.
  const refill = useCallback(async (): Promise<QueueItem[]> => {
    try {
      const r = await fetchNext(allOutcomesModeRef.current);
      setActiveOutcome(r.activeOutcome);
      setReason(r.reason);
      setNetworkError(null);
      samplingEnabledRef.current = r.roomLoudnessSamplingEnabled;
      // Toggling OFF mid-session: release the mic immediately.
      if (!r.roomLoudnessSamplingEnabled && samplerStartedRef.current) {
        samplerRef.current?.stop();
        samplerStartedRef.current = false;
      }
      setQueue((prev) => {
        const have = new Set(prev.filter((q) => q.type !== "ad").map((q) => q.songId));
        if (currentRef.current?.type !== "ad") have.add(currentRef.current?.songId ?? "");
        if (nextLoadedRef.current?.type !== "ad") have.add(nextLoadedRef.current?.songId ?? "");
        have.delete("");
        // Always allow ad items through; dedup songs only.
        const additions = r.queue.filter((q) => q.type === "ad" || !have.has(q.songId));
        return [...prev, ...additions].slice(0, 6);
      });
      if (r.reason === "no_pool" && !currentRef.current) emit("playback_starved");
      return r.queue;
    } catch (e) {
      console.warn("[player] refill failed", e);
      setNetworkError("Connection issue. Retrying…");
      return [];
    }
  }, [fetchNext, emit]);

  const refreshOutcomes = useCallback(async () => {
    // Outcome management is operator-only — slug-mode (freemium) plays
    // whatever default outcome the Store has and doesn't surface picker UI.
    if (session.mode === 'slug') return;
    try {
      const r = await api.outcomes(session.storeId, session.token);
      setOutcomes(r);
    } catch (e) { console.warn("[player] outcomes failed", e); }
  }, [session.mode, session.storeId, session.token]);

  const schedulePreload = useCallback((durationSec: number) => {
    if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    const rawMs = (durationSec - PRELOAD_SECONDS_BEFORE_END - CROSSFADE_MS / 1000) * 1000;
    // If the track is shorter than the crossfade window (or duration was reported
    // near-zero by iOS before buffering), rawMs ≤ 0. Don't schedule — Math.max(1000)
    // would floor to 1s and trigger advanceToNext on every track in a 1-second loop.
    // onTrackEnded (native 'ended' event) reliably handles these short tracks instead.
    if (rawMs <= 0) return;
    const ms = Math.max(1000, rawMs);
    preloadTimerRef.current = window.setTimeout(() => {
      preloadTimerRef.current = null; // mark as fired so onTrackEnded's clearTimeout is a no-op
      void advanceToNext();
    }, ms);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preloadFollowing = useCallback(async () => {
    if (nextLoadedRef.current) return;
    let candidate = queueRef.current[0];
    if (!candidate) {
      const fresh = await refill();
      candidate = queueRef.current[0] ?? fresh[0];
    }
    if (!candidate) return;
    // Never preload ad items — ads must start at full volume via createAndPlay, not the
    // loadNext/startNext path which initialises the Howl at volume 0.
    if (candidate.type === "ad") return;
    // Guard against stale queueRef: if the candidate is the item currently playing
    // (ref hasn't been updated by React yet), skip it to avoid preloading the same track.
    if (candidate.songId === currentRef.current?.songId) return;
    nextLoadedRef.current = candidate;
    setQueue((prev) => prev.filter((q) => q.songId !== candidate!.songId));
    try {
      await playerRef.current?.loadNext(candidate.audioUrl);
    } catch (e) {
      console.warn("[player] loadNext failed", e);
      nextLoadedRef.current = null;
    }
  }, [refill]);

  const playFromQueue = useCallback(async () => {
    let head = queueRef.current[0];
    if (!head) {
      const fresh = await refill();
      // queueRef.current may still be stale (React batch); use the server's raw
      // response as a direct fallback so we never stall after an empty-queue refill.
      head = queueRef.current[0] ?? fresh.find(
        (q) => q.songId !== currentRef.current?.songId && q.songId !== nextLoadedRef.current?.songId
      ) ?? null;
    }
    if (!head) {
      setIsPlaying(false);
      wasPlayingRef.current = false;
      return;
    }
    setQueue((prev) => prev.filter((q) => q.songId !== head!.songId));
    setCurrentItem(head);
    // Sync currentRef so preloadFollowing (called below in the same tick) sees the
    // correct playing item and doesn't re-grab it from the stale queueRef.
    currentRef.current = head;
    trackStartedAtRef.current = new Date().toISOString();
    wasPlayingRef.current = true;
    if (head.type === "ad") {
      // Ads: full volume immediately, no preload timer — play to natural completion.
      playerRef.current?.createAndPlay(head.audioUrl, { volume: AD_VOLUME });
    } else {
      playerRef.current?.createAndPlay(head.audioUrl, { onDurationKnown: (durationSec) => {
        schedulePreload(durationSec);
      } });
    }
    setIsPlaying(true);
    emit(head.type === "ad" ? "ad_play" : "song_start", head);
    void preloadFollowing();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refill, schedulePreload, emit]);

  const advanceToNext = useCallback(async () => {
    const completed = currentRef.current;
    if (completed && completed.type !== "ad") emit("song_complete", completed);

    const queued = nextLoadedRef.current;
    if (queued) {
      nextLoadedRef.current = null;
      setCurrentItem(queued);
      // Sync currentRef before preloadFollowing so it sees the new playing item.
      currentRef.current = queued;
      trackStartedAtRef.current = new Date().toISOString();
      setIsPlaying(true);
      wasPlayingRef.current = true;

      if (queued.type === "ad") {
        // Ads must always play via createAndPlay: full volume immediately, no preload
        // timer. createAndPlay also unloads any stale preloaded Howl (this.next).
        playerRef.current?.createAndPlay(queued.audioUrl, { volume: AD_VOLUME });
        emit("ad_play", queued);
        void preloadFollowing();
        return;
      }

      const didStart = playerRef.current?.startNext() ?? false;
      if (didStart) {
        emit("song_start", queued);
        const p = playerRef.current?.getProgress();
        if (p?.duration) schedulePreload(p.duration);
        void preloadFollowing();
        return;
      }
      // startNext returned false (this.next was null — race or load error).
      // Fall through to createAndPlay using the queued item's URL directly.
      playerRef.current?.createAndPlay(queued.audioUrl, { onDurationKnown: (durationSec) => {
        schedulePreload(durationSec);
      } });
      emit("song_start", queued);
      void preloadFollowing();
      return;
    }
    await playFromQueue();
  }, [emit, playFromQueue, preloadFollowing, schedulePreload]);

  // User-initiated skip: always use createAndPlay with the next URL rather than
  // startNext. startNext relies on the preloaded Howl being in a playable state,
  // which is not guaranteed at skip time (buffering, volume 0, race with timer).
  // createAndPlay creates a fresh Howl and calls play() synchronously in the
  // user-gesture call stack — the most reliable path on all browsers.
  const skip = useCallback(async () => {
    const cur = currentRef.current;
    if (cur && cur.type !== "ad") emit("song_skip", cur);
    if (cur && cur.type !== "ad") emit("song_complete", cur);
    if (preloadTimerRef.current) { clearTimeout(preloadTimerRef.current); preloadTimerRef.current = null; }

    // Take preloaded item metadata first, then queue head.
    const next = nextLoadedRef.current ?? queueRef.current[0] ?? null;
    if (next) {
      nextLoadedRef.current = null;
      setQueue((prev) => prev.filter((q) => q.songId !== next.songId));
      setCurrentItem(next);
      currentRef.current = next;
      trackStartedAtRef.current = new Date().toISOString();
      wasPlayingRef.current = true;
      // createAndPlay also unloads any this.next preloaded Howl and fades out current.
      if (next.type === "ad") {
        playerRef.current?.createAndPlay(next.audioUrl, { volume: AD_VOLUME });
        emit("ad_play", next);
      } else {
        playerRef.current?.createAndPlay(next.audioUrl, { onDurationKnown: (durationSec) => {
          schedulePreload(durationSec);
        } });
        emit("song_start", next);
      }
      setIsPlaying(true);
      void preloadFollowing();
    } else {
      await playFromQueue();
    }
  }, [emit, playFromQueue, preloadFollowing, schedulePreload]);

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    // Lazy-start the loudness sampler on the first user gesture that initiates playback.
    // Permission prompt fires here, never on mount. Skipped entirely when the per-store flag is off.
    if (samplingEnabledRef.current && !samplerStartedRef.current && samplerRef.current) {
      samplerStartedRef.current = true;
      void samplerRef.current.start().then((res) => {
        // 'denied' → reset so a future page reload (after the user grants permission
        // in browser settings) gets another chance. 'unavailable' → leave true so we
        // don't keep re-checking on every play press; the result won't change this session.
        if (res === "denied") {
          samplerStartedRef.current = false;
          console.info("[player] loudness sampling denied by user");
        }
      });
    }
    if (!currentRef.current) {
      void playFromQueue();
      return;
    }
    if (isPlaying) {
      intentionalPauseRef.current = true;
      wasPlayingRef.current = false;
      if (preloadTimerRef.current) {
        clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
      player.pause();
      setIsPlaying(false);
    } else {
      wasPlayingRef.current = true;
      player.resume();
      setIsPlaying(true);
      const p = player.getProgress();
      if (p?.duration) {
        const remaining = Math.max(0, p.duration - p.elapsed);
        if (remaining > 0) schedulePreload(remaining);
      }
    }
  }, [isPlaying, playFromQueue, schedulePreload]);

  const handleSelectOutcome = useCallback(async (outcomeId: string) => {
    try {
      await api.outcomeSelection(session.storeId, outcomeId, session.token);
      setAllOutcomesMode(false);
      setShowOutcomeModal(false);
      setQueue([]);
      nextLoadedRef.current = null;
      await refill();
      await refreshOutcomes();
      if (!currentRef.current && wasPlayingRef.current) void playFromQueue();
    } catch (e) {
      console.error(e);
      setError("Could not change outcome.");
    }
  }, [session.storeId, session.token, refill, refreshOutcomes, playFromQueue, setAllOutcomesMode]);

  const handleClearOutcome = useCallback(async () => {
    try {
      await api.clearOutcomeSelection(session.storeId, session.token);
      setAllOutcomesMode(false);
      setShowOutcomeModal(false);
      setQueue([]);
      nextLoadedRef.current = null;
      await refill();
      await refreshOutcomes();
    } catch (e) {
      console.error(e);
      setError("Could not clear outcome selection.");
    }
  }, [session.storeId, session.token, refill, refreshOutcomes, setAllOutcomesMode]);

  const handleSelectAll = useCallback(async () => {
    try {
      // Clear any server-side operator selection so we're not overriding a schedule.
      await api.clearOutcomeSelection(session.storeId, session.token).catch(() => {/* ok if already clear */});
      setAllOutcomesMode(true);
      setShowOutcomeModal(false);
      setQueue([]);
      nextLoadedRef.current = null;
      await refill();
      await refreshOutcomes();
      if (!currentRef.current && wasPlayingRef.current) void playFromQueue();
    } catch (e) {
      console.error(e);
      setError("Could not switch to all-outcomes mode.");
    }
  }, [session.storeId, session.token, refill, refreshOutcomes, playFromQueue, setAllOutcomesMode]);

  const handleLove = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    if (lovedIds.has(cur.songId)) return;
    const next = new Set(lovedIds);
    next.add(cur.songId);
    setLovedIds(next);
    saveLoved(next);
    emit("song_love", cur);
  }, [lovedIds, emit]);

  const handleReport = useCallback((reason: ReportReason) => {
    setShowReportModal(false);
    const cur = currentRef.current;
    if (!cur) return;
    emit("song_report", cur, { report_reason: reason });
    void skip();
  }, [emit, skip]);

  const getProgress = useCallback(() => playerRef.current?.getProgress() ?? null, []);

  // ── Init / teardown ───────────────────────────────────────────────────────
  useEffect(() => {
    try {
      document.querySelectorAll("audio").forEach((el) => {
        try { el.pause(); el.removeAttribute("src"); el.load(); } catch {}
      });
    } catch {}
    playerRef.current = new CrossfadePlayer({ volume: SONG_VOLUME,
      crossfadeMs: CROSSFADE_MS,
      // Always advance when a track ends naturally. The preload timer (schedulePreload)
      // normally fires advanceToNext 8s before end for a smooth crossfade, but iOS
      // throttles JS timers when the screen sleeps — the timer may never fire. onend
      // comes from the native audio element and is reliable even under throttling,
      // so this is the fallback that keeps playback going. CrossfadePlayer strips
      // onend from the old Howl during crossfade, so double-advance is not possible.
      //
      // Cancel any pending preload timer first. If the timer was throttled and fires
      // after this callback, it would pick up the *next* preloaded track (loaded by
      // preloadFollowing inside advanceToNext) and immediately fade out the track that
      // just started — causing the "shows playing but no audio" symptom.
      onTrackEnded: () => {
        if (preloadTimerRef.current) { clearTimeout(preloadTimerRef.current); preloadTimerRef.current = null; }
        void advanceToNext();
      },
      onError: (err) => {
        console.error("[player] audio error", err);
        setError(`Audio error: ${String(err)}`);
      },
      // play() was rejected (autoplay policy, Chrome/iOS). Don't show a UI error —
      // the track isn't broken, the browser just refused the play() call. Try to
      // unlock the AudioContext first, then advance past the stalled track.
      onPlayError: (err) => {
        console.warn("[player] play error, advancing to next track", err);
        try {
          const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx;
          if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
        } catch {}
        if (preloadTimerRef.current) { clearTimeout(preloadTimerRef.current); preloadTimerRef.current = null; }
        void advanceToNext();
      },
      onPause: () => {
        if (intentionalPauseRef.current) { intentionalPauseRef.current = false; return; }
        if (!wasPlayingRef.current) return;
        const now = Date.now();
        if (now - lastResumeAttemptRef.current < 2000) return;
        lastResumeAttemptRef.current = now;
        // Unlock AudioContext immediately — but do NOT call playerRef.current?.resume() here.
        // With html5:true, resume() calls Howl.play() when playing() is false. On an
        // OS-interrupted audio element that is briefly paused, play() creates a second
        // <audio> clone from position 0, overlapping the original — the sustain-loop symptom.
        try {
          const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx;
          if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
        } catch {}
        // Delayed resume handles actual playback restart. If iOS fully suspends the page
        // before this fires, the visibilitychange handler covers the wake-up resume.
        window.setTimeout(() => {
          if (!wasPlayingRef.current) return;
          try {
            const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx;
            if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
          } catch {}
          playerRef.current?.resume();
        }, 250);
      },
    });
    samplerRef.current = new LoudnessSampler({
      onSample: (s) => {
        bufferEvent({
          event_type: "room_loudness_sample",
          store_id: session.storeId,
          occurred_at: new Date().toISOString(),
          operator_id: session.operatorId,
          extra: s,
        });
      },
      isPlaying: () => playerRef.current?.isPlaying() ?? false,
    });

    void refill();
    void refreshOutcomes();
    if (session.mode !== 'slug') {
      api.loved(session.storeId, session.token).then((r) => {
        setLovedIds((prev) => {
          const merged = new Set(prev);
          for (const id of r.songIds) merged.add(id);
          saveLoved(merged);
          return merged;
        });
      }).catch((e) => console.warn("[player] loved hydrate failed", e));
      emit("operator_login");
    }
    return () => {
      if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
      playerRef.current?.stop();
      playerRef.current = null;
      samplerRef.current?.stop();
      samplerRef.current = null;
      samplerStartedRef.current = false;
      flushNow();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background refresh: prune stale ads when a campaign ends in Dash ─────
  // Critical: ads for an ended campaign must stop immediately. The player
  // otherwise only refills on mount / outcome change / network recovery, so a
  // campaign ended in the admin would keep playing its ad until tab reload.
  // Poll the server every 15s; if it no longer returns an ad, drop any pending
  // ads from the queue/preload slot AND skip past one currently playing.
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetchNext(allOutcomesModeRef.current);
        const serverHasAd = r.queue.some((q) => q.type === "ad");
        if (serverHasAd) return;
        setQueue((prev) => prev.filter((q) => q.type !== "ad"));
        if (nextLoadedRef.current?.type === "ad") {
          console.info("[player] dropping preloaded ad — campaign no longer active");
          nextLoadedRef.current = null;
        }
        if (currentRef.current?.type === "ad") {
          console.info("[player] skipping currently-playing ad — campaign no longer active");
          void skip();
        }
      } catch (e) {
        console.warn("[player] background refresh failed", e);
      }
    };
    void check();
    const iv = window.setInterval(() => void check(), 15_000);
    return () => clearInterval(iv);
  }, [fetchNext, skip]);

  // ── Online indicator: 30s polling against /auth/me ────────────────────────
  // Operator-only — slug mode has no operator token. Slug mode just stays
  // optimistically online (any next-fetch failure flips the network banner
  // anyway via refill's catch path).
  useEffect(() => {
    if (session.mode === 'slug') { setOnline(true); return; }
    let cancelled = false;
    const check = async () => {
      try {
        await api.me(session.token);
        if (!cancelled) setOnline(true);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void check();
    const iv = window.setInterval(() => void check(), 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [session.mode, session.token]);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); setNetworkError(null); void refill(); };
    const handleOffline = () => { setOnline(false); setNetworkError("No internet connection. Music will resume when you're back online."); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refill]);

  // ── Stall detection: audio stream frozen (spotty WiFi / CDN buffer gap) ────
  // Polls elapsed every 2s. If elapsed hasn't advanced for 6s while Howler
  // reports playing, the audio element is stuck (buffer underrun, CDN stall).
  // Show a banner at 6s; auto-skip after 20s.
  useEffect(() => {
    const WARN_MS = 6_000;
    const SKIP_MS = 20_000;

    const check = () => {
      const player = playerRef.current;
      // Only run when Howler believes the audio is actively playing.
      if (!player || !player.isPlaying()) {
        if (bufferingRef.current) { bufferingRef.current = false; setBuffering(false); }
        stallRef.current = { elapsed: -1, since: Date.now() };
        return;
      }

      const p = player.getProgress();
      if (!p || p.duration <= 0) return;
      // Last 5% of the track is the natural-end zone — don't false-positive here.
      if (p.elapsed >= p.duration * 0.95) return;

      const now = Date.now();
      const stall = stallRef.current;

      if (stall.elapsed < 0 || Math.abs(p.elapsed - stall.elapsed) > 0.1) {
        // Progress is moving — healthy.
        stallRef.current = { elapsed: p.elapsed, since: now };
        if (bufferingRef.current) { bufferingRef.current = false; setBuffering(false); }
        return;
      }

      const stalledMs = now - stall.since;
      if (stalledMs >= WARN_MS && !bufferingRef.current) {
        console.warn(`[player] audio stalled at ${p.elapsed.toFixed(1)}s / ${p.duration.toFixed(1)}s`);
        bufferingRef.current = true;
        setBuffering(true);
      }
      if (stalledMs >= SKIP_MS) {
        console.warn("[player] stall timeout — skipping track");
        stallRef.current = { elapsed: -1, since: now };
        bufferingRef.current = false;
        setBuffering(false);
        void skip();
      }
    };

    const iv = window.setInterval(check, 2_000);
    return () => clearInterval(iv);
  }, [skip]);

  // Reset stall clock whenever the playing track changes.
  useEffect(() => {
    stallRef.current = { elapsed: -1, since: Date.now() };
    if (bufferingRef.current) { bufferingRef.current = false; setBuffering(false); }
  }, [currentItem]);

  // ── Resume after tab refocus / screen wake ────────────────────────────────
  useEffect(() => {
    const resume = () => {
      if (!wasPlayingRef.current) return;
      // Unlock Howler's Web Audio context first — iOS suspends it on backgrounding.
      try {
        const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx;
        if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      } catch {}
      const player = playerRef.current;
      if (!player || player.isPlaying()) return;
      player.resume();
      setIsPlaying(true);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") resume(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", resume);
    };
  }, []);

  // ── MediaSession: lock-screen controls + keep-alive on iOS ───────────────
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => {
      playerRef.current?.resume();
      wasPlayingRef.current = true;
      setIsPlaying(true);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      intentionalPauseRef.current = true;
      wasPlayingRef.current = false;
      playerRef.current?.pause();
      setIsPlaying(false);
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => skip());
    navigator.mediaSession.setActionHandler("previoustrack", null);
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [skip]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentItem) return;
    // MediaSession requires absolute URLs for artwork on iOS.
    const abs = (path: string) => new URL(path, window.location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackLabel(currentItem) || "Untitled",
      artist: "Entuned",
      album: session.storeName,
      artwork: [
        { src: abs(lockscreenArtUrl), sizes: "512x512", type: "image/png" },
        { src: abs("/favicon-192x192.png"), sizes: "192x192", type: "image/png" },
        { src: abs("/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
      ],
    });
  }, [currentItem, session.storeName]);

  // Keep the OS lock-screen play/pause button state in sync.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !isPlaying) return;
    const iv = window.setInterval(() => {
      const p = playerRef.current?.getProgress();
      if (!p || !p.duration) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: p.duration,
          position: Math.min(p.elapsed, p.duration),
          playbackRate: 1,
        });
      } catch {}
    }, 1000);
    return () => clearInterval(iv);
  }, [isPlaying]);

  const activeTitle = allOutcomesMode ? "All" : (activeOutcome?.title ?? "—");
  const expiresLabel = !allOutcomesMode && activeOutcome?.source === "selection" && activeOutcome.expiresAt
    ? `Selected · until ${new Date(activeOutcome.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : null;

  const headerLine = session.clientName
    ? `${session.clientName}: ${session.storeName}`
    : session.storeName;

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        minHeight: "100vh",
        overflow: "hidden",
        background: "radial-gradient(ellipse at center, #282824 0%, #20201c 55%, #1a1a17 100%)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 28px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <img src={logoUrl} alt="Entuned" style={{ width: 146, opacity: 0.75 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            onClick={() => setShowLogoutConfirm((v) => !v)}
            style={{ display: "flex", alignItems: "center", cursor: "pointer", userSelect: "none" }}
          >
            <span style={{ fontSize: 13, fontWeight: 300, letterSpacing: 1.5, color: "rgba(212,225,229,0.65)", textTransform: "uppercase" }}>
              {headerLine}
            </span>
          </div>
          <div
            style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "#27ae60" : "#e74c3c", flexShrink: 0 }}
            title={online ? "Online" : "Offline"}
          />
        </div>
      </div>

      {showLogoutConfirm ? (
        <div style={{ position: "absolute", top: 70, right: 28, zIndex: 50, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {(session.availableStores ?? []).filter((s) => s.id !== session.storeId).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                emit("operator_logout");
                const next: Session = {
                  ...session,
                  storeId: s.id,
                  storeName: s.name,
                  clientName: s.clientName ?? null,
                };
                saveSession(next);
                window.location.reload();
              }}
              style={{
                fontSize: 10,
                fontWeight: 400,
                letterSpacing: 1.5,
                color: "rgba(212,225,229,0.85)",
                background: "rgba(212,225,229,0.04)",
                border: "1px solid rgba(212,225,229,0.25)",
                borderRadius: 12,
                padding: "6px 16px",
                textTransform: "uppercase",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title={`Switch to ${s.clientName ? s.clientName + ' — ' : ''}${s.name}`}
            >
              {s.clientName ? `${s.clientName} — ${s.name}` : s.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { emit("operator_logout"); onLogout(); }}
            style={{
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: 1.5,
              color: "rgba(240,153,123,0.95)",
              background: "rgba(240,153,123,0.06)",
              border: "1px solid rgba(240,153,123,0.45)",
              borderRadius: 12,
              padding: "6px 16px",
              textTransform: "uppercase",
            }}
          >
            Logout
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", paddingBottom: 40, gap: 60 }}>
        <DarkHalo>
          {allOutcomesMode && currentItem ? (() => {
            const outcomeTitle = outcomes.find((o) => o.outcomeId === currentItem.outcomeId)?.title ?? null;
            return outcomeTitle ? (
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.5, color: "rgba(80,146,156,0.65)", textTransform: "uppercase", textAlign: "center", marginBottom: 6 }}>
                {outcomeTitle}
              </div>
            ) : null;
          })() : null}
          <div
            style={{
              fontSize: 36,
              fontWeight: 400,
              color: "rgba(212,225,229,0.9)",
              letterSpacing: 6,
              lineHeight: 1.7,
              textTransform: "uppercase",
              textAlign: "center",
              padding: "0 40px",
              minHeight: "1em",
              maxWidth: 900,
              wordBreak: "break-word",
            }}
          >
            {currentItem ? trackLabel(currentItem) : reason === "no_pool" ? "Silent" : ""}
          </div>
          {currentItem?.icpName ? (
            <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: 2, color: "rgba(212,225,229,0.28)", textTransform: "uppercase", marginTop: 8, textAlign: "center" }}>
              {currentItem.icpName}
            </div>
          ) : null}
        </DarkHalo>

        {currentItem ? <ProgressBar getProgress={getProgress} /> : null}

        {networkError ? (
          <div style={{ padding: "10px 24px", background: "rgba(80,146,156,0.08)", border: "1px solid rgba(80,146,156,0.25)", borderRadius: 12, maxWidth: 440, textAlign: "center", fontSize: 12, color: "rgba(80,146,156,0.85)" }}>
            {networkError}
          </div>
        ) : null}

        {buffering && !networkError ? (
          <div style={{ padding: "10px 24px", background: "rgba(215,175,116,0.07)", border: "1px solid rgba(215,175,116,0.22)", borderRadius: 12, maxWidth: 440, textAlign: "center", fontSize: 12, color: "rgba(215,175,116,0.8)" }}>
            Buffering — poor connection. Will skip if needed.
          </div>
        ) : null}

        {error ? (
          <div style={{ padding: "10px 24px", background: "rgba(231,76,60,0.12)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: 12, maxWidth: 440, textAlign: "center", fontSize: 12, color: "rgba(231,76,60,0.95)" }}>
            {error}
          </div>
        ) : null}

        <DarkHalo style={{ display: "flex", gap: 36, alignItems: "center" }}>
          <CircleButton onClick={togglePlayPause} ariaLabel={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? (
              <svg width="36" height="36" viewBox="0 0 28 28">
                <rect x="7" y="5" width="5" height="18" rx="1.5" fill="rgba(212,225,229,0.9)" />
                <rect x="16" y="5" width="5" height="18" rx="1.5" fill="rgba(212,225,229,0.9)" />
              </svg>
            ) : (
              <svg width="36" height="36" viewBox="0 0 28 28">
                <path d="M9 4l12 8-12 8z" fill="rgba(212,225,229,0.9)" />
              </svg>
            )}
          </CircleButton>
          <CircleButton onClick={skip} ariaLabel="Skip">
            <svg width="34" height="34" viewBox="0 0 24 24">
              <path d="M4.5 5l10 7-10 7zm12.5 0v14h2.5V5z" fill="rgba(212,225,229,0.9)" />
            </svg>
          </CircleButton>
        </DarkHalo>

        {(() => {
          const idle = !currentItem;
          const loved = currentItem ? lovedIds.has(currentItem.songId) : false;
          const heartStroke = idle ? "rgba(212,225,229,0.15)" : "rgba(212,225,229,0.35)";
          const flagStroke = idle ? "rgba(212,225,229,0.15)" : "rgba(212,225,229,0.35)";
          return (
            <div style={{ display: "flex", gap: 56, justifyContent: "center", alignItems: "center" }}>
              <button
                type="button"
                disabled={idle}
                onClick={idle ? undefined : handleLove}
                aria-label="Love this track"
                style={{ background: "none", border: "none", cursor: idle ? "not-allowed" : "pointer", padding: 8, lineHeight: 0, opacity: idle ? 0.55 : 1 }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24">
                  {loved ? (
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#e05a3a" />
                  ) : (
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke={heartStroke} strokeWidth="1.5" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                disabled={idle}
                onClick={idle ? undefined : () => setShowReportModal(true)}
                aria-label="Report this track"
                style={{ background: "none", border: "none", cursor: idle ? "not-allowed" : "pointer", padding: 8, lineHeight: 0, opacity: idle ? 0.55 : 1 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 21V4h11l1 2h4v11h-5l-1-2H6v6z" stroke={flagStroke} strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        })()}
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: "16px 24px 44px" }}>
        <div
          onClick={() => setShowOutcomeModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 28px",
            borderRadius: 100,
            background: "rgba(80,146,156,0.09)",
            border: "1px solid rgba(80,146,156,0.22)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 2.5, color: "rgba(212,225,229,0.45)", textTransform: "uppercase" }}>
              Outcome
            </span>
            <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: 2, color: "rgba(212,225,229,0.95)", textTransform: "uppercase" }}>
              {activeTitle}
            </span>
            {expiresLabel ? (
              <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: 2, color: "rgba(240,153,123,0.75)", textTransform: "uppercase", marginTop: 2 }}>
                {expiresLabel}
              </span>
            ) : null}
          </div>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="rgba(212,225,229,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {showOutcomeModal ? (
        <OutcomeModal
          outcomes={outcomes}
          activeId={allOutcomesMode ? null : (activeOutcome?.outcomeId ?? null)}
          allOutcomesMode={allOutcomesMode}
          onSelect={handleSelectOutcome}
          onSelectAll={handleSelectAll}
          onClear={!allOutcomesMode && activeOutcome?.source === "selection" ? handleClearOutcome : null}
          onClose={() => setShowOutcomeModal(false)}
        />
      ) : null}

      {showReportModal ? (
        <ReportModal onSelect={handleReport} onClose={() => setShowReportModal(false)} />
      ) : null}
    </div>
  );
}
