// Design tokens — Entuned unified design system (customer dashboard).
// Matches the brand site (entuned.co / "Bowie") and admin.
// Keep in sync with admin's tokens.ts when either side evolves.

export const T = {
  // ── Surfaces ──────────────────────────────────────────────────
  bg:            '#20201c',
  surface:       '#282824',
  surfaceRaised: '#302f2a',
  surfaceHover:  '#3a3935',
  inkDeep:       '#1a1a17',

  // ── Borders (teal-tinted) ─────────────────────────────────────
  border:        'rgba(80, 146, 156, 0.20)',
  borderSubtle:  'rgba(80, 146, 156, 0.10)',
  borderActive:  'rgba(80, 146, 156, 0.55)',

  // ── Text ──────────────────────────────────────────────────────
  text:          '#d4e1e5',
  textMuted:     'rgba(212, 225, 229, 0.85)',
  textDim:       'rgba(212, 225, 229, 0.65)',
  textFaint:     'rgba(212, 225, 229, 0.50)',

  // ── Accent (teal — brand primary) ─────────────────────────────
  accent:        '#50929c',
  accentHover:   '#6aacb5',
  accentMuted:   'rgba(80, 146, 156, 0.78)',
  accentGlow:    'rgba(80, 146, 156, 0.16)',

  // ── Secondary accents ─────────────────────────────────────────
  gold:          '#d7af74',
  slate:         '#829eac',

  // ── Status ────────────────────────────────────────────────────
  danger:        '#E24B4A',
  success:       '#52C47A',
  warn:          '#d7af74',

  // ── Typography ────────────────────────────────────────────────
  heading:       "'Manrope', sans-serif",
  sans:          "'Inter', sans-serif",
  mono:          "'Inter', sans-serif",
} as const
