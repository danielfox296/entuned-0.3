import { useEffect, useState, type CSSProperties } from "react";

// Promo rail shown alongside the player. Content is tier-aware:
//   free  → Core + Pro upsell (the upgrade pitch)
//   core  → Pro upsell mixed with Core feature reminders
//   pro   → Pro feature reminders only (tooltips reinforcing the package)
//   enterprise → no rail
// Layout shape stays the same across tiers; only the slot pool and CTA differ.

type SlotKind = "core_upsell" | "pro_upsell" | "core_reminder" | "pro_reminder";

// Each slot is an anchor (one tight line) + 2-3 bullets. Designed for
// scan-reading on the floor — operator should grok the value in under a second.
type Slot = {
  anchor: string;
  points: string[];
  kind: SlotKind;
};

const SLOTS: Slot[] = [
  // ── Core upsell (Free → Core) ────────────────────────────────────────────
  {
    anchor: "Music shaped by your customer.",
    points: [
      "Tuned to your single ICP",
      "Songs picked for who's on your floor",
      "Not the general catalogue",
    ],
    kind: "core_upsell",
  },
  {
    anchor: "More outcomes than Linger and Lift.",
    points: [
      "Every research-backed outcome unlocked",
      "Switch the floor's mood any moment",
      "Not just two free modes",
    ],
    kind: "core_upsell",
  },
  {
    anchor: "A library that grows.",
    points: [
      "Launches at 300 tracks",
      "~120 new every month",
      "Top performers kept, weak ones culled",
    ],
    kind: "core_upsell",
  },
  {
    anchor: "Music that evolves with you.",
    points: [
      "Edit your ICP any time",
      "New season, neighborhood, or product mix",
      "Music adapts the same day",
    ],
    kind: "core_upsell",
  },
  // ── Pro upsell (Free / Core → Pro) ──────────────────────────────────────
  {
    anchor: "Music that shifts with the day.",
    points: [
      "Opening calm, peak energy, closing wind-down",
      "Switches automatically",
      "No one has to remember the mode",
    ],
    kind: "pro_upsell",
  },
  {
    anchor: "Music tied to your sales.",
    points: [
      "Integrates with your POS",
      "Refines against real sales data",
      "Lift shows up in the report",
    ],
    kind: "pro_upsell",
  },
  {
    anchor: "Music for every customer type.",
    points: [
      "Tailors to each ICP your floor serves",
      "Not a single profile",
      "Every visitor's moment shaped",
    ],
    kind: "pro_upsell",
  },
  // ── Core feature reminders (for active Core stores) ─────────────────────
  {
    anchor: "Tuned to your customer.",
    points: [
      "Shaped to your one ICP",
      "Every track picked for your floor",
      "Not a generic catalogue",
    ],
    kind: "core_reminder",
  },
  {
    anchor: "Two outcomes ready.",
    points: [
      "Linger",
      "Lift Energy",
      "Switch any time below",
    ],
    kind: "core_reminder",
  },
  {
    anchor: "Your taste shapes the rotation.",
    points: [
      "Tap love when a track lands",
      "We lean into what works",
      "Effect compounds over time",
    ],
    kind: "core_reminder",
  },
  {
    anchor: "Edit your ICP any time.",
    points: [
      "New season, neighborhood, or product mix",
      "Music follows the same day",
      "No re-onboarding",
    ],
    kind: "core_reminder",
  },
  // ── Pro feature reminders (for active Pro stores) ───────────────────────
  {
    anchor: "Day-parting is on.",
    points: [
      "Opening calm",
      "Peak energy",
      "Closing wind-down",
    ],
    kind: "pro_reminder",
  },
  {
    anchor: "Tied to your POS.",
    points: [
      "Refining against your sales data",
      "Lift shows up in the report",
      "Better the longer it plays",
    ],
    kind: "pro_reminder",
  },
  {
    anchor: "Tailored to every customer.",
    points: [
      "Balancing across all your ICPs",
      "Each visitor's moment shaped",
      "Not a single profile",
    ],
    kind: "pro_reminder",
  },
  {
    anchor: "Every outcome unlocked.",
    points: [
      "Linger, Lift Energy, and the rest",
      "Switch any time below",
      "Match the moment, not just the day",
    ],
    kind: "pro_reminder",
  },
  {
    anchor: "Your taste shapes what plays.",
    points: [
      "Tap love when a track lands",
      "Pro leans into what works",
      "Effect compounds over time",
    ],
    kind: "pro_reminder",
  },
];

function slotsForTier(tier: string | undefined): Slot[] {
  switch (tier) {
    case "free":
      return SLOTS.filter((s) => s.kind === "core_upsell" || s.kind === "pro_upsell");
    case "core":
      return SLOTS.filter((s) => s.kind === "pro_upsell" || s.kind === "core_reminder");
    case "pro":
      return SLOTS.filter((s) => s.kind === "pro_reminder");
    default:
      return [];
  }
}

