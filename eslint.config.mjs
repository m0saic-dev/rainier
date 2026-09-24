// The style law for template code, enforced. Scope is src/**/*.ts only —
// tools/ and examples/ are plain Node scripts, and dist/ is generated.
//
// What the rules encode (see docs/style.md for the prose version):
//   - type imports are declared as `import type { … }` at the top of the file
//   - no require()/dynamic import() in template code — static imports only,
//     which is also what the app's hot-reload path needs to see
//   - async correctness: no floating/misused promises
// The dependency ALLOWLIST is deliberately not encoded here — that policy
// gate is tools/check-deps.mjs, which runs without any install.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tools/**",
      "examples/**",
      "assets/**",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-require-imports": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "No dynamic import() in template code — static top-of-file imports only (the reload path depends on it).",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: "error",
      "prefer-const": "error",
      "no-var": "error",
      "no-eval": "error",
    },
  },
);
