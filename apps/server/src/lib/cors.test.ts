import { describe, it, expect } from 'vitest'
import { isAllowedOrigin } from './cors.js'

describe('isAllowedOrigin — SEC-4 CORS allowlist', () => {
  it('allows each production app origin', () => {
    expect(isAllowedOrigin('https://app.entuned.co')).toBe(true)
    expect(isAllowedOrigin('https://dash.entuned.co')).toBe(true)
    expect(isAllowedOrigin('https://music.entuned.co')).toBe(true)
  })

  it('allows localhost dev origins on any port and scheme', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5178')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true)
    expect(isAllowedOrigin('https://localhost')).toBe(true)
  })

  it('allows requests with no Origin (server-to-server, curl, healthcheck)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin(null)).toBe(true)
    expect(isAllowedOrigin('')).toBe(true)
  })

  it('does NOT reflect a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false)
    expect(isAllowedOrigin('https://entuned.co.evil.com')).toBe(false)
    expect(isAllowedOrigin('https://app.entuned.co.evil.com')).toBe(false)
    expect(isAllowedOrigin('https://notentuned.co')).toBe(false)
  })

  it('rejects the brand site + api origin (they make no credentialed calls here)', () => {
    // entuned.co posts its forms to Formspree, not this API.
    expect(isAllowedOrigin('https://entuned.co')).toBe(false)
    expect(isAllowedOrigin('https://api.entuned.co')).toBe(false)
  })

  it('rejects a subdomain that merely embeds an allowed host as a substring', () => {
    expect(isAllowedOrigin('https://app.entuned.co.attacker.net')).toBe(false)
    expect(isAllowedOrigin('http://localhost.attacker.net')).toBe(false)
  })
})
