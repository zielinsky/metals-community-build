import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const buildTools = ["bazel", "maven", "gradle"];

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON from ${path}: ${String(error)}`);
  }
}

function requiredString(value, field, source) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    throw new Error(
      `${source}: '${field}' must be a non-empty single-line string`,
    );
  }
  return value;
}

function safeRelativePath(value, field, source) {
  const path = requiredString(value, field, source);
  const normalized = resolve(repositoryRoot, path);
  const fromRoot = relative(repositoryRoot, normalized);
  if (isAbsolute(path) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${source}: '${field}' must stay inside the repository`);
  }
  return fromRoot.length === 0 ? "." : fromRoot.split(sep).join("/");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRepository(value, field, source) {
  const repository = requiredString(value, field, source);
  if (!repositoryPattern.test(repository)) {
    throw new Error(`${source}: '${field}' must use the owner/repository form`);
  }
  return repository;
}

function validateRef(value, field, source) {
  const ref = requiredString(value, field, source);
  const invalidComponent = ref
    .split("/")
    .some(
      (component) =>
        component.length === 0 ||
        component.startsWith(".") ||
        component.endsWith(".lock"),
    );
  if (
    ref.startsWith("-") ||
    ref.endsWith(".") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("[") ||
    /[\x00-\x20\x7f~^:?*\\]/.test(ref) ||
    invalidComponent
  ) {
    throw new Error(`${source}: '${field}' is not a valid Git ref`);
  }
  return ref;
}

export function loadCommunityConfig() {
  const source = resolve(repositoryRoot, "community-build.json");
  const config = readJson(source);
  const metals = config.metals ?? {};
  const vscode = config.vscode ?? {};

  return {
    metals: {
      repository: validateRepository(
        metals.repository,
        "metals.repository",
        source,
      ),
      ref: validateRef(metals.ref, "metals.ref", source),
      version: requiredString(metals.version, "metals.version", source),
    },
    vscode: {
      version: requiredString(vscode.version, "vscode.version", source),
      extension: requiredString(vscode.extension, "vscode.extension", source),
    },
  };
}

export function parseMetalsSource(value, defaultRepository) {
  const source = requiredString(value?.trim(), "metals source", "command line");

  if (source.startsWith("https://") || source.startsWith("http://")) {
    let url;
    try {
      url = new URL(source);
    } catch (error) {
      throw new Error(`Invalid Metals URL '${source}': ${String(error)}`);
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      throw new Error("Use a plain HTTPS URL pointing to github.com");
    }

    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [owner, repositoryName, kind] = parts;
    const repository = repositoryName?.replace(/\.git$/, "");
    let refParts;
    if (kind === "tree" || kind === "commit") {
      refParts = parts.slice(3);
    } else if (kind === "releases" && parts[3] === "tag") {
      refParts = parts.slice(4);
    }
    if (!owner || !repository || !refParts || refParts.length === 0) {
      throw new Error(
        "Use a GitHub branch, commit, or tag URL, for example " +
          "https://github.com/scalameta/metals/tree/main-v2",
      );
    }
    return {
      repository: validateRepository(
        `${owner}/${repository}`,
        "metals repository",
        "command line",
      ),
      ref: validateRef(refParts.join("/"), "metals ref", "command line"),
    };
  }

  const repositoryAndRef = source.match(/^([^/\s]+\/[^@\s]+)@(.+)$/);
  if (repositoryAndRef) {
    return {
      repository: validateRepository(
        repositoryAndRef[1],
        "metals repository",
        "command line",
      ),
      ref: validateRef(repositoryAndRef[2], "metals ref", "command line"),
    };
  }

  return {
    repository: defaultRepository,
    ref: validateRef(source, "metals ref", "command line"),
  };
}

