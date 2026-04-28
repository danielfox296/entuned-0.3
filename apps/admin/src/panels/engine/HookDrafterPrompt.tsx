import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, useToast, useStoreSelection, useIcpSelection } from '../../ui/index.js'

/**
 * Engine surface for editing the Hook Drafter system prompt and previewing
 * exactly what context is sent to Claude. The prompt is stored per-ICP
 * (HookWriterPrompt table). Saves are destructive — no version history,
 * because drafts are cheap to regenerate and not worth audit-trailing.
 */
export function HookDrafterPrompt() {
  const toast = useToast()
  const [storeId] = useStoreSelection()
  const [icpId, setIcpId] = useIcpSelection()

  // Pull the full ICP universe (across clients) so the engine surface is
  // navigable independent of the Workflows store/ICP selector. We still
  // honor that selector as the default starting point.
  const [icpsByClient, setIcpsByClient] = useState<{ clientName: string; icps: { id: string; name: string }[] }[]>([])

  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [outcomeId, setOutcomeId] = useState<string | null>(null)

  const [n, setN] = useState(5)
  const [promptText, setPromptText] = useState<string>('')
  const [savedText, setSavedText] = useState<string>('')
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [saving, setSaving] = useState(false)

  const [systemPreview, setSystemPreview] = useState<string | null>(null)
  const [userPreview, setUserPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const [err, setErr] = useState<string | null>(null)

  // Load outcomes + clients once.
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
    api.clients(token).then(async (cs) => {
      // Hydrate per-client ICP lists. Each clientDetail call is cheap.
      const detailed = await Promise.all(cs.map(async (c) => {
        try {
          const d = await api.clientDetail(c.id, token)
          return { clientName: c.companyName, icps: d.icps.map((i) => ({ id: i.id, name: i.name })) }
        } catch { return { clientName: c.companyName, icps: [] } }
      }))
      setIcpsByClient(detailed.filter((g) => g.icps.length > 0))
    }).catch((e) => setErr(e.message))
  }, [])

  // Default outcome — pick first non-superseded sorted alphabetically.
  useEffect(() => {
    if (outcomeId || !outcomes) return
    const live = outcomes.filter((o) => !o.supersededAt)
    const first = live.slice().sort((a, b) =>
      (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title),
    )[0]
    if (first) setOutcomeId(first.id)
  }, [outcomes, outcomeId])

  // Load the prompt whenever ICP changes.
  useEffect(() => {
    if (!icpId) { setPromptText(''); setSavedText(''); return }
    const token = getToken(); if (!token) return
    setLoadingPrompt(true)
    api.hookWriterPrompt(icpId, token).then((r) => {
      setPromptText(r.latest.promptText)
      setSavedText(r.latest.promptText)
    }).catch((e) => setErr(e.message)).finally(() => setLoadingPrompt(false))
  }, [icpId])

  // Re-preview on ICP, outcome, or n change.
  useEffect(() => {
    if (!icpId || !outcomeId) { setSystemPreview(null); setUserPreview(null); return }
    const token = getToken(); if (!token) return
    setPreviewing(true)
    api.hookDrafterContext(icpId, outcomeId, n, token).then((ctx) => {
      setSystemPreview(ctx.systemPrompt)
      setUserPreview(ctx.userMessage)
    }).catch((e) => setErr(e.message)).finally(() => setPreviewing(false))
  }, [icpId, outcomeId, n])

  const dirty = promptText !== savedText
  const liveOutcomes = useMemo(
    () => (outcomes ?? []).filter((o) => !o.supersededAt).slice().sort((a, b) =>
      (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title),
    ),
    [outcomes],
  )

  const save = async () => {
    if (!icpId) return
    const token = getToken(); if (!token) return
    setSaving(true)
    try {
      await api.saveHookWriterPrompt(icpId, promptText, null, token)
      setSavedText(promptText)
      toast.success('Hook Drafter prompt saved')
      // Refresh preview to reflect new system prompt.
      const ctx = await api.hookDrafterContext(icpId, outcomeId ?? '', n, token)
      setSystemPreview(ctx.systemPrompt)
    } catch (e: any) {
      toast.error(e.message ?? 'failed to save Hook Drafter prompt')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontFamily: T.sans, fontSize: 14, color: T.textMuted, lineHeight: 1.6 }}>
        Edit the per-ICP system prompt the hook drafter sends to Claude, and preview
        the exact user message it builds for any (ICP, outcome) combination.
        Saves are destructive — no version history.
      </div>

      {/* ICP + outcome pickers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end',
      }}>
        <Field label="ICP">
          <select
            value={icpId ?? ''}
            onChange={(e) => setIcpId(e.target.value || null)}
            style={selectStyle}
          >
            <option value="" disabled>— pick an ICP —</option>
            {icpsByClient.map((g) => (
              <optgroup key={g.clientName} label={g.clientName}>
                {g.icps.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Outcome (for preview)">
          <select
            value={outcomeId ?? ''}
            onChange={(e) => setOutcomeId(e.target.value || null)}
            style={selectStyle}
          >
            {liveOutcomes.map((o) => (
              <option key={o.id} value={o.id}>{o.displayTitle ?? o.title}</option>
            ))}
          </select>
        </Field>

        <Field label="N">
          <input
            type="number" min={1} max={20} value={n}
            onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            style={{ ...selectStyle, width: 70 }}
          />
        </Field>
      </div>

      {/* Editable system prompt */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Heading>System prompt {icpId ? '' : '— pick an ICP first'}</Heading>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={!icpId || loadingPrompt}
          rows={14}
          style={{
            background: T.bg, color: T.text, border: `1px solid ${T.borderSubtle}`,
            borderRadius: 4, padding: '10px 12px',
            fontFamily: T.mono, fontSize: 13, lineHeight: 1.55, resize: 'vertical',
            outline: 'none', minHeight: 220,
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={save} disabled={!icpId || !dirty || saving}>
            {saving ? 'saving…' : 'save'}
          </Button>
          {dirty && (
            <button
              onClick={() => setPromptText(savedText)}
              disabled={saving}
              style={ghostBtnStyle}
            >revert</button>
          )}
          {!dirty && savedText && (
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>saved</span>
          )}
        </div>
      </div>

      {/* Context preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Heading>What gets sent to Claude</Heading>
        <div style={{ fontFamily: T.sans, fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
          The drafter pulls these fields and assembles the user message below. The
          outcome contributes <strong>physiology only</strong> (title, tempo, mode,
          dynamics, instrumentation) — there's no narrative <em>intention</em> column on
          Outcome today, so add one to the schema if you want the model to receive it.
        </div>
        {previewing ? (
          <Empty>building preview…</Empty>
        ) : userPreview ? (
          <pre style={{
            background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
            borderRadius: 4, padding: '12px 14px',
            fontFamily: T.mono, fontSize: 12, color: T.text, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', overflowX: 'auto', margin: 0,
          }}>{userPreview}</pre>
        ) : (
          <Empty>pick an ICP and outcome to preview</Empty>
        )}
      </div>

      {systemPreview && (
        <details style={{
          background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
          borderRadius: 4, padding: '8px 12px',
        }}>
          <summary style={{
            cursor: 'pointer', fontFamily: T.mono, fontSize: 12,
            color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>system prompt as it will be sent</summary>
          <pre style={{
            marginTop: 8,
            fontFamily: T.mono, fontSize: 12, color: T.text, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', margin: 0,
          }}>{systemPreview}</pre>
        </details>
      )}

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {!storeId && (
        <div style={{ fontFamily: T.sans, fontSize: 12, color: T.textDim }}>
          Tip: pick a location + ICP in the Workflows tab and they'll auto-fill the ICP picker here.
        </div>
      )}
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: T.mono, fontSize: 12, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{children}</div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontFamily: T.mono, fontSize: 11, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>{label}</span>
      {children}
    </label>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px dashed ${T.borderSubtle}`,
      borderRadius: 4, padding: '10px 14px', color: T.textDim,
      fontFamily: T.sans, fontSize: 13,
    }}>{children}</div>
  )
}

const selectStyle: React.CSSProperties = {
  background: T.bg, color: T.text, border: `1px solid ${T.border}`,
  padding: '6px 10px', fontFamily: T.sans, fontSize: 14, outline: 'none',
}

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`,
  color: T.textMuted, padding: '6px 12px', borderRadius: 3,
  fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
}
