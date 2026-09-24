import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverProjects, loadProjectConfig } from "../scripts/config";
import { createProjectResult, updateScenarioResult } from "../scripts/test-report";

test("all community manifests and the smoke fixture load", () => {
  assert.ok(discoverProjects().length >= 5);
  const { project } = loadProjectConfig("fixtures/smoke.json");
  assert.equal(new Set(project.scenarios.map((s) => s.kind)).size, 8);
  assert.equal(project.scenarios[0].required, true);
  assert.equal(project.scenarios[1].required, false);
});

for (const [name, change, expected] of [
  ["unknown action", (s: Record<string, unknown>) => { s.kind = "typo"; }, /unsupported scenario kind/],
  ["missing hover assertion", (s: Record<string, unknown>) => { s.kind = "hover"; s.symbol = "Greeter"; }, /hoverText/],
  ["escaping definition", (s: Record<string, unknown>) => {
    s.kind = "go-to-definition"; s.symbol = "Greeter";
    s.definition = { file: "../outside.java", text: "class" };
  }, /relative path/],
  ["invalid breakpoint", (s: Record<string, unknown>) => {
    s.kind = "java-debug-test"; s.testName = "test"; s.breakpoint = { line: 0 };
  }, /integer >= 1/],
] as const) {
  test(`rejects ${name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "metals-config-"));
    try {
      const raw = JSON.parse(readFileSync("fixtures/smoke.json", "utf8"));
      raw.scenarios = [{ id: "action", openFile: "App.java" }];
      change(raw.scenarios[0]);
      const file = join(directory, "project.json");
      writeFileSync(file, JSON.stringify(raw));
      assert.throws(() => loadProjectConfig(file), expected);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("later successes and skips cannot hide an earlier failure", () => {
  const { project } = loadProjectConfig("fixtures/smoke.json");
  const result = createProjectResult(project, project.scenarios);
  updateScenarioResult(result, project.scenarios[0], "failed", 20);
  updateScenarioResult(result, project.scenarios[1], "passed", 10);
  updateScenarioResult(result, project.scenarios[2], "skipped", 0);
  assert.equal(result.status, "failed");
});
