// Importable ONLY by apps/api (enforced with Turborepo boundaries tags).
// Frontends see the system exclusively through @boca/contracts.

export * from "./criteria";
export type { DB, UserRole as DbUserRole } from "./generated/db";
export * from "./repositories/audit";
export * from "./repositories/auth";
export * from "./repositories/demoFixtures";
export * from "./repositories/evaluations";
export * from "./repositories/menu";
export * from "./repositories/passPhotos";
export * from "./repositories/references";
export * from "./repositories/tenancy";
export {
  asSystem,
  destroyDbPools,
  resolveQrSlug,
  resolveSessionToken,
  resolveTenantDomain,
  resolveTenantIdBySlug,
  type TenantTransaction,
  withTenant,
} from "./tenant";
