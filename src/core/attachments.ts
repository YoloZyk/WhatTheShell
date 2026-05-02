import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import type { AttachedFile, ShellType } from '../types';
import { detectFileLang, readSafeFile } from './file';

/**
 * `@path` token parser for `wts a` (and possibly other Q&A flows).
 *
 * Scans the question text for `@xxx` tokens preceded by whitespace or string
 * start (so `user@host.com` doesn't match), tries to resolve each as a file or
 * directory under cwd, and replaces successful matches with `[file:relpath]`
 * markers. Failed lookups stay as plain text — no error.
 *
 * Caps protect token budget:
 *   - per-file size: enforced by readSafeFile (100 KB)
 *   - total attachment bytes: 200 KB
 *   - file count: 20
 *
 * Directory expansion is depth=1: only direct file children, no recursion.
 */
/**
 * Token regex for `@path` references.
 *
 * Two key design choices:
 *
 * 1. Negative lookbehind `(?<![A-Za-z0-9_])` blocks `@` after a word character
 *    so emails (`user@host.com`) and similar word-internal `@` don't match.
 *    Punctuation, CJK chars, whitespace, and string-start all permit a match.
 *
 * 2. Path body is `[A-Za-z0-9_./\\+~:-]+` — an explicit charset, NOT `\S+`.
 *    `\S+` was greedy and would eat trailing Chinese (or any non-space text)
 *    when the user wrote tokens with no separating space, e.g.
 *    `看一下@src/foo.ts有什么问题` becoming `@src/foo.ts有什么问题` as the
 *    path. The charset stops at the first character that can't appear in a
 *    real ASCII filesystem path: spaces, CJK, parens, brackets, most
 *    punctuation. Tradeoff: `@中文/文件.ts` won't auto-trigger — for
 *    non-ASCII paths the user can space-separate or quote.
 *
 * Exported so the display layer can scan the same way to highlight `@path`
 * references in the user-facing question echo.
 */
export const TOKEN_RE = /(?<![A-Za-z0-9_])@([A-Za-z0-9_./\\+~:-]+)/g;
export const TRAIL_PUNCT = /[,.;:!?。，；：！？)\]]+$/;

export const MAX_TOTAL_ATTACHMENT_BYTES = 200 * 1024;
export const MAX_ATTACHMENTS = 20;

export interface ParseAttachmentsResult {
  /** Question text with successful `@xxx` tokens replaced by `[file:relpath]` markers. */
  question: string;
  attachments: AttachedFile[];
  /** User-facing notes about skipped tokens (cap exceeded, binary, etc.). */
  warnings: string[];
  /** Raw token path strings (after trailing punctuation stripped) that successfully
   *  resolved to a file or directory. Lets the display layer highlight `@path`
   *  references that "took" vs ones that fell through to plain text. */
  resolvedTokens: Set<string>;
}

interface ParseCtx {
  cwd: string;
  fallbackShell: ShellType;
  totalBytes: number;
  attachments: AttachedFile[];
  warnings: string[];
  /** abs path → already attached; lets repeated `@foo` reuse the same content. */
  seen: Set<string>;
  /** Raw rel-path tokens that resolved successfully (file or non-empty dir). */
  resolvedTokens: Set<string>;
}

export function parseAttachments(
  question: string,
  cwd: string,
  fallbackShell: ShellType,
): ParseAttachmentsResult {
  const ctx: ParseCtx = {
    cwd,
    fallbackShell,
    totalBytes: 0,
    attachments: [],
    warnings: [],
    seen: new Set(),
    resolvedTokens: new Set(),
  };

  const replaced = question.replace(TOKEN_RE, (full, raw: string) => {
    const trailMatch = raw.match(TRAIL_PUNCT);
    const trail = trailMatch ? trailMatch[0] : '';
    const rawPath = trail ? raw.slice(0, raw.length - trail.length) : raw;
    if (!rawPath) return full;

    const replacement = tryResolve(rawPath, ctx);
    if (replacement === null) return full;
    ctx.resolvedTokens.add(rawPath);
    return replacement + trail;
  });

  return {
    question: replaced,
    attachments: ctx.attachments,
    warnings: ctx.warnings,
    resolvedTokens: ctx.resolvedTokens,
  };
}

function tryResolve(rawPath: string, ctx: ParseCtx): string | null {
  const abs = path.resolve(ctx.cwd, rawPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }

  if (stat.isFile()) return addFile(abs, ctx);
  if (stat.isDirectory()) return addDirectory(abs, ctx);
  return null;
}

