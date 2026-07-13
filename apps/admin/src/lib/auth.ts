// Client-side session: access token lives ONLY in memory (module scope, gone
// on hard reload), the opaque rotating refresh token persists in localStorage
// so a reload can restore the session via POST /auth/refresh.

import {
  type AuthUser,
  type LoginRequest,
  loginRequestSchema,
  loginResponseSchema,
} from "@boca/contracts";

const REFRESH_TOKEN_KEY = "boca.admin.refreshToken";

let accessToken: string | null = null;
let currentUser: AuthUser | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeSession(payload: unknown): void {
  const parsed = loginResponseSchema.parse(payload);
  accessToken = parsed.tokens.accessToken;
  currentUser = parsed.user;
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, parsed.tokens.refreshToken);
  } catch {
    // Private-mode storage failures degrade to a memory-only session.
  }
}

export function clearSession(): void {
  accessToken = null;
  currentUser = null;
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export async function login(credentials: LoginRequest): Promise<void> {
  const body = loginRequestSchema.parse(credentials);
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    throw new Error("Date de autentificare incorecte.");
  }
  if (!res.ok) {
    throw new Error("Autentificarea a eșuat. Încearcă din nou.");
  }
  storeSession(await res.json());
}

/**
 * Rotate the refresh token into a fresh access token. Returns false when there
 * is no stored refresh token or the server rejects it (session truly gone).
 */
export async function refreshSession(): Promise<boolean> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return false;
  let res: Response;
  try {
    res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return false;
  }
  if (!res.ok) {
    clearSession();
    return false;
  }
  storeSession(await res.json());
  return true;
}

/** Restore a session after a hard reload; true when authenticated. */
export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

export async function logout(): Promise<void> {
  const refreshToken = readRefreshToken();
  if (refreshToken) {
    // Best-effort server-side revocation.
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // ignore
    }
  }
  clearSession();
}
