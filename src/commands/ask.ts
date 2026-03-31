import { AIClient } from '../core/ai';
import { loadConfig } from '../utils/config';
import { addHistory } from '../utils/history';
import { displayAnswer, displayError, startSpinner } from '../utils/display';

export async function askCommand(question: string): Promise<void> {
  const config = loadConfig();

  if (!config.api_key) {
    await displayError('API Key 未设置，请先运行: wts config set api_key <your-key>');
    return;
  }

  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);
  const spinner = await startSpinner('正在思考...');

  try {
    const answer = await client.ask(question, config.language);
    spinner.stop();

    await displayAnswer(answer);

    // 记录历史
    addHistory({ type: 'ask', input: question, output: answer });
  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || '回答问题失败');
  }
}
