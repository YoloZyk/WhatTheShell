import chalk from 'chalk';

/** Box-drawing width constant */
export const BOX_WIDTH = 60;

/** Strip ANSI color codes from a string */
function stripColor(str: string): string {
  return str.replace(/\x1B\[\d+m/g, '');
}

/**
 * Draw a horizontal divider with optional section label.
 */
export function divider(label?: string): string {
  if (!label) {
    return chalk.cyan('│');
  }
  return `${chalk.cyan('├─')} ${chalk.bold(label)}`;
}

/**
 * Draw a section header with box-drawing.
 */
export function sectionHeader(title: string, width = BOX_WIDTH): void {
  const line = '─'.repeat(width - 2 - stripColor(title).length);
  console.log(`${chalk.cyan('┌─')} ${chalk.bold(title)} ${chalk.gray(line)}`);
}

/**
 * Draw a section header (continuation, with ├─).
 */
export function sectionCont(title: string): void {
  console.log(`${chalk.cyan('├─')} ${chalk.bold(title)}`);
}

/**
 * Draw a row with label and value, optionally colorizing the value.
 */
export function kvRow(label: string, value: string, valueColor?: string): void {
  const plainValue = stripColor(value);
  const padding = Math.max(2, BOX_WIDTH - 4 - label.length - plainValue.length);
  const spaces = ' '.repeat(padding);
  const colored = valueColor ? (chalk as any)[valueColor](value) : value;
  console.log(`${chalk.cyan('│')}  ${label}${spaces}${colored}`);
}

/**
 * Draw a row with just content (no key).
 */
export function contentRow(content: string, color = 'white'): void {
  console.log(`${chalk.cyan('│')}  ${(chalk as any)[color](content)}`);
}

/**
 * Draw a blank row (spacing).
 */
export function blankRow(): void {
  console.log(`${chalk.cyan('│')}`);
}

/**
 * Draw a footer line.
 */
export function footer(message: string): void {
  console.log(`${chalk.cyan('└─')} ${chalk.gray(message)}`);
}

/**
 * Draw a success indicator (green checkmark, no emoji).
 */
export function success(msg: string): void {
  console.log(`  ${chalk.green('✓')} ${msg}`);
}

/**
 * Draw an error indicator (red x, no emoji).
 */
export function error(msg: string): void {
  console.log(`  ${chalk.red('×')} ${msg}`);
}

/**
 * Draw a warning indicator (yellow !, no emoji).
 */
export function warn(msg: string): void {
  console.log(`  ${chalk.yellow('!')} ${msg}`);
}

/**
 * Draw a status indicator: green for ok, red for fail, yellow for unknown.
 */
export function status(value: 'ok' | 'fail' | 'warn' | 'skip', label: string, detail?: string): void {
  const icons: Record<string, string> = {
    ok: chalk.green('✓'),
    fail: chalk.red('×'),
    warn: chalk.yellow('!'),
    skip: chalk.gray('○'),
  };
  const icon = icons[value] || icons.skip;
  if (detail) {
    console.log(`  ${icon}  ${label}  ${chalk.gray(detail)}`);
  } else {
    console.log(`  ${icon}  ${label}`);
  }
}
