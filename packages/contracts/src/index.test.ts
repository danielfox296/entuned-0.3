import { describe, it, expectTypeOf } from 'vitest'
import type { AuthOperator, MeOperator, MeStore, AuthResponse, MeResponse } from './index.js'

// Type-level contract guards. These compile-time assertions fail the build if
// the shared response shapes drift from what the server sends / clients read.
describe('@entuned/contracts shapes', () => {
  it('AuthResponse matches POST /auth/login', () => {
    expectTypeOf<AuthResponse>().toEqualTypeOf<{
      token: string
      operator: { id: string; email: string; isAdmin: boolean }
    }>()
  })

  it('MeResponse matches GET /auth/me (operator uses `name`, includes `store` + full `stores`)', () => {
    expectTypeOf<MeResponse>().toEqualTypeOf<{
      operator: { id: string; email: string; name: string | null; isAdmin: boolean }
      store: { id: string; name: string; clientName: string | null; tier: string } | null
      stores: { id: string; name: string; clientName: string | null; tier: string }[]
    }>()
  })

  it('operator field is `name`, never `displayName` (the historical drift)', () => {
    expectTypeOf<MeOperator>().toHaveProperty('name')
    // @ts-expect-error — displayName was the wrong client-side name; it must not exist.
    expectTypeOf<MeOperator>().toHaveProperty('displayName')
  })

  it('AuthOperator has no display name; MeStore carries clientName + tier', () => {
    expectTypeOf<AuthOperator>().toEqualTypeOf<{ id: string; email: string; isAdmin: boolean }>()
    expectTypeOf<MeStore>().toEqualTypeOf<{ id: string; name: string; clientName: string | null; tier: string }>()
  })
})
