import type { RiskLevel, CommandSegment, FileSection, FileIssue } from '../types';
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

  // Build header line with label
  let label = '[generate]';
  if (risk === 'danger') {
    label = `[generate ⚠ DANGER]`;
  } else if (risk === 'warning') {
    label = `[generate ! CAUTION]`;
  }

  // Calculate line length (60 - len("┌─ ") - len(label) - len(" ─"))
  const labelLen = label.length + 4; // "┌─ " + label + " "
  const lineLen = 60 - labelLen;
  const line = '─'.repeat(Math.max(1, lineLen));

  console.log(`${borderFn('┌─')} ${labelFn(label)} ${borderFn(line)}`);

  // Warning message (if any)
  if (warning) {
    console.log(`${borderFn('│')}  ${warnFn(warning)}`);
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

  // Build header line with label
  let label = '[explain]';
  if (risk === 'danger') {
    label = `[explain ⚠ DANGER]`;
  } else if (risk === 'warning') {
    label = `[explain ! CAUTION]`;
  }

  // Calculate line length (60 - len("┌─ ") - len(label) - len(" ─"))
  const labelLen = label.length + 4;
  const lineLen = 60 - labelLen;
  const line = '─'.repeat(Math.max(1, lineLen));

  console.log(`${borderFn('┌─')} ${labelFn(label)} ${borderFn(line)}`);

  // Warning message (if any)
  if (warning) {
    console.log(`${borderFn('│')}  ${warnFn(warning)}`);
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

/** 显示文件解释（多行文件，按逻辑段分块展示） */
export async function displayFileExplanation(
  filename: string,
  sections: FileSection[],
  summary: string,
  risk: RiskLevel,
  warning?: string,
  issues: FileIssue[] = [],
): Promise<void> {
  console.log();

  const borderFn = risk === 'danger' ? chalk.red :
                   risk === 'warning' ? chalk.yellow :
                   chalk.cyan;
  const labelFn = risk === 'danger' ? chalk.bgRed.white.bold :
                  risk === 'warning' ? chalk.bgYellow.black.bold :
                  chalk.cyan;
  const warnFn = risk === 'danger' ? chalk.red :
                 risk === 'warning' ? chalk.yellow :
                 chalk.white;

  let label = `[explain: ${filename}]`;
  if (risk === 'danger') label = `[explain ⚠ DANGER: ${filename}]`;
  else if (risk === 'warning') label = `[explain ! CAUTION: ${filename}]`;

  const labelLen = label.length + 4;
  const lineLen = Math.max(1, 60 - labelLen);
  const line = '─'.repeat(lineLen);

  console.log(`${borderFn('┌─')} ${labelFn(label)} ${borderFn(line)}`);

  if (warning) {
    console.log(`${borderFn('│')}  ${warnFn(warning)}`);
  }

  // 行号 padding 取最大行号宽度（兜底 1 防止 padStart(0)）
  const maxLineNum = sections.reduce((acc, s) => Math.max(acc, s.range?.[1] ?? 0), 0);
  const lnPad = Math.max(1, String(maxLineNum).length);

  sections.forEach((sec, i) => {
    console.log(`${borderFn('│')}`);
    const rangeLabel = sec.range
      ? sec.range[0] === sec.range[1]
        ? `L${sec.range[0]}`
        : `L${sec.range[0]}-${sec.range[1]}`
      : '';
    const header = rangeLabel
      ? `§${i + 1}  ${chalk.gray(rangeLabel)}`
      : `§${i + 1}`;
    console.log(`${borderFn('│')}  ${chalk.cyan(header)}`);

    // 代码行（带行号）
    const codeLines = sec.code.split('\n');
    const start = sec.range?.[0] ?? 1;
    codeLines.forEach((cline, idx) => {
      const lnNum = String(start + idx).padStart(lnPad, ' ');
      console.log(`${borderFn('│')}    ${chalk.gray(lnNum)}  ${chalk.green(cline)}`);
    });

    // 解释（与代码空一行隔开）
    if (sec.explanation) {
      console.log(`${borderFn('│')}`);
      const explLines = sec.explanation.split('\n');
      explLines.forEach((eline) => {
        const trimmed = eline.trimEnd();
        if (!trimmed) {
          console.log(`${borderFn('│')}`);
        } else {
          console.log(`${borderFn('│')}    ${chalk.white('→ ' + trimmed)}`);
        }
      });
    }
  });

  if (issues.length > 0) {
    console.log(`${borderFn('│')}`);
    console.log(`${borderFn('│')}  ${chalk.yellow.bold('[!] Likely bugs:')}`);
    for (const issue of issues) {
      const loc = issue.range
        ? issue.range[0] === issue.range[1]
          ? `L${issue.range[0]}`
          : `L${issue.range[0]}-${issue.range[1]}`
        : '';
      const prefix = loc ? `${chalk.yellow(loc)}  ` : '';
      console.log(`${borderFn('│')}    ${prefix}${chalk.white(issue.message)}`);
    }
  }

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

/** 显示生成的多步脚手架脚本 */
export async function displayScaffold(body: string, risk: RiskLevel, warning?: string): Promise<void> {
  console.log();

  const borderFn = risk === 'danger' ? chalk.red :
                   risk === 'warning' ? chalk.yellow :
                   chalk.cyan;
  const labelFn = risk === 'danger' ? chalk.bgRed.white.bold :
                  risk === 'warning' ? chalk.bgYellow.black.bold :
                  chalk.hex('#ff8c00');
  const warnFn = risk === 'danger' ? chalk.red :
                 risk === 'warning' ? chalk.yellow :
                 chalk.white;

  let label = '[scaffold]';
  if (risk === 'danger') label = '[scaffold ⚠ DANGER]';
  else if (risk === 'warning') label = '[scaffold ! CAUTION]';

  const labelLen = label.length + 4;
  const lineLen = 60 - labelLen;
  const line = '─'.repeat(Math.max(1, lineLen));

  console.log(`${borderFn('┌─')} ${labelFn(label)} ${borderFn(line)}`);

  if (warning) {
    console.log(`${borderFn('│')}  ${warnFn(warning)}`);
  }

  console.log(`${borderFn('│')}`);
  for (const ln of body.split('\n')) {
    const trimmed = ln.trim();
    const isComment = trimmed.startsWith('#');
    const styled = isComment ? chalk.gray(ln) : chalk.green.bold(ln);
    console.log(`${borderFn('│')}  ${styled}`);
  }
  console.log(`${borderFn('│')}`);
  console.log(`${borderFn('└─')} ${chalk.gray('Save as a file or copy to clipboard')}`);
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
