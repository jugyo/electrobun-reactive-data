import { existsSync } from "node:fs";
import { checkRendererGraph, checkBundle } from "./renderer-boundaries.mjs";
checkRendererGraph([
  "src/client/index.ts",
  "src/react/index.tsx",
  "examples/notes/src/mainview/main.tsx",
  "examples/notes/test/view.ts",
]);
if (existsSync("examples/notes/dist")) checkBundle("examples/notes/dist");
else if (process.argv.includes("--require-dist"))
  throw new Error("Build the renderer before checking its bundle");
console.log("Renderer AST graph and bundle checks passed");
