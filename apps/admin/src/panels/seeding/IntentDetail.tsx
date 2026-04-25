import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SubmissionDetail } from '../../api.js'
import { T } from '../../tokens.js'

export function IntentDetail({ submissionId, onClose }: { submissionId: string; onClose: () => void }) {
  const [data, setData] = useState<SubmissionDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [takes, setTakes] = useState<{ r2Url: string }[]>([{ r2Url: '' }])

  const load = async () => {
    const token = getToken(); if (!token) return
    try { setData(await api.submissionDetail(submissionId, token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { load() }, [submissionId])

  const action = async (label: string, fn: () => Promise<unknown>) => {
    if (!confirm(`${label}?`)) return
    setBusy(label); setErr(null)
    try { await fn(); await load() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const accept = async () => {
    const token = getToken(); if (!token) return
    const validTakes = takes.filter((t) => t.r2Url.trim())
    if (validTakes.length === 0) { alert('Add at least one r2 URL.'); return }
    if (!confirm(`Accept submission with ${validTakes.length} take(s)? Creates Song(s) + LineageRow(s) and finalizes the hook.`)) return
    setBusy('accept'); setErr(null)
    try {
      await api.acceptSubmission(submissionId, { takes: validTakes }, token)
      await load()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  if (!data) {
    return (
      <div>
        <button onClick={onClose} style={ghostBtn}>← back</button>
        {err ? <div style={{ marginTop: 12, color: T.danger, fontFamily: T.mono }}>{err}</div> : <div style={{ marginTop: 12, color: T.textMuted, fontFamily: T.mono }}>loading…</div>}
      </div>
    )
  }

  const isQueued = data.status === 'queued'
  const isClaimedByMe = data.claimedById != null // server enforces "me" via /claim semantics

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={ghostBtn}>← back</button>
        <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>
          {data.title ?? data.hook.text}
        </span>
        <span style={{
          fontSize: 10, fontFamily: T.mono,
          color: statusColorOf(data.status),
          border: `1px solid ${statusColorOf(data.status)}`, borderRadius: 3, padding: '2px 8px',
        }}>{data.status}</span>
      </div>

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      <Section title="Scope">
        <KV k="ICP" v={data.icpId.slice(0, 8)} />
        <KV k="Outcome" v={`${data.outcome?.title ?? '—'} v${data.outcome?.version ?? '—'}`} />
        <KV k="Hook" v={data.hook.text} mono={false} />
        <KV k="Reference track" v={data.referenceTrack ? `${data.referenceTrack.artist} — ${data.referenceTrack.title}${data.referenceTrack.year ? ` (${data.referenceTrack.year})` : ''}` : '—'} />
        <KV k="Eno run" v={`${data.enoRun?.id?.slice(0, 8)} · ${data.enoRun?.triggeredBy} · ${data.enoRun ? new Date(data.enoRun.startedAt).toLocaleString() : ''}`} />
        <KV k="Provenance" v={`prepend v${data.outcomePrependTemplateVersion ?? '—'} · mars v${data.marsPromptVersion ?? '—'} · bernie draft v${data.bernieDraftPromptVersion ?? '—'}`} />
      </Section>

      <Section title="Suno prompt" subtitle="Paste these into Suno (style → Style; lyrics → Lyrics; vocal_gender → Persona/Gender; negative → Exclude Styles)">
        <CopyBlock label="Style" value={data.style ?? ''} onCopy={() => copyToClipboard(data.style ?? '')} />
        <CopyBlock label="Negative style" value={data.negativeStyle ?? ''} onCopy={() => copyToClipboard(data.negativeStyle ?? '')} />
        <CopyBlock label="Vocal gender" value={data.vocalGender ?? ''} onCopy={() => copyToClipboard(data.vocalGender ?? '')} short />
        <CopyBlock label="Title" value={data.title ?? ''} onCopy={() => copyToClipboard(data.title ?? '')} short />
        <CopyBlock label="Lyrics" value={data.lyrics ?? ''} onCopy={() => copyToClipboard(data.lyrics ?? '')} tall />
        {data.firedFailureRuleIds.length > 0 && (
          <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginTop: 8 }}>
            fired {data.firedFailureRuleIds.length} failure rule(s)
          </div>
        )}
      </Section>

      {isQueued && (
        <Section title="Operator actions">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!data.claimedById && (
              <button onClick={() => action('claim', () => api.claimSubmission(submissionId, getToken()!))} disabled={busy !== null} style={primaryBtn(true, busy === 'claim')}>
                {busy === 'claim' ? '…' : 'claim'}
              </button>
            )}
            {isClaimedByMe && (
              <button onClick={() => action('release', () => api.releaseSubmission(submissionId, getToken()!))} disabled={busy !== null} style={ghostBtn}>
                {busy === 'release' ? '…' : 'release'}
              </button>
            )}
            <button onClick={() => action('skip (pre-Suno discard)', () => api.skipSubmission(submissionId, getToken()!))} disabled={busy !== null} style={ghostBtn}>
              skip
            </button>
            <button onClick={() => action('abandon (post-Suno give up)', () => api.abandonSubmission(submissionId, getToken()!))} disabled={busy !== null} style={dangerGhostBtn}>
              abandon
            </button>
          </div>
        </Section>
      )}

      {isQueued && (
        <Section title="Accept takes" subtitle="Paste R2 URL(s) of accepted Suno takes (1–2 per submission). Creates Songs + LineageRows.">
          {takes.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input
                value={t.r2Url}
                onChange={(e) => setTakes(takes.map((x, j) => j === i ? { r2Url: e.target.value } : x))}
                placeholder="https://r2.../song-take-N.mp3"
                style={{ ...inputStyle, flex: 1 }}
              />
              {takes.length > 1 && (
                <button onClick={() => setTakes(takes.filter((_, j) => j !== i))} style={ghostBtn}>×</button>
              )}
            </div>
          ))}
          {takes.length < 2 && (
            <button onClick={() => setTakes([...takes, { r2Url: '' }])} style={ghostBtn}>+ second take</button>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={accept} disabled={busy !== null || takes.every((t) => !t.r2Url.trim())} style={primaryBtn(takes.some((t) => t.r2Url.trim()), busy === 'accept')}>
              {busy === 'accept' ? 'accepting…' : 'accept'}
            </button>
          </div>
        </Section>
      )}

      {data.lineageRows && data.lineageRows.length > 0 && (
        <Section title="Lineage rows">
          {data.lineageRows.map((r: any) => (
            <div key={r.id} style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted, padding: '4px 0' }}>
              {r.r2Url} {r.active ? '' : '(retired)'}
            </div>
          ))}
        </Section>
      )}

      {data.errorText && (
        <Section title="Error">
          <div style={{ fontSize: 11, fontFamily: T.mono, color: T.danger, whiteSpace: 'pre-wrap' }}>
            {data.errorText}
          </div>
        </Section>
      )}
    </div>
  )
}

function CopyBlock({ label, value, onCopy, short, tall }: {
  label: string; value: string; onCopy: () => void; short?: boolean; tall?: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{label}</label>
        <button onClick={onCopy} style={ghostBtn}>copy</button>
      </div>
      <textarea
        readOnly
        value={value}
        rows={short ? 1 : tall ? 12 : 4}
        style={{
          ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.5,
          background: T.bg,
        }}
      />
    </div>
  )
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

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, padding: '4px 0', fontSize: 11 }}>
      <span style={{ color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase', fontSize: 10 }}>{k}</span>
      <span style={{ color: T.text, fontFamily: mono ? T.mono : T.sans }}>{v}</span>
    </div>
  )
}

function statusColorOf(s: string): string {
  switch (s) {
    case 'queued': return T.warn
    case 'accepted': return T.success
    case 'abandoned': return T.textDim
    case 'skipped': return T.textDim
    case 'failed': return T.danger
    case 'assembling': return T.accentMuted
    default: return T.text
  }
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

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn, borderColor: T.danger, color: T.danger,
}
