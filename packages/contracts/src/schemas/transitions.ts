import type { z } from "zod";
import type { OrderStatus, ServiceRequestStatus } from "./enums";
import { orderStatusSchema } from "./enums";

// State machines derived from the db/schema.sql comments. One order_status
// enum backs BOTH grains: order-level uses submitted|accepted|served|voided
// (enforced by the guest_order CHECK); item-level adds fired|ready (course
// firing). Empty array = terminal state.

export const orderLevelStatusSchema = orderStatusSchema.exclude(["fired", "ready"]);
export type OrderLevelStatus = z.infer<typeof orderLevelStatusSchema>;

// guest_order: submitted -> accepted -> served | voided. 'served' is promoted
// by the API when ALL non-voided items are served; voiding from 'submitted'
// covers waiter rejection of a first-of-session order.
export const orderTransitions = {
  submitted: ["accepted", "voided"],
  accepted: ["served", "voided"],
  served: [],
  voided: [],
} as const satisfies Record<OrderLevelStatus, readonly OrderLevelStatus[]>;

// order_item: fired -> served directly is allowed (the pass queue treats
// fired|ready as "not yet served"; 'ready' is an optional KDS bump).
export const orderItemTransitions = {
  submitted: ["accepted", "voided"],
  accepted: ["fired", "voided"],
  fired: ["ready", "served", "voided"],
  ready: ["served", "voided"],
  served: [],
  voided: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

// service_request: 'escalated' is set by the worker when unacked > 60s;
// further escalation TIERS bump escalation_level without a status change, so
// there is no escalated -> escalated edge here. Acknowledged requests no
// longer escalate. 'cancelled' = guest withdrew the request.
export const serviceRequestTransitions = {
  open: ["acknowledged", "escalated", "resolved", "cancelled"],
  acknowledged: ["resolved", "cancelled"],
  escalated: ["acknowledged", "resolved", "cancelled"],
  resolved: [],
  cancelled: [],
} as const satisfies Record<ServiceRequestStatus, readonly ServiceRequestStatus[]>;

// Generic guard usable with any of the maps above (API services and, later,
// optimistic UI on the staff clients).
export function canTransition<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  const allowed: readonly S[] | undefined = transitions[from];
  return allowed?.includes(to) ?? false;
}
