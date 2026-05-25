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

  // Regression: 2026-05-25. For some Suno UUIDs, audiopipe.suno.ai returns
  // 200 OK / Content-Type: audio/mp3 with an empty body even though the take
  // is fully rendered and cdn1.suno.ai serves the real MP3 fine. The resolver
  // returns BOTH endpoints as candidates and the download loop falls back.
  describe('Suno share URL → multi-candidate fallback', () => {
    const SHARE_URL = 'https://suno.com/s/9PYPnD9vab0Jboex'
    const UUID = '3ab33558-9e7b-4528-8b58-28a87ca189c7'
    const SONG_PAGE_URL = `https://suno.com/song/${UUID}?sh=9PYPnD9vab0Jboex`
    const AUDIOPIPE = `https://audiopipe.suno.ai/?item_id=${UUID}&format=mp3`
    const CDN1 = `https://cdn1.suno.ai/${UUID}.mp3`

    // Builds a fetch mock that routes per URL: HEAD on suno.com resolves the
    // share link; GET on audio URLs returns whatever the caller specifies.
    function fetchRouter(audio: Partial<Record<string, ReturnType<typeof mockResponse>>>) {
      return vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'HEAD' && url === SHARE_URL) {
          return { ...mockResponse({}), url: SONG_PAGE_URL } as Response
        }
        const resp = audio[url]
        if (!resp) throw new Error(`unmocked fetch: ${url}`)
        return resp
      })
    }

    it('falls back to cdn1 when audiopipe returns 200 OK with an empty body', async () => {
      const audio = bigAudioBuffer()
      vi.stubGlobal('fetch', fetchRouter({
        [AUDIOPIPE]: mockResponse({ headers: { 'content-type': 'audio/mp3' }, body: new Uint8Array(0) }),
        [CDN1]: mockResponse({ headers: { 'content-type': 'audio/mp3', 'content-length': String(audio.length) }, body: audio }),
      }))

      const out = await downloadAndUploadFromUrl(SHARE_URL, 'song-seeds/x/take-1.mp3')
      expect(out.byteSize).toBe(audio.length)
      expect(out.url).toBe('https://pub-test.r2.dev/song-seeds/x/take-1.mp3')
    })

    it('throws an aggregated error when every candidate fails', async () => {
      vi.stubGlobal('fetch', fetchRouter({
        [AUDIOPIPE]: mockResponse({ headers: { 'content-type': 'audio/mp3' }, body: new Uint8Array(0) }),
        [CDN1]: mockResponse({ status: 403, statusText: 'Forbidden' }),
      }))

      await expect(downloadAndUploadFromUrl(SHARE_URL, 'k')).rejects.toThrow(/all audio sources failed/)
      await expect(downloadAndUploadFromUrl(SHARE_URL, 'k')).rejects.toThrow(/audiopipe\.suno\.ai/)
      await expect(downloadAndUploadFromUrl(SHARE_URL, 'k')).rejects.toThrow(/cdn1\.suno\.ai/)
    })

    it('uses audiopipe when it succeeds (prior behavior preserved)', async () => {
      const audio = bigAudioBuffer()
      vi.stubGlobal('fetch', fetchRouter({
        [AUDIOPIPE]: mockResponse({ headers: { 'content-type': 'audio/mp3', 'content-length': String(audio.length) }, body: audio }),
        // cdn1 intentionally not mocked — if the loop reaches it the test fails.
      }))

      const out = await downloadAndUploadFromUrl(SHARE_URL, 'k')
      expect(out.byteSize).toBe(audio.length)
    })
  })
})
