// Typed Socket.IO event maps — TYPES ONLY, no runtime code, no socket.io
// dependency (the generics are plugged in by apps/api and the clients:
// `new Server<ClientToServerEvents, ServerToClientEvents, ...>`).
//
// TODO(orders increment): wire into the apps/api gateway; emit from the same
// services that write the rows (after commit), rooms per (tenant, location)
// for staff and per table_session for guests.
// TODO(service increment): escalation tier events beyond level 1.

import type { OrderStatus, ServiceRequestKind, ServiceRequestStatus } from "../schemas/enums";

// Timestamps travel as ISO-8601 strings on the wire.
type IsoDateTime = string;

export interface ServiceRequestEventPayload {
  serviceRequestId: string;
  tableSessionId: string;
  diningTableId: string;
  locationId: string;
  kind: ServiceRequestKind;
  status: ServiceRequestStatus;
  escalationLevel: number;
  occurredAt: IsoDateTime;
}

export interface OrderEventPayload {
  orderId: string;
  tableSessionId: string;
  locationId: string;
  status: OrderStatus;
  isFirstOfSession: boolean;
  totalMinor: number;
  occurredAt: IsoDateTime;
}

export interface OrderItemEventPayload {
  orderId: string;
  orderItemId: string;
  dishVersionId: string;
  courseNo: number;
  quantity: number;
  status: OrderStatus;
  occurredAt: IsoDateTime;
}

// Server -> client (staff floor view, pass ticket rail, guest session view).
export interface ServerToClientEvents {
  // call_waiter / request_bill lifecycle
  "service_request.created": (payload: ServiceRequestEventPayload) => void;
  "service_request.acknowledged": (payload: ServiceRequestEventPayload) => void;
  "service_request.escalated": (payload: ServiceRequestEventPayload) => void;
  "service_request.resolved": (payload: ServiceRequestEventPayload) => void;
  // ticket flow
  "order.submitted": (payload: OrderEventPayload) => void;
  "order.accepted": (payload: OrderEventPayload) => void;
  "order.served": (payload: OrderEventPayload) => void;
  "order.voided": (payload: OrderEventPayload) => void;
  "order_item.fired": (payload: OrderItemEventPayload) => void;
  "order_item.ready": (payload: OrderItemEventPayload) => void;
  "order_item.served": (payload: OrderItemEventPayload) => void;
  "order_item.voided": (payload: OrderItemEventPayload) => void;
}

// Client -> server. Deliberately thin: mutations go through the REST
// contract; sockets only manage room membership. TODO revisit with the
// orders increment (e.g. ack-from-notification fast path).
export interface ClientToServerEvents {
  "room.join_location": (locationId: string, ack: (ok: boolean) => void) => void;
  "room.join_session": (tableSessionId: string, ack: (ok: boolean) => void) => void;
}

// biome-ignore lint/suspicious/noEmptyInterface: deliberately empty socket.io generic slot; stays an interface so the Redis-adapter increment can fill it via declaration merging
export interface InterServerEvents {
  // TODO: only needed once the API scales past one node (Redis adapter).
}

// Per-connection state stamped by the socket auth middleware.
export interface SocketData {
  tenantId: string;
  principalKind: "staff" | "guest";
  userId?: string; // staff only
  sessionGuestId?: string; // guest only
}
