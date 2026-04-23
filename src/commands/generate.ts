import type { GenerateOptions, ShellType } from '../types';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { copyToClipboard } from '../utils/clipboard';
import { addHistory } from '../utils/history';
import { displayCommand, displayError, displaySuccess, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';
import * as readline from 'readline';
import { exec } from 'child_process';

export async function generateCommand(description: string, options: GenerateOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: options.inline }))) return;
  const config = loadConfig();

  const shell: ShellType = options.shell || detectShell() || config.shell;
  console.log(`  Option shell: ${options.shell}`);
  console.log(`  Detected shell: ${detectShell()}`);
  console.log(`  Configured shell: ${config.shell}`);
  console.log(`  Using shell: ${shell}`);

  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);

  const ctx = config.context_enable
    ? collectContext({
        historyLines: config.context_history_lines,
        historyFile: options.historyFile,
      })
    : undefined;

  // Inline mode: invoked by shell integrations; stdout emits only the bare command
  if (options.inline) {
    await runInlineMode(client, description, shell, ctx, options.buffer);
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
        await runCommand(result.command, shell);
        return;
      }
    }

    // interactive confirm
    await interactiveConfirm(result.command, finalRisk === 'danger', shell);

  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to generate command');
  }
}

/** Inline mode: stdout emits the command only; dangerous commands yield stderr + non-zero exit.
 *  stderr text is always English — it's piped through shell encoding layers (notably PS 5.1 on
 *  Chinese Windows reading via CP936) where any non-ASCII would render as mojibake. */
async function runInlineMode(
  client: AIClient,
  description: string,
  shell: ShellType,
  ctx: ReturnType<typeof collectContext> | undefined,
  buffer?: string,
): Promise<void> {
  try {
    const enriched = buffer ? withBufferContext(description, buffer) : description;
    const result = await client.generate(enriched, shell, 'en', ctx);
    const cleaned = normalizeInlineCommand(result.command);

    const localCheck = checkDanger(cleaned, 'en');
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

/** Normalize inline output: strip reasoning trace, markdown fence, normalize line endings, trim. */
function normalizeInlineCommand(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '');
  // Reasoning models (DeepSeek R1, Qwen3, ...) leak <think>...</think> into content.
  s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  // Models often wrap their output in ```bash ... ``` / ``` ... ``` despite the prompt instructions.
  const fence = s.match(/^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) s = fence[1];
  return s.trim();
}

function withBufferContext(description: string, buffer: string): string {
  const trimmed = buffer.trim();
  if (!trimmed) return description;

  // Single-line ASCII → looks like a partial command (tool name, flags, arg prefix).
  // Anything else (Chinese, multi-line, natural-language help text) → treat as loose context.
  const looksLikeCommand = !trimmed.includes('\n') && !/[^\x20-\x7e]/.test(trimmed);

  if (looksLikeCommand) {
    return `The user has typed the start of a command at their shell prompt and pressed Ctrl+G to complete it:
\`\`\`
${trimmed}
\`\`\`
Intent: ${description}

TREAT THE PARTIAL AS A STRONG CONSTRAINT. The output should keep the same tool / prefix whenever it can plausibly satisfy the intent. For example:
- partial "nvidia" + intent "GPU status" -> "nvidia-smi" (not a WMI cmdlet)
- partial "git" + intent "last 10 commits" -> "git log -n 10"
- partial "docker" + intent "list running containers" -> "docker ps"
Only swap to a different tool if the partial genuinely cannot satisfy the intent on the target shell.`;
  }

  return `The user is currently editing this partial input in their shell:
\`\`\`
${trimmed}
\`\`\`
They want to: ${description}
Use the partial as additional context (tool preference, target paths, flags already chosen) and generate a complete command.`;
}

/** Interactive confirm menu — arrow-key select. Dangerous commands hide the Run option. */
async function interactiveConfirm(command: string, isDanger: boolean, shell: ShellType): Promise<void> {
  const prompts = await import('@inquirer/prompts');

  const choices = [
    ...(isDanger ? [] : [{ name: 'Run this command', value: 'run' }]),
    { name: 'Copy to clipboard', value: 'copy' },
    { name: 'Edit the command', value: 'edit' },
    { name: 'Cancel', value: 'cancel' },
  ];

  let action: string;
  try {
    action = await prompts.select({
      message: 'What would you like to do?',
      choices,
    });
  } catch (err: any) {
    // Ctrl+C / Esc → treat as Cancel
    if (err?.name === 'ExitPromptError' || err?.message?.includes('User force closed')) {
      console.log('  Cancelled');
      return;
    }
    throw err;
  }

  switch (action) {
    case 'run':
      await runCommand(command, shell);
      break;
    case 'copy': {
      const ok = await copyToClipboard(command);
      if (ok) {
        await displaySuccess('Copied to clipboard');
      } else {
        await displayError('Failed to copy to clipboard');
      }
      break;
    }
    case 'edit': {
      const edited = await editCommand(command);
      if (edited && edited.trim()) {
        const editedCheck = checkDanger(edited);
        const editedIsDanger = editedCheck.risk === 'danger';
        await displayCommand(edited, editedCheck.risk, editedCheck.warnings.join('; ') || undefined);
        await interactiveConfirm(edited, editedIsDanger, shell);
      } else {
        console.log('  Cancelled');
      }
      break;
    }
    case 'cancel':
    default:
      console.log('  Cancelled');
      break;
  }
}

/** Execute a command in a child shell. */
function runCommand(command: string, shell?: ShellType): Promise<void> {
  return new Promise((resolve) => {
    console.log();
    // 1. 确定运行环境
    // 如果用户通过 --shell 传入了 powershell，我们需要将其转换为可执行文件名
    let shellToUse: string | undefined;

    if (process.platform === 'win32') {
      // console.log(`  Running command in Windows shell: ${shell || 'default'}`);
      // 显式映射：将前端定义的 ShellType 映射为 Windows 可执行文件名
      const winShellMap: Record<string, string> = {
        'powershell': 'powershell.exe',
        'cmd': 'cmd.exe',
        'bash': 'bash.exe', // 针对 Windows 上的 Git Bash 或 WSL
      };

      shellToUse = (shell && winShellMap[shell]) 
        || process.env.SHELL 
        || 'powershell.exe'; // 默认回退
    } else {
      // console.log(`  Running command in Unix shell: ${shell || 'default'}`);
      // Unix/Linux/macOS 直接使用 shell 名称或环境变量
      shellToUse = shell || process.env.SHELL || '/bin/sh';
    }
    
    const child = exec(command, { shell: shellToUse }, (error, stdout, stderr) => {
      if (error) {
        console.error(`\n  ${error.message}`);
      }
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    });
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
