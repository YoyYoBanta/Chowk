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
]);

export default eslintConfig;
