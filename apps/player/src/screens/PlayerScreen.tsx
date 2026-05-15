import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueueItem, type ActiveOutcome, type OutcomeOption, type AudioEventType } from "../api.js";
import { CrossfadePlayer } from "../audio/crossfade-player.js";
import { LoudnessSampler } from "../audio/loudness-sampler.js";
import { bufferEvent, flushNow } from "../lib/event-buffer.js";
import { IconButton } from "../components/IconButton.js";
import { DarkHalo } from "../components/DarkHalo.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { OutcomeModal } from "../components/OutcomeModal.js";
import { ReportModal, type ReportReason } from "../components/ReportModal.js";
import { TooltipTour, tourSeen, type TourStep } from "../components/TooltipTour.js";
import { UpgradeRail } from "../components/UpgradeRail.js";
import { saveSession, type Session } from "../lib/storage.js";
import { trackPlayerLanding, trackFirstPlay, trackTrackComplete } from "../lib/ga4.js";
import logoUrl from "/entuned_logo.png";
import lockscreenArtUrl from "/lockscreen-art.png";

// Ads are mastered ~15-20% quieter than the music. HTML5 audio caps at 1.0 so we
// can't boost ads; instead we bring songs down by the same margin so ads sit at full.
const SONG_VOLUME = 0.47;
const AD_VOLUME = 1.0;
// Namespaced per store so loves don't bleed across accounts that share a
// browser (slug-mode demos, admin store switching, multi-operator devices).
// The pre-v2 key was global; clear it on first read to drop stale cross-store data.
const LEGACY_LOVED_KEY = "entuned.loved.v1";
const lovedKey = (storeId: string) => `entuned.loved.v2.${storeId}`;

