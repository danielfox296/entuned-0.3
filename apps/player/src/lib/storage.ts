const SESSION_KEY = "entuned.session.v1";

export interface Session {
  token: string;
  storeId: string;
  storeName: string;
  operatorId: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
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
