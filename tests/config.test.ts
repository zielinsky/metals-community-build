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
  assert.equal(new Set(project.scenarios.map((s) => s.kind)).size, 15);
  assert.equal(project.scenarios[0].required, true);
  assert.equal(project.scenarios[1].required, false);
});

test("optional scenario fields default to off", () => {
  const { project } = loadProjectConfig("fixtures/smoke.json");
  const byId = Object.fromEntries(project.scenarios.map((s) => [s.id, s]));
  assert.deepEqual(byId.import.kind === "mbt-import" && byId.import.assertions.dependencies,
    ["org.junit.jupiter:junit-jupiter-api"]);
  assert.equal(byId.diagnostics.kind === "java-diagnostics" && byId.diagnostics.requireBuildTarget, true);
  assert.equal(byId.run.kind === "java-main-run" && byId.run.main.uniqueCodeLenses, true);
  assert.equal(byId.completion.kind === "completion" && byId.completion.completion.expectedImport, undefined);
  assert.deepEqual(byId.completion.kind === "completion" && byId.completion.completion.absentItems,
    ["mutableMessage"]);
  assert.deepEqual(byId["completion-auto-import"].kind === "completion" &&
    byId["completion-auto-import"].completion.absentItems, []);
  assert.equal(byId.hover.kind === "hover" && byId.hover.near, undefined);
  assert.equal(byId["import-missing-symbol"].kind === "code-action" &&
    byId["import-missing-symbol"].near, "List.of(GREETING)");
  assert.equal(byId["import-missing-symbol"].kind === "code-action" &&
    byId["import-missing-symbol"].codeAction.menu, "quick-fix");
  assert.deepEqual(byId.references.kind === "find-references" && byId.references.references.files,
    ["src/test/java/example/GreeterTest.java"]);
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
  ["completion that forbids its own item", (s: Record<string, unknown>) => {
    s.kind = "completion";
    s.completion = { replace: "method()", prefix: "met", item: "method", expectedText: "method()", absentItems: ["method"] };
  }, /absentItems must not contain/],
  ["missing document symbol destination", (s: Record<string, unknown>) => {
    s.kind = "document-symbol"; s.symbol = "method";
  }, /expectedLine/],
  ["escaping definition", (s: Record<string, unknown>) => {
    s.kind = "go-to-definition"; s.symbol = "Greeter";
    s.definition = { file: "../outside.java", text: "class" };
  }, /relative path/],
  ["multi-line near context", (s: Record<string, unknown>) => {
    s.kind = "go-to-definition"; s.symbol = "Greeter"; s.near = "a\nb";
    s.definition = { file: "Greeter.java", text: "class" };
  }, /near/],
  ["invalid breakpoint", (s: Record<string, unknown>) => {
    s.kind = "java-debug-test"; s.testName = "test"; s.breakpoint = { line: 0 };
  }, /integer >= 1/],
  ["references without a count", (s: Record<string, unknown>) => {
    s.kind = "find-references"; s.symbol = "Greeter"; s.references = { files: [] };
  }, /minimumCount/],
  ["type hierarchy with an unknown direction", (s: Record<string, unknown>) => {
    s.kind = "type-hierarchy"; s.symbol = "Greeter"; s.hierarchy = { direction: "siblings", expected: ["A"] };
  }, /subtypes.*supertypes/],
  ["type hierarchy without expected types", (s: Record<string, unknown>) => {
    s.kind = "type-hierarchy"; s.symbol = "Greeter"; s.hierarchy = { direction: "subtypes", expected: [] };
  }, /at least one type/],
  ["code action with an unknown menu", (s: Record<string, unknown>) => {
    s.kind = "code-action"; s.symbol = "List";
    s.codeAction = { menu: "context", title: "Import", expectedText: "import" };
  }, /menu/],
  ["code action whose edit changes nothing", (s: Record<string, unknown>) => {
    s.kind = "code-action"; s.symbol = "List";
    s.codeAction = { edit: { replace: "a", with: "a" }, title: "Import", expectedText: "import" };
  }, /must change the source/],
  ["highlight without occurrences", (s: Record<string, unknown>) => {
    s.kind = "document-highlight"; s.symbol = "List"; s.highlight = { expectedOccurrences: 0 };
  }, /integer >= 1/],
  ["duplicate import dependencies", (s: Record<string, unknown>) => {
    s.kind = "mbt-import"; s.assertions = { sources: [], dependencies: ["junit", "junit"] };
  }, /duplicates/],
  ["non-boolean build target requirement", (s: Record<string, unknown>) => {
    s.kind = "java-diagnostics"; s.imports = ["a.B"]; s.requireBuildTarget = "yes";
  }, /requireBuildTarget/],
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
