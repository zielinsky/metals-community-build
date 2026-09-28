import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { CompletionScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, fileFor, prepareMbt } from "./test-support";
import { selectExactText } from "./editor-actions";

export async function testCompletion(scenario: CompletionScenario): Promise<void> {
  await prepareMbt(scenario);
  const path = fileFor(scenario);
  const original = readFileSync(path, "utf8");
  const { replace, prefix, item, expectedText } = scenario.completion;
  assert.equal(original.split(replace).length - 1, 1, "Completion replacement must be unique");
  const editor = new TextEditor();
  const driver = VSBrowser.instance.driver;
  try {
    await selectExactText(editor, replace);
    await driver.actions().clear();
    await editor.typeText(prefix);
    const assist = await editor.toggleContentAssist(true);
    await driver.actions().clear();
    assert.ok(assist, "Completion popup did not open");
    const suggestion = await driver.wait(async () => {
      for (const candidate of await assist.getItems()) {
        const label = await candidate.getLabel();
        if (label === item || label.startsWith(`${item}(`)) return candidate;
      }
      return false;
    }, 30_000, `Completion '${item}' did not appear`);
    assert.ok(suggestion);
    await captureScreenshot("completion-listed");
    await suggestion.click();
    await driver.actions().sendKeys(Key.ENTER).perform();
    await driver.wait(async () => (await editor.getText()) === original.replace(replace, expectedText),
      10_000, `Completion did not insert '${expectedText}'`);
    await selectExactText(editor, expectedText);
    await captureScreenshot("completion-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    writeFileSync(path, original);
    await new Workbench().executeCommand("File: Revert File");
  }
}
