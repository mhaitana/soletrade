import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import architecture from "../boundaries.mjs";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "soletrade-boundaries-")));
const app = path.join(root, "apps/web");
function write(name, body = "export const value = 1;\n") {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  return file;
}
write("package.json", JSON.stringify({ private: true }));
write(
  "apps/web/package.json",
  JSON.stringify({ name: "@soletrade/web", dependencies: { "@soletrade/contracts": "workspace:*" } }),
);
write("apps/mobile/package.json", JSON.stringify({ name: "@soletrade/mobile" }));
write(
  "packages/contracts/package.json",
  JSON.stringify({ name: "@soletrade/contracts", exports: { ".": "./src/index.ts" } }),
);
write(
  "apps/web/tsconfig.json",
  JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
);
for (const file of [
  "features/invoices/model.ts",
  "features/quotes/model.ts",
  "application/shell.ts",
  "lib/util.ts",
  "server/infrastructure/db.ts",
  "server/foundation/billing/service.ts",
  "server/domains/books/service.ts",
  "server/domains/invoices/service.ts",
  "server/application/workflow.ts",
])
  write(`apps/web/src/${file}`);
write(
  "apps/web/src/features/invoices/api/actions.ts",
  '"use server"; export async function value() {}',
);
write("apps/mobile/src/lib/value.ts");
write("packages/contracts/src/index.ts");
const eslint = new ESLint({
  cwd: app,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    architecture(app),
  ],
});
async function errors(file, source) {
  const filePath = write(`apps/web/src/${file}`, source);
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.severity === 2);
}
after(() => rmSync(root, { recursive: true, force: true }));

for (const [name, from, to] of [
  ["aliased sibling feature", "features/invoices/component.ts", "@/features/quotes/model"],
  ["relative sibling feature", "features/invoices/component.ts", "../quotes/model"],
  ["shared to feature", "lib/test-import.ts", "@/features/quotes/model"],
  ["feature to composition", "features/invoices/component.ts", "@/application/shell"],
  [
    "infrastructure to domain",
    "server/infrastructure/test-import.ts",
    "@/server/domains/books/service",
  ],
  [
    "foundation to application",
    "server/foundation/test-import.ts",
    "@/server/application/workflow",
  ],
  [
    "domain to sibling domain",
    "server/domains/invoices/test-import.ts",
    "@/server/domains/books/service",
  ],
  ["server to frontend", "server/application/test-import.ts", "@/features/quotes/model"],
  ["cross app relative import", "lib/test-import.ts", "../../../mobile/src/lib/value"],
  ["undeclared workspace package", "lib/test-import.ts", "@soletrade/mobile"],
  ["private package path", "lib/test-import.ts", "@soletrade/contracts/src/index"],
]) {
  test(`rejects ${name}`, async () => {
    assert.ok(
      (await errors(from, `import { value } from ${JSON.stringify(to)}; void value;`)).length > 0,
    );
  });
}
test("rejects client server implementations, including types", async () => {
  assert.ok(
    (
      await errors(
        "features/invoices/client.ts",
        '"use client"; import { value } from "@/server/domains/invoices/service"; void value;',
      )
    ).length > 0,
  );
  assert.ok(
    (
      await errors(
        "features/invoices/client.ts",
        '"use client"; import type { value } from "@/server/domains/invoices/service"; export type V = typeof value;',
      )
    ).length > 0,
  );
});
test("allows application composition and same-feature actions", async () => {
  assert.deepEqual(
    await errors(
      "application/page.ts",
      'import { value } from "@/features/quotes/model"; void value;',
    ),
    [],
  );
  assert.deepEqual(
    await errors(
      "features/invoices/client.ts",
      '"use client"; import { value } from "./api/actions"; void value;',
    ),
    [],
  );
  assert.deepEqual(
    await errors(
      "server/application/test-import.ts",
      'import { value } from "@/server/domains/books/service"; void value;',
    ),
    [],
  );
});
