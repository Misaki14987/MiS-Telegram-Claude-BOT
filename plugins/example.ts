import type { Plugin } from "../src/plugin.js";

const plugin: Plugin = {
  name: "Example",
  description: "Demo plugin — shows how to add commands",
  commands: [
    {
      command: "ping",
      description: "Check bot is alive",
      handler: (msg, _match, ctx) => {
        ctx.bot.sendMessage(msg.chat.id, "🏓 Pong!");
      },
    },
  ],
};

export default plugin;
