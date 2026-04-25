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
 * Download a remote file (e.g. a Suno CDN URL) and upload to R2 under the given key.
 * Content-type comes from the source response (or falls back to audio/mpeg).
 */
export async function downloadAndUploadFromUrl(sourceUrl: string, key: string): Promise<UploadedObject> {
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${sourceUrl}`)
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)
  const contentType = res.headers.get('content-type') ?? 'audio/mpeg'
  return uploadBuffer(key, buf, contentType)
}