function loadLoved(storeId: string): Set<string> {
  try { localStorage.removeItem(LEGACY_LOVED_KEY); } catch {}
  try {
    const raw = localStorage.getItem(lovedKey(storeId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}
function saveLoved(storeId: string, s: Set<string>) {
  try { localStorage.setItem(lovedKey(storeId), JSON.stringify([...s])); } catch {}
}

// Tier indicator — eyebrow style per design system (no pill bg). Inter 500,
// uppercase, 0.18em tracking. Color carries the tier signal.
const TIER_LABEL: Record<string, string> = {
  free: "Free",
  core: "Boost",
  pro: "Pro",
  enterprise: "Enterprise",
};
const TIER_COLOR: Record<string, string> = {
  free:       "rgba(212,225,229,0.55)", // ice faint
  core:       "#6AB0BB",                // teal
  pro:        "#E8B458",                // gold
  enterprise: "#D4E1E5",                // ice full
};
function TierEyebrow({ tier }: { tier: string }) {
  const label = TIER_LABEL[tier] ?? tier;
  const color = TIER_COLOR[tier] ?? TIER_COLOR.free;
  // Free-tier pill doubles as the upgrade entry point — tapping it deep-links
  // into the in-app upgrade page. Paid tiers render a non-interactive label.
  const isFree = tier === "free";
  const sharedStyle = {
    fontFamily: "'Inter', sans-serif" as const,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.18em",
    color,
    textTransform: "uppercase" as const,
    whiteSpace: "nowrap" as const,
    userSelect: "none" as const,
  };
  if (isFree) {
    return (
      <a
        href="https://app.entuned.co/upgrade"
        title="Upgrade to Boost"
        style={{
          ...sharedStyle,
          textDecoration: "none",
          padding: "3px 8px",
          borderRadius: 999,
          border: "1px solid rgba(212,225,229,0.22)",
          cursor: "pointer",
        }}
      >
        {label}
      </a>
    );
  }
  return <span style={sharedStyle}>{label}</span>;
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
  const [buffering, setBuffering] = useState(false);
  const [lovedIds, setLovedIds] = useState<Set<string>>(() => loadLoved(session.storeId));
  const [allOutcomesMode, setAllOutcomesModeState] = useState(false);
  const [playedCount, setPlayedCount] = useState(0);
  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  const [isShort, setIsShort] = useState(() => typeof window !== "undefined" && window.innerHeight < 720);
  // Promo surface shown for Free, Core, and Pro stores — content rotates
  // based on tier (upgrade pitch for Free; reminders / upsell mix for Core;
  // pure feature reminders for Pro). Enterprise has nothing to upsell to and
  // skips the surface. Layout is 50/50 row at ≥1024, 50/50 column below.
  const showPromo = session.tier === "free" || session.tier === "core" || session.tier === "pro";
  const twoCol = showPromo && isWide;
  const narrowPromo = showPromo && !isWide;

  useEffect(() => {
    const onResize = () => {
      setIsWide(window.innerWidth >= 1024);
      setIsShort(window.innerHeight < 720);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Onboarding tour — fires once per device on first launch (slug or operator).
  // Targets the outcome selector, love, and report — the three most product-
  // defining controls. Marked seen on completion or skip via TooltipTour.
  // Defer to post-mount so target refs are populated before the tour reads them.
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  const loveRef = useRef<HTMLButtonElement | null>(null);
  const reportRef = useRef<HTMLButtonElement | null>(null);
  const [tourActive, setTourActive] = useState<boolean>(false);
  useEffect(() => {
    if (tourSeen()) return;
    // One frame after mount so refs are attached and the layout has settled.
    const t = setTimeout(() => setTourActive(true), 50);
    return () => clearTimeout(t);
  }, []);
  // GA4 — fire landing event once on mount.
  useEffect(() => {
    trackPlayerLanding(session.mode === 'slug' ? session.slug : undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Welcome flash — only on first visit, slug-mode only (operators don't need
  // a "your music is ready" greeting; they signed in deliberately).
  const [showWelcome, setShowWelcome] = useState<boolean>(
    () => session.mode === 'slug' && !tourSeen(),
  );
  useEffect(() => {
    if (!showWelcome) return;
    const t = setTimeout(() => setShowWelcome(false), 4500);
    return () => clearTimeout(t);
  }, [showWelcome]);

  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const currentRef = useRef<QueueItem | null>(null);
  currentRef.current = currentItem;
  const wasPlayingRef = useRef(false);
  // Sticky: set true when the user explicitly pauses, cleared only when the
  // user explicitly plays again. Visibility-wake resume must respect this so
  // we don't restart audio for someone who deliberately paused.
  const userPausedRef = useRef(false);
  const trackStartedAtRef = useRef<string | null>(null);
  const allOutcomesModeRef = useRef(false);
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
    try {
      const r = session.mode === 'slug' && session.slug
        ? await api.outcomesBySlug(session.slug)
        : await api.outcomes(session.storeId, session.token);
      setOutcomes(r);
    } catch (e) { console.warn("[player] outcomes failed", e); }
  }, [session.mode, session.slug, session.storeId, session.token]);

  const playFromQueue = useCallback(async () => {
    let head = queueRef.current[0];
    if (!head) {
      const fresh = await refill();
      // queueRef.current may still be stale (React batch); use the server's raw
      // response as a direct fallback so we never stall after an empty-queue refill.
      head = queueRef.current[0] ?? fresh.find(
        (q) => q.songId !== currentRef.current?.songId
      ) ?? null;
    }
    if (!head) {
      setIsPlaying(false);
      wasPlayingRef.current = false;
      return;
    }
    setQueue((prev) => prev.filter((q) => q.songId !== head!.songId));
    setCurrentItem(head);
    currentRef.current = head;
    trackStartedAtRef.current = new Date().toISOString();
    wasPlayingRef.current = true;
    playerRef.current?.createAndPlay(head.audioUrl, head.type === "ad" ? { volume: AD_VOLUME } : undefined);
    setIsPlaying(true);
    emit(head.type === "ad" ? "ad_play" : "song_start", head);
    if (head.type !== "ad") trackFirstPlay(head.title);
  }, [refill, emit]);

  const advanceToNext = useCallback(async () => {
    const completed = currentRef.current;
    if (completed && completed.type !== "ad") {
      emit("song_complete", completed);
      trackTrackComplete(completed.title);
      setPlayedCount((c) => c + 1);
    }
    await playFromQueue();
  }, [emit, playFromQueue]);

  const skip = useCallback(async () => {
    userPausedRef.current = false;
    const cur = currentRef.current;
    if (cur && cur.type !== "ad") {
      emit("song_skip", cur);
      emit("song_complete", cur);
      setPlayedCount((c) => c + 1);
    }
    await playFromQueue();
  }, [emit, playFromQueue]);

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
      userPausedRef.current = true;
      wasPlayingRef.current = false;
      player.pause();
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      wasPlayingRef.current = true;
      player.resume();
      setIsPlaying(true);
    }
  }, [isPlaying, playFromQueue]);

  const handleSelectOutcome = useCallback(async (outcomeId: string) => {
    try {
      if (session.mode === 'slug' && session.slug) {
        await api.outcomeSelectionBySlug(session.slug, outcomeId);
      } else {
        await api.outcomeSelection(session.storeId, outcomeId, session.token);
      }
      setAllOutcomesMode(false);
      setShowOutcomeModal(false);
      setQueue([]);
      await refill();
      await refreshOutcomes();
      if (!currentRef.current && wasPlayingRef.current) void playFromQueue();
    } catch (e) {
      console.error(e);
      setError("Could not change outcome.");
    }
  }, [session.mode, session.slug, session.storeId, session.token, refill, refreshOutcomes, playFromQueue, setAllOutcomesMode]);

  const handleClearOutcome = useCallback(async () => {
    try {
      if (session.mode === 'slug' && session.slug) {
        await api.clearOutcomeSelectionBySlug(session.slug);
      } else {
        await api.clearOutcomeSelection(session.storeId, session.token);
      }
      setAllOutcomesMode(false);
      setShowOutcomeModal(false);
      setQueue([]);
      await refill();
      await refreshOutcomes();
    } catch (e) {
      console.error(e);
      setError("Could not clear outcome selection.");
    }
  }, [session.mode, session.slug, session.storeId, session.token, refill, refreshOutcomes, setAllOutcomesMode]);

  const handleSelectAll = useCallback(async () => {
    try {
      // Clear any server-side operator selection so we're not overriding a schedule.
      if (session.mode === 'slug' && session.slug) {
        await api.clearOutcomeSelectionBySlug(session.slug).catch(() => {/* ok if already clear */});
      } else {
        await api.clearOutcomeSelection(session.storeId, session.token).catch(() => {/* ok if already clear */});
      }
      setAllOutcomesMode(true);
      setShowOutcomeModal(false);
      setQueue([]);
      await refill();
      await refreshOutcomes();
      if (!currentRef.current && wasPlayingRef.current) void playFromQueue();
    } catch (e) {
      console.error(e);
      setError("Could not switch to all-outcomes mode.");
    }
  }, [session.mode, session.slug, session.storeId, session.token, refill, refreshOutcomes, playFromQueue, setAllOutcomesMode]);

  const handleLove = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    if (lovedIds.has(cur.songId)) return;
    const next = new Set(lovedIds);
    next.add(cur.songId);
    setLovedIds(next);
    saveLoved(session.storeId, next);
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
    playerRef.current = new CrossfadePlayer({
      volume: SONG_VOLUME,
      // Native 'ended' event drives advance. Reliable even when iOS throttles JS timers.
      onTrackEnded: () => { void advanceToNext(); },
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
        void advanceToNext();
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
      // Server is authoritative for this (account, store) pair — replace local
      // state rather than merge so cached loves from a prior account on the
      // same device are dropped.
      api.loved(session.storeId, session.token).then((r) => {
        const next = new Set(r.songIds);
        setLovedIds(next);
        saveLoved(session.storeId, next);
      }).catch((e) => console.warn("[player] loved hydrate failed", e));
      emit("operator_login");
    }
    return () => {
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
        if (currentRef.current?.type === "ad") {
          if (userPausedRef.current) {
            // User paused on this ad. Don't force playback — just clear it so
            // the next user-initiated play pulls a fresh, non-ad item.
            console.info("[player] clearing paused ad — campaign no longer active");
            setCurrentItem(null);
            currentRef.current = null;
          } else {
            console.info("[player] skipping currently-playing ad — campaign no longer active");
            void skip();
          }
        }
      } catch (e) {
        console.warn("[player] background refresh failed", e);
      }
    };
    void check();
    const iv = window.setInterval(() => void check(), 15_000);
    return () => clearInterval(iv);
  }, [fetchNext, skip]);

  useEffect(() => {
    const handleOnline = () => { setNetworkError(null); void refill(); };
    const handleOffline = () => { setNetworkError("No internet connection. Music will resume when you're back online."); };
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
      if (userPausedRef.current) return;
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
      userPausedRef.current = false;
      playerRef.current?.resume();
      wasPlayingRef.current = true;
      setIsPlaying(true);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      userPausedRef.current = true;
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

  const activeTitle = allOutcomesMode ? "All" : (activeOutcome?.title ?? "Tap to choose");
  const expiresLabel = !allOutcomesMode && activeOutcome?.source === "selection" && activeOutcome.expiresAt
    ? `Selected · until ${new Date(activeOutcome.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : null;

  const headerLine = session.clientName
    ? `${session.clientName}: ${session.storeName}`
    : session.storeName;

  // Dynamic browser tab title — bookmarked URLs self-identify by store
  // name instead of all reading "Entuned." Tracks store renames live.
  useEffect(() => {
    const prev = document.title;
    document.title = `${headerLine} · Entuned`;
    return () => { document.title = prev; };
  }, [headerLine]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: twoCol
          ? "linear-gradient(rgba(22,21,18,0.82), rgba(13,11,9,0.94)), url('/hero-start.jpg')"
          : "radial-gradient(ellipse at center, #1f1f1c 0%, #151511 55%, #0d0d0a 100%)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={logoUrl} alt="Entuned" style={{ width: 118, opacity: 0.7 }} />
          {session.tier ? <TierEyebrow tier={session.tier} /> : null}
        </div>
        {session.mode === "slug" ? (
          <a
            href="https://app.entuned.co"
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(212,225,229,0.65)",
              textDecoration: "none",
            }}
          >
            Dashboard
          </a>
        ) : (
          <div
            onClick={() => setShowLogoutConfirm((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
            title="Switch store / log out"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="rgba(212,225,229,0.65)" strokeWidth="1.6" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="rgba(212,225,229,0.65)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
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
                  tier: s.tier,
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

      <div style={{ flex: 1, display: "flex", flexDirection: twoCol ? "row" : "column", minHeight: 0, gap: twoCol ? 24 : 16, padding: twoCol ? "0 28px 28px" : (narrowPromo ? "0 16px 16px" : 0) }}>
        {showPromo ? (
          <UpgradeRail
            rotationKey={currentItem?.songId ?? null}
            tier={session.tier}
            compact={!isWide}
            withPhoto={narrowPromo}
            style={{ flex: 1, minHeight: 0 }}
          />
        ) : null}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          ...(showPromo ? {
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(80, 146, 156, 0.18)",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          } : {}),
        }}>
      <div className="no-scrollbar" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", alignItems: "center", padding: twoCol ? `clamp(16px, 4vh, 52px) 60px 24px 60px` : (narrowPromo ? "16px 0" : "0 0 24px"), gap: twoCol ? (isShort ? 20 : 32) : (narrowPromo ? 28 : 44), minHeight: 0, overflowY: "auto" }}>
        {/* Title block: outcome chip + track title + (when playing) progress bar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}>
          <DarkHalo>
            {allOutcomesMode && currentItem ? (() => {
              const outcomeTitle = outcomes.find((o) => o.outcomeId === currentItem.outcomeId)?.title ?? null;
              return outcomeTitle ? (
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", color: "#6AB0BB", textTransform: "uppercase", textAlign: "center", marginBottom: 12 }}>
                  {outcomeTitle}
                </div>
              ) : null;
            })() : null}
            <div
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontSize: twoCol ? "clamp(1.5rem, 2.8vw, 2rem)" : "clamp(2rem, 5vw, 3rem)",
                fontWeight: 700,
                color: "#D4E1E5",
                letterSpacing: "-0.02em",
                lineHeight: 1.15,
                textAlign: "center",
                padding: twoCol ? 0 : "0 40px",
                minHeight: "1em",
                maxWidth: twoCol ? 640 : 820,
                wordBreak: "break-word",
              }}
            >
              {currentItem ? trackLabel(currentItem) : reason === "no_pool" ? "Silent" : "Press play to stream"}
            </div>
            {currentItem?.icpName ? (
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", color: "rgba(212,225,229,0.55)", textTransform: "uppercase", marginTop: 14, textAlign: "center" }}>
                {currentItem.icpName}
              </div>
            ) : null}
          </DarkHalo>

          {currentItem ? <ProgressBar getProgress={getProgress} /> : null}
        </div>

        {networkError ? (
          <div style={{ fontFamily: "'Inter', sans-serif", padding: "10px 22px", background: "rgba(80,146,156,0.08)", border: "1px solid rgba(80,146,156,0.30)", borderRadius: 0, maxWidth: 440, textAlign: "center", fontSize: 12, color: "#6AB0BB", letterSpacing: "0.05em" }}>
            {networkError}
          </div>
        ) : null}

        {buffering && !networkError ? (
          <div style={{ fontFamily: "'Inter', sans-serif", padding: "10px 22px", background: "rgba(232,180,88,0.08)", border: "1px solid rgba(232,180,88,0.30)", borderRadius: 0, maxWidth: 440, textAlign: "center", fontSize: 12, color: "#E8B458", letterSpacing: "0.05em" }}>
            Buffering — poor connection. Will skip if needed.
          </div>
        ) : null}

        {error ? (
          <div style={{ fontFamily: "'Inter', sans-serif", padding: "10px 22px", background: "rgba(226,75,74,0.12)", border: "1px solid rgba(226,75,74,0.35)", borderRadius: 0, maxWidth: 440, textAlign: "center", fontSize: 12, color: "#E24B4A", letterSpacing: "0.05em" }}>
            {error}
          </div>
        ) : null}

        {/* Controls block: primary play/skip, then secondary love/report tightly grouped */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <DarkHalo style={{ display: "flex", gap: 56, alignItems: "center" }}>
            <IconButton onClick={togglePlayPause} ariaLabel={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? (
                <svg width="64" height="64" viewBox="0 0 28 28">
                  <rect x="7" y="5" width="5" height="18" rx="1.5" fill="rgba(232,238,240,0.95)" />
                  <rect x="16" y="5" width="5" height="18" rx="1.5" fill="rgba(232,238,240,0.95)" />
                </svg>
              ) : (
                <svg width={currentItem ? 64 : 80} height={currentItem ? 64 : 80} viewBox="0 0 28 28">
                  <path d="M9 4l12 8-12 8z" fill="rgba(232,238,240,0.95)" />
                </svg>
              )}
            </IconButton>
            <IconButton onClick={skip} ariaLabel="Skip">
              <svg width="58" height="58" viewBox="0 0 24 24">
                <path d="M4.5 5l10 7-10 7zm12.5 0v14h2.5V5z" fill="rgba(232,238,240,0.95)" />
              </svg>
            </IconButton>
          </DarkHalo>

          {(() => {
            const idle = !currentItem;
            const loved = currentItem ? lovedIds.has(currentItem.songId) : false;
            // High-contrast strokes — these have to read clearly across all
            // viewports and brightness levels. Idle gets a softer treatment
            // so it doesn't compete with the active title block.
            const heartStroke = idle ? "rgba(212,225,229,0.4)" : "rgba(232,238,240,0.92)";
            const flagStroke = idle ? "rgba(212,225,229,0.4)" : "rgba(232,238,240,0.92)";
            return (
              <div style={{ display: "flex", gap: 44, justifyContent: "center", alignItems: "center" }}>
                <button
                  ref={loveRef}
                  type="button"
                  disabled={idle}
                  onClick={idle ? undefined : handleLove}
                  aria-label="Love this track"
                  title={loved ? "Loved — tap to unfavorite" : "Love this track — we play it more"}
                  style={{ background: "none", border: "none", cursor: idle ? "not-allowed" : "pointer", padding: 10, lineHeight: 0 }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24">
                    {loved ? (
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#e05a3a" />
                    ) : (
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke={heartStroke} strokeWidth="1.8" />
                    )}
                  </svg>
                </button>
                <button
                  ref={reportRef}
                  type="button"
                  disabled={idle}
                  onClick={idle ? undefined : () => setShowReportModal(true)}
                  aria-label="Report this track"
                  title="Something off about this track? Flag it."
                  style={{ background: "none", border: "none", cursor: idle ? "not-allowed" : "pointer", padding: 10, lineHeight: 0 }}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                    <path d="M4 21V4h11l1 2h4v11h-5l-1-2H6v6z" stroke={flagStroke} strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            );
          })()}
        </div>

        {twoCol && !isShort ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", color: "#6AB0BB", textTransform: "uppercase" }}>
              This session
            </div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 400, color: "rgba(212,225,229,0.85)" }}>
              {playedCount} {playedCount === 1 ? "track" : "tracks"} played
              <span style={{ color: "rgba(212,225,229,0.30)", margin: "0 10px" }}>·</span>
              {lovedIds.size} {lovedIds.size === 1 ? "love" : "loves"} saved
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: twoCol ? "0 60px 36px 60px" : "0 24px 36px" }}>
        <div
          ref={outcomeRef}
          onClick={() => setShowOutcomeModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 22px",
            borderRadius: 0,
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(80, 146, 156, 0.30)",
            cursor: "pointer",
            userSelect: "none",
            transition: "all 300ms cubic-bezier(.4,0,.2,1)",
          }}
        >
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.18em", color: "#6AB0BB", textTransform: "uppercase" }}>
            Outcome
          </span>
          <span style={{ width: 1, height: 18, background: "rgba(80, 146, 156, 0.30)" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: "0.01em", color: "#D4E1E5", whiteSpace: "nowrap" }}>
              {activeTitle}
            </span>
            {expiresLabel ? (
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", color: "#E8B458", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {expiresLabel}
              </span>
            ) : null}
          </div>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{ marginLeft: 4 }}>
            <path d="M1 1l5 5 5-5" stroke="#6AB0BB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
        </div>
      </div>

      {showOutcomeModal ? (
        <OutcomeModal
          outcomes={outcomes}
          activeId={allOutcomesMode ? null : (activeOutcome?.outcomeId ?? null)}
          allOutcomesMode={allOutcomesMode}
          viewerTier={session.tier}
          onSelect={handleSelectOutcome}
          onSelectAll={handleSelectAll}
          onClear={!allOutcomesMode && activeOutcome?.source === "selection" ? handleClearOutcome : null}
          onClose={() => setShowOutcomeModal(false)}
        />
      ) : null}

      {showReportModal ? (
        <ReportModal onSelect={handleReport} onClose={() => setShowReportModal(false)} />
      ) : null}

      {/* First-visit welcome flash — slug-mode only, auto-dismisses. */}
      {showWelcome ? (
        <div
          onClick={() => setShowWelcome(false)}
          style={{
            position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)",
            zIndex: 40,
            background: "rgba(28,28,24,0.85)",
            border: "1px solid rgba(106,176,187,0.45)",
            borderRadius: 999,
            padding: "10px 22px",
            color: "rgba(212,225,229,0.9)",
            fontSize: 13, letterSpacing: 1.2,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            cursor: "pointer",
          }}
        >
          Music is ready
        </div>
      ) : null}

      {tourActive ? (
        <TooltipTour
          steps={[
            {
              target: outcomeRef.current,
              body: "Pick what the music should do — Chill, Steady, or Upbeat. Or play All Outcomes. Unlock more with Boost.",
              placement: "above",
            },
            {
              target: loveRef.current,
              body: "A track lands? Tap love. We'll lean into what works for your room.",
              placement: "above",
            },
            {
              target: reportRef.current,
              body: "Not right for the room? Tap report and tell us why.",
              placement: "above",
            },
          ] satisfies TourStep[]}
          onClose={() => setTourActive(false)}
        />
      ) : null}
    </div>
  );
}
