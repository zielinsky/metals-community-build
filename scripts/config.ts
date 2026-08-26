import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { paths } from "./paths";
import {
  ensure,
  gitRef,
  record,
  relativePath,
  repository,
  text,
} from "./validation";

export const buildTools = ["bazel", "maven", "gradle"] as const;
export type BuildTool = (typeof buildTools)[number];
export type NamespaceMode =
  | "each-build-target"
  | "single-global-target";

interface ScenarioBase {
  id: string;
  openFile: string;
  namespaceMode?: NamespaceMode;
}

export interface ImportScenario extends ScenarioBase {
  kind: "mbt-import";
  assertions: {
    minimumNamespaces?: number;
    minimumDependencyModules?: number;
    sources: string[];
  };
}

export interface RenameScenario extends ScenarioBase {
  kind: "rename-symbol";
  rename: {
    symbol: string;
    newName: string;
    expectedOccurrences: number;
  };
}

export interface JavaDiagnosticsScenario extends ScenarioBase {
  kind: "java-diagnostics";
  imports: string[];
}

export interface JavaTestDiscoveryScenario extends ScenarioBase {
  kind: "java-test-discovery";
  testName: string;
}

export interface JavaMainRunScenario extends ScenarioBase {
  kind: "java-main-run";
  main: {
    className: string;
    successOutput: string;
  };
}

export type Scenario =
  | ImportScenario
  | RenameScenario
  | JavaDiagnosticsScenario
  | JavaTestDiscoveryScenario
  | JavaMainRunScenario;

