import assert from "node:assert/strict";
import { basename } from "node:path";

import {
  BottomBarPanel,
  By,
  DebugToolbar,
  EditorView,
  Key,
  TextEditor,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

import type { JavaDebugTestScenario } from "../scripts/config";
import {
  captureScreenshot,
  delay,
  fileFor,
  log,
  prepareMbt,
} from "./test-support";

interface PositionedElement {
  element: WebElement;
  distance: number;
}

async function reopenScenarioFile(
  scenario: JavaDebugTestScenario,
): Promise<TextEditor> {
  const title = basename(scenario.openFile);
  log(`Closing and reopening ${title} to refresh test code lenses`);
  const view = new EditorView();
  await new Workbench().executeCommand("View: Close Editor");
  await VSBrowser.instance.driver.wait(async () => {
    const titles: string[] = await view
      .getOpenEditorTitles()
      .catch(() => [title]);
    return !titles.includes(title);
  }, 10_000, `${title} did not close`);
  await VSBrowser.instance.openResources(fileFor(scenario));
  await VSBrowser.instance.driver.wait(async () => {
    const titles: string[] = await view.getOpenEditorTitles().catch(() => []);
    return titles.includes(title);
  }, 10_000, `${title} did not reopen`);
  const editor = new TextEditor();
  await VSBrowser.instance.driver.wait(
    async () => (await editor.getText().catch(() => "")).includes(scenario.testName),
    30_000,
    `${title} reopened without '${scenario.testName}'`,
  );
  await editor.selectText(scenario.testName);
  await captureScreenshot("file-reopened");
  return editor;
}

async function launchDebugWithRecovery(
  initialEditor: TextEditor,
  scenario: JavaDebugTestScenario,
): Promise<TextEditor> {
  let editor = initialEditor;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const glyph = await waitForTestGutter(editor, scenario.testName, 20_000);
      await openDebugTest(glyph, scenario.testName);
      return editor;
    } catch (error) {
      lastError = error;
      if (attempt < 5) editor = await reopenScenarioFile(scenario);
    }
  }
  throw lastError;
}

async function visibleTestLineY(testName: string): Promise<number | undefined> {
  const driver = VSBrowser.instance.driver;
  const lines = await driver.findElements(
    By.css(".monaco-editor .view-lines .view-line"),
  );
  for (const line of lines) {
    const displayed = await line.isDisplayed().catch(() => false);
    const text = await line.getText().catch(() => "");
    if (displayed && text.includes(testName)) {
      return (await line.getRect()).y;
    }
  }
  return undefined;
}

async function findTestGutter(testName: string): Promise<WebElement | undefined> {
  const testLineY = await visibleTestLineY(testName);
  const glyphs = await VSBrowser.instance.driver.findElements(
    By.css(".monaco-editor .testing-run-glyph"),
  );
  const positioned: PositionedElement[] = [];
  for (const glyph of glyphs) {
    if (!(await glyph.isDisplayed().catch(() => false))) continue;
    const rect = await glyph.getRect();
    positioned.push({
      element: glyph,
      distance:
        testLineY === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(rect.y - testLineY),
    });
  }
  positioned.sort((left, right) => left.distance - right.distance);
  return positioned[0]?.element;
}

async function waitForTestGutter(
  editor: TextEditor,
  testName: string,
  timeoutMs: number,
): Promise<WebElement> {
  const deadline = Date.now() + timeoutMs;
  await editor.selectText(testName);

  while (Date.now() < deadline) {
    try {
      const glyph = await findTestGutter(testName);
      if (glyph) return glyph;
    } catch {
      // Gutter decorations and editor lines are replaced while Metals refreshes them.
    }
    await delay(500);
  }

  throw new Error(`Test gutter did not appear for '${testName}'`);
}

async function visibleMenuItems(): Promise<WebElement[]> {
  const items = await VSBrowser.instance.driver.findElements(
    By.css(".monaco-menu-container .action-item"),
  );
  const visible: WebElement[] = [];
  for (const item of items) {
    if (await item.isDisplayed().catch(() => false)) visible.push(item);
  }
  return visible;
}

async function focusedMenuItemLabel(): Promise<string | undefined> {
  const active = await VSBrowser.instance.driver.switchTo().activeElement();
  const klass = (await active.getAttribute("class").catch(() => "")) ?? "";
  if (!klass.includes("action-menu-item")) return undefined;
  const text = (await active.getText().catch(() => "")).trim();
  const label = ((await active.getAttribute("aria-label").catch(() => "")) ?? "")
    .trim();
  return text || label || undefined;
}

async function openDebugTest(glyph: WebElement, testName: string): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.actions().contextClick(glyph).perform();
  await driver.wait(
    async () => (await visibleMenuItems()).length > 0,
    10_000,
    `Test gutter context menu did not open for '${testName}'`,
  );

  // Clicking a menu item with the mouse does not activate it in this VS Code
  // build, so walk the menu with the keyboard and confirm what is focused.
  const seen: string[] = [];
  for (let step = 0; step < 20; step += 1) {
    const focused = await focusedMenuItemLabel();
    if (focused) {
      if (/debug test/i.test(focused)) {
        log(`Launching debug test from gutter: ${testName}`);
        await driver.actions().sendKeys(Key.ENTER).perform();
        await driver.wait(
          async () => (await visibleMenuItems()).length === 0,
          10_000,
          `Context menu stayed open after selecting '${focused}'`,
        );
        return;
      }
      if (seen.includes(focused)) break;
      seen.push(focused);
    }
    await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
    await delay(100);
  }

  await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
  throw new Error(
    `Could not select 'Debug Test' for '${testName}'. ` +
      `Focused menu items: ${JSON.stringify(seen)}`,
  );
}

