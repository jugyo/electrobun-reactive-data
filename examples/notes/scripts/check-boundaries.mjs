import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const source = walk("src/mainview")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
if (/\.\.\/\.\.\/\.\.\/src|bun:sqlite|electrobun\/main/.test(source))
  throw new Error("Renderer crosses the package boundary");
const bundle = walk("dist")
  .filter((file) => file.endsWith(".js"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
if (/bun:sqlite|electrobun\/main|CREATE TABLE|native_reports/.test(bundle))
  throw new Error("Renderer bundle contains main implementation");
if (
  process.env.ERD_NATIVE_TEST !== "1" &&
  /__notesSmoke|Injected subscription failure|failAfterWrite/.test(bundle)
)
  throw new Error("Normal renderer bundle contains native test hooks");
console.log("Notes consumer boundary check passed");
