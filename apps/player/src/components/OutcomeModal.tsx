import { useEffect, useMemo, useState } from "react";
import type { OutcomeOption } from "../api.js";

// Free-tier upgrade-CTA destination. Anchor #outcomes scrolls users into the
// "more outcomes" section of the upgrade page.
const UPGRADE_URL = "https://app.entuned.co/upgrade#outcomes";

// Brand teal — drives the modal's accent color throughout. No gold in this
// surface; gold reads as Pro-tier signal elsewhere in the app and we want
// the upsell here to feel like the same brand, not a different product.
const TEAL = "#6AB0BB";
const TEAL_TINT = "rgba(106,176,187,0.16)";
const TEAL_BORDER = "rgba(106,176,187,0.55)";
const TEAL_BORDER_FAINT = "rgba(106,176,187,0.18)";

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
  const isFree = viewerTier === "free";

  // Split outcomes into available-now vs locked-on-Core. Available come first
  // so the two free-tier outcomes are above the fold on phones; locked outcomes
  // group below under their own header. Paid tiers see no split — the locked
  // branch is empty.
  const { available, locked } = useMemo(() => {
    const a: OutcomeOption[] = [];
    const l: OutcomeOption[] = [];
    for (const o of outcomes) {
      if (isFree && !o.availableOnFree) l.push(o);
      else a.push(o);
    }
    return { available: a, locked: l };
  }, [outcomes, isFree]);

  // When a user taps a locked tile, briefly pulse the persistent upgrade bar
  // so they see where the unlock action lives. No navigation on the tile itself
  // — explicit click on Upgrade is required (avoids reading too much into a tap).
  const [pulseFooter, setPulseFooter] = useState(false);
  useEffect(() => {
    if (!pulseFooter) return;
    const t = setTimeout(() => setPulseFooter(false), 900);
    return () => clearTimeout(t);
  }, [pulseFooter]);

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
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02)",
        }}
      >
        {/* Header — title large enough to dominate the row labels below */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 24px 16px",
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
            fontSize: 22,
            fontWeight: 700,
            color: "#e8eef0",
            letterSpacing: "-0.01em",
          }}>
            Choose an outcome
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

        {/* Scrollable body — grouped "Available" then "Available on Core" */}
        <div style={{ overflowY: "auto", padding: "16px 20px 20px", flex: 1 }}>
          <SectionLabel>Available now</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            {/* All Outcomes — same row treatment as a peer outcome */}
            <OutcomeRow
              label="All Outcomes"
              count={available.reduce((sum, o) => sum + o.poolSize, 0)}
              active={allOutcomesMode}
              empty={false}
              locked={false}
              onClick={onSelectAll}
            />
            {available.map((o) => (
              <OutcomeRow
                key={o.outcomeId}
                label={o.title}
                count={o.poolSize}
                active={!allOutcomesMode && activeId === o.outcomeId}
                empty={o.poolSize === 0}
                locked={false}
                onClick={() => o.poolSize > 0 && onSelect(o.outcomeId)}
              />
            ))}
          </div>

          {locked.length > 0 && (
            <>
              <SectionLabel>Available on Core</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {locked.map((o) => (
                  <OutcomeRow
                    key={o.outcomeId}
                    label={o.title}
                    active={false}
                    empty={false}
                    locked
                    onClick={() => setPulseFooter(true)}
                  />
                ))}
              </div>
            </>
          )}

          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              style={{
                marginTop: 18,
                width: "100%",
                padding: "11px 16px",
                borderRadius: 10,
                border: "1px solid rgba(240,153,123,0.35)",
                background: "rgba(240,153,123,0.06)",
                color: "rgba(240,153,123,0.95)",
                fontSize: 11,
                letterSpacing: 1.6,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Clear selection
            </button>
          ) : null}
        </div>

        {/* Persistent upgrade footer — free tier only. Always visible at the
            bottom of the modal so the CTA is never below the fold. */}
        {isFree && locked.length > 0 ? (
          <a
            href={UPGRADE_URL}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 24px",
              borderTop: `1px solid ${TEAL_BORDER_FAINT}`,
              borderBottomLeftRadius: 18,
              borderBottomRightRadius: 18,
              background: pulseFooter ? TEAL : TEAL_TINT,
              color: pulseFooter ? "#0d0d0a" : "#cfeef3",
              textDecoration: "none",
              transition: "background 0.25s ease, color 0.25s ease, box-shadow 0.25s ease",
              boxShadow: pulseFooter ? `0 0 0 3px ${TEAL_BORDER}` : "none",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}>
                Unlock all 9 outcomes
              </span>
              <span style={{
                fontSize: 12,
                opacity: 0.85,
                fontWeight: 400,
              }}>
                Music tuned to your customer · $99/loc/mo
              </span>
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              padding: "8px 14px",
              borderRadius: 999,
              background: pulseFooter ? "rgba(13,13,10,0.18)" : TEAL,
              color: pulseFooter ? "#0d0d0a" : "#0d0d0a",
              whiteSpace: "nowrap",
            }}>
              Upgrade →
            </span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.16em",
      color: "rgba(212,225,229,0.45)",
      textTransform: "uppercase",
      margin: "4px 4px 10px",
    }}>
      {children}
    </div>
  );
}

function OutcomeRow({
  label, count, active, empty, locked, onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  empty: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  const disabled = empty && !locked;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "13px 16px",
        borderRadius: 11,
        border: `1px solid ${active ? TEAL_BORDER : "rgba(255,255,255,0.07)"}`,
        background: active ? TEAL_TINT : "rgba(255,255,255,0.025)",
        color: "#d4e1e5",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {locked ? (
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(212,225,229,0.55)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ) : null}
        <span style={{
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: 0.2,
          color: active ? TEAL : (locked ? "rgba(212,225,229,0.65)" : "#e8eef0"),
        }}>
          {label}
        </span>
      </span>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: locked ? "rgba(212,225,229,0.45)" : "rgba(212,225,229,0.5)",
      }}>
        {locked ? "Core" : empty ? "no songs" : `${count}`}
      </span>
    </button>
  );
}
