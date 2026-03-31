import type { ShellType } from '../types';

/** 自动检测当前 Shell 环境 */
export function detectShell(): ShellType {
  const shell = process.env.SHELL || process.env.ComSpec || '';

  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('powershell') || shell.includes('pwsh')) return 'powershell';
  return 'bash';
}
