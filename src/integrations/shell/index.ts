import { ZSH_INIT_SCRIPT } from './zsh';
import { BASH_INIT_SCRIPT } from './bash';
import { FISH_INIT_SCRIPT } from './fish';
import { POWERSHELL_INIT_SCRIPT } from './powershell';

export type SupportedShell = 'zsh' | 'bash' | 'fish' | 'powershell';

export const SUPPORTED_SHELLS: SupportedShell[] = ['zsh', 'bash', 'fish', 'powershell'];

/** 返回指定 shell 的集成脚本文本 */
export function renderInitScript(shell: SupportedShell): string {
  switch (shell) {
    case 'zsh':
      return ZSH_INIT_SCRIPT;
    case 'bash':
      return BASH_INIT_SCRIPT;
    case 'fish':
      return FISH_INIT_SCRIPT;
    case 'powershell':
      return POWERSHELL_INIT_SCRIPT;
  }
}

export function isSupportedShell(s: string): s is SupportedShell {
  return (SUPPORTED_SHELLS as string[]).includes(s);
}
