"use client";

import { createContext, useContext } from "react";

/**
 * The resolved brand view for this request's hostname, computed server-side in
 * layout (branding row merged with fallbacks). `shortName` is the compact brand
 * mark (topbar, keepsake); `fullName` is the long display name (hero, footer).
 */
export interface TenantInfo {
  slug: string;
  fullName: string;
  shortName: string;
  tagline: string | null;
  greeting: string;
  promise: string | null;
  locations: string[];
  logoUrl: string | null;
}

const TenantContext = createContext<TenantInfo | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantInfo;
  children: React.ReactNode;
}) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantInfo {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used inside TenantProvider");
  }
  return ctx;
}
