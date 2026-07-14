import Link from "next/link";
import { Wordmark } from "@/lib/emblem";

/** Floating back-to-tour link used on every surface. */
export function TourBack({ label = "Înapoi la tur" }: { label?: string }) {
  return (
    <Link
      href="/"
      style={{
        position: "fixed",
        top: 20,
        left: 20,
        zIndex: 50,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "0.55em 1em",
        fontSize: "0.82rem",
        fontWeight: 600,
        color: "var(--ink)",
        background: "color-mix(in srgb, var(--paper) 88%, transparent)",
        backdropFilter: "blur(8px)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--r-pill)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

/** Desktop surface header (management, admin). */
export function SurfaceHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        // Extra top padding clears the fixed <TourBack/> button (top:20, ~44px tall).
        padding: "72px 0 22px",
        borderBottom: "1px solid var(--line-soft)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <span className="eyebrow eyebrow--ink">{eyebrow}</span>
        <h1 style={{ fontSize: "clamp(1.5rem, 2.4vw, 2rem)", marginTop: 6 }}>{title}</h1>
      </div>
      <Wordmark tone="var(--ink-soft)" />
    </header>
  );
}

/** Phone frame for guest & staff surfaces. Renders a device with a faux
    status bar; children fill the scrollable screen. */
export function PhoneFrame({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="phone">
      <div
        className="phone__screen"
        style={{
          background: dark ? "var(--ink-surface)" : "var(--paper)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 22px 4px",
            fontSize: "0.72rem",
            fontWeight: 600,
            color: dark ? "var(--on-dark-soft)" : "var(--ink-soft)",
            flex: "none",
          }}
        >
          <span>21:24</span>
          <span style={{ letterSpacing: "0.1em" }}>􀙇 􀛨 􀺶</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}

/** Stage that centers one or two phones on warm paper (used by guest/staff). */
export function PhoneStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        flexWrap: "wrap",
        padding: "80px 24px 48px",
      }}
    >
      {children}
    </div>
  );
}
