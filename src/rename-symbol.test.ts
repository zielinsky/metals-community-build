import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import {
  By,
  Key,
  TextEditor,
  until,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import type { RenameScenario } from "../scripts/config";
import {
  captureScreenshot,
  delay,
  fileFor,
  log,
  prepareMbt,
} from "./test-support";

function identifierOccurrences(text: string, identifier: string): number {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0;
}

async function openRenameInput(
  scenario: RenameScenario,
  editor: TextEditor,
  timeoutMs: number,
) {
  const driver = VSBrowser.instance.driver;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let selectionCaptured = false;

  while (Date.now() < deadline) {
    try {
      await editor.selectText(scenario.rename.symbol);
      log(`Selected symbol: ${scenario.rename.symbol}`);
      if (!selectionCaptured) {
        await captureScreenshot("rename-symbol-selected");
        selectionCaptured = true;
      }
      log("Executing command: Rename Symbol");
      await new Workbench().executeCommand("Rename Symbol");

      const attemptTimeout = Math.max(
        1_000,
        Math.min(10_000, deadline - Date.now()),
      );
      const input = await driver.wait(
        until.elementLocated(By.css("input.rename-input")),
        attemptTimeout,
      );
      await driver.wait(until.elementIsVisible(input), attemptTimeout);
      await captureScreenshot("rename-input-opened");
      return input;
    } catch (error) {
      lastError = error;
      log("Rename input is not ready yet; retrying");
      try {
        await driver.actions().sendKeys(Key.ESCAPE).perform();
      } catch {
        // The focused element may disappear while the command is completing.
      }
      await delay(2_000);
    }
  }

  throw new Error(
    `Rename input did not appear for '${scenario.rename.symbol}': ${String(lastError)}`,
  );
}

async function verifyRename(scenario: RenameScenario): Promise<void> {
  const openFile = fileFor(scenario);
  const { symbol, newName, expectedOccurrences } = scenario.rename;
  const editor = new TextEditor();
  const before = await editor.getText();
  assert.equal(
    identifierOccurrences(before, symbol),
    expectedOccurrences,
    `Unexpected number of '${symbol}' occurrences before rename`,
  );

  const input = await openRenameInput(scenario, editor, 2 * 60 * 1000);
  const selectAll = Key.chord(
    process.platform === "darwin" ? Key.COMMAND : Key.CONTROL,
    "a",
  );
  log(`Renaming ${symbol} to ${newName}`);
  await input.sendKeys(selectAll, newName, Key.ENTER);

  const driver = VSBrowser.instance.driver;
  await driver.wait(async () => {
    try {
      const text = await editor.getText();
      return (
        identifierOccurrences(text, symbol) === 0 &&
        identifierOccurrences(text, newName) === expectedOccurrences
      );
    } catch {
      return false;
    }
  }, 30_000);
  await editor.save();

  await driver.wait(() => {
    try {
      return (
        identifierOccurrences(readFileSync(openFile, "utf8"), newName) ===
        expectedOccurrences
      );
    } catch {
      return false;
    }
  }, 30_000);

  const saved = readFileSync(openFile, "utf8");
  assert.equal(identifierOccurrences(saved, symbol), 0);
  assert.equal(identifierOccurrences(saved, newName), expectedOccurrences);
  log(`Verified ${expectedOccurrences} occurrences of ${newName}`);

  await editor.selectText(newName);
  log(`Selected renamed symbol for screenshot: ${newName}`);
  await delay(300);
  await captureScreenshot("rename-verified");
}

export async function testRenameSymbol(
  scenario: RenameScenario,
): Promise<void> {
  const openFile = fileFor(scenario);
  const original = readFileSync(openFile, "utf8");
  try {
    await prepareMbt(scenario);
    await verifyRename(scenario);
    log(`Scenario passed: ${scenario.id}`);
  } finally {
    writeFileSync(openFile, original);
    log(`Restored ${openFile}`);
  }
}
