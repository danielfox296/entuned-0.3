import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary, StoreDetail, OutcomeRowFull, HookRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { PanelHeader, StorePicker as UIStorePicker, S } from '../../ui/index.js'

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
      return d.icp ? api.icpHooks(d.icp.id, token) : null
    }).then((h) => h && setHooks(h)).catch((e) => setErr(e.message))
  }, [storeId])

  const reloadHooks = async () => {
    if (!detail?.icp) return
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Hook Queue"
        subtitle="Per-ICP hooks grouped by Outcome. Drafts editable; approved hooks immutable."
      />

      <UIStorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {err && <div style={{ fontSize: 12, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {storeId && !detail && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {detail && (
        <>
          {detail.sharedWith.length > 0 && (
            <div style={{
              background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
              borderRadius: 4, padding: '10px 14px', fontFamily: T.mono, fontSize: 12, color: T.text,
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
              {detail.icp && <NewHookForm icpId={detail.icp.id} outcomes={outcomes} onCreated={reloadHooks} />}
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
              fontFamily: T.mono, fontSize: 12, cursor: 'pointer',
            }}
          >{f} ({counts[f]})</button>
        )
      })}
    </div>
  )
}

type NewMode = 'closed' | 'single' | 'bulk' | 'draft'

function NewHookForm({ icpId, outcomes, onCreated }: {
  icpId: string; outcomes: OutcomeRowFull[] | null; onCreated: () => void
}) {
  const [mode, setMode] = useState<NewMode>('closed')
  const [outcomeId, setOutcomeId] = useState('')
  const [approveOnCreate, setApproveOnCreate] = useState(false)
  const [singleText, setSingleText] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [draftN, setDraftN] = useState(8)
  const [draftCandidates, setDraftCandidates] = useState<{ text: string; selected: boolean }[]>([])
  const [busy, setBusy] = useState<'create' | 'bulk' | 'draft' | 'commit' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => {
    setMode('closed')
    setOutcomeId('')
    setApproveOnCreate(false)
    setSingleText('')
    setBulkText('')
    setDraftCandidates([])
    setErr(null)
  }

  const createSingle = async () => {
    const token = getToken(); if (!token || !singleText.trim() || !outcomeId) return
    setBusy('create'); setErr(null)
    try {
      await api.createHook(icpId, { text: singleText, outcomeId, approve: approveOnCreate }, token)
      reset(); onCreated()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const createBulk = async () => {
    const token = getToken(); if (!token) return
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0 || !outcomeId) { setErr('paste at least one line and pick an outcome'); return }
    setBusy('bulk'); setErr(null)
    try {
      const result = await api.bulkCreateHooks(icpId, { outcomeId, texts: lines, approve: approveOnCreate }, token)
      reset(); onCreated()
      alert(`created ${result.created} hook${result.created === 1 ? '' : 's'}`)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const runDrafter = async () => {
    const token = getToken(); if (!token || !outcomeId) return
    setBusy('draft'); setErr(null); setDraftCandidates([])
    try {
      const result = await api.draftHooks(icpId, { outcomeId, n: draftN }, token)
      setDraftCandidates(result.hooks.map((text) => ({ text, selected: true })))
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const commitDrafts = async () => {
    const token = getToken(); if (!token || !outcomeId) return
    const picks = draftCandidates.filter((c) => c.selected).map((c) => c.text)
    if (picks.length === 0) { setErr('select at least one candidate'); return }
    setBusy('commit'); setErr(null)
    try {
      const result = await api.bulkCreateHooks(icpId, { outcomeId, texts: picks, approve: approveOnCreate }, token)
      reset(); onCreated()
      alert(`created ${result.created} hook${result.created === 1 ? '' : 's'}`)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  if (mode === 'closed') {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setMode('single')} style={primaryBtn(true, false)}>+ new hook</button>
        <button onClick={() => setMode('bulk')} style={ghostBtn}>bulk paste</button>
        <button onClick={() => setMode('draft')} style={ghostBtn}>draft with AI</button>
      </div>
    )
  }

  return (
    <div style={{
      background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
      borderRadius: 4, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['single', 'bulk', 'draft'] as const).map((m) => {
          const on = mode === m
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: on ? T.surfaceRaised : 'transparent',
                border: `1px solid ${on ? T.accent : T.border}`,
                color: on ? T.accent : T.textMuted,
                padding: '5px 12px', borderRadius: 4,
                fontFamily: T.mono, fontSize: 12, cursor: 'pointer',
              }}
            >{m}</button>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={labelStyle}>outcome</label>
        <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} style={inputStyle}>
          <option value="" disabled>— pick an outcome —</option>
          {(outcomes ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.title} (v{o.version})</option>
          ))}
        </select>
      </div>

      {mode === 'single' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>hook text</label>
          <textarea
            rows={3}
            value={singleText}
            onChange={(e) => setSingleText(e.target.value)}
            placeholder="hook"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      )}

      {mode === 'bulk' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>hook lines (one per line)</label>
          <textarea
            rows={10}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'hook one\nhook two\nhook three'}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
            {bulkText.split('\n').map((l) => l.trim()).filter(Boolean).length} non-empty line(s)
          </span>
        </div>
      )}

      {mode === 'draft' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={labelStyle}>n</label>
            <input
              type="number" min={1} max={20} value={draftN}
              onChange={(e) => setDraftN(parseInt(e.target.value, 10) || 1)}
              style={{ ...inputStyle, width: 80 }}
            />
            <button onClick={runDrafter} disabled={busy !== null || !outcomeId} style={primaryBtn(!!outcomeId, busy === 'draft')}>
              {busy === 'draft' ? 'drafting…' : 'draft hooks'}
            </button>
          </div>
          {draftCandidates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontFamily: T.mono, color: T.textMuted }}>
                  {draftCandidates.filter((c) => c.selected).length}/{draftCandidates.length} selected
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setDraftCandidates(draftCandidates.map((c) => ({ ...c, selected: true })))} style={ghostBtn}>all</button>
                  <button onClick={() => setDraftCandidates(draftCandidates.map((c) => ({ ...c, selected: false })))} style={ghostBtn}>none</button>
                </div>
              </div>
              {draftCandidates.map((c, i) => (
                <label key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px',
                  background: c.selected ? T.surfaceRaised : 'transparent',
                  border: `1px solid ${c.selected ? T.accentMuted : T.border}`,
                  borderRadius: 3, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={c.selected}
                    onChange={(e) => setDraftCandidates(draftCandidates.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                    style={{ marginTop: 3 }}
                  />
                  <input
                    value={c.text}
                    onChange={(e) => setDraftCandidates(draftCandidates.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </label>
              ))}
            </div>
          )}
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: T.mono, color: T.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={approveOnCreate} onChange={(e) => setApproveOnCreate(e.target.checked)} />
        approve immediately (skip draft step)
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {mode === 'single' && (
          <button onClick={createSingle} disabled={busy !== null || !singleText.trim() || !outcomeId} style={primaryBtn(!!singleText.trim() && !!outcomeId, busy === 'create')}>
            {busy === 'create' ? 'creating…' : approveOnCreate ? 'create approved' : 'create draft'}
          </button>
        )}
        {mode === 'bulk' && (
          <button onClick={createBulk} disabled={busy !== null} style={primaryBtn(true, busy === 'bulk')}>
            {busy === 'bulk' ? 'creating…' : `create ${approveOnCreate ? 'approved' : 'drafts'}`}
          </button>
        )}
        {mode === 'draft' && draftCandidates.length > 0 && (
          <button onClick={commitDrafts} disabled={busy !== null} style={primaryBtn(true, busy === 'commit')}>
            {busy === 'commit' ? 'creating…' : `create selected ${approveOnCreate ? '(approved)' : '(drafts)'}`}
          </button>
        )}
        <button onClick={reset} disabled={busy !== null} style={ghostBtn}>cancel</button>
        {err && <span style={{ fontSize: 12, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>

      {mode === 'draft' && <DrafterPromptEditor icpId={icpId} />}
    </div>
  )
}

function DrafterPromptEditor({ icpId }: { icpId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [version, setVersion] = useState<number>(1)
  const [history, setHistory] = useState<{ id: string; version: number; promptText: string; notes: string | null; createdAt: string }[]>([])
  const [notes, setNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.hookWriterPrompt(icpId, token)
      setText(r.latest.promptText); setOriginal(r.latest.promptText)
      setVersion(r.latest.version); setHistory(r.history); setLoaded(true)
    } catch (e: any) { setErr(e.message) }
  }

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try {
      const r = await api.saveHookWriterPrompt(icpId, text, notes || null, token)
      setOriginal(text); setVersion(r.version); setNotes('')
      // Refresh history.
      const re = await api.hookWriterPrompt(icpId, token)
      setHistory(re.history)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.borderSubtle}` }}>
      <button onClick={() => { if (!open && !loaded) load(); setOpen(!open) }} style={ghostBtn}>
        {open ? '▾ drafter prompt' : '▸ drafter prompt'}{loaded && <span style={{ color: T.accentMuted, marginLeft: 6 }}>v{version}</span>}
      </button>
      {open && loaded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
          <input
            placeholder="version notes (optional — what changed and why)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={save} disabled={busy || text === original} style={primaryBtn(text !== original, busy)}>
              {busy ? 'saving…' : `save as v${version + 1}`}
            </button>
            <button onClick={() => setShowHistory(!showHistory)} style={ghostBtn}>
              {showHistory ? '▾ history' : `▸ history (${history.length})`}
            </button>
            {err && <span style={{ fontSize: 12, color: T.danger, fontFamily: T.mono }}>{err}</span>}
          </div>
          {showHistory && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {history.map((h) => (
                <div key={h.id} style={{
                  border: `1px solid ${T.borderSubtle}`, borderRadius: 3,
                  background: T.surfaceRaised, padding: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent }}>v{h.version}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
                      {new Date(h.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                    </span>
                    {h.notes && <span style={{ fontFamily: T.sans, fontSize: 12, color: T.textMuted }}>{h.notes}</span>}
                    <button
                      onClick={() => setText(h.promptText)}
                      style={{ ...ghostBtn, marginLeft: 'auto', fontSize: 10 }}
                    >load into editor</button>
                  </div>
                </div>
              ))}
              {history.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>no history yet</div>}
            </div>
          )}
        </div>
      )}
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
        fontSize: 12, color: T.accentMuted, fontFamily: T.mono,
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
  const [busy, setBusy] = useState<'save' | 'approve' | 'delete' | 'retire' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const approved = hook.status === 'approved'
  const retired = hook.status === 'retired'

  const retire = async () => {
    const token = getToken(); if (!token) return
    setBusy('retire'); setErr(null)
    try {
      const preview = await api.retireHookPreview(hook.id, token)
      await api.retireHook(hook.id, preview.inFlightSongSeeds > 0, token)
      onChanged()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

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
    setBusy('approve'); setErr(null)
    try { await api.approveHook(hook.id, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const remove = async () => {
    const token = getToken(); if (!token) return
    setBusy('delete'); setErr(null)
    try { await api.deleteHook(hook.id, token); onChanged() }
    catch (e: any) { setErr(e.message); setBusy(null) }
  }

  return (
    <div style={{
      background: retired ? T.surface : approved ? T.surface : T.surfaceRaised,
      border: `1px solid ${retired ? T.borderSubtle : approved ? T.borderSubtle : T.border}`,
      borderRadius: 4, padding: 12,
      opacity: retired ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing && !approved && !retired ? (
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
              textDecoration: retired ? 'line-through' : 'none',
            }}>{hook.text}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{
            fontSize: 11, fontFamily: T.mono,
            color: retired ? T.textDim : approved ? T.success : T.accentMuted,
            border: `1px solid ${retired ? T.textDim : approved ? T.success : T.accentMuted}`,
            borderRadius: 3, padding: '2px 8px',
          }}>{retired ? 'retired' : approved ? '✓ approved' : 'draft'}</span>
          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
            {approved && hook.approvedAt
              ? `approved ${new Date(hook.approvedAt).toLocaleDateString()}`
              : `created ${new Date(hook.createdAt).toLocaleDateString()}`}
          </span>
        </div>
      </div>
      {!retired && !approved && (
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
          {err && <span style={{ fontSize: 12, color: T.danger, fontFamily: T.mono, alignSelf: 'center' }}>{err}</span>}
        </div>
      )}
      {!retired && approved && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={retire} disabled={busy === 'retire'} style={dangerGhostBtn}>
            {busy === 'retire' ? '…' : 'retire'}
          </button>
          {err && <span style={{ fontSize: 12, color: T.danger, fontFamily: T.mono, alignSelf: 'center' }}>{err}</span>}
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
  fontSize: 11, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 12, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
}

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn, borderColor: T.danger, color: T.danger,
}
