# WhatTheShell — Session Handoff / Status

> **When to read this**: at the start of any new Claude Code session that needs to continue work on this repo. Point Claude at this file (e.g. `read docs/HANDOFF.md and continue where it left off`) to re-establish context without replaying the whole conversation.
>
> **Who maintains it**: updated by Claude at the end of each significant work batch. Human can also edit it directly — treat the "Immediate next task" and "Pending / deferred" sections as editable by either side.

---

## 1. Project at a glance

| Field | Value |
|---|---|
| Repo | `E:\WhatTheShell` (git, `main` branch, origin = `https://github.com/YoloZyk/WhatTheShell.git`) |
| CLI name | `wts` |
| npm package name | `whattheshell` |
| Current version | `0.2.0-dev.0` (in `package.json`) — NOT published to npm yet |
| Published on npm | `0.1.1` (ancient, pre-v0.2 feature set) |
| Runtime | Node.js ≥ 18, TypeScript, `"type": "commonjs"` |
| What it is | AI-powered CLI that (a) generates shell commands from natural language, (b) explains commands, (c) does free-form shell/terminal Q&A, and (d) plugs into zsh / bash / fish / PowerShell via a `Ctrl+G` keybinding that replaces the current line buffer with an AI-generated command |
| Owner | `yolozyk` (user is both author and maintainer — treat as project owner, not an end user) |

**Chat language default**: the user prefers Chinese-language conversation with Claude. User-facing STRINGS in the CLI are currently mostly Chinese too — that's on the very next task list (see §6).

---

## 2. Roadmap state

The canonical plan is at `C:\Users\张云康\.claude\plans\prancy-weaving-melody.md`. Read it if you want the full original design (UX & Windows overhaul across three phases). Short version:

| Phase | Status | What it covers |
|---|---|---|
| **Phase 1 — Onboarding & Windows coverage** | ✅ **DONE** | `wts init` wizard, PowerShell + fish integration, Windows danger rules, TTY-aware `shell-init`, per-shell prompt style hints, auto-trigger init on missing API key |
| **Phase 2 — UX polish** | ⏳ NOT STARTED | `@inquirer/prompts` arrow-key menu replacing the R/C/E/Q single-key, `ask`/`explain` token streaming, Ctrl+G spinner + Esc cancel, i18n for all UI strings, friendlier default help |
| **Phase 3 — Depth features** | ⏳ NOT STARTED | `wts doctor`, history search/replay, multi-turn (`ask --continue`), retry/timeout in `chat()`, update-check notifier |

### Immediately queued before Phase 2 starts

The user explicitly asked for these two to happen **before** diving into Phase 2 proper:

1. **i18n all user-facing strings to English.** Currently most prompts, errors, confirmations, spinner text are Chinese — limits global adoption. This is listed in Phase 2's 2.4 in the plan but the user wants it done as its own focused pass. Details in §6 below.
2. **(this doc itself)** Session-handoff document so context loss between sessions doesn't cost us progress. ✅ You're reading it.

---

## 3. What Phase 1 delivered (newest commits first)

All commits are on `main`. Not pushed to `origin` yet — the user said "只提交，不 push" at the start of the v0.2 work; that still holds unless told otherwise.

```
e7b3a00 feat: add `wts init` wizard and auto-trigger on missing API key
0831f8b fix: route --shell through integrations and add per-shell style hints
4fa70e7 fix(powershell): pure-ASCII single-line registration + ArrayList args
22f59f8 fix(powershell): use array splat so empty buffer doesn't eat the `--` marker
1d61fb2 feat: add PowerShell and fish Ctrl+G integration
e5d8405 feat: Phase 1 quick wins — Windows danger rules, TTY-aware shell-init, config health
1bce770 fix: harden inline mode against libuv exit assertion and markdown fences
2d8112a docs: rewrite README in English; bump to 0.2.0-dev.0
393bf9b feat: add Ctrl+G in-line shell integration for zsh and bash
f5ed4c6 feat: inject PWD/git/history context into AI prompts
```

Narrative:

