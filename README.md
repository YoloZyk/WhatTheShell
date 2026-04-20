# WhatTheShell

> AI-powered shell command generator, explainer, and in-line assistant — lives right inside your terminal.

`wts` lets you describe what you want in plain English (or Chinese), press a shortcut, and get a working shell command filled back into your prompt — without leaving the terminal or opening a browser tab to ask an LLM.

**Current version:** `v0.2.0` (in development). See the [Changelog](#changelog).

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
```

Configure a provider (DeepSeek shown; see [Providers](#providers) for the full list):

```bash
wts config set-provider deepseek
wts config set api_key <your-api-key>
```

---

## Quick start

```bash
# 1. generate a command from a description
wts generate "find all files over 100 MB, sorted by size"

# 2. explain something you don't understand
wts explain "awk '{sum += \$5} END {print sum}' access.log"

# 3. ask a free-form question
wts ask "what's the difference between zsh and bash for daily use?"

# 4. install the shell integration to get Ctrl+G inside your prompt
echo 'eval "$(wts shell-init zsh)"' >> ~/.zshrc && source ~/.zshrc
```

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
- Supported shells: **zsh**, **bash**. `fish` and PowerShell are planned for v0.3.

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

One-shot install — no manual rc-file editing needed.

```bash
# zsh
echo 'eval "$(wts shell-init zsh)"' >> ~/.zshrc && source ~/.zshrc

# bash
echo 'eval "$(wts shell-init bash)"' >> ~/.bashrc && source ~/.bashrc
```

What this does:

- Defines a ZLE widget (zsh) or readline binding (bash) on `Ctrl+G`.
- The widget reads your intent, calls `wts generate --inline` with the current buffer and `$HISTFILE`, and replaces the buffer with the returned command.
- On error, the original buffer is restored and stderr is shown above the prompt.

Inspect the script before sourcing it:

```bash
wts shell-init zsh    # or bash — prints the script to stdout
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
| `language` | `zh`, `en` — output language | `zh` |
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

### v0.2.0 (in development)

Goal: turn `wts` from "yet another CLI prompt box" into something genuinely embedded in the shell workflow.

- **`Ctrl+G` in-line trigger** — one-line install via `wts shell-init {zsh,bash}`; replaces the buffer but never auto-executes; dangerous commands are refused and the original buffer is preserved.
- **Context awareness** — `generate` / `explain` / `ask` all inject PWD, project markers, git state, and recent history into the prompt.
- **Privacy sanitizer** — strips tokens, bearer values, OpenAI/Anthropic/AWS keys, URL credentials, and `*_TOKEN=`/`*_KEY=`/`*_SECRET=` env-style assignments before upload.
- **`wts generate --inline`** — clean stdout, no UI, no history write — designed for shell integration scripts.
- **`context.enable` / `context.history_lines` config keys** — tune or disable context at any time.
- **`wts config list`** now shows the current context-collection state.

Deferred to v0.3+: fish / PowerShell integration, a `Ctrl+H` "debug last failing command" hook, TUI rewrite, multi-turn conversations, and local models (Ollama).

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
