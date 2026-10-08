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

export async function selectExactText(editor: TextEditor, text: string, near?: string): Promise<void> {
  const [line, column] = sourceSelection(await editorText(editor), text, near);
  await editor.setCursor(line, column);
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
  await editor.setCursor(line, column + 1);
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
  await editor.setCursor(line, column + 1);
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

export async function waitForTestGutter(testName: string, timeoutMs = 120_000): Promise<WebElement> {
  await new TextEditor().selectText(testName);
  const glyph = await VSBrowser.instance.driver.wait(
    async () => (await findTestGutter(testName).catch(() => undefined)) || false,
    timeoutMs,
    `Test gutter did not appear for '${testName}'`,
  );
  if (!glyph) throw new Error(`Missing test gutter: ${testName}`);
  return glyph;
}
