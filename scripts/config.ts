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
  required: boolean;
}

/**
 * Scenarios that act on one symbol of the open file. `near` narrows the
 * search to the first line containing that text, so a later occurrence can be
 * selected without counting occurrences.
 */
interface SymbolScenario extends ScenarioBase {
  symbol: string;
  near?: string;
}

export interface ImportScenario extends ScenarioBase {
  kind: "mbt-import";
  assertions: {
    minimumNamespaces?: number;
    minimumDependencyModules?: number;
    sources: string[];
    dependencies: string[];
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
  requireBuildTarget: boolean;
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
    uniqueCodeLenses: boolean;
  };
}

export interface JavaDebugTestScenario extends ScenarioBase {
  kind: "java-debug-test";
  testName: string;
  breakpoint: {
    line: number;
  };
}

export interface DefinitionScenario extends SymbolScenario {
  kind: "go-to-definition" | "go-to-implementation";
  definition: { file: string; text: string };
}

export interface HoverScenario extends SymbolScenario {
  kind: "hover";
  hoverText: string;
}

export interface DocumentSymbolScenario extends ScenarioBase {
  kind: "document-symbol";
  symbol: string;
  expectedLine: string;
}

export interface CompletionScenario extends ScenarioBase {
  kind: "completion";
  completion: {
    replace: string;
    prefix: string;
    item: string;
    expectedText: string;
    expectedImport?: string;
    absentItems: string[];
  };
}

export interface ReferencesScenario extends SymbolScenario {
  kind: "find-references";
  references: { minimumCount: number; files: string[] };
}

export type HierarchyDirection = "subtypes" | "supertypes";

export interface TypeHierarchyScenario extends SymbolScenario {
  kind: "type-hierarchy";
  hierarchy: { direction: HierarchyDirection; expected: string[] };
}

export type CodeActionMenu = "quick-fix" | "refactor" | "source-action";

export interface CodeActionScenario extends SymbolScenario {
  kind: "code-action";
  codeAction: {
    edit?: { replace: string; with: string };
    menu: CodeActionMenu;
    title: string;
    expectedText: string;
  };
}

export interface DocumentHighlightScenario extends SymbolScenario {
  kind: "document-highlight";
  highlight: { expectedOccurrences: number };
}

export type Scenario =
  | ImportScenario
  | RenameScenario
  | JavaDiagnosticsScenario
  | JavaTestDiscoveryScenario
  | JavaMainRunScenario
  | JavaDebugTestScenario
  | DefinitionScenario
  | HoverScenario
  | DocumentSymbolScenario
  | CompletionScenario
  | ReferencesScenario
  | TypeHierarchyScenario
  | CodeActionScenario
  | DocumentHighlightScenario;

