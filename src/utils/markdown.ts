import chalk from 'chalk';

/**
 * Render a chat-LLM-style Markdown answer into ANSI-colored lines for display
 * inside a CLI box. The caller frames each output line with its outer border
 * (e.g. `│  ${line}`); this renderer just produces the styled inner content.
 *
 * Handles the common Markdown features chat models actually emit:
 *   - **bold**, *italic*, `inline code`
 *   - fenced code blocks ```lang ... ```
 *   - headers (#/##/###/####)
 *   - unordered (-, *, +) and ordered (1.) lists
 *   - blockquotes (>)
 *   - horizontal rules (--- / ___)
 *
 * Deliberately NOT handled (rare in chat output, full Markdown is overkill
 * for a terminal renderer):
 *   - tables, links/images, footnotes, deeply nested lists, HTML passthrough
 */
export function renderMarkdown(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;

  for (const raw of lines) {
    if (inCodeBlock) {
      if (/^\s*```\s*$/.test(raw)) {
        out.push('  ' + chalk.gray('─'.repeat(40)));
        inCodeBlock = false;
        continue;
      }
      out.push('  ' + chalk.green(raw));
      continue;
    }

    // Code-fence open
    const fence = /^\s*```([\w+#-]*)\s*$/.exec(raw);
    if (fence) {
      const lang = fence[1] || 'code';
      const tail = Math.max(3, 40 - lang.length - 4);
      out.push('  ' + chalk.gray('── ' + lang + ' ' + '─'.repeat(tail)));
      inCodeBlock = true;
      continue;
    }

    // Header
    const hdr = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (hdr) {
      const depth = hdr[1].length;
      const content = renderInline(hdr[2]);
      const styled = depth === 1 ? chalk.bold.magenta(content)
                   : depth === 2 ? chalk.bold.cyan(content)
                   : chalk.bold(content);
      out.push(styled);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) {
      out.push(chalk.gray('─'.repeat(40)));
      continue;
    }

    // Blockquote
    const bq = /^(\s*)>\s?(.*)$/.exec(raw);
    if (bq) {
      out.push(bq[1] + chalk.gray('│ ' + renderInline(bq[2])));
      continue;
    }

    // Ordered list
    const ol = /^(\s*)(\d+)\.\s+(.+)$/.exec(raw);
    if (ol) {
      out.push(`${ol[1]}${chalk.cyan(ol[2] + '.')} ${renderInline(ol[3])}`);
      continue;
    }

    // Unordered list
    const ul = /^(\s*)[-*+]\s+(.+)$/.exec(raw);
    if (ul) {
      out.push(`${ul[1]}${chalk.cyan('•')} ${renderInline(ul[2])}`);
      continue;
    }

    // Plain paragraph
    out.push(renderInline(raw));
  }

  // Defensive: unclosed fence — emit a closing rule so the box doesn't bleed
  if (inCodeBlock) {
    out.push('  ' + chalk.gray('─'.repeat(40)));
  }

  return out;
}

/** Apply inline formatting in safe order:
 *   1. inline code (its contents shouldn't get bolded/italicized)
 *   2. bold `**...**` (consumes its own asterisks; runs before italic)
 *   3. italic `*...*` (with word-boundary guards to avoid mid-word `*`)
 *
 * After step 1 the code spans are turned into ANSI-wrapped text so the
 * subsequent regexes can't match into them. Same for bold's output before
 * italic runs.
 */
function renderInline(text: string): string {
  text = text.replace(/`([^`\n]+)`/g, (_, m) => chalk.cyan(m));
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, (_, m) => chalk.bold(m));
  text = text.replace(/(?<![A-Za-z0-9*\\])\*([^*\n]+?)\*(?![A-Za-z0-9*])/g, (_, m) => chalk.italic(m));
  return text;
}
