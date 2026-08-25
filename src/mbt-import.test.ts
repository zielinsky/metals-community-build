import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  By,
  EditorView,
  Key,
  Notification,
  TextEditor,
  until,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

interface ImportAssertions {
  minimumNamespaces?: number;
  minimumDependencyModules?: number;
  sources?: string[];
}

interface RenameAssertion {
  symbol: string;
  newName: string;
  expectedOccurrences: number;
}

interface ImportScenario {
  id: string;
  kind: "mbt-import";
  openFile: string;
  namespaceMode?: "each-build-target" | "single-global-target";
  assertions: ImportAssertions;
  rename?: RenameAssertion;
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

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
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

async function openRenameInput(
  editor: TextEditor,
  symbol: string,
  timeoutMs: number,
) {
  const driver = VSBrowser.instance.driver;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await editor.selectText(symbol);
      log(`Selected symbol: ${symbol}`);
      log("Executing command: Rename Symbol");
      await new Workbench().executeCommand("Rename Symbol");

      const attemptTimeout = Math.max(
        1_000,
        Math.min(10_000, deadline - Date.now()),
      );
      const input = await driver.wait(
        until.elementLocated(By.css("input.rename-input")),
        attemptTimeout,
      );
      await driver.wait(until.elementIsVisible(input), attemptTimeout);
      return input;
    } catch (error) {
      lastError = error;
      log("Rename input is not ready yet; retrying");
      try {
        await driver.actions().sendKeys(Key.ESCAPE).perform();
      } catch {
        // The focused element may disappear while the command is completing.
      }
      await delay(2_000);
    }
  }

  throw new Error(
    `Rename input did not appear for '${symbol}': ${String(lastError)}`,
  );
}

async function verifyRename(rename: RenameAssertion): Promise<void> {
  const editor = new TextEditor();
  const before = await editor.getText();
  assert.equal(
    occurrences(before, rename.symbol),
    rename.expectedOccurrences,
    `Unexpected number of '${rename.symbol}' occurrences before rename`,
  );

  const input = await openRenameInput(editor, rename.symbol, 2 * 60 * 1000);
  const selectAll = Key.chord(
    process.platform === "darwin" ? Key.COMMAND : Key.CONTROL,
    "a",
  );
  log(`Renaming ${rename.symbol} to ${rename.newName}`);
  await input.sendKeys(selectAll, rename.newName, Key.ENTER);

  const driver = VSBrowser.instance.driver;
  await driver.wait(async () => {
    try {
      const text = await editor.getText();
      return (
        occurrences(text, rename.symbol) === 0 &&
        occurrences(text, rename.newName) === rename.expectedOccurrences
      );
    } catch {
      return false;
    }
  }, 30_000);
  await editor.save();

  await driver.wait(() => {
    try {
      const text = readFileSync(openFile, "utf8");
      return occurrences(text, rename.newName) === rename.expectedOccurrences;
    } catch {
      return false;
    }
  }, 30_000);

  const saved = readFileSync(openFile, "utf8");
  assert.equal(
    occurrences(saved, rename.symbol),
    0,
    `Rename left occurrences of '${rename.symbol}' in ${openFile}`,
  );
  assert.equal(
    occurrences(saved, rename.newName),
    rename.expectedOccurrences,
    `Rename did not update every occurrence in ${openFile}`,
  );
  log(
    `Verified ${rename.expectedOccurrences} occurrences of ${rename.newName}`,
  );
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
    if (scenario.rename) await verifyRename(scenario.rename);
    log(`Scenario passed: ${scenario.id}`);
  });
});
