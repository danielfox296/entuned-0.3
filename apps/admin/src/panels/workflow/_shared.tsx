import type { ReactNode } from 'react'
import { T } from '../../tokens.js'
import { S } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function StubPanel({ title, intent, steps, ctx }: {
  title: string
  intent: string
  steps: string[]
  ctx: WorkflowContext
}) {
  const ready = ctx.storeId && ctx.icpId
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontFamily: T.heading, fontSize: 18, fontWeight: 600, color: T.text, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontFamily: T.sans, fontSize: S.small, color: T.textMuted, lineHeight: 1.6 }}>
          {intent}
        </div>
      </div>

      {!ready && (
        <Notice tone="warn">
          select a store and ICP above to activate this workflow
        </Notice>
      )}

      <div>
        <div style={{
          fontFamily: T.mono, fontSize: 12, color: T.textDim,
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8,
        }}>planned steps</div>
        <ol style={{
          margin: 0, paddingLeft: 20, fontFamily: T.sans, fontSize: 14,
          color: T.textMuted, lineHeight: 1.7,
        }}>
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      <Notice tone="dashed">
        scaffold — implementation pending
      </Notice>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'dashed'; children: ReactNode }) {
  const s = tone === 'warn'
    ? { background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.textMuted }
    : { background: T.accentGlow, border: `1px dashed ${T.accentMuted}`, color: T.textMuted }
  return (
    <div style={{
      ...s, padding: '10px 14px', borderRadius: 4,
      fontFamily: T.sans, fontSize: 14,
    }}>{children}</div>
  )
}
