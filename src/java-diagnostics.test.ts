import assert from "node:assert/strict";
import { basename } from "node:path";

import {
  MarkerType,
  TextEditor,
} from "vscode-extension-tester";

import { editorText, openBottomPanel } from "./editor-actions";

import type { JavaDiagnosticsScenario } from "../scripts/config";
import {
  captureScreenshot,
  captureFailure,
  delay,
  fileFor,
  log,
  prepareMbt,
  statusBarTexts,
} from "./test-support";

async function assertNoFileErrors(openFile: string): Promise<void> {
  const panel = await openBottomPanel();
  try {
    const problems = await panel.openProblemsView();
    await problems.setFilter(basename(openFile));
    let messages: string[] | undefined;
    let lastError: unknown;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && messages === undefined) {
      try {
        const files = await problems.getAllVisibleMarkers(MarkerType.File);
        for (const file of files) await file.toggleExpand(true);
        await delay(500);
        const errors = await problems.getAllVisibleMarkers(MarkerType.Error);
        messages = await Promise.all(errors.map((error) => error.getText()));
      } catch (error) {
        lastError = error;
        await delay(500);
      }
    }
    if (!messages) {
      throw new Error(`Problems view did not stabilize: ${String(lastError)}`);
    }
    assert.deepEqual(
      messages,
      [],
      `Expected no errors in ${basename(openFile)}, found:\n${messages.join("\n")}`,
    );
    log(`Verified that ${basename(openFile)} has no error diagnostics`);
    await captureScreenshot("imports-resolved");
  } catch (error) {
    await captureFailure();
    throw error;
  } finally {
    await panel.closePanel().catch(() => undefined);
  }
}

/** Metals shows "no target" in its module status when a file belongs to no build target. */
async function assertBuildTarget(openFile: string): Promise<void> {
  const texts = await statusBarTexts().catch(() => [] as string[]);
  const noTarget = texts.find((text) => /\bno target\b/i.test(text));
  if (noTarget) {
    await captureFailure();
    throw new Error(
      `Metals reports no build target for ${basename(openFile)}: '${noTarget}'. ` +
        `Status bar: ${JSON.stringify(texts)}`,
    );
  }
  log(`Status bar reports a build target for ${basename(openFile)}: ${JSON.stringify(texts)}`);
}

export async function testJavaDiagnostics(
  scenario: JavaDiagnosticsScenario,
): Promise<void> {
  await prepareMbt(scenario);

  const editor = new TextEditor();
  const source = await editorText(editor);
  for (const importedType of scenario.imports) {
    assert.ok(
      source.includes(`import ${importedType};`),
      `Missing expected import: ${importedType}`,
    );
  }

  await editor.selectText(`import ${scenario.imports[0]};`);
  await delay(5_000);
  if (scenario.requireBuildTarget) await assertBuildTarget(fileFor(scenario));
  await assertNoFileErrors(fileFor(scenario));
  log(`Scenario passed: ${scenario.id}`);
}
