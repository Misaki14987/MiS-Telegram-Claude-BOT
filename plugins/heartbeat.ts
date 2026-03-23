import type { Plugin } from "../src/plugin.js";

const plugin: Plugin = {
  name: "Heartbeat",
  description: "Bot startup/shutdown/crash notifications",
  onLoad: async (ctx) => {
    const chatId = process.env.NOTIFY_CHAT_ID;
    if (!chatId) {
      console.log("  Heartbeat: Set NOTIFY_CHAT_ID in .env to receive startup/shutdown alerts");
      return;
    }

    await ctx.bot.sendMessage(chatId, "🟢 <b>Bot started</b>", ctx.parseMode);

    const shutdown = async (signal: string) => {
      try {
        await ctx.bot.sendMessage(chatId, `🔴 <b>Bot stopping</b> (${signal})`, ctx.parseMode);
      } catch {}
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    process.on("uncaughtException", async (err) => {
      try {
        await ctx.bot.sendMessage(chatId, `💥 <b>Bot crashed</b>\n<code>${err.message}</code>`, ctx.parseMode);
      } catch {}
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason: any) => {
      try {
        await ctx.bot.sendMessage(chatId, `💥 <b>Unhandled rejection</b>\n<code>${String(reason).slice(0, 200)}</code>`, ctx.parseMode);
      } catch {}
    });
  },
};

export default plugin;
