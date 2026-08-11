import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Minimum safe versions per Dependabot advisories (2026-08), enforced via
// pnpm.overrides in the root package.json. Keyed by package, then by major —
// majors absent from the map are not covered by an advisory and pass.
//
// - fast-uri >=3.1.5        GHSA-v2hh-gcrm-f6hx / GHSA-7p8r-x3mc-p8w7 (host confusion)
// - brace-expansion 1.x >=1.1.16, 2.x >=2.1.3
//                           GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg (ReDoS/OOM)
// - find-my-way >=9.7.0     GHSA-c96f-x56v-gq3h (HTTP/2 DDoS)
// - nanoid >=3.3.17         GHSA-2v37-7h3g-55p8 (infinite loop, fixed on 3.x line)
// - js-yaml >=4.3.1         GHSA-5p4m-2wfm-xmqj (!!omap quadratic CPU; 3.x has no
//                           backport, so any 3.x resolution fails too)
// - postcss >=8.5.23        GHSA-fxqj-rqcc-2cmp (sourceMappingURL file read)
//
// react-router 6.x (GHSA-jjmj-jmhj-qwj2 et al.) is intentionally absent: no
// patched 6.x exists, the fix is the v7 major, declined 2026-07-14 (ignore-majors).
const FLOORS: Record<string, Record<number, string>> = {
  'fast-uri': { 3: '3.1.5' },
  'brace-expansion': { 1: '1.1.16', 2: '2.1.3' },
  'find-my-way': { 8: '9.7.0', 9: '9.7.0' },
  nanoid: { 1: '3.3.17', 2: '3.3.17', 3: '3.3.17' },
  'js-yaml': { 3: '4.3.1', 4: '4.3.1' },
  postcss: { 7: '8.5.23', 8: '8.5.23' },
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

// Railway's build mounts apps/server at /app without the monorepo root, so
// the lockfile is not at a fixed relative path — find it by walking up from
// both the test file and the cwd. When absent (Railway), skip loudly: the
// floors are still enforced at install time by pnpm.overrides, and this test
// runs from a full checkout locally and in both Pages workflows.
function findLockfile(startDirs: string[]): string | null {
  for (const start of startDirs) {
    let dir = start
    for (;;) {
      const candidate = join(dir, 'pnpm-lock.yaml')
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

const lockPath = findLockfile([dirname(fileURLToPath(import.meta.url)), process.cwd()])
if (!lockPath) {
  console.warn('[dependencyFloors] pnpm-lock.yaml not found from test dir or cwd — skipping floor checks in this environment')
}

describe.skipIf(!lockPath)('dependency security floors (pnpm-lock.yaml)', () => {
  const lockText = readFileSync(lockPath!, 'utf8')

  it('lockfile parser matches at least one covered package', () => {
    // Guards against a lockfile format change making every check vacuous.
    // Per-package absence is allowed: a pruned lockfile (Railway) may lack
    // frontend-only packages, and absent is not vulnerable.
    const total = Object.keys(FLOORS).reduce((n, pkg) => n + resolvedVersions(lockText, pkg).length, 0)
    expect(total).toBeGreaterThan(0)
  })

  for (const [pkg, floorsByMajor] of Object.entries(FLOORS)) {
    it(`${pkg} resolutions meet the advisory floor`, () => {
      const belowFloor = resolvedVersions(lockText, pkg).filter((v) => {
        const floor = floorsByMajor[parseVersion(v)[0]]
        return floor !== undefined && !gte(v, floor)
      })
      expect(belowFloor, `${pkg} resolved below advisory floor`).toEqual([])
    })
  }
})
