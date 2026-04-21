import type { WtsConfig, AIProvider, Language, ShellType } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { parse, stringify } from '@iarna/toml';

const WTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.wts');
const CONFIG_PATH = path.join(WTS_DIR, 'config.toml');

/** Default configuration */
export const DEFAULT_CONFIG: WtsConfig = {
  api_key: '',
  provider: 'openai',
  base_url: '',
  model: 'gpt-4o',
  language: 'en',
  shell: 'bash',
  history_limit: 100,
  context_enable: true,
  context_history_lines: 5,
};

/** Valid config keys */
const VALID_KEYS = new Set<string>(Object.keys(DEFAULT_CONFIG));

/** CLI-friendly dotted aliases → underlying storage keys */
const KEY_ALIASES: Record<string, string> = {
  'context.enable': 'context_enable',
  'context.history_lines': 'context_history_lines',
};

/** Per-key validation rules */
const VALIDATORS: Record<string, (v: string) => boolean> = {
  provider: (v) => ['openai', 'anthropic'].includes(v),
  base_url: (v) => v === '' || /^https?:\/\//.test(v),
  language: (v) => ['zh', 'en'].includes(v),
  shell: (v) => ['bash', 'zsh', 'powershell', 'fish'].includes(v),
  history_limit: (v) => /^\d+$/.test(v) && parseInt(v) > 0,
  context_enable: (v) => ['true', 'false', '1', '0'].includes(v.toLowerCase()),
  context_history_lines: (v) => /^\d+$/.test(v) && parseInt(v) >= 0,
};

/** Ensure ~/.wts exists */
export function ensureConfigDir(): void {
  if (!fs.existsSync(WTS_DIR)) {
    fs.mkdirSync(WTS_DIR, { recursive: true });
  }
}

/** Return the config directory path */
export function getConfigDir(): string {
  return WTS_DIR;
}

