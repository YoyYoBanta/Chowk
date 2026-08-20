import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent-tooling scratch space (temporary git worktrees, etc.) — not
    // part of this project's source, and each worktree carries its own
    // generated .next/** that the pattern above doesn't reach because it's
    // nested rather than at the repo root.
    ".claude/**",
  ]),
  // Underscore-prefixed unused parameters are a deliberate "intentionally
  // unused" marker (introduced by M2's stub adapters — src/providers/
  // cloud-api/adapter.ts and the stubbed methods in
  // src/providers/baileys/adapter.ts — which implement every interface
  // method but only need a subset of each method's parameters).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // --- M2 provider boundary (context.md rule 0 / architecture.md §5 rule 1) --
  // "No file outside src/providers/ may import a Baileys symbol, reference
  // a Baileys type, or know which provider is active." The mechanical
  // enforcement is scoped a bit tighter than that sentence taken alone
  // would suggest: it bans reaching into src/providers/baileys/** (or the
  // raw package) from ANY file — including files elsewhere under
  // src/providers/ — with exactly one documented exception below for
  // src/providers/factory.ts, which architecture.md §5 rule 2 explicitly
  // designates the sole permitted construction site ("One factory, one
  // call site... never `new BaileysAdapter()` directly [from anywhere
  // else]").
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["src/providers/baileys/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@whiskeysockets/baileys",
              message:
                "Baileys may only be imported from src/providers/baileys/** (context.md rule 0). Go through src/providers/factory.ts's WhatsAppProvider instead.",
            },
          ],
          patterns: [
            {
              group: [
                "*/providers/baileys/*",
                "*/providers/baileys",
                "@/providers/baileys/*",
                "@/providers/baileys",
              ],
              message:
                "Do not import src/providers/baileys directly — go through src/providers/factory.ts (the one sanctioned call site).",
            },
          ],
        },
      ],
    },
  },
  {
    // Sole exception: the factory is the one place allowed to construct
    // the Baileys adapter singleton. It may still never import the raw
    // Baileys package directly — only this adapter module that wraps it.
    files: ["src/providers/factory.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@whiskeysockets/baileys",
              message:
                "Even the factory may not import the raw Baileys package directly — only src/providers/baileys/adapter.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
