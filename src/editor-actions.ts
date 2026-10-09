import { writeFileSync } from "node:fs";
import { BottomBarPanel, By, Key, TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";
import { sourceSelection } from "../scripts/editor-text";

/**
 * ExTester reads the editor through the clipboard and accepts any non-empty
 * clipboard as the copied text, so a read can return the previous clipboard
 * content. Re-read until two consecutive reads agree.
 */
export async function editorText(editor: TextEditor): Promise<string> {
  let previous = await editor.getText();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await editor.getText();
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

/**
 * Moves the caret with "Go to Line/Column". ExTester's setCursor() verifies
 * the column against the status bar, which shows the visual column, so it
 * never settles in files indented with tabs; only the line is verified here.
 */
export async function setCaret(editor: TextEditor, line: number, column: number): Promise<void> {
  const driver = VSBrowser.instance.driver;
  const prompt = await new Workbench().openCommandPrompt();
  await driver.actions().clear();
  try {
    await prompt.setText(`:${line},${column}`);
    await driver.wait(async () => (await prompt.getQuickPicks().catch(() => [])).length > 0, 5_000)
      .catch(() => undefined);
    await prompt.confirm();
  } finally {
    await driver.actions().clear();
  }
  await driver.wait(async () => {
    try {
      return (await editor.getCoordinates())[0] === line;
    } catch {
      return false;
    }
  }, 10_000, `Could not move the caret to line ${line}`);
}

export async function selectExactText(editor: TextEditor, text: string, near?: string): Promise<void> {
  const [line, column] = sourceSelection(await editorText(editor), text, near);
  await setCaret(editor, line, column);
  const actions = VSBrowser.instance.driver.actions();
  await actions.clear();
  actions.keyDown(Key.SHIFT);
  for (let i = 0; i < text.length; i += 1) actions.sendKeys(Key.ARROW_RIGHT);
  await actions.keyUp(Key.SHIFT).perform();
}

/**
 * Clicks `text` in the rendered editor. A real mouse click focuses the editor
 * and moves the caret with an explicit cursor event, which is what features
 * such as document highlight react to. Falls back to the caret placement when
 * the token is not rendered as its own span.
 */
export async function clickSymbol(editor: TextEditor, text: string, near?: string): Promise<void> {
  const source = await editorText(editor);
  const [line, column] = sourceSelection(source, text, near);
  await setCaret(editor, line, column + 1);
  const expectedLine = source.split(/\r?\n/)[line - 1].replace(/\s+/g, " ").trim();
  for (const viewLine of await editor.findElements(By.css(".view-lines .view-line"))) {
    if (!(await viewLine.isDisplayed().catch(() => false))) continue;
    const [lineText = ""] = await visibleTexts(":scope", viewLine).catch(() => [""]);
    if (lineText !== expectedLine) continue;
    for (const span of await viewLine.findElements(By.css("span"))) {
      if ((await span.getText().catch(() => "")).trim() === text) {
        await span.click();
        return;
      }
    }
  }
  await VSBrowser.instance.driver.actions().sendKeys(Key.ARROW_LEFT, Key.ARROW_RIGHT).perform();
}

/** Put the caret inside the first character of `text` without selecting anything. */
export async function placeCursorInside(editor: TextEditor, text: string, near?: string): Promise<void> {
  const [line, column] = sourceSelection(await editorText(editor), text, near);
  await setCaret(editor, line, column + 1);
}

/**
 * Puts the original source back on disk and in the editor. Open popups are
 * dismissed first, and a failing revert is logged instead of replacing the
 * scenario's own error.
 */
export async function restoreSource(path: string, original: string): Promise<void> {
  const driver = VSBrowser.instance.driver;
  for (let i = 0; i < 2; i += 1) {
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
  }
  writeFileSync(path, original);
  try {
    await new Workbench().executeCommand("File: Revert File");
  } catch (error) {
    console.log(`[community-build] Could not revert the editor after restoring ${path}: ${String(error)}`);
  }
}

export async function openBottomPanel(): Promise<BottomBarPanel> {
  const panel = new BottomBarPanel();
  try {
    // ExTester's toggle(true) presses Ctrl/Cmd+J without releasing the modifier.
    await panel.toggle(true);
  } finally {
    await VSBrowser.instance.driver.actions().clear();
  }
  return panel;
}

/**
 * Texts of the displayed elements matching `selector`. Adjacent inline spans
 * such as a tree row's label and description are joined with a space (plain
 * getText() would return "Greeterexample"), and whitespace is collapsed.
 */
export async function visibleTexts(selector: string, root?: WebElement): Promise<string[]> {
  const driver = VSBrowser.instance.driver;
  const scope = root ?? driver;
  const elements = await scope.findElements(By.css(selector));
  const texts: string[] = [];
  for (const element of elements) {
    if (!(await element.isDisplayed().catch(() => false))) continue;
    const text = await driver.executeScript<string>(
      `const leaves = [];
       const walk = (node) => {
         if (node.nodeType === Node.TEXT_NODE) leaves.push(node.textContent);
         else if (node.nodeType === Node.ELEMENT_NODE) node.childNodes.forEach(walk);
       };
       walk(arguments[0]);
       return leaves.join(" ");`,
      element,
    ).catch(() => "");
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed) texts.push(collapsed);
  }
  return texts;
}

/**
 * Closes every open peek (references, type hierarchy). Escape only works
 * while the peek has focus, so its own close action is clicked first.
 */
export async function closePeeks(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const widgets: WebElement[] = [];
    for (const widget of await driver.findElements(By.css(".peekview-widget"))) {
      if (await widget.isDisplayed().catch(() => false)) widgets.push(widget);
    }
    if (widgets.length === 0) return;
    for (const widget of widgets) {
      const closes = await widget.findElements(By.css(".peekview-actions .codicon-close"));
      if (closes.length > 0) {
        await closes[0].click().catch(() => undefined);
      } else {
        await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
      }
    }
    await new Promise((done) => setTimeout(done, 300));
  }
}

