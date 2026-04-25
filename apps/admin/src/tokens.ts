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
  border:        'rgba(106, 176, 187, 0.18)',   // primary divider
  borderSubtle:  'rgba(106, 176, 187, 0.08)',   // secondary / background divider

  // ── Text (ice palette) ─────────────────────────────────────────
  text:          '#d4e1e5',                      // ice — primary
  textMuted:     'rgba(212, 225, 229, 0.75)',    // secondary labels
  textDim:       'rgba(212, 225, 229, 0.55)',    // tertiary / faint
  textFaint:     'rgba(212, 225, 229, 0.35)',    // placeholder, disabled

  // ── Accent (teal) ──────────────────────────────────────────────
  accent:        '#6ab0bb',                      // primary brand accent
  accentHover:   '#82c3cd',                      // hover / lift
  accentMuted:   'rgba(106, 176, 187, 0.55)',    // readable teal label text + soft borders
  accentGlow:    'rgba(106, 176, 187, 0.08)',    // subtle bg tint / active row

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
