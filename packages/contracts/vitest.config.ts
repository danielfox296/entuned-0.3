import { defineConfig } from 'vitest/config'

// TST-3: index.test.ts is pure `expectTypeOf(...).toEqualTypeOf(...)` — a runtime
// NO-OP under `vitest run` unless typecheck is enabled. Without this config the
// contract "passed" no matter how the shared response shapes drifted; the only
// real enforcement lived in the separate `pnpm build`/tsc step.
//
// Enabling test.typecheck makes `vitest run` (the same command the deploy gate
// runs via `pnpm test`) actually type-check these files with tsc, so the
// existing type assertions — and the `@ts-expect-error` guard on the historical
// `displayName` drift — become load-bearing.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      // Default only matches *.test-d.ts; our type assertions live in *.test.ts.
      include: ['src/**/*.test.ts'],
    },
  },
})
