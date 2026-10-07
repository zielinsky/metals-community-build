import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProjectConfig } from "../scripts/config";

test("every documented action example is runnable and covered by the smoke fixture", () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-action-catalog-"));
  try {
    const fixture = JSON.parse(readFileSync("fixtures/smoke.json", "utf8"));
    const markdown = readFileSync("docs/actions.md", "utf8");
    const examples = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)]
      .map((match) => JSON.parse(match[1]));
    const path = join(directory, "catalog.json");
    writeFileSync(path, JSON.stringify({ ...fixture, scenarios: examples }));
    const documented = loadProjectConfig(path).project.scenarios;
    assert.deepEqual(documented.map((s) => s.kind).sort(),
      fixture.scenarios.map((s: { kind: string }) => s.kind).sort());
    assert.deepEqual(examples, fixture.scenarios);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
