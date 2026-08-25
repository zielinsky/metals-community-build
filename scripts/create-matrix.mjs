import { appendFileSync } from "node:fs";

import {
  discoverProjects,
  loadCommunityConfig,
  parseMetalsSource,
} from "./config.mjs";

const config = loadCommunityConfig();
const metalsArgumentIndex = process.argv.indexOf("--metals");
const metals =
  metalsArgumentIndex === -1
    ? config.metals
    : {
        ...config.metals,
        ...parseMetalsSource(
          process.argv[metalsArgumentIndex + 1],
          config.metals.repository,
        ),
      };
const include = discoverProjects().map(({ project, relativeSource }) => {
  const workspacePath =
    project.projectRoot === "."
      ? "workspaces/project"
      : `workspaces/project/${project.projectRoot}`;
  return {
    project: project.id,
    projectName: project.name,
    buildTool: project.buildTool,
    repository: project.repository,
    ref: project.ref,
    projectRoot: project.projectRoot,
    workspacePath,
    config: relativeSource,
  };
});
const matrix = JSON.stringify({ include });

if (process.argv.includes("--github-output")) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is not set");
  appendFileSync(
    output,
    [
      `matrix=${matrix}`,
      `metalsRepository=${metals.repository}`,
      `metalsRef=${metals.ref}`,
      `metalsVersion=${metals.version}`,
      "",
    ].join("\n"),
  );
} else {
  console.log(matrix);
}
