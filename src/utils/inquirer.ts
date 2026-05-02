import * as readline from 'readline';

/**
 * Run an inquirer prompt with Esc bound to cancel. @inquirer/prompts 8.x only
 * binds Ctrl+C natively; this attaches a stdin keypress listener that aborts
 * the supplied AbortSignal when the user hits Esc, then catches the resulting
 * AbortPromptError and returns null.
 */
export async function pickWithEsc<T>(runner: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  let listener: ((str: string, key: any) => void) | null = null;

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    listener = (_str, key) => {
      if (key && key.name === 'escape') controller.abort();
    };
    process.stdin.on('keypress', listener);
  }

  try {
    return await runner(controller.signal);
  } catch (err: any) {
    if (controller.signal.aborted || isCancelled(err)) return null;
    throw err;
  } finally {
    if (listener) process.stdin.removeListener('keypress', listener);
  }
}

/** Recognize the various ways inquirer signals user-cancellation. */
export function isCancelled(err: any): boolean {
  if (!err) return false;
  const name = String(err.name || '');
  if (name === 'ExitPromptError' || name === 'AbortPromptError' || name === 'AbortError') return true;
  return /User force closed/i.test(String(err.message || ''));
}
