import { initContract } from "@ts-rest/core";
import { authContract } from "./auth";
import {
  ADMIN_UPLOAD_PATH,
  evaluationContract,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UPLOAD_FILE_FIELD,
  UPLOAD_MAX_BYTES,
} from "./evaluation";
import { healthContract } from "./health";
import { tenancyContract } from "./tenancy";

const c = initContract();

// Namespace note: everything here is the STAFF/shared surface. When guest and
// admin surfaces land, this becomes c.router({ staff, guest, admin }) with a
// pathPrefix per namespace (guest routes authenticate via session device
// token, admin via boca_platform) — keep the route KEYS stable, only nest.
// `evaluation` is admin-facing already (paths carry /admin literally) and
// will nest under the admin namespace when the split happens.
export const apiContract = c.router({
  health: healthContract,
  auth: authContract,
  tenancy: tenancyContract,
  evaluation: evaluationContract,
});

export {
  ADMIN_UPLOAD_PATH,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UPLOAD_FILE_FIELD,
  UPLOAD_MAX_BYTES,
  authContract,
  evaluationContract,
  healthContract,
  tenancyContract,
};
