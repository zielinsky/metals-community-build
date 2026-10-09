import { By, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

import type { HierarchyDirection, TypeHierarchyScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, log, prepareMbt } from "./test-support";
import { closePeeks, placeCursorInside, visibleTexts } from "./editor-actions";

async function peekWidget(): Promise<WebElement | undefined> {
  for (const widget of await VSBrowser.instance.driver.findElements(By.css(".type-hierarchy"))) {
    if (await widget.isDisplayed().catch(() => false)) return widget;
  }
  return undefined;
}

async function peekTitle(): Promise<string> {
  const [title = ""] = await visibleTexts(".peekview-title").catch(() => [""]);
  return title;
}

async function peekMessage(): Promise<string> {
  const widget = await peekWidget();
  if (!widget) return "";
  const [message = ""] = await visibleTexts(".message", widget).catch(() => [""]);
  return message;
}

/**
 * The direction the peek currently shows. With results the title reads
 * "Subtypes of 'X'"; without results VS Code clears the title and shows
 * "No subtypes of 'X'" instead, which still tells the direction.
 */
async function currentDirection(): Promise<HierarchyDirection | undefined> {
  const text = `${await peekTitle()} ${await peekMessage()}`;
  const match = /^(?:no )?(sub|super)types of/i.exec(text.trim());
  if (!match) return undefined;
  return match[1].toLowerCase() === "sub" ? "subtypes" : "supertypes";
}

/**
 * Opens the peek and waits until it reports a direction. Right after the
 * import the presentation compiler can still be warming up and VS Code shows
 * a generic message; the peek is then closed and opened again.
 */
async function openHierarchy(symbol: string, deadline: number): Promise<void> {
  const driver = VSBrowser.instance.driver;
  let attempt = 0;
  while (true) {
    attempt += 1;
    await new Workbench().executeCommand("Peek Type Hierarchy");
    const outcome = await driver.wait(async () => {
      if (await currentDirection()) return "hierarchy";
      const message = await peekMessage();
      return message ? `message: ${message}` : false;
    }, 30_000).catch(() => "timeout" as const);
    if (outcome === "hierarchy") return;
    log(`Type hierarchy of '${symbol}' is not available yet (${outcome}, attempt ${attempt})`);
    if (Date.now() > deadline - 10_000) {
      throw new Error(`Type hierarchy peek did not show a hierarchy for '${symbol}': ${outcome}`);
    }
    await closePeeks();
    await driver.sleep(3_000);
  }
}

/**
 * The peek remembers the last direction, so it may already show the wanted
 * one; otherwise the single toggle action in the title bar flips it and
 * VS Code reloads the hierarchy in the other direction.
 */
async function selectDirection(direction: HierarchyDirection): Promise<void> {
  const driver = VSBrowser.instance.driver;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await currentDirection();
    if (current === direction) {
      log(`Type hierarchy shows ${direction}: ${await peekTitle()}${await peekMessage()}`);
      return;
    }
    log(`Switching the type hierarchy from ${current ?? "unknown"} to ${direction}`);
    for (const action of await driver.findElements(By.css(".peekview-actions .action-label"))) {
      if (!(await action.isDisplayed().catch(() => false))) continue;
      const label = [
        await action.getAttribute("aria-label").catch(() => ""),
        await action.getAttribute("title").catch(() => ""),
        await action.getAttribute("class").catch(() => ""),
      ].join(" ");
      if (/show (sub|super)types|type-hierarchy-(sub|super)\b/i.test(label)) {
        await action.click();
        break;
      }
    }
    await driver.wait(async () => (await currentDirection()) === direction, 10_000)
      .catch(() => undefined);
  }
  throw new Error(
    `Could not switch the type hierarchy to ${direction}; title: '${await peekTitle()}', message: '${await peekMessage()}'`,
  );
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
    await openHierarchy(scenario.symbol, Date.now() + 90_000);
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
