import { describe, it, expect } from 'vitest'
import { requireMingusUrl } from './port-era-reference.js'

describe('requireMingusUrl', () => {
  it('throws a clear error when MINGUS_DATABASE_URL is unset', () => {
    expect(() => requireMingusUrl({})).toThrowError(/MINGUS_DATABASE_URL is not set/)
  })

  it('throws when MINGUS_DATABASE_URL is an empty string', () => {
    expect(() => requireMingusUrl({ MINGUS_DATABASE_URL: '' })).toThrowError(
      /MINGUS_DATABASE_URL is not set/,
    )
  })

  it('returns the URL when set — no hardcoded fallback', () => {
    const url = 'postgresql://user:pass@host:5432/db'
    expect(requireMingusUrl({ MINGUS_DATABASE_URL: url })).toBe(url)
  })
})
