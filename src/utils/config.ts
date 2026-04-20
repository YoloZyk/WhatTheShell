import type { WtsConfig, AIProvider, Language, ShellType } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { parse, stringify } from '@iarna/toml';

const WTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.wts');
const CONFIG_PATH = path.join(WTS_DIR, 'config.toml');

/** 默认配置 */
export const DEFAULT_CONFIG: WtsConfig = {
  api_key: '',
  provider: 'openai',
  base_url: '',
  model: 'gpt-4o',
  language: 'zh',
  shell: 'bash',
  history_limit: 100,
  context_enable: true,
  context_history_lines: 5,
};

/** 合法配置键 */
const VALID_KEYS = new Set<string>(Object.keys(DEFAULT_CONFIG));

/** 带点号的 CLI 键别名 → 实际存储键 */
const KEY_ALIASES: Record<string, string> = {
  'context.enable': 'context_enable',
  'context.history_lines': 'context_history_lines',
};

/** 配置项校验规则 */
const VALIDATORS: Record<string, (v: string) => boolean> = {
  provider: (v) => ['openai', 'anthropic'].includes(v),
  base_url: (v) => v === '' || /^https?:\/\//.test(v),
  language: (v) => ['zh', 'en'].includes(v),
  shell: (v) => ['bash', 'zsh', 'powershell', 'fish'].includes(v),
  history_limit: (v) => /^\d+$/.test(v) && parseInt(v) > 0,
  context_enable: (v) => ['true', 'false', '1', '0'].includes(v.toLowerCase()),
  context_history_lines: (v) => /^\d+$/.test(v) && parseInt(v) >= 0,
};

/** 确保 ~/.wts 目录存在 */
export function ensureConfigDir(): void {
  if (!fs.existsSync(WTS_DIR)) {
    fs.mkdirSync(WTS_DIR, { recursive: true });
  }
}

/** 获取配置目录路径 */
export function getConfigDir(): string {
  return WTS_DIR;
}

/** 读取配置 */
export function loadConfig(): WtsConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parse(content);
    return { ...DEFAULT_CONFIG, ...parsed } as unknown as WtsConfig;
  } catch {
    console.error(`  配置文件解析失败，使用默认配置`);
    return { ...DEFAULT_CONFIG };
  }
}

/** 写入完整配置到文件 */
export function saveConfig(config: WtsConfig): void {
  ensureConfigDir();
  const tomlContent = stringify(config as unknown as Record<string, any>);
  fs.writeFileSync(CONFIG_PATH, tomlContent, 'utf-8');
}

/** 获取单个配置项 */
export function getConfigValue(key: keyof WtsConfig): string {
  const config = loadConfig();
  return String(config[key]);
}

/** 设置单个配置项 */
export function setConfigValue(key: string, value: string): void {
  // 支持 "context.enable" 这类语义化点号键
  const resolvedKey = KEY_ALIASES[key] || key;

  if (!VALID_KEYS.has(resolvedKey)) {
    console.error(`  无效的配置项: ${key}`);
    const friendly = [...VALID_KEYS].filter(k => !Object.values(KEY_ALIASES).includes(k) || Object.keys(KEY_ALIASES).some(a => KEY_ALIASES[a] === k));
    const aliases = Object.keys(KEY_ALIASES);
    console.error(`  可用配置项: ${friendly.concat(aliases).join(', ')}`);
    return;
  }

  const validator = VALIDATORS[resolvedKey];
  if (validator && !validator(value)) {
    const hints: Record<string, string> = {
      provider: 'openai, anthropic',
      base_url: 'HTTP/HTTPS URL (留空使用默认端点)',
      language: 'zh, en',
      shell: 'bash, zsh, powershell, fish',
      history_limit: '正整数',
      context_enable: 'true, false',
      context_history_lines: '非负整数（0 表示不注入 history）',
    };
    console.error(`  无效的值: ${value}`);
    console.error(`  ${key} 的可选值: ${hints[resolvedKey]}`);
    return;
  }

  const config = loadConfig();
  if (resolvedKey === 'history_limit' || resolvedKey === 'context_history_lines') {
    (config as any)[resolvedKey] = parseInt(value);
  } else if (resolvedKey === 'context_enable') {
    (config as any)[resolvedKey] = ['true', '1'].includes(value.toLowerCase());
  } else {
    (config as any)[resolvedKey] = value;
  }
  saveConfig(config);

  const displayValue = resolvedKey === 'api_key' ? maskValue(value) : (config as any)[resolvedKey];
  console.log(`  ✓ ${key} = ${displayValue}`);
}

