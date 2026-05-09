import { useEffect, useState, type CSSProperties } from "react";

// Promotional rail shown on the left side of the player in slug (Free tier) mode
// at landscape/desktop widths. Rotates value props pulled straight from the
// pricing-page YAML (`website/_src/pages/pricing/content.yaml`) so the
// language stays SSOT-aligned. Mix is 4× Core, 2× Pro, 1× usage — Core is the
// realistic next step; Pro plants a seed without nagging Free users about $399.
//
// Operator mode (paid Core/Pro stores) does NOT render this rail.

type Slot = {
  eyebrow: string;
  headline: string;
  body: string;
  tier: "core" | "pro" | "proof";
};

const SLOTS: Slot[] = [
  {
    eyebrow: "Core · Music for your customer",
    headline: "Right now you're hearing the general catalogue.",
    body: "Core tunes the music to your single Ideal Customer Profile — so what plays is shaped by the person actually walking your floor.",
    tier: "core",
  },
  {
    eyebrow: "Core · More outcomes",
    headline: "You've got Linger and Lift Energy.",
    body: "Core unlocks every research-backed outcome we've engineered — not just the two free modes.",
    tier: "core",
  },
  {
    eyebrow: "Core · A bigger, living library",
    headline: "Free is 100+ tracks.",
    body: "Core launches at 300 and grows by ~120 in your first month — top performers refreshed, underperformers culled.",
    tier: "core",
  },
  {
    eyebrow: "Core · Edit your ICP as you evolve",
    headline: "Your customer changes. Your music should too.",
    body: "Core lets you edit the ICP whenever the business shifts — new neighborhood, new product mix, new season.",
    tier: "core",
  },
  {
    eyebrow: "Pro · Day-parting",
    headline: "Opening calm, peak energy, closing wind-down.",
    body: "Pro shifts the outcome automatically as your floor shifts — no one has to remember to switch modes.",
    tier: "pro",
  },
  {
    eyebrow: "Pro · Tied to your POS",
    headline: "Music that gets better the longer it plays.",
    body: "Pro integrates with your POS and refines itself against your sales data — the lift shows up in the report.",
    tier: "pro",
  },
  {
    eyebrow: "Pro · Multiple customer types",
    headline: "One store, many customers.",
    body: "Pro tailors music to each distinct customer type your store serves — instead of a single profile.",
    tier: "pro",
  },
];

type Props = {
  /** Bumps the slot index every time it changes (e.g. the playing track). */
  rotationKey: string | null;
  style?: CSSProperties;
};

export function UpgradeRail({ rotationKey, style }: Props) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  // Advance on rotationKey change (typically: every track change). Also
  // auto-advance on a 50s timer so the rail still rotates if the user pauses
  // playback for a long stretch.
  useEffect(() => {
    if (rotationKey == null) return;
    setFade(false);
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % SLOTS.length);
      setFade(true);
    }, 280);
    return () => clearTimeout(t);
  }, [rotationKey]);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % SLOTS.length);
        setFade(true);
      }, 280);
    }, 50_000);
    return () => clearInterval(iv);
  }, []);

  const slot = SLOTS[index];

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "40px 56px 36px 64px",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {/* Top: tier indicator */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 3,
          color: "rgba(212,225,229,0.5)",
          textTransform: "uppercase",
        }}
      >
        Your plan — Entuned Free
      </div>

      {/* Middle: rotating slot */}
      <div
        key={index}
        style={{
          opacity: fade ? 1 : 0,
          transition: "opacity 420ms ease",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          textAlign: "left",
          maxWidth: 540,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 3,
            color: slot.tier === "pro"
              ? "rgba(215,175,116,0.95)"
              : slot.tier === "core"
                ? "rgba(120,180,188,0.95)"
                : "rgba(232,238,240,0.7)",
            textTransform: "uppercase",
          }}
        >
          {slot.eyebrow}
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 300,
            lineHeight: 1.18,
            color: "rgba(244,247,248,0.97)",
            letterSpacing: -0.4,
          }}
        >
          {slot.headline}
        </div>
        <div
          style={{
            fontSize: 18,
            lineHeight: 1.5,
            fontWeight: 300,
            color: "rgba(232,238,240,0.78)",
            letterSpacing: 0.1,
          }}
        >
          {slot.body}
        </div>
      </div>

      {/* Bottom: persistent CTA */}
      <a
        href="https://entuned.co/pricing.html"
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: 2.5,
          color: "rgba(120,180,188,1)",
          textTransform: "uppercase",
          textDecoration: "none",
          borderBottom: "1px solid rgba(120,180,188,0.5)",
          paddingBottom: 6,
          alignSelf: "flex-start",
        }}
      >
        See what Core unlocks →
      </a>
    </div>
  );
}
