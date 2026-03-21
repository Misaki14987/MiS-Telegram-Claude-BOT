# Telegram → Claude Code Bridge

通过 Telegram 远程控制本地 Claude Code。Claude Code 在你的本机运行，拥有完整的文件、终端和工具访问权限。

**核心特性：交互式权限审批** — 当 Claude 需要执行命令时，Telegram 会弹出 `[✅ Allow]` `[❌ Deny]` 按钮，你可以在手机上实时审批。

## 工作原理

```
你 (Telegram) ──发消息──→ Bot 进程 (本机轮询) ──→ Claude Agent SDK ──→ 结果 ──→ 回复到 Telegram
                                                       ↓
                                              需要执行 Bash 命令？
                                                       ↓
                                              Telegram 弹出审批按钮
                                                       ↓
                                              你点 Allow / Deny
                                                       ↓
                                              Claude 继续 / 停止
```

Bot 使用 **polling 模式**主动从 Telegram 服务器拉取消息，不需要公网 IP 或开放端口。只要本机能访问 `api.telegram.org` 就能工作。

## 权限策略

| 操作类型 | 工具 | 策略 |
|----------|------|------|
| 只读 | Read, Glob, Grep, LSP, WebSearch | 自动执行，无通知 |
| 文件编辑 | Write, Edit, NotebookEdit | 自动执行，发通知告知改了什么 |
| 命令执行 | Bash 及其他工具 | 需要你在 Telegram 中点击审批 |

## 安装

### 1. 创建 Telegram Bot

1. 在 Telegram 中打开 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，设置名称和用户名
3. 复制 Bot Token

### 2. 获取你的 Telegram 数字 ID

向 [@userinfobot](https://t.me/userinfobot) 发送任意消息，它会回复你的数字 ID（如 `123456789`）。

> **注意**：这里需要的是纯数字 ID，不是 `@username` 用户名。

### 3. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_USER_IDS=123456789          # 你的 Telegram 数字 ID
WORK_DIR=/home/misa/my-project      # Claude Code 的工作目录
CLAUDE_MODEL=sonnet                 # 模型：opus, sonnet, haiku
```

多个用户用逗号分隔：`ALLOWED_USER_IDS=111111,222222`

### 4. 运行

```bash
npm install
npm run dev
```

## 命令

| 命令           | 说明                         |
| -------------- | ---------------------------- |
| `/start`       | 显示帮助信息                 |
| `/clear`       | 清除会话，下条消息重新开始   |
| `/dir <path>`  | 切换 Claude Code 工作目录    |
| `/pwd`         | 显示当前工作目录             |

其他所有消息都会直接发送给 Claude Code 执行。

## 会话机制

- 第一条消息开启新会话
- 后续消息自动延续上下文（session resume）
- 发送 `/clear` 清除会话状态，下条消息重新开始

## 安全

- **ALLOWED_USER_IDS**：只有列出的数字 ID 才能使用 Bot。留空表示允许所有人（不推荐）。
- **交互式审批**：Bash 命令等危险操作需要你在 Telegram 中手动批准，不会自动执行。
- Bot Token 不要提交到版本控制（`.env` 已在 `.gitignore` 中）。
- Bot 仅在 `npm run dev` 运行期间工作。

## 示例

```
你：list all files in current directory
→ Claude 自动执行 Glob（只读，无需审批），返回文件列表

你：run echo hello
→ Telegram 弹出审批：
  🔧 Bash
  $ echo hello
  [✅ Allow] [❌ Deny]
→ 你点 Allow → Claude 执行，返回 "hello"

你：create a hello.py that prints hello world
→ Telegram 通知：Auto-approved: 📄 hello.py（文件编辑自动放行）
→ Claude 创建文件并报告完成

你：fix the bug in src/index.ts
→ Claude 读取文件（自动）→ 编辑文件（通知）→ 完成
```

## 技术栈

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — `canUseTool` 回调实现审批桥接
- **node-telegram-bot-api** — Telegram Bot polling + inline keyboard
- **TypeScript + tsx** — 开发运行

## 后台运行

```bash
# 使用 tmux
tmux new -s claude-bot
npm run dev
# Ctrl+B D 分离

# 或 nohup
nohup npm run dev > bot.log 2>&1 &
```
