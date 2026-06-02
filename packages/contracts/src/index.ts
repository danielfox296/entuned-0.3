// @entuned/contracts — shared HTTP response types for Entuned's API,
// consumed by the frontends (admin + player). Type-only: emits no runtime code.
//
// Previously each frontend hand-redefined these shapes and they had drifted —
// admin omitted `store`, under-typed `stores`, and both clients called the
// operator field `displayName` when the server actually sends `name`. This
// package is the single client-side source of truth for those shapes.
//
// NOTE: the server (apps/server) deliberately does NOT depend on this package.
// Railway builds the server with build context = apps/server only, so a
// `workspace:*` dependency can't be resolved there (it breaks `pnpm install`).
// The server therefore keeps its own local return types in auth.ts. If we ever
// want compile-time server↔client conformance, that requires changing the
// Railway build context (an infra decision) — see auth.ts `/auth/me`.
// Keep these shapes in sync with apps/server/src/routes/auth.ts by hand.

/** Operator identity returned by POST /auth/login (no display name). */
export interface AuthOperator {
  id: string
  email: string
  isAdmin: boolean
}

/** Operator identity returned by GET /auth/me (includes display name). */
export interface MeOperator {
  id: string
  email: string
  /** Account.name — nullable in the schema. The wire field is `name`. */
  name: string | null
  isAdmin: boolean
}

/** Per-operator store summary in the /auth/me response. */
export interface MeStore {
  id: string
  name: string
  clientName: string | null
  /** Effective tier ('free' | 'core' | 'pro' | ...) as a plain string. */
  tier: string
}

/** POST /auth/login response. */
export interface AuthResponse {
  token: string
  operator: AuthOperator
}

/** GET /auth/me response. */
export interface MeResponse {
  operator: MeOperator
  /** Single store for non-admin operators (login determines store). Null for admins. */
  store: MeStore | null
  /** Cross-store list for admins; for non-admins, the operator's assignments. */
  stores: MeStore[]
}
