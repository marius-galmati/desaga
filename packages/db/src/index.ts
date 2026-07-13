// Importable ONLY by apps/api (enforced with Turborepo boundaries tags).
// Frontends see the system exclusively through @boca/contracts.

export type { DB, UserRole as DbUserRole } from "./generated/db";
export * from "./repositories/audit";
export * from "./repositories/auth";
export * from "./repositories/tenancy";
export {
  asSystem,
  destroyDbPools,
  resolveTenantIdBySlug,
  type TenantTransaction,
  withTenant,
} from "./tenant";
