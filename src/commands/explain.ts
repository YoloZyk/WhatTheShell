import type { ExplainOptions, DetailLevel, ContextSnapshot, WtsConfig } from '../types';
import * as path from 'path';
import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { detectFileLang, looksLikeFilePath, readSafeFile } from '../core/file';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import {
  displayExplanation,
  displayFileExplanation,
  displayError,
  startSpinner,
} from '../utils/display';
import { ensureApiKey } from './init';

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
    const r = readSafeFile(options.file);
    if (!r.ok) {
      await displayError(r.reason);
      process.exitCode = 1;
      return;
    }
    await runFileExplain(client, config, ctx, level, r.filePath, r.content);
    return;
  }

  if (looksLikeFilePath(arg)) {
    const r = readSafeFile(arg);
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
      result.issues,
    );

    // 历史记录：input 用 <file:basename> 标识，summary 留作快速回顾
    addHistory({ type: 'explain', input: `<file:${filename}>`, output: result.summary });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to explain file');
  }
}
