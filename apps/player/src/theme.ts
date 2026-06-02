// Player-specific palette deviations.
//
// Brand tokens live in @entuned/tokens (the `T` object) and are the single
// source of truth for the brand palette across admin, dashboard, and player.
// The constants below are the player's INTENTIONAL departures from brand — the
// in-store player runs on a dark, near-black screen where the brand values read
// too dim, so the accent/gold/text are brightened.
//
// They used to be scattered as raw hex (and the accent was re-declared as a
// local `const TEAL = "#6AB0BB"` in several files). Centralizing them here means
// the player's look is one edit from brand-aligning: set PLAYER_ACCENT = T.accent
// (and PLAYER_GOLD = T.gold, PLAYER_TEXT_BRIGHT = T.text) to drop the deviation.
//
// NOTE: the rgba(...) tints derived from these colors (e.g. rgba(106,176,187,…))
// are still inline at their call sites; a full brand-align would update those too.

/** Player accent — brighter teal than brand T.accent (#50929c). */
export const PLAYER_ACCENT = '#6AB0BB'
/** Player gold — brighter than brand T.gold (#d7af74). */
export const PLAYER_GOLD = '#E8B458'
/** Player bright text — brighter than brand T.text (#d4e1e5), for high-emphasis copy. */
export const PLAYER_TEXT_BRIGHT = '#E8EEF0'
