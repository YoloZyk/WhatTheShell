import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, GenerateResult, ExplainResult, DetailLevel, ShellType, Language, RiskLevel, CommandSegment } from '../types';
import { buildGeneratePrompt, buildExplainPrompt, buildAskPrompt } from './prompt';

export class AIClient {
  private provider: AIProvider;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(provider: AIProvider, apiKey: string, model: string, baseUrl: string = '') {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /** 调用 AI 获取原始文本回复 */
  private async chat(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('API Key 未设置，请先运行: wts config set api_key <your-key>');
    }

    if (this.provider === 'anthropic') {
      return this.chatAnthropic(prompt);
    }
    return this.chatOpenAI(prompt);
  }

  private async chatOpenAI(prompt: string): Promise<string> {
    const clientOptions: any = { apiKey: this.apiKey };
    if (this.baseUrl) {
      clientOptions.baseURL = this.baseUrl;
    }
    const client = new OpenAI(clientOptions);
    const response = await client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content?.trim() || '';
  }

  private async chatAnthropic(prompt: string): Promise<string> {
    const clientOptions: any = { apiKey: this.apiKey };
    if (this.baseUrl) {
      clientOptions.baseURL = this.baseUrl;
    }
    const client = new Anthropic(clientOptions);
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    if (block.type === 'text') {
      return block.text.trim();
    }
    return '';
  }

  /** 生成命令 */
  async generate(description: string, shell: ShellType, language: Language): Promise<GenerateResult> {
    const prompt = buildGeneratePrompt(description, shell, language);
    const raw = await this.chat(prompt);
    return parseGenerateResponse(raw);
  }

  /** 解释命令 */
  async explain(command: string, level: DetailLevel, language: Language): Promise<ExplainResult> {
    const prompt = buildExplainPrompt(command, level, language);
    const raw = await this.chat(prompt);
    return parseExplainResponse(raw);
  }

  /** 自由问答 */
  async ask(question: string, language: Language): Promise<string> {
    const prompt = buildAskPrompt(question, language);
    return this.chat(prompt);
  }
}

/** 解析 generate 响应 */
function parseGenerateResponse(raw: string): GenerateResult {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let risk: RiskLevel = 'safe';
  let warning: string | undefined;
  let command = raw;

  if (lines[0] === '[DANGER]') {
    risk = 'danger';
    // 第二行是命令，[WARNING] 行是风险说明
    const commandLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('[WARNING]')) {
        warning = lines[i].replace('[WARNING]', '').trim();
      } else {
        commandLines.push(lines[i]);
      }
    }
    command = commandLines.join('\n');
  } else if (lines[0] === '[CAUTION]') {
    risk = 'warning';
    const commandLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('[WARNING]')) {
        warning = lines[i].replace('[WARNING]', '').trim();
      } else {
        commandLines.push(lines[i]);
      }
    }
    command = commandLines.join('\n');
  } else {
    command = lines.join('\n');
  }

  return { command, risk, warning };
}

/** 解析 explain 响应 */
function parseExplainResponse(raw: string): ExplainResult {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let risk: RiskLevel = 'safe';
  let warning: string | undefined;
  const segments: CommandSegment[] = [];
  let summary = '';

  for (const line of lines) {
    if (line === '[DANGER]' || line.startsWith('[DANGER]')) {
      risk = 'danger';
      warning = line.replace('[DANGER]', '').trim() || undefined;
    } else if (line === '[CAUTION]' || line.startsWith('[CAUTION]')) {
      risk = 'warning';
      warning = line.replace('[CAUTION]', '').trim() || undefined;
    } else if (line.startsWith('[SUMMARY]')) {
      summary = line.replace('[SUMMARY]', '').trim();
    } else if (line.includes('#')) {
      const hashIndex = line.indexOf('#');
      const text = line.slice(0, hashIndex).trim();
      const explanation = line.slice(hashIndex + 1).trim();
      if (text) {
        segments.push({ text, explanation });
      }
    } else if (!summary) {
      // brief 模式下整个回复就是摘要
      summary = line;
    }
  }

  if (!summary && segments.length > 0) {
    summary = segments.map(s => s.text).join(' ');
  }

  return { segments, summary, risk, warning };
}
