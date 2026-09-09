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

/**
 * Renders `{{n}}` placeholders in `body` using `variables`.
 *
 * **Single pass, by construction.** The previous send-path implementation
 * (`src/providers/baileys/adapter.ts`) looped over the supplied variables and
 * ran a separate `split`/`join` per key, which meant a value substituted
 * early was itself re-scanned by every later key's pass: given
 * `{{1}} {{2}}` with `{"1": "see {{2}}", "2": "X"}`, the `{{2}}` *inside the
 * agent-typed value for `{{1}}`* got replaced too, producing "see X X"
 * instead of "see {{2}} X". Agent-supplied text is data, never a template to
 * be re-expanded. One `replace` over the original body fixes that: the
 * callback's return value is never re-examined by the same pass.
 *
 * A placeholder with no supplied value (or a blank one) is deliberately left
 * as the literal `{{n}}` rather than collapsing to an empty string, so an
 * unfilled slot is visible instead of silently vanishing. On the real send
 * path `validateTemplateVariables` has already rejected that case before this
 * is ever reached; the fallback exists for the picker's live preview, which
 * renders while the agent is still typing.
 */
export function substituteTemplateVariables(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
    const value = variables[key];
    return value ? value : placeholder;
  });
}
