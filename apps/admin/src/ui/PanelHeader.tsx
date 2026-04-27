import { T } from '../tokens.js'
import { S } from './sizes.js'

export function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{
        fontSize: S.subhead,
        fontFamily: T.sans,
        fontWeight: 500,
        color: T.text,
      }}>{title}</div>
      {subtitle && (
        <div style={{
          fontSize: S.small,
          color: T.textMuted,
          fontFamily: T.sans,
          marginTop: 4,
        }}>{subtitle}</div>
      )}
    </div>
  )
}
