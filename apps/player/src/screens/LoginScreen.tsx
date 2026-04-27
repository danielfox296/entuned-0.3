import { useState } from "react";
import { api } from "../api.js";
import { saveSession, type Session } from "../lib/storage.js";
import logoUrl from "/entuned_logo.png";

type Props = {
  onAuthed: (s: Session) => void;
};

export function LoginScreen({ onAuthed }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setError(null);
    setBusy(true);
    try {
      const auth = await api.login(email.trim().toLowerCase(), password);
      const me = await api.me(auth.token);
      // Non-admin operators: server returns a single `store`. Admins (who use
      // this player only for testing) get the first of their `stores`.
      const store = me.store ?? me.stores[0] ?? null;
      if (!store) {
        setError("No store associated with this account.");
        setBusy(false);
        return;
      }
      const session: Session = {
        token: auth.token,
        storeId: store.id,
        storeName: store.name,
        clientName: store.clientName ?? null,
        operatorId: me.operator.id,
        email: me.operator.email,
        displayName: me.operator.displayName,
        isAdmin: me.operator.isAdmin,
        availableStores: me.stores,
      };
      saveSession(session);
      onAuthed(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.startsWith("401") ? "Wrong email or password." : "Login failed. Check your network and try again.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, #1a1a1f 0%, #0a0a0a 60%, #050505 100%)",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 380, width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
        <header style={{ textAlign: "center", marginBottom: 12 }}>
          <img src={logoUrl} alt="Entuned" style={{ width: 180, opacity: 0.9 }} />
        </header>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            type="email"
            autoComplete="username"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            style={{ fontSize: 14, padding: "0.9em", letterSpacing: 2, textTransform: "uppercase" }}
          >
            {busy ? "…" : "Sign in"}
          </button>
          {error ? (
            <div style={{ color: "rgba(231,76,60,0.95)", fontSize: 13, textAlign: "center" }}>{error}</div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
