import type { ShellType, DetailLevel, Language, ContextSnapshot } from '../types';
import { renderContextForPrompt } from './context';
import { renderScaffoldContextForPrompt, type ScaffoldContext } from './scaffoldContext';

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

/** 每种 shell 内嵌文件内容的惯用法 */
const SHELL_FILE_WRITE_HINTS: Record<ShellType, string> = {
  bash: "Use heredoc to embed file contents:\n  cat > path/to/file <<'EOF'\n  ...content...\n  EOF",
  zsh: "Use heredoc to embed file contents:\n  cat > path/to/file <<'EOF'\n  ...content...\n  EOF",
  fish: "fish has no native heredoc. Use printf '%s\\n' line1 line2 ... > path/to/file, or `string join \\n l1 l2 ... > path/to/file`. Prefer printf for content with special characters.",
  powershell: "Use a PowerShell here-string with Set-Content:\n  @'\n  ...content...\n  '@ | Set-Content -Path 'path/to/file' -NoNewline",
};

const SHELL_SHEBANG: Record<ShellType, string> = {
  bash: '#!/usr/bin/env bash',
  zsh: '#!/usr/bin/env zsh',
  fish: '#!/usr/bin/env fish',
  powershell: '#Requires -Version 5.1',
};

export const SHELL_SCRIPT_EXT: Record<ShellType, string> = {
  bash: 'sh',
  zsh: 'sh',
  fish: 'fish',
  powershell: 'ps1',
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

/** 解释脚本（多行）的 Prompt (v0.4) */
export function buildExplainScriptPrompt(
  content: string,
  filename: string,
  shell: ShellType,
  level: DetailLevel,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  const ex = SHELL_DANGER_EXAMPLES[shell];

  const levelInstructions: Record<DetailLevel, string> = {
    brief: 'Aim for 2-4 sections; each [EXPLAIN] ≤ 1 sentence.',
    normal: 'Aim for 4-8 sections; each [EXPLAIN] 1-3 sentences. Group related lines (e.g. consecutive variable assignments, a heredoc + the cat that emits it) into a single section.',
    detail: 'Aim for 6-12 sections; each [EXPLAIN] can span multiple sentences and should call out side effects, error handling, and gotchas. Still group purely structural lines (shebang + set -e, etc.) into a single section.',
  };

  // 给 AI 看的内容附行号，方便它精确指引段落范围
  const numbered = content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');

  return `${ctxPrefix(ctx)}You are a shell script analyzer. The user provides a multi-line script with line numbers prefixed; produce a sectioned explanation.

Rules:
- Respond in ${lang}
- Target shell: ${shell}
- If ANY line is destructive (e.g. ${ex.danger}), open the response with a single line: [DANGER] <risk description in ${lang}>
- If mildly risky (e.g. ${ex.caution}), open with: [CAUTION] <risk description in ${lang}>
- For safe scripts, omit the envelope entirely
- Divide the script into contiguous logical SECTIONS (group adjacent lines by purpose — env setup, config write, build, deploy, etc.). Comments and blank lines should be folded into the section they introduce. Sections must cover every line, in order.
- ${levelInstructions[level]}
- Output each section as TWO consecutive markers:
  [SECTION] L<a-b>
  [EXPLAIN] <explanation, may span multiple lines>
  ...where a and b are the 1-based line numbers shown in the script (inclusive; a single-line section uses L<a-a>). The explanation may span multiple lines, but must NOT contain another [SECTION] or [EXPLAIN] tag.
- After all sections, end with a single line: [SUMMARY] <one-sentence overall purpose>
- Do not wrap output in markdown fences. Do not echo the original code lines back.

Script (filename: ${filename}):
${numbered}`;
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

/** 任务分类 prompt (v0.4) */
export function buildClassifyPrompt(description: string, language: Language): string {
  const lang = language === 'zh' ? '中文' : 'English';

  return `You are a task classification expert. Analyze the user's request and classify it into one of two categories:

A) Single command - Can be completed with ONE shell command (e.g., "list files", "kill process", "find pattern")
B) Multi-step script - Requires MULTIPLE steps (e.g., creating projects, initializing repos, writing multiple files, configuring environments, complex workflows)

Respond with ONLY the letter A or B, nothing else. No explanation, no extra text.

User request: ${description}

Classification:`;
}

/** Multi-step scaffolding prompt (file creation, project init flows) */
export function buildScaffoldPrompt(
  intent: string,
  shell: ShellType,
  language: Language,
  ctx?: ScaffoldContext,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  const style = SHELL_STYLE_HINTS[shell];
  const ex = SHELL_DANGER_EXAMPLES[shell];
  const fileWriteHint = SHELL_FILE_WRITE_HINTS[shell];
  const shebang = SHELL_SHEBANG[shell];
  const ext = SHELL_SCRIPT_EXT[shell];

  const errPragma = (shell === 'bash' || shell === 'zsh')
    ? 'Begin the script body with `set -euo pipefail` so failed steps abort the run.'
    : shell === 'powershell'
    ? "Begin the script body with `$ErrorActionPreference = 'Stop'` so failed steps abort the run."
    : 'Add early-exit checks (e.g. `or return 1`) when steps depend on each other.';

  const prefix = ctx ? renderScaffoldContextForPrompt(ctx) + '\n\n' : '';

  return `${prefix}You are a project scaffolding expert. The user describes a setup goal — usually creating files or initializing a small project. Generate a ${shell} script that the user will SAVE, REVIEW, and ADAPT before running. Favor inline file creation via heredoc/here-string over external tooling so the user can see and edit every byte that goes into the project.

Rules:
- Target shell: ${shell}
- Style: ${style}
- Output format: ONLY the script body. No prose, no markdown fences, no triple-backticks.
- First line: shebang \`${shebang}\`
- Second line: a filename suggestion comment in this exact form:
  # filename: <slug>.${ext}
  The slug describes the goal in 2-4 words, kebab-case, no path.
- ${errPragma}
- Use \`#\` comments to label each major step in ${lang}. Comments should explain *why* (so the user can decide whether to keep that step), not just restate the command.
- For file creation, embed file contents inline. ${fileWriteHint}
- The user will save this and probably tweak file paths, package names, ports, env vars before running. Keep these adaptable: use clearly-labeled placeholders (e.g. \`PROJECT_NAME=my-app\`) at the top instead of hardcoding deep in the body.
- If environment context is provided above, use it to choose project-appropriate tooling (npm vs cargo vs pip), match existing conventions, and pick paths that fit. Do NOT overwrite files the user already has unless the goal explicitly says so.
- If ANY step is destructive (e.g. ${ex.danger}), the WHOLE script is dangerous. Output the envelope EXACTLY as below, and the script body must NOT appear anywhere outside the envelope (no draft preview, no repetition):
  [DANGER]
  <script body, multi-line>
  [WARNING] <risk description in ${lang}>
- If any step is mildly risky (e.g. ${ex.caution}), use [CAUTION] in the same envelope. Same rule: no body outside the envelope.
- For safe scaffolds, output ONLY the script with no tags.

User goal: ${intent}`;
}

/** Multi-step script prompt (v0.4) */
export function buildScriptPrompt(
  description: string,
  shell: ShellType,
  language: Language,
  ctx?: ContextSnapshot,
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  const style = SHELL_STYLE_HINTS[shell];
  const ex = SHELL_DANGER_EXAMPLES[shell];
  const fileWriteHint = SHELL_FILE_WRITE_HINTS[shell];

  const ctxBlock = ctx ? (() => {
    let prefix = `Current working directory: ${ctx.pwd}\n`;
    if (ctx.git) {
      prefix += `Git branch: ${ctx.git.branch}${ctx.git.dirty ? ' (dirty)' : ''}\n`;
    }
    if (ctx.projects.length > 0) {
      prefix += `Project type: ${ctx.projects.map(p => p.kind).join(', ')}\n`;
    }
    return prefix + '\n';
  })() : '';

  return `${ctxBlock}You are a shell command expert. The user describes what they want to do, and you generate a multi-step script.

Rules:
- Target shell: ${shell}
- Style: ${style}
- **IMPORTANT: Output the ACTUAL EXECUTABLE COMMAND, not a description!**
  - WRONG: "Step 1: Create project directory structure"
  - RIGHT: "Step 1: mkdir -p myproject"
- Output format: Use "Step N:" as the header, followed by the actual command.
- Do NOT wrap commands in markdown — no inline backticks (\`cmd\`), no triple-backtick fences (\`\`\`...\`\`\`). Emit the raw command text directly after "Step N:". A leading backtick in PowerShell is an escape character; a trailing backtick is line-continuation — both will corrupt the executed command.
- If a command spans multiple lines (like heredocs), continue it on the next line. The parser will collect content until the next "Step N:".

Step granularity (very important):
- Aim for 5-8 steps total, not 10+. Each step should be a meaningful logical unit, not a single file write.
- A SINGLE step can contain MULTIPLE file writes — chain multiple here-strings / heredocs in one step. Prefer this over splitting each file into its own step.
- Typical project-setup grouping:
  - 1 step: directory + repo init (mkdir + cd + git init together)
  - 1 step: config files (package.json + .gitignore + README in one block)
  - 1-2 steps: source code (group related source files per logical layer)
  - 1 step: install dependencies
  - 1 step: final message / verification
- Each step should be independently meaningful and roughly self-contained for retry on failure.

NEVER include long-running or interactive commands as executable steps — they hang the runner forever:
- Dev servers: \`npm start\`, \`npm run dev\`, \`npm run serve\`, \`npx serve\`, \`npx live-server\`, \`node server.js\`, \`python -m http.server\`
- Watchers: \`tsc --watch\`, \`webpack --watch\`, \`vite\`, \`nodemon\`, anything with \`--watch\`
- Interactive tools: \`gh auth login\`, \`ssh\`, \`vim\`, \`nano\`
Instead, put start/usage instructions in the FINAL step as a printed message (\`Write-Host\` for PowerShell, \`echo\` for bash/zsh/fish) so the user can copy-paste and run them manually after the script finishes.

Other rules:
- Dangerous commands (e.g. ${ex.danger}) MUST be marked with [DANGER] at the end.
- Mildly risky commands (e.g. ${ex.caution}) should be marked with [CAUTION].
- For file creation with content: ${fileWriteHint}
- Respond in ${lang}.

User request: ${description}

Output:
Step 1: <actual command>
Step 2: <actual command that may
span multiple lines>`;
}
