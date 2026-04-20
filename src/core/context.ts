import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { ContextSnapshot, ProjectMarker, GitSnapshot } from '../types';

export interface CollectContextOptions {
  /** 注入的 shell history 行数；0 表示不采集 */
  historyLines?: number;
  /** 外部传入的 shell history 文件路径（优先级高于自动推断） */
  historyFile?: string;
  /** 采集所在目录；默认 process.cwd() */
  cwd?: string;
}

/** 采集调用现场上下文。任何一步失败都会静默降级，绝不向外抛异常 */
export function collectContext(opts: CollectContextOptions = {}): ContextSnapshot {
  const cwd = opts.cwd || process.cwd();
  const historyLines = opts.historyLines ?? 5;

  return {
    pwd: cwd,
    projects: safe(() => detectProjects(cwd)) || [],
    git: safe(() => readGitSnapshot(cwd)),
    recentHistory: historyLines > 0
      ? (safe(() => readShellHistory(historyLines, opts.historyFile)) || [])
      : [],
  };
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------- 项目标记检测 ----------

const PROJECT_MARKERS: Array<{ file: string; kind: string }> = [
  { file: 'package.json', kind: 'node' },
  { file: 'Cargo.toml', kind: 'rust' },
  { file: 'go.mod', kind: 'go' },
  { file: 'pyproject.toml', kind: 'python' },
  { file: 'requirements.txt', kind: 'python' },
  { file: 'docker-compose.yml', kind: 'docker-compose' },
  { file: 'docker-compose.yaml', kind: 'docker-compose' },
  { file: 'compose.yml', kind: 'docker-compose' },
  { file: 'Dockerfile', kind: 'docker' },
  { file: 'Makefile', kind: 'make' },
];

function detectProjects(cwd: string): ProjectMarker[] {
  const markers: ProjectMarker[] = [];

  for (const m of PROJECT_MARKERS) {
    const p = path.join(cwd, m.file);
    if (!fs.existsSync(p)) continue;

    const marker: ProjectMarker = { kind: m.kind, file: m.file };
    const scripts = safe(() => extractScripts(p, m.kind));
    if (scripts && scripts.length > 0) {
      marker.scripts = scripts;
    }
    markers.push(marker);
  }

  return markers;
}

function extractScripts(filePath: string, kind: string): string[] | undefined {
  if (kind === 'node') {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (pkg && typeof pkg.scripts === 'object') {
      return Object.keys(pkg.scripts).slice(0, 20);
    }
    return [];
  }
  if (kind === 'make') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const targets = new Set<string>();
    // 匹配 "target:" 行（非 .PHONY 等伪目标、非变量赋值）
    for (const line of content.split('\n')) {
      const m = /^([a-zA-Z0-9_\-\/\.]+)\s*:(?!=)/.exec(line);
      if (m && !m[1].startsWith('.')) {
        targets.add(m[1]);
        if (targets.size >= 20) break;
      }
    }
    return [...targets];
  }
  return undefined;
}

// ---------- Git 状态 ----------

function readGitSnapshot(cwd: string): GitSnapshot | undefined {
  // 先确认是 repo
  const inside = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside !== 'true') return undefined;

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || '(detached)';
  const dirty = (runGit(['status', '--porcelain'], cwd) || '').trim().length > 0;
  const upstream = runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], cwd) || undefined;
  const recentRaw = runGit(['log', '-3', '--pretty=format:%s'], cwd);
  const recentCommits = recentRaw ? recentRaw.split('\n').filter(Boolean) : undefined;

  return { branch, dirty, upstream, recentCommits };
}

function runGit(args: string[], cwd: string): string | undefined {
  try {
    const out = execSync(`git ${args.map(shellQuote).join(' ')}`, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1500,
    });
    return out.trim();
  } catch {
    return undefined;
  }
}

