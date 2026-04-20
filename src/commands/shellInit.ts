import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';
import { detectShell } from '../core/shell';

/**
 * 打印指定 shell 的集成脚本到 stdout。
 * 用户用 `eval "$(wts shell-init zsh)"` 一行装配，避免改 rc 文件。
 *
 * 若 stdout 是 TTY（交互 shell 里直接跑），额外在 stderr 打一条使用提示，
 * 避免新用户误以为一屏脚本是报错。
 */
export function shellInitCommand(shellArg?: string): void {
  const shell = (shellArg || detectShell() || 'bash').toLowerCase();

  if (!isSupportedShell(shell)) {
    process.stderr.write(
      `wts shell-init: 不支持的 shell "${shell}"\n` +
      `  当前支持: ${SUPPORTED_SHELLS.join(', ')}\n`
    );
    process.exitCode = 2;
    return;
  }

  if (process.stdout.isTTY) {
    process.stderr.write(
      `wts shell-init: 这条命令会把集成脚本打印到 stdout 给 shell 吃，不是给你看的。\n` +
      `\n` +
      `  当前会话启用：\n` +
      `    eval "$(wts shell-init ${shell})"\n` +
      `\n` +
      `  永久安装：\n` +
      (shell === 'zsh' || shell === 'bash'
        ? `    echo 'eval "$(wts shell-init ${shell})"' >> ~/.${shell}rc\n`
        : `    把上面那行 eval 追加到你的 shell 配置文件\n`) +
      `\n` +
      `  下面这坨是脚本正文，仅供好奇：\n` +
      `\n`
    );
  }

  process.stdout.write(renderInitScript(shell));
}
