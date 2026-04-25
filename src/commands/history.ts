import type { HistoryEntry, RiskLevel } from '../types';
import chalk from 'chalk';
import * as readline from 'readline';
import { getHistory, clearHistory, searchHistory } from '../utils/history';
import { displaySuccess, displayError } from '../utils/display';
import { copyToClipboard } from '../utils/clipboard';
import { runCommand } from './generate';
import { checkDanger } from '../core/danger';
import { loadConfig } from '../utils/config';

const SCAFFOLD_COLOR = chalk.hex('#ff8c00');

const TYPE_COLORS: Record<HistoryEntry['type'], (s: string) => string> = {
  generate: chalk.green,
  explain: chalk.cyan,
  ask: chalk.magenta,
  scaffold: SCAFFOLD_COLOR,
  // Legacy alias — entries written before the script→scaffold rename. Same color.
  script: SCAFFOLD_COLOR,
};

/** Display label for a history entry type — collapses legacy 'script' onto 'scaffold'. */
function typeLabel(type: HistoryEntry['type']): string {
  return type === 'script' ? 'scaffold' : type;
}

export async function historyCommand(options: { clear?: boolean }): Promise<void> {
  if (options.clear) {
    clearHistory();
    await displaySuccess('History cleared');
    return;
  }

  const entries = getHistory();
  if (entries.length === 0) {
    renderEmpty();
    return;
  }

  // Non-TTY (piped/redirected) → static list, preserves prior behavior for scripting
  if (!process.stdout.isTTY) {
    renderStaticList(entries);
    return;
  }

  await runInteractivePicker(entries);
}

// ---------- rendering ----------

function renderEmpty(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(54))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('(no history yet)')}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray('Commands you run will appear here')}`);
  console.log();
}

function renderStaticList(entries: HistoryEntry[]): void {
  const reversed = [...entries].reverse();
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(54))}`);
  for (const entry of reversed) {
    const typeFn = TYPE_COLORS[entry.type] || chalk.white;
    const typeRaw = `[${typeLabel(entry.type)}]`.padEnd(11);
    const inputRaw = visualTruncate(entry.input, 50);
    console.log(`${chalk.cyan('│')}  ${typeFn(typeRaw)} ${chalk.gray(inputRaw)}`);
  }
  const clearCmd = chalk.cyan('wts history --clear');
  console.log(`${chalk.cyan('└─')} ${chalk.gray(`${entries.length} entries · run ${clearCmd} to wipe`)}`);
  console.log();
}

