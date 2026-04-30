// Variance resolver — samples concrete tempo + mode from an Outcome's distribution.
//
// SonicProfile parameters used to be fixed point values on Outcome (tempo=120, mode=major).
// Generation pulled from a single target, producing tracks that sounded too similar to each
// other. Variance bands let an Outcome express a distribution; this module draws one
// concrete value per seed.
//
// Pure function (modulo the random source), no DB access. Called in createSongSeed()
// before the OutcomeFactorPrompt fills tokens.

export interface VarianceInput {
  tempoBpm: number
  tempoBpmRadius?: number | null
  mode: string
  modeWeights?: unknown // Prisma Json — validated at runtime
}

export interface ResolvedOutcome {
  tempoBpm: number
  mode: string
}

export interface ResolveOptions {
  /** Inject a deterministic RNG for tests. Defaults to Math.random. */
  random?: () => number
}

export function resolveOutcomeParams(input: VarianceInput, opts: ResolveOptions = {}): ResolvedOutcome {
  const rand = opts.random ?? Math.random
  return {
    tempoBpm: resolveTempo(input.tempoBpm, input.tempoBpmRadius ?? null, rand),
    mode: resolveMode(input.mode, input.modeWeights, rand),
  }
}

function resolveTempo(center: number, radius: number | null, rand: () => number): number {
  if (radius == null || radius <= 0) return center
  const lo = center - radius
  const hi = center + radius
  // Uniform integer in [lo, hi], inclusive.
  return Math.floor(rand() * (hi - lo + 1)) + lo
}

function resolveMode(primary: string, weights: unknown, rand: () => number): string {
  const dist = parseModeWeights(weights)
  if (!dist) return primary
  const total = dist.reduce((s, [, w]) => s + w, 0)
  if (total <= 0) return primary
  let r = rand() * total
  for (const [mode, w] of dist) {
    r -= w
    if (r <= 0) return mode
  }
  // Floating-point rounding fallback.
  return dist[dist.length - 1][0]
}

function parseModeWeights(weights: unknown): Array<[string, number]> | null {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return null
  const entries: Array<[string, number]> = []
  for (const [k, v] of Object.entries(weights as Record<string, unknown>)) {
    if (typeof v === 'number' && v > 0 && k.length > 0) entries.push([k, v])
  }
  return entries.length > 0 ? entries : null
}
