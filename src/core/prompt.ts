import type { ShellType, DetailLevel, Language, ContextSnapshot } from '../types';
import { renderContextForPrompt } from './context';

function ctxPrefix(ctx?: ContextSnapshot): string {
  if (!ctx) return '';
  return renderContextForPrompt(ctx) + '\n\n';
}

/** 生成命令的 Prompt */
export function buildGeneratePrompt(
  description: string,
  shell: ShellType,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  return `${ctxPrefix(ctx)}You are a shell command expert. The user describes what they want to do, and you generate the corresponding shell command.

Rules:
- Target shell: ${shell}
- Generate ONLY the command, no explanation
- If environment context is provided above, use it to pick project-appropriate tooling (e.g. npm vs cargo), honor the current git branch, etc.
- If the command is dangerous (rm -rf, dd, mkfs, chmod 777, > /dev/sda, etc.), prepend the line with [DANGER] and add a brief risk description after [WARNING]:
  Format for dangerous commands:
  [DANGER]
  <command>
  [WARNING] <risk description in ${lang}>
- If the command is mildly risky (e.g. sudo, kill, truncating files), use [CAUTION] instead of [DANGER]
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
