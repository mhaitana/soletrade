import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findImportCycles } from "../cycles.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "soletrade-cycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contents = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["./src/*"] },
      },
    }),
    ...files,
  };
  for (const [name, source] of Object.entries(contents)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

test("allows an acyclic runtime graph with type-only and test backreferences", (t) => {
  const root = fixture(t, {
    "src/a.ts":
      'import { b } from "@/b"; import "./back.test"; export const a = b; export type A = string;',
    "src/b.ts":
      'import type { A } from "./a"; import { type A as Alias } from "./a"; export type { A } from "./a"; export const b = 1;',
    "src/back.test.ts": 'import "./a"; export const test = 1;',
    "src/a.test.ts": 'import "./back.test";',
    "src/declaration.d.ts": 'import "./a";',
  });
  assert.deepEqual(findImportCycles(root), []);
});

test("finds an alias import, reexport and dynamic import cycle", (t) => {
  const root = fixture(t, {
    "src/a.ts": 'import { b } from "@/b"; export const a = b;',
    "src/b.ts": 'export { c as b } from "./nested/c";',
    "src/nested/c.ts": 'export const c = () => import("../a");',
  });
  assert.deepEqual(findImportCycles(root), [
    ["src/a.ts", "src/b.ts", "src/nested/c.ts", "src/a.ts"],
  ]);
});

test("handles side-effect imports and separate cyclic components deterministically", (t) => {
  const root = fixture(t, {
    "src/b.ts": 'import "./a";',
    "src/a.ts": 'import "./b";',
    "src/c.ts": 'export * from "./c";',
  });
  assert.deepEqual(findImportCycles(root), [
    ["src/a.ts", "src/b.ts", "src/a.ts"],
    ["src/c.ts", "src/c.ts"],
  ]);
});

test("CLI exits unsuccessfully with the offending paths, then accepts a fixed graph", (t) => {
  const root = fixture(t, { "src/a.ts": 'import "./a";' });
  const cli = fileURLToPath(new URL("../cycles.mjs", import.meta.url));
  const failing = spawnSync(process.execPath, [cli, root], { encoding: "utf8" });
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /src\/a\.ts → src\/a\.ts/);
  writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");
  const passing = spawnSync(process.execPath, [cli, root], { encoding: "utf8" });
  assert.equal(passing.status, 0);
});
