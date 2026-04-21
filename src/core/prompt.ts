import type { ShellType, DetailLevel, Language, ContextSnapshot } from '../types';
import { renderContextForPrompt } from './context';

function ctxPrefix(ctx?: ContextSnapshot): string {
  if (!ctx) return '';
  return renderContextForPrompt(ctx) + '\n\n';
}

/** 每种 shell 的风格提示，告诉模型用什么原生惯用法 */
const SHELL_STYLE_HINTS: Record<ShellType, string> = {
  bash: 'POSIX utilities (ls, grep, awk, sed, find, xargs, cut, sort, head, tail, wc). Standard Unix pipelines and $(...) substitution.',
  zsh: 'POSIX utilities plus zsh extras (** globs, extended parameter expansion) when they make the command shorter. Most bash syntax works as-is.',
  fish: 'Fish builtins and syntax: `set -l` for vars, `string <sub>` for text ops, `test` for conditions, `(cmd)` for substitution (NOT $(...)), `if ... end` (NOT `fi`), `$status` (NOT $?).',
  powershell: 'PowerShell cmdlets and pipeline: Get-*, Set-*, Where-Object, Sort-Object, Select-Object, ForEach-Object, Measure-Object, Group-Object. Do NOT output unix utilities (ps, ls, grep, awk, head, tail, cut, sort) — always use cmdlet equivalents (Get-Process, Get-ChildItem, Select-String, Sort-Object, Select-Object -First N, etc.), even when the task sounds unix-y.',
};

/** 每种 shell 下典型的"该标 DANGER/CAUTION"命令示例，帮助模型正确分级 */
const SHELL_DANGER_EXAMPLES: Record<ShellType, { danger: string; caution: string }> = {
  bash: { danger: 'rm -rf, dd of=, mkfs, chmod 777 /, > /dev/sda', caution: 'sudo, kill -9, curl ... | bash, shutdown' },
  zsh: { danger: 'rm -rf, dd of=, mkfs, chmod 777 /, > /dev/sda', caution: 'sudo, kill -9, curl ... | bash, shutdown' },
  fish: { danger: 'rm -rf, dd of=, mkfs, chmod 777 /', caution: 'sudo, kill -9, curl ... | sh' },
  powershell: { danger: 'Remove-Item -Recurse -Force, Format-Volume, Clear-Disk, diskpart, del /s /q, format C:', caution: 'Stop-Computer, Restart-Computer, Set-ExecutionPolicy Unrestricted, iwr ... | iex' },
};

/** 生成命令的 Prompt */
export function buildGeneratePrompt(
  description: string,
  shell: ShellType,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  const style = SHELL_STYLE_HINTS[shell];
  const ex = SHELL_DANGER_EXAMPLES[shell];
  return `${ctxPrefix(ctx)}You are a shell command expert. The user describes what they want to do, and you generate the corresponding shell command.

Rules:
- Target shell: ${shell}
- Style: ${style}
- Generate ONLY the command, no explanation
- Output as a SINGLE LINE (no line breaks inside the command). Combine multiple steps with the shell's own separators (; && | in bash/zsh, ; | in PowerShell, ; and/or in fish).
- If environment context is provided above, use it to pick project-appropriate tooling (e.g. npm vs cargo), honor the current git branch, etc.
- If the command is dangerous (e.g. ${ex.danger}), prepend the line with [DANGER] and add a brief risk description after [WARNING]:
  Format for dangerous commands:
  [DANGER]
  <command>
  [WARNING] <risk description in ${lang}>
- If the command is mildly risky (e.g. ${ex.caution}), use [CAUTION] instead of [DANGER]
- For safe commands, output ONLY the command with no tags
- Do not wrap the command in code blocks or quotes
- Respond in ${lang}

User request: ${description}`;
}

/** 解释命令的 Prompt */
export function buildExplainPrompt(
  command: string,
  level: DetailLevel,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  const levelInstructions: Record<DetailLevel, string> = {
    brief: 'Give a ONE sentence summary of what the command does.',
    normal: `Break down the command into segments. For each segment, provide:
- The segment text
- A short explanation
Format each segment as: <segment> # <explanation>
Then end with a one-line summary prefixed with [SUMMARY].`,
    detail: `Provide a thorough breakdown of the command:
- Break it into every meaningful segment (command, flags, arguments, pipes, redirections)
- Explain each segment in detail
- Mention any side effects or gotchas
Format each segment as: <segment> # <explanation>
Then end with a summary prefixed with [SUMMARY].`,
  };

  return `${ctxPrefix(ctx)}You are a shell command expert. Explain the given command.

Rules:
- Respond in ${lang}
- If the command is dangerous, start with [DANGER] <risk description>
- If mildly risky, start with [CAUTION] <risk description>
- ${levelInstructions[level]}
- Do not wrap output in code blocks

Command: ${command}`;
}

/** 自由问答的 Prompt */
export function buildAskPrompt(
  question: string,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  return `${ctxPrefix(ctx)}You are a shell and terminal expert assistant. Answer the user's question clearly and concisely.

Rules:
- Respond in ${lang}
- Focus on shell/terminal/command-line topics
- Include examples when helpful
- Do not wrap output in code blocks unless showing a command example

Question: ${question}`;
}
