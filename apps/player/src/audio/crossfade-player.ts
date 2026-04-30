import { Howl } from "howler";

export type CrossfadePlayerOptions = {
  crossfadeMs?: number;
  onTrackEnded?: () => void;
  onError?: (err: unknown) => void;
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
    this.opts = opts;
  }

  createAndPlay(url: string, onDurationKnown?: (sec: number) => void): void {
    const targetVol = this.muted ? 0 : this.volume;
    const howl = new Howl({
      src: [url],
      html5: true,
      volume: targetVol,
      onload: () => onDurationKnown?.(howl.duration()),
      onend: () => this.opts.onTrackEnded?.(),
      onloaderror: (_id, err) => this.opts.onError?.(err),
      onplayerror: (_id, err) => this.opts.onError?.(err),
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
        html5: true,
        volume: 0,
        onload: () => resolve(),
        onloaderror: (_id, err) => reject(err),
        onplayerror: (_id, err) => this.opts.onError?.(err),
        onend: () => this.opts.onTrackEnded?.(),
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
  resume(): void { this.current?.play(); }

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
