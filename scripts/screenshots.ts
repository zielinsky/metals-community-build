import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32 } from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function screenshotDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < 45 || !png.subarray(0, 8).equals(pngSignature) ||
    png.toString("ascii", 12, 16) !== "IHDR" ||
    png.toString("ascii", png.length - 8, png.length - 4) !== "IEND"
  ) {
    throw new Error("Screenshot is not a complete PNG");
  }
  let offset = 8;
  let hasImageData = false;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("Truncated PNG chunk");
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error("Truncated PNG chunk");
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) {
      throw new Error(`Corrupt PNG ${type} chunk`);
    }
    if (type === "IDAT" && length > 0) hasImageData = true;
    if (type === "IEND" && (length !== 0 || end !== png.length)) {
      throw new Error("Invalid PNG end chunk");
    }
    offset = end;
  }
  if (!hasImageData || png.readUInt32BE(8) !== 13) {
    throw new Error("Screenshot has no PNG image data or valid header");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 640 || height < 480) {
    throw new Error(`Screenshot is too small: ${width}x${height}`);
  }
  return { width, height };
}

/** One recorder per run; capture failures must fail the scenario. */
export class ScreenshotRecorder {
  private readonly indexes = new Map<string, number>();

  constructor(
    private readonly directory: string,
    private readonly takeScreenshot: () => Promise<string>,
  ) {}

  async capture(scenario: string, step: string): Promise<string> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(scenario)) {
      throw new Error(`Invalid screenshot scenario: ${scenario}`);
    }
    const slug = step.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) throw new Error("Screenshot step must have a name");
    const png = Buffer.from(await this.takeScreenshot(), "base64");
    screenshotDimensions(png);
    const index = (this.indexes.get(scenario) ?? 0) + 1;
    const filename = `${String(index).padStart(3, "0")}-${slug}.png`;
    const directory = resolve(this.directory, "screenshots", scenario);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, filename), png);
    this.indexes.set(scenario, index);
    return `${scenario}/${filename}`;
  }
}
