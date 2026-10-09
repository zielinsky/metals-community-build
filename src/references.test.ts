import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { By, Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

import type { DocumentHighlightScenario, ReferencesScenario } from "../scripts/config";
import { captureFailure, captureScreenshot, delay, log, prepareMbt } from "./test-support";
import { clickSymbol, closePeeks, placeCursorInside, visibleTexts } from "./editor-actions";

interface PeekState {
  total: number;
  rows: string[];
  title: string;
  message: string;
}

/**
 * VS Code's peek shows "References (N)" in the title, a count badge on every
 * file row when the results span several files, and one `.referenceMatch` row
 * per reference otherwise. The title is authoritative; the rows only have to
 * name the expected files.
 */
async function readPeek(widget: WebElement): Promise<PeekState> {
  const [title] = await visibleTexts(".peekview-title", widget);
  const rows = await visibleTexts(".ref-tree .monaco-list-row", widget);
  const [message] = await visibleTexts(".messages", widget);
  const titled = /\((\d+)\)/.exec(title ?? "");
  let total = titled ? Number(titled[1]) : 0;
  if (!titled) {
    const badges = await visibleTexts(".ref-tree .monaco-count-badge", widget);
    total = badges.length
      ? badges.reduce((sum, badge) => sum + (Number.parseInt(badge, 10) || 0), 0)
      : (await widget.findElements(By.css(".ref-tree .referenceMatch"))).length;
  }
  return { total, rows, title: title ?? "", message: message ?? "" };
}

/**
 * The peek tree is virtualized, so only the rows near the top exist in the
 * DOM. Page through the tree with the keyboard and collect every row seen.
 */
async function collectRows(widget: WebElement): Promise<string[]> {
  const driver = VSBrowser.instance.driver;
  const seen = new Set<string>(await visibleTexts(".ref-tree .monaco-list-row", widget));
  const lists = await widget.findElements(By.css(".ref-tree .monaco-list"));
  if (lists.length === 0) return [...seen];
  let unchanged = 0;
  for (let page = 0; page < 60 && unchanged < 2; page += 1) {
    await lists[0].sendKeys(Key.PAGE_DOWN).catch(() => undefined);
    await driver.sleep(150);
    const before = seen.size;
    for (const row of await visibleTexts(".ref-tree .monaco-list-row", widget)) seen.add(row);
    unchanged = seen.size === before ? unchanged + 1 : 0;
  }
  await lists[0].sendKeys(Key.HOME).catch(() => undefined);
  return [...seen];
}

function mentionsFile(texts: string[], file: string): boolean {
  const name = basename(file);
  const directory = dirname(file);
  return texts.some((text) =>
    text.includes(name) && (directory === "." || text.includes(directory)));
}

export async function testFindReferences(scenario: ReferencesScenario): Promise<void> {
  await prepareMbt(scenario);
  const editor = new TextEditor();
  const driver = VSBrowser.instance.driver;
  await placeCursorInside(editor, scenario.symbol, scenario.near);
  await captureScreenshot("references-symbol-selected");
  log(`Peek References: ${scenario.symbol}`);
  let state: PeekState = { total: 0, rows: [], title: "", message: "" };
  try {
    await new Workbench().executeCommand("Peek References");
    await driver.wait(async () => {
      const widgets = await driver.findElements(By.css(".reference-zone-widget"));
      for (const widget of widgets) {
        if (!(await widget.isDisplayed().catch(() => false))) continue;
        state = await readPeek(widget).catch(() => state);
        if (state.total < scenario.references.minimumCount) return false;
        const missing = (texts: string[]) =>
          scenario.references.files.filter((file) => !mentionsFile(texts, file));
        if (missing([state.title, ...state.rows]).length === 0) return true;
        state = { ...state, rows: await collectRows(widget).catch(() => state.rows) };
        return missing([state.title, ...state.rows]).length === 0;
      }
      return false;
    }, 60_000, "References did not match").catch(() => {
      const missing = scenario.references.files.filter(
        (file) => !mentionsFile([state.title, ...state.rows], file));
      throw new Error(
        `Expected at least ${scenario.references.minimumCount} references to ` +
          `'${scenario.symbol}'${missing.length ? ` in ${missing.join(", ")}` : ""}, ` +
          `found ${state.total}. Peek title: '${state.title}'. ` +
          `${state.message ? `Message: '${state.message}'. ` : ""}` +
          `Rows: ${JSON.stringify(state.rows)}`,
      );
    });
    log(`Found ${state.total} references to ${scenario.symbol}: ${state.title}`);
    await captureScreenshot("references-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await closePeeks();
  }
}

/**
 * Highlights from a document highlight provider render as `wordHighlight`
 * (read) and `wordHighlightStrong` (write) decorations; VS Code's textual
 * fallback uses `wordHighlightText` and is not counted. Only decorations in
 * the visible viewport exist in the DOM. The decoration elements carry no
 * height of their own, so Selenium's visibility check cannot be used.
 */
async function countHighlights(editor: TextEditor): Promise<{ semantic: number; textual: number }> {
  let semantic = 0;
  let textual = 0;
  for (const element of await editor.findElements(
    By.css(".view-overlays .wordHighlight, .view-overlays .wordHighlightStrong, .view-overlays .wordHighlightText"),
  )) {
    const classes = (await element.getAttribute("class").catch(() => "")) ?? "";
    const style = (await element.getAttribute("style").catch(() => "")) ?? "";
    if (!/width:\s*[1-9]/.test(style)) continue;
    if (/\bwordHighlightText\b/.test(classes)) textual += 1;
    else semantic += 1;
  }
  return { semantic, textual };
}

export async function testDocumentHighlight(scenario: DocumentHighlightScenario): Promise<void> {
  await prepareMbt(scenario);
  const editor = new TextEditor();
  const expected = scenario.highlight.expectedOccurrences;
  await closePeeks();
  log(`Waiting for ${expected} document highlights of ${scenario.symbol}`);
  let counts = { semantic: 0, textual: 0 };
  const deadline = Date.now() + 60_000;
  try {
    // VS Code drops the highlights as soon as the editor loses focus, so the
    // click that requests them is repeated until they are observed.
    while (Date.now() < deadline && counts.semantic !== expected) {
      await clickSymbol(editor, scenario.symbol, scenario.near);
      const attempt = Date.now() + 5_000;
      while (Date.now() < attempt) {
        counts = await countHighlights(editor).catch(() => counts);
        if (counts.semantic === expected) break;
        await delay(250);
      }
    }
    if (counts.semantic !== expected) {
      throw new Error(
        `Expected ${expected} highlighted occurrences of '${scenario.symbol}', ` +
          `found ${counts.semantic} from the language server and ${counts.textual} textual`,
      );
    }
    log(`Verified ${counts.semantic} highlighted occurrences of ${scenario.symbol}`);
    await captureScreenshot("document-highlight-verified");
  } catch (error) {
    await captureFailure();
    throw error;
  }
}
