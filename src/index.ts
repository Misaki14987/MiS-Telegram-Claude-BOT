import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { ApprovalQueue } from "./approval.js";
import { ClaudeSession } from "./claude-session.js";
import { loadPlugins } from "./plugin-loader.js";
import type { Plugin } from "./plugin.js";
import { splitMessage, isAllowed, parseUserIds, formatToolCall, escapeHtml, mdToTelegramHtml } from "./utils.js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) { console.error("Missing TELEGRAM_BOT_TOKEN in .env"); process.exit(1); }

const ALLOWED_USERS = parseUserIds(process.env.ALLOWED_USER_IDS || "");
const WORK_DIR = process.env.WORK_DIR || process.env.HOME || "/home";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const HTML = { parse_mode: "HTML" as const };

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const approvalQueue = new ApprovalQueue();
const sessions = new Map<number, ClaudeSession>();
const busyUsers = new Set<number>();

function getSession(userId: number): ClaudeSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, new ClaudeSession(approvalQueue, WORK_DIR, CLAUDE_MODEL));
  }
  return sessions.get(userId)!;
}

class StreamingMessage {
  private chatId: number;
  private messageId: number | null = null;
  private lines: string[] = [];
  private pendingFlush = false;
  private lastFlushTime = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(chatId: number) { this.chatId = chatId; }

  append(line: string): void {
    this.lines.push(line);
    this.scheduleFlush();
  }

  forceFlush(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.pendingFlush = false;
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return;
    const delay = Math.max(0, 1200 - (Date.now() - this.lastFlushTime));
    this.pendingFlush = true;
    this.flushTimer = setTimeout(() => { this.pendingFlush = false; this.flush(); }, delay);
  }

  private flush(): void {
    const text = this.lines.join("\n").slice(0, 4096) || "⏳";
    this.lastFlushTime = Date.now();
    if (this.messageId === null) {
      bot.sendMessage(this.chatId, text, HTML).then((s) => { this.messageId = s.message_id; }).catch(() => {});
    } else {
      bot.editMessageText(text, { chat_id: this.chatId, message_id: this.messageId, ...HTML }).catch(() => {});
    }
  }
}

// --- Built-in commands ---

const BUILTIN_COMMANDS = [
  { command: "stop", description: "Stop current task" },
  { command: "clear", description: "Start a new session" },
  { command: "dir", description: "Switch working directory" },
  { command: "pwd", description: "Show current directory" },
  { command: "plugins", description: "List loaded plugins" },
];

let loadedPlugins: Plugin[] = [];

bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;

  const lines = [
    "<b>Claude Code Telegram Bridge</b>",
    "",
    "Send any message → Claude Code executes locally.",
    "",
    "<b>Commands:</b>",
    ...BUILTIN_COMMANDS.map((c) => `/${c.command} - ${c.description}`),
  ];

  const pluginCmds = loadedPlugins.flatMap((p) => p.commands || []);
  if (pluginCmds.length > 0) {
    lines.push("", "<b>Plugin Commands:</b>");
    for (const c of pluginCmds) {
      lines.push(`/${c.command} - ${c.description}`);
    }
  }

  bot.sendMessage(msg.chat.id, lines.join("\n"), HTML);
});

bot.onText(/\/stop/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  if (session.isRunning) {
    session.abort();
    bot.sendMessage(msg.chat.id, "⏹ Stopped. Next message continues the conversation.");
  } else {
    bot.sendMessage(msg.chat.id, "Nothing is running.");
  }
});

bot.onText(/\/clear/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  getSession(msg.from!.id).clearSession();
  bot.sendMessage(msg.chat.id, "Session cleared.");
});

bot.onText(/\/dir (.+)/, (msg, match) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  session.setWorkDir(match![1].trim());
  bot.sendMessage(msg.chat.id, `Working directory: <code>${escapeHtml(session.getWorkDir())}</code>`, HTML);
});

