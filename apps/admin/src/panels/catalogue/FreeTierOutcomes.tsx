import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import { T } from '../../tokens.js'
import { PanelHeader, S } from '../../ui/index.js'

interface Row {
  outcomeKey: string
  outcomeId: string
  title: string
  version: number
  availableOnFree: boolean
}

export function FreeTierOutcomes() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => {
    const token = getToken(); if (!token) return
    try { setRows(await api.freeTierOutcomes(token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { void reload() }, [])

  const toggle = async (outcomeKey: string) => {
    const token = getToken(); if (!token) return
    setBusy(outcomeKey); setErr(null)
    try {
      const r = await api.toggleFreeTierOutcome(outcomeKey, token)
      setRows((cur) => cur?.map((x) => x.outcomeKey === outcomeKey ? { ...x, availableOnFree: r.availableOnFree } : x) ?? null)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Free Tier Outcomes"
        subtitle="Outcomes available to free-tier stores. Locked outcomes appear greyed out in the player with an upgrade CTA. Toggle to gate or run a promo week."
      />
      {err && <div style={{ color: T.danger, fontFamily: T.mono, fontSize: 14 }}>{err}</div>}
      {!rows && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}
      {rows && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 140px',
            gap: 10, padding: '8px 12px', background: T.surface,
            borderBottom: `1px solid ${T.border}`,
            fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase',
          }}>
            <span>outcome</span>
            <span>version</span>
            <span style={{ textAlign: 'right' }}>available on free</span>
          </div>
          {rows.map((r) => (
            <div key={r.outcomeKey} style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 140px',
              gap: 10, padding: '12px', borderBottom: `1px solid ${T.borderSubtle}`,
              fontFamily: T.mono, fontSize: 14, alignItems: 'center',
            }}>
              <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>{r.title}</span>
              <span style={{ color: T.textDim, fontSize: 13 }}>v{r.version}</span>
              <span style={{ textAlign: 'right' }}>
                <input
                  type="checkbox"
                  checked={r.availableOnFree}
                  disabled={busy === r.outcomeKey}
                  onChange={() => void toggle(r.outcomeKey)}
                  title={r.availableOnFree
                    ? 'Free-tier stores see this outcome enabled'
                    : 'Free-tier stores see this outcome locked (upgrade CTA)'}
                  style={{ accentColor: T.accent, cursor: busy === r.outcomeKey ? 'wait' : 'pointer', width: 18, height: 18 }}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
