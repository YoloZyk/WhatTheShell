#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { generateCommand } from './commands/generate';
import { explainCommand } from './commands/explain';
import { askCommand } from './commands/ask';
import { shellInitCommand } from './commands/shellInit';
import { initCommand } from './commands/init';
import { setConfigValue, listConfig, applyPreset, PROVIDER_PRESETS } from './utils/config';
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
  console.log(`${chalk.cyan('│')}  ${chalk.green('[e]xplain')}   "git rebase -i"      Explain a command or script`);
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
    { name: 'explain|e', desc: 'Explain a shell command or script file' },
    { name: 'ask|a', desc: 'Free-form Q&A about shells and terminals' },
    { name: 'scaffold', desc: 'Draft a setup script for project files (review and adapt before running)' },
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

function renderGenerateHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Generate')} ${chalk.gray('─'.repeat(50))}`);
  console.log(`${chalk.cyan('│')}  Generate a shell command from natural language`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts generate')} ${chalk.cyan('<description>')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} ${chalk.cyan('<description>')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  const opts = [
    { flag: '-r, --run', desc: 'Run safe commands right after generating' },
    { flag: '-c, --copy', desc: 'Copy the result to the clipboard' },
    { flag: '-s, --shell <shell>', desc: 'Target syntax (bash/zsh/powershell/fish)' },
    { flag: '--inline', desc: 'Emit bare command to stdout (for integrations)' },
    { flag: '--buffer <buffer>', desc: 'Current shell buffer (inline mode)' },
    { flag: '--history-file <path>', desc: 'External history file path' },
    { flag: '--script', desc: 'Force multi-step script mode' },
    { flag: '-h, --help', desc: 'Display this help' },
  ];
  for (const o of opts) {
    console.log(`${chalk.cyan('│')}  ${chalk.green(o.flag.padEnd(22))} ${chalk.gray(o.desc)}`);
  }
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} "list the 10 largest files here"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} "kill stale node processes" ${chalk.cyan('-r')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts g')} "deploy" ${chalk.cyan('--shell powershell')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
  console.log();
}

function renderExplainHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Explain')} ${chalk.gray('─'.repeat(51))}`);
  console.log(`${chalk.cyan('│')}  Explain an existing shell command or script file`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts explain')} ${chalk.cyan('<command|path>')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} ${chalk.cyan('<command|path>')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  const opts = [
    { flag: '-b, --brief', desc: 'One-sentence summary' },
    { flag: '-d, --detail', desc: 'Full breakdown including side effects' },
    { flag: '-f, --file <path>', desc: 'Force the argument to be read as a script file' },
    { flag: '-h, --help', desc: 'Display this help' },
  ];
  for (const o of opts) {
    console.log(`${chalk.cyan('│')}  ${chalk.green(o.flag.padEnd(20))} ${chalk.gray(o.desc)}`);
  }
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('File detection')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Argument is auto-treated as a script file when it')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('contains a path separator OR ends in .sh/.bash/.zsh/')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('.fish/.ps1/.psm1, AND the file exists, is ≤ 100 KB,')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('and is not binary. Use --file to force.')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} "git rebase -i HEAD~3"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} "find . -size +10M" ${chalk.cyan('-b')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} ./deploy.sh                 ${chalk.gray('# auto file mode')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts e')} ${chalk.cyan('--file')} scripts/build.ps1   ${chalk.gray('# force file mode')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
  console.log();
}

function renderAskHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Ask')} ${chalk.gray('─'.repeat(55))}`);
  console.log(`${chalk.cyan('│')}  Free-form Q&A about shells, terminals, and project files`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts ask')} ${chalk.cyan('[question]')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} ${chalk.cyan('[question]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help'.padEnd(14))} ${chalk.gray('Display this help')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('File attachments')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Mention files inline with')} ${chalk.cyan('@path')}${chalk.gray(' — they get read and sent')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('with the question. Directories expand to their direct files.')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Limits: 100 KB / file, 200 KB total, 20 files. Failed lookups')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('stay as plain text — no error.')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Interactive mode')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Run')} ${chalk.green('wts a')} ${chalk.gray('with no question to pick files from a list')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('and then enter your question (handy when you don\'t know paths).')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "diff between find and fd"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "@src/auth.ts has any obvious bugs?"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "compare @src/old.ts and @src/new.ts"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')} "what does @src/utils/ do?"      ${chalk.gray('# directory expand')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts a')}                              ${chalk.gray('# interactive picker')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
  console.log();
}

function renderScaffoldHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Scaffold')} ${chalk.gray('─'.repeat(50))}`);
  console.log(`${chalk.cyan('│')}  Draft a setup script for project files — review and adapt before running`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts scaffold')} ${chalk.cyan('<intent>')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-s, --shell <shell>'.padEnd(22))} ${chalk.gray('Target syntax (bash/zsh/powershell/fish)')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help'.padEnd(22))} ${chalk.gray('Display this help')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('When to use')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• File scaffolding ("write a Dockerfile for this project")')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• Project init flows ("set up Node TS project with strict tsconfig")')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• Anything that benefits from inspecting the script before running')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Interactive menu')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Save as a file / Copy to clipboard / Cancel')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('Output is meant to be saved and adapted, not run blindly')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts scaffold')} "set up a Node TS project with strict tsconfig"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts scaffold')} "write a Dockerfile for this project"`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts scaffold')} "init a git repo with main + dev branches"`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
  console.log();
}

function renderInitHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Init')} ${chalk.gray('─'.repeat(54))}`);
  console.log(`${chalk.cyan('│')}  Interactive first-run setup wizard`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts init')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help'.padEnd(14))} ${chalk.gray('Display this help')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('What it does')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('1. Choose AI provider preset (10 supported)')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('2. Optionally customize model and base_url')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('3. Enter API key with connectivity test')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('4. Optionally install Ctrl+G shell integration')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
  console.log();
}

function renderShellInitHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('Shell-init')} ${chalk.gray('─'.repeat(48))}`);
  console.log(`${chalk.cyan('│')}  Emit shell integration script for Ctrl+G inline assistant`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts shell-init')} ${chalk.gray('[shell]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Arguments')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('shell'.padEnd(14))} ${chalk.gray('zsh / bash / fish / powershell (default: auto-detect)')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help'.padEnd(14))} ${chalk.gray('Display this help')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('eval "$(wts shell-init)"')}             ${chalk.gray('# zsh / bash auto-detect')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('eval "$(wts shell-init bash)"')}        ${chalk.gray('# force bash')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts shell-init powershell')} ${chalk.gray('| Out-String | Add-Content $PROFILE')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Or run ${chalk.cyan('wts init')} for the guided installer`)}`);
  console.log();
}

function renderHistoryHelp(): void {
  console.log();
  console.log(`${chalk.cyan('┌─')} ${chalk.bold('History')} ${chalk.gray('─'.repeat(51))}`);
  console.log(`${chalk.cyan('│')}  Browse and replay past wts invocations`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Usage')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts history')} ${chalk.gray('[options]')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Options')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('--clear'.padEnd(14))} ${chalk.gray('Wipe the local history log')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('-h, --help'.padEnd(14))} ${chalk.gray('Display this help')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Interactive picker')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• Type to filter across input + output')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• ↑↓ to navigate · Enter to select · Esc to cancel')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.gray('• When piped, falls back to a static list')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('├─')} ${chalk.bold('Examples')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts history')}              ${chalk.gray('# interactive picker')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts history --clear')}      ${chalk.gray('# delete all entries')}`);
  console.log(`${chalk.cyan('│')}  ${chalk.green('wts history')} ${chalk.gray('| grep generate')}    ${chalk.gray('# pipe-friendly listing')}`);
  console.log(`${chalk.cyan('│')}`);

  console.log(`${chalk.cyan('└─')} ${chalk.gray(`Run ${chalk.cyan('wts --help')} for the full command list`)}`);
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
const subcommands = ['generate', 'g', 'explain', 'e', 'ask', 'a', 'scaffold', 'init', 'shell-init', 'config', 'history'];
const hasHelpFlag = rawArgs.includes('--help') || rawArgs.includes('-h');
const matchedSubcmd = rawArgs.find(arg => !arg.startsWith('-') && subcommands.includes(arg));

if (hasHelpFlag) {
  if (matchedSubcmd === 'generate' || matchedSubcmd === 'g') {
    renderGenerateHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'explain' || matchedSubcmd === 'e') {
    renderExplainHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'ask' || matchedSubcmd === 'a') {
    renderAskHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'scaffold') {
    renderScaffoldHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'init') {
    renderInitHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'shell-init') {
    renderShellInitHelp();
    process.exit(0);
  } else if (matchedSubcmd === 'history') {
    renderHistoryHelp();
    process.exit(0);
  } else if (!matchedSubcmd) {
    // wts --help — suppress Commander's help; renderHelp() runs in the parse catch below
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.exitOverride();
  }
  // config --help is handled by its own option callback (renderConfigHelp)
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
  .option('--script', 'Force multi-step script mode')
  .action(async (description: string, options) => {
    await generateCommand(description, options);
  });

// explain
program
  .command('explain <command>')
  .alias('e')
  .description('Explain an existing shell command or script file')
  .option('-b, --brief', 'One-sentence summary')
  .option('-d, --detail', 'Full breakdown including side effects')
  .option('-f, --file <path>', 'Force the argument to be read as a script file (errors if path missing)')
  .action(async (command: string, options) => {
    await explainCommand(command, options);
  });

// ask
program
  .command('ask [question]')
  .alias('a')
  .description('Free-form Q&A with optional @path file attachments')
  .action(async (question?: string) => {
    await askCommand(question);
  });

// scaffold
program
  .command('scaffold <intent>')
  .alias('f')
  .description('Generate a project file or code structure (review and adapt before running)')
  .option('-s, --shell <shell>', 'Target shell syntax (bash/zsh/powershell/fish)')
  .action(async (intent: string, options) => {
    const { scaffoldCommand } = await import('./commands/scaffold');
    await scaffoldCommand(intent, options);
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
    const { historyCommand } = await import('./commands/history');
    await historyCommand(options);
  });

// Parse arguments
try {
  program.parse(process.argv);
} catch (err: any) {
  if (err?.code === 'commander.helpDisplayed' || hasHelpFlag) {
    if (!matchedSubcmd) {
      renderHelp();
    }
    process.exit(0);
  }
  throw err;
}
