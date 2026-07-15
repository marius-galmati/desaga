import {
  type GuestOrder,
  type GuestPlate,
  type GuestSession,
  guestOrderListSchema,
  guestOrderSchema,
  guestPlateListSchema,
  guestSessionSchema,
  type PlaceOrderRequest,
  type ServiceRequestKind,
} from "@boca/contracts";

// The device token is returned once by startSession and stored per QR slug so a
// page reload rejoins the same tab instead of opening a new guest identity.
const tokenKey = (qrSlug: string) => `boca.guest.token.${qrSlug}`;

export function storedToken(qrSlug: string): string | null {
  try {
    return window.localStorage.getItem(tokenKey(qrSlug));
  } catch {
    return null;
  }
}

function storeToken(qrSlug: string, token: string): void {
  try {
    window.localStorage.setItem(tokenKey(qrSlug), token);
  } catch {
    /* memory-only fallback */
  }
}

async function jsonOrThrow<T>(res: Response, parse: (p: unknown) => T): Promise<T> {
  if (!res.ok) {
    let msg = `Cererea a eșuat (${res.status}).`;
    try {
      const b = (await res.json()) as { message?: string };
      if (b.message) msg = b.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return parse(await res.json());
}

export async function startSession(qrSlug: string): Promise<GuestSession> {
  const res = await fetch("/api/guest/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrSlug }),
  });
  const session = await jsonOrThrow(res, (p) => guestSessionSchema.parse(p));
  storeToken(qrSlug, session.token);
  return session;
}

function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Guest-Token": token };
}

export async function placeOrder(token: string, body: PlaceOrderRequest): Promise<GuestOrder> {
  const res = await fetch("/api/guest/orders", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res, (p) => guestOrderSchema.parse(p));
}

export async function listOrders(token: string): Promise<GuestOrder[]> {
  const res = await fetch("/api/guest/orders", { headers: { "X-Guest-Token": token } });
  return jsonOrThrow(res, (p) => guestOrderListSchema.parse(p));
}

export async function serviceRequest(token: string, kind: ServiceRequestKind): Promise<void> {
  const res = await fetch("/api/guest/service", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ kind }),
  });
  await jsonOrThrow(res, () => undefined);
}

/** "Farfuria mea" — the table's plates photographed at the pass + their fidelity. */
export async function listPlates(token: string): Promise<GuestPlate[]> {
  const res = await fetch("/api/guest/plates", { headers: { "X-Guest-Token": token } });
  return jsonOrThrow(res, (p) => guestPlateListSchema.parse(p));
}

// Romanian status labels for the order/item state machine.
export const STATUS_RO: Record<string, string> = {
  submitted: "Trimisă",
  accepted: "Acceptată",
  fired: "În pregătire",
  ready: "Gata",
  served: "Servită",
  voided: "Anulată",
};
