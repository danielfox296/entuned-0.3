// Cloudflare R2 client. S3-compatible.
//
// Used by Operator Seeding accept flow: operator pastes a Suno (or other) source URL,
// server downloads the audio and re-hosts on our own bucket. Oscar's player only ever
// sees R2 URLs.
//
// Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// Optional env: R2_BUCKET (default: 'entuned-payloads'), R2_PUBLIC_BASE_URL.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const accountId = process.env.R2_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const bucket = process.env.R2_BUCKET ?? 'entuned-payloads'
const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL ?? ''

let client: S3Client | null = null

function getClient(): S3Client {
  if (client) return client
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return client
}

export interface UploadedObject {
  key: string
  url: string
  byteSize: number
  contentType: string
}

export async function uploadBuffer(key: string, body: Buffer, contentType: string): Promise<UploadedObject> {
  await getClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
  const url = publicBaseUrl ? `${publicBaseUrl}/${key}` : `r2://${bucket}/${key}`
  return { key, url, byteSize: body.length, contentType }
}

/**
 * If the URL is a Suno song page (suno.com/song/<uuid>), extract the CDN audio URL
 * from the page's __NEXT_DATA__ JSON blob. Otherwise return the URL unchanged.
 */
export async function resolveAudioUrl(url: string): Promise<string> {
  const sunoPage = url.match(/suno\.com\/song\/([0-9a-f-]{36})/i)
  if (!sunoPage) return url

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`suno page fetch failed: ${res.status} for ${url}`)
  const html = await res.text()

  // __NEXT_DATA__ contains the full page props including audio_url.
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)
  if (match) {
    try {
      const data = JSON.parse(match[1]!)
      const clips: any[] = data?.props?.pageProps?.initialData?.clips ?? []
      const clip = clips[0]
      if (clip?.audio_url) return clip.audio_url as string
      if (clip?.song_path) return `https://cdn1.suno.ai/${clip.song_path}` as string
    } catch { /* fall through */ }
  }

  // Fallback: derive the CDN URL directly from the UUID (works for standard songs).
  const uuid = sunoPage[1]!
  return `https://cdn1.suno.ai/${uuid}.mp3`
}

/**
 * Download a remote file (Suno page URL or direct CDN URL) and upload to R2.
 * Suno song page URLs are resolved to the CDN audio URL first.
 * Always stores as audio/mpeg.
 */
export async function downloadAndUploadFromUrl(sourceUrl: string, key: string): Promise<UploadedObject> {
  const audioUrl = await resolveAudioUrl(sourceUrl)
  const res = await fetch(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${audioUrl}`)
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)
  // Detect HTML magic bytes — expired CDN links or blocked pages return HTML.
  if (buf[0] === 0x3c) throw new Error('download returned HTML, not audio — the link may have expired or require login')
  return uploadBuffer(key, buf, 'audio/mpeg')
}
