import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, previewEmailTemplate, type EmailTemplateDetail, type EmailTemplateListRow } from '../../api.js'
import { T } from '../../tokens.js'
import { S } from '../../ui/sizes.js'
import { Button, Input, Textarea, Pill, useToast } from '../../ui/index.js'

// /admin → Email panel.
//
// List of all email template names on the left; editor on the right. Editable
// templates round-trip via /admin/email/templates; non-editable variant ones
// (welcome*, dunning*) get inlined into v1 split files and are now editable
// per-variant from this panel.
//
// Preview pane renders against the template's propsExample by default, or any
// JSON the operator pastes in. /admin/email/preview is gated by
// INTERNAL_ADMIN_TOKEN (separate from operator JWT) — the operator pastes it
// once per session and we keep it in component state (never persisted). Also
// drives the "Send test" affordance, which reuses the same endpoint with sendTo.
//
// Lifecycle drips have a "Fire now" button that hits /admin/email/lifecycle/run.
// The dispatcher is idempotent (lifecycle_email_logs unique on user+template+
// contextKey), so spamming the button is safe — already-sent recipients are skipped.

const LIFECYCLE_DRIPS = [
  'icpUnfilled', 'pauseEnding', 'freeToCoreNudge',
  'engagedFreeToCore', 'scalingCoreToPro', 'establishedCoreToPro',
] as const
type LifecycleDripName = typeof LIFECYCLE_DRIPS[number]