- **Context awareness** (`f5ed4c6`): every AI call now injects PWD, project markers (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `docker-compose.yml`, `Dockerfile`, `Makefile`), git branch/dirty/upstream/recent 3 commits, and last N lines of sanitized shell history. Sanitizer strips tokens, bearer values, AWS keys, OpenAI/Anthropic keys, URL credentials, `*_TOKEN=` / `*_KEY=` / `*_SECRET=` env-style assignments. Config: `context.enable` (bool), `context.history_lines` (int, default 5).
- **Ctrl+G integration** — zsh/bash (`393bf9b`), PowerShell/fish (`1d61fb2`). Each integration script calls `wts generate --inline --shell <name> --buffer <current> --history-file <histfile> -- <intent>`. The CLI writes a single-line command to stdout; shell script replaces buffer without executing. Danger commands refused (exit 3) with original buffer preserved.
- **Windows danger rules** (`e5d8405`): 13 patterns added to `src/core/danger.ts` covering `Remove-Item -Recurse -Force`, `Format-Volume`, `Clear-Disk`, `diskpart`, `del /s /q`, `rmdir /s`, `format C:`, `Stop-Computer`, `Restart-Computer`, `Set-ExecutionPolicy Unrestricted`, `iwr | iex`, `Get-Process | Stop-Process`.
- **`wts init` wizard** (`e7b3a00`): interactive first-run setup using `@inquirer/prompts`. Four steps: provider select → API key + connectivity test → shell integration install → summary. Auto-offered from `generate`/`explain`/`ask` when `api_key` missing (unless `--inline`). Exported `ensureApiKey()` is the shared gate.

### Bugs hit during testing and fixed

These are worth remembering because they'll bite again if we introduce similar patterns:

- **libuv assertion on `process.exit()` in Windows inline mode** (`1bce770`) — replaced `process.exit(n)` with `process.exitCode = n; return` so Commander awaits completion and Node exits naturally without tearing down async stdout mid-flush. **If any new code path wants to exit non-zero, use `exitCode` + `return`, NEVER `process.exit()`.**
- **Markdown code fences in model output** (`1bce770`) — even with "no code blocks" prompt, some models still wrap. `stripMarkdownFence()` in `src/core/ai.ts` strips at parse time; inline mode additionally refuses multi-line output with exit 4.
- **Empty buffer in PowerShell 5.1 native arg passing** (`22f59f8`) — direct-form `& wts ... --buffer $line -- $intent` dropped the empty string, commander consumed `--` as `--buffer`'s value, description went missing. Fixed by building `[System.Collections.ArrayList]` and splatting `@wtsArgs`.
- **Out-String wrapping + ANSI encoding** (`4fa70e7`) — `Out-String` default `-Width 80` could wrap long lines at backtick continuations; `Add-Content` on PS 5.1 Chinese Windows writes ANSI which mangles Chinese comments. Fix: emit a single-line `Set-PSReadLineKeyHandler` call and make the entire emitted script 7-bit ASCII (Chinese explanations stay in the TS source only).
- **Wrong shell in prompt** (`0831f8b`) — integrations weren't passing `--shell`, so PowerShell Ctrl+G got bash-style commands. Fixed by threading `--shell <name>` through all four shell scripts AND adding per-shell `SHELL_STYLE_HINTS` + `SHELL_DANGER_EXAMPLES` to `buildGeneratePrompt`.

---

## 4. Architecture map

