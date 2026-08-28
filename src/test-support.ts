import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  EditorView,
  Notification,
  StatusBar,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import type { ProjectConfig, Scenario } from "../scripts/config";
import {
  createProjectResult,
  updateScenarioResult,
  writeProjectResult,
} from "../scripts/test-report";

export interface MbtModel {
  dependencyModules?: unknown[];
  namespaces?: Record<string, { sources?: string[] }>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const workspace = resolve(
  requiredEnvironment("METALS_COMMUNITY_WORKSPACE"),
);
const projectConfigPath = resolve(
  requiredEnvironment("COMMUNITY_BUILD_PROJECT_CONFIG"),
);
const reportDirectory = process.env.COMMUNITY_BUILD_REPORT_DIR || undefined;
export const project = JSON.parse(
  readFileSync(projectConfigPath, "utf8"),
) as ProjectConfig;
const selectedScenarioIds = JSON.parse(
  requiredEnvironment("COMMUNITY_BUILD_SCENARIOS"),
) as unknown;

if (
  !Array.isArray(selectedScenarioIds) ||
  selectedScenarioIds.some((id) => typeof id !== "string")
) {
  throw new Error("COMMUNITY_BUILD_SCENARIOS must be a JSON array of strings");
}

export const scenarios = selectedScenarioIds.map((id) => {
  const scenario = project.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Scenario '${id}' does not exist in ${projectConfigPath}`);
  }
  return scenario;
});

const result = createProjectResult(project, scenarios);
const screenshotIndexes = new Map<string, number>();
let activeScenarioId = "startup";
let currentOpenFile = fileFor(scenarios[0]);
let mbtImport: Promise<MbtModel> | undefined;
writeProjectResult(reportDirectory, result);

export function fileFor(scenario: Scenario): string {
  return resolve(workspace, scenario.openFile);
}

export function log(message: string): void {
  console.log(`[community-build] ${new Date().toISOString()} ${message}`);
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

export async function captureScreenshot(step: string): Promise<void> {
  if (!reportDirectory) return;
  const slug = step.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const directory = resolve(reportDirectory, "screenshots", activeScenarioId);
  const index = (screenshotIndexes.get(activeScenarioId) ?? 0) + 1;
  screenshotIndexes.set(activeScenarioId, index);
  const filename = `${String(index).padStart(2, "0")}-${slug}.png`;
  try {
    mkdirSync(directory, { recursive: true });
    const screenshot = await VSBrowser.instance.driver.takeScreenshot();
    writeFileSync(resolve(directory, filename), screenshot, "base64");
    log(`Captured screenshot: ${activeScenarioId}/${filename}`);
  } catch (error) {
    log(`Could not capture screenshot '${step}': ${String(error)}`);
  }
}

export function skipScenario(scenario: Scenario, reason: string): void {
  log(`Skipping ${scenario.id}: ${reason}`);
  updateScenarioResult(result, scenario, "skipped", 0);
  writeProjectResult(reportDirectory, result);
}

export async function executeScenario(
  scenario: Scenario,
  action: () => Promise<void>,
): Promise<void> {
  activeScenarioId = scenario.id;
  const startedAt = Date.now();
  try {
    await action();
    updateScenarioResult(result, scenario, "passed", Date.now() - startedAt);
  } catch (error) {
    await captureScreenshot("failure");
    updateScenarioResult(result, scenario, "failed", Date.now() - startedAt);
    throw error;
  } finally {
    writeProjectResult(reportDirectory, result);
  }
}

async function waitForWorkspaceFile(
  openFile: string,
  timeoutMs: number,
): Promise<void> {
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
    await delay(500);
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
    await delay(500);
  }

  throw new Error(
    `Notification containing '${expectedMessage}' did not appear. ` +
      `Visible notifications: ${JSON.stringify(visibleMessages)}`,
  );
}

async function waitForNotificationGone(
  expectedMessage: string,
  timeoutMs: number,
): Promise<void> {
  const workbench = new Workbench();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const notifications = await workbench.getNotifications().catch(() => []);
    const messages = await Promise.all(
      notifications.map((notification) => notification.getMessage().catch(() => "")),
    );
    if (!messages.some((message) => message.includes(expectedMessage))) return;
    await delay(300);
  }
  // The notification can also be dismissed by VS Code (e.g. replaced by the
  // next step's own prompt) without the DOM element ever disappearing from
  // this snapshot; either way, the screenshot right after this is only ever
  // used as a best-effort "what did it look like" record, not an assertion.
}

async function selectNamespaceMode(scenario: Scenario): Promise<void> {
  if (!scenario.namespaceMode) return;

  const action =
    scenario.namespaceMode === "each-build-target"
      ? "Each build target"
      : "Single global target";
  const message = "How should Metals group Bazel targets in the MBT build?";
  const notification = await waitForNotification(message, 2 * 60 * 1000);
  await captureScreenshot("namespace-mode-prompt");
  log(`Clicking notification action: ${action}`);
  await notification.takeAction(action);
  log(`Clicked notification action: ${action}`);
  await waitForNotificationGone(message, 10_000);
  await captureScreenshot("namespace-mode-selected");
}

async function statusBarTexts(): Promise<string[]> {
  const items = await new StatusBar().getItems();
  const texts = await Promise.all(
    items.map(async (item) => {
      const values = await Promise.all([
        item.getText().catch(() => ""),
        item.getAttribute("aria-label").catch(() => ""),
        item.getAttribute("title").catch(() => ""),
      ]);
      return values.filter(Boolean).join(" ");
    }),
  );
  return texts.filter(Boolean);
}

async function waitForImportStatus(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let sawImporting = false;
  let latestTexts: string[] = [];

  while (Date.now() < deadline) {
    try {
      latestTexts = await statusBarTexts();
      const isImporting = latestTexts.some((text) =>
        /importing\.{3}/i.test(text),
      );

      if (isImporting && !sawImporting) {
        sawImporting = true;
        log("VS Code status bar reports that the project is importing");
      } else if (sawImporting && !isImporting) {
        log("VS Code status bar reports that the project import finished");
        return;
      }
    } catch {
      // The status bar DOM can be replaced while Metals updates its items.
    }
    await delay(500);
  }

  throw new Error(
    sawImporting
      ? `VS Code kept reporting an active import. Status bar: ${JSON.stringify(latestTexts)}`
      : `VS Code never reported an active import. Status bar: ${JSON.stringify(latestTexts)}`,
  );
}

async function readMbtModel(timeoutMs: number): Promise<MbtModel> {
  const mbtPath = resolve(workspace, ".metals", "mbt.json");
  const metalsLogPath = resolve(workspace, ".metals", "metals.log");
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (existsSync(mbtPath)) {
      try {
        const imported = JSON.parse(readFileSync(mbtPath, "utf8")) as MbtModel;
        log(`Loaded MBT model from ${mbtPath}`);
        return imported;
      } catch (error) {
        lastError = error;
      }
    }
    await delay(1000);
  }

  const logTail = existsSync(metalsLogPath)
    ? readFileSync(metalsLogPath, "utf8").split("\n").slice(-100).join("\n")
    : "Metals log was not created";
  throw new Error(
    `MBT import did not create valid JSON at ${mbtPath}. ` +
      `Last JSON error: ${String(lastError)}\n\nMetals log tail:\n${logTail}`,
  );
}

async function openScenarioFile(scenario: Scenario): Promise<void> {
  const openFile = fileFor(scenario);
  log(`Starting ${project.buildTool} / ${project.id} / ${scenario.id}`);
  log(`Workspace: ${workspace}`);
  log(`Expected editor: ${openFile}`);
  assert.ok(existsSync(openFile), `Missing file to open: ${openFile}`);

  if (openFile !== currentOpenFile) {
    log(`Opening ${basename(openFile)} in the existing VS Code session`);
    await VSBrowser.instance.openResources(openFile);
    currentOpenFile = openFile;
  }
  log("Waiting for VS Code to open the requested file");
  await waitForWorkspaceFile(openFile, 30 * 1000);
  log(`VS Code opened ${basename(openFile)}`);
  await captureScreenshot("file-opened");
}

async function importMbt(scenario: Scenario): Promise<MbtModel> {
  const namespaceScenario = scenarios.find(
    (candidate) => candidate.namespaceMode !== undefined,
  );

  log("Waiting for the build server choice notification");
  const buildServerMessage =
    "workspace detected. Which build server would you like to use?";
  const buildServerChoice = await waitForNotification(
    buildServerMessage,
    2 * 60 * 1000,
  );
  await captureScreenshot("build-server-prompt");
  const importFinished = waitForImportStatus(15 * 60 * 1000);
  log("Clicking notification action: Use MBT");
  await buildServerChoice.takeAction("Use MBT");
  log("Clicked notification action: Use MBT");
  await waitForNotificationGone(buildServerMessage, 10_000);
  await captureScreenshot("mbt-selected");
  await selectNamespaceMode(namespaceScenario ?? scenario);

  log("Waiting for the VS Code importing status to finish");
  await importFinished;
  const imported = await readMbtModel(30 * 1000);
  await captureScreenshot("mbt-imported");
  return imported;
}

export async function prepareMbt(scenario: Scenario): Promise<MbtModel> {
  await openScenarioFile(scenario);
  if (!mbtImport) {
    mbtImport = importMbt(scenario);
  } else {
    log("Reusing the existing VS Code, Metals and MBT session");
    await captureScreenshot("mbt-session-reused");
  }
  return mbtImport;
}
