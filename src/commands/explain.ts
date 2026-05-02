import type { ExplainOptions, DetailLevel, ShellType, ContextSnapshot, WtsConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { SHELL_DANGER_EXAMPLES } from '../core/prompt';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import {
  displayExplanation,
  displayFileExplanation,
  displayError,
  startSpinner,
} from '../utils/display';
import { ensureApiKey } from './init';

/**
 * 自动检测时接受的扩展名（无路径分隔符的情况下）。
 * 涵盖 shell + 主流代码 + 配置/标记 + 文档。
 */
const CODE_FILE_EXT_RE = /\.(sh|bash|zsh|fish|ps1|psm1|py|pyw|js|mjs|cjs|jsx|ts|tsx|java|kt|kts|go|rs|rb|php|swift|c|h|cc|cpp|hpp|hxx|cxx|cs|lua|dart|scala|sql|yml|yaml|toml|json|xml|html|htm|css|scss|less|md|markdown|txt|rst)$/i;

/** 无扩展名但常见的项目文件 basename（含 .dev / .am 等后缀变体） */
const KNOWN_BASENAME_RE = /^(Dockerfile|Containerfile|Makefile|GNUmakefile|Rakefile|Gemfile|Procfile|Brewfile|Vagrantfile)(\..+)?$/i;

const MAX_FILE_BYTES = 100 * 1024;

/** 文件路径 vs 命令字符串判别。
 *  - 含路径分隔符 → 文件
 *  - 整 basename 命中代码文件后缀白名单 → 文件
 *  - basename 命中 well-known 项目文件名（Dockerfile / Makefile 等）→ 文件
 *  - 其余 → 命令
 */
function looksLikeFilePath(s: string): boolean {
  if (s.includes('/') || s.includes('\\')) return true;
  if (CODE_FILE_EXT_RE.test(s)) return true;
  if (KNOWN_BASENAME_RE.test(s)) return true;
  return false;
}

interface FileLang {
  /** shell 类沿用 SHELL_DANGER_EXAMPLES 提升危险检测精度；其他都标 code */
  kind: 'shell' | 'code';
  /** 给 prompt 看的人类可读语言标签（如 "python" / "bash" / "yaml"） */
  label: string;
  /** kind === 'shell' 时填，用于本地 danger fallback 的 shell-specific 规则 */
  shell?: ShellType;
  /** shell 文件传给 prompt 的精度提示；非 shell 留空 */
  shellRiskHint?: { danger: string; caution: string };
}

/** 扩展名/basename → label 的映射（不含 shell 那 4 种，单独处理） */
const EXT_TO_LABEL: Record<string, string> = {
  py: 'python', pyw: 'python',
  js: 'javascript', mjs: 'javascript (esm)', cjs: 'javascript (cjs)',
  jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  c: 'c', h: 'c/c++ header',
  cc: 'c++', cpp: 'c++', hpp: 'c++ header', hxx: 'c++ header', cxx: 'c++',
  cs: 'c#',
  lua: 'lua', dart: 'dart', scala: 'scala', sql: 'sql',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', json: 'json', xml: 'xml',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', txt: 'plain text', rst: 'restructuredtext',
};

function shellLang(shell: ShellType): FileLang {
  return { kind: 'shell', label: shell, shell, shellRiskHint: SHELL_DANGER_EXAMPLES[shell] };
}

/**
 * 根据 filename 推断语言：
 *   - .ps1/.psm1 → powershell；.zsh → zsh；.fish → fish；.sh/.bash → bash（shell 类）
 *   - 其他扩展名查 EXT_TO_LABEL（code 类）
 *   - basename 是 Dockerfile / Makefile / Rakefile / Gemfile / Procfile（含变体） → code
 *   - 都不命中（无扩展名 / 未识别）→ 兜底视为 fallback shell（保留 shell-specific 风险检测）
 */
function detectFileLang(filename: string, fallback: ShellType): FileLang {
  const base = path.basename(filename);
  const lower = base.toLowerCase();

  if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return shellLang('powershell');
  if (lower.endsWith('.zsh')) return shellLang('zsh');
  if (lower.endsWith('.fish')) return shellLang('fish');
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return shellLang('bash');

  const m = lower.match(/\.([a-z0-9]+)$/);
  if (m && EXT_TO_LABEL[m[1]]) {
    return { kind: 'code', label: EXT_TO_LABEL[m[1]] };
  }

  // well-known 无扩展名 basename
  if (/^(Dockerfile|Containerfile)(\..+)?$/i.test(base)) {
    return { kind: 'code', label: 'dockerfile' };
  }
  if (/^(Makefile|GNUmakefile)(\..+)?$/i.test(base)) {
    return { kind: 'code', label: 'makefile' };
  }
  if (/^Rakefile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Rakefile)' };
  if (/^Gemfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Gemfile)' };
  if (/^Procfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'procfile' };
  if (/^Brewfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Brewfile)' };
  if (/^Vagrantfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Vagrantfile)' };

  return shellLang(fallback);
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
    await runFileExplain(client, config, ctx, level, r.filePath, r.content);
    return;
  }

  if (looksLikeFilePath(arg)) {
    const r = readScriptFile(arg);
    if (r.ok) {
      await runFileExplain(client, config, ctx, level, r.filePath, r.content);
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

async function runFileExplain(
  client: AIClient,
  config: WtsConfig,
  ctx: ContextSnapshot | undefined,
  level: DetailLevel,
  filePath: string,
  content: string,
): Promise<void> {
  const filename = path.basename(filePath);
  const fileLang = detectFileLang(filename, config.shell);
  const lineCount = content.split('\n').length;

  // header
  console.log(`${chalk.cyan('┌─')} ${chalk.cyan('[explain file]')} ${chalk.gray('─'.repeat(41))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.green(filePath)}`);
  console.log(
    `${chalk.cyan('│')}  ${chalk.gray('lang:')} ${chalk.cyan(fileLang.label)}  ` +
    `${chalk.gray('lines:')} ${chalk.cyan(String(lineCount))}  ` +
    `${chalk.gray('mode:')} ${chalk.cyan(level)}`,
  );
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  const spinner = await startSpinner('Parsing file...');

  try {
    const result = await client.explainFile(
      content,
      filename,
      fileLang.label,
      level,
      config.language,
      ctx,
      fileLang.shellRiskHint,
    );
    spinner.stop();

    // 本地 danger 检测兜底：仅 shell 类有效（checkDanger 是 shell-specific 规则）
    let finalRisk = result.risk;
    let finalWarning = result.warning;
    if (fileLang.kind === 'shell') {
      const localCheck = checkDanger(content, config.language);
      finalRisk = localCheck.risk === 'danger' ? 'danger'
        : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
        : result.risk;
      finalWarning = localCheck.warnings.length > 0
        ? localCheck.warnings.join('; ')
        : result.warning;
    }

    await displayFileExplanation(
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
    await displayError(err.message || 'Failed to explain file');
  }
}
