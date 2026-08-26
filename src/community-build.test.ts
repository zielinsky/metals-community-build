import { testJavaDiagnostics } from "./java-diagnostics.test";
import { testMbtImport } from "./mbt-import.test";
import { testRenameSymbol } from "./rename-symbol.test";
import { testJavaTestDiscovery } from "./java-test-discovery.test";
import { testJavaMainRun } from "./java-main-run.test";
import { executeScenario, project, scenarios } from "./test-support";

describe(`${project.buildTool} / ${project.id}`, function () {
  this.timeout(30 * 60 * 1000);

  for (const scenario of scenarios) {
    it(scenario.id, async () => {
      await executeScenario(scenario, async () => {
        switch (scenario.kind) {
          case "mbt-import":
            await testMbtImport(scenario);
            break;
          case "rename-symbol":
            await testRenameSymbol(scenario);
            break;
          case "java-diagnostics":
            await testJavaDiagnostics(scenario);
            break;
          case "java-test-discovery":
            await testJavaTestDiscovery(scenario);
            break;
          case "java-main-run":
            await testJavaMainRun(scenario);
            break;
        }
      });
    });
  }
});
