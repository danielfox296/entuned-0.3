import { useState } from "react";
import type { OutcomeOption } from "../api.js";

// Free-tier upgrade-CTA destination. Anchor #outcomes scrolls users into the
// "more outcomes" section of the upgrade page.
const UPGRADE_URL = "https://app.entuned.co/upgrade#outcomes";

type Props = {
  outcomes: OutcomeOption[];
  activeId: string | null;
  allOutcomesMode: boolean;
  /** Effective viewer tier — drives free-tier locking. */
  viewerTier?: string;
  onSelect: (outcomeId: string) => void;
  onSelectAll: () => void;
  onClear: (() => void) | null;
  onClose: () => void;
};

export function OutcomeModal({ outcomes, activeId, allOutcomesMode, viewerTier, onSelect, onSelectAll, onClear, onClose }: Props) {
  // When a free-tier user taps a locked tile, the modal's footer bar updates
  // to surface the upgrade CTA without stacking another modal on top.
  const [pitchedOutcome, setPitchedOutcome] = useState<OutcomeOption | null>(null);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(20,20,22,0.95)",
          border: "1px solid rgba(212,225,229,0.12)",
          borderRadius: 20,
          padding: "32px 28px 28px",
          maxWidth: 460,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: 2.5, color: "rgba(212,225,229,0.55)", textTransform: "uppercase" }}>
            Outcome
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", color: "rgba(212,225,229,0.5)", fontSize: 22, cursor: "pointer", padding: 4, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* All Outcomes option */}
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            onClick={onSelectAll}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: 12,
              border: `1px solid ${allOutcomesMode ? "rgba(80,146,156,0.55)" : "rgba(212,225,229,0.12)"}`,
              background: allOutcomesMode ? "rgba(80,146,156,0.16)" : "rgba(212,225,229,0.04)",
              color: "rgba(212,225,229,0.9)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0.5, textTransform: "uppercase", color: allOutcomesMode ? "rgba(80,146,156,1)" : "rgba(212,225,229,0.95)" }}>
              All Outcomes
            </span>
            <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 1, color: "rgba(212,225,229,0.45)" }}>
              {outcomes.reduce((sum, o) => sum + o.poolSize, 0)}
            </span>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {outcomes.map((o) => {
            const active = !allOutcomesMode && activeId === o.outcomeId;
            const empty = o.poolSize === 0;
            // Free-tier lock: viewer is on free AND outcome is not in allowlist.
            // Takes priority over "no songs" — operator gating is the salient state.
            const locked = viewerTier === "free" && !o.availableOnFree;
            const disabled = locked || empty;
            return (
              <button
                key={o.outcomeId}
                type="button"
                disabled={empty && !locked}
                onClick={
                  locked ? () => setPitchedOutcome(o)
                  : empty ? undefined
                  : () => onSelect(o.outcomeId)
                }
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px solid ${active ? "rgba(80,146,156,0.55)" : "rgba(212,225,229,0.12)"}`,
                  background: active ? "rgba(80,146,156,0.16)" : "rgba(212,225,229,0.04)",
                  color: "rgba(212,225,229,0.9)",
                  cursor: disabled ? (locked ? "pointer" : "not-allowed") : "pointer",
                  opacity: disabled ? 0.45 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {locked ? (
                    <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1, opacity: 0.7 }}>🔒</span>
                  ) : null}
                  <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0.5, textTransform: "uppercase", color: active ? "rgba(80,146,156,1)" : "rgba(212,225,229,0.95)" }}>
                    {o.title}
                  </span>
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.4, color: locked ? "rgba(215,175,116,0.85)" : "rgba(212,225,229,0.45)", textTransform: "uppercase" }}>
                  {locked ? "Core" : empty ? "no songs" : `${o.poolSize}`}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer bar: upgrade pitch when a locked outcome is tapped. Persistent
            inside the modal so the CTA stays visible while the user browses. */}
        {pitchedOutcome ? (
          <div style={{
            marginTop: 18,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(215,175,116,0.4)",
            background: "rgba(215,175,116,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}>
            <span style={{ fontSize: 13, color: "rgba(212,225,229,0.85)", fontWeight: 400, lineHeight: 1.35 }}>
              <span aria-hidden="true" style={{ marginRight: 6 }}>🔒</span>
              <strong style={{ fontWeight: 600, color: "rgba(212,225,229,0.95)" }}>{pitchedOutcome.title}</strong>
              <span style={{ opacity: 0.75 }}> — available on Core</span>
            </span>
            <a
              href={UPGRADE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                background: "rgba(215,175,116,0.18)",
                border: "1px solid rgba(215,175,116,0.55)",
                color: "rgba(215,175,116,1)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              Upgrade →
            </a>
          </div>
        ) : null}

        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            style={{
              marginTop: 18,
              width: "100%",
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid rgba(240,153,123,0.35)",
              background: "rgba(240,153,123,0.06)",
              color: "rgba(240,153,123,0.95)",
              fontSize: 11,
              letterSpacing: 2,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Clear selection
          </button>
        ) : null}
      </div>
    </div>
  );
}
