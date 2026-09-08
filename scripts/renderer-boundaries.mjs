import ts from "typescript";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";

export function runtimeImports(source, file = "view.ts") {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const add = (node) => {
    if (!node || !ts.isStringLiteralLike(node))
      throw new Error(`Nonliteral runtime import: ${file}`);
    imports.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      if (!typesOnly) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      const typesOnly =
        node.isTypeOnly ||
        (clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((item) => item.isTypeOnly));
      if (!typesOnly) add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

export function checkRendererGraph(
  entries,
  read = (path) => readFileSync(path, "utf8"),
  exists = existsSync,
) {
  const visited = new Set();
  const walk = (file) => {
    file = resolve(file);
    if (visited.has(file)) return;
    if (/(?:\/src\/main\/|\/src\/bun\/|\/test\/main\.ts$)/.test(file))
      throw new Error(`Forbidden renderer module: ${file}`);
    visited.add(file);
    for (const name of runtimeImports(read(file), file)) {
      if (
        /^(?:node:|bun:)/.test(name) ||
        name === "electrobun/main" ||
        name === "@jugyo/electrobun-reactive-data/main"
      )
        throw new Error(`Forbidden renderer import: ${name} in ${file}`);
      if (!name.startsWith(".")) {
        if (
          !/^(?:react(?:\/|$)|react-dom(?:\/|$)|electrobun\/view$|@jugyo\/electrobun-reactive-data\/(?:client|react)$)/.test(
            name,
          )
        )
          throw new Error(`Unreviewed renderer dependency: ${name}`);
        continue;
      }
      if (/\.(?:css|svg)$/.test(name)) continue;
      const path = resolve(dirname(file), name);
      const stem = path.replace(/\.[cm]?jsx?$/, "");
      const candidates = [
        path,
        ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"].map(
          (suffix) => stem + suffix,
        ),
      ];
      const target = candidates.find((candidate) => exists(candidate));
      if (!target || !/[.](?:[cm]?[jt]sx?)$/.test(target))
        throw new Error(`Unresolved renderer import: ${name} in ${file}`);
      walk(target);
    }
  };
  entries.forEach(walk);
  return visited;
}

export function checkBundle(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) checkBundle(path);
    else if (
      extname(path) === ".js" &&
      /bun:sqlite|electrobun\/main|CREATE TABLE|__electrobun_reactive_changes/.test(
        readFileSync(path, "utf8"),
      )
    )
      throw new Error(`Renderer bundle contains main implementation: ${path}`);
  }
}
