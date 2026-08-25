import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  EditorView,
  Notification,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import type { ProjectConfig, Scenario } from "../scripts/config";

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
const scenarioId = requiredEnvironment("COMMUNITY_BUILD_SCENARIO");
const reportDirectory = process.env.COMMUNITY_BUILD_REPORT_DIR;
let screenshotIndex = 0;
export const project = JSON.parse(
  readFileSync(projectConfigPath, "utf8"),
) as ProjectConfig;

export function selectScenario<K extends Scenario["kind"]>(
  expectedKind: K,
): Extract<Scenario, { kind: K }> {
  const scenario = project.scenarios.find(({ id }) => id === scenarioId);
  if (!scenario) {
    throw new Error(
      `Scenario '${scenarioId}' does not exist in ${projectConfigPath}`,
    );
  }
  if (scenario.kind !== expectedKind) {
    throw new Error(
      `Scenario '${scenarioId}' has kind '${scenario.kind}', expected '${expectedKind}'`,
    );
  }
  return scenario as Extract<Scenario, { kind: K }>;
}

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
  const directory = resolve(reportDirectory, "screenshots", scenarioId);
  const filename = `${String(++screenshotIndex).padStart(2, "0")}-${slug}.png`;
  try {
    mkdirSync(directory, { recursive: true });
    const screenshot = await VSBrowser.instance.driver.takeScreenshot();
    writeFileSync(resolve(directory, filename), screenshot, "base64");
    log(`Captured screenshot: ${scenarioId}/${filename}`);
  } catch (error) {
    log(`Could not capture screenshot '${step}': ${String(error)}`);
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

async function selectNamespaceMode(scenario: Scenario): Promise<void> {
  if (!scenario.namespaceMode) return;

  const action =
    scenario.namespaceMode === "each-build-target"
      ? "Each build target"
      : "Single global target";
  const notification = await waitForNotification(
    "How should Metals group Bazel targets in the MBT build?",
    2 * 60 * 1000,
  );
  await captureScreenshot("namespace-mode-prompt");
  log(`Clicking notification action: ${action}`);
  await notification.takeAction(action);
  log(`Clicked notification action: ${action}`);
  await captureScreenshot("namespace-mode-selected");
}

async function waitForMbtImport(timeoutMs: number): Promise<MbtModel> {
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

export async function prepareMbt(scenario: Scenario): Promise<MbtModel> {
  const openFile = fileFor(scenario);
  log(`Starting ${project.buildTool} / ${project.id} / ${scenario.id}`);
  log(`Workspace: ${workspace}`);
  log(`Expected editor: ${openFile}`);
  assert.ok(existsSync(openFile), `Missing file to open: ${openFile}`);

  log("Waiting for VS Code to open the requested file");
  await waitForWorkspaceFile(openFile, 30 * 1000);
  log(`VS Code opened ${basename(openFile)}`);
  await captureScreenshot("file-opened");

  log("Waiting for the build server choice notification");
  const buildServerChoice = await waitForNotification(
    "workspace detected. Which build server would you like to use?",
    2 * 60 * 1000,
  );
  await captureScreenshot("build-server-prompt");
  log("Clicking notification action: Use MBT");
  await buildServerChoice.takeAction("Use MBT");
  log("Clicked notification action: Use MBT");
  await captureScreenshot("mbt-selected");
  await selectNamespaceMode(scenario);

  log("Waiting for MBT import to finish");
  const imported = await waitForMbtImport(15 * 60 * 1000);
  await captureScreenshot("mbt-imported");
  return imported;
}
