# WhatTheShell (wts) — 产品需求文档

## 1. 概述

**WhatTheShell** 是一款基于 AI 的终端命令行工具，帮助用户：

- 用自然语言描述意图，自动生成对应的 Shell 命令
- 对已有的复杂命令进行逐段解释
- 降低命令行使用门槛，提升开发者效率

CLI 命令名称：`wts`

---

## 2. 目标用户

| 用户类型 | 痛点 |
|---------|------|
| 初学者 | 记不住命令语法，需要频繁搜索 |
| 中级开发者 | 能写基础命令，但复杂管道/正则/参数组合耗时 |
| 高级开发者 | 偶尔遇到不熟悉的工具或他人写的长命令，需要快速理解 |
| DevOps / SRE | 需要快速生成一次性运维脚本片段 |

---

## 3. 核心功能

### 3.1 `wts generate` — 自然语言生成命令

用户用自然语言描述想做的事情，工具返回对应的 Shell 命令。

```bash
$ wts generate "查找当前目录下所有超过 100MB 的文件并按大小排序"
find . -type f -size +100M -exec ls -lhS {} + | sort -k5 -h

# 交互确认
> [R]un  [C]opy  [E]dit  [Q]uit
```

**关键行为：**
- 默认生成后不自动执行，需用户确认
- 对危险命令（`rm -rf`、`dd`、`mkfs`、`chmod 777`、`> /dev/sda` 等）标注 ⚠️ 风险提示，说明潜在后果
- 危险命令禁止 `--run` 直接执行，强制交互确认（且不显示 Run 选项）
- 支持 `--run` / `-r` 标志跳过确认直接执行（仅限安全命令）
- 支持 `--copy` / `-c` 标志将结果复制到剪贴板
- 自动检测当前 Shell 环境（bash/zsh/powershell/fish）并生成对应语法
- 支持通过 `--shell <name>` 手动指定目标 Shell
- [E]dit 可让用户在终端内修改命令后重新进入确认流程

### 3.2 `wts explain` — 命令解释

将一条完整命令拆解为逐段解释。

```bash
$ wts explain "awk '{sum += $5} END {print sum}' access.log"

  awk                         # 文本处理工具
  '{sum += $5}'               # 对每行的第5列累加到变量 sum
  END {print sum}             # 处理完所有行后，打印 sum 的值
  access.log                  # 输入文件
```

**关键行为：**
- 支持管道命令的多段拆解
- 对危险操作（`rm -rf`、`dd`、`mkfs` 等）标注 ⚠️ 警告
- 支持 `--brief` 给出一句话摘要，`--detail` 给出详细解释（默认中等详细度）

### 3.3 `wts ask` — 自由问答

针对终端/Shell 相关问题的自由对话。

```bash
$ wts ask "bash 和 zsh 的主要区别是什么？"
```

---

## 4. 辅助功能

### 4.1 历史记录

```bash
$ wts history          # 查看最近的生成/解释记录
$ wts history --clear  # 清除历史
```

- 本地存储于 `~/.wts/history.json`
- 默认保留最近 100 条（可通过 `wts config set history_limit N` 调整）

### 4.2 配置管理

```bash
$ wts config set api_key sk-xxx        # 设置 API Key
$ wts config set model gpt-4o          # 设置模型
$ wts config set language zh            # 输出语言（zh/en）
$ wts config set shell bash             # 默认目标 Shell
$ wts config set provider openai        # API 协议类型（openai/anthropic）
$ wts config set base_url https://...   # 自定义 API 端点
$ wts config set-provider deepseek      # 一键切换提供商预设
$ wts config list                       # 查看所有配置
```

- 配置文件存储于 `~/.wts/config.toml`

### 4.3 多模型支持

内置提供商预设，一键切换：

| 预设名 | 说明 | 默认模型 |
|--------|------|----------|
| `openai` | OpenAI | gpt-4o |
| `anthropic` | Anthropic Claude | claude-sonnet-4-20250514 |
| `qwen` | 通义千问 (阿里云) | qwen-plus |
| `deepseek` | DeepSeek | deepseek-chat |
| `kimi` | Moonshot KIMI | moonshot-v1-8k |

