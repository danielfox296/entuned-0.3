import { useState, type ReactNode } from "react";

type Props = {
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
  size?: number;
  disabled?: boolean;
};

export function CircleButton({ onClick, children, ariaLabel, size = 104, disabled = false }: Props) {
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
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${hovered || pressed ? "rgba(212,225,229,0.4)" : "rgba(212,225,229,0.2)"}`,
        background: pressed
          ? "rgba(212,225,229,0.14)"
          : hovered
            ? "rgba(212,225,229,0.1)"
            : "rgba(212,225,229,0.05)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.12s, border-color 0.3s, background 0.3s",
        transform: pressed ? "scale(0.86)" : "scale(1)",
        userSelect: "none",
        outline: "none",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
