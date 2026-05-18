import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { T } from '@entuned/tokens'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { Button, Input } from '../ui/index.js'
import { api, TIER_RANK } from '../api.js'
import type { ScheduleSlot, ScheduleSlotInput, OutcomeOption } from '../api.js'
import { useTier } from '../lib/tier.jsx'
import { trackFeaturePageView, trackUpgradeCtaClick } from '../lib/ga4.js'
import content from '../content/schedule.yaml'

const DAYS = [
  { dow: 1, label: content.days.monday_label,    short: content.days.monday_short },
  { dow: 2, label: content.days.tuesday_label,   short: content.days.tuesday_short },
  { dow: 3, label: content.days.wednesday_label, short: content.days.wednesday_short },
  { dow: 4, label: content.days.thursday_label,  short: content.days.thursday_short },
  { dow: 5, label: content.days.friday_label,    short: content.days.friday_short },
  { dow: 6, label: content.days.saturday_label,  short: content.days.saturday_short },
  { dow: 7, label: content.days.sunday_label,    short: content.days.sunday_short },
]

export function Schedule() {
  const { stores, tier, loading } = useTier()
  const tracked = useRef(false)
  useEffect(() => {
    if (loading || tracked.current) return
    tracked.current = true
    trackFeaturePageView('schedule', TIER_RANK[tier] < TIER_RANK.pro)
  }, [loading, tier])

  if (TIER_RANK[tier] < TIER_RANK.pro) {
    return (
      <Layout>
        <LockScreen
          tabName={content.lock.tab_name}
          valueLine={content.lock.value_line}
          requiredTier="pro"
          currentTier={tier}
          timeToValue={content.lock.time_to_value}
          bullets={content.lock.bullets}
          detail={content.lock.detail}
          onCtaClick={() => trackUpgradeCtaClick('feature_page_schedule', 'pro')}
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
        }}>{content.heading}</h1>
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
          <label style={labelStyle}>{content.editor.location_label}</label>
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

      {storeId && !rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: 13 }}>{content.editor.loading}</div>}

      {storeId && rows && (
        <>
          <div>
            <Button
              variant={adding ? 'ghost' : 'primary'}
              onClick={() => setAdding(adding ? null : { daysOfWeek: [1], startTime: '09:00', endTime: '12:00', outcomeId: '' })}
            >{adding ? content.editor.cancel : content.editor.new_rule}</Button>
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
        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: 11, padding: '4px 0' }}>{content.editor.empty_day}</div>
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
          submitLabel={busy === 'save' ? '…' : content.editor.save}
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
        <Button variant="ghost" onClick={() => setEditing({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, outcomeId: row.outcomeId })} disabled={!!busy}>{content.editor.edit}</Button>
        <Button variant="danger" onClick={remove} disabled={busy === 'delete'}>{content.editor.delete}</Button>
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
        <label style={labelStyle}>{content.editor.start_label}</label>
        <Input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>{content.editor.end_label}</label>
        <Input type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>{content.editor.outcome_label}</label>
        <select value={draft.outcomeId} onChange={(e) => set('outcomeId', e.target.value)} style={selectStyle}>
          <option value="" disabled>{content.editor.outcome_pick_placeholder}</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button onClick={onSubmit} disabled={!valid}>{submitLabel}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>{content.editor.cancel}</Button>}
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
  const isSingular = draft.daysOfWeek.length === 1

  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div>
        <label style={labelStyle}>{content.editor.days_label}</label>
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
          >{allDays ? content.editor.toggle_none : content.editor.toggle_all}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div>
          <label style={labelStyle}>{content.editor.start_label}</label>
          <Input type="time" value={draft.startTime} onChange={(e) => onChange({ ...draft, startTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>{content.editor.end_label}</label>
          <Input type="time" value={draft.endTime} onChange={(e) => onChange({ ...draft, endTime: e.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>{content.editor.outcome_label}</label>
          <select value={draft.outcomeId} onChange={(e) => onChange({ ...draft, outcomeId: e.target.value })} style={selectStyle}>
            <option value="" disabled>{content.editor.outcome_pick_placeholder}</option>
            {(outcomes ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Button onClick={onSubmit} disabled={!valid || busy}>
          {busy
            ? `${content.editor.create_busy_prefix}${draft.daysOfWeek.length}${isSingular ? content.editor.create_busy_suffix_singular : content.editor.create_busy_suffix_plural}`
            : `${content.editor.create_prefix}${draft.daysOfWeek.length}${isSingular ? content.editor.create_suffix_singular : content.editor.create_suffix_plural}`}
        </Button>
      </div>
    </div>
  )
}

// Static preview shown inside LockScreen for sub-Pro users.
function SchedulePreview() {
  const rows = [
    { label: content.preview.weekday_label,  when: content.preview.weekday_when,  outcome: content.preview.weekday_outcome,  color: T.accent },
    { label: content.preview.lunch_label,    when: content.preview.lunch_when,    outcome: content.preview.lunch_outcome,    color: T.slate },
    { label: content.preview.saturday_label, when: content.preview.saturday_when, outcome: content.preview.saturday_outcome, color: T.slate },
    { label: content.preview.sunday_label,   when: content.preview.sunday_when,   outcome: content.preview.sunday_outcome,   color: T.accent },
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
