import { ZSH_INIT_SCRIPT } from './zsh';
import { BASH_INIT_SCRIPT } from './bash';

export type SupportedShell = 'zsh' | 'bash';

export const SUPPORTED_SHELLS: SupportedShell[] = ['zsh', 'bash'];

/** 返回指定 shell 的集成脚本文本 */
export function renderInitScript(shell: SupportedShell): string {
  switch (shell) {
    case 'zsh':
      return ZSH_INIT_SCRIPT;
    case 'bash':
      return BASH_INIT_SCRIPT;
  }
}

export function isSupportedShell(s: string): s is SupportedShell {
  return (SUPPORTED_SHELLS as string[]).includes(s);
}