export interface ProjectConfig {
  id: string;
  name: string;
  buildTool: BuildTool;
  repository: string;
  ref: string;
  projectRoot: string;
  javaVersion: string;
  metalsServerProperties: string[];
  environment: Record<string, string>;
  scenarios: Scenario[];
}

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const namespaceModes = [
  "each-build-target",
  "single-global-target",
] as const;
const hierarchyDirections = ["subtypes", "supertypes"] as const;
const codeActionMenus = ["quick-fix", "refactor", "source-action"] as const;

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: cannot read JSON (${String(error)})`);
  }
}

function optionalText(
  value: unknown,
  field: string,
  source: string,
): string | undefined {
  return value === undefined ? undefined : text(value, field, source);
}

function optionalBoolean(
  value: unknown,
  field: string,
  source: string,
): boolean {
  ensure(
    value === undefined || typeof value === "boolean",
    source,
    `'${field}' must be a boolean`,
  );
  return value === true;
}

function positiveInteger(
  value: unknown,
  field: string,
  source: string,
): number {
  ensure(
    Number.isInteger(value) && Number(value) >= 1,
    source,
    `'${field}' must be an integer >= 1`,
  );
  return Number(value);
}

function uniqueTexts(value: unknown, field: string, source: string): string[] {
  if (value === undefined) return [];
  ensure(Array.isArray(value), source, `'${field}' must be an array`);
  const texts = value.map((entry, index) =>
    text(entry, `${field}[${index}]`, source),
  );
  ensure(
    new Set(texts).size === texts.length,
    source,
    `'${field}' must not contain duplicates`,
  );
  return texts;
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
    dependencies: uniqueTexts(
      result.dependencies,
      `scenario '${scenarioId}'.assertions.dependencies`,
      source,
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
    uniqueCodeLenses: optionalBoolean(
      main.uniqueCodeLenses,
      `scenario '${scenarioId}'.main.uniqueCodeLenses`,
      source,
    ),
  };
}

function normalizeBreakpoint(
  value: unknown,
  scenarioId: string,
  source: string,
): JavaDebugTestScenario["breakpoint"] {
  const breakpoint = record(
    value,
    `scenario '${scenarioId}'.breakpoint`,
    source,
  );
  ensure(
    Number.isInteger(breakpoint.line) && Number(breakpoint.line) >= 1,
    source,
    `scenario '${scenarioId}'.breakpoint.line must be an integer >= 1`,
  );
  return { line: Number(breakpoint.line) };
}

function normalizeCompletion(
  value: unknown,
  scenarioId: string,
  source: string,
): CompletionScenario["completion"] {
  const field = `scenario '${scenarioId}'.completion`;
  const completion = record(value, field, source);
  const item = text(completion.item, `${field}.item`, source);
  const absentItems = uniqueTexts(completion.absentItems, `${field}.absentItems`, source);
  ensure(
    !absentItems.includes(item),
    source,
    `${field}.absentItems must not contain the selected item '${item}'`,
  );
  return {
    replace: text(completion.replace, `${field}.replace`, source),
    prefix: text(completion.prefix, `${field}.prefix`, source),
    item,
    expectedText: text(completion.expectedText, `${field}.expectedText`, source),
    expectedImport: optionalText(completion.expectedImport, `${field}.expectedImport`, source),
    absentItems,
  };
}

function normalizeReferences(
  value: unknown,
  scenarioId: string,
  source: string,
): ReferencesScenario["references"] {
  const field = `scenario '${scenarioId}'.references`;
  const references = record(value, field, source);
  return {
    minimumCount: positiveInteger(references.minimumCount, `${field}.minimumCount`, source),
    files: uniqueTexts(references.files, `${field}.files`, source).map((file) =>
      relativePath(file, `${field}.files`, source),
    ),
  };
}

function normalizeHierarchy(
  value: unknown,
  scenarioId: string,
  source: string,
): TypeHierarchyScenario["hierarchy"] {
  const field = `scenario '${scenarioId}'.hierarchy`;
  const hierarchy = record(value, field, source);
  const direction = text(hierarchy.direction, `${field}.direction`, source);
  ensure(
    hierarchyDirections.includes(direction as HierarchyDirection),
    source,
    `${field}.direction must be 'subtypes' or 'supertypes'`,
  );
  const expected = uniqueTexts(hierarchy.expected, `${field}.expected`, source);
  ensure(expected.length > 0, source, `${field}.expected must list at least one type`);
  return { direction: direction as HierarchyDirection, expected };
}

function normalizeCodeAction(
  value: unknown,
  scenarioId: string,
  source: string,
): CodeActionScenario["codeAction"] {
  const field = `scenario '${scenarioId}'.codeAction`;
  const codeAction = record(value, field, source);
  const menu = codeAction.menu ?? "quick-fix";
  ensure(
    typeof menu === "string" && codeActionMenus.includes(menu as CodeActionMenu),
    source,
    `${field}.menu must be 'quick-fix', 'refactor' or 'source-action'`,
  );
  let edit: CodeActionScenario["codeAction"]["edit"];
  if (codeAction.edit !== undefined) {
    const raw = record(codeAction.edit, `${field}.edit`, source);
    edit = {
      replace: text(raw.replace, `${field}.edit.replace`, source),
      with: text(raw.with, `${field}.edit.with`, source),
    };
    ensure(edit.replace !== edit.with, source, `${field}.edit must change the source`);
  }
  return {
    edit,
    menu: menu as CodeActionMenu,
    title: text(codeAction.title, `${field}.title`, source),
    expectedText: text(codeAction.expectedText, `${field}.expectedText`, source),
  };
}

function normalizeHighlight(
  value: unknown,
  scenarioId: string,
  source: string,
): DocumentHighlightScenario["highlight"] {
  const field = `scenario '${scenarioId}'.highlight`;
  const highlight = record(value, field, source);
  return {
    expectedOccurrences: positiveInteger(
      highlight.expectedOccurrences,
      `${field}.expectedOccurrences`,
      source,
    ),
  };
}

function normalizeStringArray(
  value: unknown,
  field: string,
  source: string,
): string[] {
  if (value === undefined) return [];
  ensure(Array.isArray(value), source, `'${field}' must be an array`);
  return value.map((entry, index) =>
    text(entry, `${field}[${index}]`, source),
  );
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

  const requiredRaw = result.required;
  ensure(
    requiredRaw === undefined || typeof requiredRaw === "boolean",
    source,
    `scenario '${id}'.required must be a boolean`,
  );
  // Scenarios are independent `it()`s, so by default a failure never stops
  // the rest of the suite from running. Set `required: true` on a scenario
  // (e.g. the MBT import) whose failure makes every later scenario pointless
  // to still attempt — the remaining scenarios are then skipped instead of
  // each burning their own timeout on a doomed session.
  const required = requiredRaw ?? false;

  const base = { id, openFile, namespaceMode, required };
  const symbolBase = () => ({
    ...base,
    symbol: text(result.symbol, `scenario '${id}'.symbol`, source),
    near: optionalText(result.near, `scenario '${id}'.near`, source),
  });
  if (result.kind === "completion") {
    return { ...base, kind: "completion",
      completion: normalizeCompletion(result.completion, id, source) };
  }
  if (result.kind === "document-symbol") {
    return { ...base, kind: "document-symbol",
      symbol: text(result.symbol, `scenario '${id}'.symbol`, source),
      expectedLine: text(result.expectedLine, `scenario '${id}'.expectedLine`, source),
    };
  }
  if (result.kind === "go-to-definition" || result.kind === "go-to-implementation") {
    const definition = record(result.definition, `scenario '${id}'.definition`, source);
    return {
      ...symbolBase(),
      kind: result.kind,
      definition: {
        file: relativePath(definition.file, `scenario '${id}'.definition.file`, source),
        text: text(definition.text, `scenario '${id}'.definition.text`, source),
      },
    };
  }
  if (result.kind === "hover") {
    return {
      ...symbolBase(),
      kind: "hover",
      hoverText: text(result.hoverText, `scenario '${id}'.hoverText`, source),
    };
  }
  if (result.kind === "find-references") {
    return {
      ...symbolBase(),
      kind: "find-references",
      references: normalizeReferences(result.references, id, source),
    };
  }
  if (result.kind === "type-hierarchy") {
    return {
      ...symbolBase(),
      kind: "type-hierarchy",
      hierarchy: normalizeHierarchy(result.hierarchy, id, source),
    };
  }
  if (result.kind === "code-action") {
    return {
      ...symbolBase(),
      kind: "code-action",
      codeAction: normalizeCodeAction(result.codeAction, id, source),
    };
  }
  if (result.kind === "document-highlight") {
    return {
      ...symbolBase(),
      kind: "document-highlight",
      highlight: normalizeHighlight(result.highlight, id, source),
    };
  }
  if (result.kind === "mbt-import") {
    return {
      ...base,
      kind: "mbt-import",
      assertions: normalizeAssertions(result.assertions, id, source),
    };
  }
  if (result.kind === "rename-symbol") {
    return {
      ...base,
      kind: "rename-symbol",
      rename: normalizeRename(result.rename, id, source),
    };
  }
  if (result.kind === "java-diagnostics") {
    return {
      ...base,
      kind: "java-diagnostics",
      imports: normalizeImports(result.imports, id, source),
      requireBuildTarget: optionalBoolean(
        result.requireBuildTarget,
        `scenario '${id}'.requireBuildTarget`,
        source,
      ),
    };
  }
  if (result.kind === "java-test-discovery") {
    return {
      ...base,
      kind: "java-test-discovery",
      testName: text(result.testName, `scenario '${id}'.testName`, source),
    };
  }
  if (result.kind === "java-main-run") {
    return {
      ...base,
      kind: "java-main-run",
      main: normalizeMain(result.main, id, source),
    };
  }
  if (result.kind === "java-debug-test") {
    return {
      ...base,
      kind: "java-debug-test",
      testName: text(result.testName, `scenario '${id}'.testName`, source),
      breakpoint: normalizeBreakpoint(result.breakpoint, id, source),
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
      javaVersion: text(raw.javaVersion ?? "21", "javaVersion", source),
      metalsServerProperties: normalizeStringArray(
        raw.metalsServerProperties,
        "metalsServerProperties",
        source,
      ),
      environment: normalizeEnvironment(raw.environment, source),
      scenarios: raw.scenarios.map((scenario) =>
        normalizeScenario(scenario, typedBuildTool, source, scenarioIds),
      ),
    },
  };
}

// Project manifests are kept on the `projects` branch of this repository, not
// on `main`. CI checks that branch out into `projects/`; locally create a
// worktree of it there with `git worktree add projects projects`.
export function discoverProjects(root: string = paths.projects) {
  ensure(
    existsSync(root),
    root,
    "project manifests directory not found; check out the `projects` branch " +
      "there (git worktree add projects projects)",
  );
  const projects = buildTools.flatMap((buildTool) => {
    const directory = resolve(root, buildTool);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => loadProjectConfig(resolve(directory, file), buildTool));
  });

  ensure(projects.length > 0, root, "no community projects configured");
  const ids = projects.map(({ project }) => project.id);
  ensure(
    new Set(ids).size === ids.length,
    root,
    "project ids must be unique",
  );
  return projects;
}
