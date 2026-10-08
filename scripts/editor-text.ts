const identifier = /^[A-Za-z_$][\w$]*$/;
const identifierCharacter = /[\w$]/;

/**
 * Finds `text` in `source` and returns its 1-based line and column.
 *
 * An identifier only matches as a whole word, so `Optional` never lands on
 * `OptionalInt`. With `near`, the search starts at the first line that
 * contains `near`, which selects a later occurrence than the first one in the
 * file without counting occurrences by hand.
 */
export function sourceSelection(source: string, text: string, near?: string): [number, number] {
  if (!text || /[\r\n]/.test(text)) throw new Error("Selection must be nonempty and on one line");
  let from = 0;
  if (near !== undefined) {
    if (!near || /[\r\n]/.test(near)) throw new Error("Context must be nonempty and on one line");
    const nearOffset = source.indexOf(near);
    if (nearOffset < 0) throw new Error(`Context '${near}' not found (case-sensitive)`);
    from = source.lastIndexOf("\n", nearOffset) + 1;
  }
  const wholeWord = identifier.test(text);
  let offset = source.indexOf(text, from);
  while (offset >= 0 && wholeWord && (
    (offset > 0 && identifierCharacter.test(source[offset - 1])) ||
    (offset + text.length < source.length && identifierCharacter.test(source[offset + text.length]))
  )) {
    offset = source.indexOf(text, offset + 1);
  }
  if (offset < 0) {
    throw new Error(
      `Text '${text}' not found (case-sensitive${near === undefined ? "" : `, after '${near}'`})`,
    );
  }
  const before = source.slice(0, offset).split(/\r?\n/);
  return [before.length, before.at(-1)!.length + 1];
}
