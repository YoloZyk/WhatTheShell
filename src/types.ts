// WhatTheShell 类型定义

/** 支持的 Shell 类型 */
export type ShellType = 'bash' | 'zsh' | 'powershell' | 'fish';

/** 支持的 AI 提供商 */
export type AIProvider = 'openai' | 'anthropic';

/** 输出语言 */
export type Language = 'zh' | 'en';

/** 解释详细程度 */
export type DetailLevel = 'brief' | 'normal' | 'detail';

/** 危险等级 */
export type RiskLevel = 'safe' | 'warning' | 'danger';

/** 用户配置 */
export interface WtsConfig {
  api_key: string;
  provider: AIProvider;
  base_url: string;
  model: string;
  language: Language;
  shell: ShellType;
  history_limit: number;
  /** 是否在调用 AI 前采集并注入上下文 (v0.2) */
  context_enable: boolean;
  /** 注入的 shell history 行数，0 表示不注入 (v0.2) */
  context_history_lines: number;
}

/** generate 命令选项 */
export interface GenerateOptions {
  run?: boolean;
  copy?: boolean;
  shell?: ShellType;
  /** 行内模式：供 shell 集成脚本调用，输出纯净命令到 stdout，不走 UI (v0.2) */
  inline?: boolean;
  /** 当前命令行 buffer（由 shell 集成脚本传入） (v0.2) */
  buffer?: string;
  /** 外部 shell history 文件路径（由 shell 集成脚本传入 $HISTFILE） (v0.2) */
  historyFile?: string;
}

/** explain 命令选项 */
export interface ExplainOptions {
  brief?: boolean;
  detail?: boolean;
}

/** scaffold 命令选项 */
export interface ScaffoldOptions {
  shell?: ShellType;
}

/** 历史记录条目 */
export interface HistoryEntry {
  id: number;
  timestamp: string;
  /**
   * Entry type. `'script'` is a legacy alias for `'scaffold'` — old entries
   * on disk from before the rename still carry it; new entries always use
   * `'scaffold'`. History UI renders both identically.
   */
  type: 'generate' | 'explain' | 'ask' | 'script' | 'scaffold';
  input: string;
  output: string;
}

/** AI 生成结果 */
export interface GenerateResult {
  command: string;
  risk: RiskLevel;
  warning?: string;
}

/** AI 解释结果 */
export interface ExplainResult {
  segments: CommandSegment[];
  summary: string;
  risk: RiskLevel;
  warning?: string;
}

/** 命令段解释 */
export interface CommandSegment {
  text: string;
  explanation: string;
}

/** 项目标记文件识别到的信息 (v0.2) */
export interface ProjectMarker {
  /** 标记文件类型（如 node/rust/go/python/docker） */
  kind: string;
  /** 标记文件相对路径 */
  file: string;
  /** 提取的脚本/目标名（如 npm scripts、cargo targets） */
  scripts?: string[];
}

/** Git 状态快照 (v0.2) */
export interface GitSnapshot {
  branch: string;
  dirty: boolean;
  upstream?: string;
  /** 最近 3 条 commit subject */
  recentCommits?: string[];
}

/** 调用现场上下文快照 (v0.2) */
export interface ContextSnapshot {
  /** 当前工作目录 */
  pwd: string;
  /** 识别到的项目标记（可能有多个） */
  projects: ProjectMarker[];
  /** git 状态；不在 repo 中则为 undefined */
  git?: GitSnapshot;
  /** 最近的 shell history（已经过 sanitize） */
  recentHistory: string[];
}
