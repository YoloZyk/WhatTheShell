import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { pickWithEsc } from '../utils/inquirer';

/**
 * Interactive file picker for `wts a` (and possibly other Q&A flows that want
 * to attach files without typing paths).
 *
 * Walks cwd up to depth 3, skips a hard-coded ignore list (node_modules, .git,
 * build outputs, etc.), filters by size + binary extension, caps the displayed
 * list at 500 entries, and shows a multi-select with @inquirer/prompts checkbox.
 *
 * No .gitignore parsing — we keep the dependency surface small. The hard-coded
 * skip list covers ~90% of "don't show me this" use cases, and users can fall
 * back to typing `@path` directly when the picker doesn't surface what they need.
 */

const DEFAULT_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_VISITED = 5000;
const FILE_SIZE_LIMIT = 100 * 1024;

const SKIP_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'target',
  'out',
  'bin',
  'obj',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'vendor',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.gradle',
  '.terraform',
]);

/** Files where reading the bytes would either be useless to AI or actively
 *  leak sensitive material. Keep separate from the binary-ext list so the
 *  rationale stays readable. */
const SENSITIVE_FILE_PATTERNS = [
  /\.env(\.|$)/i,        // .env, .env.local, .env.production, …
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^id_ecdsa/i,
  /^id_ed25519/i,
];

const BINARY_EXT_RE = /\.(exe|dll|so|dylib|bin|o|obj|a|lib|class|jar|war|pyc|pyo|wasm|tgz|tar|gz|zip|7z|rar|bz2|xz|lz4|zst|pdf|png|jpg|jpeg|gif|bmp|tiff|webp|ico|svg|eot|ttf|otf|woff|woff2|mp3|mp4|mov|avi|mkv|flac|wav|ogg|webm|sqlite|db|mdb|lock|map|min\.js|min\.css)$/i;

interface EnumerateOptions {
  depth?: number;
  maxEntries?: number;
  maxVisited?: number;
}

interface FileEntry {
  /** cwd-relative path with forward slashes for display. */
  rel: string;
  size: number;
  lineCount: number;
}

export function enumerateProjectFiles(cwd: string, opts: EnumerateOptions = {}): {
  entries: FileEntry[];
  truncated: boolean;
} {
  const depthLimit = opts.depth ?? DEFAULT_DEPTH;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxVisited = opts.maxVisited ?? DEFAULT_MAX_VISITED;

  const entries: FileEntry[] = [];
  let visited = 0;
  let truncated = false;

  function walk(dir: string, depth: number): void {
    if (truncated) return;
    if (depth > depthLimit) return;
    if (visited >= maxVisited) {
      truncated = true;
      return;
    }

    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const name of names) {
      visited++;
      if (visited >= maxVisited) {
        truncated = true;
        return;
      }
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }

      if (name.startsWith('.') && SKIP_DIRS.has(name)) continue;
      if (SKIP_DIRS.has(name)) continue;

      const abs = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > FILE_SIZE_LIMIT) continue;
      if (BINARY_EXT_RE.test(name)) continue;
      if (SENSITIVE_FILE_PATTERNS.some(re => re.test(name))) continue;

      const rel = path.relative(cwd, abs).replace(/\\/g, '/');
      const lineCount = approxLineCount(abs, stat.size);
      entries.push({ rel, size: stat.size, lineCount });
    }
  }

  walk(cwd, 0);
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  return { entries, truncated };
}

/** Cheap line count: read the file once, count `\n`. Skipped on files >100KB
 *  (already filtered) so this stays bounded. */
function approxLineCount(absPath: string, size: number): number {
  if (size === 0) return 0;
  try {
    const buf = fs.readFileSync(absPath);
    let count = 1;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Multi-select picker. Returns an array of cwd-relative paths, or null if the
 * user cancelled (Esc / Ctrl+C). Empty array means "user confirmed without
 * picking anything" — caller should treat that as "no attachments".
 */
export async function pickProjectFiles(cwd: string): Promise<string[] | null> {
  const { entries, truncated } = enumerateProjectFiles(cwd);

  if (entries.length === 0) {
    console.log(`  ${chalk.gray('(no readable project files found in cwd)')}`);
    return [];
  }

  const prompts = await import('@inquirer/prompts');

  const choices = entries.map(e => ({
    name: `${e.rel}  ${chalk.gray(`(${e.lineCount} lines)`)}`,
    value: e.rel,
    short: e.rel,
  }));

  if (truncated) {
    console.log(
      `  ${chalk.gray(`(showing first ${entries.length}; use @path directly for files outside this list)`)}`,
    );
  }

  const picked = await pickWithEsc<string[]>(signal =>
    prompts.checkbox<string>(
      {
        message: 'Attach files (Space=toggle, Enter=confirm, Esc=skip):',
        choices,
        pageSize: 15,
      },
      { signal },
    ),
  );

  return picked;
}
