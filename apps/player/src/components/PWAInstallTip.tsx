import { useEffect, useState } from "react";
import { T } from "@entuned/tokens";
import { PLAYER_ACCENT } from "../theme.js";

const DISMISS_KEY = "entuned.pwa_tip_dismissed_v1";

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari pre-spec property.
  if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return false;
}

function isIOSSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  if (!isIOS) return false;
  // Exclude in-app browsers and Chrome/Firefox/Edge on iOS — Add-to-Home from
  // those doesn't produce the same standalone behavior the tip is promising.
  return !/CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Line\//i.test(ua);
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Discreet banner promoting "Add to Home Screen" so the player runs in a
// standalone WebView — Safari kills tabs aggressively under memory pressure
// and during lock/alarm events. Standalone mode is meaningfully more durable.
//
// iOS Safari: static instruction text (Apple offers no install-prompt API).
// Android Chrome: native prompt via beforeinstallprompt.
// Already-standalone or unsupported browsers: renders nothing.
export function PWAInstallTip() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"ios" | "android" | null>(null);
  const [androidPrompt, setAndroidPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandaloneMode()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {}
    if (isIOSSafari()) {
      setMode("ios");
      setVisible(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setAndroidPrompt(e as BeforeInstallPromptEvent);
      setMode("android");
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };

  const install = async () => {
    if (!androidPrompt) return;
    try {
      await androidPrompt.prompt();
      await androidPrompt.userChoice;
    } catch {}
    dismiss();
  };

  if (!visible || !mode) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        maxWidth: 480,
        width: "calc(100% - 28px)",
        background: "rgba(22,21,18,0.92)",
        border: "1px solid rgba(212,225,229,0.18)",
        borderRadius: 12,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "'Inter', sans-serif",
        fontSize: 12.5,
        color: "rgba(212,225,229,0.85)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <span style={{ flex: 1, lineHeight: 1.4 }}>
        {mode === "ios" ? (
          <>For uninterrupted playback through alarms and the lock screen, tap <strong style={{ color: T.text }}>Share</strong> → <strong style={{ color: T.text }}>Add to Home Screen</strong>.</>
        ) : (
          <>Install Entuned for uninterrupted playback through notifications and the lock screen.</>
        )}
      </span>
      {mode === "android" && (
        <button
          onClick={install}
          style={{
            background: PLAYER_ACCENT,
            color: "#0d0d0a",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          color: "rgba(212,225,229,0.55)",
          border: "none",
          fontSize: 18,
          lineHeight: 1,
          padding: "2px 4px",
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}
