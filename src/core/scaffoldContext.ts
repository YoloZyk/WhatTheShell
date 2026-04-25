import * as fs from 'fs';
import * as path from 'path';
import { parse as parseToml } from '@iarna/toml';
import type { ContextSnapshot } from '../types';
import {
  collectContext,
  renderContextForPrompt,
  safe,
  type CollectContextOptions,
} from './context';

/**
 * Deep project snapshot for `wts scaffold`. Wraps the shallow ContextSnapshot
 * (PWD/projects/git/recentHistory) and adds structured manifest summaries
 * plus a list of relevant existing files in PWD. The goal is to let the
 * scaffold prompt produce content that fits the actual project — correct
 * node version in a Dockerfile, correct binary name in a release script,
 * acknowledgement of files the user already has — instead of a generic
 * template.
 *
 * This module is scaffold-only on purpose: `wts g/e/a` keep using the
 * cheaper shallow context, since deep manifest reads add 400-700 tokens
 * that aren't worth it for single-line command generation.
 */
export interface ScaffoldContext {
  base: ContextSnapshot;
  manifests: ManifestSummary[];
  existingFiles: string[];
}

export interface ManifestSummary {
  kind: string;
  file: string;
  fields: Record<string, unknown>;
}

const INTERESTING_FILES = new Set<string>([
  'Dockerfile',
  'dockerfile',
  '.dockerignore',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.gitignore',
  'README.md',
  'README',
  'LICENSE',
  '.env',
  '.env.example',
  'tsconfig.json',
  'jsconfig.json',
  'Makefile',
  'justfile',
  'Justfile',
  'Taskfile.yml',
  'Taskfile.yaml',
]);

export function collectScaffoldContext(opts: CollectContextOptions = {}): ScaffoldContext {
  const cwd = opts.cwd || process.cwd();
  const base = collectContext(opts);
  const manifests: ManifestSummary[] = [];

  for (const project of base.projects) {
    const fp = path.join(cwd, project.file);
    let fields: Record<string, unknown> | undefined;
    if (project.kind === 'node' && project.file === 'package.json') {
      fields = safe(() => extractNodeFields(fp));
    } else if (project.kind === 'rust') {
      fields = safe(() => extractRustFields(fp));
    } else if (project.kind === 'python' && project.file === 'pyproject.toml') {
      fields = safe(() => extractPythonFields(fp));
    } else if (project.kind === 'go') {
      fields = safe(() => extractGoFields(fp));
    }

    if (fields && Object.keys(fields).length > 0) {
      manifests.push({ kind: project.kind, file: project.file, fields });
    }
  }

  // tsconfig.json is not a PROJECT_MARKER but is high-signal for scaffold.
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    const fields = safe(() => extractTsConfigFields(tsconfigPath));
    if (fields && Object.keys(fields).length > 0) {
      manifests.push({ kind: 'typescript', file: 'tsconfig.json', fields });
    }
  }

  const existingFiles = safe(() => listExistingFiles(cwd)) || [];

  return { base, manifests, existingFiles };
}

export function renderScaffoldContextForPrompt(ctx: ScaffoldContext): string {
  const lines: string[] = [];
  lines.push(renderContextForPrompt(ctx.base));

  if (ctx.manifests.length === 0 && ctx.existingFiles.length === 0) {
    return lines.join('\n');
  }

  lines.push('');
  lines.push('## Project context (deep)');
  for (const m of ctx.manifests) {
    lines.push(`${m.kind} [${m.file}]`);
    for (const [key, value] of Object.entries(m.fields)) {
      const formatted = Array.isArray(value) ? value.join(', ') : String(value);
      lines.push(`  ${key}: ${formatted}`);
    }
  }
  if (ctx.existingFiles.length > 0) {
    lines.push(`Existing files: ${ctx.existingFiles.join(', ')}`);
  }
  lines.push('Tailor the scaffold to these project specifics. Do NOT overwrite files listed in "Existing files" unless the user goal explicitly says so.');

  return lines.join('\n');
}

// ---------- per-kind extractors ----------

function extractNodeFields(filePath: string): Record<string, unknown> {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const out: Record<string, unknown> = {};

  if (pkg.engines && typeof pkg.engines === 'object') {
    const eng: string[] = [];
    if (pkg.engines.node) eng.push(`node${pkg.engines.node}`);
    if (pkg.engines.npm) eng.push(`npm${pkg.engines.npm}`);
    if (eng.length > 0) out.engines = eng.join(', ');
  }
  if (pkg.type) out.type = pkg.type;
  if (pkg.main) out.main = pkg.main;
  if (pkg.bin) {
    out.bin = typeof pkg.bin === 'string' ? pkg.bin : Object.keys(pkg.bin);
  }
  if (pkg.dependencies && typeof pkg.dependencies === 'object') {
    const deps = Object.keys(pkg.dependencies).slice(0, 10);
    if (deps.length > 0) out.deps = deps;
  }
  return out;
}

