import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { By, Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";

import type { DefinitionScenario, DocumentSymbolScenario, HoverScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, fileFor, log, openScenarioFile, prepareMbt, workspace } from "./test-support";
import { editorText, selectExactText } from "./editor-actions";

/** A quick pick label is the symbol name, optionally followed by a signature or container. */
function matchesSymbol(label: string, symbol: string): boolean {
  const name = label.replace(/\s+/g, " ").trim();
  return name === symbol || name.startsWith(`${symbol}(`) || name.startsWith(`${symbol} `);
}

export async function testDefinition(scenario: DefinitionScenario): Promise<void> {
  await prepareMbt(scenario);
  await selectExactText(new TextEditor(), scenario.symbol, scenario.near);
  await captureScreenshot("definition-symbol-selected");
  const command = scenario.kind === "go-to-implementation" ? "Go to Implementations" : "Go to Definition";
  const expectedFile = resolve(workspace, scenario.definition.file);
  const lines = readFileSync(expectedFile, "utf8").split(/\r?\n/);
  const arrived = async () => {
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
  };
  // Implementations come from the workspace index, which Metals may still be
  // building right after the import, so the command is repeated until the
  // deadline instead of being issued once.
  const driver = VSBrowser.instance.driver;
  const deadline = Date.now() + 90_000;
  let navigated = false;
  while (!navigated && Date.now() < deadline) {
    log(`${command}: ${scenario.symbol}`);
    await new Workbench().executeCommand(command);
    navigated = await driver.wait(arrived, 15_000).then(() => true, () => false);
    if (!navigated) {
      await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
      const current = await new TextEditor().getFilePath().catch(() => "");
      if (resolve(current) !== fileFor(scenario)) await openScenarioFile(scenario);
      await selectExactText(new TextEditor(), scenario.symbol, scenario.near);
    }
  }
  if (!navigated) {
    throw new Error(`${command} did not navigate to ${scenario.definition.file}: ${scenario.definition.text}`);
  }
  await captureScreenshot(scenario.kind === "go-to-implementation" ? "implementation-verified" : "definition-verified");
}

export async function testDocumentSymbol(scenario: DocumentSymbolScenario): Promise<void> {
  await prepareMbt(scenario);
  const driver = VSBrowser.instance.driver;
  const lines = readFileSync(resolve(workspace, scenario.openFile), "utf8").split(/\r?\n/);
  const prompt = await new Workbench().openCommandPrompt();
  await driver.actions().clear();
  try {
    await prompt.setText(`@${scenario.symbol}`);
    let labels: string[] = [];
    const selectedLabel = await driver.wait(async () => {
      const items = await prompt.getQuickPicks();
      labels = await Promise.all(items.map((item) => item.getLabel().catch(() => "")));
      return labels.find((label) => matchesSymbol(label, scenario.symbol)) ?? false;
    }, 30_000).catch(() => {
      throw new Error(
        `Document symbol '${scenario.symbol}' did not appear. Listed symbols: ${JSON.stringify(labels)}`,
      );
    });
    assert.ok(selectedLabel);
    await captureScreenshot("document-symbol-listed");
    await prompt.selectQuickPick(selectedLabel);
    await driver.wait(async () => {
      const editor = new TextEditor();
      if (resolve(await editor.getFilePath()) !== resolve(workspace, scenario.openFile)) return false;
      const [line] = await editor.getCoordinates();
      return lines[line - 1]?.includes(scenario.expectedLine) ?? false;
    }, 30_000, `Document symbol did not navigate to '${scenario.expectedLine}'`);
    await captureScreenshot("document-symbol-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
  }
}

export async function testHover(scenario: HoverScenario): Promise<void> {
  await prepareMbt(scenario);
  const editor = new TextEditor();
  assert.ok((await editorText(editor)).includes(scenario.symbol), `Missing symbol: ${scenario.symbol}`);
  await selectExactText(editor, scenario.symbol, scenario.near);
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
