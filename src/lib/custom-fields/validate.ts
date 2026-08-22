import type { CustomFieldDefinition } from "@prisma/client";

/**
 * Pure, zero-I/O check: a Contact.customFields value against its org's
 * declared CustomFieldDefinition.type. Contact.customFields is a plain Json
 * column with no schema-level enforcement (context.md's own "don't add a
 * column for something JSON can carry" precedent — see decisions.md's M6
 * LOCATION-body entry for the same judgment made elsewhere), so nothing
 * previously stopped e.g. a NUMBER field from being saved as arbitrary text.
 */
export interface CustomFieldValidationResult {
  ok: boolean;
  /** { fieldKey: reason } for every value that failed its declared type. */
  errors: Record<string, string>;
}

export function validateCustomFieldValues(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown>,
): CustomFieldValidationResult {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) continue; // an unknown key isn't this function's concern
    if (value === null || value === undefined || value === "") continue; // clearing a field is always allowed

    switch (def.type) {
      case "NUMBER":
        if (typeof value !== "number" && (typeof value !== "string" || Number.isNaN(Number(value)))) {
          errors[key] = `${def.label} must be a number`;
        }
        break;
      case "DATE":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
          errors[key] = `${def.label} must be a valid date`;
        }
        break;
      case "LIST": {
        const options = Array.isArray(def.options) ? (def.options as unknown[]) : [];
        if (!options.includes(value)) {
          errors[key] = `${def.label} must be one of: ${options.join(", ")}`;
        }
        break;
      }
      case "TEXT":
        if (typeof value !== "string") {
          errors[key] = `${def.label} must be text`;
        }
        break;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
