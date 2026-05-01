import type { Step, ScriptResult } from '../types';

/** Parse the model's "Step N: ..." response into structured steps.
 *  Multi-line content (heredocs, here-strings) between two Step headers is
 *  preserved as the command body. */
export function parseScriptResponse(raw: string): ScriptResult {
  let text = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  const fenceMatch = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  const steps: Step[] = [];
  let globalRisk: 'safe' | 'warning' | 'danger' = 'safe';
  const warnings: string[] = [];

  const stepHeaderRegex = /^Step\s+(\d+)\s*:/gim;

  const matches: { index: number; start: number; contentStart: number }[] = [];
  let match;

  while ((match = stepHeaderRegex.exec(text)) !== null) {
    matches.push({
      index: parseInt(match[1], 10),
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const rawContent = next
      ? text.slice(current.contentStart, next.start)
      : text.slice(current.contentStart);

    const fullCommand = rawContent.trim();
    if (!fullCommand) continue;

    const isDangerMarked = /\[DANGER\]/i.test(fullCommand);
    const isCautionMarked = /\[CAUTION\]/i.test(fullCommand);

    if (isDangerMarked) globalRisk = 'danger';
    else if (isCautionMarked && globalRisk !== 'danger') globalRisk = 'warning';

    let command = fullCommand.replace(/\[DANGER\]|\[CAUTION\]/gi, '').trim();
    let description: string | undefined;

    // Models often wrap each step's code in a ```powershell ... ``` fence,
    // sometimes with a natural-language description on the line before the
    // opening fence. Extract the fenced code as the actual command and use
    // the pre-fence text as the description.
    const fenced = command.match(/^([\s\S]*?)```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fenced) {
      const before = fenced[1].trim();
      const code = fenced[2].trim();
      if (before) {
        description = before.split('\n')[0].trim();
      }
      command = code;
    } else {
      // Markdown inline code: `cmd args`. Models often wrap commands this
      // way — sometimes single-line, sometimes around multi-line here-strings
      // (which is technically invalid markdown but happens anyway).
      // Critical to strip in PowerShell:
      //   - leading backtick acts as escape (corrupts the first token)
      //   - trailing backtick is line-continuation, splicing the next
      //     emitted script line (our sentinel write) into the user's command
      // We only strip when BOTH ends are backticks — a stray backtick at one
      // end would be valid PS syntax (escape / continuation) and shouldn't
      // be touched.
      const inline = command.match(/^`([\s\S]+)`$/);
      if (inline) {
        command = inline[1];
      }
      // Fall back to inline `# comment` extraction on the first line.
      const firstLine = command.split('\n')[0];
      const hashIdx = firstLine.indexOf(' #');
      if (hashIdx !== -1) {
        description = firstLine.slice(hashIdx + 2).trim();
      }
    }

    const hasDangerPattern = /rm\s+-rf|dd\s+of=|mkfs|chmod\s+777|format-vol|clear-disk/i.test(command);

    steps.push({
      index: current.index,
      command,
      description,
      danger: isDangerMarked || hasDangerPattern,
    });
  }

  steps.sort((a, b) => a.index - b.index);
  steps.forEach((step, i) => {
    step.index = i + 1;
  });

  return { steps, risk: globalRisk, warnings };
}
