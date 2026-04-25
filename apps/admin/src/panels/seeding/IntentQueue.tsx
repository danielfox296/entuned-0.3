import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SubmissionListRow, StoreSummary, OutcomeRowFull, EnoRunResult, SubmissionStatus } from '../../api.js'
import { T } from '../../tokens.js'
import { IntentDetail } from './IntentDetail.js'

const FILTERS: { key: string; label: string; status?: SubmissionStatus; claimedBy?: string }[] = [
  { key: 'pending', label: 'pending', status: 'queued', claimedBy: 'unclaimed' },
  { key: 'mine', label: 'in progress (mine)', status: 'queued', claimedBy: 'me' },
  { key: 'all_queued', label: 'all queued', status: 'queued' },
  { key: 'accepted', label: 'accepted', status: 'accepted' },
  { key: 'abandoned', label: 'abandoned', status: 'abandoned' },
  { key: 'skipped', label: 'skipped', status: 'skipped' },
  { key: 'failed', label: 'failed', status: 'failed' },
]

export function IntentQueue() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [icpId, setIcpId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('pending')
  const [submissions, setSubmissions] = useState<SubmissionListRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<EnoRunResult | null>(null)
  const [runOutcome, setRunOutcome] = useState<string>('')
  const [runN, setRunN] = useState(1)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId || !stores) { setIcpId(null); return }
    const s = stores.find((x) => x.id === storeId)
    setIcpId(s?.icpId ?? null)
  }, [storeId, stores])

  const reload = async () => {
    if (!icpId) { setSubmissions(null); return }
    const token = getToken(); if (!token) return
    const f = FILTERS.find((x) => x.key === filter)
    try {
      setSubmissions(await api.submissions(token, {
        icpId, status: f?.status, claimedBy: f?.claimedBy, limit: 100,
      }))
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { reload() }, [icpId, filter])

  const launch = async () => {
    const token = getToken(); if (!token || !icpId || !runOutcome) return
    if (!confirm(`Run Eno: generate ${runN} submission(s) for this ICP + outcome? Calls Anthropic and persists Submissions.`)) return
    setRunning(true); setRunResult(null); setErr(null)
    try {
      const result = await api.runEno({ icpId, outcomeId: runOutcome, n: runN }, token)
      setRunResult(result)
      reload()
    } catch (e: any) { setErr(e.message) }
    finally { setRunning(false) }
  }

  if (openId) {
    return <IntentDetail submissionId={openId} onClose={() => { setOpenId(null); reload() }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Intent Queue</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Generate Submissions, claim them, paste prompts into Suno, seed accepted takes.
        </div>
      </div>

      <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {icpId && (
        <Section title="Run Eno" subtitle="Generate new submissions for this ICP + outcome">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={runOutcome} onChange={(e) => setRunOutcome(e.target.value)} style={inputStyle}>
              <option value="" disabled>— pick outcome —</option>
              {(outcomes ?? []).map((o) => <option key={o.id} value={o.id}>{o.title} (v{o.version})</option>)}
            </select>
            <input type="number" min={1} max={20} value={runN} onChange={(e) => setRunN(parseInt(e.target.value, 10) || 1)} style={{ ...inputStyle, width: 80 }} />
            <button onClick={launch} disabled={running || !runOutcome} style={primaryBtn(!!runOutcome, running)}>
              {running ? 'running…' : `run (${runN})`}
            </button>
          </div>
          {runResult && (
            <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
              produced {runResult.producedN}/{runResult.requestedN} · {runResult.reason}
              {runResult.errors.length > 0 && (
                <div style={{ color: T.danger, marginTop: 4 }}>
                  errors: {runResult.errors.join('; ')}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {icpId && (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => {
              const on = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    background: on ? T.surfaceRaised : 'transparent',
                    border: `1px solid ${on ? T.accent : T.border}`,
                    color: on ? T.accent : T.textMuted,
                    padding: '6px 12px', borderRadius: 4,
                    fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
                  }}
                >{f.label}</button>
              )
            })}
            <button onClick={reload} style={ghostBtn}>refresh</button>
          </div>

          {!submissions && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

          {submissions && submissions.length === 0 && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12, padding: '12px 0' }}>
              no submissions match
            </div>
          )}

          {submissions && submissions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {submissions.map((s) => <SubmissionRow key={s.id} sub={s} onOpen={() => setOpenId(s.id)} />)}
            </div>
          )}
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
        style={{ ...inputStyle, minWidth: 320 }}
      >
        <option value="" disabled>— pick a store —</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>
        ))}
      </select>
    </div>
  )
}

function SubmissionRow({ sub, onOpen }: { sub: SubmissionListRow; onOpen: () => void }) {
  const statusColor = statusColorOf(sub.status)
  return (
    <div
      onClick={onOpen}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '90px 1fr 1fr 110px', gap: 14, alignItems: 'center',
      }}
    >
      <span style={{
        fontSize: 10, fontFamily: T.mono, color: statusColor,
        border: `1px solid ${statusColor}`, borderRadius: 3, padding: '2px 8px', textAlign: 'center',
      }}>{sub.status}{sub.claimedById ? ' · claimed' : ''}</span>
      <span style={{ fontSize: 12, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sub.title ?? sub.hook.text}
      </span>
      <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sub.outcome.title} · {sub.referenceTrack ? `${sub.referenceTrack.artist} — ${sub.referenceTrack.title}` : 'no ref'}
      </span>
      <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, textAlign: 'right' }}>
        {new Date(sub.createdAt).toLocaleString()}
      </span>
    </div>
  )
}

function statusColorOf(s: SubmissionStatus): string {
  switch (s) {
    case 'queued': return T.warn
    case 'accepted': return T.success
    case 'abandoned': return T.textDim
    case 'skipped': return T.textDim
    case 'failed': return T.danger
    case 'assembling': return T.accentMuted
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 4, outline: 'none',
  boxSizing: 'border-box',
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
