import { Howl } from "howler";

// Minimal silent MP3 — keeps the iOS audio session alive across lock/background.
// Avoids needing a public asset file.
const SILENT_MP3 =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";

export type CrossfadePlayerOptions = {
  volume?: number;
  onTrackEnded?: () => void;
  onError?: (err: unknown) => void;
  onPlayError?: (err: unknown) => void;
};

type DeckStatus = "empty" | "loading" | "ready" | "playing";

type Deck = {
  howl: Howl | null;
  url: string | null;
  status: DeckStatus;
};

export class CrossfadePlayer {
  private deckA: Deck = { howl: null, url: null, status: "empty" };
  private deckB: Deck = { howl: null, url: null, status: "empty" };
  private active: "A" | "B" = "A";
  private heartbeat: Howl | null = null;
  private volume = 1;
  private muted = false;
  private opts: CrossfadePlayerOptions;

  constructor(opts: CrossfadePlayerOptions = {}) {
    this.volume = opts.volume ?? 1;
    this.opts = opts;
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

  // Load a URL into the inactive deck silently so it's ready before it's needed.
  preloadNext(url: string): void {
    const inactive = this.getInactiveDeck();
    // Already loading or ready for this URL — nothing to do.
    if (inactive.url === url && (inactive.status === "loading" || inactive.status === "ready")) return;
    // Different URL in the inactive deck — clear it first.
    if (inactive.howl) {
      inactive.howl.off();
      inactive.howl.unload();
    }
    inactive.url = url;
    inactive.status = "loading";
    inactive.howl = new Howl({
      src: [url],
      html5: true,
      preload: true,
      volume: 0,
      onload: () => { inactive.status = "ready"; },
      onloaderror: () => {
        // Silently reset — createAndPlay will try again if this track is requested.
        inactive.status = "empty";
        inactive.url = null;
      },
    });
  }

  createAndPlay(url: string, opts?: { volume?: number }): void {
    this.startHeartbeat();
    this.resumeAudioContext();

    const targetVol = this.muted ? 0 : (opts?.volume ?? this.volume);
    const inactive = this.getInactiveDeck();
    const preloaded = inactive.url === url && inactive.status === "ready" && inactive.howl;

    // Defer unloading the current deck until after the swap to avoid
    // destroying a still-playing Howl.
    const prevDeck = { ...this.getActiveDeck() };
    const prevHowl = prevDeck.howl;

    if (preloaded && inactive.howl) {
      // Fast path: preloaded deck is ready — swap and play immediately.
      this.swapDecks();
      const deck = this.getActiveDeck();
      deck.status = "playing";
      inactive.howl.off();
      inactive.howl.volume(targetVol);
      inactive.howl.on("end", () => this.opts.onTrackEnded?.());
      inactive.howl.on("loaderror", (_id: number, err: unknown) => this.opts.onError?.(err));
      inactive.howl.on("playerror", (_id: number, err: unknown) => this.opts.onPlayError?.(err));
      inactive.howl.play();
    } else {
      // Slow path: need to load from scratch into inactive deck.
      if (inactive.howl) { inactive.howl.off(); inactive.howl.unload(); }
      inactive.url = url;
      inactive.status = "loading";
      const howl = new Howl({
        src: [url],
        html5: true,
        volume: targetVol,
        onend: () => this.opts.onTrackEnded?.(),
        onloaderror: (_id: number, err: unknown) => this.opts.onError?.(err),
        onplayerror: (_id: number, err: unknown) => this.opts.onPlayError?.(err),
      });
      inactive.howl = howl;
      this.swapDecks();
      this.getActiveDeck().status = "playing";
      howl.play();
    }

    // Unload previous deck after a short delay — enough for any fade to complete
    // and for iOS not to glitch on simultaneous unload+play.
    if (prevHowl) {
      prevHowl.off();
      prevHowl.stop();
      setTimeout(() => { prevHowl.unload(); }, 2000);
    }
    // Mark previous deck slot as empty.
    const prev = this.active === "A" ? this.deckB : this.deckA;
    prev.howl = null;
    prev.url = null;
    prev.status = "empty";
  }

  pause(): void { this.getActiveDeck().howl?.pause(); }

  resume(): void {
    this.resumeAudioContext();
    const deck = this.getActiveDeck();
    if (deck.howl && !deck.howl.playing()) deck.howl.play();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.muted) this.getActiveDeck().howl?.volume(this.volume);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.getActiveDeck().howl?.volume(m ? 0 : this.volume);
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
    for (const deck of [this.deckA, this.deckB]) {
      if (deck.howl) { deck.howl.off(); deck.howl.stop(); deck.howl.unload(); deck.howl = null; }
      deck.url = null;
      deck.status = "empty";
    }
    if (this.heartbeat) { this.heartbeat.stop(); this.heartbeat.unload(); this.heartbeat = null; }
  }
}