bot.onText(/\/pwd/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  bot.sendMessage(msg.chat.id, `Working directory: <code>${escapeHtml(getSession(msg.from!.id).getWorkDir())}</code>`, HTML);
});

bot.onText(/\/plugins/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  if (loadedPlugins.length === 0) {
    bot.sendMessage(msg.chat.id, "No plugins loaded. Add .ts files to <code>plugins/</code>", HTML);
    return;
  }
  const lines = loadedPlugins.map((p) => `• <b>${escapeHtml(p.name)}</b> - ${escapeHtml(p.description)}`);
  bot.sendMessage(msg.chat.id, `<b>Plugins (${loadedPlugins.length}):</b>\n${lines.join("\n")}`, HTML);
});

// --- Messages → Claude ---

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;

  const chatId = msg.chat.id;
  const userId = msg.from!.id;

  if (busyUsers.has(userId)) {
    bot.sendMessage(chatId, "Claude is still working. Please wait.");
    return;
  }

  busyUsers.add(userId);
  const session = getSession(userId);
  const stream = new StreamingMessage(chatId);
  stream.append("⏳ <i>Working...</i>");

  try {
    await session.run(msg.text, {
      onText: (text) => stream.append(`\n💬 ${escapeHtml(text.slice(0, 500))}`),
      onToolUse: (toolName, input) => stream.append(formatToolCall(toolName, input)),
      onApprovalNeeded: (id, toolName, input) => {
        bot.sendMessage(chatId, `⚠️ <b>Permission required:</b>\n\n${formatToolCall(toolName, input)}`, {
          ...HTML,
          reply_markup: { inline_keyboard: [[
            { text: "✅ Allow", callback_data: `approve:${id}` },
            { text: "❌ Deny", callback_data: `deny:${id}` },
          ]] },
        });
      },
      onToolNotify: (toolName, input) => stream.append(`✅ ${formatToolCall(toolName, input)}`),
      onDone: async (result, isError) => {
        busyUsers.delete(userId);
        stream.append(isError ? "\n❌ <b>Done (with errors)</b>" : "\n✅ <b>Done</b>");
        stream.forceFlush();
        const html = mdToTelegramHtml(isError ? `❌ ${result}` : result);
        for (const part of splitMessage(html)) {
          await bot.sendMessage(chatId, part, HTML);
        }
      },
    });
  } catch (err: any) {
    busyUsers.delete(userId);
    stream.append(`\n❌ <b>Error:</b> ${escapeHtml(err.message)}`);
    stream.forceFlush();
  }
});

// --- Approval buttons ---

bot.on("callback_query", async (cbQuery) => {
  if (!cbQuery.data) return;
  const [action, ...idParts] = cbQuery.data.split(":");
  const approvalId = idParts.join(":");

  if (action !== "approve" && action !== "deny") return;
  const allowed = action === "approve";
  const resolved = approvalQueue.resolveApproval(approvalId, allowed);

  if (resolved) {
    await bot.answerCallbackQuery(cbQuery.id, { text: allowed ? "Allowed" : "Denied" });
    if (cbQuery.message) {
      const status = allowed ? "✅ <b>ALLOWED</b>" : "❌ <b>DENIED</b>";
      bot.editMessageText(`${escapeHtml(cbQuery.message.text || "")}\n\n→ ${status}`, {
        chat_id: cbQuery.message.chat.id, message_id: cbQuery.message.message_id, ...HTML,
      });
    }
  } else {
    await bot.answerCallbackQuery(cbQuery.id, { text: "Expired." });
  }
});

// --- Startup ---

async function main() {
  console.log("Loading plugins...");
  loadedPlugins = await loadPlugins({ bot, getSession, parseMode: HTML });
  console.log(`Bot running | dir: ${WORK_DIR} | model: ${CLAUDE_MODEL} | plugins: ${loadedPlugins.length}`);
  if (ALLOWED_USERS.size > 0) console.log(`Allowed users: ${[...ALLOWED_USERS].join(", ")}`);
  else console.log("Warning: No ALLOWED_USER_IDS set, anyone can use this bot!");
}

main();