function validateAssertions(assertions, source, scenarioId) {
  if (!isObject(assertions)) {
    throw new Error(
      `${source}: scenario '${scenarioId}' must define an assertions object`,
    );
  }
  const value = assertions ?? {};
  for (const field of ["minimumNamespaces", "minimumDependencyModules"]) {
    if (
      value[field] !== undefined &&
      (!Number.isInteger(value[field]) || value[field] < 0)
    ) {
      throw new Error(
        `${source}: scenario '${scenarioId}' assertion '${field}' must be a non-negative integer`,
      );
    }
  }
  if (value.minimumNamespaces === 0) {
    throw new Error(
      `${source}: scenario '${scenarioId}' must expect at least one namespace`,
    );
  }
  if (
    value.sources !== undefined &&
    (!Array.isArray(value.sources) ||
      value.sources.some((item) => typeof item !== "string" || item.length === 0))
  ) {
    throw new Error(
      `${source}: scenario '${scenarioId}' assertion 'sources' must contain paths`,
    );
  }
  for (const path of value.sources ?? []) {
    safeRelativePath(path, "scenario.assertions.sources", source);
  }
}

export function loadProjectConfig(configPath, expectedBuildTool) {
  const source = isAbsolute(configPath)
    ? configPath
    : resolve(repositoryRoot, configPath);
  const project = readJson(source);
  const id = requiredString(project.id, "id", source);
  if (!idPattern.test(id)) {
    throw new Error(`${source}: project id '${id}' is not CI-safe`);
  }
  if (!buildTools.includes(project.buildTool)) {
    throw new Error(`${source}: unsupported build tool '${project.buildTool}'`);
  }
  if (expectedBuildTool && project.buildTool !== expectedBuildTool) {
    throw new Error(
      `${source}: buildTool '${project.buildTool}' does not match directory '${expectedBuildTool}'`,
    );
  }
  if (!Array.isArray(project.scenarios) || project.scenarios.length === 0) {
    throw new Error(`${source}: at least one scenario is required`);
  }

  const scenarioIds = new Set();
  for (const scenario of project.scenarios) {
    if (!isObject(scenario)) {
      throw new Error(`${source}: every scenario must be an object`);
    }
    const scenarioId = requiredString(scenario.id, "scenario.id", source);
    if (!idPattern.test(scenarioId) || scenarioIds.has(scenarioId)) {
      throw new Error(
        `${source}: scenario id '${scenarioId}' is invalid or duplicated`,
      );
    }
    scenarioIds.add(scenarioId);
    if (scenario.kind !== "mbt-import") {
      throw new Error(`${source}: unsupported scenario kind '${scenario.kind}'`);
    }
    safeRelativePath(scenario.openFile, "scenario.openFile", source);
    validateAssertions(scenario.assertions, source, scenarioId);
    if (
      scenario.namespaceMode !== undefined &&
      !["each-build-target", "single-global-target"].includes(
        scenario.namespaceMode,
      )
    ) {
      throw new Error(
        `${source}: scenario '${scenarioId}' has invalid namespaceMode`,
      );
    }
    if (scenario.namespaceMode !== undefined && project.buildTool !== "bazel") {
      throw new Error(
        `${source}: namespaceMode is currently supported only for Bazel`,
      );
    }
  }

  return {
    source,
    relativeSource: relative(repositoryRoot, source).split(sep).join("/"),
    project: {
      ...project,
      id,
      name: requiredString(project.name, "name", source),
      repository: validateRepository(project.repository, "repository", source),
      ref: validateRef(project.ref, "ref", source),
      projectRoot: safeRelativePath(
        project.projectRoot ?? ".",
        "projectRoot",
        source,
      ),
    },
  };
}

export function discoverProjects() {
  const projects = [];
  const ids = new Set();

  for (const buildTool of buildTools) {
    const directory = resolve(repositoryRoot, "projects", buildTool);
    if (!existsSync(directory)) continue;
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const file of files) {
      const loaded = loadProjectConfig(resolve(directory, file), buildTool);
      if (ids.has(loaded.project.id)) {
        throw new Error(`Duplicate project id '${loaded.project.id}'`);
      }
      ids.add(loaded.project.id);
      projects.push(loaded);
    }
  }

  if (projects.length === 0) throw new Error("No community projects configured");
  return projects;
}
