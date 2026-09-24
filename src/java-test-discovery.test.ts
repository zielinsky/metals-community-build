import assert from "node:assert/strict";

import { TextEditor } from "vscode-extension-tester";

import type { JavaTestDiscoveryScenario } from "../scripts/config";
import { waitForTestGutter } from "./editor-actions";
import {
  captureScreenshot,
  log,
  prepareMbt,
  withTestEditor,
} from "./test-support";

export async function testJavaTestDiscovery(
  scenario: JavaTestDiscoveryScenario,
): Promise<void> {
  await prepareMbt(scenario);

  const editor = new TextEditor();
  const source = await editor.getText();
  assert.ok(
    source.includes(scenario.testName),
    `Missing test: ${scenario.testName}`,
  );

  await editor.selectText(scenario.testName);
  log(`Waiting for VS Code to discover test: ${scenario.testName}`);
  await withTestEditor(scenario, () => waitForTestGutter(scenario.testName, 20_000));
  log(`VS Code discovered test: ${scenario.testName}`);
  await captureScreenshot("test-run-button-discovered");

  log(`Scenario passed: ${scenario.id}`);
}