/** Match the test's own line; never fall back to another test's gutter. */
export async function findTestGutter(testName: string): Promise<WebElement | undefined> {
  const editor = new TextEditor();
  const lines = await editor.findElements(By.css(".view-lines .view-line"));
  for (const line of lines) {
    if (!(await line.isDisplayed()) || !(await line.getText()).includes(testName)) continue;
    const rect = await line.getRect();
    const glyphs = await editor.findElements(By.css(".testing-run-glyph"));
    for (const glyph of glyphs) {
      if (!(await glyph.isDisplayed())) continue;
      const glyphRect = await glyph.getRect();
      if (Math.abs(glyphRect.y - rect.y) <= Math.max(2, rect.height / 2)) return glyph;
    }
  }
  return undefined;
}

/**
 * Waits for the run gutter of `testName`. VS Code resolves test items lazily
 * in some sessions, so when nothing shows up within the first 30 s the Test
 * Explorer view is opened once, which is what a user would do, and the editor
 * is focused again.
 */
export async function waitForTestGutter(
  testName: string,
  reopenFile?: () => Promise<void>,
  timeoutMs = 120_000,
): Promise<WebElement> {
  await new TextEditor().selectText(testName);
  const started = Date.now();
  const deadline = started + timeoutMs;
  let openedExplorer = false;
  let reopened = false;
  while (Date.now() < deadline) {
    const glyph = await findTestGutter(testName).catch(() => undefined);
    if (glyph) {
      if (reopened) {
        console.log(`[community-build] WARNING: test '${testName}' was discovered only after reopening the file`);
      }
      return glyph;
    }
    const elapsed = Date.now() - started;
    if (!openedExplorer && elapsed > 30_000) {
      openedExplorer = true;
      console.log(`[community-build] Opening the Test Explorer to trigger discovery of '${testName}'`);
      await new Workbench().executeCommand("Testing: Focus on Test Explorer View").catch(() => undefined);
      await new Promise((done) => setTimeout(done, 2_000));
      await new Workbench().executeCommand("View: Focus Active Editor Group").catch(() => undefined);
      await new TextEditor().selectText(testName).catch(() => undefined);
    } else if (!reopened && reopenFile && elapsed > 60_000) {
      // Metals computes test cases when a file gains focus; when that happened
      // before indexing finished, nothing recomputes them until the next
      // focus. Reopening the file is the last resort and is reported above.
      reopened = true;
      console.log(`[community-build] Reopening the file to trigger discovery of '${testName}'`);
      await reopenFile().catch((error: unknown) =>
        console.log(`[community-build] Could not reopen the file: ${String(error)}`));
      await new TextEditor().selectText(testName).catch(() => undefined);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Test gutter did not appear for '${testName}'`);
}
