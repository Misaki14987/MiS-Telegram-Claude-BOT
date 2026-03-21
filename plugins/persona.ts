/**
 * Persona Plugin
 *
 * 为每个用户的 Claude 会话注入自定义 system prompt，
 * 让回复风格更像真人。Persona 在会话期间持久保留（/clear 不会清除）。
 *
 * 命令：
 *   /persona          — 查看当前 persona
 *   /persona set <文本> — 设置自定义 persona
 *   /persona clear    — 清除 persona（恢复默认）
 *   /persona preset   — 选择内置预设
 */

import type { Plugin } from "../src/plugin.js";
import { escapeHtml } from "../src/utils.js";

// ── 内置预设 ──────────────────────────────────────────────────────────────────

const PRESETS: Record<string, { label: string; prompt: string }> = {
  human: {
    label: "随性朋友",
    prompt: `你是一个随性、真实的朋友在聊天，不是 AI 助手。
回复规则：
- 语气自然口语化，可以用"哈哈""嗯""啊"等语气词
- 回复简短，一般不超过三四句话，除非对方明确要深入探讨
- 不用 Markdown，不用加粗，不用列表，就是普通聊天
- 不要总结，不要"希望这对你有帮助"之类的客套话
- 遇到不懂的直接说"不清楚"，不要强行给答案`,
  },
  casual_en: {
    label: "Casual English",
    prompt: `You're a chill friend chatting over text, not an AI assistant.
Rules:
- Keep replies short and conversational, 1-3 sentences unless they ask for more
- No markdown, no bullet points, just plain text
- Use casual language, contractions, occasional filler words (like, honestly, yeah)
- Skip the "I hope this helps!" closings
- If you don't know something, just say so`,
  },
  concise: {
    label: "极简模式",
    prompt: `回复要极度简洁。
- 能一句话说清楚就不说两句
- 不用任何格式（不加粗、不用列表、不用标题）
- 直接给结论，省略推导过程，除非对方问为什么
- 绝不说废话，比如"当然！""很好的问题！"这类开头`,
  },
  expert: {
    label: "专业顾问",
    prompt: `以专业顾问的口吻回复，但保持亲切感。
- 给出明确的建议和判断，而不是罗列所有可能性
- 如有必要可以适当使用格式，但避免过度结构化
- 用第一人称直接给意见："我建议……""我的看法是……"
- 适当表达个人立场，不要总是"这取决于情况"`,
  },
};

// ── Plugin ────────────────────────────────────────────────────────────────────

const plugin: Plugin = {
  name: "Persona",
  description: "为 Claude 设置回复风格 persona，让对话更像真人",

  commands: [
    {
      command: "persona",
      description: "管理回复 persona（查看/设置/清除/预设）",
      handler: (msg, match, ctx) => {
        const userId = msg.from!.id;
        const session = ctx.getSession(userId);
        const arg = msg.text?.replace(/^\/persona\s*/, "").trim() ?? "";

        // /persona — 查看当前
        if (!arg) {
          if (!session.systemPrompt) {
            ctx.bot.sendMessage(
              msg.chat.id,
              `🎭 <b>当前 Persona</b>：未设置（默认 Claude 行为）\n\n` +
              `用法：\n` +
              `  /persona set &lt;文本&gt; — 自定义\n` +
              `  /persona preset — 选择内置预设\n` +
              `  /persona clear — 清除`,
              ctx.parseMode
            );
          } else {
            ctx.bot.sendMessage(
              msg.chat.id,
              `🎭 <b>当前 Persona：</b>\n\n<code>${escapeHtml(session.systemPrompt)}</code>`,
              ctx.parseMode
            );
          }
          return;
        }

        // /persona clear
        if (arg === "clear") {
          session.systemPrompt = "";
          ctx.bot.sendMessage(msg.chat.id, "🎭 Persona 已清除，恢复默认 Claude 行为。", ctx.parseMode);
          return;
        }

        // /persona preset — 展示预设按钮
        if (arg === "preset") {
          const keyboard = Object.entries(PRESETS).map(([key, p]) => ([{
            text: p.label,
            callback_data: `persona_preset:${userId}:${key}`,
          }]));
          ctx.bot.sendMessage(
            msg.chat.id,
            "🎭 <b>选择内置 Persona 预设：</b>",
            {
              ...ctx.parseMode,
              reply_markup: { inline_keyboard: keyboard },
            }
          );
          return;
        }

        // /persona set <文本>
        if (arg.startsWith("set ")) {
          const text = arg.slice(4).trim();
          if (!text) {
            ctx.bot.sendMessage(msg.chat.id, "用法：/persona set &lt;你想要的回复风格描述&gt;", ctx.parseMode);
            return;
          }
          session.systemPrompt = text;
          ctx.bot.sendMessage(
            msg.chat.id,
            `✅ Persona 已设置：\n\n<code>${escapeHtml(text)}</code>\n\n从下一条消息开始生效。`,
            ctx.parseMode
          );
          return;
        }

        ctx.bot.sendMessage(
          msg.chat.id,
          `用法：\n  /persona — 查看当前\n  /persona set &lt;文本&gt; — 自定义\n  /persona preset — 内置预设\n  /persona clear — 清除`,
          ctx.parseMode
        );
      },
    },
  ],

  onLoad: async (ctx) => {
    // 监听预设按钮点击
    ctx.bot.on("callback_query", async (cbQuery) => {
      if (!cbQuery.data?.startsWith("persona_preset:")) return;
      const [, userIdStr, presetKey] = cbQuery.data.split(":");
      const userId = parseInt(userIdStr, 10);
      const preset = PRESETS[presetKey];
      if (!preset) {
        await ctx.bot.answerCallbackQuery(cbQuery.id, { text: "预设不存在" });
        return;
      }
      const session = ctx.getSession(userId);
      session.systemPrompt = preset.prompt;
      await ctx.bot.answerCallbackQuery(cbQuery.id, { text: `已应用：${preset.label}` });
      if (cbQuery.message) {
        ctx.bot.editMessageText(
          `✅ <b>已应用预设：${escapeHtml(preset.label)}</b>\n\n<code>${escapeHtml(preset.prompt)}</code>\n\n从下一条消息开始生效。`,
          {
            chat_id: cbQuery.message.chat.id,
            message_id: cbQuery.message.message_id,
            ...ctx.parseMode,
          }
        );
      }
    });
  },
};

export default plugin;
