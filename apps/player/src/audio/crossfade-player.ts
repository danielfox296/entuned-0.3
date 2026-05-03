import { Howl } from "howler";

export type CrossfadePlayerOptions = {
  crossfadeMs?: number;
  volume?: number;
  onTrackEnded?: () => void;
  onError?: (err: unknown) => void;
  // Fired when play() is rejected (e.g. autoplay policy on Chrome/iOS).
  // Distinct from onError (load failures) so the caller can auto-advance
  // rather than just displaying an error and stalling.
  onPlayError?: (err: unknown) => void;
  onPause?: () => void;
};

export class CrossfadePlayer {
  private current: Howl | null = null;
  private next: Howl | null = null;
  private crossfadeMs: number;
  private volume = 1;
  private muted = false;
  private opts: CrossfadePlayerOptions;

  constructor(opts: CrossfadePlayerOptions = {}) {
    this.crossfadeMs = opts.crossfadeMs ?? 4000;
    this.volume = opts.volume ?? 1;
    this.opts = opts;
  }

  createAndPlay(url: string, opts?: { onDurationKnown?: (sec: number) => void; volume?: number }): void {
    const targetVol = this.muted ? 0 : (opts?.volume ?? this.volume);
    const howl = new Howl({
      src: [url],
      html5: false,
      volume: targetVol,
      onload: () => opts?.onDurationKnown?.(howl.duration()),
      onend: () => this.opts.onTrackEnded?.(),
      onloaderror: (_id, err) => this.opts.onError?.(err),
      onplayerror: (_id, err) => this.opts.onPlayError?.(err),
    });
    howl.on("pause", () => this.opts.onPause?.());
    howl.play();

    if (this.current) {
      const c = this.current;
      c.off("pause");
      c.off("end"); // prevent stale onend from firing after this crossfade triggers advanceToNext
      c.fade(c.volume() as number, 0, this.crossfadeMs);
      window.setTimeout(() => { c.stop(); c.unload(); }, this.crossfadeMs + 100);
    }
    if (this.next) { this.next.unload(); this.next = null; }
    this.current = howl;
  }

  loadNext(url: string): Promise<void> {
    if (this.next) { this.next.unload(); this.next = null; }
    return new Promise((resolve, reject) => {
      const howl = new Howl({
        src: [url],
        html5: false,
        volume: 0,
        onload: () => resolve(),
        onloaderror: (_id, err) => reject(err),
        onplayerror: (_id, err) => this.opts.onPlayError?.(err),
        // onend intentionally omitted: wired in startNext once this becomes current.
        // Attaching onend here risks a spurious Howler "end" event on the idle preloaded
        // Howl firing onTrackEnded before the track has ever played.
      });
      this.next = howl;
    });
  }

  // Returns true if a track was started, false if this.next was null (caller should fall back).
  startNext(): boolean {
    if (!this.next) return false;
    const n = this.next;
    const targetVol = this.muted ? 0 : this.volume;

    n.on("pause", () => this.opts.onPause?.());
    // Wire onend here, not in loadNext, so only the playing track can advance the queue.
    n.on("end", () => this.opts.onTrackEnded?.());

    if (this.current) {
      // Always start at target volume — no fade-in from 0. The crossfade effect
      // comes entirely from fading the outgoing track out. Fading the incoming
      // track in from 0 risks playing it silently if iOS suspends the setInterval
      // that drives the fade (screen sleep, interruption, etc.).
      n.volume(targetVol);
      n.play();
      const c = this.current;
      c.off("pause");
      c.off("end"); // same: prevent double-advance if onend fires during fade-out window
      c.fade(c.volume() as number, 0, this.crossfadeMs);
      window.setTimeout(() => { c.stop(); c.unload(); }, this.crossfadeMs + 100);
    } else {
      n.volume(targetVol);
      n.play();
    }

    this.current = n;
    this.next = null;
    return true;
  }

  pause(): void { this.current?.pause(); }
  // Guard against calling play() on an already-playing Howl. With html5:true, a redundant
  // play() creates a second <audio> element starting from position 0, which overlaps the
  // main track and fires its own onend — causing the "sustain loop" symptom on iOS.
  resume(): void { if (this.current && !this.current.playing()) this.current.play(); }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.muted && this.current) this.current.volume(this.volume);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.current) this.current.volume(m ? 0 : this.volume);
  }

  isPlaying(): boolean { return this.current?.playing() ?? false; }

  getProgress(): { elapsed: number; duration: number; progress: number } | null {
    const c = this.current;
    if (!c) return null;
    const elapsed = (c.seek() as number) || 0;
    const duration = c.duration() || 0;
    return { elapsed, duration, progress: duration > 0 ? elapsed / duration : 0 };
  }

  stop(): void {
    this.current?.off("pause");
    this.current?.stop(); this.current?.unload();
    this.next?.off("pause");
    this.next?.unload();
    this.current = null; this.next = null;
  }
}
