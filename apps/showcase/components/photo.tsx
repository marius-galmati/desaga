import { Emblem } from "@/lib/emblem";

/* Placeholder food photography: a warm tonal gradient keyed to the dish, with
   a faint emblem watermark. Reads as "styled photo slot" — real 4K photos drop
   in here later. Used identically across every surface for consistency. */

export function DishPhoto({
  tone,
  label,
  ratio = "4 / 3",
  radius = "var(--r)",
}: {
  tone: string;
  label?: string;
  ratio?: string;
  radius?: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: ratio,
        borderRadius: radius,
        overflow: "hidden",
        background: `linear-gradient(150deg, ${tone}, color-mix(in srgb, ${tone} 55%, #1c130a))`,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ opacity: 0.22 }}>
        <Emblem size={46} tone="rgba(255,247,235,0.9)" />
      </div>
      {label ? (
        <span
          style={{
            position: "absolute",
            left: 12,
            bottom: 10,
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "0.9rem",
            color: "rgba(255,247,235,0.92)",
            textShadow: "0 1px 6px rgba(0,0,0,0.4)",
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Small square reference/candidate thumbnail. */
export function PlateThumb({ tone, size = 64 }: { tone: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-sm)",
        background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${tone} 78%, #f5efe3), ${tone})`,
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--line)",
      }}
    >
      <Emblem size={size * 0.42} tone="rgba(255,247,235,0.75)" />
    </div>
  );
}
