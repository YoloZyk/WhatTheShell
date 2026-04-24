import type { ExplainOptions, DetailLevel } from '../types';
import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { checkDanger } from '../core/danger';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import { displayExplanation, displayError, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';

export async function explainCommand(command: string, options: ExplainOptions): Promise<void> {
  if (!(await ensureApiKey({ inline: false }))) return;
  const config = loadConfig();

  const level: DetailLevel = options.brief ? 'brief' : options.detail ? 'detail' : 'normal';
  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  const ctx = config.context_enable
    ? collectContext({ historyLines: config.context_history_lines })
    : undefined;

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

    // record history
    addHistory({ type: 'explain', input: command, output: result.summary });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to explain command');
  }
}
