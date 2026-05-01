import type { GenerateOptions, ShellType, Step, ExecutionResult } from '../types';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { copyToClipboard } from '../utils/clipboard';
import { addHistory } from '../utils/history';
import { displayCommand, displayError, displaySuccess, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';
import { StepExecutor } from '../core/executor';
import * as readline from 'readline';
import * as path from 'path';
import { exec } from 'child_process';
import chalk from 'chalk';

export async function generateCommand(description: string, options: GenerateOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: options.inline }))) return;
  const config = loadConfig();

  const shell: ShellType = options.shell || detectShell() || config.shell;

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

  // Show input header
  console.log(`${chalk.cyan('┌─')} ${chalk.green('[generate]')} ${chalk.gray('─'.repeat(46))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.white(description)}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('shell:')} ${chalk.cyan(shell)}`);
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  // Force script mode via flag
  if (options.script) {
    await runMultiStepMode(client, description, shell, config, ctx);
    return;
  }

  // Use AI to classify task type
  const spinner = await startSpinner('Analysing task type...');

  try {
    const taskType = await client.classifyTask(description, config.language);
    spinner.stop();

    if (taskType === 'multi') {
      await runMultiStepMode(client, description, shell, config, ctx);
    } else {
      await runSingleStepMode(client, description, shell, config, ctx, undefined);
    }
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to classify task');
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
  const chalk = (await import('chalk')).default;

  const choices = [
    ...(isDanger ? [] : [{ name: `${chalk.green('Run')} this command`, value: 'run' }]),
    { name: `${chalk.cyan('Copy')} to clipboard`, value: 'copy' },
    { name: `${chalk.yellow('Edit')} the command`, value: 'edit' },
    { name: `${chalk.gray('Cancel')}`, value: 'cancel' },
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
      console.log();
      console.log(`  ${chalk.gray('Cancelled')}`);
      console.log();
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
      const { newCommand, changed } = await editCommand(command);
      if (newCommand && changed) {
        const editedCheck = checkDanger(newCommand);
        const editedIsDanger = editedCheck.risk === 'danger';
        await displayCommand(newCommand, editedCheck.risk, editedCheck.warnings.join('; ') || undefined);
        await interactiveConfirm(newCommand, editedIsDanger, shell);
      } else {
        console.log();
        console.log(`  ${chalk.gray('Cancelled')}`);
        console.log();
      }
      break;
    }
    case 'cancel':
    default:
      console.log();
      console.log(`  ${chalk.gray('Cancelled')}`);
      console.log();
      break;
  }
}

