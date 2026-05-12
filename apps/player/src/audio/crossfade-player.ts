import { Howl } from "howler";

// Minimal silent MP3 — keeps the iOS audio session alive across lock/background.
// Avoids needing a public asset file.
const SILENT_MP3 =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";

// Crossfade window. 200ms is short enough that user actions (skip/pause) rarely
// land inside the fade, brief enough that musical overlap is imperceptible as
// a "mix", and long enough to mask the audible click between tracks.
const DEFAULT_CROSSFADE_MS = 200;

export type CrossfadePlayerOptions = {
  volume?: number;
  onTrackEnded?: () => void;
  onError?: (err: unknown) => void;
  onPlayError?: (err: unknown) => void;
  crossfadeMs?: number;
};

type DeckStatus = "empty" | "loading" | "ready" | "playing" | "fading";

type Deck = {
  howl: Howl | null;
  url: string | null;
  status: DeckStatus;
  // Timer that stops + unloads this deck after its fade-out completes.
  unloadTimer: number | null;
};

export class CrossfadePlayer {
  private deckA: Deck = { howl: null, url: null, status: "empty", unloadTimer: null };
  private deckB: Deck = { howl: null, url: null, status: "empty", unloadTimer: null };
  private active: "A" | "B" = "A";
  private heartbeat: Howl | null = null;
  private volume = 1;
  private muted = false;
  private opts: CrossfadePlayerOptions;
  private crossfadeMs: number;
  // Pre-fires onTrackEnded `crossfadeMs` before the active track's natural end,
  // so the caller advances state and createAndPlay can run a true crossfade
  // (current track still has audio playing during the fade).
  private nearEndTimer: number | null = null;

  constructor(opts: CrossfadePlayerOptions = {}) {
    this.volume = opts.volume ?? 1;
    this.opts = opts;
    this.crossfadeMs = opts.crossfadeMs ?? DEFAULT_CROSSFADE_MS;
  }

