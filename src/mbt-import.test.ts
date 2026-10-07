import assert from "node:assert/strict";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImportScenario } from "../scripts/config";
import {
  captureScreenshot,
  log,
  prepareMbt,
  workspace,
} from "./test-support";

function workspacePath(value: string): string {
  return value.startsWith("file:")
    ? fileURLToPath(value)
    : resolve(workspace, value);
}

function sourceContainsFile(source: string, file: string): boolean {
  const pathFromSource = relative(workspacePath(source), workspacePath(file));
  return (
    pathFromSource === "" ||
    (!isAbsolute(pathFromSource) &&
      pathFromSource !== ".." &&
      !pathFromSource.startsWith(`..${sep}`))
  );
}

export async function testMbtImport(
  scenario: ImportScenario,
): Promise<void> {
  const imported = await prepareMbt(scenario);
  const namespaces = imported.namespaces ?? {};
  const dependencyModules = imported.dependencyModules ?? [];
  const minimumNamespaces = scenario.assertions.minimumNamespaces ?? 1;

  log(
    `MBT model contains ${Object.keys(namespaces).length} namespaces and ` +
      `${dependencyModules.length} dependency modules`,
  );
  assert.ok(
    Object.keys(namespaces).length >= minimumNamespaces,
    `Expected at least ${minimumNamespaces} MBT namespaces`,
  );
  if (scenario.assertions.minimumDependencyModules !== undefined) {
    assert.ok(
      dependencyModules.length >= scenario.assertions.minimumDependencyModules,
      `Expected at least ${scenario.assertions.minimumDependencyModules} dependency modules`,
    );
  }

  const importedSources = Object.values(namespaces).flatMap(
    (namespace) => namespace.sources ?? [],
  );
  for (const expectedSource of scenario.assertions.sources) {
    const owningSource = importedSources.find((source) =>
      sourceContainsFile(source, expectedSource),
    );
    assert.ok(
      owningSource,
      `Expected an MBT source root containing ${expectedSource}`,
    );
    log(`Verified imported source: ${expectedSource} via ${owningSource}`);
  }
  await captureScreenshot("import-verified");
  log(`Scenario passed: ${scenario.id}`);
}
