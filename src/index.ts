import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { ApprovalQueue } from "./approval.js";
import { ClaudeSession } from "./claude-session.js";
import { splitMessage, isAllowed, parseUserIds, formatToolCall } from "./utils.js";

// --- Config ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const ALLOWED_USERS = parseUserIds(process.env.ALLOWED_USER_IDS || "");
const WORK_DIR = process.env.WORK_DIR || process.env.HOME || "/home";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";

// --- State ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const approvalQueue = new ApprovalQueue();

// Per-user Claude sessions
const sessions = new Map<number, ClaudeSession>();
// Track which chat each user is in (for sending approval messages)
const userChats = new Map<number, number>();
// Track busy state per user
const busyUsers = new Set<number>();

function getSession(userId: number): ClaudeSession {
  if (!sessions.has(userId)) {
    sessions.set(
      userId,
      new ClaudeSession(approvalQueue, WORK_DIR, CLAUDE_MODEL)
    );
  }
  return sessions.get(userId)!;
}

// --- Commands ---

bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  bot.sendMessage(
    msg.chat.id,
    [
      "Claude Code Telegram Bridge (v2 - Interactive)",
      "",
      "Send any message → Claude Code executes locally.",
      "When Claude needs to run commands, you'll get approval buttons.",
      "",
      "Commands:",
      "/clear - Start a new session",
      "/dir <path> - Switch working directory",
      "/pwd - Show current directory",
      "",
      "Auto-approved: Read, Glob, Grep, Search",
      "Notify only: Write, Edit (file changes)",
      "Requires approval: Bash, and other tools",
    ].join("\n")
  );
});

bot.onText(/\/clear/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  session.clearSession();
  bot.sendMessage(msg.chat.id, "Session cleared. Next message starts fresh.");
});

bot.onText(/\/dir (.+)/, (msg, match) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  session.setWorkDir(match![1].trim());
  bot.sendMessage(msg.chat.id, `Working directory: ${session.getWorkDir()}`);
});

bot.onText(/\/pwd/, (msg) => {
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;
  const session = getSession(msg.from!.id);
  bot.sendMessage(msg.chat.id, `Working directory: ${session.getWorkDir()}`);
});

// --- Handle messages → Claude ---

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAllowed(msg.from!.id, ALLOWED_USERS)) return;

  const chatId = msg.chat.id;
  const userId = msg.from!.id;
  userChats.set(userId, chatId);

  if (busyUsers.has(userId)) {
    bot.sendMessage(chatId, "Claude is still working on your previous request. Please wait.");
    return;
  }

  busyUsers.add(userId);
  const session = getSession(userId);

  // Typing indicator
  let typing = true;
  const typingInterval = setInterval(() => {
    if (typing) bot.sendChatAction(chatId, "typing");
  }, 4000);
  bot.sendChatAction(chatId, "typing");

  try {
    await session.run(msg.text, {
      onText: (text) => {
        // We'll send the final result in onDone
      },

      onApprovalNeeded: (id, toolName, input) => {
        const desc = formatToolCall(toolName, input);
        bot.sendMessage(chatId, `Permission required:\n\n${desc}`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Allow", callback_data: `approve:${id}` },
                { text: "❌ Deny", callback_data: `deny:${id}` },
              ],
            ],
          },
        });
      },

      onToolNotify: (toolName, input) => {
        const desc = formatToolCall(toolName, input);
        bot.sendMessage(chatId, `Auto-approved:\n${desc}`);
      },

      onDone: async (result, isError) => {
        typing = false;
        clearInterval(typingInterval);
        busyUsers.delete(userId);

        const prefix = isError ? "❌ Error:\n" : "";
        for (const part of splitMessage(prefix + result)) {
          await bot.sendMessage(chatId, part);
        }
      },
    });
  } catch (err: any) {
    typing = false;
    clearInterval(typingInterval);
    busyUsers.delete(userId);
    bot.sendMessage(chatId, `Error: ${err.message}`);
  }
});

// --- Handle approval button clicks ---

bot.on("callback_query", async (query) => {
  if (!query.data) return;

  const [action, ...idParts] = query.data.split(":");
  const approvalId = idParts.join(":");

  if (action === "approve" || action === "deny") {
    const allowed = action === "approve";
    const resolved = approvalQueue.resolveApproval(approvalId, allowed);

    if (resolved) {
      await bot.answerCallbackQuery(query.id, {
        text: allowed ? "Allowed" : "Denied",
      });
      // Update the message to show the decision
      if (query.message) {
        const originalText = query.message.text || "";
        const statusText = allowed ? "✅ ALLOWED" : "❌ DENIED";
        bot.editMessageText(`${originalText}\n\n→ ${statusText}`, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
        });
      }
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: "This approval has expired.",
      });
    }
  }
});

// --- Startup ---
console.log(`Bot running (v2 - Interactive Approval)`);
console.log(`Working directory: ${WORK_DIR}`);
console.log(`Model: ${CLAUDE_MODEL}`);
console.log(
  ALLOWED_USERS.size > 0
    ? `Allowed users: ${[...ALLOWED_USERS].join(", ")}`
    : "Warning: No ALLOWED_USER_IDS set, anyone can use this bot!"
);