/** Read the config file (fall back to defaults if absent/invalid) */
export function loadConfig(): WtsConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parse(content);
    return { ...DEFAULT_CONFIG, ...parsed } as unknown as WtsConfig;
  } catch {
    console.error(`  Failed to parse config; falling back to defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

/** Write the full config object to disk */
export function saveConfig(config: WtsConfig): void {
  ensureConfigDir();
  const tomlContent = stringify(config as unknown as Record<string, any>);
  fs.writeFileSync(CONFIG_PATH, tomlContent, 'utf-8');
}

/** Read a single config key */
export function getConfigValue(key: keyof WtsConfig): string {
  const config = loadConfig();
  return String(config[key]);
}

/** Set a single config key */
export function setConfigValue(key: string, value: string): void {
  // Accept dotted aliases like "context.enable"
  const resolvedKey = KEY_ALIASES[key] || key;

  if (!VALID_KEYS.has(resolvedKey)) {
    console.error(`  Unknown config key: ${key}`);
    const friendly = [...VALID_KEYS].filter(k => !Object.values(KEY_ALIASES).includes(k) || Object.keys(KEY_ALIASES).some(a => KEY_ALIASES[a] === k));
    const aliases = Object.keys(KEY_ALIASES);
    console.error(`  Available keys: ${friendly.concat(aliases).join(', ')}`);
    return;
  }

  const validator = VALIDATORS[resolvedKey];
  if (validator && !validator(value)) {
    const hints: Record<string, string> = {
      provider: 'openai, anthropic',
      base_url: 'HTTP/HTTPS URL (empty string uses the provider default endpoint)',
      language: 'zh, en',
      shell: 'bash, zsh, powershell, fish',
      history_limit: 'positive integer',
      context_enable: 'true, false',
      context_history_lines: 'non-negative integer (0 disables history injection)',
    };
    console.error(`  Invalid value: ${value}`);
    console.error(`  Accepted values for ${key}: ${hints[resolvedKey]}`);
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

/** Print the full config plus a health-check footer */
export function listConfig(): void {
  const config = loadConfig();
  const fromFile = fs.existsSync(CONFIG_PATH);
  console.log(`  Config file: ${CONFIG_PATH}${fromFile ? '' : ' (not created yet, using defaults)'}\n`);
  for (const [key, value] of Object.entries(config)) {
    const display = key === 'api_key' ? maskValue(String(value)) : value;
    console.log(`  ${key} = ${display}`);
  }
  console.log();

  // Health check: API Key + Context + Shell integration status
  const keyState = config.api_key
    ? '✓ set'
    : '✗ not set (run `wts init` to configure)';
  console.log(`  API Key: ${keyState}`);

  const ctxState = config.context_enable
    ? `on (history_lines=${config.context_history_lines})`
    : 'off';
  console.log(`  Context collection: ${ctxState}`);

  const integ = detectShellIntegrationState();
  console.log(`  Shell integration: ${integ}`);
}

/** Check common shell rc files for an installed wts integration */
function detectShellIntegrationState(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '? HOME directory could not be determined';

  const candidates: Array<{ shell: string; file: string; marker: string }> = [
    { shell: 'zsh', file: path.join(home, '.zshrc'), marker: 'wts shell-init' },
    { shell: 'bash', file: path.join(home, '.bashrc'), marker: 'wts shell-init' },
    { shell: 'bash', file: path.join(home, '.bash_profile'), marker: 'wts shell-init' },
    // fish: the mere existence of the file counts as installed (our init writes it)
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
      /* ignore single-file errors */
    }
  }

  if (installed.length === 0) return '✗ not installed (run `wts init` or eval "$(wts shell-init <shell>)")';
  return `✓ installed (${installed.join(', ')})`;
}

/** Render an API-key-like string with masking */
function maskValue(value: string): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Provider preset */
export interface ProviderPreset {
  provider: AIProvider;
  base_url: string;
  model: string;
  label: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai:      { provider: 'openai',    base_url: '',                                                    model: 'gpt-4o',                     label: 'OpenAI' },
  anthropic:   { provider: 'anthropic', base_url: '',                                                    model: 'claude-sonnet-4-20250514',   label: 'Anthropic Claude' },
  qwen:        { provider: 'openai',    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   model: 'qwen-plus',                  label: 'Alibaba Qwen' },
  deepseek:    { provider: 'openai',    base_url: 'https://api.deepseek.com/v1',                         model: 'deepseek-chat',              label: 'DeepSeek' },
  kimi:        { provider: 'openai',    base_url: 'https://api.moonshot.cn/v1',                          model: 'moonshot-v1-8k',             label: 'Moonshot KIMI' },
  minimax:     { provider: 'openai',    base_url: 'https://api.minimax.chat/v1',                         model: 'MiniMax-Text-01',            label: 'MiniMax' },
  zhipu:       { provider: 'openai',    base_url: 'https://open.bigmodel.cn/api/paas/v4',                model: 'glm-4-flash',               label: 'Zhipu GLM' },
  baichuan:    { provider: 'openai',    base_url: 'https://api.baichuan-ai.com/v1',                      model: 'Baichuan4',                  label: 'Baichuan' },
  yi:          { provider: 'openai',    base_url: 'https://api.lingyiwanwu.com/v1',                      model: 'yi-large',                   label: '01.AI Yi' },
  siliconflow: { provider: 'openai',    base_url: 'https://api.siliconflow.cn/v1',                       model: 'deepseek-ai/DeepSeek-V3',    label: 'SiliconFlow' },
};

/** Apply a provider preset to the current config */
export function applyPreset(name: string): boolean {
  const preset = PROVIDER_PRESETS[name.toLowerCase()];
  if (!preset) {
    console.error(`  Unknown provider: ${name}`);
    console.error(`  Available presets: ${Object.keys(PROVIDER_PRESETS).join(', ')}`);
    return false;
  }

  const config = loadConfig();
  config.provider = preset.provider;
  config.base_url = preset.base_url;
  config.model = preset.model;
  saveConfig(config);

  console.log(`  ✓ Switched to ${preset.label}`);
  console.log(`    provider = ${preset.provider}`);
  console.log(`    base_url = ${preset.base_url || '(default)'}`);
  console.log(`    model    = ${preset.model}`);
  return true;
}
