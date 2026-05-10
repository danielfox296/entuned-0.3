import { useEffect, useRef } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";

// Frequency-response visualizer powered by audiomotion-analyzer. Mounts a
// container div, owns a single AudioMotionAnalyzer instance, and rewires its
// input to whatever HTMLAudioElement is currently playing.
//
// Once `createMediaElementSource` is called on an <audio> element, that
// element is permanently routed through Web Audio for THIS context — calling
// it twice on the same element throws. We track which elements we've already
// hooked and reuse the cached source node for cross-fades back to the same
// (rare; mostly during preload race) element.
//
// CORS: requires `crossOrigin="anonymous"` on the audio element AND matching
// `Access-Control-Allow-Origin` on the audio host (R2). main.tsx patches Audio
// for the former. If the latter is missing, `getByteFrequencyData` returns
// zeros — visualizer goes flat but audio still plays. No crash.

type Props = {
  /** Latest playing audio element. Pass null when idle. */
  audioEl: HTMLAudioElement | null;
  /** Tied to currentItem.songId so the effect re-runs on track change. */
  trackId: string | null;
  height?: number;
};

export function Visualizer({ audioEl, trackId, height = 120 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const analyzerRef = useRef<AudioMotionAnalyzer | null>(null);
  const sourcesRef = useRef<WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>>(new WeakMap());

  // Initialize analyser once.
  useEffect(() => {
    if (!containerRef.current || analyzerRef.current) return;
    try {
      analyzerRef.current = new AudioMotionAnalyzer(containerRef.current, {
        height,
        mode: 4,                  // octave bands (1/6th octave) — smooth, musical
        gradient: "steelblue",
        showScaleX: false,
        showScaleY: false,
        showPeaks: false,
        showBgColor: false,
        overlay: true,
        bgAlpha: 0,
        smoothing: 0.75,
        minDecibels: -85,
        maxDecibels: -25,
        radial: false,
        roundBars: true,
        ledBars: false,
        lumiBars: false,
        reflexRatio: 0.3,
        reflexAlpha: 0.18,
        reflexBright: 1,
        weightingFilter: "D",
      });
    } catch (e) {
      console.warn("[visualizer] init failed", e);
    }
    return () => {
      try { analyzerRef.current?.destroy(); } catch {}
      analyzerRef.current = null;
    };
  }, [height]);

  // Connect / reconnect input on track change.
  useEffect(() => {
    const a = analyzerRef.current;
    if (!a || !audioEl) return;
    try {
      let src = sourcesRef.current.get(audioEl);
      if (!src) {
        src = a.audioCtx.createMediaElementSource(audioEl);
        sourcesRef.current.set(audioEl, src);
      }
      a.disconnectInput();
      a.connectInput(src);
    } catch (e) {
      // Most common: createMediaElementSource called twice on the same element
      // across a different AudioContext. Audio still plays; visualizer flatlines.
      console.warn("[visualizer] connect failed", e);
    }
  }, [audioEl, trackId]);

  return <div ref={containerRef} style={{ width: "100%", height, pointerEvents: "none" }} />;
}
