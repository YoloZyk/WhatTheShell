#!/usr/bin/env node

import { Command } from 'commander';
import { generateCommand } from './commands/generate';
import { explainCommand } from './commands/explain';
import { askCommand } from './commands/ask';
import { shellInitCommand } from './commands/shellInit';
import { setConfigValue, listConfig, applyPreset, PROVIDER_PRESETS } from './utils/config';
import { getHistory, clearHistory } from './utils/history';

const program = new Command();

program
  .name('wts')
  .description('WhatTheShell — AI 驱动的终端命令生成与解释工具')
  .version('0.2.0');

// generate 命令
program
  .command('generate <description>')
  .alias('g')
  .description('用自然语言描述生成 Shell 命令')
  .option('-r, --run', '生成后直接执行（仅限安全命令）')
  .option('-c, --copy', '将结果复制到剪贴板')
  .option('-s, --shell <shell>', '指定目标 Shell (bash/zsh/powershell/fish)')
  .option('--inline', '行内模式：stdout 输出纯净命令，不走 UI（供 shell 集成脚本调用）')
  .option('--buffer <buffer>', '当前命令行 buffer（由 shell 集成脚本传入）')
  .option('--history-file <path>', '外部 shell history 文件路径（由 shell 集成脚本传入）')
  .action(async (description: string, options) => {
    await generateCommand(description, options);
  });

// explain 命令
program
  .command('explain <command>')
  .alias('e')
  .description('解释一条 Shell 命令')
  .option('-b, --brief', '一句话简要说明')
  .option('-d, --detail', '详细解释')
  .action(async (command: string, options) => {
    await explainCommand(command, options);
  });

// ask 命令
program
  .command('ask <question>')
  .alias('a')
  .description('关于终端/Shell 的自由问答')
  .action(async (question: string) => {
    await askCommand(question);
  });

// shell-init 命令：打印 shell 集成脚本到 stdout
program
  .command('shell-init [shell]')
  .description('打印 shell 集成脚本（支持 zsh/bash）。用法: eval "$(wts shell-init zsh)"')
  .action((shell?: string) => {
    shellInitCommand(shell);
  });

// config 命令
const configCmd = program
  .command('config')
  .description('管理配置');

configCmd
  .command('set <key> <value>')
  .description('设置配置项 (api_key, model, language, shell, provider, base_url, context.enable, context.history_lines)')
  .action((key: string, value: string) => {
    setConfigValue(key, value);
  });

configCmd
  .command('set-provider <name>')
  .description(`切换 AI 提供商预设 (${Object.keys(PROVIDER_PRESETS).join(', ')})`)
  .action((name: string) => {
    applyPreset(name);
  });

configCmd
  .command('list')
  .description('查看所有配置')
  .action(() => {
    listConfig();
  });

// history 命令
program
  .command('history')
  .description('查看历史记录')
  .option('--clear', '清除所有历史记录')
  .action(async (options) => {
    if (options.clear) {
      clearHistory();
      const { displaySuccess } = await import('./utils/display');
      await displaySuccess('历史记录已清除');
    } else {
      const entries = getHistory();
      if (entries.length === 0) {
        console.log('  暂无历史记录');
      } else {
        const chalk = (await import('chalk')).default;
        console.log();
        for (const entry of entries) {
          const time = chalk.gray(entry.timestamp.replace('T', ' ').slice(0, 19));
          const type = chalk.cyan(entry.type.padEnd(8));
          console.log(`  ${time}  ${type}  ${entry.input}`);
        }
        console.log();
      }
    }
  });

program.parse();
