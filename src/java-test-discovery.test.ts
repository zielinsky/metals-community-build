import assert from "node:assert/strict";

import { By, TextEditor, VSBrowser } from "vscode-extension-tester";

import type { JavaTestDiscoveryScenario } from "../scripts/config";
import { captureScreenshot, log, prepareMbt } from "./test-support";

async function waitForTestRunButton(timeoutMs: number): Promise<number> {
  const driver = VSBrowser.instance.driver;
  let visibleButtons = 0;
  await driver.wait(
    async () => {
      const buttons = await driver.findElements(
        By.css(".monaco-editor .testing-run-glyph"),
      );
      const visibility = await Promise.all(
        buttons.map((button) => button.isDisplayed().catch(() => false)),
      );
      visibleButtons = visibility.filter(Boolean).length;
      return visibleButtons > 0;
    },
    timeoutMs,
    "VS Code did not display a test run button in the active editor",
  );
  return visibleButtons;
}

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

  const testButtons = await waitForTestRunButton(10 * 60 * 1000);
  log(`Found ${testButtons} visible test run button(s)`);
  await editor.selectText(scenario.testName);
  await captureScreenshot("test-run-button-discovered");

  log(`Scenario passed: ${scenario.id}`);
}
