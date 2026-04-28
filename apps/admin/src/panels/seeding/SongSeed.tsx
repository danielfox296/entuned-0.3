import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { SongSeedDetail, StyleExclusionRuleRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Textarea, Section, S } from '../../ui/index.js'

export function SongSeed({ songSeedId, onClose }: { songSeedId: string; onClose: () => void }) {
  const [data, setData] = useState<SongSeedDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [takes, setTakes] = useState<{ sourceUrl: string }[]>([{ sourceUrl: '' }, { sourceUrl: '' }])
  const [accepted, setAccepted] = useState(false)
  const [exclusionRules, setExclusionRules] = useState<StyleExclusionRuleRow[] | null>(null)
  const [showFiredRules, setShowFiredRules] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try { setData(await api.songSeedDetail(songSeedId, token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }

  useEffect(() => { load() }, [songSeedId])
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.styleExclusionRules(token).then(setExclusionRules).catch(() => { /* non-fatal */ })
  }, [])

  const del = async () => {
    const token = getToken(); if (!token) return
    if (!confirm('Delete this Song Prompt? This cannot be undone.')) return
    setBusy('delete'); setErr(null)
    try {
      await api.deleteSongSeed(songSeedId, token)
      onClose()
    } catch (e: any) { setErr(e.message); setBusy(null) }
  }

  const accept = async () => {
    const token = getToken(); if (!token) return
    const validTakes = takes.filter((t) => t.sourceUrl.trim())
    if (validTakes.length === 0) { setErr('Add at least one source URL.'); return }
    setBusy('accept'); setErr(null); setAccepted(false)
    try {
      await api.acceptSongSeed(songSeedId, { takes: validTakes }, token)
      setAccepted(true)
      await load()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
  }

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }

  if (!data) {
    return (
      <div>
        <Button variant="ghost" onClick={onClose}>← back</Button>
        {err
          ? <div style={{ marginTop: 12, color: T.danger, fontFamily: T.sans }}>{err}</div>
          : <div style={{ marginTop: 12, color: T.textMuted, fontFamily: T.sans }}>loading…</div>}
      </div>
    )
  }

  const isQueued = data.status === 'queued'
  const statusColor = statusColorOf(data.status)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={onClose}>← back</Button>
        <span style={{ fontSize: S.subhead, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>
          {data.title ?? data.hook.text}
        </span>
        <span style={{
          fontSize: S.label, fontFamily: T.sans,
          color: statusColor,
          border: `1px solid ${statusColor}`, borderRadius: S.r3, padding: '2px 8px',
        }}>{data.status}</span>
        {isQueued && (
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="danger" onClick={del} busy={busy === 'delete'}>
              delete
            </Button>
          </div>
        )}
      </div>

      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      <Section title="Song Prompt" subtitle="Copy these into Suno (style → Style; lyrics → Lyrics; vocal_gender → Persona/Gender; negative → Exclude Styles)">
        <CopyBlock label="Style" value={data.style ?? ''} onCopy={() => copyToClipboard(data.style ?? '')} />
        <CopyBlock label="Style exclusion" value={data.negativeStyle ?? ''} onCopy={() => copyToClipboard(data.negativeStyle ?? '')} />
        <CopyBlock label="Vocal gender" value={data.vocalGender ?? ''} onCopy={() => copyToClipboard(data.vocalGender ?? '')} short />
        <CopyBlock label="Title" value={data.title ?? ''} onCopy={() => copyToClipboard(data.title ?? '')} short />
        <CopyBlock label="Lyrics" value={data.lyrics ?? ''} onCopy={() => copyToClipboard(data.lyrics ?? '')} tall />
        {data.firedExclusionRuleIds.length > 0 && (
          <div style={{ fontSize: S.label, fontFamily: T.sans, color: T.textDim, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowFiredRules((v) => !v)}
              style={{
                background: 'transparent', border: 'none', color: T.textDim,
                fontFamily: T.sans, fontSize: S.label, cursor: 'pointer', padding: 0,
                textDecoration: 'underline dotted', textUnderlineOffset: 3,
              }}
            >
              {showFiredRules ? '▾' : '▸'} fired {data.firedExclusionRuleIds.length} exclusion rule(s)
            </button>
            {showFiredRules && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 14 }}>
                {data.firedExclusionRuleIds.map((rid) => {
                  const rule = exclusionRules?.find((r) => r.id === rid)
                  if (!rule) return (
                    <div key={rid} style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
                      {rid} <span style={{ fontStyle: 'italic' }}>(rule no longer exists)</span>
                    </div>
                  )
                  return (
                    <div key={rid} style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
                      <span style={{ color: T.accentMuted }}>{rule.triggerField}={rule.triggerValue}</span>
                      <span style={{ color: T.textDim }}> → exclude </span>
                      <span style={{ color: T.text }}>{rule.exclude}</span>
                      {rule.note && <span style={{ color: T.textDim, fontStyle: 'italic' }}> · {rule.note}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Section>

      {isQueued && (
        <Section title="Accept takes" subtitle="Paste the Suno source URL(s). The server downloads and re-hosts the audio.">
          {takes.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Input
                value={t.sourceUrl}
                onChange={(e) => setTakes(takes.map((x, j) => j === i ? { sourceUrl: e.target.value } : x))}
                placeholder={`take ${i + 1} — https://suno.com/s/... or https://suno.com/song/...`}
              />
            </div>
          ))}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              onClick={accept}
              disabled={takes.every((t) => !t.sourceUrl.trim())}
              busy={busy === 'accept'}
            >
              {busy === 'accept' ? 'downloading + uploading…' : 'accept'}
            </Button>
            {accepted && (
              <span style={{ fontSize: S.small, fontFamily: T.sans, color: T.success }}>
                ✓ takes received — Song Entries created
              </span>
            )}
          </div>
        </Section>
      )}

      {data.lineageRows && data.lineageRows.length > 0 && (
        <Section title="Song Entries">
          {data.lineageRows.map((r: any) => (
            <div key={r.id} style={{ fontSize: S.small, fontFamily: T.sans, color: T.textMuted, padding: '4px 0' }}>
              entry {r.id.slice(0, 8)}{r.active ? '' : ' (retired)'}
            </div>
          ))}
        </Section>
      )}

      {data.errorText && (
        <Section title="Error">
          <div style={{ fontSize: S.small, fontFamily: T.sans, color: T.danger, whiteSpace: 'pre-wrap' }}>
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
        <label style={{
          fontSize: S.label, color: T.textDim, fontFamily: T.sans,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{label}</label>
        <Button variant="tiny" onClick={onCopy}>copy</Button>
      </div>
      <Textarea
        readOnly
        value={value}
        rows={short ? 1 : tall ? 12 : 4}
        style={{ background: T.bg, fontFamily: T.mono } as CSSProperties}
      />
    </div>
  )
}

function statusColorOf(s: string): string {
  switch (s) {
    case 'queued': return T.warn
    case 'accepted': return T.success
    case 'failed': return T.danger
    case 'assembling': return T.accentMuted
    default: return T.text
  }
}
