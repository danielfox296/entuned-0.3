import { Howl } from "howler";

export type CrossfadePlayerOptions = {
  volume?: number;
  onTrackEnded?: () => void;
  onError?: (err: unknown) => void;
  // Fired when play() is rejected (e.g. autoplay policy on Chrome/iOS).
  // Distinct from onError (load failures) so the caller can auto-advance
  // rather than just displaying an error and stalling.
  onPlayError?: (err: unknown) => void;
};

// Single-Howl player. Native onend drives advance; no preload, no overlap.
// Class name kept for diff size — rename later if we keep this shape.
export class CrossfadePlayer {
  private current: Howl | null = null;
  private volume = 1;
  private muted = false;
  private opts: CrossfadePlayerOptions;

  constructor(opts: CrossfadePlayerOptions = {}) {
    this.volume = opts.volume ?? 1;
    this.opts = opts;
  }

  createAndPlay(url: string, opts?: { volume?: number }): void {
    const targetVol = this.muted ? 0 : (opts?.volume ?? this.volume);

    if (this.current) {
      const c = this.current;
      c.off();
      c.stop();
      c.unload();
      this.current = null;
    }

    const howl = new Howl({
      src: [url],
      html5: true,
      volume: targetVol,
      onend: () => this.opts.onTrackEnded?.(),
      onloaderror: (_id, err) => this.opts.onError?.(err),
      onplayerror: (_id, err) => this.opts.onPlayError?.(err),
    });
    howl.play();
    this.current = howl;
  }

  pause(): void { this.current?.pause(); }
  // Guard against calling play() on an already-playing Howl. With html5:true, a redundant
  // play() creates a second <audio> element starting from position 0, which overlaps the
  // main track and fires its own onend.
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
    if (this.current) {
      this.current.off();
      this.current.stop();
      this.current.unload();
      this.current = null;
    }
  }
}
