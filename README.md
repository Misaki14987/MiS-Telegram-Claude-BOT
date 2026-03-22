# Telegram → Claude Code Bridge

哈哈造史中
类似ClaudeCode推出的Channel。不同的是本项目是在本地命令行启动ClaudeCode，所以可以不使用Claude账号
## 安装

1. [@BotFather](https://t.me/BotFather) 创建 bot，拿到 token
2. [@userinfobot](https://t.me/userinfobot) 获取你的数字 ID
3. 配置：
```bash
cp .env.example .env
# 编辑 .env 填入 TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, WORK_DIR, NOTIFY_CHAT_ID
npm install && npm run dev
```
## Notice

确保环境中有node，以及能够访问到Telegram, 以及你ClaudeCode

## 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Bot Token（BotFather 获取） |
| `ALLOWED_USER_IDS` | 允许使用的用户 ID，逗号分隔 |
| `WORK_DIR` | Claude Code 工作目录 |
| `CLAUDE_MODEL` | 模型：opus / sonnet / haiku |
| `NOTIFY_CHAT_ID` | 接收 bot 启动/崩溃通知的聊天 ID |

## 命令

| 命令 | 说明 |
|------|------|
| `/model` | 切换模型 (opus/sonnet/haiku) |
| `/stop` | 停止当前任务 |
| `/clear` | 清除会话 |
| `/dir <path>` | 切换工作目录 |
| `/pwd` | 显示工作目录 |
| `/plugins` | 列出已加载插件 |
| `/status` | 查看 bot 运行时间 |
| `/ping` | 检查 bot 是否存活 |

## 插件系统

在 `plugins/` 目录下让claude给你造史吃。重启后自动加载。

### 插件接口

```typescript
import type { Plugin } from "../src/plugin.js";

const plugin: Plugin = {
  name: "MyPlugin",
  description: "What it does",
  commands: [
    {
      command: "hello",
      description: "Say hello",
      handler: (msg, match, ctx) => {
        ctx.bot.sendMessage(msg.chat.id, "Hello!");
      },
    },
  ],
  // onMessage: 拦截非命令消息
  // onLoad: 初始化（定时任务、外部连接等）
};

export default plugin;
```

### 内置插件

| 插件 | 功能 |
|------|------|
| `example.ts` | `/ping` — 检查 bot 存活 |
| `heartbeat.ts` | 启动/崩溃通知 + `/status` 运行时间 |
