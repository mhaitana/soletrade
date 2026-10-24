import path from "node:path";
import boundaries from "eslint-plugin-boundaries";
import workspaceRule from "./workspace-rule.mjs";

const element = (type, captured) => ({ element: { type, ...(captured ? { captured } : {}) } });
const ban = (from, to) => ({ from: element(from), disallow: { to: element(to) } });

/** Framework-independent rules; root is the consuming workspace directory. */
export default function architecture(root) {
  return {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: { boundaries, soletrade: { rules: { "workspace-imports": workspaceRule } } },
    settings: {
      "import/resolver": { typescript: { project: path.join(root, "tsconfig.json") } },
      "boundaries/root-path": root,
      // Integration tests compose domains; package ownership still applies.
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
      "boundaries/elements": [
        { type: "feature", pattern: "src/features/*", capture: ["name"] },
        { type: "domain", pattern: "src/server/domains/*", capture: ["name"] },
        { type: "foundation", pattern: "src/server/foundation" },
        { type: "infrastructure", pattern: "src/server/infrastructure" },
        { type: "server-application", pattern: "src/server/application" },
        { type: "composition", pattern: "src/application" },
        { type: "routes", pattern: "src/app" },
        { type: "testing", pattern: "src/testing" },
        ...[
          "components",
          "config",
          "hooks",
          "lib",
          "types",
          "utils",
          "theme",
          "stores",
          "assets",
        ].map((name) => ({ type: "shared", pattern: `src/${name}` })),
      ],
    },
    rules: {
      "soletrade/workspace-imports": ["error", { root }],
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            ban("shared", [
              "feature",
              "composition",
              "routes",
              "domain",
              "foundation",
              "infrastructure",
              "server-application",
            ]),
            ban("feature", ["feature", "composition", "routes"]),
            {
              from: element("feature"),
              allow: { to: element("feature", { name: "{{ from.element.captured.name }}" }) },
            },
            ban(
              ["infrastructure", "foundation", "domain", "server-application"],
              ["feature", "composition", "routes"],
            ),
            ban("infrastructure", ["foundation", "domain", "server-application"]),
            ban("foundation", ["domain", "server-application"]),
            ban("domain", ["domain", "server-application"]),
            {
              from: element("domain"),
              allow: { to: element("domain", { name: "{{ from.element.captured.name }}" }) },
            },
          ],
        },
      ],
    },
  };
}
