import { useState } from "react";
import { LoginScreen } from "./screens/LoginScreen.js";
import { PlayerScreen } from "./screens/PlayerScreen.js";
import { clearSession, loadSession, type Session } from "./lib/storage.js";

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  if (!session) {
    return <LoginScreen onAuthed={setSession} />;
  }
  return (
    <PlayerScreen
      session={session}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}
