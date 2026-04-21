import type { GenerateOptions, ShellType } from '../types';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { copyToClipboard } from '../utils/clipboard';
import { addHistory } from '../utils/history';
import { displayCommand, displayError, displaySuccess, displayActions, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';
import * as readline from 'readline';
import { exec } from 'child_process';

export async function generateCommand(description: string, options: GenerateOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: options.inline }))) return;
  const config = loadConfig();

  const shell: ShellType = options.shell || config.shell || detectShell();
  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);

  const ctx = config.context_enable
    ? collectContext({
        historyLines: config.context_history_lines,
        historyFile: options.historyFile,
      })
    : undefined;

  // Inline mode: invoked by shell integrations; stdout emits only the bare command
  if (options.inline) {
    await runInlineMode(client, description, shell, config.language, ctx, options.buffer);
    return;
  }

  const spinner = await startSpinner('Generating command...');

  try {
    const enriched = options.buffer ? withBufferContext(description, options.buffer) : description;
    const result = await client.generate(enriched, shell, config.language, ctx);
    spinner.stop();

    // local-rule fallback: double-check the AI-returned command
    const localCheck = checkDanger(result.command, config.language);
    const finalRisk = localCheck.risk === 'danger' ? 'danger'
      : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
      : result.risk;
    const finalWarning = localCheck.warnings.length > 0
      ? localCheck.warnings.join('; ')
      : result.warning;

    await displayCommand(result.command, finalRisk, finalWarning);

    // record history
    addHistory({ type: 'generate', input: description, output: result.command });

    // --copy mode: copy and exit
    if (options.copy) {
      const ok = await copyToClipboard(result.command);
      if (ok) {
        await displaySuccess('Copied to clipboard');
      } else {
        await displayError('Failed to copy to clipboard');
      }
      return;
    }

    // --run mode: never auto-run a dangerous command
    if (options.run) {
      if (finalRisk === 'danger') {
        await displayError('Dangerous command cannot be auto-executed; confirm manually');
      } else {
        await runCommand(result.command);
        return;
      }
    }

    // interactive confirm
    await interactiveConfirm(result.command, finalRisk === 'danger');

  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to generate command');
  }
}

/** Inline mode: stdout emits the command only; dangerous commands yield stderr + non-zero exit. */
async function runInlineMode(
  client: AIClient,
  description: string,
  shell: ShellType,
  language: 'zh' | 'en',
  ctx: ReturnType<typeof collectContext> | undefined,
  buffer?: string,
): Promise<void> {
  try {
    const enriched = buffer ? withBufferContext(description, buffer) : description;
    const result = await client.generate(enriched, shell, language, ctx);
    const cleaned = normalizeInlineCommand(result.command);

    const localCheck = checkDanger(cleaned, language);
    const risk = localCheck.risk === 'danger' ? 'danger' : result.risk;

    if (risk === 'danger') {
      const warning = localCheck.warnings.join('; ') || result.warning || 'command may have irreversible effects';
      process.stderr.write(`wts: refusing to fill dangerous command — ${warning}\n`);
      process.stderr.write(`     blocked: ${cleaned}\n`);
      process.exitCode = 3;
      return;
    }

    // bash's READLINE_LINE interprets embedded \n as Enter and auto-executes;
    // refuse multi-line output so an uninvited run can't happen.
    if (cleaned.includes('\n')) {
      process.stderr.write('wts: model returned multi-line output; refusing to fill (use `wts generate` for the interactive flow)\n');
      process.stderr.write(`     blocked: ${cleaned.split('\n').join(' ⏎ ')}\n`);
      process.exitCode = 4;
      return;
    }

    process.stdout.write(cleaned + '\n');
  } catch (err: any) {
    process.stderr.write(`wts: ${err.message || 'Failed to generate command'}\n`);
    process.exitCode = 1;
  }
}

/** Normalize inline output: strip markdown fence, normalize line endings, trim. */
function normalizeInlineCommand(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '');
  // Models often wrap their output in ```bash ... ``` / ``` ... ``` despite the prompt instructions.
  const fence = s.match(/^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) s = fence[1];
  return s.trim();
}

function withBufferContext(description: string, buffer: string): string {
  const trimmed = buffer.trim();
  if (!trimmed) return description;
  return `The user is currently editing this partial command:\n\`\`\`\n${trimmed}\n\`\`\`\nThey want to: ${description}\nGenerate a complete replacement command.`;
}

/** Interactive confirm menu: [R]un [C]opy [E]dit [Q]uit */
async function interactiveConfirm(command: string, isDanger: boolean): Promise<void> {
  const actions = isDanger
    ? ['Copy', 'Edit', 'Quit']
    : ['Run', 'Copy', 'Edit', 'Quit'];

  await displayActions(actions);

  const key = await readKey();

  switch (key.toLowerCase()) {
    case 'r':
      if (isDanger) {
        await displayError('Dangerous commands cannot be auto-executed');
        break;
      }
      await runCommand(command);
      break;
    case 'c': {
      const ok = await copyToClipboard(command);
      if (ok) {
        await displaySuccess('Copied to clipboard');
      } else {
        await displayError('Failed to copy to clipboard');
      }
      break;
    }
    case 'e': {
      const edited = await editCommand(command);
      if (edited && edited.trim()) {
        const editedCheck = (await import('../core/danger')).checkDanger(edited);
        const editedIsDanger = editedCheck.risk === 'danger';
        await displayCommand(edited, editedCheck.risk, editedCheck.warnings.join('; ') || undefined);
        await interactiveConfirm(edited, editedIsDanger);
      } else {
        console.log('  Cancelled');
      }
      break;
    }
    default:
      console.log('  Cancelled');
      break;
  }
}

/** Read a single keypress. */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode?.(false);
      rl.close();
      const key = data.toString();
      // Ctrl+C
      if (key === '\x03') {
        process.exit();
      }
      console.log();
      resolve(key);
    });
  });
}

/** Execute a command in a child shell. */
function runCommand(command: string): Promise<void> {
  return new Promise((resolve) => {
    console.log();
    const child = exec(command, { shell: process.env.SHELL || undefined });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n  Exit code: ${code}`);
      }
      resolve();
    });
  });
}

/** Edit the command inline by pre-filling the readline buffer. */
function editCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  > ', (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.write(command);
  });
}
