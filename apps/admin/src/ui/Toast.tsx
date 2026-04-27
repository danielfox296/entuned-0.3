import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: ToastKind; message: string }

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const KIND_STYLES: Record<ToastKind, { bg: string; fg: string; border: string }> = {
  success: { bg: '#0d2818', fg: '#7ad9a8', border: '#1f5c3a' },
  error:   { bg: '#2a1010', fg: '#ff9a9a', border: '#7a2222' },
  info:    { bg: '#101a2a', fg: '#9ec1ff', border: '#22467a' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setItems((xs) => [...xs, { id, kind, message }])
    const ttl = kind === 'error' ? 6000 : 3000
    const t = setTimeout(() => dismiss(id), ttl)
    timers.current.set(id, t)
  }, [dismiss])

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
  }, [])

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
      }}>
        {items.map((it) => {
          const k = KIND_STYLES[it.kind]
          return (
            <div
              key={it.id}
              onClick={() => dismiss(it.id)}
              style={{
                background: k.bg, color: k.fg, border: `1px solid ${k.border}`,
                padding: '10px 14px', borderRadius: S.r4,
                fontSize: S.small, fontFamily: T.sans,
                minWidth: 240, maxWidth: 420, cursor: 'pointer',
                pointerEvents: 'auto',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              {it.message}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
