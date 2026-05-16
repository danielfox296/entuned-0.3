/// <reference types="vite/client" />

// Ambient declarations are required in addition to the triple-slash reference
// because pnpm's nested node_modules layout prevents tsc from resolving
// `vite/client` at type-only time. Mirrors apps/player/src/vite-env.d.ts.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
