import type { RiskLevel, CommandSegment } from '../types';
import chalk from 'chalk';
import { success as uiSuccess, error as uiError, warn as uiWarn } from './ui';

// chalk/ora 是 ESM-only，需要动态导入
let _ora: any = null;

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

/** Color helper for box-drawing characters */
function box(color: 'cyan' | 'red' | 'yellow' | 'gray' | 'white') {
  const colorMap: Record<string, (s: string) => string> = {
    cyan: chalk.cyan,
    red: chalk.red,
    yellow: chalk.yellow,
    gray: chalk.gray,
    white: chalk.white,
  };
  return (char: string) => colorMap[color](char);
}

/** 显示生成的命令 */
export async function displayCommand(command: string, risk: RiskLevel, warning?: string): Promise<void> {
  console.log();

  // Choose colors based on risk
  const borderFn = risk === 'danger' ? chalk.red :
                   risk === 'warning' ? chalk.yellow :
                   chalk.cyan;
  const labelFn = risk === 'danger' ? chalk.bgRed.white.bold :
                 risk === 'warning' ? chalk.bgYellow.black.bold :
                 chalk.green;
  const warnFn = risk === 'danger' ? chalk.red :
                 risk === 'warning' ? chalk.yellow :
                 chalk.white;

  // Top border with label
  if (risk === 'danger') {
    console.log(`${borderFn('┌─')} ${labelFn('[generate]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}  ${labelFn(' ⚠ DANGER ')}`);
    console.log(`${borderFn('│')}  ${warnFn(warning || '')}`);
  } else if (risk === 'warning') {
    console.log(`${borderFn('┌─')} ${labelFn('[generate]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}  ${labelFn(' ! CAUTION ')}`);
    console.log(`${borderFn('│')}  ${warnFn(warning || '')}`);
  } else {
    console.log(`${borderFn('┌─')} ${labelFn('[generate]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}`);
  }

  // Command output
  console.log(`${borderFn('│')}`);
  const lines = command.split('\n');
  for (const line of lines) {
    console.log(`${borderFn('│')}  ${chalk.green.bold(line)}`);
  }
  console.log(`${borderFn('│')}`);
  console.log(`${borderFn('└─')} ${chalk.gray('Run it, copy it, or edit it below')}`);
  console.log();
}

/** 显示命令解释 */
export async function displayExplanation(
  segments: CommandSegment[],
  summary: string,
  risk: RiskLevel,
  warning?: string
): Promise<void> {
  console.log();

  // Choose colors based on risk
  const borderFn = risk === 'danger' ? chalk.red :
                   risk === 'warning' ? chalk.yellow :
                   chalk.cyan;
  const labelFn = risk === 'danger' ? chalk.bgRed.white.bold :
                  risk === 'warning' ? chalk.bgYellow.black.bold :
                  chalk.cyan;
  const warnFn = risk === 'danger' ? chalk.red :
                 risk === 'warning' ? chalk.yellow :
                 chalk.white;

  // Header
  if (risk === 'danger') {
    console.log(`${borderFn('┌─')} ${labelFn('[explain]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}  ${labelFn(' ⚠ DANGER ')}`);
    console.log(`${borderFn('│')}  ${warnFn(warning || '')}`);
  } else if (risk === 'warning') {
    console.log(`${borderFn('┌─')} ${labelFn('[explain]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}  ${labelFn(' ! CAUTION ')}`);
    console.log(`${borderFn('│')}  ${warnFn(warning || '')}`);
  } else {
    console.log(`${borderFn('┌─')} ${labelFn('[explain]')} ${borderFn('─'.repeat(46))}`);
    console.log(`${borderFn('│')}`);
  }

  // Segments
  if (segments.length > 0) {
    console.log(`${borderFn('│')}`);
    const maxLen = Math.max(...segments.map(s => s.text.length), 10);
    for (const seg of segments) {
      const text = chalk.cyan(seg.text.padEnd(maxLen + 2));
      const comment = chalk.gray('# ' + seg.explanation);
      console.log(`${borderFn('│')}  ${text}${comment}`);
    }
  }

  // Summary
  if (summary) {
    console.log(`${borderFn('│')}`);
    console.log(`${borderFn('│')}  ${chalk.gray('Summary:')} ${chalk.white(summary)}`);
  }

  console.log(`${borderFn('│')}`);
  console.log(`${borderFn('└─')} ${chalk.gray('─'.repeat(52))}`);
  console.log();
}

/** 显示问答回复 */
export async function displayAnswer(answer: string): Promise<void> {
  console.log();

  // Header
  console.log(`${chalk.cyan('┌─')} ${chalk.magenta('[ask]')} ${chalk.gray('─'.repeat(50))}`);
  console.log(`${chalk.cyan('│')}`);

  // Answer content
  const lines = answer.split('\n');
  for (const line of lines) {
    console.log(`${chalk.cyan('│')}  ${chalk.white(line)}`);
  }

  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray('─'.repeat(52))}`);
  console.log();
}

/** 显示错误信息 */
export async function displayError(message: string): Promise<void> {
  uiError(message);
}

/** 显示成功信息 */
export async function displaySuccess(message: string): Promise<void> {
  uiSuccess(message);
}

/** 显示警告信息 */
export async function displayWarn(message: string): Promise<void> {
  uiWarn(message);
}
