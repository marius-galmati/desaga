import { Emblem } from "@/lib/emblem";

/* Placeholder food photography: a warm tonal gradient keyed to the dish, with a
   faint emblem watermark. Used ONLY as a fallback when a real presigned photo
   is missing, so the layout stays warm instead of blank. */

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

/**
 * A framed image slot: shows a real presigned photo when present, else the warm
 * DishPhoto placeholder. Keeps the 1:1 demo look but with real plates when we
 * have them.
 */
export function PhotoSlot({
  url,
  tone = "#6f4326",
  label,
  ratio = "1 / 1",
  radius = "var(--r)",
  alt = "",
}: {
  url: string | null;
  tone?: string;
  label?: string;
  ratio?: string;
  radius?: string;
  alt?: string;
}) {
  if (!url) {
    return <DishPhoto tone={tone} {...(label ? { label } : {})} ratio={ratio} radius={radius} />;
  }
  return (
    <div
      style={{ position: "relative", aspectRatio: ratio, borderRadius: radius, overflow: "hidden" }}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}
