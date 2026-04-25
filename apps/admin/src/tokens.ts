// Design tokens — Entuned design system (colors_and_type.css → v0.3 admin)
// Single source of truth for all inline styles across the admin shell and panels.

export const T = {
  // ── Surfaces ───────────────────────────────────────────────────
  bg:            '#20201c',   // ink — warm near-black
  surface:       '#252520',   // bg-alt — sidebar, status bar
  surfaceRaised: '#282825',   // bg-card — cards, inputs
  surfaceHover:  '#3d3b38',   // bg-stats — elevated band, hovered rows
  inkDeep:       '#1a1a17',   // footer, deepest surface

  // ── Borders ────────────────────────────────────────────────────
  border:        'rgba(106, 176, 187, 0.28)',   // primary divider (+20%)
  borderSubtle:  'rgba(106, 176, 187, 0.14)',   // secondary / background divider (+20%)

  // ── Text (ice palette) ─────────────────────────────────────────
  text:          '#d4e1e5',                      // ice — primary
  textMuted:     'rgba(212, 225, 229, 0.90)',    // secondary labels (+20%)
  textDim:       'rgba(212, 225, 229, 0.70)',    // tertiary / faint (+20%)
  textFaint:     'rgba(212, 225, 229, 0.50)',    // placeholder, disabled (+20%)

  // ── Accent (teal) ──────────────────────────────────────────────
  accent:        '#6ab0bb',                      // primary brand accent
  accentHover:   '#82c3cd',                      // hover / lift
  accentMuted:   'rgba(106, 176, 187, 0.66)',    // readable teal label text + soft borders (+20%)
  accentGlow:    'rgba(106, 176, 187, 0.12)',    // subtle bg tint / active row (+20%)

  // ── Secondary accents ──────────────────────────────────────────
  gold:          '#e8b458',   // secondary — use sparingly

  // ── Status ─────────────────────────────────────────────────────
  danger:        '#E24B4A',
  success:       '#52C47A',
  warn:          '#e8b458',

  // ── Typography ─────────────────────────────────────────────────
  heading:       "'Manrope', sans-serif",
  sans:          "'Inter', sans-serif",
  mono:          "'Inter', sans-serif",   // aliased — no monospace on public surfaces
} as const
