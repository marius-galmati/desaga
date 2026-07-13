// Creates the next migrations/NNNN_<label>.sql from the template below.
//   pnpm --filter @boca/db migration:new -- add_pos_tables

import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextMigrationName } from "./migration-utils";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const TEMPLATE = `-- Up Migration


-- Down Migration

`;

const label = process.argv[2];
if (!label) {
  console.error("usage: pnpm --filter @boca/db migration:new -- <snake_case_label>");
  process.exit(1);
}

const existing = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
const name = nextMigrationName(existing, label);
const target = path.join(MIGRATIONS_DIR, name);
writeFileSync(target, TEMPLATE, { encoding: "utf8", flag: "wx" });
console.log(`created ${target}`);
