import { useEffect, useState } from "react";
import { T } from "@entuned/tokens";
import { PLAYER_ACCENT, PLAYER_TEXT_BRIGHT } from "../theme.js";
import type { StationOption } from "../api.js";

// Station picker. Deliberately mirrors OutcomeModal's shell — same overlay,
// radius, header, row treatment — so the two selection surfaces read as one
// product rather than two designs. The axes are different (a Station is what
// the music SOUNDS like; an Outcome is what it's FOR) but the gesture is the
// same, so the chrome should be too.
//
// Switching is free and unlimited: no tier gate, no lock rows, no upgrade
// footer. That's the whole difference from OutcomeModal, and it's deliberate —
// retention beats friction (Daniel, 2026-08-06).

const TEAL = PLAYER_ACCENT;
const TEAL_TINT = "rgba(106,176,187,0.16)";
const TEAL_BORDER = "rgba(106,176,187,0.55)";
const TEAL_BORDER_FAINT = "rgba(106,176,187,0.18)";

type Props = {
  stations: StationOption[];
  activeId: string | null;
  onSelect: (stationId: string) => void;
  onClose: () => void;
};

export function StationModal({ stations, activeId, onSelect, onClose }: Props) {
  // Same viewport-density trick as OutcomeModal: six rows plus header at
  // comfortable sizing spills off short tablet/phone-landscape screens.
  const [winH, setWinH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 1024));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const compact = winH < 760;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#16161a",
          border: `1px solid ${TEAL_BORDER_FAINT}`,
          borderRadius: 18,
          maxWidth: 480,
          width: "100%",
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02)",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: compact ? "14px 22px 12px" : "22px 24px 16px",
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
            fontSize: compact ? "clamp(15px, 4.6vw, 18px)" : "clamp(16px, 4.6vw, 22px)",
            fontWeight: 700,
            color: PLAYER_TEXT_BRIGHT,
            letterSpacing: "-0.01em",
          }}>
            Pick your sound
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(212,225,229,0.55)",
              fontSize: 22,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: compact ? "12px 16px 16px" : "16px 20px 22px", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
            {stations.map((s) => (
              <StationRow
                key={s.id}
                name={s.displayName}
                subtitle={s.subtitle}
                active={activeId === s.id}
                stocked={s.stocked}
                compact={compact}
                onClick={() => onSelect(s.id)}
              />
            ))}
          </div>

          {/* Switching costs nothing — say so, so nobody treats the pick as
              a commitment they have to get right the first time. */}
          <div style={{
            marginTop: compact ? 12 : 16,
            fontSize: 12,
            lineHeight: 1.45,
            color: "rgba(212,225,229,0.45)",
            textAlign: "center",
          }}>
            Change it as often as you like — switching is always free.
          </div>
        </div>
      </div>
    </div>
  );
}

function StationRow({
  name, subtitle, active, stocked, compact, onClick,
}: {
  name: string;
  subtitle: string | null;
  active: boolean;
  stocked: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  // Unstocked stations stay selectable — the pick is real and persists, and it
  // starts shaping playback the moment songs land. Dimming them into a
  // disabled state would hide a choice the customer is allowed to make.
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: compact ? "9px 14px" : "13px 16px",
        borderRadius: 11,
        border: `1px solid ${active ? TEAL_BORDER : "rgba(255,255,255,0.07)"}`,
        background: active ? TEAL_TINT : "rgba(255,255,255,0.025)",
        color: T.text,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{
          fontSize: compact ? 14 : 15,
          fontWeight: 600,
          letterSpacing: 0.2,
          color: active ? TEAL : PLAYER_TEXT_BRIGHT,
        }}>
          {name}
        </span>
        {subtitle ? (
          <span style={{
            fontSize: 12,
            fontWeight: 400,
            letterSpacing: 0.1,
            color: "rgba(212,225,229,0.55)",
            lineHeight: 1.25,
            // Override the global `button { text-transform: uppercase }` — the
            // subtitle is prose, not a label.
            textTransform: "none",
          }}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {!stocked ? (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "rgba(212,225,229,0.45)",
          whiteSpace: "nowrap",
        }}>
          building
        </span>
      ) : null}
    </button>
  );
}
