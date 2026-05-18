import { useEffect, useLayoutEffect, useState } from "react";

// First-launch onboarding tour — single tooltip pointing at the Outcome chip,
// the one control whose meaning isn't self-evident. Heart and Flag are
// universal patterns; tutorializing them trains tune-out. Gated on a
// localStorage flag so it fires once per device/browser.

const TOUR_KEY = "entuned.player.tour.seen.v2";

// Brand teal — matches --accent in index.css. The tour is the user's first
// touchpoint with the player, so it has to read as "Entuned" not "premium
// callout"; gold is reserved for Pro-tier signal elsewhere in the app.
const TEAL = "#6AB0BB";
const TEAL_GLOW = "rgba(106,176,187,0.42)";
const TEAL_RING = "rgba(106,176,187,0.85)";
const TEAL_BORDER = "rgba(106,176,187,0.55)";
const TEAL_TINT = "rgba(106,176,187,0.10)";

export function tourSeen(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === "1"; } catch { return false; }
}
function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
}

export interface TourStep {
  /** DOM target — the tour reads `.getBoundingClientRect()` to position. */
  target: HTMLElement | null;
  /** Optional eyebrow above the body (uppercase micro-label). */
  eyebrow?: string;
  /** Tooltip body copy. */
  body: string;
  /** Preferred placement; falls back to the opposite side if there's no room. */
  placement: "above" | "below";
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

const TOOLTIP_WIDTH = 360;
const VIEWPORT_MARGIN = 16;
const TARGET_GAP = 18;          // breathing room between halo and tooltip
const ARROW_SIZE = 11;
const SPOTLIGHT_PAD = 10;       // extra room around target inside the hole-punched scrim

export function TooltipTour({ steps, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tipHeight, setTipHeight] = useState<number>(140);
  const step = steps[index] ?? null;

  // Recompute target rect on step change, scroll, and resize. Targets are
  // static within the player layout, but viewport changes shift them.
  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const update = () => setRect(step.target!.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step?.target]);

  // Esc skips the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => { markTourSeen(); onClose(); };
  const next = () => {
    if (index >= steps.length - 1) finish();
    else setIndex(index + 1);
  };

  if (!step || !rect) return null;

  const isLast = index === steps.length - 1;
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  // Smart placement: respect the preferred side, but flip if there isn't
  // room. The previous version always honored placement="above" and clamped
  // top to a margin, but kept transform: translateY(-100%) — which then
  // pushed the tooltip off-screen above the viewport on short surfaces.
  const spaceAbove = rect.top;
  const spaceBelow = winH - rect.bottom;
  const needed = tipHeight + TARGET_GAP + VIEWPORT_MARGIN;
  let placement: "above" | "below" = step.placement;
  if (placement === "above" && spaceAbove < needed && spaceBelow >= needed) placement = "below";
  else if (placement === "below" && spaceBelow < needed && spaceAbove >= needed) placement = "above";

