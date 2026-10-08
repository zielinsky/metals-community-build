import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { By, Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

import type { CodeActionMenu, CodeActionScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, delay, fileFor, log, prepareMbt } from "./test-support";
import { placeCursorInside, restoreSource, selectExactText, visibleTexts } from "./editor-actions";

const menuCommands: Record<CodeActionMenu, string> = {
  "quick-fix": "Quick Fix...",
  refactor: "Refactor...",
  "source-action": "Source Action...",
};

const menuKeybindings: Partial<Record<CodeActionMenu, string>> = {
  "quick-fix": Key.chord(process.platform === "darwin" ? Key.COMMAND : Key.CONTROL, "."),
  refactor: Key.chord(process.platform === "darwin" ? Key.COMMAND : Key.CONTROL, Key.SHIFT, "r"),
};

/**
 * Opens the menu with its editor keybinding when there is one, so the list
 * opens from a focused editor and receives the keyboard; the command palette
 * is the fallback for menus without a default keybinding.
 */
async function openMenu(menu: CodeActionMenu): Promise<void> {
  const keybinding = menuKeybindings[menu];
  if (keybinding) {
    // VS Code 1.101+ replaced the textarea with a native edit context; ExTester
    // resolves the right element for the running version.
    const locators = (TextEditor as unknown as { locators: { Editor: { inputArea: By } } }).locators;
    const inputArea = await new TextEditor().findElement(locators.Editor.inputArea);
    await inputArea.sendKeys(keybinding);
    return;
  }
  await new Workbench().executeCommand(menuCommands[menu]);
}

async function actionWidget(): Promise<WebElement | undefined> {
  for (const widget of await VSBrowser.instance.driver.findElements(By.css(".action-widget"))) {
    if (await widget.isDisplayed().catch(() => false)) return widget;
  }
  return undefined;
}

/**
 * Mouse clicks do not activate rows of the code action list in this VS Code
 * build, so walk the list with the keyboard until the matching row is focused
 * and accept it with Enter. Group headers are skipped by VS Code itself.
 */
async function activateByKeyboard(widget: WebElement, title: string, steps: number): Promise<string> {
  const driver = VSBrowser.instance.driver;
  const list = await widget.findElement(By.css(".monaco-list"));
  const seen: string[] = [];
  // The list receives focus a moment after the widget is shown.
  await delay(500);
  for (let step = 0; step < steps; step += 1) {
    const [focused = ""] = await visibleTexts(".monaco-list-row.focused", widget).catch(() => [""]);
    if (focused.includes(title)) {
      log(`Selecting code action: ${focused}`);
      // Sending the key to the list element focuses it first; fall back to a
      // mouse click when the keyboard event is not delivered to the list.
      await list.sendKeys(Key.ENTER).catch(() => undefined);
      if (await driver.wait(async () => !(await actionWidget()), 3_000).then(() => true, () => false)) {
        return focused;
      }
      const rows = await widget.findElements(By.css(".monaco-list-row.focused"));
      if (rows[0]) await rows[0].click().catch(() => undefined);
      if (await driver.wait(async () => !(await actionWidget()), 3_000).then(() => true, () => false)) {
        return focused;
      }
      throw new Error(`Code action menu stayed open after accepting '${focused}'`);
    }
    if (focused) seen.push(focused);
    await list.sendKeys(Key.ARROW_DOWN).catch(() => undefined);
    await delay(150);
  }
  throw new Error(`Could not focus code action '${title}'. Focused rows: ${JSON.stringify(seen)}`);
}

/**
 * Opens the menu and selects the first action whose title contains `title`.
 * Metals publishes quick fixes once diagnostics for the edited file arrive, so
 * the menu is reopened until the action shows up or the deadline passes.
 */
async function selectAction(menu: CodeActionMenu, title: string, timeoutMs: number): Promise<string> {
  const driver = VSBrowser.instance.driver;
  const deadline = Date.now() + timeoutMs;
  let offered: string[] = [];
  while (Date.now() < deadline) {
    await openMenu(menu);
    const widget = await driver.wait(async () => (await actionWidget()) ?? false, 5_000)
      .catch(() => undefined);
    if (widget) {
      offered = await visibleTexts(".monaco-list-row", widget);
      if (offered.some((text) => text.includes(title))) {
        await captureScreenshot("code-action-listed");
        return activateByKeyboard(widget, title, offered.length + 2);
      }
      log(`Code action '${title}' is not offered yet: ${JSON.stringify(offered)}`);
    }
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    await delay(3_000);
  }
  throw new Error(
    `Code action containing '${title}' was not offered by ${menuCommands[menu]}. ` +
      `Last offered actions: ${JSON.stringify(offered)}`,
  );
}

export async function testCodeAction(scenario: CodeActionScenario): Promise<void> {
  await prepareMbt(scenario);
  const path = fileFor(scenario);
  const original = readFileSync(path, "utf8");
  const { edit, menu, title, expectedText } = scenario.codeAction;
  const editor = new TextEditor();
  const driver = VSBrowser.instance.driver;
  try {
    if (edit) {
      assert.equal(original.split(edit.replace).length - 1, 1, "Code action edit must be unique");
      await selectExactText(editor, edit.replace);
      await driver.actions().clear();
      await editor.typeText(edit.with);
      await editor.save();
      log(`Replaced '${edit.replace}' with '${edit.with}' and saved`);
      await driver.wait(async () => (await editor.getText()).includes(edit.with), 10_000);
    }
    await placeCursorInside(editor, scenario.symbol, scenario.near);
    await captureScreenshot("code-action-symbol-selected");
    const selected = await selectAction(menu, title, 2 * 60 * 1000);
    await driver.wait(async () => (await editor.getText()).includes(expectedText), 30_000,
      `Code action '${selected}' did not produce '${expectedText}'`);
    await selectExactText(editor, expectedText);
    log(`Code action '${selected}' inserted '${expectedText}'`);
    await captureScreenshot("code-action-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await restoreSource(path, original);
  }
}
