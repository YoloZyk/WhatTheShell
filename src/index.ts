#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { generateCommand } from './commands/generate';
import { explainCommand } from './commands/explain';
import { askCommand } from './commands/ask';
import { shellInitCommand } from './commands/shellInit';
import { initCommand } from './commands/init';
import { setConfigValue, listConfig, applyPreset, PROVIDER_PRESETS } from './utils/config';
import { getHistory, clearHistory } from './utils/history';
import { notifyUpdate } from './utils/version';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

// Check for npm updates (non-blocking, runs in background)
notifyUpdate();

function showWelcome(): void {
  const width = 56;
  const line = '─'.repeat(width - 2);

  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('WhatTheShell')} ${chalk.gray(line)}`);
  console.log(`${chalk.cyan('│')}  AI-powered shell command assistant`);
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Commands')}`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('[g]enerate')}  "deploy to prod"     Generate a shell command`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('[e]xplain')}   "git rebase -i"      Explain a command`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('[a]sk')}       "how does tee work"  Free-form Q&A`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Shell Integration')}`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.cyan('eval')} "$(wts shell-init)"      Enable ${chalk.cyan('Ctrl+G')} inline assistant`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Getting Started')}`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts init')}                       Configure API key & provider`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts config list')}               View current settings`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray(`v${pkg.version} · Run ${chalk.cyan('wts <command> --help')} for more options`)}`);
  console.log();
}

function renderHelp(): void {
  const width = 60;
  const line = '─'.repeat(width - 2);

  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('WhatTheShell')} ${chalk.gray(line)}`);
  console.log(`${chalk.cyan('│')}  AI-powered shell command assistant`);
  console.log(`${chalk.cyan('│')}`);

  // Global options
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-V, --version')}      ${chalk.gray('output the version number')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help')}         ${chalk.gray('display help for command')}`);
  console.log(`${chalk.cyan('│')}`);

  // Commands
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Commands')}`);
  const commands = [
    { name: 'generate|g', desc: 'Generate a shell command from natural language' },
    { name: 'explain|e', desc: 'Explain an existing shell command' },
    { name: 'ask|a', desc: 'Free-form Q&A about shells and terminals' },
    { name: 'init', desc: 'Interactive setup wizard' },
    { name: 'shell-init', desc: 'Emit shell integration script' },
    { name: 'config', desc: 'Manage configuration' },
    { name: 'history', desc: 'Show recent wts history' },
  ];
  for (const cmd of commands) {
    console.log(`${chalk.cyan('│')}  ${chalk.green(cmd.name.padEnd(14))} ${chalk.gray(cmd.desc)}`);
  }
  console.log(`${chalk.cyan('│')}`);

  // Examples
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} "list files by size"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} "git rebase -i HEAD~3"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "diff between find and fd"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('eval "$(wts shell-init)"')}  ${chalk.gray('enable Ctrl+G')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`v${pkg.version} · Run ${chalk.cyan('wts <command> --help')} for command details`)}`);
  console.log();
}

function renderConfigHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Config')} ${chalk.gray('─'.repeat(52))}`);
  console.log(`${chalk.cyan('│')}  Manage WhatTheShell configuration`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Commands')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('list')}            ${chalk.gray('View current settings and health')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('set <key> <val>')} ${chalk.gray('Update a config value')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('set-provider')}   ${chalk.gray('Switch to a provider preset')}`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('├─')} ${chalk.bold('Keys')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('api_key, model, base_url, language, shell,')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('context.enable, context.history_lines')}`);
  console.log(`${chalk.cyan('│')}`);
  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts config list')} to view settings`)}`);
  console.log();
}

const program = new Command();

program
  .name('wts')
  .description('WhatTheShell — AI-powered shell command generator, explainer, and in-line assistant')
  .version(pkg.version)
  .action(() => {
    // No command given — show welcome
    showWelcome();
  });

// Intercept help before Commander processes it
const rawArgs = process.argv.slice(2);
const subcommands = ['generate', 'g', 'explain', 'e', 'ask', 'a', 'init', 'shell-init', 'config', 'history'];
const hasHelpFlag = rawArgs.includes('--help') || rawArgs.includes('-h');
const hasSubcommand = rawArgs.some(arg => !arg.startsWith('-') && subcommands.includes(arg));

if (hasHelpFlag && !hasSubcommand) {
  // Suppress Commander's help and show our custom help
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.exitOverride();
}

// generate
program
  .command('generate <description>')
  .alias('g')
  .description('Generate a shell command from natural language')
  .option('-r, --run', 'Run the command right after generating (safe commands only)')
  .option('-c, --copy', 'Copy the result to the clipboard')
  .option('-s, --shell <shell>', 'Target shell syntax (bash/zsh/powershell/fish)')
  .option('--inline', 'Inline mode: emit bare command to stdout (for shell integrations)')
  .option('--buffer <buffer>', 'Current shell command-line buffer')
  .option('--history-file <path>', 'External shell history file path')
  .action(async (description: string, options) => {
    await generateCommand(description, options);
  });

// explain
program
  .command('explain <command>')
  .alias('e')
  .description('Explain an existing shell command')
  .option('-b, --brief', 'One-sentence summary')
  .option('-d, --detail', 'Full breakdown including side effects')
  .action(async (command: string, options) => {
    await explainCommand(command, options);
  });

// ask
program
  .command('ask <question>')
  .alias('a')
  .description('Free-form Q&A about shells, terminals, and CLI tooling')
  .action(async (question: string) => {
    await askCommand(question);
  });

// init
program
  .command('init')
  .description('Interactive setup wizard (provider, API key, shell integration)')
  .action(async () => {
    await initCommand();
  });

// shell-init
program
  .command('shell-init [shell]')
  .description('Emit shell integration script (zsh/bash/fish/powershell)')
  .action((shell?: string) => {
    shellInitCommand(shell);
  });

// config
const configCmd = program
  .command('config')
  .description('Manage wts configuration');

configCmd.option('-h, --help', 'Display help', () => {
  renderConfigHelp();
  process.exit(0);
});
configCmd.exitOverride();
configCmd.configureOutput({ writeOut: () => {}, writeErr: () => {} });

configCmd
  .command('set <key> <value>')
  .description('Set a config key')
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
  .description('View current settings and health')
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
        console.log();
        console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(48))}`);
        console.log(`${chalk.cyan('│')}  ${chalk.gray('(no history yet)')}`);
        console.log(`${chalk.cyan('└─')} ${chalk.gray('Commands you run will appear here')}`);
        console.log();
      } else {
        console.log();
        console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(48))}`);
        for (const entry of entries) {
          const typeColors: Record<string, (s: string) => string> = {
            generate: chalk.green,
            explain: chalk.cyan,
            ask: chalk.magenta,
          };
          const typeColorFn = typeColors[entry.type] || chalk.white;
          console.log(`${chalk.cyan('│')}  ${typeColorFn(entry.type.padEnd(8))} ${chalk.gray(entry.input.slice(0, 40))}`);
        }
        const clearCmd = chalk.cyan('wts history --clear');
        console.log(`${chalk.cyan('└─')} ${chalk.gray(`${entries.length} entries · run ${clearCmd} to wipe`)}`);
        console.log();
      }
    }
  });

// Parse arguments
try {
  program.parse(process.argv);
} catch (err: any) {
  if (err?.code === 'commander.helpDisplayed' || hasHelpFlag) {
    if (!hasSubcommand) {
      renderHelp();
    }
    process.exit(0);
  }
  throw err;
}
