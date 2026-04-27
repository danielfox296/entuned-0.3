// Design tokens — Entuned design system (colors_and_type.css → v0.3 admin)
// Single source of truth for all inline styles across the admin shell and panels.

export const T = {
  // ── Surfaces (darks darkened ~20%) ─────────────────────────────
  bg:            '#191916',   // ink — warm near-black
  surface:       '#1d1d19',   // bg-alt — sidebar, status bar
  surfaceRaised: '#20201d',   // bg-card — cards, inputs
  surfaceHover:  '#302f2c',   // bg-stats — elevated band, hovered rows
  inkDeep:       '#141412',   // footer, deepest surface

  // ── Borders (alpha bumped for contrast) ───────────────────────
  border:        'rgba(150, 210, 220, 0.40)',   // primary divider
  borderSubtle:  'rgba(150, 210, 220, 0.22)',   // secondary divider

  // ── Text (lights lightened ~20% toward white) ─────────────────
  text:          '#eef4f6',                      // ice — primary
  textMuted:     'rgba(238, 244, 246, 0.92)',    // secondary labels
  textDim:       'rgba(238, 244, 246, 0.78)',    // tertiary / faint
  textFaint:     'rgba(238, 244, 246, 0.60)',    // placeholder, disabled

  // ── Accent (teal — lightened) ──────────────────────────────────
  accent:        '#88c0c9',                      // primary brand accent
  accentHover:   '#9bcfd7',                      // hover / lift
  accentMuted:   'rgba(136, 192, 201, 0.78)',    // readable teal label text
  accentGlow:    'rgba(136, 192, 201, 0.16)',    // subtle bg tint / active row

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
