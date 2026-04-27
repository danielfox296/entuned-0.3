import { useEffect, useRef } from "react";
import { DarkHalo } from "./DarkHalo.js";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

type Props = {
  getProgress: () => { elapsed: number; duration: number; progress: number } | null;
};

export function ProgressBar({ getProgress }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const info = getProgress();
      if (info) {
        const pct = Math.max(0, Math.min(100, info.progress * 100));
        if (fillRef.current) fillRef.current.style.width = `${pct}%`;
        if (knobRef.current) knobRef.current.style.left = `calc(${pct}% - 8px)`;
        if (elapsedRef.current) elapsedRef.current.textContent = formatTime(info.elapsed);
        if (durationRef.current) durationRef.current.textContent = formatTime(info.duration);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getProgress]);

  return (
    <DarkHalo style={{ width: "88%", maxWidth: 540 }}>
      <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
        <div ref={fillRef} style={{ height: 6, borderRadius: 3, background: "rgba(212,225,229,0.5)", width: "0%" }} />
        <div
          ref={knobRef}
          style={{
            position: "absolute",
            top: -5,
            left: "calc(0% - 8px)",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "rgba(212,225,229,0.85)",
            border: "2px solid rgba(212,225,229,0.6)",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <span ref={elapsedRef} style={{ fontSize: 12, fontWeight: 300, color: "rgba(212,225,229,0.35)", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>0:00</span>
        <span ref={durationRef} style={{ fontSize: 12, fontWeight: 300, color: "rgba(212,225,229,0.35)", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>0:00</span>
      </div>
    </DarkHalo>
  );
}
