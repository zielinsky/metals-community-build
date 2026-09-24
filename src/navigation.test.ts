import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { By, Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";

import type { DefinitionScenario, HoverScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, log, prepareMbt, workspace } from "./test-support";

export async function testDefinition(scenario: DefinitionScenario): Promise<void> {
  await prepareMbt(scenario);
  await new TextEditor().selectText(scenario.symbol);
  await captureScreenshot("definition-symbol-selected");
  log(`Go to Definition: ${scenario.symbol}`);
  await new Workbench().executeCommand("Go to Definition");
  const expectedFile = resolve(workspace, scenario.definition.file);
  const lines = readFileSync(expectedFile, "utf8").split(/\r?\n/);
  await VSBrowser.instance.driver.wait(async () => {
    try {
      const editor = new TextEditor();
      if (resolve(await editor.getFilePath()) !== expectedFile) return false;
      const [line] = await editor.getCoordinates();
      // getTextAtLine() copies the whole editor and moves the cursor; preserve
      // the actual navigation destination for the screenshot instead.
      return lines[line - 1]?.includes(scenario.definition.text) ?? false;
    } catch {
      return false;
    }
  }, 60_000, `Definition did not navigate to ${scenario.definition.file}: ${scenario.definition.text}`);
  await captureScreenshot("definition-verified");
}

export async function testHover(scenario: HoverScenario): Promise<void> {
  await prepareMbt(scenario);
  const editor = new TextEditor();
  assert.ok((await editor.getText()).includes(scenario.symbol), `Missing symbol: ${scenario.symbol}`);
  await editor.selectText(scenario.symbol);
  log(`Show hover: ${scenario.symbol}`);
  const driver = VSBrowser.instance.driver;
  try {
    await new Workbench().executeCommand("Show or Focus Hover");
    await driver.wait(async () => {
      const hovers = await driver.findElements(By.css(".monaco-hover"));
      for (const hover of hovers) {
        if (await hover.isDisplayed().catch(() => false) &&
            (await hover.getText().catch(() => "")).includes(scenario.hoverText)) return true;
      }
      return false;
    }, 30_000, `Hover did not contain '${scenario.hoverText}'`);
    await captureScreenshot("hover-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await driver.actions().sendKeys(Key.ESCAPE).perform();
  }
}
