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
}

/** generate 命令选项 */
export interface GenerateOptions {
  run?: boolean;
  copy?: boolean;
  shell?: ShellType;
}

/** explain 命令选项 */
export interface ExplainOptions {
  brief?: boolean;
  detail?: boolean;
}

/** 历史记录条目 */
export interface HistoryEntry {
  id: number;
  timestamp: string;
  type: 'generate' | 'explain' | 'ask';
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
