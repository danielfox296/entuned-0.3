import type { ReactNode } from 'react'
import { T } from '../tokens.js'

// Square card-grid for single- or multi-select choices. Lifted from the PLG
// onboarding design (left teal accent bar, hairline border, hover lift).
//
// Generic over the option id type so consumers don't have to coerce strings.

export interface ChoiceOption<Id extends string = string> {
  id: Id
  label: ReactNode
  hint?: ReactNode
}

interface BaseProps<Id extends string> {
  options: ChoiceOption<Id>[]
  columns?: number
}

export function CardChoice<Id extends string>({
  options, value, onChange, columns = 2,
}: BaseProps<Id> & { value: Id | null; onChange: (id: Id) => void }) {
  return (
    <Grid columns={columns}>
      {options.map((opt) => (
        <Cell
          key={opt.id}
          selected={value === opt.id}
          onClick={() => onChange(opt.id)}
        >
          <CellLabel>{opt.label}</CellLabel>
          {opt.hint && <CellHint>{opt.hint}</CellHint>}
        </Cell>
      ))}
    </Grid>
  )
}

export function MultiCardChoice<Id extends string>({
  options, value, onChange, columns = 2,
}: BaseProps<Id> & { value: Id[]; onChange: (ids: Id[]) => void }) {
  return (
    <Grid columns={columns}>
      {options.map((opt) => {
        const selected = value.includes(opt.id)
        const toggle = () => {
          onChange(selected ? value.filter((v) => v !== opt.id) : [...value, opt.id])
        }
        return (
          <Cell key={opt.id} selected={selected} onClick={toggle}>
            <div style={{
              display: 'flex', alignItems: 'baseline',
              justifyContent: 'space-between', gap: 16,
            }}>
              <CellLabel>{opt.label}</CellLabel>
              <Check selected={selected} />
            </div>
            {opt.hint && <CellHint>{opt.hint}</CellHint>}
          </Cell>
        )
      })}
    </Grid>
  )
}

function Grid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gap: 12,
    }}>
      {children}
    </div>
  )
}

function Cell({ selected, onClick, children }: {
  selected: boolean; onClick: () => void; children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: selected ? T.accentGlow : 'transparent',
        border: `1px solid ${selected ? T.borderActive : T.border}`,
        borderLeft: selected ? `3px solid ${T.accent}` : `1px solid ${T.border}`,
        color: T.text,
        padding: '14px 18px',
        cursor: 'pointer',
        borderRadius: 0,
        fontFamily: T.sans,
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = T.borderActive
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = T.border
      }}
    >
      {children}
    </button>
  )
}

function CellLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 500, color: T.text }}>
      {children}
    </div>
  )
}

function CellHint({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 13, color: T.textFaint, lineHeight: 1.5,
      marginTop: 6,
    }}>
      {children}
    </div>
  )
}

function Check({ selected }: { selected: boolean }) {
  return (
    <span style={{
      width: 18, height: 18, flexShrink: 0,
      border: `1.5px solid ${selected ? T.accent : T.border}`,
      background: selected ? T.accent : 'transparent',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s ease',
    }}>
      {selected && (
        <svg width="11" height="11" viewBox="0 0 11 11">
          <polyline points="2,5.5 4.5,8 9,2.5" fill="none"
            stroke={T.bg} strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}