/** Execute a command in a child shell. */
export function runCommand(command: string, shell?: ShellType): Promise<void> {
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

/** Edit the command inline by pre-filling the readline buffer. Returns { newCommand, changed }. */
function editCommand(command: string): Promise<{ newCommand: string; changed: boolean }> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${chalk.cyan('  > ')}`, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve({
        newCommand: trimmed,
        changed: trimmed !== command,
      });
    });
    rl.write(command);
  });
}

/** Display change summary between old and new command */
function displayEditChange(oldCmd: string, newCmd: string): void {
  console.log(`  ${chalk.yellow('→')} ${newCmd}`);
}

/** Single-line command mode (original generate logic) */
async function runSingleStepMode(
  client: AIClient,
  description: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  ctx: ReturnType<typeof collectContext> | undefined,
  options?: GenerateOptions,
): Promise<void> {
  const spinner = await startSpinner('Generating...');

  try {
    const enriched = options?.buffer ? withBufferContext(description, options.buffer) : description;
    const result = await client.generate(enriched, shell, config.language, ctx);
    spinner.stop();

    const localCheck = checkDanger(result.command, config.language);
    const finalRisk = localCheck.risk === 'danger' ? 'danger'
      : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
      : result.risk;
    const finalWarning = localCheck.warnings.length > 0
      ? localCheck.warnings.join('; ')
      : result.warning;

    await displayCommand(result.command, finalRisk, finalWarning);

    addHistory({ type: 'generate', input: description, output: result.command });

    if (options?.copy) {
      const ok = await copyToClipboard(result.command);
      if (ok) {
        await displaySuccess('Copied to clipboard');
      } else {
        await displayError('Failed to copy to clipboard');
      }
      return;
    }

    if (options?.run) {
      if (finalRisk === 'danger') {
        await displayError('Dangerous command cannot be auto-executed; confirm manually');
      } else {
        await runCommand(result.command, shell);
        return;
      }
    }

    await interactiveConfirm(result.command, finalRisk === 'danger', shell);

  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to generate command');
  }
}

/** Multi-step script mode (v0.4).
 *  Caller is responsible for deciding whether to enter multi-step mode
 *  (either via classifyTask or --script flag). This function only generates
 *  and runs the script. */
async function runMultiStepMode(
  client: AIClient,
  description: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  ctx: ReturnType<typeof collectContext> | undefined,
): Promise<void> {
  const spinner = await startSpinner('Generating script...');

  try {
    const result = await client.script(description, shell, config.language, ctx);

    if (result.steps.length === 0) {
      spinner.stop();
      await displayError('Failed to generate script');
      return;
    }

    spinner.stop();
    console.log(`  ${chalk.green('✓')} Generated ${result.steps.length} steps\n`);

    displaySteps(result.steps);

    if (result.risk === 'danger') {
      console.log(`  ${chalk.red('[DANGER]')} This script contains potentially dangerous commands`);
    } else if (result.risk === 'warning') {
      console.log(`  ${chalk.yellow('[CAUTION]')} This script contains some risky commands`);
    }
    console.log();

    await interactiveScriptMenu(client, description, shell, config, result.steps, result.risk);

  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to generate script');
  }
}

/** Display script steps */
function displaySteps(steps: Step[]): void {
  console.log();
  for (const step of steps) {
    const dangerTag = step.danger ? ` ${chalk.red('[DANGER]')}` : '';
    const summary = summarizeStep(step.command);
    console.log(`  ${chalk.cyan(`Step ${step.index}/${steps.length}:`)} ${summary}${dangerTag}`);
    if (step.description) {
      console.log(`    ${chalk.gray('# ' + step.description)}`);
    }
  }
  console.log();
}

/** One-line summary for a step's command. Recognizes file-write patterns
 *  (PowerShell here-strings, bash heredocs) so multi-line file writes show
 *  as "Write file: foo.txt (215 lines)" instead of just "@'" or "cat <<'EOF'".
 *  When a step contains multiple file writes (typical for grouped scaffolds),
 *  lists all of them. */
function summarizeStep(command: string): string {
  const lineCount = command.split('\n').length;
  const files: string[] = [];

  // PowerShell here-string piped to Set-Content / Out-File / Add-Content
  for (const m of command.matchAll(/@['"][\s\S]*?['"]@\s*\|\s*(?:Set-Content|Out-File|Add-Content)\s+(?:-Path\s+)?['"]?([^'"\s|]+)['"]?/gi)) {
    files.push(m[1]);
  }

  // PowerShell here-string redirected: @'...'@ > 'foo'
  for (const m of command.matchAll(/@['"][\s\S]*?['"]@\s*>\s*['"]?([^'"\s|]+)['"]?/g)) {
    files.push(m[1]);
  }

  // Bash heredoc forms
  for (const m of command.matchAll(/cat\s+<<-?\s*['"]?\w+['"]?\s*>\s*['"]?([^'"\s]+)['"]?/gi)) {
    files.push(m[1]);
  }
  for (const m of command.matchAll(/cat\s*>\s*['"]?([^'"\s]+)['"]?\s*<<-?\s*['"]?\w+['"]?/gi)) {
    files.push(m[1]);
  }

  if (files.length === 1) {
    return `${chalk.yellow('Write file:')} ${files[0]} ${chalk.gray(`(${lineCount} lines)`)}`;
  }
  if (files.length > 1) {
    return `${chalk.yellow(`Write ${files.length} files:`)} ${files.join(', ')} ${chalk.gray(`(${lineCount} lines)`)}`;
  }

  // Single-line command — show as is, truncate if very long
  if (lineCount === 1) {
    return command.length > 100 ? command.slice(0, 97) + '...' : command;
  }

  // Multi-line but no recognized pattern — first line + line count hint
  const firstLine = command.split('\n')[0];
  return `${firstLine} ${chalk.gray(`(+${lineCount - 1} lines)`)}`;
}

/** Interactive script menu */
async function interactiveScriptMenu(
  client: AIClient,
  originalDescription: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  steps: Step[],
  risk: 'safe' | 'warning' | 'danger',
): Promise<void> {
  const prompts = await import('@inquirer/prompts');
  const chalk = (await import('chalk')).default;

  const choices = [
    { name: `${chalk.green('Run All')} steps`, value: 'runAll' },
    { name: `${chalk.cyan('Step by Step')} mode`, value: 'stepByStep' },
    { name: `${chalk.yellow('Say Something')} to improve`, value: 'improve' },
    { name: `${chalk.gray('Cancel')}`, value: 'cancel' },
  ];

  let action: string;
  try {
    action = await prompts.select({
      message: 'What would you like to do?',
      choices,
    });
  } catch (err: any) {
    if (err?.name === 'ExitPromptError' || err?.message?.includes('User force closed')) {
      console.log();
      console.log(`  ${chalk.gray('Cancelled')}`);
      console.log();
      return;
    }
    throw err;
  }

  switch (action) {
    case 'runAll':
      await runAllSteps(steps, shell, client, config);
      break;
    case 'stepByStep':
      await stepByStepMode(client, originalDescription, shell, config, steps);
      break;
    case 'improve':
      await improveScript(client, originalDescription, shell, config, steps);
      break;
    case 'cancel':
    default:
      console.log();
      console.log(`  ${chalk.gray('Cancelled')}`);
      console.log();
      break;
  }
}

/** Run all steps at once */
async function runAllSteps(
  steps: Step[],
  shell: ShellType,
  client: AIClient,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const executor = new StepExecutor(shell);
  const failedSteps: { step: Step; error: string }[] = [];
  const skippedSteps: { step: Step; reason: string }[] = [];
  console.log();

  for (const step of steps) {
    const stepNum = `${step.index}/${steps.length}`;

    // Auto-skip long-running commands in RunAll mode — running them here
    // would hang the executor forever waiting for child exit. The user can
    // run them manually after the script completes.
    const longRun = detectLongRunning(step.command);
    if (longRun.isLong) {
      console.log(`  ${chalk.yellow('⚠ Skipped')} ${chalk.cyan(`Step ${stepNum}`)}  ${chalk.gray(`long-running ${longRun.reason}`)}`);
      console.log(`    ${chalk.gray('Run manually:')} ${chalk.cyan(step.command.split('\n')[0])}`);
      skippedSteps.push({ step, reason: longRun.reason || 'long-running' });
      console.log();
      continue;
    }

    const cwdBefore = executor.getCwd();
    const result = await executor.executeStep(step);

    if (result.success) {
      printStepSuccess(step, stepNum, result, cwdBefore, executor.getCwd());
    } else {
      console.log(`  ${chalk.red('✗')} Step ${stepNum}  ${chalk.red(result.error || 'Failed')}`);
      if (result.stderr) {
        console.error(result.stderr.split('\n').map(l => `    ${chalk.gray(l)}`).join('\n'));
      }

      // Ask for next action on failure
      let action = await promptFailureAction();

      if (action === 'f') {
        // Auto-fix
        const fixCwdBefore = executor.getCwd();
        const fixed = await fixStep(client, step, result.error || 'Unknown error', shell, config, executor);
        if (fixed) {
          printStepSuccess(step, stepNum, fixed, fixCwdBefore, executor.getCwd());
        } else {
          failedSteps.push({ step, error: result.error || 'Unknown error' });
        }
      } else if (action === 'h') {
        // Fix with hint
        const hint = await promptFixHint();
        if (hint !== null) {
          const fixCwdBefore = executor.getCwd();
          const fixed = await fixStepWithHint(client, step, result.error || 'Unknown error', hint, shell, config, executor);
          if (fixed) {
            printStepSuccess(step, stepNum, fixed, fixCwdBefore, executor.getCwd());
          } else {
            failedSteps.push({ step, error: result.error || 'Unknown error' });
          }
        } else {
          // User cancelled
          console.log(`  ${chalk.gray('Cancelled')}`);
          return;
        }
      } else if (action === 'e') {
        // Edit and retry
        const { newCommand, changed } = await editCommand(step.command);
        if (changed) {
          const oldCmd = step.command;
          step.command = newCommand;
          displayEditChange(oldCmd, newCommand);
          const editCwdBefore = executor.getCwd();
          const editResult = await executor.executeStep(step);
          if (editResult.success) {
            printStepSuccess(step, stepNum, editResult, editCwdBefore, executor.getCwd());
          } else {
            failedSteps.push({ step, error: editResult.error || 'Unknown error' });
          }
        } else {
          failedSteps.push({ step, error: 'Edit cancelled' });
        }
      } else if (action === 's') {
        console.log(`  ${chalk.gray('Skipped')}`);
        failedSteps.push({ step, error: 'Skipped by user' });
      } else {
        console.log(`  ${chalk.gray('Cancelled')}`);
        return;
      }
    }
    console.log();
  }

  // Summary
  if (failedSteps.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${failedSteps.length} step(s) failed:\n`));
    for (const { step } of failedSteps) {
      console.log(`  ${chalk.cyan(`Step ${step.index}:`)} ${step.command}`);
    }
    console.log();
  }
  if (skippedSteps.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${skippedSteps.length} step(s) skipped (long-running):\n`));
    for (const { step, reason } of skippedSteps) {
      console.log(`  ${chalk.cyan(`Step ${step.index}:`)} ${step.command.split('\n')[0]} ${chalk.gray(`(${reason})`)}`);
    }
    console.log(chalk.gray('  Run these manually after the script if needed.'));
    console.log();
  }
  if (failedSteps.length === 0 && skippedSteps.length === 0) {
    console.log(chalk.green('All steps completed!'));
  } else if (failedSteps.length === 0) {
    console.log(chalk.green('Script done (some steps skipped).'));
  }
}

/** Step by step mode */
async function stepByStepMode(
  client: AIClient,
  originalDescription: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  steps: Step[],
): Promise<void> {
  const executor = new StepExecutor(shell);
  let currentIndex = 0;

  while (currentIndex < steps.length) {
    const step = steps[currentIndex];
    const stepNum = `${step.index}/${steps.length}`;

    // Show command before execution (with smart summary)
    console.log();
    const summary = summarizeStep(step.command);
    console.log(`${chalk.cyan(`Step ${stepNum}:`)} ${summary}`);
    if (step.description) {
      console.log(`  ${chalk.gray('# ' + step.description)}`);
    }

    const longRun = detectLongRunning(step.command);
    if (longRun.isLong) {
      console.log(`  ${chalk.yellow('⚠')} Long-running ${chalk.gray(`(${longRun.reason})`)} — running it will hang until you Ctrl+C`);
    }

    // Ask to run or edit before execution. Long-running steps get an extra
    // [S]kip option since "run anyway" will block the script.
    const preAction = longRun.isLong
      ? await promptPreExecutionLongRunning()
      : await promptPreExecution();

    if (preAction === 'c') {
      console.log(`  ${chalk.gray('Cancelled')}`);
      return;
    } else if (preAction === 's') {
      console.log(`  ${chalk.gray('Skipped')}`);
      currentIndex++;
      continue;
    } else if (preAction === 'e') {
      const { newCommand, changed } = await editCommand(step.command);
      if (changed) {
        step.command = newCommand;
        displayEditChange(step.command, newCommand);
      } else {
        continue; // Ask again
      }
    }
    // preAction === 'r', continue to execute

    const cwdBefore = executor.getCwd();
    const result = await executor.executeStep(step);

    if (result.success) {
      printStepSuccess(step, stepNum, result, cwdBefore, executor.getCwd());
      currentIndex++;
    } else {
      console.log(`  ${chalk.red('✗')} Error: ${result.error}`);
      if (result.stderr) {
        console.error(result.stderr.split('\n').map(l => `    ${chalk.gray(l)}`).join('\n'));
      }

      const action = await promptFailureAction();

      if (action === 'f') {
        const fixCwdBefore = executor.getCwd();
        const fixed = await fixStep(client, step, result.error || 'Unknown error', shell, config, executor);
        if (fixed) {
          printStepSuccess(step, stepNum, fixed, fixCwdBefore, executor.getCwd());
          currentIndex++;
        }
      } else if (action === 'h') {
        const hint = await promptFixHint();
        if (hint !== null) {
          const fixCwdBefore = executor.getCwd();
          const fixed = await fixStepWithHint(client, step, result.error || 'Unknown error', hint, shell, config, executor);
          if (fixed) {
            printStepSuccess(step, stepNum, fixed, fixCwdBefore, executor.getCwd());
            currentIndex++;
          }
        }
      } else if (action === 'e') {
        const { newCommand, changed } = await editCommand(step.command);
        if (changed) {
          const oldCmd = step.command;
          step.command = newCommand;
          displayEditChange(oldCmd, newCommand);
          const editCwdBefore = executor.getCwd();
          const editResult = await executor.executeStep(step);
          if (editResult.success) {
            printStepSuccess(step, stepNum, editResult, editCwdBefore, executor.getCwd());
            currentIndex++;
          }
        }
      } else if (action === 's') {
        console.log(`  ${chalk.gray('Skipped')}`);
        currentIndex++;
      } else {
        console.log(`  ${chalk.gray('Cancelled')}`);
        return;
      }
    }
  }

  console.log();
  console.log(chalk.green('All steps completed!'));
}

/** Render a successful step result with rich feedback: what the step did,
 *  cwd change (if any), and a tail of the command's stdout. */
function printStepSuccess(
  step: Step,
  stepNum: string,
  result: ExecutionResult,
  cwdBefore: string,
  cwdAfter: string,
): void {
  const label = step.description || summarizeStep(step.command);
  console.log(`  ${chalk.green('✓')} ${chalk.cyan(`Step ${stepNum}`)}  ${label}`);

  if (cwdAfter !== cwdBefore) {
    const display = formatCwdForDisplay(cwdAfter);
    console.log(`    ${chalk.gray('→ cwd:')} ${chalk.cyan(display)}`);
  }

  const trimmed = result.stdout.trim();
  if (trimmed) {
    // PowerShell formatters (e.g. mkdir's DirectoryInfo display) pad lines
    // with trailing whitespace. trimEnd each line so the indented output
    // doesn't look ragged.
    const lines = trimmed.split('\n').map(l => l.trimEnd());

    // Print-only steps (Write-Host / echo for completion banners) — show the
    // whole message instead of truncating, since the user is meant to read it.
    if (isPrintOnlyStep(step.command)) {
      for (const line of lines) {
        console.log(`    ${chalk.gray(line)}`);
      }
      return;
    }

    const tail = lines.slice(-3);
    if (lines.length > 3) {
      console.log(`    ${chalk.gray(`... (+${lines.length - 3} earlier lines)`)}`);
    }
    for (const line of tail) {
      console.log(`    ${chalk.gray(line)}`);
    }
  }
}

/** Display cwd as a relative path from the original cwd when reasonable;
 *  fall back to absolute when relative would go up too many levels. */
function formatCwdForDisplay(absoluteCwd: string): string {
  const rel = path.relative(process.cwd(), absoluteCwd);
  if (!rel) return '.';
  const upCount = rel.split(path.sep).filter(seg => seg === '..').length;
  if (upCount > 1) return absoluteCwd;
  return './' + rel.split(path.sep).join('/');
}

/** Detect "print-only" steps — those whose only effect is calling
 *  Write-Host / Write-Output / echo / printf with string arguments and
 *  formatting flags. These are typically completion banners or usage
 *  instructions; their full stdout is meant to be read, not summarized. */
function isPrintOnlyStep(command: string): boolean {
  let codeOnly = command;
  // Strip data regions
  codeOnly = codeOnly.replace(/@(['"])[\s\S]*?\1@/g, ' ');
  codeOnly = codeOnly.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, ' ');
  codeOnly = codeOnly.replace(/'(?:[^']|'')*'/g, ' ');
  codeOnly = codeOnly.replace(/"(?:\\.|`.|[^"\\`])*"/g, ' ');
  // Strip the print cmdlets themselves
  codeOnly = codeOnly.replace(/\b(Write-Host|Write-Output|Write-Information|echo|printf)\b/gi, ' ');
  // Strip flag-like tokens (e.g. -ForegroundColor Green, -NoNewline)
  codeOnly = codeOnly.replace(/-[A-Za-z][A-Za-z0-9]*(\s+\w+)?/g, ' ');
  // Strip separators / whitespace / parens / backticks
  codeOnly = codeOnly.replace(/[\s`;|()]+/g, ' ').trim();
  return codeOnly.length === 0;
}

/** Detect commands that won't return on their own (servers, watchers,
 *  interactive tools). Running them as a script step would hang the executor
 *  forever waiting for the child process to exit.
 *
 *  Important: only match patterns in CODE position. Strip here-string /
 *  heredoc bodies AND quoted string literals (they're data, not code) before
 *  matching, so README content embedded in here-strings or "Run: npm run
 *  dev" hints inside Write-Host arguments don't trigger false positives. */
function detectLongRunning(command: string): { isLong: boolean; reason?: string } {
  let codeOnly = command;

  // Strip PowerShell here-strings: @'...'@  and  @"..."@
  codeOnly = codeOnly.replace(/@(['"])[\s\S]*?\1@/g, ' ');

  // Strip bash heredocs: <<'TAG' ... TAG  /  <<TAG ... TAG  /  <<-TAG ... TAG
  codeOnly = codeOnly.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, ' ');

  // Strip single-quoted strings. PowerShell escape is doubled '' (treated as
  // a single literal quote); bash single-quotes don't escape. Both are safe
  // to handle by allowing '' as part of the body.
  codeOnly = codeOnly.replace(/'(?:[^']|'')*'/g, ' ');

  // Strip double-quoted strings. Allow:
  //   - bash escape: \\.
  //   - PowerShell escape: `.  (backtick + any)
  //   - any char that isn't a closing quote, backslash, or backtick
  codeOnly = codeOnly.replace(/"(?:\\.|`.|[^"\\`])*"/g, ' ');

  const patterns: { regex: RegExp; reason: string }[] = [
    { regex: /\bnpx\s+(serve|live-server|http-server)\b/i, reason: 'static file server' },
    { regex: /\b(npm|yarn|pnpm)\s+(start|run\s+(dev|start|serve|watch))\b/i, reason: 'dev server / watcher' },
    { regex: /\bnode\s+\S*server\S*\.(js|mjs|ts)\b/i, reason: 'node server' },
    { regex: /\bpython\s+-m\s+(http\.server|SimpleHTTPServer)\b/i, reason: 'Python HTTP server' },
    { regex: /\b(tsc|webpack|vite|rollup|esbuild|parcel)\s+[^\n]*--watch\b/i, reason: 'compiler watcher' },
    { regex: /\b(nodemon|supervisor|pm2\s+start)\b/i, reason: 'process supervisor' },
    { regex: /\b(gh\s+auth\s+login|ssh\s+\S+)\b/i, reason: 'interactive tool' },
  ];
  for (const { regex, reason } of patterns) {
    if (regex.test(codeOnly)) return { isLong: true, reason };
  }
  return { isLong: false };
}

/** Prompt before execution */
async function promptPreExecution(): Promise<'r' | 'e' | 'c'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${chalk.cyan('[R]un  [E]dit  [C]ancel:')}`, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });

  if (answer === 'e') return 'e';
  if (answer === 'c') return 'c';
  return 'r';
}

/** Prompt before execution when a long-running command is detected — adds
 *  [S]kip option since [R]un anyway will hang. */
async function promptPreExecutionLongRunning(): Promise<'r' | 's' | 'e' | 'c'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${chalk.yellow('[R]un anyway  [S]kip  [E]dit  [C]ancel:')}`, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });

  if (answer === 's') return 's';
  if (answer === 'e') return 'e';
  if (answer === 'c') return 'c';
  return 'r';
}

/** Prompt on failure */
async function promptFailureAction(): Promise<'f' | 'h' | 'e' | 's' | 'c'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${chalk.yellow('[F]ix  [F+H] Fix with Hint  [E]dit  [S]kip  [C]ancel:')}`, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });

  if (answer === 'f') return 'f';
  if (answer === 'h' || answer === 'fh') return 'h';
  if (answer === 'e') return 'e';
  if (answer === 's') return 's';
  return 'c';
}

