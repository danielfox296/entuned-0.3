import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @aws-sdk/client-s3 before importing r2 so uploadBuffer is a no-op.
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    async send() { return {} }
  }
  class PutObjectCommand {
    constructor(_args: unknown) {}
  }
  return { S3Client, PutObjectCommand }
})

// R2 client lazy-inits from env. Set minimum env so getClient() doesn't throw.
process.env.R2_ACCOUNT_ID = 'test-account'
process.env.R2_ACCESS_KEY_ID = 'test-key'
process.env.R2_SECRET_ACCESS_KEY = 'test-secret'
process.env.R2_PUBLIC_BASE_URL = 'https://pub-test.r2.dev'

const { downloadAndUploadFromUrl, MIN_AUDIO_BYTES } = await import('./r2.js')

// Build a Response-shaped fake. fetch is stubbed per-test.
function mockResponse(opts: { status?: number; statusText?: string; headers?: Record<string, string>; body?: Uint8Array }) {
  const status = opts.status ?? 200
  const headers = new Headers(opts.headers ?? {})
  const body = opts.body ?? new Uint8Array(0)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: opts.statusText ?? 'OK',
    url: 'https://example.com/audio.mp3',
    headers,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}

// A buffer that's a valid size (≥ MIN_AUDIO_BYTES) and not HTML.
function bigAudioBuffer(size = MIN_AUDIO_BYTES + 1000): Uint8Array {
  const buf = new Uint8Array(size)
  buf[0] = 0xff // MP3 sync byte (not 0x3c)
  return buf
}

describe('downloadAndUploadFromUrl — guards against half-rendered Suno takes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uploads a healthy audio response', async () => {
    const audio = bigAudioBuffer()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) }, body: audio })
    ))
    const out = await downloadAndUploadFromUrl('https://example.com/audio.mp3', 'test/key.mp3')
    expect(out.byteSize).toBe(audio.length)
    expect(out.contentType).toBe('audio/mpeg')
    expect(out.url).toBe('https://pub-test.r2.dev/test/key.mp3')
  })

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ status: 404, statusText: 'Not Found' })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/download failed: 404/)
  })

  // Regression: 2026-05-25 free-tier outage. audiopipe.suno.ai returned 200 OK
  // with Content-Length: 0 for takes accepted before they finished rendering,
  // and the server silently wrote 10 zero-byte LineageRows.
  it('throws when Content-Length header says 0 (the prod bug)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'audio/mpeg', 'content-length': '0' }, body: new Uint8Array(0) })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/content-length 0 below/)
  })

  it('throws when Content-Length is below the audio floor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'audio/mpeg', 'content-length': '1234' }, body: new Uint8Array(1234) })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/content-length 1234 below/)
  })

  it('throws when content-type is not audio/*', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'text/html' }, body: bigAudioBuffer() })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/unexpected content-type text\/html/)
  })

  it('throws when body is HTML (legacy guard still fires)', async () => {
    const html = new Uint8Array(bigAudioBuffer().length)
    html[0] = 0x3c // '<'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'audio/mpeg', 'content-length': String(html.length) }, body: html })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/HTML\/XML/)
  })

  it('throws when buffer is under the floor even with no Content-Length header', async () => {
    const small = new Uint8Array(100)
    small[0] = 0xff
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: { 'content-type': 'audio/mpeg' }, body: small })
    ))
    await expect(downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')).rejects.toThrow(/downloaded 100 bytes/)
  })

  it('accepts a missing content-type when bytes are valid', async () => {
    const audio = bigAudioBuffer()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ headers: {}, body: audio })
    ))
    const out = await downloadAndUploadFromUrl('https://example.com/audio.mp3', 'k')
    expect(out.byteSize).toBe(audio.length)
  })
})
