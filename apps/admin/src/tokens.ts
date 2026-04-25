// Design tokens — kept in their own module so panel components can import
// without forming a circular dep with App.tsx.

export const T = {
  bg:            '#0C0C0E',
  surface:       '#141416',
  surfaceRaised: '#1A1A1E',
  surfaceHover:  '#222226',
  border:        '#2A2A2F',
  borderSubtle:  '#1E1E22',
  text:          '#E8E6E1',
  textMuted:     '#8A877F',
  textDim:       '#5A5850',
  accent:        '#C4A052',
  accentMuted:   '#8B7337',
  accentGlow:    'rgba(196, 160, 82, 0.08)',
  danger:        '#C45252',
  success:       '#52C47A',
  warn:          '#C4A052',
  mono:          "'DM Mono', 'SF Mono', 'Fira Code', monospace",
  sans:          "'DM Sans', 'Helvetica Neue', system-ui, sans-serif",
} as const