也支持任意 OpenAI 兼容 API，通过 `base_url` + `api_key` + `model` 自定义配置。

### 4.4 别名快捷方式

```bash
wts g  = wts generate
wts e  = wts explain
wts a  = wts ask
```

### 4.5 危险命令检测

内置本地规则库，对 AI 生成的命令进行二次检测：

- **高危（DANGER）**：`rm -rf`、`dd of=`、`mkfs`、`> /dev/sdX`、`chmod 777 /` 等 → 禁止 --run，强制确认
- **中等风险（CAUTION）**：`sudo`、`kill -9`、`curl | bash`、`shutdown` 等 → 显示警告

---

## 5. 技术方案

### 5.1 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (Node.js) | 生态丰富、跨平台、CLI 工具链成熟 |
| CLI 框架 | Commander.js | 轻量、广泛使用 |
| AI 后端 | OpenAI 兼容 API / Claude API（可配置） | 支持主流大模型，按需切换 |
| 输出美化 | chalk + ora | 彩色输出 + loading 动画 |
| 剪贴板 | clipboardy | 跨平台剪贴板操作 |
| 配置存储 | TOML（@iarna/toml） | 可读性强，适合用户手动编辑 |
| 包管理 | npm | 通过 `npm install -g whattheshell` 全局安装 |

### 5.2 项目结构

```
wts/
├── src/
│   ├── index.ts            # 入口 & CLI 定义
│   ├── commands/
│   │   ├── generate.ts     # generate 命令
│   │   ├── explain.ts      # explain 命令
│   │   └── ask.ts          # ask 命令
│   ├── core/
│   │   ├── ai.ts           # AI API 调用封装（OpenAI 兼容 + Anthropic）
│   │   ├── prompt.ts       # Prompt 模板管理
│   │   ├── danger.ts       # 危险命令本地规则检测
│   │   └── shell.ts        # Shell 环境检测
│   ├── utils/
│   │   ├── config.ts       # 配置读写 + 提供商预设
│   │   ├── history.ts      # 历史记录
│   │   ├── clipboard.ts    # 剪贴板
│   │   └── display.ts      # 输出格式化（chalk + ora）
│   └── types.ts            # 类型定义
├── package.json
├── tsconfig.json
└── docs/
    └── PRD.md
```

---

## 6. 安装与分发

```bash
# npm 全局安装
npm install -g whattheshell

# 或直接使用 npx
npx whattheshell generate "..."
```

注册 npm 包名：`whattheshell`，CLI 二进制名：`wts`

---

## 7. 非功能性需求

| 项目 | 要求 |
|------|------|
| 首次响应时间 | < 3 秒（取决于 AI API） |
| 离线表现 | 无网络时给出明确提示，不静默失败 |
| 平台支持 | macOS、Linux、Windows (WSL + native) |
| Node.js 版本 | >= 18 |
| 安全性 | API Key 仅本地存储（`config list` 自动脱敏），不上传；生成的命令默认不自动执行 |
| 国际化 | 支持中文和英文输出（通过 `config set language` 切换） |

---

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| **v0.1** | `generate` + `explain` + `ask` 核心功能，配置管理，多模型支持，危险检测，历史记录 | ✅ 已完成 |
| **v0.2** | Shell 自动检测增强、多轮对话、输出优化 | 待开发 |
| **v0.3** | 插件系统、本地模型支持（Ollama） | 待开发 |
| **v1.0** | npm 发布、完整文档、CI/CD | 待开发 |

---

## 9. 开放问题

- [ ] 是否支持多轮对话（连续追问优化生成结果）？
- [ ] 是否提供 Web UI 或 TUI 界面？
- [ ] 是否支持本地模型（如 Ollama）以实现离线使用？
- [ ] 包名 `whattheshell` 在 npm 上是否可用？
