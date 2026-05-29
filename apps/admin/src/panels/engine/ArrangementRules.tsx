import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ArrangementConfig } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, Textarea, Section, S, useToast } from '../../ui/index.js'

// Operator surface for the Stager (arranger) policy: chorus-escalation cues +
// end-of-song outro carry-out. Versioned singleton — Save writes a new version.
// Backs GET/POST /admin/arrangement-policy. The runtime reads the latest version.
const DENSITY_HINT = 'minimal · sparse · medium · full'
const DYNAMIC_HINT = 'steady · building · dropping · stripped · erupting · fade · sustained · retreating'

export function ArrangementRules() {
  const [version, setVersion] = useState<number | null>(null)
  const [cfg, setCfg] = useState<ArrangementConfig | null>(null)
  const [history, setHistory] = useState<Array<{ version: number; notes: string | null; createdAt: string }>>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  const reload = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.arrangementPolicy(token)
      setVersion(r.version); setCfg(r.config); setHistory(r.history); setErr(null)
    } catch (e: any) { setErr(e.message ?? 'load failed') }
  }
  useEffect(() => { void reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const save = async () => {
    if (!cfg) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const r = await api.saveArrangementPolicy(cfg, notes || null, token)
      setNotes(''); await reload()
      toast.success(`saved v${r.version}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save') }
    finally { setBusy(false) }
  }

  if (!cfg) {
    return <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>{err ?? 'loading…'}</div>
  }

  const fc = cfg.finalChorus, mc = cfg.midChorus, o = cfg.outroOnChorusEnd
  const setFC = (k: keyof typeof fc, v: string | null) => setCfg({ ...cfg, finalChorus: { ...fc, [k]: v } })
  const setMC = (k: keyof typeof mc, v: any) => setCfg({ ...cfg, midChorus: { ...mc, [k]: v } })
  const setO = (k: keyof typeof o, v: any) => setCfg({ ...cfg, outroOnChorusEnd: { ...o, [k]: v } })
  const nz = (s: string) => (s.trim() === '' ? null : s)

  return (
    <Section
      title="Arrangement Rules (Stager)"
      subtitle="How the Stager escalates repeated choruses and carries the song out past a final chorus. The runtime uses the latest saved version; Save writes a new one. Empty fields = none."
    >
      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        <Group title="Final chorus" hint="Applied to the last chorus (or [Final Chorus]). Forced values only override weaker base states (never downgrade a louder section).">
          <Field label="delivery cue" hint='added to the vocal delivery, e.g. "gang vocals on the hook"'>
            <Input value={fc.deliveryCue ?? ''} onChange={(e) => setFC('deliveryCue', nz(e.target.value))} placeholder="gang vocals on the hook" />
          </Field>
          <Field label="force density" hint={DENSITY_HINT}>
            <Input value={fc.forceDensity ?? ''} onChange={(e) => setFC('forceDensity', nz(e.target.value))} placeholder="full" />
          </Field>
          <Field label="force dynamic" hint={DYNAMIC_HINT}>
            <Input value={fc.forceDynamic ?? ''} onChange={(e) => setFC('forceDynamic', nz(e.target.value))} placeholder="sustained" />
          </Field>
        </Group>

        <Group title="Mid choruses" hint="Applied to repeated choruses at or after the index below (but not the final one).">
          <Field label="from chorus #" hint="e.g. 2 = the 2nd chorus onward">
            <Input width={80} type="number" value={mc.fromIndex} onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v >= 1) setMC('fromIndex', v) }} />
          </Field>
          <Field label="delivery cue" hint='e.g. "stacked harmonies"'>
            <Input value={mc.deliveryCue ?? ''} onChange={(e) => setMC('deliveryCue', nz(e.target.value))} placeholder="stacked harmonies" />
          </Field>
        </Group>

        <Group title="Outro carry-out" hint="When a song ends on a chorus with no outro/tag after it, append a section so it lands instead of stopping cold. Forms that already end on an [Outro]/[Tag] are left alone.">
          <Field label="enabled">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={o.enabled} onChange={(e) => setO('enabled', e.target.checked)} />
              <span>{o.enabled ? 'append a carry-out outro' : 'off (songs may end cold on the final chorus)'}</span>
            </label>
          </Field>
          <Field label="section label" hint="header for the appended section">
            <Input width={140} value={o.label} onChange={(e) => setO('label', e.target.value)} placeholder="Outro" />
          </Field>
          <Field label="dynamic" hint={DYNAMIC_HINT}>
            <Input value={o.dynamic ?? ''} onChange={(e) => setO('dynamic', nz(e.target.value))} placeholder="sustained" />
          </Field>
          <Field label="density" hint={DENSITY_HINT}>
            <Input value={o.density ?? ''} onChange={(e) => setO('density', nz(e.target.value))} placeholder="full" />
          </Field>
          <Field label="delivery cue" hint="leave empty for a wordless instrumental carry-out">
            <Input value={o.deliveryCue ?? ''} onChange={(e) => setO('deliveryCue', nz(e.target.value))} placeholder="(instrumental)" />
          </Field>
        </Group>

        <Field label="version note" hint="optional — why this change">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. softened outro to a fade for the chill outcomes" />
        </Field>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button onClick={save} busy={busy}>{busy ? '…' : 'save new version'}</Button>
          <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
            current: v{version ?? '—'}
          </span>
        </div>

        {history.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.borderSubtle}`, paddingTop: 10 }}>
            <div style={{ fontFamily: T.sans, fontSize: S.label, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>history</div>
            {history.map((h) => (
              <div key={h.version} style={{ display: 'flex', gap: 10, fontFamily: T.sans, fontSize: S.label, color: T.textDim, padding: '2px 0' }}>
                <span style={{ width: 36 }}>v{h.version}</span>
                <span style={{ width: 150 }}>{new Date(h.createdAt).toLocaleString()}</span>
                <span style={{ flex: 1 }}>{h.notes ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: `1px solid ${T.borderSubtle}`, borderRadius: 4, padding: 12 }}>
      <div>
        <div style={{ fontFamily: T.sans, fontSize: S.small, color: T.text, fontWeight: 500 }}>{title}</div>
        {hint && <div style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim, lineHeight: 1.45, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {hint && <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim, lineHeight: 1.45 }}>{hint}</span>}
      {children}
    </div>
  )
}
