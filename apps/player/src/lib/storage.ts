const SESSION_KEY = "entuned.session.v1";

export interface Session {
  token: string;
  storeId: string;
  storeName: string;
  clientName: string | null;
  operatorId: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
  /** All stores this operator can switch to. Length > 1 enables the in-app switcher. */
  availableStores?: { id: string; name: string; clientName: string | null }[];
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
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
