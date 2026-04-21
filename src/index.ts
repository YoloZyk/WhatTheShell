#!/usr/bin/env node

import { Command } from 'commander';
import { generateCommand } from './commands/generate';
import { explainCommand } from './commands/explain';
import { askCommand } from './commands/ask';
import { shellInitCommand } from './commands/shellInit';
import { initCommand } from './commands/init';
import { setConfigValue, listConfig, applyPreset, PROVIDER_PRESETS } from './utils/config';
import { getHistory, clearHistory } from './utils/history';

const program = new Command();

program
  .name('wts')
  .description('WhatTheShell — AI-powered shell command generator, explainer, and in-line assistant')
  .version('0.2.0');

// generate
program
  .command('generate <description>')
  .alias('g')
  .description('Generate a shell command from a natural-language description')
  .option('-r, --run', 'Run the command right after generating (safe commands only)')
  .option('-c, --copy', 'Copy the result to the clipboard')
  .option('-s, --shell <shell>', 'Target shell syntax (bash/zsh/powershell/fish)')
  .option('--inline', 'Inline mode: emit the bare command to stdout with no UI (used by shell integration scripts)')
  .option('--buffer <buffer>', 'Current shell command-line buffer (passed in by the shell integration)')
  .option('--history-file <path>', 'External shell history file path (passed in by the shell integration)')
  .action(async (description: string, options) => {
    await generateCommand(description, options);
  });

// explain
program
  .command('explain <command>')
  .alias('e')
  .description('Explain an existing shell command')
  .option('-b, --brief', 'One-sentence summary')
  .option('-d, --detail', 'Full breakdown including side effects and gotchas')
  .action(async (command: string, options) => {
    await explainCommand(command, options);
  });

// ask
program
  .command('ask <question>')
  .alias('a')
  .description('Free-form Q&A about shells, terminals, and command-line tooling')
  .action(async (question: string) => {
    await askCommand(question);
  });

// init (interactive setup wizard)
program
  .command('init')
  .description('Interactive setup wizard (pick provider, test API key, install shell integration)')
  .action(async () => {
    await initCommand();
  });

// shell-init (emit integration script)
program
  .command('shell-init [shell]')
  .description('Emit the shell integration script (supports zsh / bash / fish / powershell). Usage: eval "$(wts shell-init zsh)"')
  .action((shell?: string) => {
    shellInitCommand(shell);
  });

// config
const configCmd = program
  .command('config')
  .description('Manage wts configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a config key (api_key, model, language, shell, provider, base_url, context.enable, context.history_lines)')
  .action((key: string, value: string) => {
    setConfigValue(key, value);
  });

configCmd
  .command('set-provider <name>')
  .description(`Switch to a provider preset (${Object.keys(PROVIDER_PRESETS).join(', ')})`)
  .action((name: string) => {
    applyPreset(name);
  });

configCmd
  .command('list')
  .description('Show the full config and a health-check summary')
  .action(() => {
    listConfig();
  });

// history
program
  .command('history')
  .description('Show recent wts history')
  .option('--clear', 'Wipe the local history log')
  .action(async (options) => {
    if (options.clear) {
      clearHistory();
      const { displaySuccess } = await import('./utils/display');
      await displaySuccess('History cleared');
    } else {
      const entries = getHistory();
      if (entries.length === 0) {
        console.log('  (no history yet)');
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
