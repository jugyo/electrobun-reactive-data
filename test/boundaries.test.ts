import { expect, test } from "bun:test";
import {
  runtimeImports,
  checkRendererGraph,
} from "../scripts/renderer-boundaries.mjs";

test("AST boundary checker distinguishes type-only imports and runtime forms", () => {
  expect(
    runtimeImports(
      'import type { A } from "../main/a"; export type { B } from "../main/b"; import { type C } from "../main/c";',
    ),
  ).toEqual([]);
  expect(
    runtimeImports('export { A } from "./a"; import("./b"); require("./c");'),
  ).toEqual(["./a", "./b", "./c"]);
  expect(() => runtimeImports("import(variable)")).toThrow("Nonliteral");
});
test("AST checker follows transitive reexports and rejects hidden main imports", () => {
  const files: Record<string, string> = {
    "/fixture/src/client/a.ts": 'export * from "../shared.js";',
    "/fixture/src/shared.ts": 'import "./main/secret.js";',
    "/fixture/src/main/secret.ts": "export const secret = 1;",
  };
  expect(() =>
    checkRendererGraph(
      ["/fixture/src/client/a.ts"],
      (path: string) => files[path],
      (path: string) => path in files,
    ),
  ).toThrow("Forbidden renderer module");
});