type Props = {
  /** Bumps the slot index every time it changes (e.g. the playing track). */
  rotationKey: string | null;
  /** Effective tier ('free' | 'core' | 'pro') — drives which slot pool rotates. */
  tier: string | undefined;
  /** Reduces typography + padding for narrow viewports. Same layout shape. */
  compact?: boolean;
  style?: CSSProperties;
};

export function UpgradeRail({ rotationKey, tier, compact = false, style }: Props) {
  const slots = slotsForTier(tier);
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  // Advance on rotationKey change (typically: every track change). Also
  // auto-advance on a 50s timer so the rail still rotates if the user pauses
  // playback for a long stretch.
  useEffect(() => {
    if (rotationKey == null) return;
    if (slots.length === 0) return;
    setFade(false);
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % slots.length);
      setFade(true);
    }, 280);
    return () => clearTimeout(t);
  }, [rotationKey, slots.length]);

  useEffect(() => {
    if (slots.length === 0) return;
    const iv = window.setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % slots.length);
        setFade(true);
      }, 280);
    }, 50_000);
    return () => clearInterval(iv);
  }, [slots.length]);

  if (slots.length === 0) return null;
  const slot = slots[index % slots.length];

  // The rail is one surface — type, color, and structure are constant across
  // every tier. Only the slot CONTENT and the CTA's label + href change per
  // kind. Don't reintroduce per-tier color accents here; that breaks the
  // shared visual aesthetic.
  const cta = (() => {
    switch (slot.kind) {
      case "core_upsell":
        return { label: "See what Core unlocks →", href: "https://entuned.co/pricing.html" };
      case "pro_upsell":
        return { label: "See what Pro unlocks →", href: "https://entuned.co/pricing.html" };
      case "core_reminder":
      case "pro_reminder":
      default:
        return { label: "Open your dashboard →", href: "https://app.entuned.co" };
    }
  })();
  const ctaColor = "#6AB0BB";
  const ctaUnderline = "rgba(106, 176, 187, 0.5)";

  // Sizes scale down on narrow viewports so the rail can fit in 50% of phone
  // / tablet height without the anchor running off-card.
  const padding = compact ? "26px 26px 24px" : "40px 48px 36px 52px";
  // Anchor is a display heading (Manrope, weight 700, sentence case, tight
  // tracking). Bullets are body Inter weight 400.
  const anchorSize = compact ? "1.5rem" : "2.4rem";
  const bulletSize = compact ? "0.875rem" : "1rem";
  const ctaSize = compact ? "0.7rem" : "0.75rem";
  const headerGap = compact ? 16 : 22;
  const bulletGap = compact ? 8 : 10;

  return (
    <div
      style={{
        // Brand callout pattern (mirrors `.article-cta` / `.stat-box` on the
        // marketing site): light teal-tinted bg + 3px solid teal left border
        // + 4px radius. The left rule is the structural brand signature for
        // a called-out content block.
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding,
        background: "rgba(80, 146, 156, 0.06)",
        borderLeft: "3px solid #6AB0BB",
        borderRadius: 4,
        boxSizing: "border-box",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        key={index}
        style={{
          opacity: fade ? 1 : 0,
          transition: "opacity 420ms ease",
          display: "flex",
          flexDirection: "column",
          gap: headerGap,
          textAlign: "left",
          maxWidth: 540,
        }}
      >
        <div
          style={{
            fontFamily: "'Manrope', sans-serif",
            fontSize: anchorSize,
            fontWeight: 700,
            lineHeight: 1.15,
            color: "#D4E1E5",
            letterSpacing: "-0.02em",
          }}
        >
          {slot.anchor}
        </div>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: bulletGap,
          }}
        >
          {slot.points.map((p, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "baseline",
                fontFamily: "'Inter', sans-serif",
                fontSize: bulletSize,
                lineHeight: 1.6,
                fontWeight: 400,
                color: "rgba(212, 225, 229, 0.85)",
                letterSpacing: "0",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  color: "#6AB0BB",
                  opacity: 0.7,
                }}
                aria-hidden="true"
              >
                —
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <a
        href={cta.href}
        target="_blank"
        rel="noreferrer"
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: ctaSize,
          fontWeight: 600,
          letterSpacing: "0.18em",
          color: ctaColor,
          textTransform: "uppercase",
          textDecoration: "none",
          borderBottom: `1px solid ${ctaUnderline}`,
          paddingBottom: 6,
          alignSelf: "flex-start",
        }}
      >
        {cta.label}
      </a>
    </div>
  );
}
