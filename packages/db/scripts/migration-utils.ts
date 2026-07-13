// Pure helpers for the migration runner — no DB access, unit-tested without
// a database (test/migrations.test.ts).

import { createHash } from "node:crypto";

export const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const UP_MARKER = "-- Up Migration";
const DOWN_MARKER = "-- Down Migration";

export interface ParsedMigration {
  name: string;
  up: string;
  down: string;
  /** sha256 of the whole file, line endings normalized (Windows-safe). */
  checksum: string;
}

/** Checksum over LF-normalized content so git autocrlf cannot cause drift. */
export function checksumOf(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex");
}

export function parseMigration(name: string, content: string): ParsedMigration {
  if (!MIGRATION_FILE_RE.test(name)) {
    throw new Error(`${name}: file name must match NNNN_name.sql (snake_case)`);
  }
  const upAt = content.indexOf(UP_MARKER);
  const downAt = content.lastIndexOf(DOWN_MARKER);
  if (upAt === -1) {
    throw new Error(`${name}: missing "${UP_MARKER}" marker`);
  }
  if (downAt === -1 || downAt < upAt) {
    throw new Error(`${name}: missing "${DOWN_MARKER}" marker (after the Up section)`);
  }
  const up = content.slice(upAt + UP_MARKER.length, downAt).trim();
  const down = content.slice(downAt + DOWN_MARKER.length).trim();
  if (up === "") {
    throw new Error(`${name}: empty Up section`);
  }
  return { name, up, down, checksum: checksumOf(content) };
}

/**
 * Migrations apply in lexicographic file-name order; the NNNN prefix IS the
 * order, so duplicates are refused outright.
 */
export function sortAndValidate(names: string[]): string[] {
  const sorted = [...names].sort();
  const seen = new Map<string, string>();
  for (const name of sorted) {
    const match = MIGRATION_FILE_RE.exec(name);
    if (!match || match[1] === undefined) {
      throw new Error(`${name}: file name must match NNNN_name.sql (snake_case)`);
    }
    const clash = seen.get(match[1]);
    if (clash !== undefined) {
      throw new Error(`duplicate migration number ${match[1]}: ${clash} vs ${name}`);
    }
    seen.set(match[1], name);
  }
  return sorted;
}

export function nextMigrationName(existing: string[], label: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(label)) {
    throw new Error(`invalid migration label "${label}" — use snake_case, e.g. add_pos_tables`);
  }
  let max = 0;
  for (const name of existing) {
    const match = MIGRATION_FILE_RE.exec(name);
    if (match?.[1] !== undefined) {
      max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }
  return `${String(max + 1).padStart(4, "0")}_${label}.sql`;
}
