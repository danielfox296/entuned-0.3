import { useState } from 'react'
import { T } from '@entuned/tokens'
import { Logo } from '../ui/index.js'
import { api, primaryStore, PLAYER_URL, type OnboardProfileInput } from '../api.js'
import content from '../content/onboard.yaml'

type IndustryOption = { value: string; label: string }

// /onboard — post-auth gate. Server redirects here when Client.industry === null.
// Collects industry + optional zip and writes them via PATCH /me/profile.
// After save, redirects to / (Home).

export function OnboardProfile() {
  const [industry, setIndustry] = useState('')
  const [zip, setZip] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = (content.industry_options as IndustryOption[])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!industry) return
    setError(null)
    setBusy(true)
    try {
      const body: OnboardProfileInput = { industry }
      if (zip.trim()) body.zip = zip.trim()
      await api.saveOnboardProfile(body)
      const { stores } = await api.meStores()
      const store = primaryStore(stores)
      window.location.href = store ? `${PLAYER_URL}/${store.slug}` : PLAYER_URL
    } catch {
      setError(content.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: T.bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <Logo />
        </div>

        <div style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          padding: '32px 32px',
        }}>
          <h1 style={{
            fontFamily: T.heading, fontSize: 22, fontWeight: 600,
            color: T.text, margin: '0 0 8px 0', letterSpacing: '-0.01em',
          }}>
            {content.heading}
          </h1>
          <p style={{
            color: T.textMuted, fontSize: 14, fontFamily: T.sans,
            lineHeight: 1.55, margin: '0 0 28px 0',
          }}>
            {content.subhead}
          </p>

          <form onSubmit={submit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', color: T.textDim,
                fontSize: 13, fontFamily: T.sans, marginBottom: 8,
              }}>
                {content.industry_label}
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px 12px',
                  background: T.inkDeep,
                  border: `1px solid ${industry ? T.borderActive : T.border}`,
                  borderRadius: 8, color: industry ? T.text : T.textFaint,
                  fontFamily: T.sans, fontSize: 15, outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="" disabled>{content.industry_placeholder}</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 28 }}>
              <label style={{
                display: 'block', color: T.textDim,
                fontSize: 13, fontFamily: T.sans, marginBottom: 8,
              }}>
                {content.zip_label}
                {' '}
                <span style={{ color: T.textFaint, fontWeight: 400 }}>
                  — {content.zip_hint}
                </span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder={content.zip_placeholder}
                maxLength={10}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: T.inkDeep,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8, color: T.text,
                  fontFamily: T.sans, fontSize: 15, outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div style={{
                color: T.danger, fontSize: 13, fontFamily: T.sans,
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!industry || busy}
              style={{
                width: '100%', padding: '13px 24px',
                background: industry && !busy ? T.accent : T.border,
                border: 'none', borderRadius: 10,
                color: industry && !busy ? T.bg : T.textFaint,
                fontFamily: T.sans, fontSize: 15, fontWeight: 600,
                cursor: industry && !busy ? 'pointer' : 'default',
                transition: 'background 0.15s ease',
              }}
            >
              {busy ? content.submit_busy : content.submit}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
