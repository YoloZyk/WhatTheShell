# WhatTheShell

> AI-powered shell command generator, explainer, and in-line assistant — lives right inside your terminal.

`wts` lets you describe what you want in plain English (or Chinese), press a shortcut, and get a working shell command filled back into your prompt — without leaving the terminal or opening a browser tab to ask an LLM.

<p>
  <img src="docs/demo-g.gif" width="400" />
  <img src="docs/demo-e.gif" width="400" />
</p>
<p>
  <img src="docs/demo-f.gif" width="400" />
  <img src="docs/demo-ctrlg.gif" width="400" />
</p>

**Current version:** `v0.4.1`. See the [Changelog](#changelog).

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
  - [`wts scaffold`](#wts-scaffold)
  - [`wts history`](#wts-history)
- [Shell integration](#shell-integration)
- [Context awareness](#context-awareness)
- [Providers](#providers)
- [Configuration](#configuration)
- [Safety & privacy](#safety--privacy)
- [History](#history)
- [Changelog](#changelog)
- [Feedback](#feedback)
- [License](#license)

---

## Highlights

- **Press `Ctrl+G` anywhere on the command line** — type what you want, the AI rewrites the current buffer. Nothing is executed until you hit Enter.
- **Five subcommands** for different workflows: `generate`, `explain`, `ask`, `scaffold`, `history`.
- **Context-aware prompts** — `wts` injects your project markers (`package.json`, `Cargo.toml`, `go.mod`, …), current git status, and recent shell history so generated commands match your actual repo.
- **10 built-in provider presets** — OpenAI, Anthropic, Qwen, DeepSeek, Kimi, Zhipu, Baichuan, Yi, MiniMax, SiliconFlow. Any OpenAI-compatible endpoint also works.
- **Local safety rules** block `rm -rf`, `dd of=`, `mkfs`, `> /dev/sd*`, `chmod 777 /`, and similar patterns before they ever reach your shell.
- **Privacy first** — API keys stay on disk in `~/.wts/config.toml`; shell history is scrubbed for tokens, bearer values, and cloud keys *before* being sent to the model.

---

## Installation

Requires Node.js ≥ 18.

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

[WhatTheShell] > keep only the last 7 days

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

Generate a command from scratch. Simple intents produce a single line; complex ones ("set up a blog backend") produce a multi-step script you can run all at once or step by step. Failed steps get a fix-and-retry option. Pass `--script` to force multi-step mode.

```bash
$ wts generate "find all files over 100 MB, sorted by size"

find . -type f -size +100M -exec ls -lhS {} + | sort -k5 -h

  > [R]un  [C]opy  [Q]uit
```

Generated scripts can be saved as runnable `.sh` / `.ps1` / `.fish` files.

| Option | Description |
|--------|-------------|
| `-r`, `--run` | Run the command directly (dangerous patterns still require confirmation). |
| `-c`, `--copy` | Copy to clipboard and exit the menu. |
| `-s`, `--shell <bash\|zsh\|powershell\|fish>` | Target shell syntax. |
| `--script` | Force multi-step mode regardless of classification. |
| `--inline` | Emit the bare command to stdout with no UI — used by the shell integration, available to scripts too. |

Alias: `wts g`.

### `wts explain`

Break down a command — or a whole file. Pass a path and `wts e` reads it and walks through it section by section.

```bash
$ wts explain "awk '{sum += \$5} END {print sum}' access.log"   # one command
$ wts explain ./deploy.sh                                          # shell script
$ wts explain index.js                                              # source code
$ wts explain Dockerfile                                            # config / well-known basename
```

Covers shell scripts, source code, config / markup files, docs, and well-known basenames (Dockerfile / Makefile / Gemfile / etc.).

Beyond explaining, it flags `[BUG]` lines — concrete correctness issues like typos, logic inversions, and **hardcoded oracle values that contradict the code** (e.g. `assert sorted([3,1,2]) == [1,3,2]`). Style nitpicks are suppressed; most files emit zero `[BUG]` lines.

| Option | Description |
|--------|-------------|
| `-b`, `--brief` | One-sentence summary. |
| `-d`, `--detail` | Full breakdown including side effects and gotchas. |
| `--file <path>` | Force file mode (when path detection is ambiguous). |

Alias: `wts e`.

### `wts ask`

Free-form Q&A with file attachments. Reference files inline with `@path` and `wts` ships their content with your question.

```bash
wts ask "when should I use xargs vs. -exec in find?"
wts ask "看 @src/auth.ts 安全吗"
wts ask "@src/old.ts 和 @src/new.ts 的区别"
wts ask "@src/auth/ 这个模块的设计"          # directory shallow-expand
wts ask                                        # no question → interactive picker
```

`.env*` / `.pem` / `.key` files are blocked from attachments.

Run `wts a` with no question for an interactive picker. When cwd isn't a project root, it detects nearby projects (via `.git`, `package.json`, `pyproject.toml`, etc.) and offers to scope into one — or pick "Other folder..." for projects without standard markers. Multi-select with Space; type to filter when there are many files.

Answers render Markdown (bold, code blocks, lists).

Alias: `wts a`.

### `wts scaffold` 🪦 *deprecated*

> **This command is deprecated and will be removed in a future release.**
> Use `wts g --script "<intent>"` instead — same workflow, with cwd tracking, step-by-step execution, fix-on-failure, and PowerShell UTF-8 wrappers (none of which scaffold has).

Existing invocations continue to work; a deprecation banner prints at the top.

```bash
wts f "a PyTorch training script for image classification"
wts scaffold "Dockerfile for this Node.js project"
```

The output is shown for review; you save, copy, or adapt before running anything.

Alias: `wts f`.

### `wts history`

Browse and replay your command history in an interactive picker.

```bash
wts history          # interactive search with type-colored entries
wts history --clear # wipe the log
```

Use arrow keys to navigate, Enter to replay a generate entry.

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
| `preset` | Provider preset name | `openai` |
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
wts history          # interactive search (TTY) or list (pipe)
wts history --clear  # wipe the log
```

Type to filter, arrow keys to navigate, Enter to replay a generate entry.

---

## Changelog

### v0.4.1 — 2026-05-03

Maintenance release. **No code changes** — `wts` behaviour for npm users is identical to v0.4.0.

- **Prebuilt binaries discontinued** — `wts-linux` / `wts-macos` / `wts-win.exe` on the v0.4.0 / v0.4.1 release pages crashed on startup. Several ESM-only dependencies (`chalk@5`, `update-notifier`, `ora`, etc.) don't bundle cleanly under [pkg](https://github.com/yao-pkg/pkg). Rather than keep patching them one by one, we're dropping the binary distribution. Install via `npm install -g whattheshell` (requires Node.js ≥ 18) — see [Installation](#installation).
- **Release pipeline simplified** — Tag pushes now only create a GitHub Release whose body is the matching README changelog section. No binary build, no binary upload.

### v0.4.0 — 2026-05-03

Incremental upgrades to the four core subcommands. **No new commands** — `g` / `e` / `a` got materially smarter, `scaffold` is deprecated in favor of `g --script`.

- **`wts g`** — multi-step script generation with guided execution. Complex intents now produce a step-by-step script instead of a single command.
- **`wts e`** — explain whole files (source code, config, docs, etc.), not just shell commands. Also flags `[BUG]` lines for clear correctness issues.
- **`wts a`** — file-aware Q&A. Reference files with `@path` inline, or run `wts a` alone to pick interactively.
- **`wts scaffold`** 🪦 — deprecated; will be removed in a future release. Use `wts g --script` instead.
- **`Ctrl+G` fix** — no longer gets corrupted by the npm update notifier when an upgrade is pending.

### v0.3.0 — 2026-04-25

Major UI modernization and new features.

- **UI modernization** — Box-drawing borders, arrow-key menus, redesigned command output with DANGER/CAUTION badges
- **Interactive history** — New `wts history` command with live search, type-colored entries, and one-click replay
- **`wts scaffold`** — Generate project scaffolding (Dockerfile, .gitignore, etc.) with deep project context awareness
- **Init wizard simplified** — Press Enter to keep defaults; existing config preserved on re-run
- **Reasoning model support** — Strips `<think>` / `</think>` tags from DeepSeek R1, Qwen3, and similar models
- **Unified Ctrl+G prompt** — Consistent `[WhatTheShell] > ` across all shells

### v0.2.2 — 2026-04-23

- Improved shell detection and command execution compatibility

### v0.2.1 — 2026-04-22

Post-release fixes discovered while running v0.2.0 in mixed environments.

- **Bash `Ctrl+G` survives VSCode remote-SSH → docker TTYs** — two stacked bugs caused the prompt to wipe and auto-run the generated command in `bind -x` handlers nested inside a second readline. Fix drops `-e`, brackets the prompt with `stty sane`/restore, routes all user I/O through `/dev/tty`, and feeds the `wts` subprocess `</dev/null`. zsh / fish / PowerShell widgets are unaffected.
- **Reasoning-model output is now parsed cleanly** — DeepSeek R1, Qwen3, and other reasoning models leak their chain-of-thought as `<think>…</think>` in message content. `wts` now strips those blocks at every parse point (`generate`, `explain`, `ask`, and the inline path) so the actual command/answer comes through intact.

### v0.2.0 — 2026-04-21

Major release with shell integration and context awareness.

- **`Ctrl+G` in-line trigger** — press Ctrl+G anywhere in terminal to describe intent in natural language; generated command fills into the buffer without auto-executing
- **Four-shell support** — install via `wts shell-init {zsh,bash,fish,powershell}`; works across macOS, Linux, and Windows
- **`wts init` first-run wizard** — interactive setup with connectivity test; auto-launches when API key is not configured
- **Context awareness** — AI understands your current project (Node.js, Python, Go, etc.), git state, and recent commands
- **Privacy protection** — sensitive data like API keys and tokens are stripped before sending to AI
- **Windows danger rules** — detects PowerShell and CMD commands that could harm your system
- **`wts config list` health checks** — shows API key status, context state, and integration status
- **CLI now in English** — menus and prompts are English; AI reply language controlled via `config.language`

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

## Feedback

Bugs, sharp edges, or suggestions are all welcome. Open a [GitHub issue](https://github.com/YoloZyk/WhatTheShell/issues), or email <ykzhang@mail.ustc.edu.cn>.

---

## License

[MIT](LICENSE)
