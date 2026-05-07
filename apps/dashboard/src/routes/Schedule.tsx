import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { Button, Input } from '../ui/index.js'
import { api, TIER_RANK } from '../api.js'
import type { ScheduleSlot, ScheduleSlotInput, OutcomeOption } from '../api.js'
import { useTier } from '../lib/tier.jsx'

const DAYS = [
  { dow: 1, label: 'Monday',    short: 'Mon' },
  { dow: 2, label: 'Tuesday',   short: 'Tue' },
  { dow: 3, label: 'Wednesday', short: 'Wed' },
  { dow: 4, label: 'Thursday',  short: 'Thu' },
  { dow: 5, label: 'Friday',    short: 'Fri' },
  { dow: 6, label: 'Saturday',  short: 'Sat' },
  { dow: 7, label: 'Sunday',    short: 'Sun' },
]

export function Schedule() {
  const { stores, tier } = useTier()

  if (TIER_RANK[tier] < TIER_RANK.pro) {
    return (
      <Layout>
        <LockScreen
          tabName="Schedule"
          valueLine="Time-of-day outcome rotation. Music shifts as your customer mix changes through the day."
          requiredTier="pro"
          currentTier={tier}
          timeToValue="Schedule rules apply on the next playback rotation — usually within an hour."
          detail="On Pro you'd schedule Linger for the morning lull and Lift Energy for Saturday afternoon — automatically, with one rule."
          preview={<SchedulePreview />}
        />
      </Layout>
    )
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', margin: 0,
        }}>Schedule</h1>
      </div>
      <ScheduleEditor stores={stores} />
    </Layout>
  )
}

