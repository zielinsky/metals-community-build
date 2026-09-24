import assert from "node:assert/strict";
import { test } from "node:test";
import { retryWithReopen } from "../src/retry-with-reopen";

test("a failed reopen is retried before looking for the icon again", async () => {
  let opens = 0;
  const editors: string[] = [];
  const failures: number[] = [];
  const result = await retryWithReopen({
    current: () => "initial",
    reopen: async () => {
      if (++opens === 1) throw new Error("JsonTest.java did not reopen");
      return `reopened-${opens}`;
    },
    action: async (editor) => {
      editors.push(editor);
      if (editor === "initial" || editor === "reopened-2") throw new Error("No icon");
      return "discovered";
    },
    attempts: 6,
    onFailure: (attempt) => { failures.push(attempt); },
  });
  assert.equal(result, "discovered");
  assert.deepEqual(editors, ["initial", "reopened-2", "reopened-3"]);
  assert.deepEqual(failures, [1, 2, 3]);
});

test("repeated reopen failures stop at the limit and preserve the final error", async () => {
  let opens = 0;
  const lastError = new Error("File is still unavailable");
  await assert.rejects(retryWithReopen({
    current: () => "initial",
    reopen: async () => { opens += 1; throw lastError; },
    action: async () => { throw new Error("No icon"); },
    attempts: 6,
    onFailure: () => {},
  }), (error) => error === lastError);
  assert.equal(opens, 5);
});

test("an available test icon needs no reopen", async () => {
  assert.equal(await retryWithReopen({
    current: () => "initial",
    reopen: async () => { assert.fail("Unexpected reopen"); },
    action: async (editor) => editor,
    attempts: 6,
    onFailure: () => { assert.fail("Unexpected failure"); },
  }), "initial");
});
