// Framework-free typed catalogs. next-intl / use-intl glue lands with the
// frontends. UI copy lives here; menu CONTENT is data ({ro,en} JSONB in
// dish_version). Catalogs are per-locale directories with one JSON file per
// namespace: src/catalogs/{locale}/{namespace}.json.

import type { SupportedLocale } from "@boca/config";
import enCommon from "./catalogs/en/common.json";
import roCommon from "./catalogs/ro/common.json";

// Romanian (default locale) is the canonical message shape. The Record
// annotation below makes every other locale conform at compile time
// (missing keys fail typecheck); exact two-way parity is enforced by
// test/catalogs.test.ts.
const roCatalog = { common: roCommon };

export type Catalog = typeof roCatalog;
export type Namespace = keyof Catalog;
export type CommonMessages = Catalog["common"];

export const catalogs: Record<SupportedLocale, Catalog> = {
  ro: roCatalog,
  en: { common: enCommon },
};

export function getCatalog(locale: SupportedLocale): Catalog {
  return catalogs[locale];
}

// Dot-path of every string leaf, namespace included,
// e.g. "common.errors.generic" | "common.orderStatus.fired" | ...
type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = LeafPaths<Catalog>;

// Minimal typed lookup for backend/tests (no ICU, no interpolation).
// Falls back to the key itself if a catalog ever drifts at runtime.
export function getMessage(locale: SupportedLocale, key: MessageKey): string {
  let node: unknown = catalogs[locale];
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}
