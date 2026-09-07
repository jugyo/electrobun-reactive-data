import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.deepEqual(Object.keys(pkg.exports).sort(), [
  "./client",
  "./main",
  "./react",
]);
for (const target of Object.values(pkg.exports))
  assert.ok(existsSync(target), `Missing export: ${target}`);
assert.notEqual(pkg.private, true);
assert.equal(pkg.publishConfig.access, "public");
assert.equal(pkg.publishConfig.registry, "https://registry.npmjs.org/");
assert.ok(pkg.peerDependencies.electrobun && pkg.peerDependencies.react);
console.log("Public exports and peer declarations passed");
