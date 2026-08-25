import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadCommunityConfig,
  loadProjectConfig,
  repositoryRoot,
} from "./config.mjs";

const config = loadCommunityConfig();
const projectConfig = process.env.COMMUNITY_BUILD_PROJECT_CONFIG;
if (!projectConfig) throw new Error("COMMUNITY_BUILD_PROJECT_CONFIG is not set");

const project = loadProjectConfig(projectConfig).project;
const targetBuildTools = {
  bazel: "bazel",
  gradle: "gradle",
  maven: "mvn",
};
const metalsVersion =
  process.env.METALS_COMMUNITY_METALS_VERSION ?? config.metals.version;
const settings = JSON.parse(
  readFileSync(resolve(repositoryRoot, "settings.base.json"), "utf8"),
);
const generated = resolve(repositoryRoot, ".generated");

mkdirSync(generated, { recursive: true });
writeFileSync(
  resolve(generated, "settings.json"),
  `${JSON.stringify(
    {
      ...settings,
      "metals.targetBuildTool": targetBuildTools[project.buildTool],
      "metals.serverVersion": metalsVersion,
    },
    null,
    2,
  )}\n`,
);
