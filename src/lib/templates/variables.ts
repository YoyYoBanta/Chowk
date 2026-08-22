/**
 * Pure, zero-I/O helpers for WhatsApp template variable placeholders
 * (`{{1}}`, `{{2}}`, ... — the same `{{n}}` convention
 * `src/providers/baileys/adapter.ts`'s `sendTemplate()` substitutes into).
 * Extracted so both the send-time validation below and any future
 * template-authoring UI share one definition of "what counts as a
 * placeholder" rather than two regexes drifting apart.
 */

/** Every distinct `{{n}}` placeholder name found in a template body, in
 * first-appearance order, de-duplicated. */
export function extractTemplateVariableKeys(body: string): string[] {
  const matches = body.matchAll(/\{\{(\w+)\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) seen.add(m[1]);
  return Array.from(seen);
}

export interface TemplateVariableValidation {
  ok: boolean;
  /** Placeholders the body requires but `variables` didn't supply a
   * non-empty value for. */
  missing: string[];
}

/**
 * A template send is rejected if the body has a `{{n}}` placeholder with no
 * corresponding non-empty value in `variables` — sending it through would
 * either leave the literal `{{n}}` in the outgoing message (Baileys) or be
 * rejected by Meta outright (Phase B), and neither should happen silently.
 * Extra keys in `variables` beyond what the body uses are harmless and not
 * flagged — the picker UI may reasonably send a stale value.
 */
export function validateTemplateVariables(
  body: string,
  variables: Record<string, string>,
): TemplateVariableValidation {
  const required = extractTemplateVariableKeys(body);
  const missing = required.filter((key) => !variables[key]?.trim());
  return { ok: missing.length === 0, missing };
}
