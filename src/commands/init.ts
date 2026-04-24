import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import type { ShellType } from '../types';
import { PROVIDER_PRESETS, loadConfig, applyPreset, setConfigValue } from '../utils/config';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';

/**
 * Draw a box-drawing header panel.
 */
function drawHeader(title: string, subtitle?: string): void {
  const width = 52;
  const line = '─'.repeat(width - 2);
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold(title)} ${chalk.gray(line)}`);
  if (subtitle) {
    console.log(`${chalk.cyan('│')}  ${chalk.gray(subtitle)}`);
  }
}

/**
 * Draw a step indicator: "Step 2 of 4"
 */
function drawStep(current: number, total: number, label: string): void {
  console.log();
  console.log(`  ${chalk.cyan('[')}${chalk.bold(String(current))}${chalk.cyan('/')}${String(total)}${chalk.cyan(']')} ${chalk.white(label)}`);
}

/**
 * Draw a divider between steps.
 */
function drawDivider(): void {
  console.log(`${chalk.cyan('│')}`);
}

/**
 * Interactive first-run setup wizard.
 * Steps: welcome → provider + model → API key → shell integration → done.
 * Ctrl+C at any step exits cleanly; already-saved config is preserved.
 */
export async function initCommand(): Promise<void> {
  const prompts = await loadPrompts();

  try {
    // ---------- Welcome ----------
    console.log();
    console.log(`${chalk.cyan('┌─')} ${chalk.bold('WhatTheShell')} ${chalk.gray('─'.repeat(42))}`);
    console.log(`${chalk.cyan('│')}  ${chalk.gray('Welcome! Let\'s set up your AI provider.')}`);
    console.log(`${chalk.cyan('│')}  ${chalk.gray('Press Ctrl+C anytime to abort.')}`);
    console.log(`${chalk.cyan('└─')} ${chalk.gray('─'.repeat(50))}`);

    // ---------- Step 1: Provider + Model ----------
    drawStep(1, 3, 'Select provider');

    const providerChoices = Object.entries(PROVIDER_PRESETS).map(([k, v]) => ({
      name: `${v.label.padEnd(18)} ${chalk.gray(v.model)}`,
      value: k,
    }));

    const providerKey = await prompts.select({
      message: 'Choose an AI provider:',
      choices: providerChoices,
    });
    applyPreset(providerKey);
    const preset = PROVIDER_PRESETS[providerKey];

    // Inline model/base_url customization (no extra confirm step)
    drawDivider();
    const customize = await prompts.confirm({
      message: `Customize ${chalk.cyan('model')} or ${chalk.cyan('base_url')}?`,
      default: false,
    });

    let model = preset.model;
    let baseUrl = preset.base_url || '';

    if (customize) {
      drawDivider();
      const newModel = await prompts.input({
        message: `Model ${chalk.gray('(press Enter for default)')}:`,
        default: preset.model,
      });
      model = newModel.trim() || preset.model;

      drawDivider();
      const newBaseUrl = await prompts.input({
        message: `Base URL ${chalk.gray('(press Enter for default)')}:`,
        default: preset.base_url || '',
      });
      baseUrl = newBaseUrl.trim() || preset.base_url || '';

      setConfigValue('model', model);
      if (baseUrl) setConfigValue('base_url', baseUrl);
    }

    // ---------- Step 2: API key ----------
    drawStep(2, 3, 'API key');
    let apiKey = '';
    let keyValidated = false;

    while (!keyValidated) {
      apiKey = (await prompts.password({
        message: `Paste your ${preset.label} API key:`,
        mask: '*',
      })).trim();

      if (!apiKey) {
        console.log();
        console.log(`  ${chalk.red('×')} ${chalk.gray('API key cannot be empty')}`);
        continue;
      }
      setConfigValue('api_key', apiKey);

      process.stdout.write(`  ${chalk.gray('Testing connection...')}`);
      const test = await testApiKey();
      if (test.ok) {
        console.log(` ${chalk.green('✓')} ${chalk.gray(`(${test.latencyMs}ms)`)}`);
        keyValidated = true;
      } else {
        console.log(` ${chalk.red('×')}`);
        console.log(`    ${chalk.red(test.error || 'Connection failed')}`);
        const retry = await prompts.confirm({
          message: 'Re-enter the API key?',
          default: true,
        });
        if (!retry) {
          keyValidated = true;
        }
      }
    }

    // ---------- Step 3: Shell integration ----------
    drawStep(3, 3, 'Shell integration');
    const shell = detectShell();
    if (isSupportedShell(shell)) {
      await maybeInstallShellIntegration(shell, prompts);
    } else {
      console.log();
      console.log(`  ${chalk.yellow('!')} Detected ${chalk.cyan(shell)} — not supported yet`);
      console.log(`    ${chalk.gray('Supported:')} ${SUPPORTED_SHELLS.join(', ')}`);
    }

    // ---------- Done ----------
    console.log();
    console.log(`${chalk.cyan('┌─')} ${chalk.green('All set!')} ${chalk.gray('─'.repeat(46))}`);
    console.log(`${chalk.cyan('│')}`);
    console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} "list files by size"`);
    console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} "git rebase -i"`);
    console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "diff between find and fd"`);
    console.log(`${chalk.cyan('│')}`);
    console.log(`${chalk.cyan('│')}  ${chalk.cyan('eval "$(wts shell-init)"')}  ${chalk.gray('enable Ctrl+G')}`);
    console.log(`${chalk.cyan('│')}`);
    console.log(`${chalk.cyan('└─')} ${chalk.gray('─'.repeat(50))}`);
    console.log();

  } catch (err: any) {
    if (err?.name === 'ExitPromptError' || err?.message?.includes('User force closed')) {
      console.log();
      console.log(`  ${chalk.gray('Setup cancelled')}`);
      return;
    }
    throw err;
  }
}

