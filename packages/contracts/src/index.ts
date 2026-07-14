// SINGLE source of truth for the API surface. Depends only on zod
// (+ @ts-rest/core) — no Nest, no pg, no Node-only APIs, so it bundles
// cleanly into Next, Expo and Nest alike.

export * from "./routers";
export * from "./schemas/admin";
export * from "./schemas/auth";
export * from "./schemas/common";
export * from "./schemas/enums";
export * from "./schemas/evaluation";
export * from "./schemas/guest";
export * from "./schemas/staff";
export * from "./schemas/tenancy";
export * from "./schemas/transitions";
// Socket.IO event maps are types only; runtime gateway lands with the orders
// increment.
export type * from "./sockets/events";
