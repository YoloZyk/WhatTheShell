import * as fs from 'fs';
import * as path from 'path';
import type { ShellType } from '../types';
import { SHELL_DANGER_EXAMPLES } from './prompt';

/** 单文件大小上限：防止把 README 之类大文档整个塞给 AI */
export const MAX_FILE_BYTES = 100 * 1024;

/**
 * 自动检测时接受的扩展名（无路径分隔符的情况下）。
 * 涵盖 shell + 主流代码 + 配置/标记 + 文档。
 */
export const CODE_FILE_EXT_RE = /\.(sh|bash|zsh|fish|ps1|psm1|py|pyw|js|mjs|cjs|jsx|ts|tsx|java|kt|kts|go|rs|rb|php|swift|c|h|cc|cpp|hpp|hxx|cxx|cs|lua|dart|scala|sql|yml|yaml|toml|json|xml|html|htm|css|scss|less|md|markdown|txt|rst)$/i;

/** 无扩展名但常见的项目文件 basename（含 .dev / .am 等后缀变体） */
export const KNOWN_BASENAME_RE = /^(Dockerfile|Containerfile|Makefile|GNUmakefile|Rakefile|Gemfile|Procfile|Brewfile|Vagrantfile)(\..+)?$/i;

/** 文件路径 vs 命令字符串判别。
 *  - 含路径分隔符 → 文件
 *  - 整 basename 命中代码文件后缀白名单 → 文件
 *  - basename 命中 well-known 项目文件名（Dockerfile / Makefile 等）→ 文件
 *  - 其余 → 命令
 */
export function looksLikeFilePath(s: string): boolean {
  if (s.includes('/') || s.includes('\\')) return true;
  if (CODE_FILE_EXT_RE.test(s)) return true;
  if (KNOWN_BASENAME_RE.test(s)) return true;
  return false;
}

export interface FileLang {
  /** shell 类沿用 SHELL_DANGER_EXAMPLES 提升危险检测精度；其他都标 code */
  kind: 'shell' | 'code';
  /** 给 prompt 看的人类可读语言标签（如 "python" / "bash" / "yaml"） */
  label: string;
  /** kind === 'shell' 时填，用于本地 danger fallback 的 shell-specific 规则 */
  shell?: ShellType;
  /** shell 文件传给 prompt 的精度提示；非 shell 留空 */
  shellRiskHint?: { danger: string; caution: string };
}

/** 扩展名/basename → label 的映射（不含 shell 那 4 种，单独处理） */
const EXT_TO_LABEL: Record<string, string> = {
  py: 'python', pyw: 'python',
  js: 'javascript', mjs: 'javascript (esm)', cjs: 'javascript (cjs)',
  jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  c: 'c', h: 'c/c++ header',
  cc: 'c++', cpp: 'c++', hpp: 'c++ header', hxx: 'c++ header', cxx: 'c++',
  cs: 'c#',
  lua: 'lua', dart: 'dart', scala: 'scala', sql: 'sql',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', json: 'json', xml: 'xml',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', txt: 'plain text', rst: 'restructuredtext',
};

function shellLang(shell: ShellType): FileLang {
  return { kind: 'shell', label: shell, shell, shellRiskHint: SHELL_DANGER_EXAMPLES[shell] };
}

/**
 * 根据 filename 推断语言：
 *   - .ps1/.psm1 → powershell；.zsh → zsh；.fish → fish；.sh/.bash → bash（shell 类）
 *   - 其他扩展名查 EXT_TO_LABEL（code 类）
 *   - basename 是 Dockerfile / Makefile / Rakefile / Gemfile / Procfile（含变体） → code
 *   - 都不命中（无扩展名 / 未识别）→ 兜底视为 fallback shell（保留 shell-specific 风险检测）
 */
export function detectFileLang(filename: string, fallback: ShellType): FileLang {
  const base = path.basename(filename);
  const lower = base.toLowerCase();

  if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return shellLang('powershell');
  if (lower.endsWith('.zsh')) return shellLang('zsh');
  if (lower.endsWith('.fish')) return shellLang('fish');
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return shellLang('bash');

  const m = lower.match(/\.([a-z0-9]+)$/);
  if (m && EXT_TO_LABEL[m[1]]) {
    return { kind: 'code', label: EXT_TO_LABEL[m[1]] };
  }

  // well-known 无扩展名 basename
  if (/^(Dockerfile|Containerfile)(\..+)?$/i.test(base)) {
    return { kind: 'code', label: 'dockerfile' };
  }
  if (/^(Makefile|GNUmakefile)(\..+)?$/i.test(base)) {
    return { kind: 'code', label: 'makefile' };
  }
  if (/^Rakefile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Rakefile)' };
  if (/^Gemfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Gemfile)' };
  if (/^Procfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'procfile' };
  if (/^Brewfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Brewfile)' };
  if (/^Vagrantfile(\..+)?$/i.test(base)) return { kind: 'code', label: 'ruby (Vagrantfile)' };

  return shellLang(fallback);
}

export type ReadResult =
  | { ok: true; filePath: string; content: string }
  | { ok: false; reason: string };

/**
 * 把参数当文件路径试读：
 *   - 必须是 regular file
 *   - ≤ 100 KB
 *   - 前 1KB 不含 NUL byte（粗略二进制检测）
 * 任意一项不满足就返回 reason，由调用方决定报错还是回退到命令模式。
 */
export function readSafeFile(p: string): ReadResult {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch (e: any) {
    return { ok: false, reason: `cannot stat ${p}: ${e.code || e.message}` };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: `${p} is not a regular file` };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `${p} is ${(stat.size / 1024).toFixed(1)} KB, larger than the 100 KB limit. Trim it down or split before sending to AI.`,
    };
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(p);
  } catch (e: any) {
    return { ok: false, reason: `cannot read ${p}: ${e.code || e.message}` };
  }
  const probe = buf.subarray(0, Math.min(1024, buf.length));
  if (probe.includes(0)) {
    return {
      ok: false,
      reason: `${p} appears to be binary (NUL byte found). Refusing to send to AI.`,
    };
  }
  return { ok: true, filePath: p, content: buf.toString('utf8') };
}
