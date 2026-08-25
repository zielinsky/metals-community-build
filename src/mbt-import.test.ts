import assert from "node:assert/strict";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  log,
  prepareMbt,
  project,
  selectScenario,
  workspace,
} from "./test-support";

const scenario = selectScenario("mbt-import");

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

describe(`${project.buildTool} / ${project.id}`, function () {
  this.timeout(20 * 60 * 1000);

  it(scenario.id, async () => {
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
        dependencyModules.length >=
          scenario.assertions.minimumDependencyModules,
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
    log(`Scenario passed: ${scenario.id}`);
  });
});
