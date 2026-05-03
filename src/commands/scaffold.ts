import type { ScaffoldOptions, ShellType, RiskLevel } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { checkDanger } from '../core/danger';
import { collectScaffoldContext } from '../core/scaffoldContext';
import { SHELL_SCRIPT_EXT } from '../core/prompt';
import { loadConfig } from '../utils/config';
import { copyToClipboard } from '../utils/clipboard';
import { addHistory } from '../utils/history';
import { displayScaffold, displayError, displaySuccess, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';

export async function scaffoldCommand(intent: string, options: ScaffoldOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: false }))) return;
  const config = loadConfig();
  const shell: ShellType = options.shell || detectShell() || config.shell;

  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  const ctx = config.context_enable
    ? collectScaffoldContext({ historyLines: config.context_history_lines })
    : undefined;

  console.log();
  console.log(`  ${chalk.yellow('⚠')}  ${chalk.yellow('wts scaffold')} ${chalk.gray('is deprecated and will be removed in a future release.')}`);
  console.log(`     ${chalk.gray('Use')} ${chalk.cyan('wts g --script "<intent>"')} ${chalk.gray('instead — same workflow, with cwd tracking, step-by-step, fix-on-failure.')}`);
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.hex('#ff8c00')('[scaffold]')} ${chalk.gray('─'.repeat(46))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.white(intent)}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('shell:')} ${chalk.cyan(shell)}`);
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  const spinner = await startSpinner('Drafting...');

  try {
    const result = await client.scaffold(intent, shell, config.language, ctx);
    spinner.stop();

    const { risk, warning } = aggregateRisk(result.command, shell, result.risk, result.warning, config.language);
    await displayScaffold(result.command, risk, warning);

    addHistory({ type: 'scaffold', input: intent, output: result.command });

    await interactiveScaffoldMenu(result.command, shell);
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to generate scaffold');
  }
}

// ---------- internals ----------

function aggregateRisk(
  body: string,
  shell: ShellType,
  modelRisk: RiskLevel,
  modelWarning: string | undefined,
  language: 'zh' | 'en',
): { risk: RiskLevel; warning?: string } {
  let highest: RiskLevel = modelRisk;
  const warnings: string[] = [];
  if (modelWarning) warnings.push(modelWarning);

  for (const { line, lineNum } of executableLines(body, shell)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const c = checkDanger(trimmed, language);
    if (c.risk === 'danger') {
      highest = 'danger';
      if (c.warnings.length > 0) warnings.push(`L${lineNum}: ${c.warnings.join('; ')}`);
    } else if (c.risk === 'warning' && highest !== 'danger') {
      highest = 'warning';
      if (c.warnings.length > 0) warnings.push(`L${lineNum}: ${c.warnings.join('; ')}`);
    }
  }

  return {
    risk: highest,
    warning: warnings.length > 0 ? warnings.join(' · ') : undefined,
  };
}

/**
 * Yield script lines that are actual command lines (not heredoc/here-string
 * payloads). Bash/zsh `<<EOF...EOF` bodies and PowerShell `@'...'@` /
 * `@"..."@` bodies carry file content, not commands — danger rules must NOT
 * fire on them, otherwise scaffolding a README that mentions `rm -rf /` as a
 * warning would mark the whole scaffold dangerous.
 *
 * The opener line is yielded (it carries `cat > foo <<'EOF'` etc. which IS a
 * command and may itself need scanning). The closing delimiter line is
 * skipped — it's just `EOF` / `'@`.
 */
