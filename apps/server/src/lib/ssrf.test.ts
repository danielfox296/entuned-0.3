import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DNS so tests run offline. Each test sets what a hostname resolves to.
const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}))

const { isBlockedIp, assertPublicUrl, safeFetch } = await import('./ssrf.js')

function resolvesTo(...addresses: string[]) {
  lookupMock.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))
}

describe('isBlockedIp — internal address ranges (SEC-5)', () => {
  it('blocks the cloud metadata endpoint', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true)
  })

  it('blocks loopback, private, CGNAT, and reserved IPv4 ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows normal public IPv4 addresses', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('blocks IPv6 loopback, ULA, and link-local', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('unwraps IPv4-mapped/embedded IPv6 and blocks internal targets', () => {
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIp('::127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertPublicUrl (SEC-5)', () => {
  beforeEach(() => lookupMock.mockReset())

  it('rejects non-https schemes', async () => {
    await expect(assertPublicUrl('http://cdn1.suno.ai/x.mp3')).rejects.toThrow(/only https/)
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/only https/)
  })

  it('rejects an https URL with a private-IP literal host without any DNS lookup', async () => {
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/internal IP/)
    await expect(assertPublicUrl('https://127.0.0.1:3000/admin')).rejects.toThrow(/internal IP/)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to an internal IP (DNS rebinding)', async () => {
    resolvesTo('169.254.169.254')
    await expect(assertPublicUrl('https://sneaky.example.com/x')).rejects.toThrow(/resolves to internal IP/)
  })

  it('rejects when ANY resolved address is internal', async () => {
    resolvesTo('93.184.216.34', '10.0.0.9')
    await expect(assertPublicUrl('https://multi.example.com/x')).rejects.toThrow(/resolves to internal IP/)
  })

  it('accepts a public https URL', async () => {
    resolvesTo('93.184.216.34')
    const u = await assertPublicUrl('https://cdn1.suno.ai/abc.mp3')
    expect(u.hostname).toBe('cdn1.suno.ai')
  })
})

describe('safeFetch — redirect pinning (SEC-5)', () => {
  beforeEach(() => lookupMock.mockReset())

  it('follows a redirect only after re-validating the new host', async () => {
    resolvesTo('93.184.216.34')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: 'https://cdn2.suno.ai/final.mp3' }) })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), url: 'https://cdn2.suno.ai/final.mp3' })
    vi.stubGlobal('fetch', fetchMock)

    const res = await safeFetch('https://cdn1.suno.ai/start.mp3')
    expect(res.status).toBe(200)
    // Both hops used manual redirect handling.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('blocks a redirect that points at an internal address', async () => {
    // First host is public; the redirect target resolves to metadata IP.
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // start host
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]) // redirect host
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: 'https://internal.example.com/meta' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeFetch('https://public.example.com/x')).rejects.toThrow(/resolves to internal IP/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // never fetched the internal target
  })

  it('throws on a redirect loop past the hop cap', async () => {
    resolvesTo('93.184.216.34')
    const fetchMock = vi.fn().mockResolvedValue({ status: 302, headers: new Headers({ location: 'https://loop.example.com/next' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeFetch('https://loop.example.com/start')).rejects.toThrow(/too many redirects/)
  })
})
