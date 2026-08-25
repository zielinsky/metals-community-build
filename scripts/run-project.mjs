import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadCommunityConfig,
  loadProjectConfig,
  repositoryRoot,
} from "./config.mjs";
import { extest, run } from "./process.mjs";
import { resetWorkspace } from "./reset-workspace.mjs";

const projectConfig = process.env.COMMUNITY_BUILD_PROJECT_CONFIG;
const workspaceValue = process.env.METALS_COMMUNITY_WORKSPACE;
if (!projectConfig) throw new Error("COMMUNITY_BUILD_PROJECT_CONFIG is not set");
if (!workspaceValue) throw new Error("METALS_COMMUNITY_WORKSPACE is not set");

const config = loadCommunityConfig();
const { project, source } = loadProjectConfig(projectConfig);
const workspace = resolve(workspaceValue);
const requestedScenario = process.env.COMMUNITY_BUILD_SCENARIO;
const scenarios = requestedScenario
  ? project.scenarios.filter((scenario) => scenario.id === requestedScenario)
  : project.scenarios;

if (scenarios.length === 0) {
  throw new Error(
    `${source}: scenario '${requestedScenario}' does not exist in project '${project.id}'`,
  );
}

const tests = {
  "mbt-import": resolve(repositoryRoot, "out", "mbt-import.test.js"),
};
const storage = resolve(repositoryRoot, ".test-resources");
const vscodeProfile = resolve(storage, "settings");
const extensions = resolve(repositoryRoot, ".test-extensions");
const settings = resolve(repositoryRoot, ".generated", "settings.json");
const mocha = resolve(repositoryRoot, ".mocharc.js");
const vscodeLaunchResources = resolve(
  repositoryRoot,
  "scripts",
  "vscode-launch-resources.cjs",
);
let failed = false;

for (const scenario of scenarios) {
  console.log(
    `\n=== ${project.buildTool} / ${project.id} / ${scenario.id} ===\n`,
  );
  resetWorkspace(workspace);
  rmSync(vscodeProfile, { recursive: true, force: true });
  const testFile = tests[scenario.kind];
  if (!testFile) throw new Error(`No test runner for '${scenario.kind}'`);
  const openFile = resolve(workspace, scenario.openFile);

  const status = run(
    extest,
    [
      "run-tests",
      testFile,
      "--storage",
      storage,
      "--extensions_dir",
      extensions,
      "--code_version",
      config.vscode.version,
      "--code_settings",
      settings,
      "--mocha_config",
      mocha,
    ],
    {
      env: {
        COMMUNITY_BUILD_PROJECT_CONFIG: source,
        COMMUNITY_BUILD_SCENARIO: scenario.id,
        METALS_COMMUNITY_WORKSPACE: workspace,
        METALS_COMMUNITY_VSCODE_RESOURCES: JSON.stringify({
          folder: workspace,
          file: openFile,
        }),
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--require=${vscodeLaunchResources}`,
        ]
          .filter(Boolean)
          .join(" "),
      },
    },
  );
  if (status !== 0) failed = true;
}

if (failed) process.exit(1);
