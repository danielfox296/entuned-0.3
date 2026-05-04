// Design tokens — Entuned design system (customer dashboard).
//
// Mirrors the canonical Entuned brand palette used on the website
// (entuned.co). Primary accent is the warm gold (`#d7af74`); secondary
// accent is the brand-deck slate (`#829eac`). Surface darks are kept
// close to the website's hero dark so the dashboard reads as the same
// brand.
//
// Keep in sync with admin's tokens.ts when either side evolves.

export const T = {
  // ── Surfaces ──────────────────────────────────────────────────
  bg:            '#20201c',
  surface:       '#2a2a24',
  surfaceRaised: '#34342d',
  surfaceHover:  '#3f3f37',
  inkDeep:       '#15151a',

  // ── Borders ───────────────────────────────────────────────────
  border:        'rgba(215, 175, 116, 0.20)',
  borderSubtle:  'rgba(215, 175, 116, 0.10)',
  borderActive:  'rgba(215, 175, 116, 0.55)',

  // ── Text ──────────────────────────────────────────────────────
  text:          '#f1ece2',
  textMuted:     'rgba(241, 236, 226, 0.92)',
  textDim:       'rgba(241, 236, 226, 0.78)',
  textFaint:     'rgba(241, 236, 226, 0.60)',

  // ── Accent (gold — primary brand) ─────────────────────────────
  accent:        '#d7af74',
  accentHover:   '#e1bd87',
  accentMuted:   'rgba(215, 175, 116, 0.78)',
  accentGlow:    'rgba(215, 175, 116, 0.16)',

  // ── Secondary accents ─────────────────────────────────────────
  gold:          '#d7af74',  // alias of `accent`; gold IS the primary
  slate:         '#829eac',  // brand-deck slate — secondary accent

  // ── Status ────────────────────────────────────────────────────
  danger:        '#E24B4A',
  success:       '#52C47A',
  warn:          '#d7af74',

  // ── Typography ────────────────────────────────────────────────
  heading:       "'Manrope', sans-serif",
  sans:          "'Inter', sans-serif",
  mono:          "'Inter', sans-serif",
} as const
