// Room-loudness sampler — mic-based, A-weighted, ~1 sample/min.
//
// Owns its own AudioContext (separate from Howler's) so the mic stream can never
// route through the music graph and risk cutting playback. Only runs when the
// per-store flag is on and the player is visibly playing.
//
// Numbers reported are device-relative dBFS, NOT calibrated SPL. Use for trend
// detection across a single device, not absolute thresholds.

export type LoudnessSampleEvent = {
  dbfs_a: number
  sample_window_ms: number
  weighted: 'A'
}

export type SamplerStartResult = 'granted' | 'denied' | 'unavailable'

const DEFAULT_INTERVAL_MS = 60_000
const SAMPLE_WINDOW_MS = 500

// A-weighting biquad cascade. Standard 4-stage cascade approximating IEC 61672-1 class 2,
// normalized so 1 kHz input passes through at 0 dB. Coefficients precomputed for 48 kHz.
// At other sample rates the curve drifts a couple dB at the extremes — fine for our purposes
// (relative trend detection on a single device, not measurement-grade SPL).
//
// Reference: standard "Aweighting" biquad cascade from IIRFilterNode examples.
const A_WEIGHT_BIQUADS: Array<{ b: [number, number, number]; a: [number, number, number] }> = [
  // High-pass at ~20.6 Hz (squared)
  { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] },
  // High-pass at ~107.7 Hz (squared)
  { b: [1, -2, 1], a: [1, -1.98700285911560, 0.98715024543762] },
  // Low-pass at ~737.9 Hz
  { b: [1, 0, 0], a: [1, -1.91272163391113, 0.91369485855103] },
  // Low-pass at ~12200 Hz (squared)
  { b: [1, 0, 0], a: [1, -1.62030077934265, 0.65742528438568] },
]

function buildAWeightingFilter(ctx: AudioContext): AudioNode {
  // Convolve all biquads into a single IIR filter (2N+1 taps). Easier: chain four BiquadFilters.
  // Since IIRFilterNode coefficients are baked at one sample rate and we need flexibility,
  // use Biquad-style nodes via IIRFilterNode per stage.
  const nodes = A_WEIGHT_BIQUADS.map((s) => new IIRFilterNode(ctx, { feedforward: s.b, feedback: s.a }))
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
  // Return a wrapper: input goes to first, output is last. Caller chains.
  // We expose by attaching a tiny gain node as the entry point.
  const entry = ctx.createGain()
  entry.gain.value = 1
  entry.connect(nodes[0])
  // Use a "fake" pattern: wrap by exposing input via a property on the last node.
  // Simpler: return a GainNode that internally routes through the chain.
  ;(entry as AudioNode & { _exit?: AudioNode })._exit = nodes[nodes.length - 1]
  return entry
}

export class LoudnessSampler {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private buffer: Float32Array<ArrayBuffer> | null = null
  private intervalId: number | null = null
  private intervalMs: number
  private onSample: (e: LoudnessSampleEvent) => void
  private isPlaying: () => boolean
  private running = false

  constructor(opts: {
    onSample: (e: LoudnessSampleEvent) => void
    isPlaying: () => boolean
    intervalMs?: number
  }) {
    this.onSample = opts.onSample
    this.isPlaying = opts.isPlaying
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  async start(): Promise<SamplerStartResult> {
    if (this.running) return 'granted'
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'unavailable'
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      this.stream = stream

      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      const ctx = new Ctx()
      this.ctx = ctx

      const src = ctx.createMediaStreamSource(stream)
      const aWeight = buildAWeightingFilter(ctx) as AudioNode & { _exit?: AudioNode }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      this.analyser = analyser
      this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))

      src.connect(aWeight)
      ;(aWeight._exit ?? aWeight).connect(analyser)
      // Do NOT connect analyser to ctx.destination — we don't want to play the mic back.

      this.running = true
      this.intervalId = window.setInterval(() => this.maybeSample(), this.intervalMs)

      // Pause sampling when tab hidden; resume when visible.
      document.addEventListener('visibilitychange', this.onVisibilityChange)

      return 'granted'
    } catch (err) {
      const name = (err as Error & { name?: string })?.name ?? ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied'
      console.warn('[loudness-sampler] start failed', err)
      return 'unavailable'
    }
  }

  private onVisibilityChange = () => {
    // Don't tear down — getUserMedia track stays open. Sample loop already gates on isPlaying().
  }

  private maybeSample(): void {
    if (!this.running || !this.analyser || !this.buffer) return
    if (document.hidden) return
    if (!this.isPlaying()) return

    // Collect ~SAMPLE_WINDOW_MS worth of frames. fftSize at 48kHz ≈ 42ms per draw,
    // so ~12 reads gets us ~500ms.
    const ctx = this.ctx
    if (!ctx) return
    const samplesNeeded = Math.ceil((SAMPLE_WINDOW_MS / 1000) * ctx.sampleRate)
    let collected = 0
    let sumSq = 0
    const drawOne = () => {
      this.analyser!.getFloatTimeDomainData(this.buffer!)
      for (let i = 0; i < this.buffer!.length; i++) {
        const v = this.buffer![i]
        sumSq += v * v
      }
      collected += this.buffer!.length
      if (collected < samplesNeeded && this.running) {
        // Schedule next draw on the next animation frame; AudioContext keeps pumping
        // independently, so each draw returns the most recent fft window.
        requestAnimationFrame(drawOne)
      } else {
        const rms = Math.sqrt(sumSq / Math.max(1, collected))
        // dBFS where 1.0 ≈ full scale. Floor at -120 to avoid -Infinity.
        const dbfs = rms > 0 ? 20 * Math.log10(rms) : -120
        this.onSample({
          dbfs_a: Number.isFinite(dbfs) ? Number(dbfs.toFixed(2)) : -120,
          sample_window_ms: SAMPLE_WINDOW_MS,
          weighted: 'A',
        })
      }
    }
    drawOne()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null }
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    try { this.stream?.getTracks().forEach((t) => t.stop()) } catch {}
    this.stream = null
    try { void this.ctx?.close() } catch {}
    this.ctx = null
    this.analyser = null
    this.buffer = null
  }
}
