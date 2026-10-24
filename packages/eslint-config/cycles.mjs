import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const isTest = (file) =>
  /(?:^|[/\\])(?:__tests__|__mocks__)(?:[/\\])|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const isDeclaration = (file) => /\.d\.[cm]?ts$/.test(file);

function runtimeSpecifiers(source) {
  const specifiers = new Set();
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes =
        !clause?.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((item) => item.isTypeOnly);
      if (!clause?.isTypeOnly && !onlyNamedTypes) add(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const bindings = node.exportClause;
      const onlyNamedTypes =
        bindings &&
        ts.isNamedExports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((item) => item.isTypeOnly);
      if (!node.isTypeOnly && !onlyNamedTypes) add(node.moduleSpecifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference))
        add(node.moduleReference.expression);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...specifiers];
}

/** Return deterministic, closed runtime cycle paths relative to an app/package root. */
export function findImportCycles(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
        .join("\n"),
    );
  const files = ts.sys
    .readDirectory(path.join(root, "src"), extensions, ["**/node_modules/**"])
    .filter((file) => !isTest(file) && !isDeclaration(file))
    .sort();
  const owned = new Set(files);
  const cache = ts.createModuleResolutionCache(root, (file) => file, parsed.options);
  const graph = new Map(
    files.map((file) => {
      const source = ts.createSourceFile(file, ts.sys.readFile(file), ts.ScriptTarget.Latest, true);
      const targets = runtimeSpecifiers(source)
        .map(
          (specifier) =>
            ts.resolveModuleName(specifier, file, parsed.options, ts.sys, cache).resolvedModule
              ?.resolvedFileName,
        )
        .filter((target) => owned.has(target));
      return [file, [...new Set(targets)].sort()];
    }),
  );
  const complete = new Set();
  const active = new Map();
  const stack = [];
  const cycles = new Map();
  const relative = (file) => path.relative(root, file).split(path.sep).join("/");
  const visit = (file) => {
    if (active.has(file)) {
      const members = stack.slice(active.get(file)).map(relative);
      const first = members.indexOf([...members].sort()[0]);
      const cycle = [...members.slice(first), ...members.slice(0, first)];
      cycle.push(cycle[0]);
      cycles.set(cycle.join("\0"), cycle);
      return;
    }
    if (complete.has(file)) return;
    active.set(file, stack.length);
    stack.push(file);
    for (const target of graph.get(file)) visit(target);
    stack.pop();
    active.delete(file);
    complete.add(file);
  };
  for (const file of files) visit(file);
  return [...cycles.values()].sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const roots = process.argv.slice(2);
  if (!roots.length) {
    console.error("Usage: node cycles.mjs <app-or-package-root> [...roots]");
    process.exitCode = 1;
  }
  for (const root of roots) {
    try {
      const cycles = findImportCycles(root);
      if (cycles.length) {
        console.error(`${root}: runtime import cycles found`);
        for (const cycle of cycles) console.error(`  ${cycle.join(" → ")}`);
        process.exitCode = 1;
      } else console.log(`${root}: no runtime import cycles`);
    } catch (error) {
      console.error(`${root}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
