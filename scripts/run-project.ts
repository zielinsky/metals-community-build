import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  const metalsDirectory = resolve(workspace, ".metals");
  mkdirSync(metalsDirectory, { recursive: true });
  for (const entry of readdirSync(metalsDirectory)) {
    if (entry !== "metals.log") {
      rmSync(resolve(metalsDirectory, entry), { recursive: true, force: true });
    }
  }
  rmSync(resolve(paths.storage, "settings"), { recursive: true, force: true });
}

const configPath = environment("COMMUNITY_BUILD_PROJECT_CONFIG");
const workspace = resolve(environment("METALS_COMMUNITY_WORKSPACE"));
const reportDirectory = process.env.COMMUNITY_BUILD_REPORT_DIR
  ? resolve(process.env.COMMUNITY_BUILD_REPORT_DIR)
  : undefined;
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
const scenarioResults: Array<{
  id: string;
  kind: string;
  status: "passed" | "failed";
  durationMs: number;
}> = [];

function writeReport(): void {
  if (!reportDirectory) return;
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    resolve(reportDirectory, "result.json"),
    `${JSON.stringify(
      {
        project: project.id,
        projectName: project.name,
        buildTool: project.buildTool,
        repository: project.repository,
        ref: project.ref,
        status: failed
          ? "failed"
          : scenarioResults.length === scenarios.length
            ? "passed"
            : "unknown",
        scenarios: scenarioResults,
      },
      null,
      2,
    )}\n`,
  );
}

writeReport();
for (const scenario of scenarios) {
  console.log(`\n=== ${project.buildTool} / ${project.id} / ${scenario.id} ===\n`);
  cleanSession(workspace);

  const startedAt = Date.now();
  let status = 1;
  try {
    status = runExtester(
      ["run-tests", paths.testForScenario(scenario.kind), ...extesterArguments],
      {
        COMMUNITY_BUILD_PROJECT_CONFIG: source,
        COMMUNITY_BUILD_REPORT_DIR: reportDirectory ?? "",
        COMMUNITY_BUILD_SCENARIO: scenario.id,
        METALS_COMMUNITY_WORKSPACE: workspace,
        METALS_COMMUNITY_VSCODE_RESOURCES: JSON.stringify({
          folder: workspace,
          file: resolve(workspace, scenario.openFile),
        }),
        NODE_OPTIONS: nodeOptions,
      },
    );
  } catch (error) {
    failed = true;
    scenarioResults.push({
      id: scenario.id,
      kind: scenario.kind,
      status: "failed",
      durationMs: Date.now() - startedAt,
    });
    writeReport();
    throw error;
  }
  if (status !== 0) failed = true;
  scenarioResults.push({
    id: scenario.id,
    kind: scenario.kind,
    status: status === 0 ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
  });
  writeReport();
}

if (failed) process.exit(1);
