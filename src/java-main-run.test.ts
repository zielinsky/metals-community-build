import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BottomBarPanel,
  CodeLens,
  Key,
  TextEditor,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import type { JavaMainRunScenario } from "../scripts/config";
import {
  captureScreenshot,
  delay,
  log,
  prepareMbt,
  workspace,
} from "./test-support";

async function waitForRunCodeLens(
  editor: TextEditor,
  timeoutMs: number,
): Promise<CodeLens> {
  const deadline = Date.now() + timeoutMs;
  let visibleLenses: string[] = [];

  while (Date.now() < deadline) {
    try {
      const lenses = await editor.getCodeLenses();
      visibleLenses = await Promise.all(lenses.map((lens) => lens.getText()));
      const index = visibleLenses.findIndex((title) => /^run\b/i.test(title));
      if (index >= 0) return lenses[index];
    } catch {
      // Code lenses are replaced while Metals refreshes the editor model.
    }
    await delay(500);
  }

  throw new Error(
    `Run code lens did not appear. Visible code lenses: ${JSON.stringify(visibleLenses)}`,
  );
}

async function waitForApplicationStart(
  successOutput: string,
  timeoutMs: number,
): Promise<void> {
  const console = await new BottomBarPanel().openDebugConsoleView();
  const metalsLog = resolve(workspace, ".metals", "metals.log");
  const deadline = Date.now() + timeoutMs;
  let output = "";
  let metalsOutput = "";

  while (Date.now() < deadline) {
    output = await console.getText().catch(() => output);
    if (output.includes(successOutput)) return;

    if (existsSync(metalsLog)) {
      metalsOutput = readFileSync(metalsLog, "utf8").slice(-100_000);
    }
    const notifications = await new Workbench()
      .getNotifications()
      .then((items) => Promise.all(items.map((item) => item.getMessage())))
      .catch(() => [] as string[]);
    const observed = [output, metalsOutput, ...notifications].join("\n");

    const failure = [
      "FAILURE: Build failed with an exception.",
      "Could not find Gradle project",
      "Run session not started",
      "Cannot execute code lens",
    ].find((message) => observed.includes(message));
    if (failure) {
      throw new Error(
        `Application launch failed: ${failure}\n\n` +
          `Debug console:\n${output}\n\nMetals log tail:\n${metalsOutput}`,
      );
    }
    await delay(1000);
  }

  throw new Error(
    `Application did not print '${successOutput}'. Debug console tail:\n` +
      output.split("\n").slice(-100).join("\n"),
  );
}

async function stopApplication(): Promise<void> {
  log("Stopping the application debug session");
  try {
    await new Workbench().executeCommand("Debug: Stop");
  } catch {
    await VSBrowser.instance.driver
      .actions()
      .sendKeys(Key.chord(Key.SHIFT, Key.F5))
      .perform()
      .catch(() => undefined);
  }
}

export async function testJavaMainRun(
  scenario: JavaMainRunScenario,
): Promise<void> {
  await prepareMbt(scenario);

  const editor = new TextEditor();
  const source = await editor.getText();
  const simpleName = scenario.main.className.split(".").at(-1) ?? "";
  assert.ok(source.includes(`class ${simpleName}`), `Missing ${simpleName}`);
  assert.ok(source.includes("static void main("), "Missing Java main method");

  await editor.selectText("main");
  log(`Waiting for the run code lens for ${scenario.main.className}`);
  const run = await waitForRunCodeLens(editor, 10 * 60 * 1000);
  await captureScreenshot("run-code-lens-discovered");

  try {
    log(`Clicking run for ${scenario.main.className}`);
    await run.click();
    await captureScreenshot("run-clicked");
    log(`Waiting for application output: ${scenario.main.successOutput}`);
    await waitForApplicationStart(
      scenario.main.successOutput,
      15 * 60 * 1000,
    );
    log(`Application started: ${scenario.main.className}`);
    await captureScreenshot("application-started");
  } finally {
    await stopApplication();
  }

  log(`Scenario passed: ${scenario.id}`);
}
