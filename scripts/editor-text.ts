export function sourceSelection(source: string, text: string): [number, number] {
  if (!text || /[\r\n]/.test(text)) throw new Error("Selection must be nonempty and on one line");
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`Text '${text}' not found (case-sensitive)`);
  const before = source.slice(0, offset).split(/\r?\n/);
  return [before.length, before.at(-1)!.length + 1];
}
