import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, GenerateResult, ExplainResult, DetailLevel, ShellType, Language, RiskLevel, CommandSegment, ContextSnapshot } from '../types';
import { buildGeneratePrompt, buildExplainPrompt, buildAskPrompt, buildScaffoldPrompt } from './prompt';

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
      throw new Error('API key not set — run `wts init`, or `wts config set api_key <your-key>`');
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
  async generate(description: string, shell: ShellType, language: Language, ctx?: ContextSnapshot): Promise<GenerateResult> {
    const prompt = buildGeneratePrompt(description, shell, language, ctx);
    const raw = await this.chat(prompt);
    return parseGenerateResponse(raw);
  }

  /** 解释命令 */
  async explain(command: string, level: DetailLevel, language: Language, ctx?: ContextSnapshot): Promise<ExplainResult> {
    const prompt = buildExplainPrompt(command, level, language, ctx);
    const raw = await this.chat(prompt);
    return parseExplainResponse(raw);
  }

  /** 自由问答 */
  async ask(question: string, language: Language, ctx?: ContextSnapshot): Promise<string> {
    const prompt = buildAskPrompt(question, language, ctx);
    const raw = await this.chat(prompt);
    return stripReasoningTags(raw);
  }

  /** Generate a multi-step scaffolding script (file creation, project init). */
  async scaffold(intent: string, shell: ShellType, language: Language, ctx?: ContextSnapshot): Promise<GenerateResult> {
    const prompt = buildScaffoldPrompt(intent, shell, language, ctx);
    const raw = await this.chat(prompt);
    return parseScaffoldResponse(raw);
  }
}

/** 剥掉整段被包进 ```...``` 的 fence，保留内部原文；未匹配到则原样返回 */
function stripMarkdownFence(raw: string): string {
  const s = raw.replace(/\r\n/g, '\n').trim();
  const m = s.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1].trim() : s;
}

/**
 * Strip reasoning-trace blocks emitted by reasoning models inside chat
 * content. DeepSeek R1, Qwen3, and others wrap their chain-of-thought in
 * <think>...</think> (or <thinking>...</thinking>) and put the actual
 * answer after the closing tag. Returns text with all such blocks removed.
 */
export function stripReasoningTags(raw: string): string {
  return raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
}

/** 解析 generate 响应 */
function parseGenerateResponse(raw: string): GenerateResult {
  raw = stripReasoningTags(raw);
  raw = stripMarkdownFence(raw);
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

/**
 * Parse a multi-line scaffold response. Unlike parseGenerateResponse this
 * preserves leading whitespace on every line and keeps internal blank lines —
 * indentation is load-bearing in heredoc payloads (YAML, Python, Markdown
 * inside `cat <<'EOF' ... EOF`) and visually meaningful for control-flow blocks.
 */
function parseScaffoldResponse(raw: string): GenerateResult {
  raw = stripReasoningTags(raw);
  raw = stripMarkdownFence(raw);

  let lines = raw.split('\n');
  let risk: RiskLevel = 'safe';
  let warning: string | undefined;
  let inEnvelope = false;

  // Defensive: some models emit a "draft" script BEFORE the [DANGER]/[CAUTION]
  // envelope tag and then re-emit the body inside the envelope. Search for the
  // tag anywhere; if found, discard everything up to and including the tag so
  // only the post-envelope body remains.
  let envelopeIdx = -1;
  let envelopeRisk: RiskLevel = 'safe';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '[DANGER]') { envelopeIdx = i; envelopeRisk = 'danger'; break; }
    if (t === '[CAUTION]') { envelopeIdx = i; envelopeRisk = 'warning'; break; }
  }
  if (envelopeIdx >= 0) {
    risk = envelopeRisk;
    lines = lines.slice(envelopeIdx + 1);
    inEnvelope = true;
  }

  // Body cleanup:
  //  - Drop stray markdown fence markers (```bash / ``` etc.) anywhere in the
  //    body. stripMarkdownFence above only handles fences that wrap the WHOLE
  //    response; reasoning models sometimes wrap the script INSIDE the
  //    [DANGER]...[WARNING] envelope, which slips past the outer strip.
  //  - Pull out [WARNING] lines ONLY when an envelope was matched. In safe
  //    mode, a literal `echo "[WARNING] ..."` is legitimate script content
  //    and must not be stripped.
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^\s*```[a-zA-Z0-9_-]*\s*$/.test(line)) continue;
    if (inEnvelope && line.trim().startsWith('[WARNING]')) {
      const w = line.trim().replace('[WARNING]', '').trim();
      warning = warning ? warning + '; ' + w : w;
      continue;
    }
    bodyLines.push(line);
  }

  // Trim only leading/trailing blank lines; preserve indentation + internal blanks.
  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

  return { command: bodyLines.join('\n'), risk, warning };
}

/** 解析 explain 响应 */
function parseExplainResponse(raw: string): ExplainResult {
  raw = stripReasoningTags(raw);
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
