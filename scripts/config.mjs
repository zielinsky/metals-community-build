import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { paths } from "./paths.mjs";
import {
  ensure,
  gitRef,
  record,
  relativePath,
  repository,
  text,
} from "./validation.mjs";

export const buildTools = ["bazel", "maven", "gradle"];

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const namespaceModes = ["each-build-target", "single-global-target"];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: cannot read JSON (${String(error)})`);
  }
}

function normalizeAssertions(value, scenarioId, source) {
  const result = record(value, `scenario '${scenarioId}'.assertions`, source);
  const integerFields = [
    ["minimumNamespaces", 1],
    ["minimumDependencyModules", 0],
  ];
  for (const [field, minimum] of integerFields) {
    const number = result[field];
    ensure(
      number === undefined || (Number.isInteger(number) && number >= minimum),
      source,
      `scenario '${scenarioId}'.${field} must be an integer >= ${minimum}`,
    );
  }

  const sources = result.sources ?? [];
  ensure(
    Array.isArray(sources),
    source,
    `scenario '${scenarioId}'.sources must be an array`,
  );
  return {
    ...result,
    sources: sources.map((path) =>
      relativePath(path, `scenario '${scenarioId}'.sources`, source),
    ),
  };
}

function normalizeRename(value, scenarioId, source) {
  if (value === undefined) return undefined;
  const result = record(value, `scenario '${scenarioId}'.rename`, source);
  const symbol = text(
    result.symbol,
    `scenario '${scenarioId}'.rename.symbol`,
    source,
  );
  const newName = text(
    result.newName,
    `scenario '${scenarioId}'.rename.newName`,
    source,
  );
  ensure(
    symbol !== newName,
    source,
    `scenario '${scenarioId}' rename must change the name`,
  );
  ensure(
    Number.isInteger(result.expectedOccurrences) &&
      result.expectedOccurrences > 0,
    source,
    `scenario '${scenarioId}'.rename.expectedOccurrences must be a positive integer`,
  );
  return { symbol, newName, expectedOccurrences: result.expectedOccurrences };
}

function normalizeScenario(value, buildTool, source, ids) {
  const result = record(value, "scenario", source);
  const id = text(result.id, "scenario.id", source);

  ensure(idPattern.test(id), source, `scenario id '${id}' is not CI-safe`);
  ensure(!ids.has(id), source, `scenario id '${id}' is duplicated`);
  ensure(
    result.kind === "mbt-import",
    source,
    `unsupported scenario kind '${result.kind}'`,
  );
  ids.add(id);

  const mode = result.namespaceMode;
  if (mode !== undefined) {
    ensure(
      namespaceModes.includes(mode),
      source,
      `scenario '${id}' has an invalid namespaceMode`,
    );
    ensure(
      buildTool === "bazel",
      source,
      `scenario '${id}' uses namespaceMode outside Bazel`,
    );
  }

  return {
    ...result,
    id,
    openFile: relativePath(result.openFile, `scenario '${id}'.openFile`, source),
    assertions: normalizeAssertions(result.assertions, id, source),
    rename: normalizeRename(result.rename, id, source),
  };
}

export function loadCommunityConfig() {
  const source = paths.communityConfig;
  const config = record(readJson(source), "config", source);
  const metals = record(config.metals, "metals", source);
  const vscode = record(config.vscode, "vscode", source);

  return {
    metals: {
      repository: repository(metals.repository, "metals.repository", source),
      ref: gitRef(metals.ref, "metals.ref", source),
      version: text(metals.version, "metals.version", source),
    },
    vscode: {
      version: text(vscode.version, "vscode.version", source),
      extension: text(vscode.extension, "vscode.extension", source),
    },
  };
}

export function loadProjectConfig(configPath, expectedBuildTool) {
  const source = isAbsolute(configPath)
    ? configPath
    : resolve(paths.root, configPath);
  const raw = record(readJson(source), "project", source);
  const id = text(raw.id, "id", source);
  const buildTool = text(raw.buildTool, "buildTool", source);

  ensure(idPattern.test(id), source, `project id '${id}' is not CI-safe`);
  ensure(
    buildTools.includes(buildTool),
    source,
    `unsupported build tool '${buildTool}'`,
  );
  ensure(
    !expectedBuildTool || buildTool === expectedBuildTool,
    source,
    `buildTool '${buildTool}' does not match directory '${expectedBuildTool}'`,
  );
  ensure(
    Array.isArray(raw.scenarios) && raw.scenarios.length > 0,
    source,
    "at least one scenario is required",
  );

  const scenarioIds = new Set();
  return {
    source,
    relativeSource: relative(paths.root, source).split(sep).join("/"),
    project: {
      ...raw,
      id,
      name: text(raw.name, "name", source),
      buildTool,
      repository: repository(raw.repository, "repository", source),
      ref: gitRef(raw.ref, "ref", source),
      projectRoot: relativePath(raw.projectRoot ?? ".", "projectRoot", source),
      scenarios: raw.scenarios.map((value) =>
        normalizeScenario(value, buildTool, source, scenarioIds),
      ),
    },
  };
}

export function discoverProjects() {
  const projects = buildTools.flatMap((buildTool) => {
    const directory = resolve(paths.root, "projects", buildTool);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => loadProjectConfig(resolve(directory, file), buildTool));
  });

  ensure(projects.length > 0, "projects", "no community projects configured");
  const ids = projects.map(({ project }) => project.id);
  ensure(
    new Set(ids).size === ids.length,
    "projects",
    "project ids must be unique",
  );
  return projects;
}
