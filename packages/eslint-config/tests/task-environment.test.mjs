import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the supported APP_URL fallback invalidates a strict-mode web build", () => {
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  function build(url) {
    const environment = { ...process.env, APP_URL: url };
    delete environment.NEXT_PUBLIC_APP_URL;
    const graph = JSON.parse(
      execFileSync(
        "pnpm",
        ["exec", "turbo", "run", "build", "--filter=@soletrade/web", "--dry=json"],
        {
          cwd,
          env: environment,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    return graph.tasks.find((task) => task.taskId === "@soletrade/web#build");
  }
  const preview = build("https://preview.example.invalid");
  const production = build("https://production.example.invalid");
  assert.notEqual(preview.hash, production.hash);
});