function ScheduleEditor({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? '')
  const [rows, setRows] = useState<ScheduleSlot[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeOption[] | null>(null)
  const [adding, setAdding] = useState<{ daysOfWeek: number[]; startTime: string; endTime: string; outcomeId: string } | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.meOutcomes().then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setRows(null); return }
    setRows(null)
    api.meSchedule(storeId).then(setRows).catch((e) => setErr(e.message))
  }, [storeId])

  const reload = async () => {
    if (!storeId) return
    try { setRows(await api.meSchedule(storeId)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }

  const grouped: Record<number, ScheduleSlot[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
  for (const r of rows ?? []) grouped[r.dayOfWeek]?.push(r)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {stores.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={labelStyle}>Location</label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            style={selectStyle}
          >
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {storeId && !rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: 13 }}>Loading…</div>}

      {storeId && rows && (
        <>
          <div>
            <Button
              variant={adding ? 'ghost' : 'primary'}
              onClick={() => setAdding(adding ? null : { daysOfWeek: [1], startTime: '09:00', endTime: '12:00', outcomeId: '' })}
            >{adding ? 'Cancel' : '+ New rule'}</Button>
          </div>

          {adding && (
            <MultiDayForm
              draft={adding}
              outcomes={outcomes}
              busy={addBusy}
              onChange={setAdding}
              onSubmit={async () => {
                if (adding.daysOfWeek.length === 0) return
                setAddBusy(true)
                try {
                  for (const dow of adding.daysOfWeek) {
                    await api.createScheduleSlot(storeId, {
                      dayOfWeek: dow,
                      startTime: adding.startTime,
                      endTime: adding.endTime,
                      outcomeId: adding.outcomeId,
                    })
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
  outcomes: OutcomeOption[] | null
  onChanged: () => void
}) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: 10, minHeight: 120,
    }}>
      <div style={{
        fontSize: 11, color: T.accentMuted, fontFamily: T.sans,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.borderSubtle}`,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{day.short}</span>
        <span style={{ color: T.textDim }}>{rows.length || ''}</span>
      </div>
      {rows.length === 0 && (
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: 11, padding: '4px 0' }}>—</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((r) => <RowItem key={r.id} row={r} outcomes={outcomes} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

function RowItem({ row, outcomes, onChanged }: {
  row: ScheduleSlot; outcomes: OutcomeOption[] | null; onChanged: () => void
}) {
  const [editing, setEditing] = useState<ScheduleSlotInput | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!editing) return
    setBusy('save'); setErr(null)
    try { await api.updateScheduleSlot(row.id, editing); setEditing(null); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const remove = async () => {
    setBusy('delete')
    try { await api.deleteScheduleSlot(row.id); onChanged() }
    catch (e: any) { setErr(e.message); setBusy(null) }
  }

  if (editing) {
    return (
      <div style={{ background: T.accentGlow, border: `1px solid ${T.accentMuted}`, borderRadius: 8, padding: 8 }}>
        <SlotForm
          draft={editing}
          outcomes={outcomes}
          onChange={setEditing as any}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          submitLabel={busy === 'save' ? '…' : 'Save'}
        />
        {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.sans, marginTop: 4 }}>{err}</div>}
      </div>
    )
  }

  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontFamily: T.sans, fontSize: 12, color: T.text, fontWeight: 500 }}>
        {row.startTime}–{row.endTime}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 12, color: T.textMuted }}>
        {row.outcomeDisplayTitle ?? row.outcomeTitle}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <Button variant="ghost" onClick={() => setEditing({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, outcomeId: row.outcomeId })} disabled={!!busy}>edit</Button>
        <Button variant="danger" onClick={remove} disabled={busy === 'delete'}>×</Button>
      </div>
      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.sans }}>{err}</div>}
    </div>
  )
}

function SlotForm({ draft, outcomes, onChange, onSubmit, onCancel, submitLabel }: {
  draft: ScheduleSlotInput
  outcomes: OutcomeOption[] | null
  onChange: (d: ScheduleSlotInput) => void
  onSubmit: () => void
  onCancel?: () => void
  submitLabel: string
}) {
  const set = <K extends keyof ScheduleSlotInput>(k: K, v: ScheduleSlotInput[K]) => onChange({ ...draft, [k]: v })
  const valid = !!(draft.outcomeId && draft.startTime < draft.endTime)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label style={labelStyle}>Start</label>
        <Input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>End</label>
        <Input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Outcome</label>
        <select value={draft.outcomeId} onChange={(e) => set('outcomeId', e.target.value)} style={selectStyle}>
          <option value="" disabled>— pick —</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button onClick={onSubmit} disabled={!valid}>{submitLabel}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}

function MultiDayForm({ draft, outcomes, busy, onChange, onSubmit }: {
  draft: { daysOfWeek: number[]; startTime: string; endTime: string; outcomeId: string }
  outcomes: OutcomeOption[] | null
  busy: boolean
  onChange: (next: typeof draft) => void
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
      borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div>
        <label style={labelStyle}>Days</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
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
                  fontFamily: T.sans, fontSize: 11,
                  padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
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
              color: T.textDim, fontFamily: T.sans, fontSize: 11,
              padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 4,
            }}
          >{allDays ? 'None' : 'All'}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div>
          <label style={labelStyle}>Start</label>
          <Input type="time" value={draft.startTime} onChange={(e) => onChange({ ...draft, startTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>End</label>
          <Input type="time" value={draft.endTime} onChange={(e) => onChange({ ...draft, endTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>Outcome</label>
          <select value={draft.outcomeId} onChange={(e) => onChange({ ...draft, outcomeId: e.target.value })} style={selectStyle}>
            <option value="" disabled>— pick —</option>
            {(outcomes ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Button onClick={onSubmit} disabled={!valid || busy}>
          {busy
            ? `Creating ${draft.daysOfWeek.length} rule${draft.daysOfWeek.length === 1 ? '' : 's'}…`
            : `Create ${draft.daysOfWeek.length} rule${draft.daysOfWeek.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}

// Static preview shown inside LockScreen for sub-Pro users.
function SchedulePreview() {
  const rows = [
    { label: 'Weekday mornings', when: 'Mon–Fri · 9:00–11:00 AM', outcome: 'Linger',      color: T.accent },
    { label: 'Lunch rush',       when: 'Mon–Fri · 12:00–2:00 PM', outcome: 'Lift Energy',  color: T.slate },
    { label: 'Saturday floor',   when: 'Sat · 11:00 AM–4:00 PM',  outcome: 'Lift Energy',  color: T.slate },
    { label: 'Sunday wind-down', when: 'Sun · 3:00–6:00 PM',      outcome: 'Linger',      color: T.accent },
  ]
  return (
    <div style={{ padding: 20 }}>
      {rows.map((r) => (
        <div key={r.label} style={{
          display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr',
          alignItems: 'center', gap: 16,
          padding: '14px 16px',
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}>
          <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{r.label}</div>
          <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.sans }}>{r.when}</div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
            color: r.color, textTransform: 'uppercase',
            border: `1px solid ${r.color}`, padding: '3px 8px', borderRadius: 8,
            justifySelf: 'start',
          }}>
            {r.outcome}
          </div>
        </div>
      ))}
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11, color: T.textDim, fontFamily: T.sans,
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3,
}

const selectStyle: CSSProperties = {
  width: '100%',
  background: T.surfaceRaised, border: `1px solid ${T.border}`,
  color: T.text, fontFamily: T.sans, fontSize: 13,
  padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
}
