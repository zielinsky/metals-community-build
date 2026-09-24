import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("HTML report groups screenshots and escapes failure details", () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-report-"));
  try {
    const artifact = join(directory, "input", "smoke", ".test-report");
    const screenshots = join(artifact, "screenshots", "hover");
    mkdirSync(screenshots, { recursive: true });
    // Gallery generation only needs names; PNG integrity is covered separately.
    writeFileSync(join(screenshots, "001-file-opened.png"), "");
    writeFileSync(join(screenshots, "002-failure.png"), "");
    writeFileSync(join(artifact, "result.json"), JSON.stringify({
      project: "smoke", projectName: "Smoke", buildTool: "maven",
      repository: "scalameta/metals-community-build", ref: "main", status: "failed",
      scenarios: [{ id: "hover", kind: "hover", status: "failed", error: "Expected <class> & docs" }],
    }));
    const result = spawnSync(process.execPath, [
      resolve("out/scripts/build-report.js"), "--input", join(directory, "input"),
      "--output", join(directory, "output"), "--project", "fixtures/smoke.json",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(join(directory, "output/projects/maven/smoke/index.html"), "utf8");
    assert.match(html, /Screenshots \(2\)/);
    assert.match(html, /Expected &lt;class&gt; &amp; docs/);
    assert.match(html, /files\/\.test-report\/screenshots\/hover\/002-failure.png/);
    assert.ok(html.indexOf("001-file-opened.png") < html.indexOf("002-failure.png"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
