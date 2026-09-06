import { existsSync } from "node:fs";
import { checkRendererGraph, checkBundle } from "./renderer-boundaries.mjs";
checkRendererGraph([
  "src/client/index.ts",
  "src/react/index.tsx",
  "demo/mainview/main.tsx",
  "examples/notes-consumer/src/mainview/main.tsx",
]);
if (existsSync("dist")) checkBundle("dist");
else if (process.argv.includes("--require-dist"))
  throw new Error("Build the renderer before checking its bundle");
console.log("Renderer AST graph and bundle checks passed");
