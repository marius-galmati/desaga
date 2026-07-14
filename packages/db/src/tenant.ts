// The ONLY sanctioned query paths out of this package. The Kysely instance /
// pg Pool are deliberately not exported: it must be structurally impossible to
// run a tenant-scoped query without SET LOCAL app.tenant_id.

import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import type { DB } from "./generated/db";

let appDb: Kysely<DB> | undefined;
let workerDb: Kysely<DB> | undefined;

function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10 }),
    }),
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getAppDb(): Kysely<DB> {
  // Runtime app pool. APP_DATABASE_URL, when set, is a boca_app LOGIN role so
  // RLS is enforced; migrations/seeds keep using DATABASE_URL (superuser). In
  // dev without APP_DATABASE_URL it falls back to DATABASE_URL (RLS bypassed).
  appDb ??= createDb(process.env.APP_DATABASE_URL ?? requireEnv("DATABASE_URL"));
  return appDb;
}

function getWorkerDb(): Kysely<DB> {
  // Prod: a LOGIN user with the boca_worker role (narrow cross-tenant RLS
  // policies). Dev falls back to DATABASE_URL.
  workerDb ??= createDb(process.env.WORKER_DATABASE_URL ?? requireEnv("DATABASE_URL"));
  return workerDb;
}

export type TenantTransaction = Transaction<DB>;

/**
 * Runs `fn` inside a transaction with `SET LOCAL app.tenant_id` applied, so
 * every RLS policy is scoped to that tenant for the duration of the tx.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (trx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return getAppDb()
    .transaction()
    .execute(async (trx) => {
      // set_config(..., true) == SET LOCAL: reverts at tx end.
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });
}

/**
 * Cross-tenant path for background jobs (outbox relay, escalation scanner,
 * retention purge, ...). Runs on the worker connection with NO tenant setting;
 * instead the transaction assumes the boca_worker DB role explicitly.
 *
 * Why SET LOCAL ROLE and not just a boca_worker login: it pins the exact
 * privilege surface (narrow cross-tenant RLS policies + column-level grants
 * from migration 0013) regardless of how privileged the LOGIN user is. In dev,
 * compose connects as the `boca` superuser — without SET ROLE every worker
 * query would silently bypass RLS and behave nothing like prod. SET LOCAL
 * reverts at transaction end, so pooled connections never leak the role. Prod
 * worker login users must be GRANTed boca_worker for this to succeed.
 */
export async function asSystem<T>(fn: (trx: TenantTransaction) => Promise<T>): Promise<T> {
  return getWorkerDb()
    .transaction()
    .execute(async (trx) => {
      await sql`SET LOCAL ROLE boca_worker`.execute(trx);
      return fn(trx);
    });
}

/**
 * Sanctioned pre-tenant path for staff login: resolves a tenant slug to its id
 * via the SECURITY DEFINER function resolve_tenant_slug (see init migration).
 */
export async function resolveTenantIdBySlug(slug: string): Promise<string | null> {
  const result = await sql<{ tenant_id: string | null }>`
    select resolve_tenant_slug(${slug}) as tenant_id
  `.execute(getAppDb());
  return result.rows[0]?.tenant_id ?? null;
}

/** Closes both pools; call from the app's shutdown hook. */
export async function destroyDbPools(): Promise<void> {
  await appDb?.destroy();
  await workerDb?.destroy();
  appDb = undefined;
  workerDb = undefined;
}
