import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/stripe-lifecycle.integration.test.ts"],
    exclude: [],
    setupFiles: ["./src/testing/setup.ts", "./src/testing/stripe-setup.ts"],
    fileParallelism: false,
  },
});
