import chalk from 'chalk';
import { AIClient } from '../core/ai';
import { collectContext } from '../core/context';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import { displayAnswer, displayError, startSpinner } from '../utils/display';
import { ensureApiKey } from './init';

export async function askCommand(question: string): Promise<void> {
  if (!(await ensureApiKey({ inline: false }))) return;
  const config = loadConfig();

  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  const ctx = config.context_enable
    ? collectContext({ historyLines: config.context_history_lines })
    : undefined;

  // Show input header
  console.log(`${chalk.cyan('┌─')} ${chalk.magenta('[ask]')} ${chalk.gray('─'.repeat(50))}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('>')} ${chalk.white(question)}`);
  console.log(`${chalk.cyan('├─')} ${chalk.gray('─'.repeat(56))}`);

  const spinner = await startSpinner('Thinking...');

  try {
    const answer = await client.ask(question, config.language, ctx);
    spinner.stop();

    await displayAnswer(answer);

    // record history
    addHistory({ type: 'ask', input: question, output: answer });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || 'Failed to answer question');
  }
}
