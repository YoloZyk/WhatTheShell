import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { collectScaffoldContext } from '../core/scaffoldContext';
import { parseAttachments } from '../core/attachments';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import { displayAnswer, displayError, displayWarn, startSpinner } from '../utils/display';
import { isCancelled } from '../utils/inquirer';
import { pickProjectFiles } from './askPicker';
import { ensureApiKey } from './init';

export async function askCommand(question?: string): Promise<void> {
  if (!(await ensureApiKey({ inline: false }))) return;

  const trimmed = question?.trim() || '';
  if (trimmed) {
    await runAskFlow({ rawQuestion: trimmed, displayQuestion: trimmed });
    return;
  }

  // No question argument → enter interactive mode (picker → input).
  if (!process.stdin.isTTY) {
    await displayError(
      'Question required. Use `wts a "<question>"` or run in an interactive terminal for the picker.',
    );
    process.exitCode = 1;
    return;
  }

  await runInteractiveAsk();
}

async function runInteractiveAsk(): Promise<void> {
  const cwd = process.cwd();

  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.magenta('[ask]')} ${chalk.gray('· interactive ' + '─'.repeat(38))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Pick files to attach, then type your question. Esc to skip / cancel.')}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray('─'.repeat(58))}`);
  console.log();

  const picked = await pickProjectFiles(cwd);
  if (picked === null) {
    console.log(`  ${chalk.gray('Cancelled')}`);
    return;
  }

  const prompts = await import('@inquirer/prompts');
  let userTyped: string;
  try {
    userTyped = await prompts.input({
      message: 'Question:',
      validate: (s: string) => s.trim().length > 0 || 'Question cannot be empty',
    });
  } catch (err: any) {
    if (isCancelled(err)) {
      console.log(`  ${chalk.gray('Cancelled')}`);
      return;
    }
    throw err;
  }

  // Compose the question by prepending @path tokens. The same parser used in
  // argv mode then turns them into [file:...] markers + AttachedFile entries
  // — both modes share one code path from here on.
  const prefix = picked.length > 0 ? picked.map(p => `@${p}`).join(' ') + ' ' : '';
  const composed = (prefix + userTyped).trim();

  await runAskFlow({ rawQuestion: composed, displayQuestion: userTyped.trim() });
}

interface AskFlowArgs {
  /** Question text passed to parseAttachments + stored in history. May contain `@path` tokens. */
  rawQuestion: string;
  /** Question text shown to the user in the header. Should be what they intended, not the
   *  internal composed form (e.g. picker mode shows just the typed question, not the `@p1 @p2` prefix). */
  displayQuestion: string;
}

async function runAskFlow(args: AskFlowArgs): Promise<void> {
  const config = loadConfig();
  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  // ask uses deep scaffold context (manifests + INTERESTING_FILES) so it can
  // answer high-level project questions even without `@` attachments.
  const ctx = config.context_enable
    ? collectScaffoldContext({ historyLines: config.context_history_lines })
    : undefined;

  const parsed = parseAttachments(args.rawQuestion, process.cwd(), config.shell);

  renderHeader(parsed.attachments, args.displayQuestion);

  for (const w of parsed.warnings) {
    await displayWarn(w);
  }

  const spinner = await startSpinner('Thinking...');

  try {
    const answer = await client.ask(parsed.question, config.language, ctx, parsed.attachments);
    spinner.stop();

    await displayAnswer(answer);

    addHistory({ type: 'ask', input: args.rawQuestion, output: answer });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to answer question');
  }
}

function renderHeader(attached: { path: string; lineCount: number }[], rawQuestion: string): void {
  console.log(`${chalk.cyan('┌─')} ${chalk.magenta('[ask]')} ${chalk.gray('─'.repeat(50))}`);
  if (attached.length > 0) {
    const totalLines = attached.reduce((acc, f) => acc + f.lineCount, 0);
    const list = attached.map(f => f.path).join(', ');
    const truncated = list.length > 60 ? list.slice(0, 57) + '...' : list;
    console.log(
      `${chalk.cyan('│')}  ${chalk.cyan('📎')} ${chalk.gray('Attached:')} ${chalk.white(truncated)} ` +
      chalk.gray(`(${attached.length} file${attached.length > 1 ? 's' : ''}, ${totalLines} lines)`),
    );
  }
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.white(rawQuestion)}`);
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);
}
