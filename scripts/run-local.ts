import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { discoverProjects, loadProjectConfig } from "./config";
import { paths } from "./paths";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): void {
  console.log(`\n$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? paths.root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function projectConfig(value: string): string {
  const direct = isAbsolute(value) ? value : resolve(paths.root, value);
  if (existsSync(direct)) return direct;
  const found = discoverProjects().find(({ project }) => project.id === value);
  if (!found) throw new Error(`Unknown project id or config path: ${value}`);
  return found.source;
}

const configPath = projectConfig(requiredOption("--project"));
const checkout = resolve(requiredOption("--workspace"));
const { project } = loadProjectConfig(configPath);
const workspace = resolve(checkout, project.projectRoot);
const metalsVersion = option("--metals-version") ?? "2.0.0-SNAPSHOT";
const scenario = option("--scenario");

if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);

if (!process.argv.includes("--skip-publish")) {
  const metals = resolve(requiredOption("--metals"));
  if (!existsSync(resolve(metals, "build.sbt"))) {
    throw new Error(`Metals checkout does not contain build.sbt: ${metals}`);
  }
  run("sbt", ["--client", "quick-publish-local"], {
    cwd: metals,
    env: {
      METALS_TEST: "true",
    },
  });
}

if (!process.argv.includes("--skip-setup")) {
  run(process.execPath, [resolve(paths.root, "out", "scripts", "setup-vscode.js")]);
}

console.log(
  `\nRunning ${project.buildTool} / ${project.id} with JDK ${project.javaVersion} configuration`,
);
run(process.execPath, [resolve(paths.root, "out", "scripts", "run-project.js")], {
  env: {
    COMMUNITY_BUILD_PROJECT_CONFIG: configPath,
    COMMUNITY_BUILD_REPORT_DIR: resolve(paths.root, "reports", "local", project.id),
    COMMUNITY_BUILD_SCENARIO: scenario ?? "",
    METALS_COMMUNITY_METALS_VERSION: metalsVersion,
    METALS_COMMUNITY_WORKSPACE: workspace,
  },
});
