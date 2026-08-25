import { appendFileSync } from "node:fs";

import {
  discoverProjects,
  loadCommunityConfig,
  ProjectConfig,
} from "./config";
import { parseMetalsSource } from "./metals-source";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function matrixEntry({
  project,
  relativeSource,
}: {
  project: ProjectConfig;
  relativeSource: string;
}) {
  const workspace = "workspaces/project";
  return {
    project: project.id,
    projectName: project.name,
    buildTool: project.buildTool,
    repository: project.repository,
    ref: project.ref,
    workspacePath:
      project.projectRoot === "."
        ? workspace
        : `${workspace}/${project.projectRoot}`,
    config: relativeSource,
  };
}

const config = loadCommunityConfig();
const selectedSource = option("--metals");
const metals = selectedSource
  ? {
      ...config.metals,
      ...parseMetalsSource(selectedSource, config.metals.repository),
    }
  : config.metals;
const matrix = JSON.stringify({ include: discoverProjects().map(matrixEntry) });

if (process.argv.includes("--github-output")) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is not set");
  const values = {
    matrix,
    metalsRepository: metals.repository,
    metalsRef: metals.ref,
    metalsVersion: metals.version,
  };
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  appendFileSync(output, `${lines.join("\n")}\n`);
} else {
  console.log(matrix);
}
