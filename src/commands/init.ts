import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ShellType } from '../types';
import { PROVIDER_PRESETS, loadConfig, applyPreset, setConfigValue } from '../utils/config';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';

/**
 * Interactive first-run setup wizard.
 * Four steps: provider select → API key (with live connectivity test) →
 * shell integration install → examples. Ctrl+C at any step exits cleanly;
 * whatever config has already been written is preserved.
 */
export async function initCommand(): Promise<void> {
  const prompts = await loadPrompts();

  console.log();
  console.log('  WhatTheShell setup wizard');
  console.log('  Press Ctrl+C at any time to abort; already-saved settings are kept');
  console.log();

  try {
    // ---------- Step 1: Provider ----------
    const providerChoices = Object.entries(PROVIDER_PRESETS).map(([k, v]) => ({
      name: `${v.label.padEnd(24)} (${v.model})`,
      value: k,
    }));

    const providerKey = await prompts.select({
      message: 'Choose an AI provider:',
      choices: providerChoices,
    });
    applyPreset(providerKey);

    // ---------- Step 2: API key + connectivity test ----------
    const preset = PROVIDER_PRESETS[providerKey];
    let apiKey = '';
    let keyValidated = false;

    while (!keyValidated) {
      apiKey = (await prompts.password({
        message: `Paste your ${preset.label} API key:`,
        mask: '*',
      })).trim();

      if (!apiKey) {
        console.log('  ✗ API key cannot be empty');
        continue;
      }
      setConfigValue('api_key', apiKey);

      process.stdout.write('  Testing connection...');
      const test = await testApiKey();
      if (test.ok) {
        console.log(` ✓ (${test.latencyMs}ms)`);
        keyValidated = true;
      } else {
        console.log(' ✗');
        console.log(`    ${test.error}`);
        const retry = await prompts.confirm({
          message: 'Re-enter the API key? (No keeps the current key and moves on)',
          default: true,
        });
        if (!retry) {
          keyValidated = true;
        }
      }
    }

    // ---------- Step 3: Shell integration ----------
    const shell = detectShell();
    if (isSupportedShell(shell)) {
      await maybeInstallShellIntegration(shell, prompts);
    } else {
      console.log();
      console.log(`  Detected shell "${shell}" — Ctrl+G integration is not supported (supported: ${SUPPORTED_SHELLS.join(', ')})`);
    }

    // ---------- Step 4: Summary ----------
    console.log();
    console.log('  ✓ All set. Try it:');
    console.log();
    console.log('    wts generate "list files in current dir by size"');
    console.log('    wts explain  "awk \'{sum+=$5} END {print sum}\' a.log"');
    console.log('    wts ask      "what\'s the difference between find and fd?"');
    console.log('    Ctrl+G       press anywhere on the command line');
    console.log();
  } catch (err: any) {
    // Inquirer throws ExitPromptError on Ctrl+C
    if (err?.name === 'ExitPromptError' || err?.message?.includes('User force closed')) {
      console.log();
      console.log('  Setup cancelled');
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
    if (msg.includes('timeout_8s')) return { ok: false, error: 'Request timed out (>8s). Network restricted, or base_url is wrong.' };
    if (/401|unauthorized|invalid.*api.*key|authentication/i.test(msg)) return { ok: false, error: 'API key rejected (401). Double-check the paste.' };
    if (/403|forbidden/i.test(msg)) return { ok: false, error: 'Forbidden (403). Possible region restriction or inactive account.' };
    if (/429|rate.?limit/i.test(msg)) return { ok: false, error: 'Rate-limited or quota exceeded — but the key itself looks valid.' };
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg)) return { ok: false, error: `Network unreachable: ${msg.split('\n')[0]}` };
    return { ok: false, error: msg.split('\n')[0].slice(0, 160) };
  }
}

async function maybeInstallShellIntegration(shell: ShellType, prompts: any): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    console.log('  ✗ Could not determine HOME directory; skipping shell integration');
    return;
  }

  if (isAlreadyInstalled(shell, home)) {
    console.log(`  ✓ ${shell} integration already installed, skipping`);
    return;
  }

  console.log();
  const install = await prompts.confirm({
    message: `Detected ${shell}. Install the Ctrl+G integration?`,
    default: true,
  });
  if (!install) {
    console.log(`  Skipped. You can install later with: eval "$(wts shell-init ${shell})"`);
    return;
  }

  if (shell === 'zsh' || shell === 'bash') {
    const rc = path.join(home, `.${shell}rc`);
    const line = `eval "$(wts shell-init ${shell})"`;
    try {
      fs.appendFileSync(rc, `\n# WhatTheShell (wts) integration\n${line}\n`);
      console.log(`  ✓ Wrote to ${rc}`);
      console.log(`    Open a new terminal, or run: source ${rc}`);
    } catch (e: any) {
      console.log(`  ✗ Failed to write ${rc}: ${e.message}`);
    }
    return;
  }

  if (shell === 'fish') {
    const dir = path.join(home, '.config', 'fish', 'conf.d');
    const target = path.join(dir, 'wts.fish');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, renderInitScript('fish'));
      console.log(`  ✓ Wrote to ${target}`);
      console.log(`    Open a new fish shell to activate`);
    } catch (e: any) {
      console.log(`  ✗ Failed to write ${target}: ${e.message}`);
    }
    return;
  }

  if (shell === 'powershell') {
    const profilePath = resolvePowerShellProfile();
    if (!profilePath) {
      console.log('  Could not auto-resolve $PROFILE; inside PowerShell run manually:');
      console.log('    wts shell-init powershell | Out-String | Add-Content -Path $PROFILE');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      fs.appendFileSync(profilePath, '\n' + renderInitScript('powershell'));
      console.log(`  ✓ Wrote to ${profilePath}`);
      console.log(`    Open a new PowerShell window, or run: . $PROFILE`);
    } catch (e: any) {
      console.log(`  ✗ Failed to write ${profilePath}: ${e.message}`);
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
