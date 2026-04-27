export type ReportReason =
  | "off_brand"
  | "boring"
  | "awkward_lyrics"
  | "too_slow"
  | "too_intense"
  | "audio_issues";

const REASONS: { label: string; value: ReportReason }[] = [
  { label: "Not Our Vibe", value: "off_brand" },
  { label: "Boring", value: "boring" },
  { label: "Awkward Lyrics", value: "awkward_lyrics" },
  { label: "Too Slow", value: "too_slow" },
  { label: "Too Intense", value: "too_intense" },
  { label: "Track Audio Issues", value: "audio_issues" },
];

type Props = {
  onSelect: (reason: ReportReason) => void;
  onClose: () => void;
};

export function ReportModal({ onSelect, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(20,20,24,0.97)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20,
          padding: "28px 0 12px",
          width: "100%",
          maxWidth: 420,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: 2.5,
            color: "rgba(212,225,229,0.4)",
            textTransform: "uppercase",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          Report Track — Reason
        </div>
        {REASONS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            style={{
              display: "block",
              width: "100%",
              padding: "18px 32px",
              background: "transparent",
              border: "none",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              color: "rgba(212,225,229,0.82)",
              fontSize: 16,
              fontWeight: 300,
              letterSpacing: 0.4,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          style={{
            display: "block",
            width: "100%",
            padding: "18px 32px",
            marginTop: 8,
            background: "transparent",
            border: "none",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(212,225,229,0.35)",
            fontSize: 13,
            fontWeight: 400,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
