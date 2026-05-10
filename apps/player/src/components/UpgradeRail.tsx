import { useEffect, useState, type CSSProperties } from "react";

// Promo rail shown alongside the player. Content is tier-aware:
//   free  → Core + Pro upsell (the upgrade pitch)
//   core  → Pro upsell mixed with Core feature reminders
//   pro   → Pro feature reminders only (tooltips reinforcing the package)
//   enterprise → no rail
// Layout shape stays the same across tiers; only the slot pool and CTA differ.

type SlotKind = "core_upsell" | "pro_upsell" | "core_reminder" | "pro_reminder";

type Slot = {
  headline: string;
  body: string;
  kind: SlotKind;
};

const SLOTS: Slot[] = [
  // ── Core upsell (Free → Core) ────────────────────────────────────────────
  {
    headline: "Right now you're hearing the general catalogue.",
    body: "Core tunes the music to your single Ideal Customer Profile — so what plays is shaped by the person actually walking your floor.",
    kind: "core_upsell",
  },
  {
    headline: "You've got Linger and Lift Energy.",
    body: "Core unlocks every research-backed outcome we've engineered — not just the two free modes.",
    kind: "core_upsell",
  },
  {
    headline: "Free is 100+ tracks.",
    body: "Core launches at 300 and grows by ~120 in your first month — top performers refreshed, underperformers culled.",
    kind: "core_upsell",
  },
  {
    headline: "Your customer changes. Your music should too.",
    body: "Core lets you edit the ICP whenever the business shifts — new neighborhood, new product mix, new season.",
    kind: "core_upsell",
  },
  // ── Pro upsell (Free / Core → Pro) ──────────────────────────────────────
  {
    headline: "Opening calm, peak energy, closing wind-down.",
    body: "Pro shifts the outcome automatically as your floor shifts — no one has to remember to switch modes.",
    kind: "pro_upsell",
  },
  {
    headline: "Music that gets better the longer it plays.",
    body: "Pro integrates with your POS and refines itself against your sales data — the lift shows up in the report.",
    kind: "pro_upsell",
  },
  {
    headline: "One store, many customers.",
    body: "Pro tailors music to each distinct customer type your store serves — instead of a single profile.",
    kind: "pro_upsell",
  },
  // ── Core feature reminders (for active Core stores) ─────────────────────
  {
    headline: "Your music is tuned to one customer.",
    body: "Core is shaping every track to the Ideal Customer Profile you set up — not a generic catalogue.",
    kind: "core_reminder",
  },
  {
    headline: "Two outcomes available.",
    body: "Linger and Lift Energy — switch any time at the bottom of the screen.",
    kind: "core_reminder",
  },
  {
    headline: "Loved tracks shape the rotation.",
    body: "Tap love when something lands. We lean into what your floor responds to over time.",
    kind: "core_reminder",
  },
  {
    headline: "Your ICP can evolve with the business.",
    body: "New neighborhood, new product mix, new season — edit your ICP and the music follows.",
    kind: "core_reminder",
  },
  // ── Pro feature reminders (for active Pro stores) ───────────────────────
  {
    headline: "Your music is shifting with the day.",
    body: "Day-parting is on — opening, peak, and closing each get their own cadence. No one has to remember to switch modes.",
    kind: "pro_reminder",
  },
  {
    headline: "Music tied to your POS.",
    body: "Pro is refining what plays against your sales data — this week's lift shows up in the report.",
    kind: "pro_reminder",
  },
  {
    headline: "Tailored to every customer type your floor serves.",
    body: "Pro is balancing across all of your ICPs — not a single profile.",
    kind: "pro_reminder",
  },
  {
    headline: "Every outcome is available to you.",
    body: "Linger, Lift Energy, and the rest — switch any time at the bottom of the screen.",
    kind: "pro_reminder",
  },
  {
    headline: "Loved tracks shape what plays.",
    body: "Tap love when something lands. Pro leans into what your floor responds to over time.",
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
  const ctaColor = "rgba(120,180,188,1)";
  const ctaUnderline = "rgba(120,180,188,0.5)";

  // Sizes scale down on narrow viewports so the rail can fit in 50% of phone
  // / tablet height without the headline running off-card.
  const padding = compact ? "26px 28px" : "40px 56px 36px 64px";
  const headlineSize = compact ? 22 : 44;
  const bodySize = compact ? 14 : 18;
  const ctaSize = compact ? 11 : 12;
  const innerGap = compact ? 14 : 22;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding,
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
          gap: innerGap,
          textAlign: "left",
          maxWidth: 540,
        }}
      >
        <div
          style={{
            fontSize: headlineSize,
            fontWeight: 300,
            lineHeight: 1.2,
            color: "rgba(244,247,248,0.97)",
            letterSpacing: compact ? -0.2 : -0.4,
          }}
        >
          {slot.headline}
        </div>
        <div
          style={{
            fontSize: bodySize,
            lineHeight: 1.5,
            fontWeight: 300,
            color: "rgba(232,238,240,0.78)",
            letterSpacing: 0.1,
          }}
        >
          {slot.body}
        </div>
      </div>

      <a
        href={cta.href}
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: ctaSize,
          fontWeight: 500,
          letterSpacing: 2.5,
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
