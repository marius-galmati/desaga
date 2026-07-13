import { describe, expect, it } from "vitest";
import { catalogs, getMessage } from "../src";

function leafKeys(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? leafKeys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("i18n catalogs", () => {
  it("ro and en have identical key sets", () => {
    expect(leafKeys(catalogs.en).sort()).toEqual(leafKeys(catalogs.ro).sort());
  });

  it("every leaf is a non-empty string", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const key of leafKeys(catalogs[locale])) {
        expect(getMessage(locale, key as never), `${locale}:${key}`).toMatch(/\S/);
      }
    }
  });

  it("covers all six db order_status values", () => {
    // Mirror of the order_status enum in db/schema.sql.
    const dbOrderStatuses = ["submitted", "accepted", "fired", "ready", "served", "voided"];
    expect(Object.keys(catalogs.ro.common.orderStatus).sort()).toEqual(dbOrderStatuses.sort());
  });

  it("resolves typed dot-paths per locale, falling back to the key", () => {
    expect(getMessage("ro", "common.app.name")).toBe("Boca");
    expect(getMessage("ro", "common.orderStatus.fired")).toBe("În preparare");
    expect(getMessage("en", "common.orderStatus.served")).toBe("Served");
    expect(getMessage("en", "common.nope.missing" as never)).toBe("common.nope.missing");
  });
});
