import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverProjects, loadProjectConfig } from "../scripts/config";
import { createProjectResult, updateScenarioResult } from "../scripts/test-report";

test("the smoke fixture loads", () => {
  const { project } = loadProjectConfig("fixtures/smoke.json");
  assert.equal(new Set(project.scenarios.map((s) => s.kind)).size, 11);
  assert.equal(project.scenarios[0].required, true);
  assert.equal(project.scenarios[1].required, false);
});

test("manifests are discovered from a projects checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-projects-"));
  try {
    mkdirSync(join(directory, "maven"));
    const raw = JSON.parse(readFileSync("fixtures/smoke.json", "utf8"));
    writeFileSync(join(directory, "maven", "smoke.json"), JSON.stringify(raw));
    const [discovered] = discoverProjects(directory);
    assert.equal(discovered.project.id, "smoke");

    writeFileSync(
      join(directory, "maven", "copy.json"),
      JSON.stringify({ ...raw, buildTool: "gradle" }),
    );
    assert.throws(() => discoverProjects(directory), /does not match directory/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing projects checkout points at the projects branch", () => {
  const missing = join(tmpdir(), "metals-projects-missing");
  assert.throws(() => discoverProjects(missing), /git worktree add projects projects/);
});

// The real manifests are only present when the `projects` branch is checked
// out into projects/ (CI) or added there as a worktree (local).
test("every checked-out community manifest loads", { skip: !existsSync("projects") }, () => {
  assert.ok(discoverProjects().length >= 1);
});

for (const [name, change, expected] of [
  ["unknown action", (s: Record<string, unknown>) => { s.kind = "typo"; }, /unsupported scenario kind/],
  ["missing hover assertion", (s: Record<string, unknown>) => { s.kind = "hover"; s.symbol = "Greeter"; }, /hoverText/],
  ["missing completion assertion", (s: Record<string, unknown>) => {
    s.kind = "completion"; s.completion = { replace: "method()", prefix: "met", item: "method" };
  }, /expectedText/],
  ["missing document symbol destination", (s: Record<string, unknown>) => {
    s.kind = "document-symbol"; s.symbol = "method";
  }, /expectedLine/],
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
