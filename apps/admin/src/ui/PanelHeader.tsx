import { T } from '../tokens.js'
import { S } from './sizes.js'

// Subtitles are intentionally suppressed app-wide. Callers may keep passing
// `subtitle` for future use; we no longer render it.
export function PanelHeader({ title }: { title: string; subtitle?: string }) {
  return (
    <div style={{
      fontSize: S.subhead,
      fontFamily: T.sans,
      fontWeight: 500,
      color: T.text,
    }}>{title}</div>
  )
}
