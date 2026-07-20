import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Prettier compatibility - turn off conflicting formatting rules.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "src/shared/ui/**", // shadcn primitives - vendored, do not lint
  ]),
  {
    files: ["e2e/**/*.ts"],
    rules: {
      // Playwright fixture callbacks receive a `use` parameter that ESLint's
      // React Hooks plugin misidentifies as a hook; it is not a React render.
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
