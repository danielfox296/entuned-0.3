import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, StoreDetail, OutcomeRowFull, HookRowFull } from '../../api.js'
import { T } from '../../tokens.js'

type StatusFilter = 'all' | 'draft' | 'approved'

export function HookQueue() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [hooks, setHooks] = useState<HookRowFull[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setDetail(null); setHooks(null); return }
    const token = getToken(); if (!token) return
    setDetail(null); setHooks(null)
    api.storeDetail(storeId, token).then((d) => {
      setDetail(d)
      return api.icpHooks(d.icp.id, token)
    }).then((h) => h && setHooks(h)).catch((e) => setErr(e.message))
  }, [storeId])

  const reloadHooks = async () => {
    if (!detail) return
    const token = getToken(); if (!token) return
    try { setHooks(await api.icpHooks(detail.icp.id, token)) }
    catch (e: any) { setErr(e.message) }
  }

  const visibleHooks = (hooks ?? []).filter((h) => filter === 'all' ? true : h.status === filter)
  const grouped: Record<string, { outcome: { id: string; title: string; version: number }; hooks: HookRowFull[] }> = {}
  for (const h of visibleHooks) {
    if (!grouped[h.outcomeId]) grouped[h.outcomeId] = { outcome: h.outcome, hooks: [] }
    grouped[h.outcomeId]!.hooks.push(h)
  }
  const groupedKeys = Object.keys(grouped).sort((a, b) => grouped[a]!.outcome.title.localeCompare(grouped[b]!.outcome.title))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Hook Queue</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Per-ICP hooks grouped by Outcome. Drafts editable; approved hooks immutable.
        </div>
      </div>

      <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {detail && (
        <>
          {detail.sharedWith.length > 0 && (
            <div style={{
              background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
              borderRadius: 4, padding: '10px 14px', fontFamily: T.mono, fontSize: 11, color: T.text,
            }}>
              <span style={{ color: T.accent }}>shared ICP</span> — hooks are visible to{' '}
              {detail.sharedWith.map((s, i) => (
                <span key={s.id} style={{ color: T.textMuted }}>
                  {s.clientName} / {s.name}{i < detail.sharedWith.length - 1 ? ', ' : ''}
                </span>
              ))} as well.
            </div>
          )}

          <FilterBar filter={filter} onFilter={setFilter} hooks={hooks} />

          {!hooks && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading hooks…</div>}

          {hooks && (
            <>
              <NewHookForm icpId={detail.icp.id} outcomes={outcomes} onCreated={reloadHooks} />
              {groupedKeys.length === 0 && (
                <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12, padding: '12px 0' }}>
                  no hooks{filter !== 'all' ? ` matching ${filter}` : ''}
                </div>
              )}
              {groupedKeys.map((k) => (
                <OutcomeGroup
                  key={k}
                  outcome={grouped[k]!.outcome}
                  hooks={grouped[k]!.hooks}
                  onChanged={reloadHooks}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function StorePicker({ stores, storeId, onPick }: {
  stores: StoreSummary[] | null
  storeId: string | null
  onPick: (id: string) => void
}) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading stores…</div>
  if (stores.length === 0) return <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>no stores</div>
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

function FilterBar({ filter, onFilter, hooks }: {
  filter: StatusFilter; onFilter: (f: StatusFilter) => void; hooks: HookRowFull[] | null
}) {
  const counts = {
    all: hooks?.length ?? 0,
    draft: hooks?.filter((h) => h.status === 'draft').length ?? 0,
    approved: hooks?.filter((h) => h.status === 'approved').length ?? 0,
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['all', 'draft', 'approved'] as const).map((f) => {
        const on = filter === f
        return (
          <button
            key={f}
            onClick={() => onFilter(f)}
            style={{
              background: on ? T.surfaceRaised : 'transparent',
              border: `1px solid ${on ? T.accent : T.border}`,
              color: on ? T.accent : T.textMuted,
              padding: '6px 14px', borderRadius: 4,
              fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
            }}
          >{f} ({counts[f]})</button>
        )
      })}
    </div>
  )
}

function NewHookForm({ icpId, outcomes, onCreated }: {
  icpId: string; outcomes: OutcomeRowFull[] | null; onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [outcomeId, setOutcomeId] = useState('')
  const [approveOnCreate, setApproveOnCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => { setText(''); setOutcomeId(''); setApproveOnCreate(false); setErr(null) }
  const valid = text.trim() && outcomeId

  const create = async () => {
    const token = getToken(); if (!token || !valid) return
    setBusy(true); setErr(null)
    try {
      await api.createHook(icpId, { text, outcomeId, approve: approveOnCreate }, token)
      reset(); setOpen(false); onCreated()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={primaryBtn(true, false)}>+ new hook</button>
    )
  }

  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: 4, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={labelStyle}>outcome</label>
        <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} style={inputStyle}>
          <option value="" disabled>— pick an outcome —</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.title} (v{o.version})</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={labelStyle}>hook text</label>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="hook"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: T.mono, color: T.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={approveOnCreate} onChange={(e) => setApproveOnCreate(e.target.checked)} />
        approve immediately (skip draft step)
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={create} disabled={busy || !valid} style={primaryBtn(!!valid, busy)}>
          {busy ? 'creating…' : approveOnCreate ? 'create approved' : 'create draft'}
        </button>
        <button onClick={() => { reset(); setOpen(false) }} disabled={busy} style={ghostBtn}>cancel</button>
        {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>
    </div>
  )
}

function OutcomeGroup({ outcome, hooks, onChanged }: {
  outcome: { id: string; title: string; version: number }
  hooks: HookRowFull[]
  onChanged: () => void
}) {
  return (
    <div>
      <div style={{
        fontSize: 11, color: T.accentMuted, fontFamily: T.mono,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.borderSubtle}`,
      }}>
        {outcome.title} <span style={{ color: T.textDim }}>v{outcome.version} · {hooks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hooks.map((h) => <HookRow key={h.id} hook={h} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

function HookRow({ hook, onChanged }: { hook: HookRowFull; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(hook.text)
  const [busy, setBusy] = useState<'save' | 'approve' | 'delete' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const approved = hook.status === 'approved'

  useEffect(() => { setDraft(hook.text); setErr(null) }, [hook.text])

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy('save'); setErr(null)
    try {
      await api.updateHook(hook.id, { text: draft }, token)
      setEditing(false); onChanged()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const approve = async () => {
    const token = getToken(); if (!token) return
    if (!confirm('Approve this hook? Approval locks the text — further edits require a new hook.')) return
    setBusy('approve'); setErr(null)
    try { await api.approveHook(hook.id, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const remove = async () => {
    const token = getToken(); if (!token) return
    if (!confirm('Delete this draft hook?')) return
    setBusy('delete'); setErr(null)
    try { await api.deleteHook(hook.id, token); onChanged() }
    catch (e: any) { setErr(e.message); setBusy(null) }
  }

  return (
    <div style={{
      background: approved ? T.surface : T.surfaceRaised,
      border: `1px solid ${approved ? T.borderSubtle : T.border}`,
      borderRadius: 4, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing && !approved ? (
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              autoFocus
            />
          ) : (
            <div style={{
              fontFamily: T.sans, fontSize: 13, color: T.text,
              lineHeight: 1.55, whiteSpace: 'pre-wrap',
            }}>{hook.text}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{
            fontSize: 10, fontFamily: T.mono,
            color: approved ? T.success : T.accentMuted,
            border: `1px solid ${approved ? T.success : T.accentMuted}`,
            borderRadius: 3, padding: '2px 8px',
          }}>{approved ? '✓ approved' : 'draft'}</span>
          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim }}>
            {approved && hook.approvedAt
              ? `approved ${new Date(hook.approvedAt).toLocaleDateString()}`
              : `created ${new Date(hook.createdAt).toLocaleDateString()}`}
          </span>
        </div>
      </div>
      {!approved && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {editing ? (
            <>
              <button onClick={save} disabled={busy === 'save' || !draft.trim() || draft === hook.text} style={primaryBtn(draft.trim() !== '' && draft !== hook.text, busy === 'save')}>
                {busy === 'save' ? 'saving…' : 'save'}
              </button>
              <button onClick={() => { setEditing(false); setDraft(hook.text) }} disabled={busy === 'save'} style={ghostBtn}>cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} style={ghostBtn}>edit</button>
              <button onClick={approve} disabled={busy === 'approve'} style={primaryBtn(true, busy === 'approve')}>
                {busy === 'approve' ? '…' : 'approve'}
              </button>
              <button onClick={remove} disabled={busy === 'delete'} style={dangerGhostBtn}>delete</button>
            </>
          )}
          {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono, alignSelf: 'center' }}>{err}</span>}
        </div>
      )}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 11, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn, borderColor: T.danger, color: T.danger,
}
