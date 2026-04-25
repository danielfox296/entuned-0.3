// Extract Suno's vocal_gender value from a Decomposition's free-text vocal_character.
// Suno accepts: 'male', 'female', 'duet', or instrumental tracks have no vocal at all.

export type VocalGender = 'male' | 'female' | 'duet' | 'instrumental' | 'unknown'

const FEMALE_TERMS = /\b(female|woman|feminine|soprano|alto|mezzo)\b/i
const MALE_TERMS = /\b(male|masculine|tenor|baritone|bass\s+vocal|bass\s+singer)\b/i

export function extractVocalGender(vocalCharacter: string | null | undefined): VocalGender {
  if (!vocalCharacter) return 'unknown'

  // Instrumental override.
  if (/(no vocals?|instrumental|no singer|wordless)/i.test(vocalCharacter)) return 'instrumental'

  if (/\bduet\b/i.test(vocalCharacter)) return 'duet'

  const hasFemale = FEMALE_TERMS.test(vocalCharacter)
  const hasMale = MALE_TERMS.test(vocalCharacter)

  if (hasFemale && hasMale) return 'duet'
  if (hasFemale) return 'female'
  if (hasMale) return 'male'

  return 'unknown'
}
