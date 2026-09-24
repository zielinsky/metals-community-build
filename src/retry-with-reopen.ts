/** Reopening belongs to the retry: a transient open failure must not end the run. */
export async function retryWithReopen<Editor, Result>(options: {
  current: () => Editor;
  reopen: () => Promise<Editor>;
  action: (editor: Editor) => Promise<Result>;
  onFailure: (attempt: number, error: unknown) => void;
  attempts: number;
}): Promise<Result> {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const editor = attempt === 1 ? options.current() : await options.reopen();
      return await options.action(editor);
    } catch (error) {
      options.onFailure(attempt, error);
      if (attempt === options.attempts) throw error;
    }
  }
  throw new Error("At least one test UI attempt is required");
}