function* executableLines(body: string, shell: ShellType): Generator<{ line: string; lineNum: number }> {
  const lines = body.split('\n');
  let bashHeredoc: { delim: string; allowTabs: boolean } | null = null;
  let psHereQuote: '"' | "'" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inside bash/zsh heredoc body — wait for closing delimiter, skip content.
    if (bashHeredoc) {
      const candidate = bashHeredoc.allowTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === bashHeredoc.delim) bashHeredoc = null;
      continue;
    }

    // Inside PowerShell here-string body — wait for `'@ or `"@ at line start.
    if (psHereQuote) {
      const closer = psHereQuote === "'" ? /^\s*'@/ : /^\s*"@/;
      if (closer.test(line)) psHereQuote = null;
      continue;
    }

    // Detect bash/zsh heredoc opener; yield the OPEN line (it carries a command).
    if (shell === 'bash' || shell === 'zsh') {
      const m = line.match(/<<(-?)\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
      if (m) {
        bashHeredoc = { delim: m[2], allowTabs: m[1] === '-' };
        yield { line, lineNum: i + 1 };
        continue;
      }
    }

    // Detect PowerShell here-string opener; yield the OPEN line.
    if (shell === 'powershell') {
      const m = line.match(/@(['"])\s*$/);
      if (m) {
        psHereQuote = m[1] as '"' | "'";
        yield { line, lineNum: i + 1 };
        continue;
      }
    }

    yield { line, lineNum: i + 1 };
  }
}

async function interactiveScaffoldMenu(body: string, shell: ShellType): Promise<void> {
  const prompts = await import('@inquirer/prompts');

  const choices = [
    { name: `${chalk.cyan('Save')} as a file`, value: 'save' },
    { name: `${chalk.yellow('Copy')} to clipboard`, value: 'copy' },
    { name: chalk.gray('Cancel'), value: 'cancel' },
  ];

  let action: string;
  try {
    action = await prompts.select({
      message: 'What would you like to do?',
      choices,
    });
  } catch (err: any) {
    if (isCancelled(err)) {
      console.log();
      console.log(`  ${chalk.gray('Cancelled')}`);
      console.log();
      return;
    }
    throw err;
  }

  switch (action) {
    case 'save':
      await saveScaffold(body, shell, prompts);
      break;
    case 'copy': {
      const ok = await copyToClipboard(body);
      if (ok) await displaySuccess('Copied to clipboard');
      else await displayError('Failed to copy to clipboard');
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

async function saveScaffold(body: string, shell: ShellType, prompts: any): Promise<void> {
  const ext = SHELL_SCRIPT_EXT[shell] || 'sh';
  const hint = extractFilenameHint(body);
  const defaultName = hint || `wts-scaffold.${ext}`;

  let filename: string;
  try {
    filename = (await prompts.input({
      message: 'Save as:',
      default: defaultName,
    })).trim();
  } catch (err: any) {
    if (isCancelled(err)) {
      console.log(`  ${chalk.gray('Cancelled')}`);
      return;
    }
    throw err;
  }

  if (!filename) {
    console.log(`  ${chalk.gray('Cancelled')}`);
    return;
  }

  const target = path.resolve(filename);

  if (fs.existsSync(target)) {
    let overwrite = false;
    try {
      overwrite = await prompts.confirm({
        message: `${target} exists. Overwrite?`,
        default: false,
      });
    } catch (err: any) {
      if (isCancelled(err)) {
        console.log(`  ${chalk.gray('Cancelled')}`);
        return;
      }
      throw err;
    }
    if (!overwrite) {
      console.log(`  ${chalk.gray('Cancelled')}`);
      return;
    }
  }

  try {
    fs.writeFileSync(target, body, 'utf-8');
    if (process.platform !== 'win32') {
      try { fs.chmodSync(target, 0o755); } catch { /* ignore */ }
    }
    await displaySuccess(`Saved to ${target}`);
  } catch (err: any) {
    await displayError(`Failed to save: ${err.message}`);
  }
}

function extractFilenameHint(body: string): string | undefined {
  // Match "# filename: foo.sh" anywhere in the first 5 lines (shebang occupies line 1).
  const head = body.split('\n').slice(0, 5).join('\n');
  const m = head.match(/^\s*#\s*filename:\s*(\S+)/m);
  return m ? m[1] : undefined;
}

function isCancelled(err: any): boolean {
  if (!err) return false;
  const name = String(err.name || '');
  if (name === 'ExitPromptError' || name === 'AbortPromptError' || name === 'AbortError') return true;
  return /User force closed/i.test(String(err.message || ''));
}