function renderHeader(total: number): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(54))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray(`${total} entries · type to filter · ↑↓ navigate · Enter select · Esc cancel`)}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray('─'.repeat(60))}`);
}

function formatRow(entry: HistoryEntry): string {
  const typeFn = TYPE_COLORS[entry.type] || chalk.white;
  const typeRaw = `[${typeLabel(entry.type)}]`.padEnd(11);
  const inputRaw = visualPadEnd(visualTruncate(entry.input, 38), 40);
  const timeRaw = relativeTime(entry.timestamp).padEnd(13);
  const previewRaw = visualTruncate(entry.output.replace(/\s+/g, ' '), 35);
  // Type prefix carries semantic color; keep the rest of the row uncolored so
  // the active row's bgCyan highlight reads cleanly across the whole line.
  return `${typeFn(typeRaw)}  ${inputRaw}  ${timeRaw}  ${previewRaw}`;
}

function showDetailPanel(entry: HistoryEntry): void {
  const config = loadConfig();
  const isScaffold = entry.type === 'scaffold' || entry.type === 'script';

  // generate: stored output IS the command. scaffold/script: stored output IS the script body.
  // explain: input is the command being explained. ask: free-form Q&A, no command involved.
  let risk: RiskLevel = 'safe';
  let warning: string | undefined;
  if (entry.type === 'generate' || isScaffold) {
    const check = checkDanger(entry.output, config.language);
    risk = check.risk;
    if (check.warnings.length > 0) warning = check.warnings.join('; ');
  } else if (entry.type === 'explain') {
    const check = checkDanger(entry.input, config.language);
    risk = check.risk;
    if (check.warnings.length > 0) warning = check.warnings.join('; ');
  }

  const borderFn = risk === 'danger' ? chalk.red
                 : risk === 'warning' ? chalk.yellow
                 : chalk.cyan;
  const labelFn = risk === 'danger' ? chalk.bgRed.white.bold
                : risk === 'warning' ? chalk.bgYellow.black.bold
                : (TYPE_COLORS[entry.type] || chalk.white);
  const warnFn = risk === 'danger' ? chalk.red
               : risk === 'warning' ? chalk.yellow
               : chalk.white;

  let headerLabel = `${typeLabel(entry.type)} · ${relativeTime(entry.timestamp)}`;
  if (risk === 'danger') headerLabel += ' ⚠ DANGER';
  else if (risk === 'warning') headerLabel += ' ! CAUTION';

  const labelLen = headerLabel.length + 4;
  const lineLen = Math.max(1, 60 - labelLen);

  console.log();
  console.log(`${borderFn('┌─')} ${labelFn(headerLabel)} ${chalk.gray('─'.repeat(lineLen))}`);
  if (warning) {
    console.log(`${borderFn('│')}  ${warnFn(warning)}`);
  }
  console.log(`${borderFn('│')}  ${chalk.gray('>')} ${chalk.white(entry.input)}`);
  console.log(`${borderFn('│')}`);

  const outputLabel = entry.type === 'generate' ? 'Command:'
                    : isScaffold ? 'Scaffold:'
                    : entry.type === 'explain' ? 'Summary:'
                    : 'Answer:';
  console.log(`${borderFn('│')}  ${chalk.gray(outputLabel)}`);
  for (const line of entry.output.split('\n')) {
    let styled: string;
    if (isScaffold) {
      const isComment = line.trim().startsWith('#');
      styled = isComment ? chalk.gray(line) : chalk.green.bold(line);
    } else {
      styled = entry.type === 'generate' ? chalk.green.bold(line) : chalk.white(line);
    }
    console.log(`${borderFn('│')}    ${styled}`);
  }

  console.log(`${borderFn('└─')} ${chalk.gray('─'.repeat(58))}`);
  console.log();
}

// ---------- interactive picker ----------

const PICKER_THEME = {
  style: {
    highlight: (text: string) => chalk.bgCyan.bold(text),
  },
};

async function runInteractivePicker(entries: HistoryEntry[]): Promise<void> {
  const prompts = await import('@inquirer/prompts');

  renderHeader(entries.length);

  const pickedId = await pickWithEsc<number>(signal =>
    prompts.search<number>(
      {
        message: 'Search:',
        source: async (input?: string) => {
          const matched = input ? searchHistory(input) : entries;
          return [...matched].reverse().map(entry => ({
            name: formatRow(entry),
            value: entry.id,
          }));
        },
        theme: PICKER_THEME,
      },
      { signal },
    ),
  );

  if (pickedId === null) {
    console.log(`  ${chalk.gray('Cancelled')}`);
    return;
  }

  const entry = entries.find(e => e.id === pickedId);
  if (!entry) return;

  showDetailPanel(entry);

  const action = await pickAction(entry, prompts);
  await applyAction(action, entry);
}

async function pickAction(entry: HistoryEntry, prompts: any): Promise<string> {
  const choices: Array<{ name: string; value: string }> = [];

  if (entry.type === 'generate') {
    choices.push({
      name: `${chalk.green('Run again')}     ${chalk.gray('execute the stored command')}`,
      value: 'run',
    });
    choices.push({
      name: `${chalk.cyan('Copy command')}  ${chalk.gray('to clipboard')}`,
      value: 'copy_output',
    });
  } else if (entry.type === 'scaffold' || entry.type === 'script') {
    choices.push({
      name: `${chalk.cyan('Copy scaffold')} ${chalk.gray('to clipboard')}`,
      value: 'copy_output',
    });
  } else if (entry.type === 'explain') {
    choices.push({
      name: `${chalk.cyan('Copy command')}  ${chalk.gray('the original input')}`,
      value: 'copy_input',
    });
  } else if (entry.type === 'ask') {
    choices.push({
      name: `${chalk.cyan('Copy answer')}   ${chalk.gray('to clipboard')}`,
      value: 'copy_output',
    });
  }
  choices.push({ name: chalk.gray('Cancel'), value: 'cancel' });

  const action = await pickWithEsc<string>(signal =>
    prompts.select(
      {
        message: 'Action:',
        choices,
      },
      { signal },
    ),
  );
  return action ?? 'cancel';
}

async function applyAction(action: string, entry: HistoryEntry): Promise<void> {
  if (action === 'cancel') {
    console.log(`  ${chalk.gray('Cancelled')}`);
    return;
  }

  if (action === 'run') {
    const config = loadConfig();
    const localCheck = checkDanger(entry.output, config.language);
    if (localCheck.risk === 'danger') {
      await displayError('This command was flagged dangerous; will not auto-run');
      return;
    }
    await runCommand(entry.output);
    return;
  }

  if (action === 'copy_output') {
    const ok = await copyToClipboard(entry.output);
    if (ok) await displaySuccess('Copied to clipboard');
    else await displayError('Failed to copy to clipboard');
    return;
  }

  if (action === 'copy_input') {
    const ok = await copyToClipboard(entry.input);
    if (ok) await displaySuccess('Copied to clipboard');
    else await displayError('Failed to copy to clipboard');
    return;
  }
}

// ---------- Esc-cancel wrapper ----------

/**
 * Run an inquirer prompt with Esc bound to cancel. @inquirer/prompts 8.x only
 * binds Ctrl+C natively; this attaches a stdin keypress listener that aborts
 * the supplied AbortSignal when the user hits Esc, then catches the resulting
 * AbortPromptError and returns null.
 */
async function pickWithEsc<T>(runner: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
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

// ---------- helpers ----------

/** Return the column count a string takes when rendered to a monospace terminal. */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
      // C0/C1 control chars — skip
      continue;
    }
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function visualPadEnd(s: string, target: number): string {
  const pad = target - visualWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

function visualTruncate(s: string, max: number): string {
  if (visualWidth(s) <= max) return s;
  let w = 0;
  let result = '';
  for (const ch of s) {
    const chW = visualWidth(ch);
    if (w + chW > max - 1) break;
    result += ch;
    w += chW;
  }
  return result + '…';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return iso.slice(0, 10);
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return 'just now';
  if (min < 60) return `${min} min${min > 1 ? 's' : ''} ago`;
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  return iso.slice(0, 10);
}

function isCancelled(err: any): boolean {
  if (!err) return false;
  const name = String(err.name || '');
  if (name === 'ExitPromptError' || name === 'AbortPromptError' || name === 'AbortError') return true;
  return /User force closed/i.test(String(err.message || ''));
}
