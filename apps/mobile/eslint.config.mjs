import { defineConfig } from "eslint/config";
import expo from "eslint-config-expo/flat.js";
import architecture from "@soletrade/eslint-config/boundaries";
export default defineConfig([
  expo,
  architecture(import.meta.dirname),
  { ignores: [".expo/**", "dist/**", "coverage/**"] },
]);
