import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Minimum safe versions per Dependabot advisories (2026-08), enforced via
// pnpm.overrides in the root package.json. Keyed by package, then by major —
// majors absent from the map are not covered by an advisory and pass.
//
// - fast-uri >=3.1.5        GHSA-v2hh-gcrm-f6hx / GHSA-7p8r-x3mc-p8w7 (host confusion)
// - brace-expansion 1.x >=1.1.16, 2.x >=2.1.3
//                           GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg (ReDoS/OOM)
// - find-my-way >=9.7.0     GHSA-c96f-x56v-gq3h (HTTP/2 DDoS)
//
// react-router 6.x (GHSA-jjmj-jmhj-qwj2 et al.) is intentionally absent: no
// patched 6.x exists, the fix is the v7 major, declined 2026-07-14 (ignore-majors).
const FLOORS: Record<string, Record<number, string>> = {
  'fast-uri': { 3: '3.1.5' },
  'brace-expansion': { 1: '1.1.16', 2: '2.1.3' },
  'find-my-way': { 8: '9.7.0', 9: '9.7.0' },
}

function parseVersion(v: string): [number, number, number] {
  const [maj, min, pat] = v.split('.').map(Number)
  return [maj, min, pat]
}

function gte(a: string, b: string): boolean {
  const [am, an, ap] = parseVersion(a)
  const [bm, bn, bp] = parseVersion(b)
  if (am !== bm) return am > bm
  if (an !== bn) return an > bn
  return ap >= bp
}

function resolvedVersions(lockText: string, pkg: string): string[] {
  // Lockfile entries look like `  fast-uri@3.1.3:` (packages section) or
  // `  react-router@6.30.4(react@19.2.7):` (snapshots section, peer suffix).
  const re = new RegExp(`^  ${pkg.replace('/', '\\/')}@(\\d+\\.\\d+\\.\\d+)[:(]`, 'gm')
  const versions = new Set<string>()
  for (const match of lockText.matchAll(re)) versions.add(match[1])
  return [...versions]
}

describe('dependency security floors (pnpm-lock.yaml)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const lockText = readFileSync(resolve(here, '../../../../pnpm-lock.yaml'), 'utf8')

  for (const [pkg, floorsByMajor] of Object.entries(FLOORS)) {
    it(`${pkg} resolutions meet the advisory floor`, () => {
      const versions = resolvedVersions(lockText, pkg)
      expect(versions.length).toBeGreaterThan(0)
      const belowFloor = versions.filter((v) => {
        const floor = floorsByMajor[parseVersion(v)[0]]
        return floor !== undefined && !gte(v, floor)
      })
      expect(belowFloor, `${pkg} resolved below advisory floor`).toEqual([])
    })
  }
})
