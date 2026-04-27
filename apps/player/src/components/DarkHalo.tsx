import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  style?: CSSProperties;
  radius?: number;
};

export function DarkHalo({ children, style, radius = 80 }: Props) {
  return (
    <div style={{ position: "relative", ...style }}>
      <div
        style={{
          position: "absolute",
          inset: -radius,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.2) 55%, transparent 75%)",
          pointerEvents: "none",
          zIndex: -1,
        }}
      />
      {children}
    </div>
  );
}
