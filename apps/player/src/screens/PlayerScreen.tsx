import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueueItem, type ActiveOutcome, type OutcomeOption, type AudioEventType } from "../api.js";
import { CrossfadePlayer } from "../audio/crossfade-player.js";
import { CircleButton } from "../components/CircleButton.js";
import { DarkHalo } from "../components/DarkHalo.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { OutcomeModal } from "../components/OutcomeModal.js";
import { ReportModal, type ReportReason } from "../components/ReportModal.js";
import type { Session } from "../lib/storage.js";
import logoUrl from "/entuned_logo.png";
import touchIconUrl from "/apple-touch-icon.png";

const PRELOAD_SECONDS_BEFORE_END = 8;
const CROSSFADE_MS = 800;
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
  if (item.title) return item.title;
  if (item.hookText) return item.hookText;
  // Last-resort fallback if neither title nor hook text is hydrated.
  const tail = item.audioUrl.split("/").pop() ?? "";
  return tail.replace(/\.(mp3|wav|m4a|ogg)$/i, "").replace(/[_-]+/g, " ");
}

type Props = {
  session: Session;
  onLogout: () => void;
};

export function PlayerScreen({ session, onLogout }: Props) {
  const playerRef = useRef<CrossfadePlayer | null>(null);

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
  const [lovedIds, setLovedIds] = useState<Set<string>>(() => loadLoved());

  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const currentRef = useRef<QueueItem | null>(null);
  currentRef.current = currentItem;
  const nextLoadedRef = useRef<QueueItem | null>(null);
  const preloadTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const intentionalPauseRef = useRef(false);
  const trackStartedAtRef = useRef<string | null>(null);

  const emit = useCallback((event_type: AudioEventType, item?: QueueItem | null, extra?: { report_reason?: string; outcome_id?: string }) => {
    api.emit({
      event_type,
      store_id: session.storeId,
      occurred_at: new Date().toISOString(),
      operator_id: session.operatorId,
      song_id: item?.songId ?? null,
      hook_id: item?.hookId ?? null,
      report_reason: extra?.report_reason ?? null,
      outcome_id: extra?.outcome_id ?? item?.outcomeId ?? null,
    }).catch((e) => console.warn("[player] emit failed", e));
  }, [session.storeId, session.operatorId]);

  const refill = useCallback(async () => {
    try {
      const r = await api.next(session.storeId, session.token);
      setActiveOutcome(r.activeOutcome);
      setReason(r.reason);
      setNetworkError(null);
      setQueue((prev) => {
        const have = new Set(prev.map((q) => q.songId));
        if (currentRef.current) have.add(currentRef.current.songId);
        if (nextLoadedRef.current) have.add(nextLoadedRef.current.songId);
        const additions = r.queue.filter((q) => !have.has(q.songId));
        return [...prev, ...additions].slice(0, 6);
      });
      if (r.reason === "no_pool" && !currentRef.current) emit("playback_starved");
    } catch (e) {
      console.warn("[player] refill failed", e);
      setNetworkError("Connection issue. Retrying…");
    }
  }, [session.storeId, session.token, emit]);

  const refreshOutcomes = useCallback(async () => {
    try {
      const r = await api.outcomes(session.storeId, session.token);
      setOutcomes(r);
    } catch (e) { console.warn("[player] outcomes failed", e); }
  }, [session.storeId, session.token]);

  // Schedule a preload timer to start the next track ~PRELOAD_SECONDS_BEFORE_END
  // before the current finishes, so the crossfade is seamless.
  const schedulePreload = useCallback((durationSec: number) => {
    if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    const ms = Math.max(1000, (durationSec - PRELOAD_SECONDS_BEFORE_END - CROSSFADE_MS / 1000) * 1000);
    preloadTimerRef.current = window.setTimeout(() => {
      void advanceToNext();
    }, ms);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Take the head of the queue and play it via createAndPlay (start-of-session
  // or recovery path). Also kicks off preloading the following track.
  const playFromQueue = useCallback(async () => {
    let head = queueRef.current[0];
    if (!head) {
      await refill();
      head = queueRef.current[0];
    }
    if (!head) {
      setIsPlaying(false);
      wasPlayingRef.current = false;
      return;
    }
    setQueue((prev) => prev.slice(1));
    setCurrentItem(head);
    trackStartedAtRef.current = new Date().toISOString();
    wasPlayingRef.current = true;
    playerRef.current?.createAndPlay(head.audioUrl, (durationSec) => {
      schedulePreload(durationSec);
    });
    setIsPlaying(true);
    emit("song_start", head);
    void preloadFollowing();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refill, schedulePreload, emit]);

  // Preload the following track (queue head after current) into player.next.
  const preloadFollowing = useCallback(async () => {
    if (nextLoadedRef.current) return;
    if (queueRef.current.length === 0) await refill();
    const candidate = queueRef.current[0];
    if (!candidate) return;
    nextLoadedRef.current = candidate;
    setQueue((prev) => prev.slice(1));
    try {
      await playerRef.current?.loadNext(candidate.audioUrl);
    } catch (e) {
      console.warn("[player] loadNext failed", e);
      nextLoadedRef.current = null;
    }
  }, [refill]);

  // Crossfade into the preloaded next track. Falls back to createAndPlay if
  // nothing is preloaded (network slow or first track was very short).
  const advanceToNext = useCallback(async () => {
    const completed = currentRef.current;
    if (completed) emit("song_complete", completed);

    const queued = nextLoadedRef.current;
    if (queued) {
      nextLoadedRef.current = null;
      setCurrentItem(queued);
      trackStartedAtRef.current = new Date().toISOString();
      playerRef.current?.startNext();
      setIsPlaying(true);
      wasPlayingRef.current = true;
      emit("song_start", queued);
      // Howl 'onload' already fired when we called loadNext; pull duration now.
      const p = playerRef.current?.getProgress();
      if (p?.duration) schedulePreload(p.duration);
      void preloadFollowing();
      return;
    }
    // No preload available — hard advance.
    await playFromQueue();
  }, [emit, playFromQueue, preloadFollowing, schedulePreload]);

  const skip = useCallback(() => {
    const cur = currentRef.current;
    if (cur) emit("song_skip", cur);
    if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
    void advanceToNext();
  }, [emit, advanceToNext]);

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (!currentRef.current) {
      void playFromQueue();
      return;
    }
    if (isPlaying) {
      intentionalPauseRef.current = true;
      wasPlayingRef.current = false;
      player.pause();
      setIsPlaying(false);
    } else {
      wasPlayingRef.current = true;
      player.resume();
      setIsPlaying(true);
    }
  }, [isPlaying, playFromQueue]);

  const handleSelectOutcome = useCallback(async (outcomeId: string) => {
    // Empty-pool outcomes are disabled in OutcomeModal, so we don't need a
    // silent-playback confirmation here — the modal won't fire onSelect.
    try {
      await api.outcomeSelection(session.storeId, outcomeId, session.token);
      // Server logs the outcome_selection PlaybackEvent itself (see hendrix.ts);
      // do not double-emit from the client.
      setShowOutcomeModal(false);
      // Drain queue + reload next; if currently playing, let current finish into a refreshed pool.
      setQueue([]);
      nextLoadedRef.current = null;
      await refill();
      await refreshOutcomes();
      if (!currentRef.current && wasPlayingRef.current) void playFromQueue();
    } catch (e) {
      console.error(e);
      setError("Could not change outcome.");
    }
  }, [outcomes, session.storeId, session.token, emit, refill, refreshOutcomes, playFromQueue]);

  const handleClearOutcome = useCallback(async () => {
    try {
      await api.clearOutcomeSelection(session.storeId, session.token);
      // Server logs the outcome_selection_cleared PlaybackEvent itself.
      setShowOutcomeModal(false);
      setQueue([]);
      nextLoadedRef.current = null;
      await refill();
      await refreshOutcomes();
    } catch (e) {
      console.error(e);
      setError("Could not clear outcome selection.");
    }
  }, [session.storeId, session.token, emit, refill, refreshOutcomes]);

  // Love is write-once: server has no song_unlove event today, so once a
  // song is loved it stays loved (and shows as such on every device).
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
  }, [emit]);

  const getProgress = useCallback(() => playerRef.current?.getProgress() ?? null, []);

  // ── Init / teardown ───────────────────────────────────────────────────────
  useEffect(() => {
    playerRef.current = new CrossfadePlayer({
      crossfadeMs: CROSSFADE_MS,
      onTrackEnded: () => {
        // Crossfade preload timer normally handles advancement; this fires
        // only if the timer didn't (very short track, or end reached without
        // preload). Treat as a hard advance.
        if (!nextLoadedRef.current) {
          wasPlayingRef.current = false;
          setIsPlaying(false);
        }
      },
      onError: (err) => {
        console.error("[player] audio error", err);
        setError(`Audio error: ${String(err)}`);
      },
      onPause: () => {
        if (intentionalPauseRef.current) { intentionalPauseRef.current = false; return; }
        if (!wasPlayingRef.current) return;
        // External pause (audio focus loss, OS interrupt) — try to resume.
        playerRef.current?.resume();
      },
    });
    void refill();
    void refreshOutcomes();
    // Hydrate loved set from server (cross-device source of truth). Merge with
    // any local writes so optimistic UI from this session survives.
    api.loved(session.storeId, session.token).then((r) => {
      setLovedIds((prev) => {
        const merged = new Set(prev);
        for (const id of r.songIds) merged.add(id);
        saveLoved(merged);
        return merged;
      });
    }).catch((e) => console.warn("[player] loved hydrate failed", e));
    // Emit operator_login once per session-start.
    emit("operator_login");
    return () => {
      if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
      playerRef.current?.stop();
      playerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Online indicator: 30s polling against /auth/me ────────────────────────
  useEffect(() => {
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
  }, [session.token]);

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

  // ── Resume after tab refocus / screen wake ────────────────────────────────
  useEffect(() => {
    const resume = () => {
      if (!wasPlayingRef.current) return;
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
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackLabel(currentItem) || "Untitled",
      artist: "Entuned",
      album: session.storeName,
      artwork: [{ src: touchIconUrl, sizes: "180x180", type: "image/png" }],
    });
  }, [currentItem, session.storeName]);

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

  // activeOutcome.title comes hydrated from /hendrix/next; the outcomes list is
  // only used by the picker modal.
  const activeTitle = activeOutcome?.title ?? "—";
  const expiresLabel = activeOutcome?.source === "selection" && activeOutcome.expiresAt
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
        background: "radial-gradient(ellipse at center, #1a1a1f 0%, #0a0a0a 55%, #050505 100%)",
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
        <div style={{ position: "absolute", top: 70, right: 28, zIndex: 50 }}>
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
        </DarkHalo>

        {currentItem ? <ProgressBar getProgress={getProgress} /> : null}

        {networkError ? (
          <div style={{ padding: "10px 24px", background: "rgba(94,162,182,0.08)", border: "1px solid rgba(94,162,182,0.25)", borderRadius: 12, maxWidth: 440, textAlign: "center", fontSize: 12, color: "rgba(94,162,182,0.85)" }}>
            {networkError}
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

        {currentItem ? (
          <div style={{ display: "flex", gap: 56, justifyContent: "center", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleLove}
              aria-label="Love this track"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 8, lineHeight: 0 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24">
                {lovedIds.has(currentItem.songId) ? (
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#e05a3a" />
                ) : (
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="rgba(212,225,229,0.35)" strokeWidth="1.5" />
                )}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              aria-label="Report this track"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 8, lineHeight: 0 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 21V4h11l1 2h4v11h-5l-1-2H6v6z" stroke="rgba(212,225,229,0.35)" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : null}
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
            background: "rgba(94,162,182,0.09)",
            border: "1px solid rgba(94,162,182,0.22)",
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
          activeId={activeOutcome?.outcomeId ?? null}
          onSelect={handleSelectOutcome}
          onClear={activeOutcome?.source === "selection" ? handleClearOutcome : null}
          onClose={() => setShowOutcomeModal(false)}
        />
      ) : null}

      {showReportModal ? (
        <ReportModal onSelect={handleReport} onClose={() => setShowReportModal(false)} />
      ) : null}
    </div>
  );
}