```
src/
  index.ts                         Commander entry — registers all subcommands
  types.ts                         Shared types: WtsConfig, GenerateOptions, ContextSnapshot, ...
  core/
    ai.ts                          AIClient (OpenAI/Anthropic), parse{Generate,Explain}Response, stripMarkdownFence
    prompt.ts                      build{Generate,Explain,Ask}Prompt — now shell-aware
    context.ts                     collectContext, renderContextForPrompt, sanitizeHistoryLine
    danger.ts                      19 unix + 13 windows regex rules, checkDanger()
    shell.ts                       detectShell() — reads $SHELL / ComSpec; fallthrough='bash' (has bug on Windows, see §7)
  commands/
    generate.ts                    generateCommand + runInlineMode + interactiveConfirm (R/C/E/Q)
    explain.ts                     explainCommand (brief/normal/detail)
    ask.ts                         askCommand (free-form Q&A)
    init.ts                        initCommand wizard + ensureApiKey gate (NEW in Phase 1)
    shellInit.ts                   prints integration script to stdout; TTY-aware hint
  integrations/shell/
    index.ts                       SupportedShell type, dispatcher
    zsh.ts                         ZLE widget, bind \cg
    bash.ts                        bind -x Ctrl+G, READLINE_LINE/POINT
    fish.ts                        function + bind \cg, commandline -r
    powershell.ts                  Set-PSReadLineKeyHandler + ArrayList splat
  utils/
    config.ts                      TOML at ~/.wts/config.toml, PROVIDER_PRESETS (10 providers), listConfig with health checks
    display.ts                     chalk/ora dynamic-import wrappers, startSpinner, displayCommand, etc.
    clipboard.ts                   copyToClipboard wrapper
    history.ts                     JSON log at ~/.wts/history.json
docs/
  PRD.md                           Product doc (updated Phase 1)
  HANDOFF.md                       This file
README.md                          English, TOC-structured (rewritten in Phase 1)
package.json                       version 0.2.0-dev.0, deps include @inquirer/prompts ^8.4.2
```

---

## 5. How to resume work (quickstart for a new session)

```bash
cd E:/WhatTheShell
git status                        # should be clean; if not, ask user before touching
git log --oneline -5              # compare with §3 to see if anything's changed since
cat docs/HANDOFF.md                # this file
cat C:/Users/张云康/.claude/plans/prancy-weaving-melody.md   # original approved plan
npm run build                     # verify TypeScript compiles
```

Then:

- If **"Immediate next task"** (§6) is clearly defined → start there.
- If the user gave a new task in their message → work on that.
- **Don't push to origin** unless the user explicitly says so. (Standing rule since v0.2 work began.)
- Follow the commit convention from recent commits: `feat:`/`fix:`/`docs:`/`chore:`/`fix(scope):`, with a HEREDOC-style body explaining WHY, ending with the Co-Authored-By line.

---

## 6. Immediate next task — i18n UI strings to English

**Scope**: translate all user-facing Chinese text in the CLI to English. AI-output language still driven by `config.language` — that's untouched. What changes:

- Menu labels, prompts, errors, spinner text
- `wts init` wizard copy
- Help descriptions in `src/index.ts` (currently mostly Chinese)
- Config validation error messages
- TTY hint in `shellInit.ts`
- listConfig health check labels

**Approach options (pick when starting)**:

1. **Straight rewrite**: hardcode English everywhere, delete Chinese.  Simplest, moves us to English-default. Loses the Chinese UX for the (Chinese-speaking) author as a side effect.
2. **Full i18n with `t(key)` helper** (Phase 2.4 in the plan): introduce `src/utils/i18n.ts` with `zh` + `en` tables, pick at runtime based on `config.language`. Keeps Chinese available for the author, adds English for everyone else. **Slightly more work, but strictly better outcome — strongly recommended.**

Expect option 2 to take ~2-3 hours: define the helper, enumerate every hardcoded string (probably 60-80 of them), write both locales, swap call sites. Budget for a single focused commit.

**Files with the most Chinese strings**:

- `src/commands/init.ts` (new, heaviest — all wizard copy)
- `src/commands/generate.ts` (menu labels, cancel messages, danger warnings in inline mode)
- `src/commands/shellInit.ts` (TTY hint is multi-paragraph Chinese)
- `src/utils/display.ts` (spinner text, '摘要:', ' ⚠ DANGER ' / ' ⚠ CAUTION ' labels, '✓'/'✗')
- `src/utils/config.ts` (listConfig labels: 'API Key: 已设置', '未安装', etc.; validation error messages)
- `src/core/danger.ts` — **already bilingual** via `message_zh` / `message_en`, but the current code always passes `language='zh'` from callers. Check call sites. 
- `src/index.ts` (program description, every `.description()` call is Chinese)

