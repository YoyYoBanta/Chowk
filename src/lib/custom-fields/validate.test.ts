import { describe, expect, it } from "vitest";
import type { CustomFieldDefinition } from "@prisma/client";
import { validateCustomFieldValues } from "./validate";

function def(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "def_1",
    organizationId: "org_1",
    key: "field",
    label: "Field",
    type: "TEXT",
    options: null,
    ...overrides,
  } as CustomFieldDefinition;
}

describe("validateCustomFieldValues", () => {
  it("accepts a valid NUMBER value, as a number or a numeric string", () => {
    const defs = [def({ key: "age", label: "Age", type: "NUMBER" })];
    expect(validateCustomFieldValues(defs, { age: 42 }).ok).toBe(true);
    expect(validateCustomFieldValues(defs, { age: "42" }).ok).toBe(true);
  });

  it("rejects a non-numeric NUMBER value with the field's label in the message", () => {
    const defs = [def({ key: "age", label: "Age", type: "NUMBER" })];
    const result = validateCustomFieldValues(defs, { age: "not a number" });
    expect(result.ok).toBe(false);
    expect(result.errors.age).toMatch(/Age/);
  });

  it("accepts a valid ISO DATE string, rejects garbage", () => {
    const defs = [def({ key: "renewal", label: "Renewal", type: "DATE" })];
    expect(validateCustomFieldValues(defs, { renewal: "2026-09-01" }).ok).toBe(true);
    expect(validateCustomFieldValues(defs, { renewal: "not-a-date" }).ok).toBe(false);
  });

  it("accepts a LIST value that's one of the declared options, rejects anything else", () => {
    const defs = [def({ key: "tier", label: "Tier", type: "LIST", options: ["gold", "silver", "bronze"] })];
    expect(validateCustomFieldValues(defs, { tier: "gold" }).ok).toBe(true);
    expect(validateCustomFieldValues(defs, { tier: "platinum" }).ok).toBe(false);
  });

  it("treats null/undefined/empty-string as clearing the field — always valid, regardless of type", () => {
    const defs = [def({ key: "age", label: "Age", type: "NUMBER" })];
    expect(validateCustomFieldValues(defs, { age: "" }).ok).toBe(true);
    expect(validateCustomFieldValues(defs, { age: null }).ok).toBe(true);
    expect(validateCustomFieldValues(defs, { age: undefined }).ok).toBe(true);
  });

  it("ignores a key with no matching definition", () => {
    const result = validateCustomFieldValues([], { anything: "goes" });
    expect(result.ok).toBe(true);
  });

  it("reports every failing key, not just the first", () => {
    const defs = [
      def({ key: "age", label: "Age", type: "NUMBER" }),
      def({ key: "renewal", label: "Renewal", type: "DATE" }),
    ];
    const result = validateCustomFieldValues(defs, { age: "abc", renewal: "xyz" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["age", "renewal"]);
  });
});
