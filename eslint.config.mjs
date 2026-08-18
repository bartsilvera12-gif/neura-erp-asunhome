import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /** Reglas muy estrictas de React 19 / hooks: el repo tiene patrones legacy; warning no bloquea CI. */
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react/no-unescaped-entities": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefactos locales / extracciones temporales (no son código del repo)
    ".tmp-*/**",
    ".cursor/**",
    // Paquetes descomprimidos para inspección (p. ej. SET API)
    "**/package/dist/**",
    // Scripts one-off (CommonJS, herramientas locales): no bloquean lint del producto
    "scripts/**",
  ]),
]);

export default eslintConfig;
