import { useEffect, useState, type CSSProperties } from "react";
import { T } from "@entuned/tokens";
import { PLAYER_ACCENT } from "../theme.js";

// Promo rail shown alongside the player. Content is tier-aware:
//   free  → Core + Pro upsell (the upgrade pitch)
//   core  → Pro upsell mixed with Core feature reminders
//   pro   → Pro feature reminders only (tooltips reinforcing the package)
//   enterprise → no rail
// Layout shape stays the same across tiers; only the slot pool and CTA differ.

type SlotKind =
  | "core_upsell"
  | "pro_upsell"
  | "core_reminder"
  | "pro_reminder"
  // Outcome explainer — one slot per Boost/Pro Outcome, naming what the
  // outcome promotes in associate-legible language. Appears in every active
  // tier pool (free as upsell, Boost/Pro as reminder); CTA is resolved
  // per-tier in the render path, not by kind.
  | "outcome_explainer";

// Each slot is an anchor (one tight line) + 2-3 bullets. Designed for
// scan-reading on the floor — operator should grok the value in under a second.
// `photo` is shown only in narrow-promo mode (portrait tablet / phone, where
// landscape iPad's natural 2-column layout already fills horizontally).
type Slot = {
  anchor: string;
  points: string[];
  kind: SlotKind;
  photo: string;
  customizeCta?: { label: string; href: string };
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
    anchor: "More outcomes than Chill, Steady, and Upbeat.",
    points: [
      "Every research-backed outcome unlocked",
      "Switch the floor's mood any moment",
      "Not just the three free modes",
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
    customizeCta: { label: "Customize this →", href: "https://app.entuned.co/intake" },
  },
  {
    anchor: "Three free modes ready.",
    points: [
      "Chill",
      "Steady",
      "Upbeat",
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
    customizeCta: { label: "Customize this →", href: "https://app.entuned.co/intake" },
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
    customizeCta: { label: "Customize this →", href: "https://app.entuned.co/schedule" },
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
      "Chill, Steady, Upbeat, and more",
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
  // ── Outcome explainers (every active tier) ──────────────────────────────
  // One slot per Boost/Pro Outcome. Anchor format is "Name: what it promotes."
  // so a floor associate scans the name and the promise in one beat. Bullets
  // give the texture (mood, when to switch to it). Order roughly follows the
  // dash.entuned.co outcome list.
  {
    anchor: "Stay & Browse: linger longer on the floor.",
    points: [
      "Slower tempo, warmer feel",
      "Customers settle in instead of breezing through",
      "Right when you want dwell, not turnover",
    ],
    kind: "outcome_explainer",
    photo: "/promo/parallax-luxury-store.jpg",
  },
  {
    anchor: "Help Them Decide: nudge browsers toward the till.",
    points: [
      "Steady, confident momentum",
      "Cuts decision fatigue at the rack",
      "For when traffic browses but doesn't buy",
    ],
    kind: "outcome_explainer",
    photo: "/promo/shopping.jpg",
  },
  {
    anchor: "Trade Them Up: lift the average ticket.",
    points: [
      "Premium, considered energy",
      "Makes the higher-tier picks feel worth it",
      "For days the basket value should climb",
    ],
    kind: "outcome_explainer",
    photo: "/promo/parallax-cosmetics-store.jpg",
  },
  {
    anchor: "Fill the Basket: more items per visit.",
    points: [
      "Curious, open mood",
      "Encourages add-ons and second looks",
      "Right for cart-friendly floors",
    ],
    kind: "outcome_explainer",
    photo: "/promo/retail-store.jpg",
  },
  {
    anchor: "Grab It Now: drive impulse pickups.",
    points: [
      "Brighter pulse, present-tense urgency",
      "Pulls hands to the counter",
      "Right by the register or at limited displays",
    ],
    kind: "outcome_explainer",
    photo: "/promo/alcott-store.jpg",
  },
  {
    anchor: "Keep It Moving: speed turnover when it's busy.",
    points: [
      "Up-tempo without overheating",
      "Keeps aisles and lines flowing",
      "For peak-hour rush",
    ],
    kind: "outcome_explainer",
    photo: "/promo/parallax-green-lamp.jpg",
  },
  {
    anchor: "Our Sound: pure brand vibe.",
    points: [
      "The room just sounds like you",
      "No behaviour nudge, just identity",
      "When the brand should lead, not the sale",
    ],
    kind: "outcome_explainer",
    photo: "/promo/mara-icp.jpg",
  },
  {
    anchor: "Swagger Spend: confidence to upgrade.",
    points: [
      "Status-forward, aspirational energy",
      "Frames the spend as upgrade, not splurge",
      "For premium drops and statement pieces",
    ],
    kind: "outcome_explainer",
    photo: "/promo/parallax-cosmetics-store.jpg",
  },
];

function slotsForTier(tier: string | undefined): Slot[] {
  switch (tier) {
    case "free":
      return SLOTS.filter(
        (s) => s.kind === "core_upsell" || s.kind === "pro_upsell" || s.kind === "outcome_explainer",
      );
    case "core":
      return SLOTS.filter(
        (s) => s.kind === "pro_upsell" || s.kind === "core_reminder" || s.kind === "outcome_explainer",
      );
    case "pro":
      return SLOTS.filter((s) => s.kind === "pro_reminder" || s.kind === "outcome_explainer");
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
  const cta = slot.customizeCta ?? (() => {
    switch (slot.kind) {
      case "core_upsell":
        return { label: "See what Boost unlocks →", href: "https://app.entuned.co/upgrade" };
      case "pro_upsell":
        return { label: "See what Pro unlocks →", href: "https://app.entuned.co/upgrade" };
      case "outcome_explainer":
        // Free reads this card as an upsell ("here's what you'd unlock"); paid
        // tiers read it as a reminder of what's already at their fingertips.
        if (tier === "free") {
          return { label: "See what Boost unlocks →", href: "https://app.entuned.co/upgrade" };
        }
        return { label: "Open your dashboard →", href: "https://app.entuned.co" };
      case "core_reminder":
      case "pro_reminder":
      default:
        return { label: "Open your dashboard →", href: "https://app.entuned.co" };
    }
  })();
  const ctaColor = PLAYER_ACCENT;
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
          position: "absolute",
          inset: 0,
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
        borderLeft: `3px solid ${PLAYER_ACCENT}`,
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
              color: T.text,
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
                    color: PLAYER_ACCENT,
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
