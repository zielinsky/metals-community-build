import assert from "node:assert/strict";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ImportScenario } from "../scripts/config";
import {
  captureScreenshot,
  log,
  type MbtModel,
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

/**
 * Top-level dependency modules are objects with an `id`; namespaces list the
 * ids of the modules they depend on.
 */
export function dependencyIds(model: MbtModel): string[] {
  const ids = new Set<string>();
  const add = (entry: unknown) => {
    if (typeof entry === "string") ids.add(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      ids.add((entry as { id: string }).id);
    }
  };
  (model.dependencyModules ?? []).forEach(add);
  for (const namespace of Object.values(model.namespaces ?? {})) {
    (namespace.dependencyModules ?? []).forEach(add);
  }
  return [...ids];
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

  const ids = dependencyIds(imported);
  for (const dependency of scenario.assertions.dependencies) {
    const match = ids.find((id) => id.includes(dependency));
    assert.ok(
      match,
      `Expected a dependency module matching '${dependency}' among ${ids.length} modules`,
    );
    log(`Verified dependency module: ${dependency} via ${match}`);
  }
  await captureScreenshot("import-verified");
  log(`Scenario passed: ${scenario.id}`);
}