/**
 * Guard run before any command that needs the API key. When missing and
 * interactive, offer to run the wizard inline; in inline mode (-i) just
 * point the user at `wts init` on stderr and exit non-zero.
 * Returns true if the caller can proceed; false to abort.
 */
export async function ensureApiKey(options: { inline?: boolean }): Promise<boolean> {
  const config = loadConfig();
  if (config.api_key) return true;

  if (options.inline) {
    process.stderr.write('wts: API key not set — run `wts init` first\n');
    process.exitCode = 2;
    return false;
  }

  const prompts = await loadPrompts();
  try {
    const shouldInit = await prompts.confirm({
      message: 'First-time use — set up your API key now?',
      default: true,
    });
    if (!shouldInit) {
      console.log('  No API key configured; exiting. Run `wts init` whenever you\'re ready.');
      return false;
    }
  } catch {
    return false;
  }

  await initCommand();
  return loadConfig().api_key !== '';
}

// ---------------- internals ----------------

async function loadPrompts() {
  return await import('@inquirer/prompts');
}

async function testApiKey(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const cfg = loadConfig();
  const client = new AIClient(cfg.provider, cfg.api_key, cfg.model, cfg.base_url);
  const start = Date.now();
  try {
    await Promise.race([
      client.ask('Respond with exactly one word: ok', 'en'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout_8s')), 8000)),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('timeout_8s')) return { ok: false, error: 'Request timed out (>8s). Check network or base_url.' };
    if (/401|unauthorized|invalid.*api.*key|authentication/i.test(msg)) return { ok: false, error: 'API key rejected (401). Check the paste.' };
    if (/403|forbidden/i.test(msg)) return { ok: false, error: 'Forbidden (403). Possible region restriction.' };
    if (/429|rate.?limit/i.test(msg)) return { ok: false, error: 'Rate-limited — key looks valid.' };
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg)) return { ok: false, error: `Network error: ${msg.split('\n')[0]}` };
    return { ok: false, error: msg.split('\n')[0].slice(0, 160) };
  }
}

async function maybeInstallShellIntegration(shell: ShellType, prompts: any): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    console.log(`  ${chalk.red('×')} Could not determine HOME directory`);
    return;
  }

  if (isAlreadyInstalled(shell, home)) {
    console.log(`  ${chalk.green('✓')} ${shell} integration already installed`);
    return;
  }

  console.log();
  const install = await prompts.confirm({
    message: `Install ${chalk.cyan('Ctrl+G')} integration for ${shell}?`,
    default: true,
  });
  if (!install) {
    console.log(`  ${chalk.gray('Skipped. Run:')} eval "$(wts shell-init ${shell})"`);
    return;
  }

  if (shell === 'zsh' || shell === 'bash') {
    const rc = path.join(home, `.${shell}rc`);
    const line = `eval "$(wts shell-init ${shell})"`;
    try {
      fs.appendFileSync(rc, `\n# WhatTheShell (wts) integration\n${line}\n`);
      console.log(`  ${chalk.green('✓')} Written to ${rc}`);
      console.log(`    ${chalk.gray('Run: source')} ${rc}`);
    } catch (e: any) {
      console.log(`  ${chalk.red('×')} Failed: ${e.message}`);
    }
    return;
  }

  if (shell === 'fish') {
    const dir = path.join(home, '.config', 'fish', 'conf.d');
    const target = path.join(dir, 'wts.fish');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, renderInitScript('fish'));
      console.log(`  ${chalk.green('✓')} Written to ${target}`);
      console.log(`    ${chalk.gray('Restart fish to activate')}`);
    } catch (e: any) {
      console.log(`  ${chalk.red('×')} Failed: ${e.message}`);
    }
    return;
  }

  if (shell === 'powershell') {
    const profilePath = resolvePowerShellProfile();
    if (!profilePath) {
      console.log(`  ${chalk.yellow('!')} Could not auto-detect $PROFILE`);
      console.log(`    ${chalk.gray('Run in PowerShell:')} wts shell-init powershell | Out-String | Add-Content -Path $PROFILE`);
      return;
    }
    try {
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      fs.appendFileSync(profilePath, '\n' + renderInitScript('powershell'));
      console.log(`  ${chalk.green('✓')} Written to ${profilePath}`);
      console.log(`    ${chalk.gray('Run:')} . $PROFILE`);
    } catch (e: any) {
      console.log(`  ${chalk.red('×')} Failed: ${e.message}`);
    }
  }
}

function isAlreadyInstalled(shell: ShellType, home: string): boolean {
  const candidates: Array<{ file: string; marker?: string }> = [];
  if (shell === 'zsh') candidates.push({ file: path.join(home, '.zshrc'), marker: 'wts shell-init' });
  if (shell === 'bash') {
    candidates.push({ file: path.join(home, '.bashrc'), marker: 'wts shell-init' });
    candidates.push({ file: path.join(home, '.bash_profile'), marker: 'wts shell-init' });
  }
  if (shell === 'fish') candidates.push({ file: path.join(home, '.config', 'fish', 'conf.d', 'wts.fish') });
  if (shell === 'powershell') {
    candidates.push({ file: path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' });
    candidates.push({ file: path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' });
    candidates.push({ file: path.join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'), marker: 'wts shell-init' });
  }

  for (const c of candidates) {
    try {
      if (!fs.existsSync(c.file)) continue;
      if (!c.marker) return true;
      const content = fs.readFileSync(c.file, 'utf-8');
      if (content.includes(c.marker)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function resolvePowerShellProfile(): string | undefined {
  for (const cmd of ['powershell', 'pwsh']) {
    try {
      const out = execSync(`${cmd} -NoProfile -Command "Write-Output $PROFILE"`, {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
}
