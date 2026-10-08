import { By, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

import type { HierarchyDirection, TypeHierarchyScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, delay, log, prepareMbt } from "./test-support";
import { closePeeks, placeCursorInside, visibleTexts } from "./editor-actions";

// The title bar actions are icon-only; match their label or their codicon.
const directionLabels: Record<HierarchyDirection, RegExp> = {
  subtypes: /show subtypes|type-hierarchy-sub\b/i,
  supertypes: /show supertypes|type-hierarchy-super\b/i,
};

async function peekWidget(): Promise<WebElement | undefined> {
  for (const widget of await VSBrowser.instance.driver.findElements(By.css(".type-hierarchy"))) {
    if (await widget.isDisplayed().catch(() => false)) return widget;
  }
  return undefined;
}

/**
 * The peek remembers the last direction, so the title bar offers the opposite
 * one: clicking "Show Supertypes" exists only while subtypes are shown.
 */
async function selectDirection(direction: HierarchyDirection): Promise<void> {
  const driver = VSBrowser.instance.driver;
  const wanted = directionLabels[direction];
  const actions = await driver.findElements(By.css(".peekview-actions .action-label"));
  for (const action of actions) {
    if (!(await action.isDisplayed().catch(() => false))) continue;
    const label = [
      await action.getAttribute("aria-label").catch(() => ""),
      await action.getAttribute("title").catch(() => ""),
      await action.getAttribute("class").catch(() => ""),
    ].join(" ");
    if (wanted.test(label)) {
      log(`Switching the type hierarchy to ${direction}`);
      await action.click();
      await delay(500);
      return;
    }
  }
  log(`Type hierarchy already shows ${direction}`);
}

function listsType(rows: string[], name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\w$])${escaped}($|[^\\w$])`);
  return rows.some((row) => pattern.test(row));
}

export async function testTypeHierarchy(scenario: TypeHierarchyScenario): Promise<void> {
  await prepareMbt(scenario);
  const editor = new TextEditor();
  const driver = VSBrowser.instance.driver;
  const { direction, expected } = scenario.hierarchy;
  await placeCursorInside(editor, scenario.symbol, scenario.near);
  await captureScreenshot("type-hierarchy-symbol-selected");
  log(`Peek Type Hierarchy (${direction}): ${scenario.symbol}`);
  let rows: string[] = [];
  let message = "";
  try {
    await new Workbench().executeCommand("Peek Type Hierarchy");
    const widget = await driver.wait(
      async () => (await peekWidget()) ?? false,
      30_000,
      `Type hierarchy peek did not open for '${scenario.symbol}'`,
    );
    if (!widget) throw new Error("Type hierarchy peek is not visible");
    await selectDirection(direction);
    await driver.wait(async () => {
      const current = await peekWidget();
      if (!current) return false;
      rows = await visibleTexts(".results .monaco-list-row", current).catch(() => rows);
      [message = ""] = await visibleTexts(".message", current).catch(() => [message]);
      return expected.every((name) => listsType(rows, name));
    }, 60_000, "Type hierarchy did not list the expected types").catch(() => {
      const missing = expected.filter((name) => !listsType(rows, name));
      throw new Error(
        `Type hierarchy (${direction}) of '${scenario.symbol}' did not list ${missing.join(", ")}. ` +
          `${message ? `Message: '${message}'. ` : ""}Rows: ${JSON.stringify(rows)}`,
      );
    });
    log(`Type hierarchy lists ${expected.join(", ")}: ${JSON.stringify(rows)}`);
    await captureScreenshot("type-hierarchy-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await closePeeks();
  }
}