function extractRustFields(filePath: string): Record<string, unknown> {
  const toml = parseToml(fs.readFileSync(filePath, 'utf-8')) as any;
  const out: Record<string, unknown> = {};

  if (toml.package && typeof toml.package === 'object') {
    if (toml.package.name) out.name = toml.package.name;
    if (toml.package.edition) out.edition = toml.package.edition;
    if (toml.package['rust-version']) out['rust-version'] = toml.package['rust-version'];
  }
  // [[bin]] tables come through as an array under toml.bin
  if (Array.isArray(toml.bin)) {
    const bins = toml.bin.map((b: any) => b?.name).filter((n: any) => typeof n === 'string');
    if (bins.length > 0) out.bins = bins;
  }
  if (toml.dependencies && typeof toml.dependencies === 'object') {
    const deps = Object.keys(toml.dependencies).slice(0, 10);
    if (deps.length > 0) out.deps = deps;
  }
  return out;
}

function extractPythonFields(filePath: string): Record<string, unknown> {
  const toml = parseToml(fs.readFileSync(filePath, 'utf-8')) as any;
  const out: Record<string, unknown> = {};

  if (toml.project && typeof toml.project === 'object') {
    if (toml.project.name) out.name = toml.project.name;
    if (toml.project['requires-python']) out['requires-python'] = toml.project['requires-python'];
    if (Array.isArray(toml.project.dependencies)) {
      // PEP 621 deps are strings like "requests>=2.0,<3" — keep just the name.
      const deps = toml.project.dependencies
        .slice(0, 10)
        .map((s: string) => String(s).split(/[<>=!~ \[]/)[0].trim())
        .filter(Boolean);
      if (deps.length > 0) out.deps = deps;
    }
    if (toml.project.scripts && typeof toml.project.scripts === 'object') {
      const scripts = Object.keys(toml.project.scripts);
      if (scripts.length > 0) out.scripts = scripts;
    }
  }

  // Build backend detection — first match wins.
  const tools = toml.tool || {};
  if (tools.poetry) out['build-tool'] = 'poetry';
  else if (tools.uv) out['build-tool'] = 'uv';
  else if (tools.hatch) out['build-tool'] = 'hatch';
  else if (tools.setuptools) out['build-tool'] = 'setuptools';
  else if (toml['build-system']?.['build-backend']) {
    out['build-tool'] = String(toml['build-system']['build-backend']);
  }

  // Poetry-style deps fall under [tool.poetry.dependencies] and aren't in [project].
  if (!out.deps && tools.poetry?.dependencies && typeof tools.poetry.dependencies === 'object') {
    const deps = Object.keys(tools.poetry.dependencies)
      .filter(k => k !== 'python')
      .slice(0, 10);
    if (deps.length > 0) out.deps = deps;
  }

  return out;
}

function extractGoFields(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const out: Record<string, unknown> = {};

  const moduleMatch = content.match(/^module\s+(\S+)/m);
  if (moduleMatch) out.module = moduleMatch[1];

  const goMatch = content.match(/^go\s+(\S+)/m);
  if (goMatch) out.go = goMatch[1];

  const requires: string[] = [];
  // Block-style: require ( ... )
  const reqBlockMatch = content.match(/require\s*\(([\s\S]*?)\)/);
  if (reqBlockMatch) {
    for (const line of reqBlockMatch[1].split('\n')) {
      const m = line.trim().match(/^(\S+)\s+\S+/);
      if (m && requires.length < 5) requires.push(m[1]);
    }
  } else {
    // Single-line: require foo/bar v1.0.0
    for (const m of content.matchAll(/^require\s+(\S+)\s+\S+/gm)) {
      if (requires.length < 5) requires.push(m[1]);
    }
  }
  if (requires.length > 0) out.requires = requires;

  return out;
}

function extractTsConfigFields(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(stripJsonc(raw));
  const out: Record<string, unknown> = {};

  if (json.extends) out.extends = String(json.extends);
  const co = json.compilerOptions;
  if (co && typeof co === 'object') {
    if (co.target) out.target = String(co.target);
    if (co.module) out.module = String(co.module);
    if (typeof co.strict === 'boolean') out.strict = co.strict;
    if (co.outDir) out.outDir = String(co.outDir);
    if (co.rootDir) out.rootDir = String(co.rootDir);
  }
  return out;
}

/**
 * Strip JSONC comments (// line and /* block) so JSON.parse can handle
 * tsconfig.json files. Respects string boundaries with escape handling so
 * `"http://..."` URLs inside strings don't get mangled. Also strips trailing
 * commas before `}` or `]` since tsconfig commonly has them.
 */
function stripJsonc(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // Walk to end of string, honoring backslash escapes.
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === '\\') { end += 2; continue; }
        if (text[end] === '"') break;
        end++;
      }
      result += text.slice(i, Math.min(end + 1, text.length));
      i = end + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result.replace(/,(\s*[}\]])/g, '$1');
}

function listExistingFiles(cwd: string): string[] {
  const entries = fs.readdirSync(cwd);
  return entries.filter(e => INTERESTING_FILES.has(e));
}