export function EmailTemplates() {
  const token = getToken()
  const toast = useToast()
  const [list, setList] = useState<EmailTemplateListRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailTemplateDetail | null>(null)
  const [draftSubject, setDraftSubject] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Preview state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewSubject, setPreviewSubject] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [propsJson, setPropsJson] = useState('{}')

  // Send-test state
  const [sendTo, setSendTo] = useState('')
  const [sending, setSending] = useState(false)

  // Fire-now state
  const [firing, setFiring] = useState<LifecycleDripName | 'all' | null>(null)

  // Load list on mount
  useEffect(() => {
    if (!token) return
    api.emailTemplates(token)
      .then((r) => {
        setList(r.templates)
        const firstEditable = r.templates.find((t) => t.editable)
        if (firstEditable) setSelected(firstEditable.name)
      })
      .catch((e) => toast.error(`Failed to load templates: ${e.message}`))
  }, [token])

  // Load detail when selection changes (editable only)
  useEffect(() => {
    if (!token || !selected) { setDetail(null); return }
    const row = list.find((r) => r.name === selected)
    if (!row?.editable) { setDetail(null); return }
    setLoadingDetail(true)
    api.emailTemplate(selected, token)
      .then((d) => {
        setDetail(d)
        setDraftSubject(d.subject)
        setDraftBody(d.body)
        setPropsJson(JSON.stringify(d.propsExample ?? {}, null, 2))
        setPreviewHtml(null); setPreviewSubject(null); setPreviewError(null)
      })
      .catch((e) => toast.error(`Failed to load ${selected}: ${e.message}`))
      .finally(() => setLoadingDetail(false))
  }, [selected, list, token])

  const dirty = useMemo(() => {
    if (!detail) return false
    return draftSubject !== detail.subject || draftBody !== detail.body
  }, [detail, draftSubject, draftBody])

  const save = async () => {
    if (!token || !selected || saving) return
    if (!draftSubject.trim() || !draftBody.trim()) {
      toast.error('Subject and body are both required.')
      return
    }
    setSaving(true)
    try {
      let parsedProps: any
      try { parsedProps = propsJson.trim() ? JSON.parse(propsJson) : undefined }
      catch { parsedProps = undefined }
      const updated = await api.saveEmailTemplate(selected, {
        subject: draftSubject,
        body: draftBody,
        ...(parsedProps ? { propsExample: parsedProps } : {}),
      }, token)
      setDetail(updated)
      const fresh = await api.emailTemplates(token)
      setList(fresh.templates)
      toast.success('Saved.')
    } catch (e: any) {
      toast.error(`Save failed: ${e.message ?? 'unknown'}`)
    } finally {
      setSaving(false)
    }
  }

  const renderPreview = async () => {
    if (!selected) return
    if (!adminToken.trim()) {
      setPreviewError('Paste the INTERNAL_ADMIN_TOKEN to preview rendered HTML.')
      return
    }
    setPreviewing(true)
    setPreviewError(null)
    try {
      let parsedProps: Record<string, unknown> = {}
      try { parsedProps = propsJson.trim() ? JSON.parse(propsJson) : {} }
      catch { setPreviewError('Sample props must be valid JSON.'); setPreviewing(false); return }
      const result = await previewEmailTemplate(adminToken, {
        template: selected, props: parsedProps,
      })
      setPreviewHtml(result.html)
      setPreviewSubject(result.subject)
    } catch (e: any) {
      setPreviewError(e.message ?? 'Preview failed.')
    } finally {
      setPreviewing(false)
    }
  }

  const sendTest = async () => {
    if (!selected || sending) return
    if (!adminToken.trim()) {
      toast.error('Paste the INTERNAL_ADMIN_TOKEN first.')
      return
    }
    if (!sendTo.trim() || !sendTo.includes('@')) {
      toast.error('Enter a valid recipient address.')
      return
    }
    setSending(true)
    try {
      let parsedProps: Record<string, unknown> = {}
      try { parsedProps = propsJson.trim() ? JSON.parse(propsJson) : {} }
      catch { toast.error('Sample props must be valid JSON.'); setSending(false); return }
      await previewEmailTemplate(adminToken, {
        template: selected, props: parsedProps, sendTo: sendTo.trim(),
      })
      toast.success(`Sent to ${sendTo.trim()}.`)
    } catch (e: any) {
      toast.error(`Send failed: ${e.message ?? 'unknown'}`)
    } finally {
      setSending(false)
    }
  }

  const fireDrip = async (drip: LifecycleDripName | 'all') => {
    if (!token || firing) return
    if (drip !== 'all') {
      const ok = window.confirm(
        `Fire "${drip}" now?\n\nThis runs the same scan the daily cron does — eligible recipients who haven't been sent this drip yet will get an email. Idempotent (already-sent users are skipped).`,
      )
      if (!ok) return
    } else {
      const ok = window.confirm(
        'Fire ALL three drips now?\n\nRuns icpUnfilled + pauseEnding + freeToCoreNudge. Idempotent — already-sent users are skipped.',
      )
      if (!ok) return
    }
    setFiring(drip)
    try {
      const result = await api.runLifecycleDrip(drip, token)
      const stats = result.stats
      const summarize = (s: any) => `${s.sent} sent · ${s.skipped} skipped · ${s.errors} errors (${s.considered} considered)`
      if (drip === 'all') {
        const totals = { sent: 0, skipped: 0, errors: 0, considered: 0 }
        for (const v of Object.values(stats) as any[]) {
          totals.sent += v.sent; totals.skipped += v.skipped
          totals.errors += v.errors; totals.considered += v.considered
        }
        toast.success(`All drips: ${summarize(totals)}`)
      } else {
        toast.success(`${drip}: ${summarize(stats)}`)
      }
    } catch (e: any) {
      toast.error(`Fire failed: ${e.message ?? 'unknown'}`)
    } finally {
      setFiring(null)
    }
  }

  const isLifecycle = selected ? LIFECYCLE_DRIPS.includes(selected as LifecycleDripName) : false
  const editable = selected ? !!list.find((r) => r.name === selected)?.editable : false

  return (
    <div style={{ display: 'flex', gap: 24, height: '100%' }}>
      {/* List */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: S.r6, padding: 8, overflowY: 'auto', maxHeight: '100%',
      }}>
        <div style={{
          padding: '8px 12px', fontSize: S.label, color: T.textFaint,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>Templates</div>
        {list.map((t) => (
          <TemplateRow
            key={t.name}
            row={t}
            active={selected === t.name}
            onClick={() => setSelected(t.name)}
          />
        ))}
        <div style={{
          margin: '12px 8px 8px', padding: '10px 12px',
          background: T.bg, border: `1px solid ${T.borderSubtle}`,
          borderRadius: S.r4,
        }}>
          <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5, marginBottom: 8 }}>
            Lifecycle drips fire daily at 9am Mountain. Idempotent — already-sent users skipped.
          </div>
          <Button variant="ghost" onClick={() => fireDrip('all')} disabled={!!firing}>
            {firing === 'all' ? 'Firing…' : 'Fire all drips now'}
          </Button>
        </div>
      </aside>

      {/* Editor + preview */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {!selected && (
          <div style={{ color: T.textDim, fontSize: 14 }}>Select a template.</div>
        )}

        {selected && !editable && (
          <ReadOnlyNote name={selected} />
        )}

        {selected && editable && (
          <>
            {loadingDetail && <div style={{ color: T.textDim, fontSize: 14 }}>Loading…</div>}
            {detail && !loadingDetail && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap',
                }}>
                  <h2 style={{
                    fontFamily: T.heading, fontSize: 20, fontWeight: 600,
                    color: T.text, margin: 0, letterSpacing: '-0.01em',
                  }}>{selected}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {detail.lifecycle && <Pill tone="warn">lifecycle</Pill>}
                    {detail.updatedAt && (
                      <span style={{ fontSize: 12, color: T.textDim }}>
                        saved {new Date(detail.updatedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                <Field label="Subject">
                  <Input
                    value={draftSubject}
                    onChange={(e) => setDraftSubject(e.target.value)}
                    placeholder="Subject line — supports {{var}} interpolation"
                  />
                </Field>

                <Field label="Body (raw HTML — wrapped at send time in the standard layout shell)">
                  <Textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={18}
                    style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.5 }}
                  />
                </Field>

                <Field label="Sample props (JSON) — used by preview and seeded as the default">
                  <Textarea
                    value={propsJson}
                    onChange={(e) => setPropsJson(e.target.value)}
                    rows={5}
                    style={{ fontFamily: T.mono, fontSize: 12 }}
                  />
                </Field>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button onClick={save} disabled={!dirty || saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (!detail) return
                      setDraftSubject(detail.subject)
                      setDraftBody(detail.body)
                    }}
                    disabled={!dirty || saving}
                  >Reset</Button>

                  {isLifecycle && (
                    <Button
                      variant="ghost"
                      onClick={() => fireDrip(selected as LifecycleDripName)}
                      disabled={!!firing}
                    >
                      {firing === selected ? 'Firing…' : `Fire ${selected} now`}
                    </Button>
                  )}
                </div>

                {/* Preview */}
                <div style={{
                  marginTop: 16, padding: 16,
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: S.r6,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 12, gap: 12, flexWrap: 'wrap',
                  }}>
                    <strong style={{ color: T.textMuted, fontSize: 13 }}>Preview &amp; test</strong>
                    <Input
                      value={adminToken}
                      onChange={(e) => setAdminToken(e.target.value)}
                      placeholder="INTERNAL_ADMIN_TOKEN"
                      style={{ width: 240, fontFamily: T.mono, fontSize: 12 }}
                      type="password"
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Button onClick={renderPreview} disabled={previewing}>
                      {previewing ? 'Rendering…' : 'Render'}
                    </Button>
                    <Input
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      placeholder="recipient@example.com"
                      style={{ flex: 1, minWidth: 220 }}
                      type="email"
                    />
                    <Button variant="ghost" onClick={sendTest} disabled={sending}>
                      {sending ? 'Sending…' : 'Send test'}
                    </Button>
                  </div>

                  {previewError && (
                    <div style={{ color: T.danger, fontSize: 13, marginBottom: 10 }}>
                      {previewError}
                    </div>
                  )}
                  {!previewHtml && !previewError && (
                    <div style={{ color: T.textDim, fontSize: 13 }}>
                      Render shows the email rendered against the <em>currently saved</em> DB row
                      (save your edits first). Send test fires a real email through Resend
                      using the same render.
                    </div>
                  )}
                  {previewHtml && (
                    <PreviewWindow
                      subject={previewSubject ?? '(no subject)'}
                      html={previewHtml}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function TemplateRow({ row, active, onClick }: {
  row: EmailTemplateListRow; active: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px', cursor: 'pointer',
        borderRadius: S.r4,
        background: active ? T.accentGlow : 'transparent',
        marginBottom: 2,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6,
      }}>
        <span style={{
          fontFamily: T.mono, fontSize: 12,
          color: row.editable ? (active ? T.text : T.textMuted) : T.textDim,
          fontWeight: active ? 600 : 400,
        }}>{row.name}</span>
        {row.lifecycle && (
          <span style={{
            fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
            color: T.warn, textTransform: 'uppercase',
            border: `1px solid ${T.warn}`, borderRadius: 3, padding: '0 4px',
          }}>life</span>
        )}
        {!row.editable && (
          <span style={{
            fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
            color: T.textFaint, textTransform: 'uppercase',
            border: `1px solid ${T.borderSubtle}`, borderRadius: 3, padding: '0 4px',
          }}>code</span>
        )}
      </div>
      {row.subject && (
        <div style={{
          fontSize: 11, color: T.textFaint, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.subject}</div>
      )}
    </div>
  )
}

function ReadOnlyNote({ name }: { name: string }) {
  return (
    <div style={{
      padding: 16, background: T.surfaceRaised,
      border: `1px solid ${T.borderSubtle}`, borderRadius: S.r6,
      color: T.textMuted, fontSize: 14, lineHeight: 1.55,
    }}>
      <strong style={{ color: T.text }}>{name}</strong> isn&rsquo;t in the
      DB-editable set. To edit, open <code style={{ color: T.accent }}>apps/server/src/email-templates/{name}.ts</code>
      &nbsp;and the matching row in <code style={{ color: T.accent }}>seeds.ts</code>.
    </div>
  )
}

function PreviewWindow({ subject, html }: { subject: string; html: string }) {
  // Gmail-style chrome: subject row above, then the email body in an iframe.
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: S.r4,
      background: '#0a0a0a', overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${T.borderSubtle}`,
        background: '#0f0f0f',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
          color: T.textFaint, textTransform: 'uppercase', marginBottom: 4,
        }}>Subject</div>
        <div style={{
          fontSize: 14, color: '#E8E4DE', fontFamily: T.heading, fontWeight: 600,
        }}>{subject}</div>
      </div>
      <PreviewIframe html={html} />
    </div>
  )
}

function PreviewIframe({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const doc = ref.current?.contentDocument
    if (!doc) return
    doc.open(); doc.write(html); doc.close()
  }, [html])
  return (
    <iframe
      ref={ref}
      style={{
        display: 'block', width: '100%', minHeight: 600, border: 'none',
        background: '#0a0a0a',
      }}
      title="Email preview"
    />
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 13, color: T.textMuted, marginBottom: 6,
        fontFamily: T.sans,
      }}>{label}</label>
      {children}
    </div>
  )
}