function shellQuote(arg: string): string {
  // git 参数都是已知字面量，简单包一层
  if (/^[A-Za-z0-9_\-@\/\{\}:=%]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// ---------- Shell history ----------

function readShellHistory(lines: number, explicitFile?: string): string[] {
  const file = explicitFile || guessHistoryFile();
  if (!file || !fs.existsSync(file)) return [];

  const content = safeRead(file);
  if (!content) return [];

  // zsh 扩展历史格式: `: 1700000000:0;command`
  // bash 直接行
  const rawLines = content.split('\n').filter(Boolean);
  const parsed = rawLines.map(parseHistoryLine);
  const tail = parsed.slice(-lines);
  return tail.map(sanitizeHistoryLine).filter(Boolean);
}

function guessHistoryFile(): string | undefined {
  const env = process.env.HISTFILE;
  if (env) return env;

  const home = os.homedir();
  // 按存在性逐个 fallback
  const candidates = [
    path.join(home, '.zsh_history'),
    path.join(home, '.bash_history'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function safeRead(file: string): string | undefined {
  try {
    // 用流式读取末尾，避免大文件内存炸裂
    const stat = fs.statSync(file);
    const maxBytes = 64 * 1024;
    if (stat.size <= maxBytes) {
      return fs.readFileSync(file, 'utf-8');
    }
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      return buf.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function parseHistoryLine(line: string): string {
  // zsh: `: 1700000000:0;<command>`
  const zsh = /^:\s*\d+:\d+;(.*)$/.exec(line);
  if (zsh) return zsh[1];
  return line;
}

// ---------- Sanitizer ----------

/** 脱敏规则：按顺序应用 */
const SANITIZE_RULES: Array<[RegExp, string]> = [
  // 命令行参数携带的 token / key / secret / password
  [/(--?(?:token|api[-_]?key|secret|password|passwd|pwd)[= ])\S+/gi, '$1***'],
  // HTTP Authorization header
  [/(Authorization\s*:\s*\S+\s+)\S+/gi, '$1***'],
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***'],
  // OpenAI / Anthropic 常见 key 形态
  [/sk-ant-[A-Za-z0-9_\-]{20,}/g, 'sk-ant-***'],
  [/sk-[A-Za-z0-9]{20,}/g, 'sk-***'],
  // AWS Access Key ID
  [/AKIA[0-9A-Z]{16}/g, 'AKIA***'],
  // 形如 user:password@host 的 URL
  [/(:\/\/[^:\/\s]+:)[^@\s]+(@)/g, '$1***$2'],
  // 环境变量赋值：XXX_TOKEN=... / XXX_KEY=... / XXX_SECRET=...
  [/([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS)\s*=\s*)\S+/g, '$1***'],
];

export function sanitizeHistoryLine(line: string): string {
  let out = line;
  for (const [re, rep] of SANITIZE_RULES) {
    out = out.replace(re, rep);
  }
  return out.trim();
}

// ---------- Prompt 渲染辅助 ----------

/** 把上下文快照渲染为 prompt 里可读的一段文本 */
export function renderContextForPrompt(ctx: ContextSnapshot): string {
  const lines: string[] = ['## Current environment'];
  lines.push(`PWD: ${ctx.pwd}`);

  if (ctx.projects.length > 0) {
    const parts = ctx.projects.map(p => {
      const scripts = p.scripts && p.scripts.length > 0
        ? ` (scripts: ${p.scripts.slice(0, 8).join(', ')})`
        : '';
      return `${p.kind} [${p.file}]${scripts}`;
    });
    lines.push(`Project markers: ${parts.join(' | ')}`);
  }

  if (ctx.git) {
    const parts: string[] = [`branch=${ctx.git.branch}`];
    if (ctx.git.dirty) parts.push('dirty');
    if (ctx.git.upstream) parts.push(`upstream=${ctx.git.upstream}`);
    lines.push(`Git: ${parts.join(', ')}`);
    if (ctx.git.recentCommits && ctx.git.recentCommits.length > 0) {
      lines.push(`Recent commits: ${ctx.git.recentCommits.join(' | ')}`);
    }
  }

  if (ctx.recentHistory.length > 0) {
    lines.push(`Recent shell history:`);
    for (const h of ctx.recentHistory) {
      lines.push(`  $ ${h}`);
    }
  }

  lines.push('Use this context to make the command more relevant to the user\'s project. Do NOT blindly copy past commands.');
  return lines.join('\n');
}