export interface ProjectConfig {
  id: string;
  name: string;
  buildTool: BuildTool;
  repository: string;
  ref: string;
  projectRoot: string;
  environment: Record<string, string>;
  scenarios: Scenario[];
}

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const namespaceModes = [
  "each-build-target",
  "single-global-target",
] as const;

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: cannot read JSON (${String(error)})`);
  }
}

function normalizeAssertions(
  value: unknown,
  scenarioId: string,
  source: string,
): ImportScenario["assertions"] {
  const result = record(value, `scenario '${scenarioId}'.assertions`, source);
  const minimumNamespaces = result.minimumNamespaces;
  const minimumDependencyModules = result.minimumDependencyModules;
  ensure(
    minimumNamespaces === undefined ||
      (Number.isInteger(minimumNamespaces) && Number(minimumNamespaces) >= 1),
    source,
    `scenario '${scenarioId}'.minimumNamespaces must be an integer >= 1`,
  );
  ensure(
    minimumDependencyModules === undefined ||
      (Number.isInteger(minimumDependencyModules) &&
        Number(minimumDependencyModules) >= 0),
    source,
    `scenario '${scenarioId}'.minimumDependencyModules must be an integer >= 0`,
  );

  const sources = result.sources ?? [];
  ensure(
    Array.isArray(sources),
    source,
    `scenario '${scenarioId}'.sources must be an array`,
  );
  return {
    minimumNamespaces: minimumNamespaces as number | undefined,
    minimumDependencyModules: minimumDependencyModules as number | undefined,
    sources: sources.map((path) =>
      relativePath(path, `scenario '${scenarioId}'.sources`, source),
    ),
  };
}

function normalizeRename(
  value: unknown,
  scenarioId: string,
  source: string,
): RenameScenario["rename"] {
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
      Number(result.expectedOccurrences) > 0,
    source,
    `scenario '${scenarioId}'.rename.expectedOccurrences must be a positive integer`,
  );
  return {
    symbol,
    newName,
    expectedOccurrences: Number(result.expectedOccurrences),
  };
}

function normalizeImports(
  value: unknown,
  scenarioId: string,
  source: string,
): string[] {
  ensure(
    Array.isArray(value) && value.length > 0,
    source,
    `scenario '${scenarioId}'.imports must be a non-empty array`,
  );
  const imports = value.map((entry, index) =>
    text(entry, `scenario '${scenarioId}'.imports[${index}]`, source),
  );
  ensure(
    new Set(imports).size === imports.length,
    source,
    `scenario '${scenarioId}'.imports must not contain duplicates`,
  );
  return imports;
}

function normalizeEnvironment(
  value: unknown,
  source: string,
): Record<string, string> {
  if (value === undefined) return {};
  const environment = record(value, "environment", source);
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => {
      ensure(
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name),
        source,
        `environment variable '${name}' has an invalid name`,
      );
      return [name, text(value, `environment.${name}`, source)];
    }),
  );
}

function normalizeMain(
  value: unknown,
  scenarioId: string,
  source: string,
): JavaMainRunScenario["main"] {
  const main = record(value, `scenario '${scenarioId}'.main`, source);
  return {
    className: text(
      main.className,
      `scenario '${scenarioId}'.main.className`,
      source,
    ),
    successOutput: text(
      main.successOutput,
      `scenario '${scenarioId}'.main.successOutput`,
      source,
    ),
  };
}

function normalizeScenario(
  value: unknown,
  buildTool: BuildTool,
  source: string,
  ids: Set<string>,
): Scenario {
  const result = record(value, "scenario", source);
  const id = text(result.id, "scenario.id", source);
  ensure(idPattern.test(id), source, `scenario id '${id}' is not CI-safe`);
  ensure(!ids.has(id), source, `scenario id '${id}' is duplicated`);
  ids.add(id);

  const openFile = relativePath(
    result.openFile,
    `scenario '${id}'.openFile`,
    source,
  );
  const mode = result.namespaceMode;
  if (mode !== undefined) {
    ensure(
      typeof mode === "string" &&
        namespaceModes.includes(mode as NamespaceMode),
      source,
      `scenario '${id}' has an invalid namespaceMode`,
    );
    ensure(
      buildTool === "bazel",
      source,
      `scenario '${id}' uses namespaceMode outside Bazel`,
    );
  }
  const namespaceMode = mode as NamespaceMode | undefined;

  if (result.kind === "mbt-import") {
    return {
      id,
      kind: "mbt-import",
      openFile,
      namespaceMode,
      assertions: normalizeAssertions(result.assertions, id, source),
    };
  }
  if (result.kind === "rename-symbol") {
    return {
      id,
      kind: "rename-symbol",
      openFile,
      namespaceMode,
      rename: normalizeRename(result.rename, id, source),
    };
  }
  if (result.kind === "java-diagnostics") {
    return {
      id,
      kind: "java-diagnostics",
      openFile,
      namespaceMode,
      imports: normalizeImports(result.imports, id, source),
    };
  }
  if (result.kind === "java-test-discovery") {
    return {
      id,
      kind: "java-test-discovery",
      openFile,
      namespaceMode,
      testName: text(result.testName, `scenario '${id}'.testName`, source),
    };
  }
  if (result.kind === "java-main-run") {
    return {
      id,
      kind: "java-main-run",
      openFile,
      namespaceMode,
      main: normalizeMain(result.main, id, source),
    };
  }
  throw new Error(`${source}: unsupported scenario kind '${String(result.kind)}'`);
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

export function loadProjectConfig(
  configPath: string,
  expectedBuildTool?: BuildTool,
): { source: string; relativeSource: string; project: ProjectConfig } {
  const source = isAbsolute(configPath)
    ? configPath
    : resolve(paths.root, configPath);
  const raw = record(readJson(source), "project", source);
  const id = text(raw.id, "id", source);
  const buildTool = text(raw.buildTool, "buildTool", source);

  ensure(idPattern.test(id), source, `project id '${id}' is not CI-safe`);
  ensure(
    buildTools.includes(buildTool as BuildTool),
    source,
    `unsupported build tool '${buildTool}'`,
  );
  const typedBuildTool = buildTool as BuildTool;
  ensure(
    !expectedBuildTool || typedBuildTool === expectedBuildTool,
    source,
    `buildTool '${buildTool}' does not match directory '${expectedBuildTool}'`,
  );
  ensure(
    Array.isArray(raw.scenarios) && raw.scenarios.length > 0,
    source,
    "at least one scenario is required",
  );

  const scenarioIds = new Set<string>();
  return {
    source,
    relativeSource: relative(paths.root, source).split(sep).join("/"),
    project: {
      id,
      name: text(raw.name, "name", source),
      buildTool: typedBuildTool,
      repository: repository(raw.repository, "repository", source),
      ref: gitRef(raw.ref, "ref", source),
      projectRoot: relativePath(raw.projectRoot ?? ".", "projectRoot", source),
      environment: normalizeEnvironment(raw.environment, source),
      scenarios: raw.scenarios.map((scenario) =>
        normalizeScenario(scenario, typedBuildTool, source, scenarioIds),
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
