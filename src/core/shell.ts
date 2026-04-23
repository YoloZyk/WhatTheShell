import type { ShellType } from '../types';

/** 自动检测当前 Shell 环境 */
export function detectShell(): ShellType {
  // 1. 优先级最高：显式的 SHELL 变量 (Unix 习惯)
  const shellEnv = (process.env.SHELL || '').toLowerCase();
  if (shellEnv.includes('zsh')) return 'zsh';
  if (shellEnv.includes('fish')) return 'fish';
  if (shellEnv.includes('bash')) return 'bash';

  // 2. 针对 Windows 的深度检测
  if (process.platform === 'win32') {
    // 检查是否在 Git Bash 或 Cygwin 等模拟环境下
    // 这些环境通常会设置特定的变量
    if (process.env.TERM === 'xterm' && process.env.SHLVL) return 'bash';
    
    // 检查是否明确在运行 PowerShell
    // 检查父进程名是目前最准的方法之一，但作为轻量 CLI，我们可以检查特定变量
    const psEnv = (process.env.PSModulePath || '');
    // 只有当 SHELL 不包含 bash 且 ComSpec 也不像 CMD 时，才考虑 PS
    // 或者检查特殊的专用变量
    if (process.env.PNP_DEBUG_LOG || process.env.PSExecutionPolicyPreference) {
        return 'powershell';
    }
  }

  // 3. 兜底逻辑
  // 如果是 Windows 且没有匹配到 Bash，默认给 PowerShell (现代 Windows 标配)
  // 如果是 Unix 且没有匹配到 Zsh/Fish，默认给 Bash
  return process.platform === 'win32' ? 'powershell' : 'bash';
}