/** Prompt for fix hint */
async function promptFixHint(): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = await new Promise<string>((resolve) => {
    rl.question(`${chalk.yellow('Enter hint (or Enter for auto-fix):')}`, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (hint === '') return null; // Cancel
  return hint;
}

/** Clean AI response to extract pure command */
function extractCommand(raw: string): string {
  // Remove common prefixes
  let cleaned = raw.replace(/^Suggested\s*fix:?\s*/i, '');
  // Remove lines that look like errors or explanations
  cleaned = cleaned.split('\n').filter(line => {
    const trimmed = line.trim();
    // Skip error lines
    if (trimmed.startsWith('Error:')) return false;
    if (trimmed.match(/^exit\s+code:/i)) return false;
    // Skip lines that look like explanations
    if (trimmed.match(/^(The|This|So|For|If|Please|Output)/i)) return false;
    return true;
  }).join('\n');
  // Trim
  cleaned = cleaned.trim();
  // Remove any markdown code blocks
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  return cleaned;
}

/** Fix step without hint. Reuses the caller's executor so cwd state carries
 *  forward — creating a fresh executor here would reset cwd to process.cwd(),
 *  causing the fixed command to run in the wrong directory. */
async function fixStep(
  client: AIClient,
  step: Step,
  error: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  executor: StepExecutor,
): Promise<ExecutionResult | null> {
  console.log();
  console.log(`${chalk.cyan('Fixing...')}`);

  const fixPrompt = `The following command failed:
${step.command}
Error: ${error}

Please generate a fixed version of this command that will work correctly. Output only the command, no explanation.`;

  try {
    const fixResult = await client.generate(fixPrompt, shell, config.language);
    const cleanedCommand = extractCommand(fixResult.command);
    step.command = cleanedCommand;
    console.log(`  ${chalk.yellow('→')} ${summarizeStep(cleanedCommand)}`);

    const result = await executor.executeStep(step);
    if (result.success) return result;

    console.log(`  ${chalk.red('✗')} Failed: ${result.error}`);
    return null;
  } catch (err: any) {
    console.log(`  ${chalk.red('✗')} Failed: ${err.message}`);
    return null;
  }
}

/** Fix step with user hint. Same executor-reuse rationale as fixStep. */
async function fixStepWithHint(
  client: AIClient,
  step: Step,
  error: string,
  hint: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  executor: StepExecutor,
): Promise<ExecutionResult | null> {
  console.log();
  console.log(`${chalk.cyan('Fixing with hint...')}`);

  const fixPrompt = `The following command failed:
${step.command}
Error: ${error}

User hint: ${hint}

Please generate a fixed version of this command that will work correctly. Output only the command, no explanation.`;

  try {
    const fixResult = await client.generate(fixPrompt, shell, config.language);
    const cleanedCommand = extractCommand(fixResult.command);
    step.command = cleanedCommand;
    console.log(`  ${chalk.yellow('→')} ${summarizeStep(cleanedCommand)}`);

    const result = await executor.executeStep(step);
    if (result.success) return result;

    console.log(`  ${chalk.red('✗')} Failed: ${result.error}`);
    return null;
  } catch (err: any) {
    console.log(`  ${chalk.red('✗')} Failed: ${err.message}`);
    return null;
  }
}

/** Improve script based on user feedback */
async function improveScript(
  client: AIClient,
  originalDescription: string,
  shell: ShellType,
  config: ReturnType<typeof loadConfig>,
  currentSteps: Step[],
): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const feedback = await new Promise<string>((resolve) => {
    rl.question(`${chalk.yellow('What would you like to improve?')}\n  > `, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

  if (!feedback) {
    console.log(`  ${chalk.gray('Cancelled')}`);
    return;
  }

  // Build current script for context
  const currentScript = currentSteps.map(s => `Step ${s.index}: ${s.command}`).join('\n');

  const improvePrompt = `The user wants to improve this script:

${currentScript}

Feedback: ${feedback}

Please generate an improved version of the script based on the feedback. Output format:
Step 1: <command>
Step 2: <command>
...`;

  const spinner = await startSpinner('Updating script...');

  try {
    const result = await client.script(
      `${originalDescription}\n\nCurrent script:\n${currentScript}\n\nFeedback: ${feedback}`,
      shell,
      config.language,
    );
    spinner.stop();

    if (result.steps.length > 0) {
      displaySteps(result.steps);
      // Update the steps and show menu again
      await interactiveScriptMenu(client, originalDescription, shell, config, result.steps, result.risk);
    } else {
      await displayError('Failed to update script');
    }
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to update script');
  }
}
