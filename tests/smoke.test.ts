import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareSmokeWorkspace } from "../scripts/run-smoke";

test("MBT can index fixture sources even inside an ignored parent directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "metals-fixture-"));
  try {
    const init = spawnSync("git", ["init", "--quiet", parent]);
    assert.equal(init.status, 0, init.stderr.toString());
    writeFileSync(join(parent, ".gitignore"), "workspaces/\n");
    const workspace = join(parent, "workspaces", "smoke");
    prepareSmokeWorkspace(workspace);
    const files = spawnSync("git", ["-C", workspace, "ls-files"], { encoding: "utf8" });
    assert.equal(files.status, 0, files.stderr);
    assert.match(files.stdout, /src\/test\/java\/example\/GreeterTest.java/);
    assert.match(files.stdout, /src\/main\/java\/example\/Greeter.java/);
    const root = spawnSync("git", ["-C", workspace, "rev-parse", "--show-prefix"], { encoding: "utf8" });
    assert.equal(root.stdout.trim(), "");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
