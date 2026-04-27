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
 * Resolve a Suno share/song page URL to a direct CDN audio URL.
 * Short links (suno.com/s/<code>) and song pages (suno.com/song/<uuid>)
 * both follow the same pattern: UUID maps to cdn1.suno.ai/<uuid>.mp3.
 * Non-Suno URLs are returned unchanged.
 */
async function resolveAudioUrl(url: string): Promise<string> {
  if (!/suno\.com\/(s\/|song\/)/i.test(url)) return url
  // Follow redirects to reach the canonical /song/<uuid> URL.
  const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' })
  const finalUrl = res.url
  const m = finalUrl.match(/\/song\/([0-9a-f-]{36})/i)
  if (!m) throw new Error(`could not extract Suno song UUID from ${url} (resolved to ${finalUrl})`)
  return `https://cdn1.suno.ai/${m[1]}.mp3`
}

/**
 * Download a remote audio file (or Suno share link) and upload to R2.
 * Suno share/song page URLs are auto-resolved to the CDN audio URL.
 * Always stores as audio/mpeg.
 */
export async function downloadAndUploadFromUrl(sourceUrl: string, key: string): Promise<UploadedObject> {
  const audioUrl = await resolveAudioUrl(sourceUrl)
  const res = await fetch(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`)
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)
  // Detect HTML/XML magic bytes — a blocked or expired URL returns markup.
  if (buf[0] === 0x3c) throw new Error('URL returned HTML/XML, not audio — link may have expired')
  return uploadBuffer(key, buf, 'audio/mpeg')
}
