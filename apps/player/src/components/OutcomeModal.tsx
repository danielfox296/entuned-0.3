import { useEffect, useMemo, useState } from "react";
import type { OutcomeOption } from "../api.js";

// Free-tier upgrade-CTA destination. Anchor #outcomes scrolls users into the
// "more outcomes" section of the upgrade page.
const UPGRADE_URL = "https://app.entuned.co/upgrade#outcomes";

// Canonical display order for free-tier modes. Chill → Steady → Upbeat.
// Matches by lowercased title so capitalisation in the DB doesn't matter.
const FREE_MODE_ORDER = ["chill", "steady", "upbeat"];
function modeSortKey(o: OutcomeOption): number {
  const idx = FREE_MODE_ORDER.indexOf(o.title.toLowerCase());
  return idx === -1 ? 999 : idx;
}

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

  // Split outcomes into available-now vs locked. Free-tier: available = modes
  // (availableOnFree), locked = outcomes. Paid tiers: all available, none locked.
  // Free modes are sorted Chill → Steady → Upbeat for consistent display order.
  const { available, locked } = useMemo(() => {
    const a: OutcomeOption[] = [];
    const l: OutcomeOption[] = [];
    for (const o of outcomes) {
      if (isFree && !o.availableOnFree) l.push(o);
      else a.push(o);
    }
    if (isFree) a.sort((x, y) => modeSortKey(x) - modeSortKey(y));
    return { available: a, locked: l };
  }, [outcomes, isFree]);

  // Viewport-aware density. The free tier renders 9 outcomes + 2 section
  // labels + footer + header — at default sizing that's ~720px, which spills
  // off iPad-landscape (768h) and any short tablet/phone-landscape screen.
  // We track height and switch to a denser layout when there isn't room for
  // the comfortable defaults, so the surface fits without an inner scrollbar.
  const [winH, setWinH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 1024));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Total row count drives the threshold — free tier with 9 outcomes needs
  // compact below ~820px; paid pools (3-5 rows) only compact below ~620px.
  const totalRows = available.length + locked.length + 1; // +1 for All Outcomes
  const compact = winH < (totalRows >= 8 ? 820 : 620);

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
          // Was 88vh — capped the surface ~80px short of free-tier content on
          // iPad-landscape. Use the full available viewport minus the overlay
          // padding; intrinsic content height keeps the modal compact.
          maxHeight: "calc(100dvh - 32px)",
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
          padding: compact ? "14px 22px 12px" : "22px 24px 16px",
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
            fontSize: compact ? 18 : 22,
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

        {/* Body — Modes section then Outcomes section (free tier) or a single
            Outcomes section (paid). overflowY:auto is a fallback for extreme
            viewports; default sizing is tuned to fit without scroll on most screens. */}
        <div style={{ overflowY: "auto", padding: compact ? "12px 16px 14px" : "16px 20px 20px", flex: 1 }}>
          <SectionLabel compact={compact}>{isFree ? "Modes" : "Outcomes"}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6, marginBottom: compact ? 12 : 18 }}>
            {/* Play All Available Modes — same row treatment as a peer outcome */}
            <OutcomeRow
              label="Play All Available Modes"
              count={available.reduce((sum, o) => sum + o.poolSize, 0)}
              active={allOutcomesMode}
              empty={false}
              locked={false}
              compact={compact}
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
                compact={compact}
                onClick={() => o.poolSize > 0 && onSelect(o.outcomeId)}
              />
            ))}
          </div>

          {locked.length > 0 && (
            <>
              {/* Faint rule separating free modes from locked outcomes */}
              <div style={{
                height: 1,
                background: "rgba(255,255,255,0.07)",
                margin: compact ? "2px 0 10px" : "0 0 14px",
              }} />
              <SectionLabel compact={compact}>Outcomes</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}>
                {locked.map((o) => (
                  <OutcomeRow
                    key={o.outcomeId}
                    label={o.title}
                    active={false}
                    empty={false}
                    locked
                    compact={compact}
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
                marginTop: compact ? 12 : 18,
                width: "100%",
                padding: compact ? "9px 14px" : "11px 16px",
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
              padding: compact ? "11px 20px" : "16px 24px",
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
                Unlock all outcomes
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

function SectionLabel({ children, compact }: { children: string; compact: boolean }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.16em",
      color: "rgba(212,225,229,0.45)",
      textTransform: "uppercase",
      margin: compact ? "2px 4px 6px" : "4px 4px 10px",
    }}>
      {children}
    </div>
  );
}

function OutcomeRow({
  label, count, active, empty, locked, compact, onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  empty: boolean;
  locked: boolean;
  compact: boolean;
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
        padding: compact ? "9px 14px" : "13px 16px",
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
          fontSize: compact ? 14 : 15,
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
        {locked ? "Boost" : empty ? "no songs" : `${count}`}
      </span>
    </button>
  );
}
