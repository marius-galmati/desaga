// Typed fetch client for the platform (super-admin) surface. Same-origin /api
// proxy; the platform JWT lives in localStorage (ops tool, 8h expiry, re-login
// after). A 401 clears the token and drops the caller back to the login card.

import {
  type AddPlatformDomainRequest,
  type CreatePlatformTenantRequest,
  type PlatformLoginResponse,
  type PlatformTenant,
  platformLoginResponseSchema,
  platformTenantListSchema,
  type UpdatePlatformBrandingRequest,
} from "@boca/contracts";

const TOKEN_KEY = "boca.platform.token";

export function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* memory-only fallback */
  }
}

export class PlatformUnauthorizedError extends Error {
  constructor() {
    super("Sesiune expirată");
    this.name = "PlatformUnauthorizedError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
): Promise<T> {
  const token = storedToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    throw new PlatformUnauthorizedError();
  }
  if (!res.ok) {
    let message = `Cererea a eșuat (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* keep generic */
    }
    throw new Error(message);
  }
  const text = await res.text();
  return parse(text.length > 0 ? JSON.parse(text) : null);
}

export async function login(email: string, password: string): Promise<PlatformLoginResponse> {
  const result = await request(
    "/platform/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    (p) => platformLoginResponseSchema.parse(p),
  );
  storeToken(result.token);
  return result;
}

export function listTenants(): Promise<PlatformTenant[]> {
  return request("/platform/tenants", { method: "GET" }, (p) => platformTenantListSchema.parse(p));
}

export function createTenant(body: CreatePlatformTenantRequest): Promise<{ tenantId: string }> {
  return request(
    "/platform/tenants",
    { method: "POST", body: JSON.stringify(body) },
    (p) => p as { tenantId: string },
  );
}

export function addDomain(tenantId: string, body: AddPlatformDomainRequest): Promise<void> {
  return request(
    `/platform/tenants/${tenantId}/domains`,
    { method: "POST", body: JSON.stringify(body) },
    () => undefined,
  );
}

export function deleteDomain(domainId: string): Promise<void> {
  return request(
    `/platform/domains/${domainId}`,
    { method: "DELETE", body: JSON.stringify({}) },
    () => undefined,
  );
}

export function updateBranding(
  tenantId: string,
  body: UpdatePlatformBrandingRequest,
): Promise<void> {
  return request(
    `/platform/tenants/${tenantId}/branding`,
    { method: "PUT", body: JSON.stringify(body) },
    () => undefined,
  );
}
