import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Key, TextEditor, VSBrowser } from "vscode-extension-tester";
import type { CompletionScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, fileFor, log, prepareMbt } from "./test-support";
import { restoreSource, selectExactText } from "./editor-actions";

/** Labels are `name`, `name(...)` for methods, or `name - package` for auto-imports. */
function matchesItem(label: string, item: string): boolean {
  return label === item || label.startsWith(`${item}(`) || label.startsWith(`${item} `);
}

/** Compare sources ignoring blank lines and trailing whitespace. */
function significantLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

export async function testCompletion(scenario: CompletionScenario): Promise<void> {
  await prepareMbt(scenario);
  const path = fileFor(scenario);
  const original = readFileSync(path, "utf8");
  const { replace, prefix, item, expectedText, expectedImport, absentItems } = scenario.completion;
  assert.equal(original.split(replace).length - 1, 1, "Completion replacement must be unique");
  const importLine = expectedImport === undefined ? undefined : `import ${expectedImport};`;
  if (importLine) {
    assert.ok(!original.includes(importLine), `${importLine} is already present`);
  }
  const editor = new TextEditor();
  const driver = VSBrowser.instance.driver;
  try {
    await selectExactText(editor, replace);
    await driver.actions().clear();
    await editor.typeText(prefix);
    const assist = await editor.toggleContentAssist(true);
    await driver.actions().clear();
    assert.ok(assist, "Completion popup did not open");
    let labels: string[] = [];
    const suggestion = await driver.wait(async () => {
      const items = await assist.getItems();
      labels = await Promise.all(items.map((candidate) => candidate.getLabel()));
      const index = labels.findIndex((label) => matchesItem(label, item));
      return index >= 0 ? items[index] : false;
    }, 30_000, `Completion '${item}' did not appear`);
    assert.ok(suggestion);
    const unexpected = absentItems.filter((absent) =>
      labels.some((label) => matchesItem(label, absent)));
    assert.deepEqual(unexpected, [],
      `Completion offered ${unexpected.join(", ")} for '${prefix}'. Visible items: ${JSON.stringify(labels)}`);
    log(`Completion lists ${item}${absentItems.length ? ` without ${absentItems.join(", ")}` : ""}`);
    await captureScreenshot("completion-listed");
    await suggestion.click();
    // Clicking already accepts the item in recent VS Code builds; a second
    // Enter would then insert a newline into the completed source.
    if (await assist.isDisplayed().catch(() => false)) {
      await driver.actions().sendKeys(Key.ENTER).perform();
    }
    const expectedSource = original.replace(replace, expectedText);
    if (importLine) {
      // The import may land anywhere in the import block, but it must be the
      // only other change: the package declaration has to stay intact.
      const expectedLines = significantLines(expectedSource);
      await driver.wait(async () => {
        const lines = significantLines(await editor.getText());
        const index = lines.indexOf(importLine);
        if (index < 0) return false;
        lines.splice(index, 1);
        return lines.join("\n") === expectedLines.join("\n");
      }, 10_000, `Completion did not insert '${expectedText}' together with '${importLine}' only`);
      log(`Completion added ${importLine}`);
    } else {
      await driver.wait(async () => (await editor.getText()) === expectedSource,
        10_000, `Completion did not insert '${expectedText}'`);
    }
    await selectExactText(editor, expectedText);
    await captureScreenshot("completion-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await restoreSource(path, original);
  }
}
