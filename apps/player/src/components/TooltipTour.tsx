import { useEffect, useLayoutEffect, useState } from "react";

// First-launch onboarding tour — three sequential tooltips that point at the
// outcome selector, love button, and report button. Gated on a localStorage
// flag so it fires once per device/browser. Marked seen on completion or skip.

const TOUR_KEY = "entuned.player.tour.seen.v1";

export function tourSeen(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === "1"; } catch { return false; }
}
function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
}

export interface TourStep {
  /** DOM target — the tour reads `.getBoundingClientRect()` to position. */
  target: HTMLElement | null;
  /** Tooltip body copy. */
  body: string;
  /** Where to anchor the tooltip relative to the target. */
  placement: "above" | "below";
}

interface Props {
  steps: TourStep[];
  onClose: () => void;
}

export function TooltipTour({ steps, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[index] ?? null;

  // Recompute target rect on step change, scroll, and resize. The targets are
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
  }, []);

  const finish = () => { markTourSeen(); onClose(); };
  const next = () => {
    if (index >= steps.length - 1) finish();
    else setIndex(index + 1);
  };

  if (!step || !rect) return null;

  const isLast = index === steps.length - 1;
  const tooltipWidth = 280;
  const margin = 12;
  // Center horizontally over the target; clamp inside viewport.
  const targetCenter = rect.left + rect.width / 2;
  const left = Math.max(
    margin,
    Math.min(window.innerWidth - tooltipWidth - margin, targetCenter - tooltipWidth / 2),
  );
  const top = step.placement === "above"
    ? Math.max(margin, rect.top - 12)
    : Math.min(window.innerHeight - margin, rect.bottom + 12);
  const transform = step.placement === "above" ? "translateY(-100%)" : "translateY(0)";

  return (
    <>
      {/* Soft full-screen scrim that dims everything except the target zone. */}
      <div
        onClick={finish}
        style={{
          position: "fixed", inset: 0, zIndex: 80,
          background: "rgba(10,12,14,0.55)",
          cursor: "pointer",
        }}
      />
      {/* Halo ring around the target so the eye knows where to look. */}
      <div
        style={{
          position: "fixed", zIndex: 81, pointerEvents: "none",
          left: rect.left - 8, top: rect.top - 8,
          width: rect.width + 16, height: rect.height + 16,
          borderRadius: rect.height > 60 ? 12 : 999,
          boxShadow: "0 0 0 2px rgba(215,175,116,0.85), 0 0 30px rgba(215,175,116,0.35)",
        }}
      />
      {/* Tooltip card. */}
      <div
        style={{
          position: "fixed", zIndex: 82,
          left, top, transform,
          width: tooltipWidth,
          background: "rgba(28,28,24,0.98)",
          border: "1px solid rgba(215,175,116,0.55)",
          borderRadius: 12,
          padding: "16px 18px",
          color: "rgba(212,225,229,0.95)",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14, lineHeight: 1.5,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ marginBottom: 14 }}>{step.body}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            onClick={finish}
            style={{
              background: "none", border: "none", padding: 0,
              color: "rgba(212,225,229,0.5)", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {isLast ? "" : "Skip tour"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "rgba(212,225,229,0.4)" }}>
              {index + 1} / {steps.length}
            </span>
            <button
              type="button"
              onClick={next}
              style={{
                background: "rgba(215,175,116,0.92)", color: "#1a1a17",
                border: "none", borderRadius: 8,
                padding: "6px 14px", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
