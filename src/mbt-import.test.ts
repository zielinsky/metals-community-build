import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  EditorView,
  Notification,
  Workbench,
} from "vscode-extension-tester";

interface ImportAssertions {
  minimumNamespaces?: number;
  minimumDependencyModules?: number;
  sources?: string[];
}

interface ImportScenario {
  id: string;
  kind: "mbt-import";
  openFile: string;
  namespaceMode?: "each-build-target" | "single-global-target";
  assertions: ImportAssertions;
}

interface ProjectConfig {
  id: string;
  name: string;
  buildTool: "bazel" | "maven" | "gradle";
  scenarios: ImportScenario[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const workspace = resolve(requiredEnvironment("METALS_COMMUNITY_WORKSPACE"));
const projectConfigPath = resolve(
  requiredEnvironment("COMMUNITY_BUILD_PROJECT_CONFIG"),
);
const scenarioId = requiredEnvironment("COMMUNITY_BUILD_SCENARIO");
const project = JSON.parse(
  readFileSync(projectConfigPath, "utf8"),
) as ProjectConfig;

function selectedScenario(): ImportScenario {
  const found = project.scenarios.find((entry) => entry.id === scenarioId);
  if (!found) {
    throw new Error(
      `Scenario '${scenarioId}' does not exist in ${projectConfigPath}`,
    );
  }
  return found;
}

const scenario = selectedScenario();

const mbtPath = resolve(workspace, ".metals", "mbt.json");
const metalsLogPath = resolve(workspace, ".metals", "metals.log");
const openFile = resolve(workspace, scenario.openFile);

function log(message: string): void {
  console.log(`[community-build] ${new Date().toISOString()} ${message}`);
}

async function waitForWorkspaceFile(timeoutMs: number): Promise<void> {
  const expectedTitle = basename(openFile);
  const deadline = Date.now() + timeoutMs;
  let openEditors: string[] = [];
  while (Date.now() < deadline) {
    try {
      openEditors = await new EditorView().getOpenEditorTitles();
      if (openEditors.includes(expectedTitle)) return;
    } catch {
      // VS Code startup can briefly invalidate the workbench DOM.
    }
    await new Promise((done) => setTimeout(done, 500));
  }

  throw new Error(
    `VS Code did not open ${openFile}. Open editors: ${JSON.stringify(openEditors)}`,
  );
}

async function waitForNotification(
  expectedMessage: string,
  timeoutMs: number,
): Promise<Notification> {
  const workbench = new Workbench();
  const deadline = Date.now() + timeoutMs;
  let visibleMessages: string[] = [];

  while (Date.now() < deadline) {
    const notifications = await workbench.getNotifications();
    visibleMessages = await Promise.all(
      notifications.map((notification) => notification.getMessage()),
    );
    const index = visibleMessages.findIndex((message) =>
      message.includes(expectedMessage),
    );
    if (index >= 0) {
      log(`Notification appeared: ${visibleMessages[index]}`);
      return notifications[index];
    }

    await new Promise((done) => setTimeout(done, 500));
  }

  throw new Error(
    `Notification containing '${expectedMessage}' did not appear. ` +
      `Visible notifications: ${JSON.stringify(visibleMessages)}`,
  );
}

async function waitForMbtImport(timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (existsSync(mbtPath)) {
      try {
        const imported = JSON.parse(readFileSync(mbtPath, "utf8"));
        log(`Loaded MBT model from ${mbtPath}`);
        return imported;
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((done) => setTimeout(done, 1000));
  }

  const logTail = existsSync(metalsLogPath)
    ? readFileSync(metalsLogPath, "utf8").split("\n").slice(-100).join("\n")
    : "Metals log was not created";
  throw new Error(
    `MBT import did not create valid JSON at ${mbtPath}. ` +
      `Last JSON error: ${String(lastError)}\n\nMetals log tail:\n${logTail}`,
  );
}

async function selectNamespaceMode(): Promise<void> {
  if (!scenario.namespaceMode) return;

  const action =
    scenario.namespaceMode === "each-build-target"
      ? "Each build target"
      : "Single global target";
  const notification = await waitForNotification(
    "How should Metals group Bazel targets in the MBT build?",
    2 * 60 * 1000,
  );
  log(`Clicking notification action: ${action}`);
  await notification.takeAction(action);
  log(`Clicked notification action: ${action}`);
}

describe(`${project.buildTool} / ${project.id}`, function () {
  this.timeout(20 * 60 * 1000);

  it(scenario.id, async () => {
    log(`Starting ${project.buildTool} / ${project.id} / ${scenario.id}`);
    log(`Workspace: ${workspace}`);
    log(`Expected editor: ${openFile}`);
    assert.ok(existsSync(openFile), `Missing file to open: ${openFile}`);
    log("Waiting for VS Code to open the requested file");
    await waitForWorkspaceFile(30 * 1000);
    log(`VS Code opened ${basename(openFile)}`);

    log("Waiting for the build server choice notification");
    const buildServerChoice = await waitForNotification(
      "workspace detected. Which build server would you like to use?",
      2 * 60 * 1000,
    );
    log("Clicking notification action: Use MBT");
    await buildServerChoice.takeAction("Use MBT");
    log("Clicked notification action: Use MBT");
    await selectNamespaceMode();

    log(`Waiting for MBT import to produce ${mbtPath}`);
    const imported = (await waitForMbtImport(15 * 60 * 1000)) as {
      dependencyModules?: unknown[];
      namespaces?: Record<string, { sources?: string[] }>;
    };
    const namespaces = imported.namespaces ?? {};
    const minimumNamespaces = scenario.assertions.minimumNamespaces ?? 1;
    log(
      `MBT model contains ${Object.keys(namespaces).length} namespaces and ` +
        `${(imported.dependencyModules ?? []).length} dependency modules`,
    );

    assert.ok(
      Object.keys(namespaces).length >= minimumNamespaces,
      `Expected at least ${minimumNamespaces} MBT namespaces`,
    );
    if (scenario.assertions.minimumDependencyModules !== undefined) {
      assert.ok(
        (imported.dependencyModules ?? []).length >=
          scenario.assertions.minimumDependencyModules,
        `Expected at least ${scenario.assertions.minimumDependencyModules} dependency modules`,
      );
    }

    const importedSources = Object.values(namespaces).flatMap(
      (namespace) => namespace.sources ?? [],
    );
    for (const expectedSource of scenario.assertions.sources ?? []) {
      assert.ok(
        importedSources.some((source) => source.endsWith(expectedSource)),
        `Expected the MBT model to contain ${expectedSource}`,
      );
      log(`Verified imported source: ${expectedSource}`);
    }
    log(`Scenario passed: ${scenario.id}`);
  });
});
