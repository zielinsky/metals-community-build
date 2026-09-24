import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  EditorView,
  Key,
  Notification,
  StatusBar,
  TextEditor,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import { loadProjectConfig, type Scenario } from "../scripts/config";
import { ScreenshotRecorder } from "../scripts/screenshots";
import { retryWithReopen } from "./retry-with-reopen";
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
export const { project } = loadProjectConfig(projectConfigPath);
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
const screenshots = reportDirectory
  ? new ScreenshotRecorder(reportDirectory, () => VSBrowser.instance.driver.takeScreenshot())
  : undefined;
let activeScenarioId = "startup";
let failureCaptured = false;
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
  if (!screenshots) return;
  const filename = await screenshots.capture(activeScenarioId, step);
  log(`Captured screenshot: ${filename}`);
}

export async function captureFailure(): Promise<void> {
  if (failureCaptured) return;
  try {
    await captureScreenshot("failure");
    failureCaptured = true;
  } catch (error) {
    log(`Could not capture failure screenshot: ${String(error)}`);
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
  failureCaptured = false;
  const startedAt = Date.now();
  try {
    await action();
    updateScenarioResult(result, scenario, "passed", Date.now() - startedAt);
  } catch (error) {
    await captureFailure();
    updateScenarioResult(result, scenario, "failed", Date.now() - startedAt,
      error instanceof Error ? error.message : String(error));
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
      if (openEditors.includes(expectedTitle) &&
          resolve(await new TextEditor().getFilePath()) === openFile) return;
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

async function waitForImportStatus(timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let sawImporting = false;
  let latestTexts: string[] = [];

  while (Date.now() < deadline) {
    signal.throwIfAborted();
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
      // Fast imports can finish between polls, or their status can be hidden by
      // indexing. The runner removes .metals before each run, so these files
      // cannot be stale evidence from an earlier import.
      const metalsLog = resolve(workspace, ".metals", "metals.log");
      if (!isImporting && existsSync(resolve(workspace, ".metals", "mbt.json")) &&
          existsSync(metalsLog) &&
          readFileSync(metalsLog, "utf8").includes("Connected to Build server: MBT")) {
        log("Fresh MBT model and server connection confirm the import finished");
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

  if (await new TextEditor().getFilePath().catch(() => "") !== openFile) {
    log(`Opening ${basename(openFile)} in the existing VS Code session`);
    await VSBrowser.instance.openResources(openFile);
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
  const controller = new AbortController();
  // Observe rejection immediately while the namespace prompt is still open.
  const importFinished = waitForImportStatus(15 * 60 * 1000, controller.signal)
    .then(() => ({ error: undefined }), (error: unknown) => ({ error }));
  try {
    log("Clicking notification action: Use MBT");
    await buildServerChoice.takeAction("Use MBT");
    log("Clicked notification action: Use MBT");
    await waitForNotificationGone(buildServerMessage, 10_000);
    await captureScreenshot("mbt-selected");
    await selectNamespaceMode(namespaceScenario ?? scenario);

    log("Waiting for the VS Code importing status to finish");
    const { error } = await importFinished;
    if (error) throw error;
    const imported = await readMbtModel(30 * 1000);
    await captureScreenshot("mbt-imported");
    return imported;
  } finally {
    controller.abort();
  }
}

export async function reopenScenarioFile(
  scenario: Scenario & { testName: string },
): Promise<TextEditor> {
  const title = basename(scenario.openFile);
  const openFile = fileFor(scenario);
  const driver = VSBrowser.instance.driver;
  log(`Closing and reopening ${title} to refresh test code lenses`);
  await driver.actions().clear();
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  // A previous open may have timed out with the file either open or closed.
  // First focus the exact resource, then close it to deliver a real didClose.
  await openFileInWorkbench(openFile);
  await new EditorView().closeEditor(title);
  await driver.wait(async () => {
    try {
      return !(await new EditorView().getOpenEditorTitles()).includes(title);
    } catch {
      return false;
    }
  }, 30_000, `${title} did not close`);
  await captureScreenshot("file-closed");
  await openFileInWorkbench(openFile);
  const editor = new TextEditor();
  await driver.wait(
    async () => (await editor.getText().catch(() => "")).includes(scenario.testName),
    30_000,
    `${title} reopened without '${scenario.testName}'`,
  );
  await editor.selectText(scenario.testName);
  await captureScreenshot("file-reopened");
  return editor;
}

async function openFileInWorkbench(openFile: string): Promise<void> {
  const driver = VSBrowser.instance.driver;
  // Stay in the WebDriver-controlled window. The VS Code CLI can acknowledge
  // an open request without reopening the resource in this window on CI.
  const prompt = await new Workbench().openCommandPrompt();
  await driver.actions().clear();
  try {
    // Removing the command prefix switches the palette to Go to File.
    await prompt.setText(openFile);
    await driver.wait(async () => {
      const picks = await prompt.getQuickPicks().catch(() => []);
      const labels = await Promise.all(picks.map((pick) => pick.getLabel().catch(() => "")));
      return labels.includes(basename(openFile));
    }, 30_000, `Go to File did not find ${openFile}`);
    await prompt.confirm();
    await waitForWorkspaceFile(openFile, 30_000);
  } finally {
    await driver.actions().clear();
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
  }
}

/** Retry test UI discovery against a fresh editor, with the same bound for run/debug. */
export async function withTestEditor<T>(
  scenario: Scenario & { testName: string },
  action: (editor: TextEditor) => Promise<T>,
): Promise<T> {
  return retryWithReopen({
    current: () => new TextEditor(),
    reopen: () => reopenScenarioFile(scenario),
    action,
    attempts: 6,
    onFailure: (attempt, error) => log(
      `Test UI attempt ${attempt}/6 failed for ${scenario.openFile}: ${String(error)}`,
    ),
  });
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
