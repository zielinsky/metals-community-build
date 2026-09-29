import { BottomBarPanel, By, Key, TextEditor, VSBrowser } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";
import { sourceSelection } from "../scripts/editor-text";

export async function selectExactText(editor: TextEditor, text: string): Promise<void> {
  const [line, column] = sourceSelection(await editor.getText(), text);
  await editor.setCursor(line, column);
  const actions = VSBrowser.instance.driver.actions();
  await actions.clear();
  actions.keyDown(Key.SHIFT);
  for (let i = 0; i < text.length; i += 1) actions.sendKeys(Key.ARROW_RIGHT);
  await actions.keyUp(Key.SHIFT).perform();
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
