import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, ScheduleSlot, ScheduleSlotInput, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'

const DAYS: { dow: number; label: string; short: string }[] = [
  { dow: 1, label: 'Monday', short: 'Mon' },
  { dow: 2, label: 'Tuesday', short: 'Tue' },
  { dow: 3, label: 'Wednesday', short: 'Wed' },
  { dow: 4, label: 'Thursday', short: 'Thu' },
  { dow: 5, label: 'Friday', short: 'Fri' },
  { dow: 6, label: 'Saturday', short: 'Sat' },
  { dow: 7, label: 'Sunday', short: 'Sun' },
]

export function OutcomeSchedule() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [rows, setRows] = useState<ScheduleSlot[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [adding, setAdding] = useState<{ dayOfWeek: number; startTime: string; endTime: string; outcomeId: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setRows(null); return }
    const token = getToken(); if (!token) return
    setRows(null)
    api.schedule(storeId, token).then(setRows).catch((e) => setErr(e.message))
  }, [storeId])

  const reload = async () => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    try { setRows(await api.schedule(storeId, token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }

  const grouped: Record<number, ScheduleSlot[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
  for (const r of rows ?? []) grouped[r.dayOfWeek]?.push(r)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Outcome Schedule</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Per-store weekly grid. Rows resolve in store-local time. Gaps fall back to default outcome.
        </div>
      </div>

      <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !rows && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {storeId && rows && (
        <>
          <button
            onClick={() => setAdding(adding ? null : { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', outcomeId: '' })}
            style={primaryBtn(!adding, false)}
          >{adding ? 'cancel' : '+ new row'}</button>

          {adding && (
            <RowForm
              draft={adding}
              outcomes={outcomes}
              onChange={setAdding}
              onSubmit={async () => {
                const token = getToken(); if (!token) return
                try {
                  await api.createScheduleSlot(storeId!, adding, token)
                  setAdding(null); reload()
                } catch (e: any) { setErr(e.message) }
              }}
              submitLabel="create"
            />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {DAYS.map((d) => (
              <DayColumn key={d.dow} day={d} rows={grouped[d.dow] ?? []} outcomes={outcomes} onChanged={reload} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function StorePicker({ stores, storeId, onPick }: {
  stores: StoreSummary[] | null; storeId: string | null; onPick: (id: string) => void
}) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading stores…</div>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>store</span>
      <select
        value={storeId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        style={{
          background: T.surface, border: `1px solid ${T.border}`, color: T.text,
          fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 4,
          outline: 'none', minWidth: 320,
        }}
      >
        <option value="" disabled>— pick a store —</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>
        ))}
      </select>
    </div>
  )
}

function DayColumn({ day, rows, outcomes, onChanged }: {
  day: { dow: number; label: string; short: string }
  rows: ScheduleSlot[]
  outcomes: OutcomeRowFull[] | null
  onChanged: () => void
}) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: 10, minHeight: 120,
    }}>
      <div style={{
        fontSize: 10, color: T.accentMuted, fontFamily: T.mono,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.borderSubtle}`,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{day.short}</span>
        <span style={{ color: T.textDim }}>{rows.length}</span>
      </div>
      {rows.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 10, padding: '4px 0' }}>—</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r) => <RowItem key={r.id} row={r} outcomes={outcomes} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

function RowItem({ row, outcomes, onChanged }: {
  row: ScheduleSlot; outcomes: OutcomeRowFull[] | null; onChanged: () => void
}) {
  const [editing, setEditing] = useState<ScheduleSlotInput | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const startEdit = () => setEditing({
    dayOfWeek: row.dayOfWeek, startTime: row.startTime,
    endTime: row.endTime, outcomeId: row.outcomeId,
  })

  const save = async () => {
    const token = getToken(); if (!token || !editing) return
    setBusy('save'); setErr(null)
    try { await api.updateScheduleSlot(row.id, editing, token); setEditing(null); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const remove = async () => {
    const token = getToken(); if (!token) return
    setBusy('delete')
    try { await api.deleteScheduleSlot(row.id, token); onChanged() }
    catch (e: any) { setErr(e.message); setBusy(null) }
  }

  if (editing) {
    return (
      <div style={{ background: T.accentGlow, border: `1px solid ${T.accentMuted}`, borderRadius: 3, padding: 8 }}>
        <RowForm
          draft={editing}
          outcomes={outcomes}
          onChange={setEditing as any}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          submitLabel={busy === 'save' ? '…' : 'save'}
          compact
        />
        {err && <div style={{ fontSize: 10, color: T.danger, fontFamily: T.mono, marginTop: 4 }}>{err}</div>}
      </div>
    )
  }

  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 3, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.text }}>
        {row.startTime}–{row.endTime}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 11, color: T.textMuted }}>
        {row.outcomeTitle}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button onClick={startEdit} disabled={busy === 'delete'} style={tinyBtn}>edit</button>
        <button onClick={remove} disabled={busy === 'delete'} style={tinyDangerBtn}>×</button>
      </div>
      {err && <div style={{ fontSize: 10, color: T.danger, fontFamily: T.mono }}>{err}</div>}
    </div>
  )
}

function RowForm({ draft, outcomes, onChange, onSubmit, onCancel, submitLabel, compact }: {
  draft: ScheduleSlotInput
  outcomes: OutcomeRowFull[] | null
  onChange: (d: ScheduleSlotInput) => void
  onSubmit: () => void
  onCancel?: () => void
  submitLabel: string
  compact?: boolean
}) {
  const set = <K extends keyof ScheduleSlotInput>(k: K, v: ScheduleSlotInput[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.outcomeId && draft.startTime < draft.endTime

  return (
    <div style={{
      background: compact ? 'transparent' : T.accentGlow,
      border: compact ? 'none' : `1px solid ${T.accentMuted}`,
      borderRadius: 4, padding: compact ? 0 : 14,
      display: 'grid',
      gridTemplateColumns: compact ? '1fr' : 'repeat(4, 1fr)',
      gap: 8,
    }}>
      <div>
        <label style={labelStyle}>day</label>
        <select value={draft.dayOfWeek} onChange={(e) => set('dayOfWeek', parseInt(e.target.value, 10))} style={inputStyle}>
          {DAYS.map((d) => <option key={d.dow} value={d.dow}>{d.label}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>start</label>
        <input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>end</label>
        <input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>outcome</label>
        <select value={draft.outcomeId} onChange={(e) => set('outcomeId', e.target.value)} style={inputStyle}>
          <option value="" disabled>— pick —</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.title} (v{o.version})</option>
          ))}
        </select>
      </div>
      <div style={{ gridColumn: compact ? '1' : '1 / -1', display: 'flex', gap: 6 }}>
        <button onClick={onSubmit} disabled={!valid} style={primaryBtn(!!valid, false)}>{submitLabel}</button>
        {onCancel && <button onClick={onCancel} style={tinyBtn}>cancel</button>}
      </div>
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 11, padding: '5px 8px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 9, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase',
  marginBottom: 3,
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 3, padding: '6px 12px',
    fontFamily: T.mono, fontSize: 11, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const tinyBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '2px 8px', borderRadius: 2, fontFamily: T.mono, fontSize: 9, cursor: 'pointer',
}

const tinyDangerBtn: CSSProperties = {
  ...tinyBtn, borderColor: T.danger, color: T.danger,
}
