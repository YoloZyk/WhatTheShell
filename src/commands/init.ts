import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ShellType } from '../types';
import { PROVIDER_PRESETS, loadConfig, applyPreset, setConfigValue } from '../utils/config';
import { AIClient } from '../core/ai';
import { detectShell } from '../core/shell';
import { renderInitScript, isSupportedShell, SUPPORTED_SHELLS } from '../integrations/shell';

/**
 * 交互式首次配置向导。
 * 走完四步：provider 选择 → API Key（带连通性测试）→ shell 集成安装 → 示例。
 * 每一步都允许用户 Ctrl+C 中途退出；已经写入的配置保留。
 */
export async function initCommand(): Promise<void> {
  const prompts = await loadPrompts();

  console.log();
  console.log('  WhatTheShell 首次配置向导');
  console.log('  按 Ctrl+C 随时退出；已设置的配置会保留');
  console.log();

  try {
    // ---------- Step 1: Provider ----------
    const providerChoices = Object.entries(PROVIDER_PRESETS).map(([k, v]) => ({
      name: `${v.label.padEnd(24)} (${v.model})`,
      value: k,
    }));

    const providerKey = await prompts.select({
      message: '选择 AI 提供商：',
      choices: providerChoices,
    });
    applyPreset(providerKey);

    // ---------- Step 2: API Key + 连通性测试 ----------
    const preset = PROVIDER_PRESETS[providerKey];
    let apiKey = '';
    let keyValidated = false;

    while (!keyValidated) {
      apiKey = (await prompts.password({
        message: `粘贴 ${preset.label} 的 API Key：`,
        mask: '*',
      })).trim();

      if (!apiKey) {
        console.log('  ✗ API Key 不能为空');
        continue;
      }
      setConfigValue('api_key', apiKey);

      process.stdout.write('  测试连接...');
      const test = await testApiKey();
      if (test.ok) {
        console.log(` ✓ (${test.latencyMs}ms)`);
        keyValidated = true;
      } else {
        console.log(' ✗');
        console.log(`    ${test.error}`);
        const retry = await prompts.confirm({
          message: '重新输入 API Key?（选 No 则保留当前 Key 并继续）',
          default: true,
        });
        if (!retry) {
          keyValidated = true;
        }
      }
    }

    // ---------- Step 3: Shell 集成 ----------
    const shell = detectShell();
    if (isSupportedShell(shell)) {
      await maybeInstallShellIntegration(shell, prompts);
    } else {
      console.log();
      console.log(`  检测到 shell "${shell}"，目前不支持 Ctrl+G 集成（支持: ${SUPPORTED_SHELLS.join(', ')}）`);
    }

    // ---------- Step 4: Summary ----------
    console.log();
    console.log('  ✓ 配置完成！试试：');
    console.log();
    console.log('    wts generate "列出当前目录按大小排序"');
    console.log('    wts explain  "awk \'{sum+=$5} END {print sum}\' a.log"');
    console.log('    wts ask      "find 和 fd 的区别"');
    console.log('    Ctrl+G       在命令行任意位置触发');
    console.log();
  } catch (err: any) {
    // Inquirer Ctrl+C 会抛 ExitPromptError
    if (err?.name === 'ExitPromptError' || err?.message?.includes('User force closed')) {
      console.log();
      console.log('  向导已取消');
      return;
    }
    throw err;
  }
}

/**
 * 在需要 API Key 的命令进入前调用；未配置时弹向导，配置了就直接放行。
 * inline 模式（shell 集成脚本调用）不弹交互，直接 stderr + 非 0 退出。
 * 返回 true 表示调用方可以继续；false 表示应中止（用户取消或 inline 模式下未配置）。
 */
export async function ensureApiKey(options: { inline?: boolean }): Promise<boolean> {
  const config = loadConfig();
  if (config.api_key) return true;

  if (options.inline) {
    process.stderr.write('wts: API Key 未设置，运行 `wts init` 配置后再试\n');
    process.exitCode = 2;
    return false;
  }

  const prompts = await loadPrompts();
  try {
    const shouldInit = await prompts.confirm({
      message: '首次使用，需要先配置 API Key。是否现在开始设置?',
      default: true,
    });
    if (!shouldInit) {
      console.log('  未配置 API Key，退出。之后可随时运行 `wts init`');
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
    if (msg.includes('timeout_8s')) return { ok: false, error: '请求超时（>8s），可能网络受限或 base_url 写错' };
    if (/401|unauthorized|invalid.*api.*key|authentication/i.test(msg)) return { ok: false, error: 'API Key 被 provider 拒绝（401），核对一下是不是复制错了' };
    if (/403|forbidden/i.test(msg)) return { ok: false, error: '403 禁止访问（可能区域限制或账户未激活）' };
    if (/429|rate.?limit/i.test(msg)) return { ok: false, error: '触发频率/额度限制，但 Key 本身看起来有效' };
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg)) return { ok: false, error: `网络不通: ${msg.split('\n')[0]}` };
    return { ok: false, error: msg.split('\n')[0].slice(0, 160) };
  }
}

async function maybeInstallShellIntegration(shell: ShellType, prompts: any): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    console.log('  ✗ 无法确定 HOME 目录，跳过 shell 集成');
    return;
  }

  if (isAlreadyInstalled(shell, home)) {
    console.log(`  ✓ ${shell} 集成已装过，跳过`);
    return;
  }

  console.log();
  const install = await prompts.confirm({
    message: `检测到 ${shell}，安装 Ctrl+G 集成?`,
    default: true,
  });
  if (!install) {
    console.log(`  略过；以后可手动：eval "$(wts shell-init ${shell})"`);
    return;
  }

  if (shell === 'zsh' || shell === 'bash') {
    const rc = path.join(home, `.${shell}rc`);
    const line = `eval "$(wts shell-init ${shell})"`;
    try {
      fs.appendFileSync(rc, `\n# WhatTheShell (wts) integration\n${line}\n`);
      console.log(`  ✓ 已写入 ${rc}`);
      console.log(`    新开终端生效，或运行：source ${rc}`);
    } catch (e: any) {
      console.log(`  ✗ 写入 ${rc} 失败: ${e.message}`);
    }
    return;
  }

  if (shell === 'fish') {
    const dir = path.join(home, '.config', 'fish', 'conf.d');
    const target = path.join(dir, 'wts.fish');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, renderInitScript('fish'));
      console.log(`  ✓ 已写入 ${target}`);
      console.log(`    打开新的 fish shell 即可生效`);
    } catch (e: any) {
      console.log(`  ✗ 写入 ${target} 失败: ${e.message}`);
    }
    return;
  }

  if (shell === 'powershell') {
    const profilePath = resolvePowerShellProfile();
    if (!profilePath) {
      console.log('  无法自动定位 $PROFILE，请在 PowerShell 里手动运行：');
      console.log('    wts shell-init powershell | Out-String | Add-Content -Path $PROFILE');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      fs.appendFileSync(profilePath, '\n' + renderInitScript('powershell'));
      console.log(`  ✓ 已写入 ${profilePath}`);
      console.log(`    打开新的 PowerShell 窗口，或运行：. $PROFILE`);
    } catch (e: any) {
      console.log(`  ✗ 写入 ${profilePath} 失败: ${e.message}`);
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
      /* 下一个 candidate */
    }
  }
  return undefined;
}
