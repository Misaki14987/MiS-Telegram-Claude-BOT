import type { Plugin } from "../src/plugin.js";

const HEARTBEAT_INTERVAL = 60_000; // 1 min

const plugin: Plugin = {
  name: "Heartbeat",
  description: "Bot startup/shutdown notifications + /status command",
  commands: [
    {
      command: "status",
      description: "Check bot uptime",
      handler: (msg, _match, ctx) => {
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = uptime % 60;
        ctx.bot.sendMessage(
          msg.chat.id,
          `✅ <b>Bot is alive</b>\nUptime: ${h}h ${m}m ${s}s`,
          ctx.parseMode
        );
      },
    },
  ],
  onLoad: async (ctx) => {
    const chatId = process.env.NOTIFY_CHAT_ID;
    if (!chatId) {
      console.log("  Heartbeat: Set NOTIFY_CHAT_ID in .env to receive startup/shutdown alerts");
      return;
    }

    await ctx.bot.sendMessage(chatId, "🟢 <b>Bot started</b>", ctx.parseMode);

    // Periodic heartbeat log (silent, for crash detection)
    const timer = setInterval(() => {}, HEARTBEAT_INTERVAL);

    // Notify on graceful shutdown
    const shutdown = async (signal: string) => {
      clearInterval(timer);
      try {
        await ctx.bot.sendMessage(chatId, `🔴 <b>Bot stopping</b> (${signal})`, ctx.parseMode);
      } catch {}
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Notify on uncaught crash
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

const startTime = Date.now();

export default plugin;
