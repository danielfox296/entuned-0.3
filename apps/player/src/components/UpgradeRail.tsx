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
// `photo` is shown only in narrow-promo mode (portrait tablet / phone, where
// landscape iPad's natural 2-column layout already fills horizontally).
type Slot = {
  anchor: string;
  points: string[];
  kind: SlotKind;
  photo: string;
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
    photo: "/promo/retail-store.jpg",
  },
  {
    anchor: "More outcomes than Linger and Lift.",
    points: [
      "Every research-backed outcome unlocked",
      "Switch the floor's mood any moment",
      "Not just two free modes",
    ],
    kind: "core_upsell",
    photo: "/promo/shopping.jpg",
  },
  {
    anchor: "A library that grows.",
    points: [
      "Launches at 300 tracks",
      "~120 new every month",
      "Top performers kept, weak ones culled",
    ],
    kind: "core_upsell",
    photo: "/promo/parallax-luxury-store.jpg",
  },
  {
    anchor: "Music that evolves with you.",
    points: [
      "Edit your ICP any time",
      "New season, neighborhood, or product mix",
      "Music adapts the same day",
    ],
    kind: "core_upsell",
    photo: "/promo/alcott-store.jpg",
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
    photo: "/promo/parallax-green-lamp.jpg",
  },
  {
    anchor: "Music tied to your sales.",
    points: [
      "Integrates with your POS",
      "Refines against real sales data",
      "Lift shows up in the report",
    ],
    kind: "pro_upsell",
    photo: "/promo/parallax-cosmetics-store.jpg",
  },
  {
    anchor: "Music for every customer type.",
    points: [
      "Tailors to each ICP your floor serves",
      "Not a single profile",
      "Every visitor's moment shaped",
    ],
    kind: "pro_upsell",
    photo: "/promo/mara-icp.jpg",
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
    photo: "/promo/mara-icp.jpg",
  },
  {
    anchor: "Two outcomes ready.",
    points: [
      "Linger",
      "Lift Energy",
      "Switch any time below",
    ],
    kind: "core_reminder",
    photo: "/promo/alcott-store.jpg",
  },
  {
    anchor: "Your taste shapes the rotation.",
    points: [
      "Tap love when a track lands",
      "We lean into what works",
      "Effect compounds over time",
    ],
    kind: "core_reminder",
    photo: "/promo/shopping.jpg",
  },
  {
    anchor: "Edit your ICP any time.",
    points: [
      "New season, neighborhood, or product mix",
      "Music follows the same day",
      "No re-onboarding",
    ],
    kind: "core_reminder",
    photo: "/promo/retail-store.jpg",
  },
  // ── Pro feature reminders (for active Pro stores) ───────────────────────
  {
    anchor: "Outcome Scheduling is on.",
    points: [
      "Opening calm",
      "Peak energy",
      "Closing wind-down",
    ],
    kind: "pro_reminder",
    photo: "/promo/parallax-green-lamp.jpg",
  },
  {
    anchor: "Tied to your POS.",
    points: [
      "Refining against your sales data",
      "Lift shows up in the report",
      "Better the longer it plays",
    ],
    kind: "pro_reminder",
    photo: "/promo/parallax-cosmetics-store.jpg",
  },
  {
    anchor: "Tailored to every customer.",
    points: [
      "Balancing across all your ICPs",
      "Each visitor's moment shaped",
      "Not a single profile",
    ],
    kind: "pro_reminder",
    photo: "/promo/mara-icp.jpg",
  },
  {
    anchor: "Every outcome unlocked.",
    points: [
      "Linger, Lift Energy, and the rest",
      "Switch any time below",
      "Match the moment, not just the day",
    ],
    kind: "pro_reminder",
    photo: "/promo/parallax-luxury-store.jpg",
  },
  {
    anchor: "Your taste shapes what plays.",
    points: [
      "Tap love when a track lands",
      "Pro leans into what works",
      "Effect compounds over time",
    ],
    kind: "pro_reminder",
    photo: "/promo/shopping.jpg",
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
  /** Renders a rotating photo alongside the copy. Used in narrow-promo mode
   *  (portrait tablet / phone) where the comfortable layout leaves blank
   *  space to the right of the left-anchored maxWidth-540 text. Landscape
   *  iPad's natural 2-column split already fills the surface horizontally,
   *  so it stays photo-less. */
  withPhoto?: boolean;
  style?: CSSProperties;
};

export function UpgradeRail({ rotationKey, tier, compact = false, withPhoto = false, style }: Props) {
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
        return { label: "See what Core unlocks →", href: "https://app.entuned.co/upgrade" };
      case "pro_upsell":
        return { label: "See what Pro unlocks →", href: "https://app.entuned.co/upgrade" };
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
  // With photo: the text gets less horizontal room, so anchor + bullets ease
  // back to give the photo breathing room without crowding the copy.
  const padding = withPhoto
    ? (compact ? "0" : "0")             // no outer padding — photo flush to card edge
    : (compact ? "26px 26px 24px" : "40px 48px 36px 52px");
  const textPadding = withPhoto ? (compact ? "22px 22px 20px" : "30px 32px 26px") : undefined;
  // Anchor is a display heading (Manrope, weight 700, sentence case, tight
  // tracking). Bullets are body Inter weight 400.
  const anchorSize = withPhoto ? (compact ? "1.35rem" : "1.7rem") : (compact ? "1.5rem" : "2.4rem");
  const bulletSize = compact ? "0.875rem" : "1rem";
  const ctaSize = compact ? "0.7rem" : "0.75rem";
  const headerGap = compact ? 14 : 22;
  const bulletGap = compact ? 8 : 10;

  // Photo lane width — ~38% of the card on portrait tablet, narrower on phone
  // so the text still has room for the anchor to read on one or two lines.
  // The photo is a separate cross-faded layer so changing slots doesn't make
  // the photo "snap" — both old and new fade together with the text.
  const renderPhoto = withPhoto ? (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        width: compact ? "38%" : "40%",
        minWidth: 120,
        alignSelf: "stretch",
        overflow: "hidden",
        // Subtle teal tint at the right edge bleeds the photo into the text
        // surface — keeps the card feeling like one object, not two halves.
        background: "#0d0e0f",
      }}
    >
      <img
        key={slot.photo}
        src={slot.photo}
        alt=""
        aria-hidden="true"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: fade ? 1 : 0,
          transition: "opacity 420ms ease",
          display: "block",
        }}
      />
      {/* Gradient seam — fades the photo's right edge into the card background
          so the join doesn't feel like a hard cut. */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "linear-gradient(90deg, rgba(13,14,15,0) 60%, rgba(22,22,20,0.55) 100%)",
      }} />
    </div>
  ) : null;

  return (
    <div
      style={{
        // Brand callout pattern (mirrors `.article-cta` / `.stat-box` on the
        // marketing site): light teal-tinted bg + 3px solid teal left border
        // + 4px radius. The left rule is the structural brand signature for
        // a called-out content block.
        position: "relative",
        display: "flex",
        flexDirection: withPhoto ? "row" : "column",
        justifyContent: withPhoto ? "flex-start" : "space-between",
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
      {renderPhoto}
      <div
        style={withPhoto ? {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: textPadding,
          flex: 1,
          minWidth: 0,
        } : { display: "contents" }}
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
            maxWidth: withPhoto ? undefined : 540,
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
            marginTop: withPhoto ? 18 : 0,
          }}
        >
          {cta.label}
        </a>
      </div>
    </div>
  );
}
