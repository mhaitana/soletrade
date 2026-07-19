import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
      // `server-only` is a Next-bundler guard; stub it to an empty module in tests.
      "server-only": path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "src/tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.ts"],
    exclude: ["node_modules", ".next"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/platform/**/*.ts", "src/modules/**/*.ts", "src/shared/lib/**/*.ts"],
    },
  },
});
