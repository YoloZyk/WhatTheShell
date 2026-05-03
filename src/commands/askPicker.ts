import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { pickWithEsc } from '../utils/inquirer';

/**
 * Interactive file picker for `wts a` (and possibly other Q&A flows that want
 * to attach files without typing paths).
 *
 * Pipeline:
 *   1. If cwd is not a project root but contains project-root subdirectories,
 *      offer a "scope into one of them" select prompt. Picking a scope re-roots
 *      the enumeration; depth=3 is then measured from the project root, which
 *      reaches files that depth=3 from cwd would never see (cap exhausts in
 *      the depth=1/2 sibling sweep before BFS even reaches the project).
 *   2. enumerateProjectFiles via BFS up to depth=3, skip ignore list, filter
 *      binary / sensitive / oversize, cap at 2000 entries / 20000 visited.
 *   3. If candidate count > MAX_DIRECT_PICK, gate the checkbox behind an
 *      input filter loop (substring AND-match, lowercase). Otherwise checkbox
 *      directly.
 *   4. Esc at any prompt aborts the whole picker (returns null).
 *
 * Why BFS rather than DFS: DFS on a large home / drive root exhausts the
 * entries cap inside whatever sibling alphabetizes first, hiding everything
 * else. With BFS, every depth-1 sibling gets at least one shallow pass.
 *
 * No .gitignore parsing — keep dependency surface small. Hard-coded skip list
 * covers ~90% of "don't show me this" cases; users can always type @path
 * directly for files outside the picker.
 */

const DEFAULT_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_VISITED = 20000;
const FILE_SIZE_LIMIT = 100 * 1024;

/** Threshold above which the checkbox is gated behind an input filter prompt.
 *  Picked empirically: pageSize=15 means ~7 page flips at this size, the upper
 *  edge of "still navigable without searching". Most real project roots stay
 *  under it; only large monorepos and non-project directories trip the gate. */
const MAX_DIRECT_PICK = 100;

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

/** Files / dirs that, if present in a directory, signal "this is a project
 *  root". Used both for the cwd heads-up message and for finding scope
 *  candidates among cwd's immediate children. */
const PROJECT_ROOT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'requirements.txt',
  'Pipfile',
  'composer.json',
  'Makefile',
  'CMakeLists.txt',
  'pubspec.yaml',
  'mix.exs',
  'tsconfig.json',
];

interface EnumerateOptions {
  depth?: number;
  maxEntries?: number;
  maxVisited?: number;
  /** When set, walk starts from `walkCwd` (the function's first arg) but the
   *  emitted `rel` paths are computed relative to `displayCwd` instead. Used
   *  by the scope feature so that picking a project under E:\ still produces
   *  paths like `WhatTheShell/src/utils/ui.ts` (relative to the user's actual
   *  cwd) rather than `src/utils/ui.ts` (which would fail to resolve in
   *  ask.ts's parseAttachments). */
  displayCwd?: string;
}

interface FileEntry {
  /** Display path, relative to displayCwd (or walkCwd if no displayCwd given),
   *  with forward slashes. This is what gets handed back to the caller and
   *  prepended as `@path` in the question. */
  rel: string;
  size: number;
  lineCount: number;
}

export function enumerateProjectFiles(walkCwd: string, opts: EnumerateOptions = {}): {
  entries: FileEntry[];
  truncated: boolean;
} {
  const depthLimit = opts.depth ?? DEFAULT_DEPTH;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxVisited = opts.maxVisited ?? DEFAULT_MAX_VISITED;
  const displayCwd = opts.displayCwd ?? walkCwd;

  const entries: FileEntry[] = [];
  let visited = 0;
  let truncated = false;

  // BFS queue: shallow first. Crucial when cwd is a large root with many
  // sibling directories — DFS exhausts the entries cap inside whatever sibling
  // alphabetizes first, hiding everything else from the picker.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: walkCwd, depth: 0 }];

  outer: while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > depthLimit) continue;

    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      visited++;
      if (visited >= maxVisited) { truncated = true; break outer; }
      if (entries.length >= maxEntries) { truncated = true; break outer; }

      if (SKIP_DIRS.has(name)) continue;

      const abs = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (depth + 1 <= depthLimit) {
          queue.push({ dir: abs, depth: depth + 1 });
        }
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > FILE_SIZE_LIMIT) continue;
      if (BINARY_EXT_RE.test(name)) continue;
      if (SENSITIVE_FILE_PATTERNS.some(re => re.test(name))) continue;

      const rel = path.relative(displayCwd, abs).replace(/\\/g, '/');
      const lineCount = approxLineCount(abs, stat.size);
      entries.push({ rel, size: stat.size, lineCount });
    }
  }

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

/** True if `dir` contains any file/dir typical of a project root. */
function looksLikeProjectRoot(dir: string): boolean {
  for (const marker of PROJECT_ROOT_MARKERS) {
    try {
      if (fs.existsSync(path.join(dir, marker))) return true;
    } catch {
      // permission errors etc. — assume marker not present
    }
  }
  return false;
}

