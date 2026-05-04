const SESSION_KEY = "entuned.session.v1";

export interface Session {
  /**
   * 'operator' = admin/staff signed in via /auth/login (token-bearing).
   * 'slug'     = freemium player at music.entuned.co/<slug>; URL is the auth.
   */
  mode: 'operator' | 'slug';
  token: string;       // empty string in slug mode
  storeId: string;
  slug?: string;       // present in slug mode
  storeName: string;
  clientName: string | null;
  operatorId: string;  // empty string in slug mode
  email: string;       // empty string in slug mode
  displayName?: string | null;
  isAdmin: boolean;
  /** All stores this operator can switch to. Length > 1 enables the in-app switcher. */
  availableStores?: { id: string; name: string; clientName: string | null }[];
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    // Legacy sessions (pre-2026-05-04) lack `mode` — default to operator.
    if (!parsed.mode) parsed.mode = 'operator';
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
