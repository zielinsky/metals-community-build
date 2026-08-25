import { isAbsolute, normalize, sep } from "node:path";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function ensure(
  condition: unknown,
  source: string,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`${source}: ${message}`);
}

export function record(
  value: unknown,
  field: string,
  source: string,
): Record<string, unknown> {
  ensure(
    typeof value === "object" && value !== null && !Array.isArray(value),
    source,
    `'${field}' must be an object`,
  );
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, source: string): string {
  ensure(
    typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value),
    source,
    `'${field}' must be a non-empty single-line string`,
  );
  return value;
}

export function repository(
  value: unknown,
  field: string,
  source: string,
): string {
  const result = text(value, field, source);
  ensure(
    repositoryPattern.test(result),
    source,
    `'${field}' must use the owner/repository form`,
  );
  return result;
}

export function gitRef(value: unknown, field: string, source: string): string {
  const result = text(value, field, source);
  const invalidPart = result
    .split("/")
    .some(
      (part) =>
        part.length === 0 || part.startsWith(".") || part.endsWith(".lock"),
    );
  const invalid =
    result.startsWith("-") ||
    result.endsWith(".") ||
    result.includes("..") ||
    result.includes("@{") ||
    result.includes("[") ||
    /[\x00-\x20\x7f~^:?*\\]/.test(result) ||
    invalidPart;
  ensure(!invalid, source, `'${field}' is not a valid Git ref`);
  return result;
}

export function relativePath(
  value: unknown,
  field: string,
  source: string,
): string {
  const result = text(value, field, source);
  const normalized = normalize(result);
  const escapesRoot = normalized === ".." || normalized.startsWith(`..${sep}`);
  ensure(
    !isAbsolute(result) && !escapesRoot,
    source,
    `'${field}' must be a relative path`,
  );
  return normalized.split(sep).join("/");
}
