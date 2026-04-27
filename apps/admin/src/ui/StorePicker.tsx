import { T } from '../tokens.js'
import { S } from './sizes.js'
import { Select } from './Inputs.js'
import type { StoreSummary } from '../api.js'

export function StorePicker({ stores, storeId, onPick, label = 'store' }: {
  stores: StoreSummary[] | null
  storeId: string | null
  onPick: (id: string) => void
  label?: string
}) {
  if (!stores) return <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading stores…</div>
  if (stores.length === 0) return <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>no stores</div>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        fontSize: S.label,
        color: T.textDim,
        fontFamily: T.sans,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>{label}</span>
      <Select
        value={storeId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        style={{ minWidth: 320, width: 'auto' }}
      >
        <option value="" disabled>— pick a store —</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.clientName} — {s.name}</option>
        ))}
      </Select>
    </div>
  )
}
