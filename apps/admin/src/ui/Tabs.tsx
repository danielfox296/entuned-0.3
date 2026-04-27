import { T } from '../tokens.js'
import { S } from './sizes.js'

export interface TabItem {
  key: string
  label: string
  ready?: boolean
}

export function Tabs({ items, active, onSelect }: {
  items: TabItem[]
  active: string
  onSelect: (key: string) => void
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      borderBottom: `1px solid ${T.borderSubtle}`,
    }}>
      {items.map((t) => {
        const on = active === t.key
        const ready = t.ready !== false
        return (
          <button
            key={t.key}
            onClick={() => ready && onSelect(t.key)}
            disabled={!ready}
            aria-selected={on}
            role="tab"
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
              color: on ? T.text : (ready ? T.textMuted : T.textDim),
              padding: '8px 14px',
              cursor: ready ? 'pointer' : 'default',
              fontFamily: T.sans,
              fontSize: S.small,
              fontWeight: on ? 500 : 400,
              marginBottom: -1,
            }}
          >{t.label}{ready ? '' : ' (soon)'}</button>
        )
      })}
    </div>
  )
}
