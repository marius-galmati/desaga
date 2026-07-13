import { describe, expect, it } from "vitest";
import {
  bilingualTextSchema,
  canTransition,
  dbEnums,
  orderItemTransitions,
  orderStatusSchema,
  orderTransitions,
  serviceRequestTransitions,
} from "../src";

describe("canTransition — guest_order (order level)", () => {
  it.each([
    ["submitted", "accepted", true],
    ["submitted", "voided", true],
    ["submitted", "served", false], // must be accepted first
    ["accepted", "served", true],
    ["accepted", "voided", true],
    ["accepted", "submitted", false], // no going back
    ["served", "voided", false], // terminal
    ["voided", "accepted", false], // terminal
  ] as const)("%s -> %s = %s", (from, to, expected) => {
    expect(canTransition(orderTransitions, from, to)).toBe(expected);
  });
});

describe("canTransition — order_item (adds fired/ready)", () => {
  it.each([
    ["accepted", "fired", true],
    ["fired", "ready", true],
    ["fired", "served", true], // pass may serve straight from fired
    ["ready", "served", true],
    ["submitted", "fired", false], // must be accepted first
    ["ready", "fired", false], // no un-bump
    ["served", "ready", false], // terminal
  ] as const)("%s -> %s = %s", (from, to, expected) => {
    expect(canTransition(orderItemTransitions, from, to)).toBe(expected);
  });
});

describe("canTransition — service_request", () => {
  it.each([
    ["open", "acknowledged", true],
    ["open", "escalated", true],
    ["open", "cancelled", true],
    ["escalated", "acknowledged", true],
    ["escalated", "resolved", true],
    ["acknowledged", "escalated", false], // acked requests stop escalating
    ["resolved", "open", false], // terminal
    ["cancelled", "resolved", false], // terminal
  ] as const)("%s -> %s = %s", (from, to, expected) => {
    expect(canTransition(serviceRequestTransitions, from, to)).toBe(expected);
  });
});

describe("transition maps stay inside their enums", () => {
  it("every order_item transition target is a db order_status value", () => {
    for (const targets of Object.values(orderItemTransitions)) {
      for (const target of targets) {
        expect(orderStatusSchema.options).toContain(target);
      }
    }
  });

  it("mirrors all 25 db enums", () => {
    expect(Object.keys(dbEnums)).toHaveLength(25);
  });
});

describe("schema parse", () => {
  it("bilingualText requires both ro and en", () => {
    expect(bilingualTextSchema.safeParse({ ro: "Vită", en: "Beef" }).success).toBe(true);
    expect(bilingualTextSchema.safeParse({ ro: "Vită" }).success).toBe(false);
  });
});