**Not in scope for this pass**: 
- AI prompts (stay English-in, user-lang-out via `config.language`)
- Chinese comments in source code (those are developer-facing, keep as-is unless they're inside emitted shell scripts — see §7 encoding traps)

**Verification**: for each CLI surface (help, generate, explain, ask, init, shell-init, config list/set, history), run it with `config.language=en` and confirm everything is English.  Then switch to `config.language=zh` and make sure Chinese still renders (if doing option 2). Also smoke-test that no string got lost (empty menu option, blank spinner, etc.).

---

## 7. Known issues, gotchas, and "do not do this" notes

Things that WILL bite future sessions if not remembered:

### Don't use `process.exit(n)` in hot paths

Always `process.exitCode = n; return` inside Commander action handlers. Direct exit on Windows triggers `libuv "handle->flags & UV_HANDLE_CLOSING"` assertion because stdout may still be flushing.

### `detectShell()` is wrong on Windows

`src/core/shell.ts` falls through to `return 'bash'` when neither `$SHELL` nor `$ComSpec` matches. On Windows cmd.exe, `$ComSpec` points to cmd.exe — the fallthrough picks bash. For Ctrl+G the integration scripts pass `--shell <name>` explicitly so this is mostly neutralized — but for direct CLI invocation (`wts generate "..."` typed in PowerShell), it still picks bash. Proper fix belongs in Phase 2 or as a standalone tweak: add `if (process.platform === 'win32' && process.env.PSModulePath) return 'powershell'` before the fallthrough.

### Emitted shell scripts must stay ASCII

`src/integrations/shell/powershell.ts` (and to a lesser extent the other three) deliberately emit 7-bit ASCII content. Chinese explanations stay in the TS source comments, not in the emitted script. Reason: `Out-String | Add-Content -Path $PROFILE` on PS 5.1 writes the system ANSI code page — Chinese bytes round-trip badly and can produce a profile that fails to parse. If you add Chinese to these files, put it above `const LINES`, never inside the array.

### `@inquirer/prompts` is ESM-only

We're `"type": "commonjs"` so it MUST be loaded via `await import('@inquirer/prompts')`, not `import { ... } from '@inquirer/prompts'`. Pattern is already set in `src/commands/init.ts` via `loadPrompts()`.

### CRLF warnings everywhere

`.gitattributes` isn't set; Windows git emits `LF will be replaced by CRLF` on every commit. Cosmetic, ignore. If we want to silence them, add `.gitattributes` with `* text=auto eol=lf` — that's a future chore, not urgent.

### VSCode terminal eats Ctrl+G

Documented in the chat, not yet codified in README. Workaround: VSCode keybindings.json →
```json
{ "key": "ctrl+g", "command": "-workbench.action.terminal.focusFind", "when": "terminalFocus" }
```
Phase 2 might add a `--key` flag to `shell-init` for configurable chord.

### Npm package is stale

npm registry still has `0.1.1`. `package.json` is `0.2.0-dev.0`. When we're ready to release, the plan is: bump to `0.2.0`, tag, `npm publish`. Not before local verification (see §5 in README).

---

## 8. User preferences learned during this work

- **Commit cadence**: prefers small logical commits over mega-commits. Phase 1 ended up as 10 commits. Good pattern.
- **Testing rhythm**: user runs each commit in their real PowerShell/git-bash environment and reports issues; Claude fixes, commits, repeats. "分块 commit 后停下验证" is the approved workflow.
- **Not pushing yet**: all Phase 1 work is local; origin is behind by 10 commits. Don't push unless asked.
- **Language preference for chat**: Chinese. For CLI UX: soon-to-be English (see §6).
- **Style in explanations**: user prefers direct/terse, specific line numbers, file paths. Don't over-summarize; give the actual change.

---

## 9. When updating this file

Keep it **scannable**. If it balloons past ~400 lines, split sections out. At minimum, every time you:

- Complete a Phase → flip status in §2, move completed items from "next" to "done" in §3.
- Commit → add the one-line summary to §3.
- Hit a new foot-gun → add to §7.
- Change the queued next task → rewrite §6.
- Finish a session → update §3 with the latest commit hash and §6 with the new "Immediate next task".

If you're ever uncertain whether to edit this file, err on the side of recording: the cost of a stale line is tiny compared to a future session starting cold.
