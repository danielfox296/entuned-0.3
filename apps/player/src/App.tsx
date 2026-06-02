import { useEffect, useState } from "react";
import { T } from "@entuned/tokens";
import { PlayerScreen } from "./screens/PlayerScreen.js";
import { clearSession, loadSession, type Session } from "./lib/storage.js";
import { api } from "./api.js";

// Where to bounce a session-less visitor. The player has no recovery UI of
// its own — credentials and password reset live on app.entuned.co.
const APP_URL = "https://app.entuned.co/";

// Read the URL path; trim slashes; an empty result means root (operator-mode entry).
function urlSlug(): string | null {
  const p = window.location.pathname.replace(/^\/+|\/+$/g, '');
  // Single segment, URL-safe-ish — anything more than that isn't a slug.
  if (!p || p.includes('/')) return null;
  return p;
}

export function App() {
  const slug = urlSlug();
  const [slugSession, setSlugSession] = useState<Session | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugLoading, setSlugLoading] = useState<boolean>(slug !== null);
  const [operatorSession, setOperatorSession] = useState<Session | null>(() => (slug ? null : loadSession()));

  // Slug mode: resolve slug → store metadata → synthesize a slug-mode Session.
  // Not persisted (URL is the source of truth on every visit).
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api.storeBySlug(slug)
      .then((store) => {
        if (cancelled) return;
        setSlugSession({
          mode: 'slug',
          token: '',
          storeId: store.id,
          slug: store.slug,
          storeName: store.name,
          clientName: null,
          tier: store.tier,
          operatorId: '',
          email: '',
          isAdmin: false,
        });
        setSlugLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSlugError(err instanceof Error ? err.message : 'Could not load this player.');
        setSlugLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  if (slug) {
    if (slugLoading) {
      return (
        <div style={shellStyle}>Loading…</div>
      );
    }
    if (slugError) {
      return (
        <div style={shellStyle}>
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ color: T.gold, marginBottom: 8 }}>Player not found</div>
            <div style={{ opacity: 0.7 }}>{slugError}</div>
          </div>
        </div>
      );
    }
    return slugSession
      ? <PlayerScreen session={slugSession} onLogout={() => { /* no-op in slug mode */ }} />
      : null;
  }

  // Operator mode: localStorage-persisted session. If missing, bounce to
  // app.entuned.co — that's where credentials, magic-link, and password reset
  // live. Keeps the player surface free of auth recovery UI.
  if (!operatorSession) {
    window.location.replace(APP_URL);
    return <div style={shellStyle}>Redirecting…</div>;
  }
  return (
    <PlayerScreen
      session={operatorSession}
      onLogout={() => {
        clearSession();
        setOperatorSession(null);
      }}
    />
  );
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: T.bg,
  color: T.text,
  fontFamily: "'Inter', sans-serif",
  fontSize: 14,
};
