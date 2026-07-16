import { hostTenantSchema } from "@boca/contracts";
import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { type TenantInfo, TenantProvider } from "@/lib/tenant";
import "./globals.css";

// Same pairing as the rest of the Desaga surfaces: Fraunces (display) +
// Instrument Sans (body), both latin-ext for Romanian diacritics.
const fraunces = Fraunces({
  subsets: ["latin-ext"],
  axes: ["opsz", "SOFT", "WONK"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Desaga — Meniu",
  description: "Meniul Restaurantelor Desaga by Euphoria.",
};

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
// Baked single-tenant fallback: keeps existing deployments (and local dev
// without a registered domain) working while domains are being onboarded.
const FALLBACK_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG || "desaga";

/**
 * Which tenant serves this request's hostname. Server-side call straight to
 * the internal API, forwarding the browser-facing host; unregistered domains
 * (or an unreachable API) fall back to the baked tenant so nothing breaks.
 */
async function resolveTenant(): Promise<TenantInfo> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    if (host) {
      const res = await fetch(`${API_ORIGIN}/api/guest/tenant-context`, {
        headers: { "x-forwarded-host": host },
        cache: "no-store",
      });
      if (res.ok) {
        const ctx = hostTenantSchema.parse(await res.json());
        return { slug: ctx.tenantSlug, name: ctx.tenantName };
      }
    }
  } catch {
    /* fall through to the baked tenant */
  }
  return { slug: FALLBACK_SLUG, name: "" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await resolveTenant();
  return (
    <html lang="ro" className={`${fraunces.variable} ${instrument.variable}`}>
      <body>
        <TenantProvider value={tenant}>{children}</TenantProvider>
      </body>
    </html>
  );
}