interface ScopeCandidate {
  /** Subdirectory name (single segment, not a path). */
  name: string;
  /** Which markers were found in it (e.g. ['.git', 'package.json']). */
  markers: string[];
}

/** Scan cwd's immediate children and return the ones that look like project
 *  roots. Used to offer a "scope into one of these" prompt when the user runs
 *  `wts a` from a non-project parent (a home directory, a drive root, etc.).
 *
 *  Stops scanning each subdirectory as soon as 3 markers are found — that's
 *  enough for display, more would just be noise. */
function listProjectRootChildren(cwd: string): ScopeCandidate[] {
  let names: string[];
  try {
    names = fs.readdirSync(cwd);
  } catch {
    return [];
  }

  const candidates: ScopeCandidate[] = [];
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(cwd, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const matched: string[] = [];
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        if (fs.existsSync(path.join(abs, marker))) {
          matched.push(marker);
          if (matched.length >= 3) break;
        }
      } catch {
        // skip
      }
    }
    if (matched.length > 0) {
      candidates.push({ name, markers: matched });
    }
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

/** All immediate subdirectories of cwd, minus the SKIP_DIRS ignore list.
 *  Used to back the "Other folder..." escape hatch — markers will never cover
 *  every project shape (notebooks-only, "I keep .py scripts here", archive
 *  dirs, etc.), so we always let the user pick a raw directory by name. */
function listAllSubdirectories(cwd: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(cwd);
  } catch {
    return [];
  }

  const subdirs: string[] = [];
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(cwd, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) subdirs.push(name);
  }
  subdirs.sort((a, b) => a.localeCompare(b));
  return subdirs;
}

/** Sentinel values used in the scope select prompts. The first-level prompt
 *  may return one of: a candidate's name (string), OTHER (open the other-
 *  subdirectory submenu), SCAN_AS_IS (don't scope, just walk cwd). The
 *  second-level prompt may return a subdirectory name or BACK (re-open the
 *  first level). */
const SCAN_AS_IS = '__wts_scan_cwd__';
const OTHER = '__wts_other__';
const BACK = '__wts_back__';

/** Drive the user through the scope-selection UI. Returns the directory we
 *  should hand to enumerateProjectFiles as walkCwd, or null if the user
 *  cancelled (Esc at the top level).
 *
 *  Three shapes:
 *    - cwd has detected project candidates: first-level shows them with
 *      marker hints, plus "Other folder..." (if there are non-candidate
 *      subdirs) and "None — scan as-is". Picking Other opens a second-level
 *      pick-any-subdir menu; Esc in the second level returns to the first.
 *    - cwd has no candidates but has subdirs: first-level shows ALL subdirs
 *      directly + "None". No Other folding — there's nothing to fold.
 *    - cwd has no subdirs at all: skip the prompt entirely, just walk cwd. */
async function chooseScope(cwd: string, prompts: typeof import('@inquirer/prompts')): Promise<string | null> {
  const allSubdirs = listAllSubdirectories(cwd);
  if (allSubdirs.length === 0) return cwd;

  const candidates = listProjectRootChildren(cwd);
  const candidateNames = new Set(candidates.map(c => c.name));
  const otherSubdirs = allSubdirs.filter(d => !candidateNames.has(d));

  // No detected projects → show all subdirs directly. No Other folding.
  if (candidates.length === 0) {
    const choices: any[] = [
      ...otherSubdirs.map(d => ({ name: d, value: d, short: d })),
      new prompts.Separator(),
      { name: chalk.gray('None — scan current directory as-is'), value: SCAN_AS_IS, short: 'None' },
    ];
    const scope = await pickWithEsc<string>(signal =>
      prompts.select<string>(
        {
          message: "This directory doesn't look like a project root. Pick a subdirectory to scope into?",
          choices,
          pageSize: 12,
        },
        { signal },
      ),
    );
    if (scope === null) return null;
    if (scope === SCAN_AS_IS) return cwd;
    return path.join(cwd, scope);
  }

  // Has detected projects → candidates first, then Other (if any non-candidate
  // subdirs exist), then None. Loop on Other so Esc in submenu reopens this.
  const firstChoices: any[] = [
    ...candidates.map(c => ({
      name: `${c.name}  ${chalk.gray(`(${c.markers.join(', ')})`)}`,
      value: c.name,
      short: c.name,
    })),
    ...(otherSubdirs.length > 0
      ? [new prompts.Separator(), { name: chalk.cyan('Other folder...'), value: OTHER, short: 'Other' }]
      : []),
    new prompts.Separator(),
    { name: chalk.gray('None — scan current directory as-is'), value: SCAN_AS_IS, short: 'None' },
  ];

  while (true) {
    const scope = await pickWithEsc<string>(signal =>
      prompts.select<string>(
        {
          message: 'Detected projects under cwd. Scope into one?',
          choices: firstChoices,
          pageSize: 12,
        },
        { signal },
      ),
    );

    if (scope === null) return null;
    if (scope === SCAN_AS_IS) return cwd;

    if (scope === OTHER) {
      const otherChoices: any[] = [
        ...otherSubdirs.map(d => ({ name: d, value: d, short: d })),
        new prompts.Separator(),
        { name: chalk.gray('(back)'), value: BACK, short: 'back' },
      ];
      const dir = await pickWithEsc<string>(signal =>
        prompts.select<string>(
          {
            message: 'Pick a subdirectory:',
            choices: otherChoices,
            pageSize: 15,
          },
          { signal },
        ),
      );
      // Esc in the submenu reopens the first level — distinct from Esc at
      // the first level, which cancels the whole picker.
      if (dir === null) continue;
      if (dir === BACK) continue;
      return path.join(cwd, dir);
    }

    return path.join(cwd, scope);
  }
}

