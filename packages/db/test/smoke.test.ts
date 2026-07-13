// No-DB smoke: the package must import cleanly (pools are lazy) and the
// committed migration set must be well-formed for the runner.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checksumOf,
  nextMigrationName,
  parseMigration,
  sortAndValidate,
} from "../scripts/migration-utils";
import * as db from "../src/index";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("@boca/db public surface", () => {
  it("exports the sanctioned query paths without opening a pool", () => {
    expect(typeof db.withTenant).toBe("function");
    expect(typeof db.asSystem).toBe("function");
    expect(typeof db.resolveTenantIdBySlug).toBe("function");
    expect(typeof db.destroyDbPools).toBe("function");
  });

  it("does not export the Kysely instance or the pg Pool", () => {
    const exported = Object.keys(db);
    expect(exported).not.toContain("getAppDb");
    expect(exported).not.toContain("getWorkerDb");
    expect(exported).not.toContain("pool");
  });
});

describe("migration set", () => {
  const names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

  it("has uniquely numbered NNNN_name.sql files starting at 0001_roles.sql", () => {
    const sorted = sortAndValidate(names);
    expect(sorted[0]).toBe("0001_roles.sql");
    expect(sorted.length).toBeGreaterThanOrEqual(13);
  });

  it("every file parses into non-empty Up and Down sections", () => {
    for (const name of names) {
      const parsed = parseMigration(name, readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
      expect(parsed.up.length, `${name} Up`).toBeGreaterThan(0);
      expect(parsed.down.length, `${name} Down`).toBeGreaterThan(0);
    }
  });

  it("checksums are line-ending independent (git autocrlf safety)", () => {
    expect(checksumOf("select 1;\nselect 2;\n")).toBe(checksumOf("select 1;\r\nselect 2;\r\n"));
  });

  it("nextMigrationName continues the sequence", () => {
    expect(nextMigrationName(names, "add_pos_tables")).toMatch(/^\d{4}_add_pos_tables\.sql$/);
    expect(nextMigrationName([], "first")).toBe("0001_first.sql");
    expect(() => nextMigrationName(names, "Bad-Name")).toThrow();
  });
});