function addFile(absPath: string, ctx: ParseCtx): string | null {
  const rel = relativize(absPath, ctx.cwd);

  // Already attached → just emit the marker, no duplicate read.
  if (ctx.seen.has(absPath)) {
    return `[file:${rel}]`;
  }

  if (ctx.attachments.length >= MAX_ATTACHMENTS) {
    ctx.warnings.push(`skipped @${rel}: attachment count cap (${MAX_ATTACHMENTS}) reached`);
    return null;
  }

  const r = readSafeFile(absPath);
  if (!r.ok) {
    ctx.warnings.push(`skipped @${rel}: ${r.reason}`);
    return null;
  }

  const byteLen = Buffer.byteLength(r.content, 'utf8');
  if (ctx.totalBytes + byteLen > MAX_TOTAL_ATTACHMENT_BYTES) {
    ctx.warnings.push(
      `skipped @${rel}: would exceed total attachment cap (${(MAX_TOTAL_ATTACHMENT_BYTES / 1024).toFixed(0)} KB)`,
    );
    return null;
  }

  const lang = detectFileLang(rel, ctx.fallbackShell);
  ctx.attachments.push({
    path: rel,
    content: r.content,
    lang: lang.label,
    lineCount: r.content.split('\n').length,
  });
  ctx.totalBytes += byteLen;
  ctx.seen.add(absPath);

  return `[file:${rel}]`;
}

function addDirectory(absPath: string, ctx: ParseCtx): string | null {
  const relDir = relativize(absPath, ctx.cwd);

  let entries: string[];
  try {
    entries = fs.readdirSync(absPath).sort();
  } catch (e: any) {
    ctx.warnings.push(`skipped @${relDir}/: cannot read directory (${e.code || e.message})`);
    return null;
  }

  const markers: string[] = [];
  for (const name of entries) {
    const childAbs = path.join(absPath, name);
    let s: fs.Stats;
    try {
      s = fs.statSync(childAbs);
    } catch {
      continue;
    }
    if (!s.isFile()) continue; // depth=1: skip subdirs

    const before = ctx.attachments.length;
    const m = addFile(childAbs, ctx);
    if (m && ctx.attachments.length > before) {
      markers.push(m);
    }
    // addFile pushed its own warning on failure; we just keep iterating.
    if (ctx.attachments.length >= MAX_ATTACHMENTS) break;
  }

  if (markers.length === 0) {
    // Don't add another warning — addFile already explained why each file was skipped.
    // For a totally empty / unreadable dir we still want a heads-up.
    if (entries.length === 0) {
      ctx.warnings.push(`@${relDir}/: directory is empty`);
    }
    return null;
  }

  return markers.join(' ');
}

function relativize(absPath: string, cwd: string): string {
  const rel = path.relative(cwd, absPath);
  // Normalize Windows backslashes for consistent display + LLM reading.
  return rel.replace(/\\/g, '/') || '.';
}

// ---------- display helpers ----------

/**
 * Color `@path` tokens inside a string for header / history echoes.
 *   - tokens whose raw path is in `resolved` → cyan bold (real attachment)
 *   - tokens NOT in `resolved` → dim (failed lookup, treated as plain text)
 *   - prose between tokens → default white
 *
 * Used by both the live `wts a` header (where `resolved` comes from
 * parseAttachments) and the `wts history` detail panel (where it's
 * recomputed against the current cwd via resolveTokensInText).
 */
export function highlightAtTokens(text: string, resolved: Set<string>): string {
  const re = new RegExp(TOKEN_RE.source, 'g');
  let out = '';
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    out += chalk.white(text.slice(lastEnd, m.index));

    const raw = m[1];
    const trailMatch = raw.match(TRAIL_PUNCT);
    const trail = trailMatch ? trailMatch[0] : '';
    const rawPath = trail ? raw.slice(0, raw.length - trail.length) : raw;

    const tokenText = '@' + rawPath;
    out += resolved.has(rawPath) ? chalk.cyan.bold(tokenText) : chalk.dim(tokenText);
    out += chalk.white(trail);

    lastEnd = m.index + m[0].length;
  }

  out += chalk.white(text.slice(lastEnd));
  return out;
}

/**
 * Cheap "which `@xxx` tokens still resolve to something in cwd" pass.
 * Does NOT read file contents — only stat()s — so it's safe to call on
 * arbitrary history entries without inflating token budget or I/O.
 */
export function resolveTokensInText(text: string, cwd: string): Set<string> {
  const re = new RegExp(TOKEN_RE.source, 'g');
  const resolved = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const trailMatch = raw.match(TRAIL_PUNCT);
    const rawPath = trailMatch ? raw.slice(0, raw.length - trailMatch[0].length) : raw;
    if (!rawPath) continue;

    try {
      const stat = fs.statSync(path.resolve(cwd, rawPath));
      if (stat.isFile() || stat.isDirectory()) resolved.add(rawPath);
    } catch {
      // ignore — token stays unresolved
    }
  }

  return resolved;
}
