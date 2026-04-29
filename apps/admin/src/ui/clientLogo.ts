// Local per-client logo storage.
//
// First cut: stored as a base64 data URL in localStorage under
// `client-logo:<clientId>`. Works today without a schema change. The
// next iteration moves storage server-side (Client.logoUrl + R2 upload
// endpoint); this module is the only consumer, so the swap is contained.

import { useEffect, useState } from 'react'

const KEY_PREFIX = 'client-logo:'
const EVENT = 'client-logo-changed'

function key(clientId: string) {
  return `${KEY_PREFIX}${clientId}`
}

export function getClientLogo(clientId: string | null | undefined): string | null {
  if (!clientId) return null
  try {
    return window.localStorage.getItem(key(clientId))
  } catch {
    return null
  }
}

export function setClientLogo(clientId: string, dataUrl: string | null) {
  try {
    if (dataUrl) window.localStorage.setItem(key(clientId), dataUrl)
    else window.localStorage.removeItem(key(clientId))
  } catch {
    /* quota or sandbox — ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { clientId } }))
}

export function useClientLogo(clientId: string | null | undefined): string | null {
  const [logo, setLogo] = useState<string | null>(() => getClientLogo(clientId))
  useEffect(() => {
    setLogo(getClientLogo(clientId))
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<{ clientId: string }>
      if (!clientId) return
      if (!ce.detail || ce.detail.clientId === clientId) {
        setLogo(getClientLogo(clientId))
      }
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [clientId])
  return logo
}

/** Read a File and return a downscaled square data URL (PNG). */
export async function fileToThumbnailDataUrl(file: File, maxPx = 256): Promise<string> {
  const buf = await file.arrayBuffer()
  const blob = new Blob([buf], { type: file.type || 'image/png' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = (e) => reject(e)
      i.src = url
    })
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const scale = Math.min(1, maxPx / Math.max(w, h))
    const dw = Math.max(1, Math.round(w * scale))
    const dh = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = dw; canvas.height = dh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, dw, dh)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
