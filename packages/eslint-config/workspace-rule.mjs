import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { resolve } from "eslint-import-resolver-typescript";

function manifest(directory) {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

export default {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { root: { type: "string" } },
        required: ["root"],
        additionalProperties: false,
      },
    ],
    messages: { invalid: "{{reason}}" },
  },
  create(context) {
    const root = fs.realpathSync(context.options[0].root);
    const repo = path.resolve(root, "../..");
    const own = manifest(root);
    const dependencies = { ...own.dependencies, ...own.devDependencies, ...own.peerDependencies };
    const client = context.sourceCode.ast.body.some(
      (statement) =>
        statement.type === "ExpressionStatement" && statement.expression.value === "use client",
    );
    const report = (node, reason) =>
      context.report({ node, messageId: "invalid", data: { reason } });
    function check(node) {
      const source = node?.value;
      if (typeof source !== "string") return;
      if (source.startsWith("@soletrade/")) {
        const [scope, name, ...rest] = source.split("/");
        const packageName = `${scope}/${name}`;
        if (!dependencies[packageName])
          return report(node, `Declare ${packageName} as a workspace dependency.`);
        const target = manifest(path.join(repo, "packages", name));
        const subpath = rest.length ? `./${rest.join("/")}` : ".";
        if (!target.name || !Object.hasOwn(target.exports ?? {}, subpath))
          return report(
            node,
            "Use an explicit export from a shared package; applications are not libraries.",
          );
      }
      if (
        own.name === "@soletrade/contracts" &&
        (builtinModules.includes(source.replace(/^node:/, "")) ||
          /^(?:react(?:-native)?(?:\/|$)|react-dom(?:\/|$)|next(?:\/|$)|expo(?:[-/]|$)|server-only$)/.test(
            source,
          ))
      ) {
        return report(
          node,
          "Contracts must remain platform-safe and independent of application runtimes.",
        );
      }
      if (!source.startsWith(".") && !source.startsWith("@/")) return;
      const target = resolve(source, context.filename, {
        project: path.join(root, "tsconfig.json"),
      }).path;
      if (!target) return;
      const relative = path.relative(root, target);
      if (relative.startsWith(".."))
        return report(
          node,
          "Do not import another workspace by filesystem path; use its declared package exports.",
        );
      if (client && relative.replaceAll(path.sep, "/").startsWith("src/server/")) {
        report(
          node,
          "Client modules must use browser-safe contracts or dedicated use-server actions, not server implementations.",
        );
      }
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression: (node) => {
        if (node.callee.name === "require") check(node.arguments[0]);
      },
    };
  },
};
