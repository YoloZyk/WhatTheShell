import type { ExplainOptions, DetailLevel, ShellType, ContextSnapshot, WtsConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import {
  displayExplanation,
  displayScriptExplanation,
  displayError,
  startSpinner,
} from '../utils/display';
import { ensureApiKey } from './init';

/** 自动检测时只接受这几种扩展名（无路径分隔符的情况下） */
const SCRIPT_EXT_RE = /\.(sh|bash|zsh|fish|ps1|psm1)$/i;
const MAX_FILE_BYTES = 100 * 1024;

function looksLikePath(s: string): boolean {
  if (s.includes('/') || s.includes('\\')) return true;
  if (SCRIPT_EXT_RE.test(s)) return true;
  return false;
}

function detectShellFromFilename(filename: string, fallback: ShellType): ShellType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return 'powershell';
  if (lower.endsWith('.zsh')) return 'zsh';
  if (lower.endsWith('.fish')) return 'fish';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash';
  return fallback;
}

type ReadResult =
  | { ok: true; filePath: string; content: string }
  | { ok: false; reason: string };

/**
 * 把参数当文件路径试读：
 *   - 必须是 regular file
 *   - ≤ 100 KB
 *   - 前 1KB 不含 NUL byte（粗略二进制检测）
 * 任意一项不满足就返回 reason，由调用方决定报错还是回退到命令模式。
 */
function readScriptFile(p: string): ReadResult {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch (e: any) {
    return { ok: false, reason: `cannot stat ${p}: ${e.code || e.message}` };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: `${p} is not a regular file` };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `${p} is ${(stat.size / 1024).toFixed(1)} KB, larger than the 100 KB limit. Trim it down or split before running explain.`,
    };
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(p);
  } catch (e: any) {
    return { ok: false, reason: `cannot read ${p}: ${e.code || e.message}` };
  }
  const probe = buf.subarray(0, Math.min(1024, buf.length));
  if (probe.includes(0)) {
    return {
      ok: false,
      reason: `${p} appears to be binary (NUL byte found). Refusing to send to AI.`,
    };
  }
  return { ok: true, filePath: p, content: buf.toString('utf8') };
}

export async function explainCommand(arg: string, options: ExplainOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: false }))) return;
  const config = loadConfig();

  const level: DetailLevel = options.brief ? 'brief' : options.detail ? 'detail' : 'normal';
  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  const ctx = config.context_enable
    ? collectContext({ historyLines: config.context_history_lines })
    : undefined;

  // 路由：1) --file 强制 2) arg 看起来像路径且能读 3) 否则命令模式
  if (options.file !== undefined) {
    const r = readScriptFile(options.file);
    if (!r.ok) {
      await displayError(r.reason);
      process.exitCode = 1;
      return;
    }
    await runScriptExplain(client, config, ctx, level, r.filePath, r.content);
    return;
  }

  if (looksLikePath(arg)) {
    const r = readScriptFile(arg);
    if (r.ok) {
      await runScriptExplain(client, config, ctx, level, r.filePath, r.content);
      return;
    }
    // 路径形态但读不了：debug 模式下提示，否则静默回退到命令模式
    if (process.env.DEBUG_WTS) {
      console.error(`[wts e] file detection failed: ${r.reason}; falling back to command mode`);
    }
  }

  await runCommandExplain(client, config, ctx, level, arg);
}

async function runCommandExplain(
  client: AIClient,
  config: WtsConfig,
  ctx: ContextSnapshot | undefined,
  level: DetailLevel,
  command: string,
): Promise<void> {
  // Show input header
  console.log(`${chalk.cyan('┌─')} ${chalk.cyan('[explain]')} ${chalk.gray('─'.repeat(46))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.green(command)}`);
  if (level !== 'normal') {
    console.log(`${chalk.cyan('│')}  ${chalk.gray('mode:')} ${chalk.cyan(level)}`);
  }
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  const spinner = await startSpinner('Parsing command...');

  try {
    const result = await client.explain(command, level, config.language, ctx);
    spinner.stop();

    // local-rule fallback check
    const localCheck = checkDanger(command, config.language);
    const finalRisk = localCheck.risk === 'danger' ? 'danger'
      : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
      : result.risk;
    const finalWarning = localCheck.warnings.length > 0
      ? localCheck.warnings.join('; ')
      : result.warning;

    await displayExplanation(result.segments, result.summary, finalRisk, finalWarning);

    addHistory({ type: 'explain', input: command, output: result.summary });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to explain command');
  }
}

async function runScriptExplain(
  client: AIClient,
  config: WtsConfig,
  ctx: ContextSnapshot | undefined,
  level: DetailLevel,
  filePath: string,
  content: string,
): Promise<void> {
  const filename = path.basename(filePath);
  const shell: ShellType = detectShellFromFilename(filename, config.shell);
  const lineCount = content.split('\n').length;

  // header
  console.log(`${chalk.cyan('┌─')} ${chalk.cyan('[explain file]')} ${chalk.gray('─'.repeat(41))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.green(filePath)}`);
  console.log(
    `${chalk.cyan('│')}  ${chalk.gray('shell:')} ${chalk.cyan(shell)}  ` +
    `${chalk.gray('lines:')} ${chalk.cyan(String(lineCount))}  ` +
    `${chalk.gray('mode:')} ${chalk.cyan(level)}`,
  );
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  const spinner = await startSpinner('Parsing script...');

  try {
    const result = await client.explainScript(content, filename, shell, level, config.language, ctx);
    spinner.stop();

    // 本地 danger 检测兜底（脚本里某一行触发危险规则就强制升级）
    const localCheck = checkDanger(content, config.language);
    const finalRisk = localCheck.risk === 'danger' ? 'danger'
      : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
      : result.risk;
    const finalWarning = localCheck.warnings.length > 0
      ? localCheck.warnings.join('; ')
      : result.warning;

    await displayScriptExplanation(
      filename,
      result.sections,
      result.summary,
      finalRisk,
      finalWarning,
    );

    // 历史记录：input 用 <file:basename> 标识，summary 留作快速回顾
    addHistory({ type: 'explain', input: `<file:${filename}>`, output: result.summary });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to explain script');
  }
}
