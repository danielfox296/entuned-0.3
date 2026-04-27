import type { OutcomeOption } from "../api.js";

type Props = {
  outcomes: OutcomeOption[];
  activeId: string | null;
  onSelect: (outcomeId: string) => void;
  onClear: (() => void) | null;
  onClose: () => void;
};

export function OutcomeModal({ outcomes, activeId, onSelect, onClear, onClose }: Props) {
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

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {outcomes.map((o) => {
            const active = activeId === o.outcomeId;
            const empty = o.poolSize === 0;
            return (
              <button
                key={o.outcomeId}
                type="button"
                disabled={empty}
                onClick={empty ? undefined : () => onSelect(o.outcomeId)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px solid ${active ? "rgba(94,162,182,0.55)" : "rgba(212,225,229,0.12)"}`,
                  background: active ? "rgba(94,162,182,0.16)" : "rgba(212,225,229,0.04)",
                  color: "rgba(212,225,229,0.9)",
                  cursor: empty ? "not-allowed" : "pointer",
                  opacity: empty ? 0.4 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0.5, textTransform: "uppercase", color: active ? "rgba(94,162,182,1)" : "rgba(212,225,229,0.95)" }}>
                  {o.title}
                </span>
                <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 1, color: "rgba(212,225,229,0.45)" }}>
                  {empty ? "no songs" : `${o.poolSize}`}
                </span>
              </button>
            );
          })}
        </div>

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
