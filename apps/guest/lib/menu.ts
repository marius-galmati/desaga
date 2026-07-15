import {
  type GuestMenu,
  guestMenuSchema,
  type GuestTable,
  guestTablesSchema,
} from "@boca/contracts";

// Phase 1 serves a single tenant per deployment; the slug is baked at build.
// (Phase 2 swaps this for a per-table QR slug in the URL.)
export const TENANT_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG || "desaga";

export async function fetchMenu(slug: string = TENANT_SLUG): Promise<GuestMenu> {
  const res = await fetch(`/api/guest/${encodeURIComponent(slug)}/menu`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Meniul nu a fost găsit pentru acest restaurant."
        : `Nu am putut încărca meniul (${res.status}).`,
    );
  }
  return guestMenuSchema.parse(await res.json());
}

export async function fetchTables(slug: string = TENANT_SLUG): Promise<GuestTable[]> {
  const res = await fetch(`/api/guest/${encodeURIComponent(slug)}/tables`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return guestTablesSchema.parse(await res.json());
}

/** RON bani → "42 lei" (whole lei; menus here are round-lei). */
export function formatLei(minor: number): string {
  const lei = minor / 100;
  const s = Number.isInteger(lei) ? String(lei) : lei.toFixed(2).replace(".", ",");
  return `${s} lei`;
}
