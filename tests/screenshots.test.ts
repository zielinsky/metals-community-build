import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync, crc32 } from "node:zlib";
import { ScreenshotRecorder, screenshotDimensions } from "../scripts/screenshots";
import { verifyScreenshots } from "../scripts/verify-screenshots";

function png(width = 800, height = 600): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("screenshots are valid PNGs with independent, sortable scenario numbering", async () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-screenshots-"));
  try {
    const image = png();
    const recorder = new ScreenshotRecorder(directory, async () => image.toString("base64"));
    assert.equal(await recorder.capture("rename", "Symbol selected!"), "rename/001-symbol-selected.png");
    assert.equal(await recorder.capture("rename", "Verified"), "rename/002-verified.png");
    assert.equal(await recorder.capture("hover", "Verified"), "hover/001-verified.png");
    const saved = readFileSync(join(directory, "screenshots/rename/001-symbol-selected.png"));
    assert.deepEqual(saved, image);
    assert.deepEqual(screenshotDimensions(saved), { width: 800, height: 600 });
    await assert.rejects(recorder.capture("../escape", "failure"), /Invalid screenshot scenario/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capture failures propagate and never write bogus evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-screenshots-"));
  try {
    const broken = new ScreenshotRecorder(directory, async () => "not a PNG");
    await assert.rejects(broken.capture("rename", "verified"), /complete PNG/);
    const disconnected = new ScreenshotRecorder(directory, async () => { throw new Error("disconnected"); });
    await assert.rejects(disconnected.capture("rename", "verified"), /disconnected/);
    assert.deepEqual(readdirSync(directory), []);
    assert.throws(() => screenshotDimensions(png(1, 1)), /too small/);
    assert.throws(() => screenshotDimensions(png().subarray(0, 40)), /complete PNG/);
    const corrupt = png();
    corrupt[45] ^= 1;
    assert.throws(() => screenshotDimensions(corrupt), /Corrupt PNG/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a passing result needs a screenshot of the verified action, not just the open file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "metals-evidence-"));
  try {
    writeFileSync(join(directory, "result.json"), JSON.stringify({
      scenarios: [{ id: "hover", kind: "hover", status: "passed" }],
    }));
    const recorder = new ScreenshotRecorder(directory, async () => png().toString("base64"));
    await recorder.capture("hover", "file-opened");
    assert.throws(() => verifyScreenshots(directory), /missing screenshot for hover-verified/);
    await recorder.capture("hover", "hover-verified");
    assert.equal(verifyScreenshots(directory), 2);
    writeFileSync(join(directory, "screenshots/hover/002-hover-verified.png"), "broken");
    assert.throws(() => verifyScreenshots(directory), /complete PNG/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
