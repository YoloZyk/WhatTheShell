import type { GenerateOptions, ShellType } from '../types';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { checkDanger } from '../core/danger';
import { loadConfig } from '../utils/config';
import { copyToClipboard } from '../utils/clipboard';
import { addHistory } from '../utils/history';
import { displayCommand, displayError, displaySuccess, displayActions, startSpinner } from '../utils/display';
import * as readline from 'readline';
import { exec } from 'child_process';

export async function generateCommand(description: string, options: GenerateOptions): Promise<void> {
  const config = loadConfig();

  if (!config.api_key) {
    await displayError('API Key 未设置，请先运行: wts config set api_key <your-key>');
    return;
  }

  const shell: ShellType = options.shell || config.shell || detectShell();
  const client = new AIClient(config.provider, config.api_key, config.model, config.base_url);

  const spinner = await startSpinner('正在生成命令...');

  try {
    const result = await client.generate(description, shell, config.language);
    spinner.stop();

    // 本地规则兜底：对 AI 返回的命令再做一次危险检测
    const localCheck = checkDanger(result.command, config.language);
    const finalRisk = localCheck.risk === 'danger' ? 'danger'
      : (localCheck.risk === 'warning' && result.risk === 'safe') ? 'warning'
      : result.risk;
    const finalWarning = localCheck.warnings.length > 0
      ? localCheck.warnings.join('；')
      : result.warning;

    await displayCommand(result.command, finalRisk, finalWarning);

    // 记录历史
    addHistory({ type: 'generate', input: description, output: result.command });

    // --copy 模式：直接复制并退出
    if (options.copy) {
      const ok = await copyToClipboard(result.command);
      if (ok) {
        await displaySuccess('已复制到剪贴板');
      } else {
        await displayError('复制到剪贴板失败');
      }
      return;
    }

    // --run 模式：危险命令禁止直接执行
    if (options.run) {
      if (finalRisk === 'danger') {
        await displayError('危险命令禁止使用 --run 直接执行，请手动确认');
      } else {
        await runCommand(result.command);
        return;
      }
    }

    // 交互确认
    await interactiveConfirm(result.command, finalRisk === 'danger');

  } catch (err: any) {
    spinner.stop();
    await displayError(err.message || '生成命令失败');
  }
}

/** 交互确认：[R]un [C]opy [E]dit [Q]uit */
async function interactiveConfirm(command: string, isDanger: boolean): Promise<void> {
  const actions = isDanger
    ? ['Copy', 'Edit', 'Quit']
    : ['Run', 'Copy', 'Edit', 'Quit'];

  await displayActions(actions);

  const key = await readKey();

  switch (key.toLowerCase()) {
    case 'r':
      if (isDanger) {
        await displayError('危险命令不可直接执行');
        break;
      }
      await runCommand(command);
      break;
    case 'c': {
      const ok = await copyToClipboard(command);
      if (ok) {
        await displaySuccess('已复制到剪贴板');
      } else {
        await displayError('复制到剪贴板失败');
      }
      break;
    }
    case 'e': {
      const edited = await editCommand(command);
      if (edited && edited.trim()) {
        const editedCheck = (await import('../core/danger')).checkDanger(edited);
        const editedIsDanger = editedCheck.risk === 'danger';
        await displayCommand(edited, editedCheck.risk, editedCheck.warnings.join('；') || undefined);
        await interactiveConfirm(edited, editedIsDanger);
      } else {
        console.log('  已取消');
      }
      break;
    }
    default:
      console.log('  已取消');
      break;
  }
}

/** 读取单个按键 */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode?.(false);
      rl.close();
      const key = data.toString();
      // Ctrl+C
      if (key === '\x03') {
        process.exit();
      }
      console.log();
      resolve(key);
    });
  });
}

/** 执行命令 */
function runCommand(command: string): Promise<void> {
  return new Promise((resolve) => {
    console.log();
    const child = exec(command, { shell: process.env.SHELL || undefined });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n  进程退出码: ${code}`);
      }
      resolve();
    });
  });
}

/** 编辑命令：让用户在终端中修改命令后回车确认 */
function editCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // 使用预填充文本让用户编辑
    rl.question('  > ', (answer) => {
      rl.close();
      resolve(answer);
    });
    // 预填充当前命令
    rl.write(command);
  });
}