async function waitForPausedLine(
  editor: TextEditor,
  expectedLine: number,
  timeoutMs: number,
): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.wait(async () => {
    try {
      const breakpoint = await editor.getPausedBreakpoint();
      return breakpoint !== undefined &&
        (await breakpoint.getLineNumber()) === expectedLine;
    } catch {
      return false;
    }
  }, timeoutMs, `Debugger did not stop at line ${expectedLine}`);
}

// The debug console is a virtualized list, so only the last lines of the test
// run are readable. The result has to be recognized from the summary Metals
// prints when the run ends ("1 tests, 1 passed", "All tests in <suite> passed"),
// not from the name of the test itself. Metals only prints metrics that are
// greater than zero, so a count in front of the metric is enough to tell a
// passing run from a failing one.
const testFinished = [
  /all tests in .+ passed/i,
  /\b[1-9]\d* (?:tests? |suites? )?passed\b/i,
];
const testFailed = [
  /\b[1-9]\d* (?:failed|errors?|canceled)\b/i,
  /^Failed:$/m,
  /exception in thread/i,
];

// VS Code renders the run result directly on the gutter glyph it already
// used to launch the test, by adding a `codicon-testing-passed-icon` /
// `codicon-testing-failed-icon` class to the same `.testing-run-glyph`
// element (see workbench glyphMarginClassName rendering). That update lands
// as soon as the test run completes, well before (and independently of)
// whatever text eventually scrolls into the virtualized debug console, so it
// is checked first on every poll.
const passedIconClass = /codicon-testing-passed-icon/;
const failedIconClass = /codicon-testing-failed-icon|codicon-testing-error-icon/;

async function waitForSuccessfulTest(
  testName: string,
  timeoutMs: number,
): Promise<void> {
  const console = await new BottomBarPanel().openDebugConsoleView();
  const deadline = Date.now() + timeoutMs;
  let output = "";

  while (Date.now() < deadline) {
    const glyph = await findTestGutter(testName).catch(() => undefined);
    const glyphClass = (await glyph?.getAttribute("class").catch(() => "")) ?? "";
    output = await console.getText().catch(() => output);

    if (passedIconClass.test(glyphClass)) {
      log(`Test gutter icon reports a passed result for '${testName}'`);
      return;
    }
    if (failedIconClass.test(glyphClass) || testFailed.some((pattern) => pattern.test(output))) {
      break;
    }
    const finished = testFinished.find((pattern) => pattern.test(output));
    if (finished) {
      log(`Debug console reports a passed test run: ${finished}`);
      return;
    }
    await delay(500);
  }

  await captureScreenshot("debug-console-without-result");
  throw new Error(
    `Debug session ended without a successful result for '${testName}'.\n` +
      `Debug console:\n${output.split("\n").slice(-100).join("\n")}`,
  );
}

export async function testJavaDebug(
  scenario: JavaDebugTestScenario,
): Promise<void> {
  await prepareMbt(scenario);

  let editor = new TextEditor();
  const source = await editor.getText();
  assert.ok(source.includes(scenario.testName), `Missing test: ${scenario.testName}`);
  const sourceLines = source.split(/\r?\n/);
  assert.ok(
    scenario.breakpoint.line <= sourceLines.length,
    `Breakpoint line ${scenario.breakpoint.line} is outside the source file`,
  );
  assert.ok(
    sourceLines[scenario.breakpoint.line - 1].trim().length > 0,
    `Breakpoint line ${scenario.breakpoint.line} is empty`,
  );

  await editor.setCursor(scenario.breakpoint.line, 1);
  const added = await editor.toggleBreakpoint(scenario.breakpoint.line);
  assert.ok(added, `Could not add breakpoint at line ${scenario.breakpoint.line}`);
  log(`Added breakpoint at line ${scenario.breakpoint.line}`);
  await captureScreenshot("breakpoint-added");

  let toolbar: DebugToolbar | undefined;
  try {
    editor = await launchDebugWithRecovery(editor, scenario);

    toolbar = await DebugToolbar.create(15 * 60 * 1000);
    await toolbar.waitForBreakPoint(10 * 60 * 1000);
    await waitForPausedLine(editor, scenario.breakpoint.line, 30_000);
    log(`Debugger stopped at line ${scenario.breakpoint.line}`);
    await captureScreenshot("breakpoint-hit");

    await toolbar.continue();
    log("Continued the debug session");

    // The gutter icon and debug console already report the result as soon as
    // the forked test process finishes, but the debug toolbar can keep
    // showing (its element does not go stale) well after that — waiting on
    // toolbar staleness first, before checking the result, blocks the
    // scenario long after the test has actually finished. Poll the result
    // directly and let the `finally` block deal with stopping whatever
    // toolbar state is left behind.
    await waitForSuccessfulTest(scenario.testName, 60_000);
    log(`Debug test finished successfully: ${scenario.testName}`);
    await captureScreenshot("debug-test-finished");
  } finally {
    if (toolbar) await toolbar.stop().catch(() => undefined);
    const breakpoint = await editor
      .getBreakpoint(scenario.breakpoint.line)
      .catch(() => undefined);
    if (breakpoint) await breakpoint.remove().catch(() => undefined);
  }

  log(`Scenario passed: ${scenario.id}`);
}
