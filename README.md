# WhatTheShell (wts)

AI-powered shell command generator and explainer.

> Describe what you want in natural language, get the shell command instantly.

## Install

```bash
npm install -g whattheshell
```

Requires Node.js >= 18.

## Quick Start

```bash
# 1. Set up your AI provider (supports OpenAI, Anthropic, DeepSeek, Qwen, KIMI)
wts config set-provider deepseek
wts config set api_key <your-api-key>

# 2. Generate a command
wts generate "find all files larger than 100MB and sort by size"

# 3. Explain a command
wts explain "awk '{sum += \$5} END {print sum}' access.log"

# 4. Ask a question
wts ask "what is the difference between bash and zsh"
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `wts generate <description>` | `wts g` | Generate a shell command from natural language |
| `wts explain <command>` | `wts e` | Explain a shell command segment by segment |
| `wts ask <question>` | `wts a` | Ask any shell/terminal question |
| `wts config set <key> <value>` | | Set a config value |
| `wts config set-provider <name>` | | Switch AI provider preset |
| `wts config list` | | Show all config |
| `wts history` | | View history |
| `wts history --clear` | | Clear history |

### Generate Options

```bash
wts generate "..." --run          # Execute directly (safe commands only)
wts generate "..." --copy         # Copy to clipboard
wts generate "..." --shell zsh    # Target a specific shell
```

After generating, you'll see an interactive prompt:

```
> [R]un  [C]opy  [E]dit  [Q]uit
```

- **R** — Run the command
- **C** — Copy to clipboard
- **E** — Edit the command before running
- **Q** — Quit

### Explain Options

```bash
wts explain "..." --brief    # One-line summary
wts explain "..." --detail   # Detailed breakdown
```

## Supported AI Providers

Built-in presets (one command to switch):

```bash
wts config set-provider openai      # OpenAI (gpt-4o)
wts config set-provider anthropic   # Anthropic Claude
wts config set-provider qwen        # Qwen / Tongyi Qianwen
wts config set-provider deepseek    # DeepSeek
wts config set-provider kimi        # Moonshot KIMI
```

Or use any OpenAI-compatible API:

```bash
wts config set provider openai
wts config set base_url https://your-api.com/v1
wts config set model your-model
wts config set api_key your-key
```

## Danger Detection

WhatTheShell automatically detects dangerous commands and shows warnings:

- **DANGER** (`rm -rf`, `dd`, `mkfs`, etc.) — blocks `--run`, forces confirmation
- **CAUTION** (`sudo`, `kill -9`, `curl | bash`, etc.) — shows warning

## Config

Config is stored at `~/.wts/config.toml`.

| Key | Values | Default |
|-----|--------|---------|
| `api_key` | your API key | (none) |
| `provider` | `openai`, `anthropic` | `openai` |
| `base_url` | custom API endpoint | (default) |
| `model` | model name | `gpt-4o` |
| `language` | `zh`, `en` | `zh` |
| `shell` | `bash`, `zsh`, `powershell`, `fish` | `bash` |
| `history_limit` | number | `100` |

## License

MIT
