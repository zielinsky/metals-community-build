import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, parse, resolve } from "node:path";

import {
  BuildTool,
  loadCommunityConfig,
  loadProjectConfig,
} from "./config";
import { runExtester } from "./extester";
import { paths } from "./paths";

const targetBuildTools: Record<BuildTool, string> = {
  bazel: "bazel",
  gradle: "gradle",
  maven: "mvn",
};

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function writeSettings(buildTool: BuildTool, metalsVersion: string): void {
  const settings = {
    ...JSON.parse(readFileSync(paths.settingsBase, "utf8")),
    "metals.targetBuildTool": targetBuildTools[buildTool],
    "metals.serverVersion": metalsVersion,
  };
  mkdirSync(dirname(paths.generatedSettings), { recursive: true });
  writeFileSync(
    paths.generatedSettings,
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

function cleanSession(workspace: string): void {
  if (!existsSync(workspace) || workspace === parse(workspace).root) {
    throw new Error(`Refusing to clean invalid workspace: ${workspace}`);
  }
  rmSync(resolve(workspace, ".metals"), { recursive: true, force: true });
  rmSync(resolve(paths.storage, "settings"), { recursive: true, force: true });
}

const configPath = environment("COMMUNITY_BUILD_PROJECT_CONFIG");
const workspace = resolve(environment("METALS_COMMUNITY_WORKSPACE"));
const config = loadCommunityConfig();
const { project, source } = loadProjectConfig(configPath);
const requestedScenario = process.env.COMMUNITY_BUILD_SCENARIO;
const scenarios = requestedScenario
  ? project.scenarios.filter(({ id }) => id === requestedScenario)
  : project.scenarios;

if (scenarios.length === 0) {
  throw new Error(
    `${source}: scenario '${requestedScenario}' does not exist in '${project.id}'`,
  );
}

writeSettings(
  project.buildTool,
  process.env.METALS_COMMUNITY_METALS_VERSION ?? config.metals.version,
);

const extesterArguments = [
  "--storage",
  paths.storage,
  "--extensions_dir",
  paths.extensions,
  "--code_version",
  config.vscode.version,
  "--code_settings",
  paths.generatedSettings,
  "--mocha_config",
  paths.mocha,
];
const nodeOptions = [process.env.NODE_OPTIONS, `--require=${paths.vscodePreload}`]
  .filter(Boolean)
  .join(" ");
let failed = false;

for (const scenario of scenarios) {
  console.log(`\n=== ${project.buildTool} / ${project.id} / ${scenario.id} ===\n`);
  cleanSession(workspace);

  const status = runExtester(
    ["run-tests", paths.testForScenario(scenario.kind), ...extesterArguments],
    {
      COMMUNITY_BUILD_PROJECT_CONFIG: source,
      COMMUNITY_BUILD_SCENARIO: scenario.id,
      METALS_COMMUNITY_WORKSPACE: workspace,
      METALS_COMMUNITY_VSCODE_RESOURCES: JSON.stringify({
        folder: workspace,
        file: resolve(workspace, scenario.openFile),
      }),
      NODE_OPTIONS: nodeOptions,
    },
  );
  if (status !== 0) failed = true;
}

if (failed) process.exit(1);
