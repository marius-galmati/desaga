import { type HostTenant, hostTenantSchema } from "@boca/contracts";
import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { cache } from "react";
import { BRAND } from "@/lib/brand";
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

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
// Baked single-tenant fallback: keeps existing deployments (and local dev
// without a registered domain) working while domains are being onboarded.
const FALLBACK_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG || "desaga";

/** Unresolved host -> the baked default brand (today's Desaga look). */
function fallbackTenant(): TenantInfo {
  return {
    slug: FALLBACK_SLUG,
    fullName: BRAND.full,
    shortName: BRAND.name,
    tagline: BRAND.tagline,
    greeting: BRAND.greeting,
    promise: BRAND.promise,
    locations: [...BRAND.locations],
    logoUrl: null,
  };
}

/** Resolved tenant -> brand view with neutral fallbacks per missing field. */
function tenantFromContext(ctx: HostTenant): TenantInfo {
  const b = ctx.branding;
  return {
    slug: ctx.tenantSlug,
    fullName: ctx.tenantName,
    shortName: b.displayName ?? ctx.tenantName,
    tagline: b.tagline,
    greeting: b.greeting ?? "Bine ați venit!",
    promise: b.promise,
    locations: b.locations,
    logoUrl: b.logoUrl,
  };
}

/**
 * Which tenant serves this request's hostname (memoized per request). Server-
 * side call straight to the internal API, forwarding the browser-facing host;
 * unregistered domains (or an unreachable API) fall back to the baked tenant.
 */
const resolveTenant = cache(
  async (): Promise<{ tenant: TenantInfo; colors: Record<string, string> }> => {
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
          // Whitelisted keys + strict hex, enforced by the contract schema —
          // safe to interpolate into CSS custom properties.
          const colors: Record<string, string> = {};
          for (const [key, value] of Object.entries(ctx.branding.colors)) {
            if (value) colors[`--${key}`] = value;
          }
          return { tenant: tenantFromContext(ctx), colors };
        }
      }
    } catch {
      /* fall through to the baked tenant */
    }
    return { tenant: fallbackTenant(), colors: {} };
  },
);

export async function generateMetadata(): Promise<Metadata> {
  const { tenant } = await resolveTenant();
  return {
    title: `${tenant.shortName} — Meniu`,
    description: `Meniul ${tenant.fullName}.`,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { tenant, colors } = await resolveTenant();
  return (
    <html
      lang="ro"
      className={`${fraunces.variable} ${instrument.variable}`}
      style={colors as React.CSSProperties}
    >
      <body>
        <TenantProvider value={tenant}>{children}</TenantProvider>
      </body>
    </html>
  );
}
