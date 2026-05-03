// Room-loudness sampler — mic-based, A-weighted, ~1 sample/min.
//
// Shares Howler's AudioContext so mic capture and music playback live in the
// same audio session. On iOS this is required: a separate AudioContext for the
// mic causes WebKit to switch the audio session to record mode, which mutes
// the music. With one shared context, no session switch happens.
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
const A_WEIGHT_BIQUADS: Array<{ b: [number, number, number]; a: [number, number, number] }> = [
  { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] },
  { b: [1, -2, 1], a: [1, -1.98700285911560, 0.98715024543762] },
  { b: [1, 0, 0], a: [1, -1.91272163391113, 0.91369485855103] },
  { b: [1, 0, 0], a: [1, -1.62030077934265, 0.65742528438568] },
]

function buildAWeightingFilter(ctx: AudioContext): AudioNode {
  const nodes = A_WEIGHT_BIQUADS.map((s) => new IIRFilterNode(ctx, { feedforward: s.b, feedback: s.a }))
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
  const entry = ctx.createGain()
  entry.gain.value = 1
  entry.connect(nodes[0])
  ;(entry as AudioNode & { _exit?: AudioNode })._exit = nodes[nodes.length - 1]
  return entry
}

function getHowlerCtx(): AudioContext | null {
  try {
    const ctx = (window as unknown as { Howler?: { ctx?: AudioContext } }).Howler?.ctx
    return ctx ?? null
  } catch { return null }
}

export class LoudnessSampler {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private srcNode: MediaStreamAudioSourceNode | null = null
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
    // Howler's AudioContext only exists after the first sound has been created — caller
    // should invoke start() from inside the play handler so playerRef.current has fired
    // createAndPlay() at least once.
    const ctx = getHowlerCtx()
    if (!ctx) {
      console.warn('[loudness-sampler] Howler AudioContext not yet available; skipping')
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
      this.ctx = ctx

      // Resume context if iOS suspended it during the permission prompt (which can
      // briefly steal focus and put the page state into something unhelpful).
      if (ctx.state === 'suspended') {
        try { await ctx.resume() } catch {}
      }

      const src = ctx.createMediaStreamSource(stream)
      this.srcNode = src
      const aWeight = buildAWeightingFilter(ctx) as AudioNode & { _exit?: AudioNode }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      this.analyser = analyser
      this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))

      src.connect(aWeight)
      ;(aWeight._exit ?? aWeight).connect(analyser)
      // Do NOT connect analyser to ctx.destination — we don't want to play the mic back
      // through the music output. The analyser is a "sink" that AudioContext still pulls
      // data through even when not connected to destination, because we call getFloatTimeDomainData.

      this.running = true
      this.intervalId = window.setInterval(() => this.maybeSample(), this.intervalMs)

      return 'granted'
    } catch (err) {
      const name = (err as Error & { name?: string })?.name ?? ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied'
      console.warn('[loudness-sampler] start failed', err)
      return 'unavailable'
    }
  }

  private maybeSample(): void {
    if (!this.running || !this.analyser || !this.buffer) return
    if (document.hidden) return
    if (!this.isPlaying()) return

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
        requestAnimationFrame(drawOne)
      } else {
        const rms = Math.sqrt(sumSq / Math.max(1, collected))
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
    try { this.stream?.getTracks().forEach((t) => t.stop()) } catch {}
    try { this.srcNode?.disconnect() } catch {}
    try { this.analyser?.disconnect() } catch {}
    this.stream = null
    this.srcNode = null
    this.analyser = null
    this.buffer = null
    // Do NOT close ctx — it's Howler's, not ours.
    this.ctx = null
  }
}
