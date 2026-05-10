import { useState, type ReactNode } from "react";

type Props = {
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
};

// Borderless icon button. Replaces CircleButton for the primary play/skip
// controls — the icons themselves carry the visual weight, no surrounding
// circle. Press feedback comes from a transform + brightness shift on the
// child SVG.
export function IconButton({ onClick, children, ariaLabel, disabled = false }: Props) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovered(false); }}
      onPointerEnter={() => setHovered(true)}
      style={{
        background: "transparent",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : (pressed ? 0.7 : (hovered ? 1 : 0.9)),
        padding: 10,
        lineHeight: 0,
        transition: "transform 0.12s, opacity 0.18s",
        transform: pressed ? "scale(0.9)" : "scale(1)",
        userSelect: "none",
        outline: "none",
      }}
    >
      {children}
    </button>
  );
}