/** 列出所有配置 */
export function listConfig(): void {
  const config = loadConfig();
  const fromFile = fs.existsSync(CONFIG_PATH);
  console.log(`  配置文件: ${CONFIG_PATH}${fromFile ? '' : ' (未创建，使用默认值)'}\n`);
  for (const [key, value] of Object.entries(config)) {
    const display = key === 'api_key' ? maskValue(String(value)) : value;
    console.log(`  ${key} = ${display}`);
  }
  console.log();

  // 健康检查：API Key + Context + Shell 集成安装状态
  const keyState = config.api_key
    ? '✓ 已设置'
    : '✗ 未设置（运行 wts init 开始配置）';
  console.log(`  API Key: ${keyState}`);

  const ctxState = config.context_enable
    ? `on (history_lines=${config.context_history_lines})`
    : 'off';
  console.log(`  Context collection: ${ctxState}`);

  const integ = detectShellIntegrationState();
  console.log(`  Shell integration: ${integ}`);
}

/** 检查常见 shell rc 文件里是否已装 wts 集成 */
function detectShellIntegrationState(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '? 无法确定 HOME 目录';

  const candidates: Array<{ shell: string; file: string; marker: string }> = [
    { shell: 'zsh', file: path.join(home, '.zshrc'), marker: 'wts shell-init' },
    { shell: 'bash', file: path.join(home, '.bashrc'), marker: 'wts shell-init' },
    { shell: 'bash', file: path.join(home, '.bash_profile'), marker: 'wts shell-init' },
    // fish: 存在性本身就算装上（我们的 init 会写这个文件）
    { shell: 'fish', file: path.join(home, '.config', 'fish', 'conf.d', 'wts.fish'), marker: '' },
    // PowerShell 7 (Windows)
    { shell: 'powershell', file: path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' },
    // Windows PowerShell 5.1
    { shell: 'powershell', file: path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' },
    // PowerShell Core on macOS / Linux
    { shell: 'powershell', file: path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' },
  ];

  const installed: string[] = [];
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c.file)) continue;
      if (c.marker === '') {
        if (!installed.includes(c.shell)) installed.push(c.shell);
        continue;
      }
      const content = fs.readFileSync(c.file, 'utf-8');
      if (content.includes(c.marker)) {
        if (!installed.includes(c.shell)) installed.push(c.shell);
      }
    } catch {
      /* 忽略单个文件读取错误 */
    }
  }

  if (installed.length === 0) return '✗ 未安装（运行 wts init 或 eval "$(wts shell-init <shell>)"）';
  return `✓ 已装 (${installed.join(', ')})`;
}

/** 脱敏显示 */
function maskValue(value: string): string {
  if (!value) return '(未设置)';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** 提供商预设 */
export interface ProviderPreset {
  provider: AIProvider;
  base_url: string;
  model: string;
  label: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai:      { provider: 'openai',    base_url: '',                                                    model: 'gpt-4o',                     label: 'OpenAI' },
  anthropic:   { provider: 'anthropic', base_url: '',                                                    model: 'claude-sonnet-4-20250514',   label: 'Anthropic Claude' },
  qwen:        { provider: 'openai',    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   model: 'qwen-plus',                  label: '通义千问 (Qwen)' },
  deepseek:    { provider: 'openai',    base_url: 'https://api.deepseek.com/v1',                         model: 'deepseek-chat',              label: 'DeepSeek' },
  kimi:        { provider: 'openai',    base_url: 'https://api.moonshot.cn/v1',                          model: 'moonshot-v1-8k',             label: 'Moonshot KIMI' },
  minimax:     { provider: 'openai',    base_url: 'https://api.minimax.chat/v1',                         model: 'MiniMax-Text-01',            label: 'MiniMax' },
  zhipu:       { provider: 'openai',    base_url: 'https://open.bigmodel.cn/api/paas/v4',                model: 'glm-4-flash',               label: '智谱 GLM' },
  baichuan:    { provider: 'openai',    base_url: 'https://api.baichuan-ai.com/v1',                      model: 'Baichuan4',                  label: '百川 Baichuan' },
  yi:          { provider: 'openai',    base_url: 'https://api.lingyiwanwu.com/v1',                      model: 'yi-large',                   label: '零一万物 (Yi)' },
  siliconflow: { provider: 'openai',    base_url: 'https://api.siliconflow.cn/v1',                       model: 'deepseek-ai/DeepSeek-V3',    label: 'SiliconFlow' },
};

/** 应用提供商预设 */
export function applyPreset(name: string): boolean {
  const preset = PROVIDER_PRESETS[name.toLowerCase()];
  if (!preset) {
    console.error(`  未知的提供商: ${name}`);
    console.error(`  可用预设: ${Object.keys(PROVIDER_PRESETS).join(', ')}`);
    return false;
  }

  const config = loadConfig();
  config.provider = preset.provider;
  config.base_url = preset.base_url;
  config.model = preset.model;
  saveConfig(config);

  console.log(`  ✓ 已切换到 ${preset.label}`);
  console.log(`    provider = ${preset.provider}`);
  console.log(`    base_url = ${preset.base_url || '(默认)'}`);
  console.log(`    model    = ${preset.model}`);
  return true;
}
