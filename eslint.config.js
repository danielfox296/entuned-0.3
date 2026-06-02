// Root ESLint flat config for the entuned-0.3 monorepo (ESM).
//
// Scope: TS/TSX sources under apps/** and packages/**.
// Philosophy: LENIENT to start. The goal here is to establish a single
// shared config, not to pay down lint debt in one pass. Most stylistic /
// best-practice rules are downgraded to "warn" so CI and editors surface
// them without blocking. Tighten to "error" incrementally over time.
//
// Note: this uses the non-type-checked typescript-eslint preset, so it does
// not require a TS Program / per-file tsconfig membership. That keeps it fast
// and avoids parser/project wiring across four apps + two packages.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // Ignore build output, deps, and generated artifacts everywhere.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.cache/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },

  // Base recommended sets, scoped to source files only.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // React hooks correctness — keep these as warnings to start.
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      // Downgrade the noisiest TS rules so the config doesn't become a
      // blocker on day one. Revisit and promote to "error" incrementally.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': 'warn',
      'prefer-const': 'warn',
    },
  },
)
