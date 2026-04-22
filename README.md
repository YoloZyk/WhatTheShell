# WhatTheShell

> AI-powered shell command generator, explainer, and in-line assistant — lives right inside your terminal.

`wts` lets you describe what you want in plain English (or Chinese), press a shortcut, and get a working shell command filled back into your prompt — without leaving the terminal or opening a browser tab to ask an LLM.

**Current version:** `v0.2.1`. See the [Changelog](#changelog).

---

## Table of contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
  - [In-line mode (`Ctrl+G`)](#in-line-mode-ctrlg)
  - [`wts generate`](#wts-generate)
  - [`wts explain`](#wts-explain)
  - [`wts ask`](#wts-ask)
- [Shell integration](#shell-integration)
- [Context awareness](#context-awareness)
- [Providers](#providers)
- [Configuration](#configuration)
- [Safety & privacy](#safety--privacy)
- [History](#history)
- [Changelog](#changelog)
- [License](#license)

---

## Highlights

- **Press `Ctrl+G` anywhere on the command line** — type what you want, the AI rewrites the current buffer. Nothing is executed until you hit Enter.
- **Three standalone subcommands** for when you want an explicit flow: `generate`, `explain`, `ask`.
- **Context-aware prompts** — `wts` injects your project markers (`package.json`, `Cargo.toml`, `go.mod`, …), current git status, and recent shell history so generated commands match your actual repo.
- **10 built-in provider presets** — OpenAI, Anthropic, Qwen, DeepSeek, Kimi, Zhipu, Baichuan, Yi, MiniMax, SiliconFlow. Any OpenAI-compatible endpoint also works.
- **Local safety rules** block `rm -rf`, `dd of=`, `mkfs`, `> /dev/sd*`, `chmod 777 /`, and similar patterns before they ever reach your shell.
- **Privacy first** — API keys stay on disk in `~/.wts/config.toml`; shell history is scrubbed for tokens, bearer values, and cloud keys *before* being sent to the model.

---

## Installation

Requires **Node.js ≥ 18**.

```bash
npm install -g whattheshell
wts init
```

`wts init` is a one-minute wizard that walks you through provider choice, API-key setup (with a live connectivity test), and optional shell integration. If you skip it, the wizard auto-launches the first time you run `generate` / `explain` / `ask` without a configured key.

Prefer manual configuration? See [Providers](#providers) and [Configuration](#configuration).

---

## Quick start

After `wts init` — or once an API key is configured and the shell integration is installed:

```bash
# generate a command from a description
wts generate "find all files over 100 MB, sorted by size"

# explain something you don't understand
wts explain "awk '{sum += \$5} END {print sum}' access.log"

# ask a free-form question
wts ask "what's the difference between zsh and bash for daily use?"
```

Or press **`Ctrl+G`** anywhere on the command line to rewrite the current buffer with AI.

---

## Usage

### In-line mode (`Ctrl+G`)

The primary workflow in v0.2. Type a partial command, press `Ctrl+G`, describe what you want, and the AI fills the buffer for you. Nothing runs until you press Enter.

```
$ find . -name "*.log" | █          ← cursor here, press Ctrl+G

wts > keep only the last 7 days

wts: thinking...
↓
$ find . -name "*.log" -mtime -7█   ← command replaces the buffer, NOT executed
                                    ← press Enter to run, Esc/Ctrl+C to cancel beforehand
```

Behavior:

- **Fill, don't execute.** You can still edit the command before running it.
- **Dangerous commands are refused inline.** If the model returns `rm -rf /` or similar, the buffer is left untouched and a warning is printed above the prompt.
- **Failures restore your input.** If the API call fails, the original buffer is put back verbatim.
- Supported shells: **zsh**, **bash**, **fish**, **PowerShell**.

See [Shell integration](#shell-integration) for installation details.

### `wts generate`

Generate a command from scratch.

```bash
$ wts generate "find all files over 100 MB, sorted by size"

find . -type f -size +100M -exec ls -lhS {} + | sort -k5 -h

  > [R]un  [C]opy  [E]dit  [Q]uit
```

| Option | Description |
|--------|-------------|
| `-r`, `--run` | Run the command directly (dangerous patterns still require confirmation). |
| `-c`, `--copy` | Copy to clipboard and exit the menu. |
| `-s`, `--shell <bash\|zsh\|powershell\|fish>` | Target shell syntax. |
| `--inline` | Emit the bare command to stdout with no UI — used by the shell integration, available to scripts too. |

Alias: `wts g`.

### `wts explain`

Break down a command you don't understand.

```bash
$ wts explain "awk '{sum += \$5} END {print sum}' access.log"

  awk                 # text-processing tool
  '{sum += $5}'       # add column 5 of each line to `sum`
  END {print sum}     # print sum after all lines processed
  access.log          # input file

  Summary: totals column 5 of access.log (typically response size) across all rows.
```

| Option | Description |
|--------|-------------|
| `-b`, `--brief` | One-sentence summary. |
| `-d`, `--detail` | Full breakdown including side effects and gotchas. |

Alias: `wts e`.

### `wts ask`

A free-form Q&A channel for conceptual or comparison questions where you don't need a specific command.

```bash
wts ask "when should I use xargs vs. -exec in find?"
```

Alias: `wts a`.

---

## Shell integration

The fastest path is `wts init` — it detects your current shell and offers to install the integration for you. If you prefer to do it yourself:

```bash
# zsh
echo 'eval "$(wts shell-init zsh)"' >> ~/.zshrc && source ~/.zshrc

# bash
echo 'eval "$(wts shell-init bash)"' >> ~/.bashrc && source ~/.bashrc

# fish
wts shell-init fish > ~/.config/fish/conf.d/wts.fish && exec fish

# PowerShell
wts shell-init powershell | Out-String | Add-Content -Path $PROFILE
# then reopen PowerShell, or run: . $PROFILE
```

What this does:

- Binds `Ctrl+G` as a ZLE widget (zsh), readline binding (bash), `commandline` function (fish), or `PSReadLine` key handler (PowerShell).
- The handler reads your intent, calls `wts generate --inline` with the current buffer, active shell, and `$HISTFILE`, and replaces the buffer with the returned command.
- On error, the original buffer is restored and stderr is shown above the prompt.

Inspect the script before sourcing it:

```bash
wts shell-init zsh    # or bash / fish / powershell — prints the script to stdout
```

---

## Context awareness

Before every AI call, `wts` collects a lightweight snapshot of the current directory and injects it into the prompt, so suggestions match your actual project rather than a generic example.

| Source | What's captured |
|--------|-----------------|
| **Working directory** | `PWD` |
| **Project markers** | `package.json` (+ npm scripts), `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`, `docker-compose.{yml,yaml}`, `Dockerfile`, `Makefile` (+ targets) |
| **Git** | Current branch, dirty flag, upstream, last 3 commit subjects |
| **Shell history** | Last *N* lines (default `5`), after sanitization |

**History sanitization** strips these patterns before anything is sent to the model:

- `--token=…`, `--api-key=…`, `--password=…`, and similar flag-value pairs
- `Authorization: Bearer …`, raw `Bearer …`
- OpenAI (`sk-…`) and Anthropic (`sk-ant-…`) keys
- AWS access key IDs (`AKIA…`)
- URL credentials (`https://user:pass@host`)
- Env-style assignments ending in `_TOKEN=`, `_KEY=`, `_SECRET=`, `_PASSWORD=`

Tuning:

```bash
wts config set context.enable false      # disable context injection entirely
wts config set context.history_lines 0    # keep project/git, drop history
wts config set context.history_lines 10   # inject more history
wts config list                           # view current state
```

---

## Providers

Switch providers with one command — `base_url` and default model are preconfigured for each preset.

| Preset | Service | Default model |
|--------|---------|---------------|
| `openai` | OpenAI | `gpt-4o` |
| `anthropic` | Anthropic Claude | `claude-sonnet-4-20250514` |
| `qwen` | Alibaba Tongyi Qianwen | `qwen-plus` |
| `deepseek` | DeepSeek | `deepseek-chat` |
| `kimi` | Moonshot KIMI | `moonshot-v1-8k` |
| `zhipu` | Zhipu GLM | `glm-4-flash` |
| `baichuan` | Baichuan | `Baichuan4` |
| `yi` | 01.AI Yi | `yi-large` |
| `minimax` | MiniMax | `MiniMax-Text-01` |
| `siliconflow` | SiliconFlow (aggregator) | `deepseek-ai/DeepSeek-V3` |

```bash
wts config set-provider qwen
wts config set api_key <your-qwen-key>
```

Any OpenAI-compatible endpoint works too:

```bash
wts config set provider openai
wts config set base_url https://your-api.example.com/v1
wts config set model your-model
wts config set api_key your-key
```

---

## Configuration

Config lives at `~/.wts/config.toml`.

| Key | Values | Default |
|-----|--------|---------|
| `api_key` | Your API key | *(empty)* |
| `provider` | `openai`, `anthropic` | `openai` |
| `base_url` | Custom API endpoint | *(provider default)* |
| `model` | Model name | `gpt-4o` |
| `language` | `zh`, `en` — AI reply language | `en` |
| `shell` | `bash`, `zsh`, `powershell`, `fish` | `bash` |
| `history_limit` | Local history entries to keep | `100` |
| `context.enable` | Collect context before each call | `true` |
| `context.history_lines` | Shell-history lines to inject (`0` disables) | `5` |

```bash
wts config list                # view everything (api_key is masked)
wts config set <key> <value>   # update a single key
```

---

## Safety & privacy

- **Dangerous-command rules** run locally on both user input and AI output:
  - **`DANGER`** — `rm -rf`, `dd of=`, `mkfs`, `> /dev/sd*`, `chmod 777 /` → `--run` is refused, confirmation is forced; the inline `Ctrl+G` flow refuses to fill the buffer.
  - **`CAUTION`** — `sudo`, `kill -9`, `curl … | bash`, `shutdown` → prints a warning but allows the action.
- **API keys stay local** — written only to `~/.wts/config.toml`; `config list` shows them masked.
- **Context sanitization** — shell history is scrubbed (see [Context awareness](#context-awareness)) before being sent to the model.
- **One-line kill switch** — `wts config set context.enable false` disables all context collection.

---

## History

`wts` keeps a local log of your calls at `~/.wts/history.json`.

```bash
wts history          # show recent entries
wts history --clear  # wipe the log
```

---

## Changelog

### v0.2.1 — 2026-04-22

Post-release fixes discovered while running v0.2.0 in mixed environments.

- **Bash `Ctrl+G` survives VSCode remote-SSH → docker TTYs** — two stacked bugs caused the prompt to wipe and auto-run the generated command in `bind -x` handlers nested inside a second readline. Fix drops `-e`, brackets the prompt with `stty sane`/restore, routes all user I/O through `/dev/tty`, and feeds the `wts` subprocess `</dev/null`. zsh / fish / PowerShell widgets are unaffected.
- **Reasoning-model output is now parsed cleanly** — DeepSeek R1, Qwen3, and other reasoning models leak their chain-of-thought as `<think>…</think>` in message content. `wts` now strips those blocks at every parse point (`generate`, `explain`, `ask`, and the inline path) so the actual command/answer comes through intact.

### v0.2.0 — 2026-04-21

Turns `wts` from "yet another CLI prompt box" into something genuinely embedded in the shell workflow.

- **`Ctrl+G` in-line trigger across four shells** — one-line install via `wts shell-init {zsh,bash,fish,powershell}`; rewrites the current buffer with an AI-generated command but never auto-executes; dangerous commands are refused and the original buffer is preserved.
- **`wts init` first-run wizard** — interactive provider + API-key + shell-integration setup with a live connectivity test; auto-launches when `generate` / `explain` / `ask` is invoked without a configured key.
- **Context awareness** — every AI call injects PWD, project markers (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Dockerfile`, …), current git state, and recent shell history into the prompt.
- **Privacy sanitizer** — strips tokens, bearer values, OpenAI / Anthropic / AWS keys, URL credentials, and `*_TOKEN=` / `*_KEY=` / `*_SECRET=` env-style assignments before anything reaches the model.
- **Windows-aware danger rules** — 13 new patterns including `Remove-Item -Recurse -Force`, `Format-Volume`, `Clear-Disk`, `diskpart`, `del /s /q`, `Stop-Computer`, `Set-ExecutionPolicy Unrestricted`, and `iwr | iex`.
- **English CLI** — menus, prompts, errors, and help text are now English by default; `config.language` controls only the AI's reply language.
- **Per-shell prompt style hints** — generated commands follow the syntax of the active shell (PowerShell cmdlets, bash pipes, fish syntax, zsh globs).
- **TTY-aware `shell-init`** — emits the script when piped into `eval`, prints a human-readable install hint when run interactively.
- **`wts generate --inline`** — clean stdout, no UI, no history write — designed for shell-integration scripts and other automation.
- **`wts config list` health checks** — flags missing API key, unreachable base URL, and current context-collection state.
- **`context.enable` / `context.history_lines` config keys** — tune or disable context injection at any time.

### v0.1.1

- Five additional provider presets: `minimax`, `zhipu`, `baichuan`, `yi`, `siliconflow`.

### v0.1.0

First usable release.

- Three core subcommands: `generate` / `explain` / `ask` (aliased `g` / `e` / `a`).
- Five initial provider presets: `openai`, `anthropic`, `qwen`, `deepseek`, `kimi`.
- Dual-protocol AI layer (OpenAI + Anthropic); any OpenAI-compatible endpoint works.
- Local dangerous-command ruleset with `DANGER` / `CAUTION` tiers.
- `generate` interactive menu (`[R]un [C]opy [E]dit [Q]uit`) and `--run` / `--copy` / `--shell` flags.
- `explain` with `--brief` and `--detail` modes.
- Local history at `~/.wts/history.json` and a `wts history` command.
- TOML config at `~/.wts/config.toml`; `config list` masks the API key.

---

## License

[MIT](LICENSE)
