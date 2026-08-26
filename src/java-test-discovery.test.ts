import assert from "node:assert/strict";

import { By, TextEditor, VSBrowser } from "vscode-extension-tester";

import type { JavaTestDiscoveryScenario } from "../scripts/config";
import { captureScreenshot, log, prepareMbt } from "./test-support";

async function waitForTestRunButton(
  testName: string,
  timeoutMs: number,
): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.wait(
    async () => {
      const lines = await driver.findElements(
        By.css(".monaco-editor .view-lines .view-line"),
      );
      const testLine = await Promise.all(
        lines.map(async (line) => ({
          line,
          displayed: await line.isDisplayed().catch(() => false),
          text: await line.getText().catch(() => ""),
        })),
      ).then((candidates) =>
        candidates.find(
          ({ displayed, text }) => displayed && text.includes(testName),
        ),
      );
      if (!testLine) return false;

      const lineRect = await testLine.line.getRect();
      const buttons = await driver.findElements(
        By.css(".monaco-editor .testing-run-glyph"),
      );
      const buttonRects = await Promise.all(
        buttons.map(async (button) => ({
          displayed: await button.isDisplayed().catch(() => false),
          rect: await button.getRect().catch(() => undefined),
        })),
      );
      return buttonRects.some(
        ({ displayed, rect }) =>
          displayed &&
          rect !== undefined &&
          Math.abs(rect.y - lineRect.y) <= Math.max(2, lineRect.height / 2),
      );
    },
    timeoutMs,
    `VS Code did not discover '${testName}' as a test in the active editor`,
  );
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

  await editor.selectText(scenario.testName);
  log(`Waiting for VS Code to discover test: ${scenario.testName}`);
  await waitForTestRunButton(scenario.testName, 10 * 60 * 1000);
  log(`VS Code discovered test: ${scenario.testName}`);
  await captureScreenshot("test-run-button-discovered");

  log(`Scenario passed: ${scenario.id}`);
}
