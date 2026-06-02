// @entuned/contracts — shared HTTP response types owned by the server and
// consumed by every frontend. Type-only: this package emits no runtime code.
//
// The server (apps/server/src/routes/*) annotates its handler return objects
// with these types, so TypeScript enforces that the wire shape stays in sync
// with what the clients read. Previously each frontend hand-redefined these
// shapes and they had drifted — admin omitted `store`, under-typed `stores`,
// and both clients called the operator field `displayName` when the server
// actually sends `name`. This package is the single source of truth.

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
