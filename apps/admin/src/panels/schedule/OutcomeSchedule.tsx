import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, ScheduleSlot, ScheduleSlotInput, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Select, PanelHeader, StorePicker, S, useStoreSelection } from '../../ui/index.js'

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
  const [storeId, setStoreId] = useStoreSelection()
  const [rows, setRows] = useState<ScheduleSlot[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [adding, setAdding] = useState<{ daysOfWeek: number[]; startTime: string; endTime: string; outcomeId: string } | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const tz = stores?.find((s) => s.id === storeId)?.timezone ?? null

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader title="Outcome Schedule" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />
        {tz && (
          <span style={{ fontSize: S.label, color: T.textDim, fontFamily: T.sans }}>
            Timezone: {tz}
          </span>
        )}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {storeId && !rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {storeId && rows && (
        <>
          <Button
            variant={adding ? 'ghost' : 'primary'}
            onClick={() => setAdding(adding ? null : { daysOfWeek: [1], startTime: '09:00', endTime: '12:00', outcomeId: '' })}
          >{adding ? 'cancel' : '+ new row'}</Button>

          {adding && (
            <MultiDayCreateForm
              draft={adding}
              outcomes={outcomes}
              busy={addBusy}
              onChange={setAdding}
              onSubmit={async () => {
                const token = getToken(); if (!token || adding.daysOfWeek.length === 0) return
                setAddBusy(true)
                try {
                  for (const dow of adding.daysOfWeek) {
                    await api.createScheduleSlot(storeId!, {
                      dayOfWeek: dow,
                      startTime: adding.startTime,
                      endTime: adding.endTime,
                      outcomeId: adding.outcomeId,
                    }, token)
                  }
                  setAdding(null); reload()
                } catch (e: any) { setErr(e.message) }
                finally { setAddBusy(false) }
              }}
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

function DayColumn({ day, rows, outcomes, onChanged }: {
  day: { dow: number; label: string; short: string }
  rows: ScheduleSlot[]
  outcomes: OutcomeRowFull[] | null
  onChanged: () => void
}) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: S.r4, padding: 10, minHeight: 120,
    }}>
      <div style={{
        fontSize: S.label, color: T.accentMuted, fontFamily: T.sans,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.borderSubtle}`,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{day.short}</span>
        <span style={{ color: T.textDim }}>{rows.length}</span>
      </div>
      {rows.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.label, padding: '4px 0' }}>—</div>
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
      <div style={{ background: T.accentGlow, border: `1px solid ${T.accentMuted}`, borderRadius: S.r3, padding: 8 }}>
        <RowForm
          draft={editing}
          outcomes={outcomes}
          onChange={setEditing as any}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          submitLabel={busy === 'save' ? '…' : 'save'}
          compact
        />
        {err && <div style={{ fontSize: S.label, color: T.danger, fontFamily: T.sans, marginTop: 4 }}>{err}</div>}
      </div>
    )
  }

  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: S.r3, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontFamily: T.sans, fontSize: S.small, color: T.text, fontWeight: 500 }}>
        {row.startTime}–{row.endTime}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: S.small, color: T.textMuted }}>
        {row.outcomeDisplayTitle ?? row.outcomeTitle}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <Button variant="tiny" onClick={startEdit} disabled={busy === 'delete'}>edit</Button>
        <Button variant="tinyDanger" onClick={remove} disabled={busy === 'delete'}>×</Button>
      </div>
      {err && <div style={{ fontSize: S.label, color: T.danger, fontFamily: T.sans }}>{err}</div>}
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
  const valid = !!(draft.outcomeId && draft.startTime < draft.endTime)

  return (
    <div style={{
      background: compact ? 'transparent' : T.accentGlow,
      border: compact ? 'none' : `1px solid ${T.accentMuted}`,
      borderRadius: S.r4, padding: compact ? 0 : 14,
      display: 'grid',
      gridTemplateColumns: compact ? '1fr' : 'repeat(4, 1fr)',
      gap: 8,
    }}>
      <div>
        <label style={labelStyle}>day</label>
        <Select value={draft.dayOfWeek} onChange={(e) => set('dayOfWeek', parseInt(e.target.value, 10))}>
          {DAYS.map((d) => <option key={d.dow} value={d.dow}>{d.label}</option>)}
        </Select>
      </div>
      <div>
        <label style={labelStyle}>start</label>
        <Input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>end</label>
        <Input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>outcome</label>
        <Select value={draft.outcomeId} onChange={(e) => set('outcomeId', e.target.value)}>
          <option value="" disabled>— pick —</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
          ))}
        </Select>
      </div>
      <div style={{ gridColumn: compact ? '1' : '1 / -1', display: 'flex', gap: 6 }}>
        <Button onClick={onSubmit} disabled={!valid}>{submitLabel}</Button>
        {onCancel && <Button variant="tiny" onClick={onCancel}>cancel</Button>}
      </div>
    </div>
  )
}

function MultiDayCreateForm({ draft, outcomes, busy, onChange, onSubmit }: {
  draft: { daysOfWeek: number[]; startTime: string; endTime: string; outcomeId: string }
  outcomes: OutcomeRowFull[] | null
  busy: boolean
  onChange: (next: { daysOfWeek: number[]; startTime: string; endTime: string; outcomeId: string }) => void
  onSubmit: () => void
}) {
  const toggleDay = (dow: number) => {
    const has = draft.daysOfWeek.includes(dow)
    onChange({ ...draft, daysOfWeek: has ? draft.daysOfWeek.filter((d) => d !== dow) : [...draft.daysOfWeek, dow].sort() })
  }
  const allDays = draft.daysOfWeek.length === 7
  const valid = draft.daysOfWeek.length > 0 && !!draft.outcomeId && draft.startTime < draft.endTime

  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: S.r4, padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div>
        <label style={labelStyle}>days</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {DAYS.map((d) => {
            const on = draft.daysOfWeek.includes(d.dow)
            return (
              <button
                key={d.dow}
                type="button"
                onClick={() => toggleDay(d.dow)}
                style={{
                  background: on ? T.accentMuted : T.surfaceRaised,
                  border: `1px solid ${on ? T.accent : T.borderSubtle}`,
                  color: on ? T.bg : T.text,
                  fontFamily: T.sans, fontSize: S.label,
                  padding: '4px 10px', borderRadius: S.r3, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >{d.short}</button>
            )
          })}
          <button
            type="button"
            onClick={() => onChange({ ...draft, daysOfWeek: allDays ? [] : DAYS.map((d) => d.dow) })}
            style={{
              background: 'transparent', border: `1px solid ${T.borderSubtle}`,
              color: T.textDim, fontFamily: T.sans, fontSize: S.label,
              padding: '4px 10px', borderRadius: S.r3, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 4,
            }}
          >{allDays ? 'none' : 'all'}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <div>
          <label style={labelStyle}>start</label>
          <Input type="time" value={draft.startTime} onChange={(e) => onChange({ ...draft, startTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>end</label>
          <Input type="time" value={draft.endTime} onChange={(e) => onChange({ ...draft, endTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>outcome</label>
          <Select value={draft.outcomeId} onChange={(e) => onChange({ ...draft, outcomeId: e.target.value })}>
            <option value="" disabled>— pick —</option>
            {(outcomes ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Button onClick={onSubmit} disabled={!valid || busy}>
          {busy
            ? `creating ${draft.daysOfWeek.length} row${draft.daysOfWeek.length === 1 ? '' : 's'}…`
            : `create ${draft.daysOfWeek.length} row${draft.daysOfWeek.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: S.label, color: T.textDim, fontFamily: T.sans, textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: 3,
}
