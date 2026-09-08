import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

// Run from the library root. Each run uses fresh data and preserves its evidence.
const cwd = resolve("examples/notes");
const app = "Reactive Notes Consumer-dev.app";
// Always rebuild the test-only entrypoints so normal app builds cannot be mistaken for tests.
execFileSync("npm", ["run", "native:test:build"], { cwd, stdio: "inherit" });
const directory = await mkdtemp(join(tmpdir(), "erd-notes-acceptance-"));
const launcher = join(
  cwd,
  "build/dev-macos-arm64",
  app,
  "Contents/MacOS/launcher",
);
console.log(`Native evidence: ${directory}`);
for (const phase of ["acceptance", "persistence"]) {
  const report = join(directory, `${phase}.json`);
  const env = {
    ...process.env,
    ERD_NATIVE_ACCEPTANCE: phase === "acceptance" ? "1" : "0",
    ERD_NATIVE_VERIFY_PERSISTENCE: phase === "persistence" ? "1" : "0",
    ERD_NATIVE_REPORT: report,
    ERD_NOTES_DATABASE: join(directory, "data.sqlite"),
  };
  await new Promise((resolveRun, reject) => {
    const child = spawn(launcher, [], { cwd, env, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${phase}: native quit timed out`));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`${phase}: exit ${code}, signal ${signal}`));
    });
  });
  const evidence = JSON.parse(await readFile(report, "utf8"));
  assert.equal(
    evidence.ok,
    true,
    `${phase}: ${evidence.error ?? "missing success result"}`,
  );
  console.log(`${phase}: assertions passed and native process exited cleanly`);
}
