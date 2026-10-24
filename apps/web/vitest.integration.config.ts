import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*integration.test.{ts,tsx}"],
    exclude: ["src/**/stripe-lifecycle.integration.test.ts"],
    setupFiles: ["./src/testing/setup.ts", "./src/testing/integration-setup.ts"],
    fileParallelism: false,
  },
});
