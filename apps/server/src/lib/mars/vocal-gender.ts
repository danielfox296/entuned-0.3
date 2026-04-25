// Extract Suno's vocal_gender value from a Decomposition's free-text vocal_character.
// Suno accepts: 'male', 'female', 'duet', or instrumental tracks have no vocal at all.

export type VocalGender = 'male' | 'female' | 'duet' | 'instrumental' | 'unknown'

export function extractVocalGender(vocalCharacter: string | null | undefined): VocalGender {
  if (!vocalCharacter) return 'unknown'
  const v = vocalCharacter.toLowerCase()

  // Instrumental override.
  if (/(no vocals?|instrumental|no singer|wordless)/i.test(vocalCharacter)) return 'instrumental'

  const hasFemale = /\b(female|woman|feminine|she\b)/i.test(vocalCharacter)
  const hasMale = /\b(male|man\b|masculine|he\b)/i.test(vocalCharacter)

  if (/\bduet\b/i.test(vocalCharacter)) return 'duet'
  if (hasFemale && hasMale) return 'duet'
  if (hasFemale) return 'female'
  if (hasMale) return 'male'

  // Heuristic fallbacks for clearly-named vocal styles.
  if (/\b(tenor|baritone|bass)\b/i.test(v)) return 'male'
  if (/\b(soprano|alto|mezzo)\b/i.test(v)) return 'female'

  return 'unknown'
}
