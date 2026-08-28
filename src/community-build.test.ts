import { testJavaDiagnostics } from "./java-diagnostics.test";
import { testMbtImport } from "./mbt-import.test";
import { testRenameSymbol } from "./rename-symbol.test";
import { testJavaTestDiscovery } from "./java-test-discovery.test";
import { testJavaMainRun } from "./java-main-run.test";
import { testJavaDebug } from "./java-debug-test.test";
import { executeScenario, project, scenarios, skipScenario } from "./test-support";

describe(`${project.buildTool} / ${project.id}`, function () {
  this.timeout(30 * 60 * 1000);

  // A `required` scenario failing (e.g. the MBT import) makes every later
  // scenario in this project doomed to fail too — skip them outright instead
  // of letting each burn its own timeout on a session that can't recover.
  let blockedBy: string | undefined;

  for (const scenario of scenarios) {
    it(scenario.id, async function () {
      if (blockedBy) {
        skipScenario(scenario, `required scenario '${blockedBy}' failed`);
        this.skip();
        return;
      }

      try {
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
            case "java-debug-test":
              await testJavaDebug(scenario);
              break;
          }
        });
      } catch (error) {
        if (scenario.required) blockedBy = scenario.id;
        throw error;
      }
    });
  }
});
