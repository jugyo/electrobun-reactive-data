import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
for (const file of [...walk("src/client"), ...walk("src/react")]) {
  const source = readFileSync(file, "utf8");
  if (/from\s+["'][^"']*(?:\/main|bun:sqlite|electrobun\/main)/.test(source))
    throw new Error(`Forbidden renderer import: ${file}`);
}
const built = (() => {
  try {
    return walk("dist")
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
  } catch {
    return "";
  }
})();
if (
  /bun:sqlite|electrobun\/main|CREATE TABLE|__electrobun_reactive_changes/.test(
    built,
  )
)
  throw new Error("Renderer bundle contains main-process implementation");
console.log("Renderer boundary check passed");
