import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SongSeedRow, OutcomeRowFull, SeedBuilderResult } from '../../api.js'
import { T } from '../../tokens.js'
import { S } from '../../ui/index.js'
import { SongSeed } from './SongSeed.js'
import type { WorkflowContext } from '../workflow/WorkflowRouter.js'


export function SongSeedQueue({ ctx }: { ctx: WorkflowContext }) {
  const { storeId, store, icpId } = ctx
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [songSeeds, setSongSeeds] = useState<SongSeedRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<SeedBuilderResult | null>(null)
  const [runOutcome, setRunOutcome] = useState<string>('')
  const [runN, setRunN] = useState(1)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  const storeIcps = store?.icps ?? []
  const selectedIcp = icpId ? storeIcps.find((i) => i.id === icpId) ?? null : null

  const reload = async () => {
    if (!icpId) { setSongSeeds(null); return }
    const token = getToken(); if (!token) return
    try {
      const rows = await api.songSeeds(token, { icpId, status: 'queued', limit: 100 })
      setSongSeeds(rows)
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { reload() }, [icpId])

  const launch = async () => {
    const token = getToken(); if (!token || !icpId || !runOutcome) return
    setRunning(true); setRunResult(null); setErr(null)
    try {
      const result = await api.runSeedBuilder({ icpId, outcomeId: runOutcome, n: runN }, token)
      setRunResult(result)
      reload()
    } catch (e: any) { setErr(e.message) }
    finally { setRunning(false) }
  }

  if (openId) {
    return <SongSeed songSeedId={openId} onClose={() => { setOpenId(null); reload() }} />
  }

  if (!storeId) {
    return (
      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '14px 18px', color: T.textMuted,
        fontFamily: T.sans, fontSize: 14,
      }}>
        select a store and ICP above to begin
      </div>
    )
  }

  if (storeIcps.length === 0) {
    return (
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 14 }}>
        this store has no ICPs yet — create one in the ICP Editor first
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {icpId && (
        <Section title="Create Song Prompt" subtitle="Generate Song Prompts for the selected ICP and Outcome. Each Song Prompt is permanently bound to one ICP.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: T.mono, fontSize: 13, color: T.accent,
              border: `1px solid ${T.accentMuted}`, borderRadius: 3, padding: '6px 10px',
            }}>
              ICP: {selectedIcp?.name ?? icpId.slice(0, 8)}
            </span>
            <span style={{ color: T.textDim, fontFamily: T.mono }}>+</span>
            <select value={runOutcome} onChange={(e) => setRunOutcome(e.target.value)} style={inputStyle}>
              <option value="" disabled>— pick outcome —</option>
              {(outcomes ?? []).map((o) => <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>)}
            </select>
            <input type="number" min={1} max={20} value={runN} onChange={(e) => setRunN(parseInt(e.target.value, 10) || 1)} style={{ ...inputStyle, width: 80 }} />
            <button onClick={launch} disabled={running || !runOutcome} style={primaryBtn(!!runOutcome, running)}>
              {running ? 'running…' : `run (${runN})`}
            </button>
          </div>
          {runResult && (
            <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 14, color: T.textMuted }}>
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

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {icpId && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={reload} style={ghostBtn}>refresh</button>
          </div>

          {!songSeeds && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

          {songSeeds && songSeeds.length === 0 && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 14, padding: '12px 0' }}>
              No Song Prompts
            </div>
          )}

          {songSeeds && songSeeds.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {songSeeds.map((s) => <SeedListRow key={s.id} sub={s} onOpen={() => setOpenId(s.id)} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SeedListRow({ sub, onOpen }: { sub: SongSeedRow; onOpen: () => void }) {
  const ref = sub.referenceTrack
  return (
    <div
      onClick={onOpen}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '10px 14px', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'center',
      }}
    >
      {/* Left: title */}
      <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sub.title ?? sub.hook.text}
      </span>

      {/* Middle: album art for decomposed inspiration reference track */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
        {ref?.coverUrl ? (
          <img
            src={ref.coverUrl}
            alt={`${ref.artist} — ${ref.title}`}
            title={`${ref.artist} — ${ref.title}`}
            style={{
              width: 40, height: 40, borderRadius: 3, objectFit: 'cover',
              border: `1px solid ${T.borderSubtle}`, display: 'block',
            }}
          />
        ) : (
          <div
            title={ref ? `${ref.artist} — ${ref.title}` : 'no reference track'}
            style={{
              width: 40, height: 40, borderRadius: 3,
              background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: T.mono, fontSize: 10, color: T.textDim,
            }}
          >{ref ? '♪' : '—'}</div>
        )}
        <span style={{
          fontSize: 12, fontFamily: T.mono, color: T.textDim,
          maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ref ? `${ref.artist} — ${ref.title}` : 'no ref'}
        </span>
      </div>

      {/* Right: outcome */}
      <span style={{
        fontSize: 13, fontFamily: T.mono, color: T.textMuted, textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {sub.outcome.displayTitle ?? sub.outcome.title}
      </span>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontFamily: T.sans, fontWeight: 500, color: T.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 14, padding: '7px 10px', borderRadius: 4, outline: 'none',
  boxSizing: 'border-box',
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 14, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}
