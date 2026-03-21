import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { ApprovalQueue } from "./approval.js";
import type { QuestionItem } from "./approval.js";
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

const MODELS = ["opus", "sonnet", "haiku"];

const BUILTIN_COMMANDS = [
  { command: "stop", description: "Stop current task" },
  { command: "clear", description: "Start a new session" },
  { command: "model", description: "Switch model (opus/sonnet/haiku)" },
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

bot.onText(/\/model(?:\s+(.+))?/, (msg, match) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  const arg = match?.[1]?.trim();

  if (!arg) {
    const current = session.getModel();
    const buttons = MODELS.map((m) => ({
      text: m === current ? `✅ ${m}` : m,
      callback_data: `model:${m}`,
    }));
    bot.sendMessage(msg.chat.id, `Current model: <b>${escapeHtml(current)}</b>`, {
      ...HTML,
      reply_markup: { inline_keyboard: [buttons] },
    });
    return;
  }

  if (MODELS.includes(arg)) {
    session.setModel(arg);
    bot.sendMessage(msg.chat.id, `Model: <b>${escapeHtml(arg)}</b>`, HTML);
  } else {
    bot.sendMessage(msg.chat.id, `Unknown model. Available: ${MODELS.join(", ")}`, HTML);
  }
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

// --- AskUserQuestion helpers ---

function buildQuestionKeyboard(
  questionId: string,
  q: QuestionItem,
  selectedLabels?: Set<string>
): TelegramBot.InlineKeyboardButton[][] {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (const opt of q.options) {
    const isSelected = selectedLabels?.has(opt.label);
    const prefix = q.multiSelect ? (isSelected ? "☑ " : "☐ ") : "";
    rows.push([{
      text: `${prefix}${opt.label}`,
      callback_data: `qopt:${questionId}:${opt.label}`.slice(0, 64),
    }]);
  }
  // "Other" option for custom text input
  rows.push([{
    text: "✏️ Other...",
    callback_data: `qtext:${questionId}`,
  }]);
  if (q.multiSelect) {
    rows.push([{
      text: "✅ Confirm selection",
      callback_data: `qconfirm:${questionId}`,
    }]);
  }
  return rows;
}

function formatQuestion(q: QuestionItem): string {
  let text = `❓ <b>${escapeHtml(q.header)}</b>\n\n${escapeHtml(q.question)}`;
  for (const opt of q.options) {
    text += `\n\n• <b>${escapeHtml(opt.label)}</b>`;
    if (opt.description) text += ` — ${escapeHtml(opt.description)}`;
  }
  return text;
}

function sendQuestionToChat(chatId: number, questionId: string, q: QuestionItem): void {
  bot.sendMessage(chatId, formatQuestion(q), {
    ...HTML,
    reply_markup: { inline_keyboard: buildQuestionKeyboard(questionId, q) },
  });
}

/** Track which chatId each question belongs to */
const questionChatMap = new Map<string, number>();

// --- Messages → Claude ---

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;

  const chatId = msg.chat.id;
  const userId = msg.from!.id;

  // Check if this is a text answer for an AskUserQuestion "Other" option
  const session = sessions.get(userId);
  if (session) {
    const waiting = session.questionQueue.findWaitingForText();
    if (waiting) {
      const { id: questionId, entry: pending } = waiting;
      const q = pending.questions[pending.currentIndex];
      if (q.multiSelect) {
        // For multiSelect, add the custom text and keep the question open
        session.questionQueue.toggleMulti(questionId, msg.text);
        session.questionQueue.setWaitingForText(questionId, false);
        const selected = pending.multiAnswers[q.question] || new Set();
        bot.sendMessage(chatId, `Added: <b>${escapeHtml(msg.text)}</b>\nCurrent: ${[...selected].map(s => escapeHtml(s)).join(", ") || "(none)"}`, HTML);
      } else {
        const nextIdx = session.questionQueue.answerCurrent(questionId, msg.text);
        bot.sendMessage(chatId, `→ <b>${escapeHtml(msg.text)}</b>`, HTML);
        if (nextIdx >= 0) {
          sendQuestionToChat(chatId, questionId, pending.questions[nextIdx]);
        } else {
          questionChatMap.delete(questionId);
        }
      }
      return;
    }
  }

  if (busyUsers.has(userId)) {
    bot.sendMessage(chatId, "Claude is still working. Please wait.");
    return;
  }

  busyUsers.add(userId);
  const activeSession = getSession(userId);
  const stream = new StreamingMessage(chatId);
  stream.append("⏳ <i>Working...</i>");

  try {
    await activeSession.run(msg.text, {
      onText: (text) => stream.append(`\n💬 ${mdToTelegramHtml(text)}`),
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
      onQuestion: (id, questions) => {
        questionChatMap.set(id, chatId);
        if (questions.length > 0) {
          sendQuestionToChat(chatId, id, questions[0]);
        }
      },
      onToolNotify: (toolName, input) => stream.append(`✅ ${formatToolCall(toolName, input)}`),
      onDone: async (result, isError) => {
        busyUsers.delete(userId);
        if (isError) {
          stream.append(`\n❌ <b>Error:</b> ${escapeHtml(result.slice(0, 500))}`);
        } else {
          stream.append("\n✅ <b>Done</b>");
        }
        stream.forceFlush();
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

  if (action === "model" && cbQuery.from) {
    const model = approvalId;
    if (MODELS.includes(model)) {
      const session = getSession(cbQuery.from.id);
      session.setModel(model);
      await bot.answerCallbackQuery(cbQuery.id, { text: `Switched to ${model}` });
      if (cbQuery.message) {
        const buttons = MODELS.map((m) => ({
          text: m === model ? `✅ ${m}` : m,
          callback_data: `model:${m}`,
        }));
        bot.editMessageText(`Current model: <b>${escapeHtml(model)}</b>`, {
          chat_id: cbQuery.message.chat.id, message_id: cbQuery.message.message_id, ...HTML,
          reply_markup: { inline_keyboard: [buttons] },
        });
      }
    }
    return;
  }

  // --- AskUserQuestion: option selected ---
  if (action === "qopt" && cbQuery.from) {
    const session = getSession(cbQuery.from.id);
    const selectedLabel = idParts.slice(1).join(":");
    const qId = idParts[0];
    const fullId = `${action}:${approvalId}`;
    // Reconstruct the original questionId: "question_N_timestamp"
    // approvalId = everything after "qopt:", which is "questionId:label"
    // But we encoded as `qopt:${questionId}:${label}` and split on ":"
    // So idParts = [questionId_part1, questionId_part2, ...label_parts]
    // questionId format: question_N_timestamp — has exactly 2 underscores, split by ":"
    // Actually the callback_data is `qopt:${questionId}:${optLabel}` truncated to 64
    // and we split cbQuery.data on ":" → [action, ...idParts]
    // So idParts[0] is everything of questionId before any ":", but questionId has no ":"
    // Wait — questionId = `question_${counter}_${timestamp}` — no colons.
    // So idParts = [questionId, ...labelParts], and label = labelParts.join(":")
    const questionId = idParts[0];
    const label = idParts.slice(1).join(":");
    const pending = session.questionQueue.get(questionId);
    if (!pending) {
      await bot.answerCallbackQuery(cbQuery.id, { text: "Expired." });
      return;
    }
    const q = pending.questions[pending.currentIndex];

    if (q.multiSelect) {
      // Toggle and update keyboard
      const selected = session.questionQueue.toggleMulti(questionId, label);
      if (selected && cbQuery.message) {
        await bot.answerCallbackQuery(cbQuery.id, { text: `${selected.has(label) ? "Selected" : "Deselected"}: ${label}` });
        bot.editMessageReplyMarkup(
          { inline_keyboard: buildQuestionKeyboard(questionId, q, selected) },
          { chat_id: cbQuery.message.chat.id, message_id: cbQuery.message.message_id }
        );
      }
    } else {
      // Single select: answer and move on
      await bot.answerCallbackQuery(cbQuery.id, { text: label });
      const nextIdx = session.questionQueue.answerCurrent(questionId, label);
      if (cbQuery.message) {
        bot.editMessageText(`${formatQuestion(q)}\n\n→ <b>${escapeHtml(label)}</b>`, {
          chat_id: cbQuery.message.chat.id, message_id: cbQuery.message.message_id, ...HTML,
        });
      }
      if (nextIdx >= 0) {
        const chatId = questionChatMap.get(questionId);
        if (chatId) sendQuestionToChat(chatId, questionId, pending.questions[nextIdx]);
      } else {
        questionChatMap.delete(questionId);
      }
    }
    return;
  }

  // --- AskUserQuestion: confirm multiSelect ---
  if (action === "qconfirm" && cbQuery.from) {
    const session = getSession(cbQuery.from.id);
    const questionId = approvalId;
    const pending = session.questionQueue.get(questionId);
    if (!pending) {
      await bot.answerCallbackQuery(cbQuery.id, { text: "Expired." });
      return;
    }
    const q = pending.questions[pending.currentIndex];
    const selected = pending.multiAnswers[q.question] || new Set();
    const answer = [...selected].join(", ") || "(none)";
    await bot.answerCallbackQuery(cbQuery.id, { text: "Confirmed" });
    const nextIdx = session.questionQueue.confirmMulti(questionId);
    if (cbQuery.message) {
      bot.editMessageText(`${formatQuestion(q)}\n\n→ <b>${escapeHtml(answer)}</b>`, {
        chat_id: cbQuery.message.chat.id, message_id: cbQuery.message.message_id, ...HTML,
      });
    }
    if (nextIdx >= 0) {
      const chatId = questionChatMap.get(questionId);
      if (chatId) sendQuestionToChat(chatId, questionId, pending.questions[nextIdx]);
    } else {
      questionChatMap.delete(questionId);
    }
    return;
  }

  // --- AskUserQuestion: custom text ("Other") ---
  if (action === "qtext" && cbQuery.from) {
    const session = getSession(cbQuery.from.id);
    const questionId = approvalId;
    const pending = session.questionQueue.get(questionId);
    if (!pending) {
      await bot.answerCallbackQuery(cbQuery.id, { text: "Expired." });
      return;
    }
    session.questionQueue.setWaitingForText(questionId, true);
    await bot.answerCallbackQuery(cbQuery.id, { text: "Type your answer" });
    const chatId = questionChatMap.get(questionId);
    if (chatId) {
      bot.sendMessage(chatId, "✏️ Please type your answer:", { reply_markup: { force_reply: true } });
    }
    return;
  }

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
