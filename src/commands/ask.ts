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
