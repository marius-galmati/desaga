// Hand-rolled SQL migration runner (chosen over node-pg-migrate: zero DSL and
// zero naming conventions between us and the RLS/partition DDL, checksum
// verification of applied files, one dependency less).
//
//   tsx scripts/migrate.ts up            apply all pending migrations
//   tsx scripts/migrate.ts down [n]      revert the last n applied (default 1)
//   tsx scripts/migrate.ts status        list applied/pending
//
// Reads DATABASE_URL (package scripts load ../../.env via dotenv-cli). Each
// migration runs in its own transaction together with its bookkeeping row; a
// session advisory lock serializes concurrent runners. Applied files are
// checksum-verified on every run — editing an applied migration is an error,
// write a new one instead.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { type ParsedMigration, parseMigration, sortAndValidate } from "./migration-utils";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
// Arbitrary app-unique constant shared by every runner invocation.
const ADVISORY_LOCK_KEY = 731_402_611;

interface AppliedRow {
  name: string;
  checksum: string;
}

function loadMigrations(): ParsedMigration[] {
  const names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return sortAndValidate(names).map((name) =>
    parseMigration(name, readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")),
  );
}

async function fetchApplied(client: pg.Client): Promise<AppliedRow[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const result = await client.query<AppliedRow>(
    "SELECT name, checksum FROM schema_migrations ORDER BY name",
  );
  return result.rows;
}

/** Applied rows must be an in-order prefix of the files, checksums intact. */
function reconcile(files: ParsedMigration[], applied: AppliedRow[]): ParsedMigration[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) {
      throw new Error(`applied migration ${row.name} no longer exists in migrations/`);
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `${row.name} was edited after being applied (checksum mismatch) — write a new migration instead`,
      );
    }
  }
  const appliedNames = new Set(applied.map((row) => row.name));
  const lastApplied = applied.at(-1)?.name ?? "";
  const pending = files.filter((f) => !appliedNames.has(f.name));
  const outOfOrder = pending.find((f) => f.name < lastApplied);
  if (outOfOrder) {
    throw new Error(
      `${outOfOrder.name} sorts before already-applied ${lastApplied} — renumber it after ${lastApplied}`,
    );
  }
  return pending;
}

async function up(client: pg.Client): Promise<void> {
  const pending = reconcile(loadMigrations(), await fetchApplied(client));
  if (pending.length === 0) {
    console.log("migrate: nothing to do (database is up to date)");
    return;
  }
  for (const migration of pending) {
    await client.query("BEGIN");
    try {
      await client.query(migration.up);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        migration.checksum,
      ]);
      await client.query("COMMIT");
      console.log(`migrate: applied ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migrate: FAILED in ${migration.name}`, { cause: error });
    }
  }
}

async function down(client: pg.Client, count: number): Promise<void> {
  const files = loadMigrations();
  const applied = await fetchApplied(client);
  reconcile(files, applied); // checksum + ordering sanity before touching anything
  const byName = new Map(files.map((f) => [f.name, f]));
  const targets = applied.slice(-count).reverse();
  if (targets.length === 0) {
    console.log("migrate: nothing to revert");
    return;
  }
  for (const row of targets) {
    const migration = byName.get(row.name);
    if (!migration) {
      throw new Error(`cannot revert ${row.name}: file missing`);
    }
    await client.query("BEGIN");
    try {
      await client.query(migration.down);
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [migration.name]);
      await client.query("COMMIT");
      console.log(`migrate: reverted ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migrate: FAILED reverting ${migration.name}`, { cause: error });
    }
  }
}

async function status(client: pg.Client): Promise<void> {
  const files = loadMigrations();
  const applied = new Set((await fetchApplied(client)).map((row) => row.name));
  for (const file of files) {
    console.log(`${applied.has(file.name) ? "applied" : "pending"}  ${file.name}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (package scripts load it from ../../.env)");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    switch (command) {
      case "up":
        await up(client);
        break;
      case "down": {
        const count = Number.parseInt(process.argv[3] ?? "1", 10);
        if (!Number.isInteger(count) || count < 1) {
          throw new Error(`invalid down count "${process.argv[3]}"`);
        }
        await down(client, count);
        break;
      }
      case "status":
        await status(client);
        break;
      default:
        throw new Error(`unknown command "${command}" (expected: up | down [n] | status)`);
    }
  } finally {
    await client.end(); // session end releases the advisory lock
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
