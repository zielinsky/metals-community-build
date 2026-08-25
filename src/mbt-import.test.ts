import assert from "node:assert/strict";

import { log, prepareMbt, project, selectScenario } from "./test-support";

const scenario = selectScenario("mbt-import");

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
      assert.ok(
        importedSources.some((source) => source.endsWith(expectedSource)),
        `Expected the MBT model to contain ${expectedSource}`,
      );
      log(`Verified imported source: ${expectedSource}`);
    }
    log(`Scenario passed: ${scenario.id}`);
  });
});
