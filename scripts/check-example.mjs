import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const cwd = resolve("examples/notes");
const run = (args, directory = cwd) =>
  execFileSync("npm", args, { cwd: directory, stdio: "inherit" });
run(["pack", "--pack-destination", "examples/notes/vendor"], process.cwd());
run([
  "install",
  "./vendor/jugyo-electrobun-reactive-data-0.1.0.tgz",
  "--ignore-scripts",
]);
run(["run", "prepare:native"]);
run(["run", "build"]);
