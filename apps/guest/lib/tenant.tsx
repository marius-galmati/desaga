"use client";

import { createContext, useContext } from "react";

/** The tenant serving this request's hostname, resolved server-side in layout. */
export interface TenantInfo {
  slug: string;
  name: string;
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
