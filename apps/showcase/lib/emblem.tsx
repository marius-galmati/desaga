/* The Desaga signature: a hexagonal folk-art mark abstracted from the carved
   emblem on the restaurant wall (crossed fork + spoon inside a hex, framed by
   woven-desagă diamonds). Two forms:
   - <Emblem/>  the compact logo mark
   - <Seal/>    the "Gust Autentic" seal that frames an AI conformity score,
                turning the flagship feature into a mark of authenticity. */

export function Emblem({ size = 28, tone = "var(--ochre)" }: { size?: number; tone?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 3 42 13.5V34.5L24 45 6 34.5V13.5Z" stroke={tone} strokeWidth="1.6" fill="none" />
      <path
        d="M24 8 37 15.5V32.5L24 40 11 32.5V15.5Z"
        stroke={tone}
        strokeWidth="0.9"
        opacity="0.5"
      />
      {/* fork */}
      <path
        d="M19 16v6m2.4-6v6m2.2-6v6M19 22c0 2 1.1 2.6 2.4 2.9V33"
        stroke={tone}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* spoon */}
      <ellipse cx="29.5" cy="18.5" rx="2.6" ry="3.6" stroke={tone} strokeWidth="1.5" />
      <path d="M29.5 22.1V33" stroke={tone} strokeWidth="1.5" strokeLinecap="round" />
      {/* weave nodes */}
      <path d="M24 34.5l1.4 1.4-1.4 1.4-1.4-1.4z" fill={tone} />
    </svg>
  );
}

export function Wordmark({ tone = "var(--ink)" }: { tone?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Emblem size={26} tone="var(--ochre)" />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.32rem",
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: tone,
        }}
      >
        Desaga
      </span>
    </span>
  );
}

/* The seal: a rope/laurel ring around a hexagon; children (usually a score)
   sit in the center. tone drives the ring color by verdict. */
export function Seal({
  size = 132,
  tone = "var(--ochre)",
  label = "Gust Autentic",
  children,
}: {
  size?: number;
  tone?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 140 140" aria-hidden="true">
        <defs>
          <path id={`ring-${id}`} d="M70 70 m -54 0 a 54 54 0 1 1 108 0 a 54 54 0 1 1 -108 0" />
        </defs>
        <circle cx="70" cy="70" r="66" fill="none" stroke={tone} strokeWidth="1" opacity="0.35" />
        <circle cx="70" cy="70" r="59" fill="none" stroke={tone} strokeWidth="2.5" />
        {/* dotted inner rope */}
        <circle
          cx="70"
          cy="70"
          r="52"
          fill="none"
          stroke={tone}
          strokeWidth="2"
          strokeDasharray="1 5"
          strokeLinecap="round"
          opacity="0.8"
        />
        <text
          fontSize="8.5"
          fontWeight="600"
          letterSpacing="3"
          fill={tone}
          fontFamily="var(--font-body)"
        >
          <textPath href={`#ring-${id}`} startOffset="50%" textAnchor="middle">
            {`· ${label.toUpperCase()} ·`}
          </textPath>
        </text>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
