import { BottomBarPanel, By, TextEditor, VSBrowser } from "vscode-extension-tester";
import type { WebElement } from "selenium-webdriver";

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

export async function waitForTestGutter(testName: string, timeoutMs: number): Promise<WebElement> {
  await new TextEditor().selectText(testName);
  const glyph = await VSBrowser.instance.driver.wait(
    async () => (await findTestGutter(testName).catch(() => undefined)) || false,
    timeoutMs,
    `Test gutter did not appear for '${testName}'`,
  );
  if (!glyph) throw new Error(`Missing test gutter: ${testName}`);
  return glyph;
}
