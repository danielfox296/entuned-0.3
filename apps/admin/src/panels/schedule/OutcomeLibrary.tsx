import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { OutcomeRowFull, ProductionEraStub } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Select, PanelHeader, S } from '../../ui/index.js'

type Row = OutcomeRowFull & { lineageCount: number }
type Filter = 'active' | 'superseded' | 'all'

interface Draft {
  title: string
  tempoBpm: number
  mode: string
  dynamics: string
  instrumentation: string
  familiarity: string
  productionEraId: string
}

const MODE_SUGGESTIONS = ['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'aeolian', 'modal_jazz', 'blues']

export function OutcomeLibrary() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [eras, setEras] = useState<ProductionEraStub[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adding, setAdding] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => {
    const token = getToken(); if (!token) return
    try { setRows(await api.outcomeLibrary(token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => {
    reload()
    const token = getToken(); if (!token) return
    api.productionEras(token).then(setEras).catch(() => {})
  }, [])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'active' && r.supersededAt) return false
      if (filter === 'superseded' && !r.supersededAt) return false
      if (q && !r.title.toLowerCase().includes(q) && !(r.mode ?? '').toLowerCase().includes(q) && !(r.instrumentation ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filter, search])

  const counts = {
    active: rows?.filter((r) => !r.supersededAt).length ?? 0,
    superseded: rows?.filter((r) => r.supersededAt).length ?? 0,
    all: rows?.length ?? 0,
  }

  const startEdit = (r: Row) => {
    setEditingId(r.id)
    setDraft({
      title: r.title,
      tempoBpm: r.tempoBpm,
      mode: r.mode,
      dynamics: r.dynamics ?? '',
      instrumentation: r.instrumentation ?? '',
      familiarity: r.familiarity ?? '',
      productionEraId: r.productionEraId ?? '',
    })
  }

  const saveEdit = async () => {
    if (!editingId || !draft) return
    const token = getToken(); if (!token) return
    setBusy('save'); setErr(null)
    try {
      await api.editOutcome(editingId, {
        title: draft.title, tempoBpm: draft.tempoBpm, mode: draft.mode,
        dynamics: draft.dynamics || null, instrumentation: draft.instrumentation || null,
        familiarity: draft.familiarity || null, productionEraId: draft.productionEraId || null,
      }, token)
      setEditingId(null); setDraft(null); await reload()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const create = async () => {
    if (!adding) return
    const token = getToken(); if (!token) return
    setBusy('create'); setErr(null)
    try {
      await api.createOutcome({
        title: adding.title, tempoBpm: adding.tempoBpm, mode: adding.mode,
        dynamics: adding.dynamics || null, instrumentation: adding.instrumentation || null,
        familiarity: adding.familiarity || null, productionEraId: adding.productionEraId || null,
      }, token)
      setAdding(null); await reload()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const supersede = async (r: Row) => {
    const token = getToken(); if (!token) return
    setBusy(r.id)
    try { await api.supersedeOutcome(r.id, token); await reload() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Outcome Library"
        subtitle="Browse, create, edit (copy-on-write versioned), and retire outcomes."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['active', 'superseded', 'all'] as const).map((f) => {
            const on = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: on ? T.surfaceRaised : 'transparent',
                  border: `1px solid ${on ? T.accent : T.border}`,
                  color: on ? T.accent : T.textMuted,
                  padding: '6px 14px', borderRadius: S.r4,
                  fontFamily: T.sans, fontSize: S.small, cursor: 'pointer',
                }}
              >{f} ({counts[f]})</button>
            )
          })}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search title, mode, instrumentation"
          style={{ minWidth: 280, flex: 1, maxWidth: 480, width: 'auto' }}
        />
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { title: '', tempoBpm: 100, mode: 'major', dynamics: '', instrumentation: '', familiarity: '', productionEraId: '' })}
        >{adding ? 'cancel' : '+ new outcome'}</Button>
      </div>

      {adding && (
        <OutcomeForm
          draft={adding}
          onChange={setAdding}
          onSubmit={create}
          onCancel={() => setAdding(null)}
          submitLabel={busy === 'create' ? 'creating…' : 'create'}
          intent="new"
          eras={eras}
        />
      )}

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      {!rows && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {rows && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
          <HeaderRow />
          {visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              no matches
            </div>
          )}
          {visible.map((r) => (
            <div key={r.id}>
              <DataRow row={r} onEdit={() => startEdit(r)} onSupersede={() => supersede(r)} busy={busy === r.id} />
              {editingId === r.id && draft && (
                <div style={{ padding: 14, background: T.accentGlow, borderBottom: `1px solid ${T.borderSubtle}` }}>
                  <OutcomeForm
                    draft={draft}
                    onChange={setDraft}
                    onSubmit={saveEdit}
                    onCancel={() => { setEditingId(null); setDraft(null) }}
                    submitLabel={busy === 'save' ? 'saving…' : `save as v${r.version + 1}`}
                    intent="edit"
                    currentVersion={r.version}
                    eras={eras}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const COLS = '1.6fr 60px 70px 90px 1fr 1.6fr 90px 1fr 80px 130px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.sans, fontSize: S.label, color: T.textDim, textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      <span>title</span>
      <span>v</span>
      <span>bpm</span>
      <span>mode</span>
      <span>dynamics</span>
      <span>instrumentation</span>
      <span>familiarity</span>
      <span>production era</span>
      <span style={{ textAlign: 'right' }}>pool</span>
      <span style={{ textAlign: 'right' }}>status</span>
    </div>
  )
}

function DataRow({ row, onEdit, onSupersede, busy }: {
  row: Row; onEdit: () => void; onSupersede: () => void; busy: boolean
}) {
  const superseded = !!row.supersededAt
  const eraLabel = row.productionEra ? `${row.productionEra.decade} ${row.productionEra.genreDisplayName ?? row.productionEra.genreSlug}` : '—'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.sans, fontSize: S.small, alignItems: 'center',
      opacity: superseded ? 0.6 : 1,
    }}>
      <span style={{ color: T.text, fontWeight: 500 }}>{row.title}</span>
      <span style={{ color: T.accentMuted }}>v{row.version}</span>
      <span style={{ color: T.textMuted }}>{row.tempoBpm}</span>
      <span style={{ color: T.textMuted }}>{row.mode}</span>
      <span style={cellTrunc}>{row.dynamics ?? '—'}</span>
      <span style={cellTrunc}>{row.instrumentation ?? '—'}</span>
      <span style={cellTrunc}>{row.familiarity ?? '—'}</span>
      <span style={cellTrunc}>{eraLabel}</span>
      <span style={{ color: row.lineageCount === 0 ? T.danger : T.text, textAlign: 'right' }}>{row.lineageCount}</span>
      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ color: superseded ? T.textDim : T.success, fontSize: S.label, marginRight: 4 }}>
          {superseded ? 'superseded' : 'active'}
        </span>
        {!superseded && (
          <>
            <Button variant="tiny" onClick={onEdit} disabled={busy}>edit</Button>
            <Button variant="tinyDanger" onClick={onSupersede} disabled={busy}>retire</Button>
          </>
        )}
      </span>
    </div>
  )
}

function OutcomeForm({ draft, onChange, onSubmit, onCancel, submitLabel, intent, currentVersion, eras }: {
  draft: Draft
  onChange: (d: Draft | null) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  intent: 'new' | 'edit'
  currentVersion?: number
  eras: ProductionEraStub[]
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!(draft.title.trim() && draft.mode.trim() && draft.tempoBpm >= 40 && draft.tempoBpm <= 220)

  return (
    <div style={{
      background: intent === 'new' ? T.accentGlow : 'transparent',
      border: intent === 'new' ? `1px solid ${T.accentMuted}` : 'none',
      borderRadius: S.r4, padding: intent === 'new' ? 14 : 0,
      display: 'grid', gridTemplateColumns: '1fr 100px 140px 1fr 1.4fr 120px 1.2fr', gap: 8,
    }}>
      <div>
        <label style={labelStyle}>title</label>
        <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Brand Reinforcement" />
      </div>
      <div>
        <label style={labelStyle}>tempo bpm</label>
        <Input type="number" min={40} max={220} value={draft.tempoBpm} onChange={(e) => set('tempoBpm', parseInt(e.target.value, 10) || 100)} />
      </div>
      <div>
        <label style={labelStyle}>mode</label>
        <Input list="mode-suggestions" value={draft.mode} onChange={(e) => set('mode', e.target.value)} placeholder="major" />
        <datalist id="mode-suggestions">
          {MODE_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
        </datalist>
      </div>
      <div>
        <label style={labelStyle}>dynamics</label>
        <Input value={draft.dynamics} onChange={(e) => set('dynamics', e.target.value)} placeholder="medium-loud" />
      </div>
      <div>
        <label style={labelStyle}>instrumentation</label>
        <Input value={draft.instrumentation} onChange={(e) => set('instrumentation', e.target.value)} placeholder="rhodes, brushed kit, upright bass" />
      </div>
      <div>
        <label style={labelStyle}>familiarity (playback)</label>
        <Select value={draft.familiarity} onChange={(e) => set('familiarity', e.target.value)}>
          <option value="">—</option>
          <option value="unfamiliar">unfamiliar</option>
          <option value="familiar">familiar</option>
          <option value="neutral">neutral</option>
        </Select>
      </div>
      <div>
        <label style={labelStyle}>production era (generation)</label>
        <Select value={draft.productionEraId} onChange={(e) => set('productionEraId', e.target.value)}>
          <option value="">—</option>
          {eras.map((e) => (
            <option key={e.id} value={e.id}>{e.decade} — {e.genreDisplayName ?? e.genreSlug}</option>
          ))}
        </Select>
      </div>
      {intent === 'edit' && currentVersion != null && (
        <div style={{
          gridColumn: '1 / -1',
          fontSize: S.label, fontFamily: T.sans, color: T.warn,
          padding: '4px 0',
        }}>
          ⚠ Saves as v{currentVersion + 1}. v{currentVersion} stays referenced by existing hooks, schedule rows, and song seeds — those won't auto-upgrade.
        </div>
      )}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
        <Button onClick={onSubmit} disabled={!valid}>{submitLabel}</Button>
        <Button variant="tiny" onClick={onCancel}>cancel</Button>
      </div>
    </div>
  )
}

const cellTrunc: CSSProperties = {
  color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: S.label, color: T.textDim, fontFamily: T.sans,
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3,
}