  private getActiveDeck(): Deck { return this.active === "A" ? this.deckA : this.deckB; }
  private getInactiveDeck(): Deck { return this.active === "A" ? this.deckB : this.deckA; }
  private swapDecks(): void { this.active = this.active === "A" ? "B" : "A"; }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = new Howl({
      src: [SILENT_MP3],
      html5: true,
      loop: true,
      volume: 0.001,
    });
    this.heartbeat.play();
  }

  private resumeAudioContext(): void {
    try {
      const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx;
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {}
  }

  // Hard-stop a deck immediately. Cancels any pending unload + in-progress fade,
  // clears handlers, stops + unloads the howl, resets the slot.
  private hardStopDeck(deck: Deck): void {
    if (deck.unloadTimer !== null) {
      clearTimeout(deck.unloadTimer);
      deck.unloadTimer = null;
    }
    if (deck.howl) {
      deck.howl.off();
      deck.howl.stop();
      deck.howl.unload();
      deck.howl = null;
    }
    deck.url = null;
    deck.status = "empty";
  }

  // Fade a deck's volume to 0, then stop + unload after the fade completes.
  // Handlers are cleared up front so the fading deck can't fire onTrackEnded
  // during the fade-out window.
  private fadeOutAndUnload(deck: Deck, durationMs: number): void {
    if (!deck.howl) return;
    const howl = deck.howl;
    howl.off();
    deck.status = "fading";
    const startVol = (howl.volume() as number) || 0;
    if (durationMs > 0 && startVol > 0) {
      howl.fade(startVol, 0, durationMs);
    }
    deck.unloadTimer = window.setTimeout(() => {
      try { howl.stop(); howl.unload(); } catch {}
      // Only clear the slot if this same howl still occupies it (a rapid skip
      // could have already cleared and reused this slot).
      if (deck.howl === howl) {
        deck.howl = null;
        deck.url = null;
        deck.status = "empty";
        deck.unloadTimer = null;
      }
    }, durationMs + 50);
  }

  private clearNearEnd(): void {
    if (this.nearEndTimer !== null) {
      clearTimeout(this.nearEndTimer);
      this.nearEndTimer = null;
    }
  }

  // Schedule onTrackEnded to fire `crossfadeMs` before the active deck's
  // natural end. If the track's duration isn't known yet (still loading),
  // re-check shortly. The active deck's onend handler stays attached as a
  // fallback in case the timer never fires (e.g. duration was wrong).
  private scheduleNearEnd(): void {
    this.clearNearEnd();
    const attempt = () => {
      this.nearEndTimer = null;
      const deck = this.getActiveDeck();
      if (!deck.howl) return;
      const duration = deck.howl.duration();
      if (!duration || duration <= 0) {
        this.nearEndTimer = window.setTimeout(attempt, 250);
        return;
      }
      const elapsed = (deck.howl.seek() as number) || 0;
      const remainingMs = (duration - elapsed) * 1000;
      // Fire `crossfadeMs` before end so the caller starts the next track
      // while this one still has audio to fade out against.
      const triggerInMs = Math.max(0, remainingMs - this.crossfadeMs);
      this.nearEndTimer = window.setTimeout(() => {
        this.nearEndTimer = null;
        const cur = this.getActiveDeck();
        if (cur.howl && cur.howl.playing()) {
          this.opts.onTrackEnded?.();
        }
      }, triggerInMs);
    };
    attempt();
  }

  // Load a URL into the inactive deck silently so it's ready before it's needed.
  preloadNext(url: string): void {
    const inactive = this.getInactiveDeck();
    // Inactive is mid fade-out from a prior transition — leave it alone; it'll
    // be hard-stopped or naturally cleared before the next createAndPlay needs it.
    if (inactive.status === "fading") return;
    // Already loading or ready for this URL — nothing to do.
    if (inactive.url === url && (inactive.status === "loading" || inactive.status === "ready")) return;
    if (inactive.howl) {
      inactive.howl.off();
      inactive.howl.unload();
      inactive.howl = null;
    }
    inactive.url = url;
    inactive.status = "loading";
    inactive.howl = new Howl({
      src: [url],
      html5: true,
      preload: true,
      volume: 0,
      onload: () => { if (inactive.howl) inactive.status = "ready"; },
      onloaderror: () => {
        // Silently reset — createAndPlay will reload if this URL is requested.
        if (inactive.howl) { inactive.howl.unload(); inactive.howl = null; }
        inactive.status = "empty";
        inactive.url = null;
      },
    });
  }

  createAndPlay(url: string, opts?: { volume?: number }): void {
    this.startHeartbeat();
    this.resumeAudioContext();
    this.clearNearEnd();

    const targetVol = this.muted ? 0 : (opts?.volume ?? this.volume);
    const prev = this.getActiveDeck();
    // Use the howl's actual playing state, not just status, so playerror'd
    // decks don't trigger a crossfade against silence.
    const prevWasPlaying = prev.howl !== null && prev.howl.playing();
    const doCrossfade = prevWasPlaying && this.crossfadeMs > 0;

    let inactive = this.getInactiveDeck();
    // Inactive slot is still fading out from a previous transition — hard-stop
    // it so we can reuse the slot. This handles rapid skips during a crossfade.
    if (inactive.status === "fading") {
      this.hardStopDeck(inactive);
      inactive = this.getInactiveDeck();
    }

    const preloaded = inactive.url === url && inactive.status === "ready" && inactive.howl !== null;

    let newHowl: Howl;
    if (preloaded && inactive.howl) {
      // Fast path: reuse the preloaded deck.
      newHowl = inactive.howl;
      newHowl.off();
      newHowl.volume(doCrossfade ? 0 : targetVol);
      newHowl.on("end", () => this.opts.onTrackEnded?.());
      newHowl.on("loaderror", (_id: number, err: unknown) => this.opts.onError?.(err));
      newHowl.on("playerror", (_id: number, err: unknown) => this.opts.onPlayError?.(err));
      newHowl.play();
    } else {
      // Slow path: load fresh into the inactive slot.
      if (inactive.howl) { inactive.howl.off(); inactive.howl.unload(); inactive.howl = null; }
      inactive.url = url;
      inactive.status = "loading";
      newHowl = new Howl({
        src: [url],
        html5: true,
        volume: doCrossfade ? 0 : targetVol,
        onend: () => this.opts.onTrackEnded?.(),
        onloaderror: (_id: number, err: unknown) => this.opts.onError?.(err),
        onplayerror: (_id: number, err: unknown) => this.opts.onPlayError?.(err),
      });
      inactive.howl = newHowl;
      newHowl.play();
    }

    this.swapDecks();
    const newActive = this.getActiveDeck();
    newActive.status = "playing";

    if (doCrossfade) {
      // Both decks fade concurrently. fadeOutAndUnload clears prev's handlers
      // before starting the fade so the natural onend of the fading deck
      // can't double-fire onTrackEnded during the 200ms window.
      newHowl.fade(0, targetVol, this.crossfadeMs);
      this.fadeOutAndUnload(prev, this.crossfadeMs);
    } else if (prev.howl) {
      // No crossfade (first play or prev wasn't actually playing) — hard-stop.
      this.hardStopDeck(prev);
    } else {
      // No prev howl; ensure the slot is clean.
      prev.url = null;
      prev.status = "empty";
    }

    this.scheduleNearEnd();
  }

  pause(): void {
    this.clearNearEnd();
    const active = this.getActiveDeck();
    if (active.howl) {
      // If pause lands mid fade-in, snap to target volume so resume doesn't
      // pick up at a stale intermediate volume.
      active.howl.volume(this.muted ? 0 : this.volume);
      active.howl.pause();
    }
    // Also stop any deck mid fade-out — otherwise the user would hear it
    // continue to fade while playback is paused.
    const inactive = this.getInactiveDeck();
    if (inactive.status === "fading") this.hardStopDeck(inactive);
  }

  resume(): void {
    this.resumeAudioContext();
    const deck = this.getActiveDeck();
    if (deck.howl && !deck.howl.playing()) {
      deck.howl.play();
      this.scheduleNearEnd();
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.muted) {
      const deck = this.getActiveDeck();
      // Don't clobber a fade-in mid-transition — only set explicit volume
      // when the active deck is in steady-state playback.
      if (deck.howl && deck.status === "playing") deck.howl.volume(this.volume);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    const deck = this.getActiveDeck();
    if (deck.howl && deck.status === "playing") deck.howl.volume(m ? 0 : this.volume);
  }

  isPlaying(): boolean { return this.getActiveDeck().howl?.playing() ?? false; }

  getProgress(): { elapsed: number; duration: number; progress: number } | null {
    const howl = this.getActiveDeck().howl;
    if (!howl) return null;
    const elapsed = (howl.seek() as number) || 0;
    const duration = howl.duration() || 0;
    return { elapsed, duration, progress: duration > 0 ? elapsed / duration : 0 };
  }

  stop(): void {
    this.clearNearEnd();
    this.hardStopDeck(this.deckA);
    this.hardStopDeck(this.deckB);
    if (this.heartbeat) {
      this.heartbeat.stop();
      this.heartbeat.unload();
      this.heartbeat = null;
    }
  }
}
