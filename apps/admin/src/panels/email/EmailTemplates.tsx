import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, previewEmailTemplate, type EmailTemplateDetail, type EmailTemplateListRow } from '../../api.js'
import { T } from '../../tokens.js'
import { S } from '../../ui/sizes.js'
import { Button, Input, Textarea, Pill, useToast } from '../../ui/index.js'

// /admin → Email panel.
//
// List of all email template names (from the server template registry) on the
// left; editor on the right. DB-editable templates can be edited in place;
// non-editable variant-heavy ones (welcome, dunning) are read-only with a
// helpful note.
//
// Preview pane renders against the template's propsExample by default, or any
// JSON the operator pastes in. The /admin/email/preview endpoint is gated by
// INTERNAL_ADMIN_TOKEN (separate from operator JWT) — the operator pastes it
// once per session into the small input below the preview pane and we keep it
// in component state (never persisted).

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

  // Load list on mount
  useEffect(() => {
    if (!token) return
    api.emailTemplates(token)
      .then((r) => {
        setList(r.templates)
        // Default to the first editable template.
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
      // Refresh list so the updatedAt timestamp re-renders.
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
          borderRadius: S.r4, fontSize: 11, color: T.textDim, lineHeight: 1.5,
        }}>
          <strong style={{ color: T.textMuted }}>Lifecycle</strong> templates fire from
          a daily cron at 9am Mountain. They check the recipient&rsquo;s opt-out flag
          and include an unsubscribe footer.
        </div>
      </aside>

      {/* Editor + preview */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {!selected && (
          <div style={{ color: T.textDim, fontSize: 14 }}>Select a template.</div>
        )}

        {selected && !list.find((t) => t.name === selected)?.editable && (
          <ReadOnlyNote name={selected} />
        )}

        {selected && list.find((t) => t.name === selected)?.editable && (
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

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                    <strong style={{ color: T.textMuted, fontSize: 13 }}>Preview</strong>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        value={adminToken}
                        onChange={(e) => setAdminToken(e.target.value)}
                        placeholder="INTERNAL_ADMIN_TOKEN"
                        style={{ width: 240, fontFamily: T.mono, fontSize: 12 }}
                        type="password"
                      />
                      <Button onClick={renderPreview} disabled={previewing}>
                        {previewing ? 'Rendering…' : 'Render'}
                      </Button>
                    </div>
                  </div>
                  {previewError && (
                    <div style={{ color: T.danger, fontSize: 13, marginBottom: 10 }}>
                      {previewError}
                    </div>
                  )}
                  {!previewHtml && !previewError && (
                    <div style={{ color: T.textDim, fontSize: 13 }}>
                      Click Render to see the email. The preview reads from the
                      <em> currently saved</em> DB row, not your unsaved edits — save first.
                    </div>
                  )}
                  {previewHtml && (
                    <>
                      <div style={{
                        fontSize: 12, color: T.textDim, marginBottom: 8,
                        fontFamily: T.mono,
                      }}>
                        <strong style={{ color: T.textMuted }}>Subject:</strong> {previewSubject}
                      </div>
                      <PreviewIframe html={previewHtml} />
                    </>
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
      <strong style={{ color: T.text }}>{name}</strong> is variant-heavy — its
      copy branches on tier (welcome) or attempt number (dunning) inside the
      TS file. To edit, open <code style={{ color: T.accent }}>apps/server/src/email-templates/{name}.ts</code>.
      It can be split into per-variant DB-editable templates later if you
      want to tune the variants from here.
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
        width: '100%', minHeight: 600, border: `1px solid ${T.border}`,
        background: '#0a0a0a', borderRadius: S.r4,
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
