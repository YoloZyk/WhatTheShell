import type { RiskLevel, CommandSegment } from '../types';

// chalk/ora 是 ESM-only，需要动态导入
let _chalk: any = null;
let _ora: any = null;

async function getChalk() {
  if (!_chalk) {
    _chalk = (await import('chalk')).default;
  }
  return _chalk;
}

async function getOra() {
  if (!_ora) {
    _ora = (await import('ora')).default;
  }
  return _ora;
}

/** 创建 loading spinner */
export async function startSpinner(text: string) {
  const ora = await getOra();
  return ora({ text, spinner: 'dots' }).start();
}

/** 显示生成的命令 */
export async function displayCommand(command: string, risk: RiskLevel, warning?: string): Promise<void> {
  const chalk = await getChalk();

  console.log();
  if (risk === 'danger' && warning) {
    console.log(chalk.bgRed.white.bold(' ⚠ DANGER ') + ' ' + chalk.red(warning));
    console.log();
  } else if (risk === 'warning' && warning) {
    console.log(chalk.bgYellow.black.bold(' ⚠ CAUTION ') + ' ' + chalk.yellow(warning));
    console.log();
  }

  console.log('  ' + chalk.green.bold(command));
  console.log();
}

/** 显示命令解释 */
export async function displayExplanation(
  segments: CommandSegment[],
  summary: string,
  risk: RiskLevel,
  warning?: string
): Promise<void> {
  const chalk = await getChalk();

  console.log();
  if (risk === 'danger' && warning) {
    console.log(chalk.bgRed.white.bold(' ⚠ DANGER ') + ' ' + chalk.red(warning));
    console.log();
  } else if (risk === 'warning' && warning) {
    console.log(chalk.bgYellow.black.bold(' ⚠ CAUTION ') + ' ' + chalk.yellow(warning));
    console.log();
  }

  if (segments.length > 0) {
    const maxLen = Math.max(...segments.map(s => s.text.length), 10);
    for (const seg of segments) {
      const text = chalk.cyan(seg.text.padEnd(maxLen + 2));
      const comment = chalk.gray('# ' + seg.explanation);
      console.log('  ' + text + comment);
    }
    console.log();
  }

  if (summary) {
    console.log('  ' + chalk.dim('Summary: ') + summary);
    console.log();
  }
}

/** 显示问答回复 */
export async function displayAnswer(answer: string): Promise<void> {
  const chalk = await getChalk();
  console.log();
  console.log('  ' + chalk.white(answer.replace(/\n/g, '\n  ')));
  console.log();
}

/** 显示错误信息 */
export async function displayError(message: string): Promise<void> {
  const chalk = await getChalk();
  console.error();
  console.error('  ' + chalk.red('✗ ') + chalk.red(message));
  console.error();
}

/** 显示成功信息 */
export async function displaySuccess(message: string): Promise<void> {
  const chalk = await getChalk();
  console.log('  ' + chalk.green('✓ ') + message);
}