/**
 * Multi-select picker. Returns an array of cwd-relative paths, or null if the
 * user cancelled (Esc / Ctrl+C). Empty array means "user confirmed without
 * picking anything" — caller should treat that as "no attachments".
 */
export async function pickProjectFiles(cwd: string): Promise<string[] | null> {
  const prompts = await import('@inquirer/prompts');

  // Pick the directory we'll actually walk. Defaults to cwd; if cwd doesn't
  // look like a project root, run the scope chooser (project candidates with
  // marker hints, plus an "Other folder..." escape hatch for projects we
  // can't auto-detect, plus "None — scan as-is"). The displayed `@path`
  // tokens stay relative to the user's actual cwd no matter what we pick
  // (see displayCwd in enumerateProjectFiles).
  let walkCwd = cwd;
  if (!looksLikeProjectRoot(cwd)) {
    const scope = await chooseScope(cwd, prompts);
    if (scope === null) return null;  // Esc at top-level → cancel whole picker
    walkCwd = scope;
  }

  const { entries, truncated } = enumerateProjectFiles(walkCwd, { displayCwd: cwd });

  if (entries.length === 0) {
    console.log(`  ${chalk.gray('(no readable project files found)')}`);
    return [];
  }

  if (truncated) {
    console.log(
      `  ${chalk.gray(`(scanned the first ${entries.length} files; use @path directly for anything not in the picker)`)}`,
    );
  }

  // Gate the checkbox behind a substring filter loop when the candidate set
  // is too large to navigate via arrow keys. Empty input at any prompt aborts
  // the whole picker. Smaller projects skip this entirely.
  let visibleEntries: FileEntry[];
  if (entries.length > MAX_DIRECT_PICK) {
    const narrowed = await narrowEntries(entries, prompts);
    if (narrowed === null) return null;
    visibleEntries = narrowed;
  } else {
    visibleEntries = entries;
  }

  const choices = visibleEntries.map(e => ({
    name: `${e.rel}  ${chalk.gray(`(${e.lineCount} lines)`)}`,
    value: e.rel,
    short: e.rel,
  }));

  const picked = await pickWithEsc<string[]>(signal =>
    prompts.checkbox<string>(
      {
        message: 'Attach files (Space=toggle, Enter=confirm, Esc=cancel):',
        choices,
        pageSize: 15,
      },
      { signal },
    ),
  );

  return picked;
}

/**
 * Loop the user through input-driven filtering until the candidate set fits
 * within MAX_DIRECT_PICK. Each round filters from the FULL `entries` set (not
 * the previous round's matches) so the user can correct typos by entering a
 * fresh expression — there's no concept of "narrowing the previous result".
 *
 * Filter semantics:
 *   - Lowercase substring match against the cwd-relative path
 *   - Space-separated terms = AND (all must match): "src ts" matches paths
 *     containing both "src" and "ts" anywhere
 *   - Empty input at any prompt → abort the entire picker (return null)
 *
 * Returns the filtered FileEntry[] when its size is in (0, MAX_DIRECT_PICK].
 */
async function narrowEntries(
  entries: FileEntry[],
  prompts: any,
): Promise<FileEntry[] | null> {
  let current = entries;
  let firstRound = true;

  while (true) {
    if (current.length > 0 && current.length <= MAX_DIRECT_PICK) {
      return current;
    }

    let message: string;
    if (firstRound) {
      message = `${entries.length} files — type substring(s) to filter (space-separated; empty to abort):`;
    } else if (current.length === 0) {
      message = 'No matches — try again (empty to abort):';
    } else {
      message = `${current.length} matches — narrow further (empty to abort):`;
    }

    const filterInput = await pickWithEsc<string>(signal =>
      prompts.input({ message }, { signal }),
    );
    if (filterInput === null) return null;
    const trimmed = filterInput.trim();
    if (!trimmed) return null;

    const terms = trimmed.toLowerCase().split(/\s+/);
    current = entries.filter(e => {
      const lower = e.rel.toLowerCase();
      return terms.every(t => lower.includes(t));
    });
    firstRound = false;
  }
}
