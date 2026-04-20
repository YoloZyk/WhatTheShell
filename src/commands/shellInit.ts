import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';
import { detectShell } from '../core/shell';

/**
 * 打印指定 shell 的集成脚本到 stdout。
 * 用户用 `eval "$(wts shell-init zsh)"` 一行装配，避免改 rc 文件。
 */
export function shellInitCommand(shellArg?: string): void {
  const shell = (shellArg || detectShell() || 'bash').toLowerCase();

  if (!isSupportedShell(shell)) {
    process.stderr.write(
      `wts shell-init: 不支持的 shell "${shell}"\n` +
      `  当前支持: ${SUPPORTED_SHELLS.join(', ')}\n` +
      `  fish / powershell 将在 v0.3 加入\n`
    );
    process.exit(2);
  }

  process.stdout.write(renderInitScript(shell));
}
