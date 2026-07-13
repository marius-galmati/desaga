import { initContract } from "@ts-rest/core";
import { authContract } from "./auth";
import { healthContract } from "./health";
import { tenancyContract } from "./tenancy";

const c = initContract();

// Namespace note: everything here is the STAFF/shared surface. When guest and
// admin surfaces land, this becomes c.router({ staff, guest, admin }) with a
// pathPrefix per namespace (guest routes authenticate via session device
// token, admin via boca_platform) — keep the route KEYS stable, only nest.
export const apiContract = c.router({
  health: healthContract,
  auth: authContract,
  tenancy: tenancyContract,
});

export { authContract, healthContract, tenancyContract };
