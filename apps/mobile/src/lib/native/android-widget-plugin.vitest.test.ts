import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const plugin = require("../../../plugins/with-android-quick-widget.js") as {
  (config: unknown): unknown;
  androidFiles: (config: unknown) => Record<string, string>;
  applyManifest: (manifest: unknown) => unknown;
  writeAndroidFiles: (config: unknown, root: string) => Promise<void>;
};
const config = { android: { package: "au.com.soletrade.business" }, scheme: "soletrade" };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
describe("Android cold-start quick action widget", () => {
  it("generates distinct immutable activity PendingIntents to actual router targets", () => {
    const files = plugin.androidFiles(config),
      kotlin = Object.values(files).find((file) =>
        file.includes("class SoletradeQuickActionsWidget"),
      )!;
    expect(kotlin).toContain("PendingIntent.getActivity");
    expect(kotlin).toContain("PendingIntent.FLAG_IMMUTABLE");
    expect(kotlin).toContain("val requestCode = widgetId * 4 + actionIndex");
    expect(kotlin).toContain("MainActivity::class.java");
    for (const uri of [
      "soletrade://feature/shift",
      "soletrade://feature/receipt",
      "soletrade://edit/invoices/new",
    ])
      expect(kotlin).toContain(uri);
    expect(Object.values(files).join("\n")).not.toContain("workspaceId=");
  });
  it("adds one receiver with provider metadata and preserves unrelated receivers on repeated mods", () => {
    const manifest = {
      manifest: { application: [{ receiver: [{ $: { "android:name": ".ExistingReceiver" } }] }] },
    };
    plugin.applyManifest(manifest);
    plugin.applyManifest(manifest);
    expect(manifest.manifest.application[0].receiver).toHaveLength(2);
    const widget = manifest.manifest.application[0].receiver[1] as unknown as Record<
      string,
      unknown
    >;
    expect(widget.$).toMatchObject({
      "android:name": ".widgets.SoletradeQuickActionsWidget",
      "android:exported": "false",
    });
    expect(widget["meta-data"]).toEqual([
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/soletrade_quick_widget_info",
        },
      },
    ]);
  });
  it("writes reproducible Kotlin and XML native files and validates package/scheme", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "soletrade-widget-"));
    directories.push(root);
    await plugin.writeAndroidFiles(config, root);
    await plugin.writeAndroidFiles(config, root);
    for (const [relative, expected] of Object.entries(plugin.androidFiles(config)))
      expect(await readFile(path.join(root, "app/src/main", relative), "utf8")).toBe(expected);
    expect(() =>
      plugin.androidFiles({ android: { package: "bad/package" }, scheme: "soletrade" }),
    ).toThrow("android.package");
    expect(() => plugin.androidFiles({ android: config.android, scheme: 'bad"scheme' })).toThrow(
      "scheme",
    );
  });
});