  // Horizontal centering with viewport clamp.
  const targetCenter = rect.left + rect.width / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(winW - TOOLTIP_WIDTH - VIEWPORT_MARGIN, targetCenter - TOOLTIP_WIDTH / 2),
  );
  // Vertical: anchor to the actual top-left of the tooltip (no transform
  // tricks), so a min/max clamp actually clamps to viewport edges.
  const rawTop = placement === "above"
    ? rect.top - tipHeight - TARGET_GAP
    : rect.bottom + TARGET_GAP;
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(winH - tipHeight - VIEWPORT_MARGIN, rawTop),
  );

  // Arrow points from the tooltip toward the target. Its x is the target's
  // center minus the tooltip's left, clamped to the tooltip width with a
  // little inset so it never sits on the rounded corner.
  const arrowInset = 22;
  const arrowX = Math.max(
    arrowInset,
    Math.min(TOOLTIP_WIDTH - arrowInset - ARROW_SIZE * 2, targetCenter - left - ARROW_SIZE),
  );

  // Halo radius: chip-shaped halo for tall targets (the outcome chip), ring
  // for icon-button-shaped targets (love, report). Slight pulse on entry.
  const haloRadius = rect.height > 60 ? 14 : 999;

  return (
    <>
      {/* Click-catcher behind the spotlight — taps anywhere outside the
          target dismiss the tour. Transparent; only here for pointer events. */}
      <div
        onClick={finish}
        style={{
          position: "fixed", inset: 0, zIndex: 79,
          background: "transparent",
          cursor: "pointer",
          animation: "entunedTourFade 220ms ease-out",
        }}
      />
      {/* Hole-punched scrim: a transparent rect over the target whose outward
          box-shadow paints the rest of the screen dim. pointer-events:none so
          clicks on the target itself pass through, and clicks in the dark
          area fall to the catcher below. */}
      <div
        style={{
          position: "fixed", zIndex: 80, pointerEvents: "none",
          left: rect.left - SPOTLIGHT_PAD, top: rect.top - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
          borderRadius: haloRadius,
          boxShadow: "0 0 0 9999px rgba(8,10,12,0.72)",
          animation: "entunedTourFade 220ms ease-out",
        }}
      />
      {/* Halo ring around the target — teal, with a soft outer glow that
          pulses on entry to draw the eye. */}
      <div
        style={{
          position: "fixed", zIndex: 81, pointerEvents: "none",
          left: rect.left - 8, top: rect.top - 8,
          width: rect.width + 16, height: rect.height + 16,
          borderRadius: haloRadius,
          boxShadow: `0 0 0 2px ${TEAL_RING}, 0 0 36px ${TEAL_GLOW}`,
          animation: "entunedTourHalo 1600ms ease-out infinite",
        }}
      />
      {/* Tooltip card */}
      <div
        ref={(el) => { if (el) setTipHeight(el.getBoundingClientRect().height); }}
        style={{
          position: "fixed", zIndex: 82,
          left, top,
          width: TOOLTIP_WIDTH,
          background: "linear-gradient(180deg, #1c1f22 0%, #16181b 100%)",
          border: `1px solid ${TEAL_BORDER}`,
          borderRadius: 16,
          padding: "20px 22px 18px",
          color: "#D4E1E5",
          fontFamily: "'Inter', sans-serif",
          boxShadow: `0 22px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(106,176,187,0.06), 0 0 32px ${TEAL_GLOW}`,
          animation: placement === "above"
            ? "entunedTourRiseUp 260ms cubic-bezier(.2,.8,.2,1)"
            : "entunedTourRiseDown 260ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {step.eyebrow ? (
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.18em",
            color: TEAL, textTransform: "uppercase", marginBottom: 8,
          }}>
            {step.eyebrow}
          </div>
        ) : null}

        <div style={{
          fontSize: 16, lineHeight: 1.5, color: "#E8EEF0",
          fontWeight: 400, letterSpacing: "0.005em",
          marginBottom: 18,
        }}>
          {step.body}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          {/* Dot step indicator + skip — hidden when there's only one step. */}
          {steps.length > 1 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", gap: 5 }}>
                {steps.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: i === index ? 18 : 6, height: 6,
                      borderRadius: 3,
                      background: i === index ? TEAL : "rgba(212,225,229,0.22)",
                      transition: "width 220ms ease, background 220ms ease",
                    }}
                  />
                ))}
              </div>
              {!isLast ? (
                <button
                  type="button"
                  onClick={finish}
                  style={{
                    background: "none", border: "none", padding: "2px 0",
                    color: "rgba(212,225,229,0.5)", fontSize: 11.5,
                    letterSpacing: "0.04em", cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Skip
                </button>
              ) : null}
            </div>
          ) : <span />}

          <button
            type="button"
            onClick={next}
            style={{
              background: TEAL, color: "#0d1416",
              border: "none", borderRadius: 9,
              padding: "9px 20px", fontSize: 14, fontWeight: 700,
              letterSpacing: "0.02em",
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: `0 4px 14px ${TEAL_GLOW}`,
            }}
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>

        {/* Connector arrow — visually anchors the tooltip to the halo'd target.
            Uses a stacked div pair: the outer is the border, the inner is the
            fill, so the 1px teal border continues onto the arrow. */}
        <div
          style={{
            position: "absolute",
            left: arrowX,
            ...(placement === "above"
              ? { bottom: -ARROW_SIZE, transform: "rotate(45deg)" }
              : { top: -ARROW_SIZE, transform: "rotate(45deg)" }),
            width: ARROW_SIZE * 2, height: ARROW_SIZE * 2,
            background: placement === "above" ? "#16181b" : "#1c1f22",
            borderRight: placement === "above" ? `1px solid ${TEAL_BORDER}` : "none",
            borderBottom: placement === "above" ? `1px solid ${TEAL_BORDER}` : "none",
            borderLeft: placement === "below" ? `1px solid ${TEAL_BORDER}` : "none",
            borderTop: placement === "below" ? `1px solid ${TEAL_BORDER}` : "none",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Animations are scoped to the tour — keep them out of index.css so
          this component stays self-contained. */}
      <style>{`
        @keyframes entunedTourFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes entunedTourRiseUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes entunedTourRiseDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes entunedTourHalo {
          0%   { box-shadow: 0 0 0 2px ${TEAL_RING}, 0 0 24px ${TEAL_TINT}; }
          50%  { box-shadow: 0 0 0 2px ${TEAL_RING}, 0 0 44px ${TEAL_GLOW}; }
          100% { box-shadow: 0 0 0 2px ${TEAL_RING}, 0 0 24px ${TEAL_TINT}; }
        }
      `}</style>
    </>
  );
}
