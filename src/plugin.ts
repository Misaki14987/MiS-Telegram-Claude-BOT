import type TelegramBot from "node-telegram-bot-api";
import type { ClaudeSession } from "./claude-session.js";

export interface PluginContext {
  bot: TelegramBot;
  getSession: (userId: number) => ClaudeSession;
  parseMode: { parse_mode: "HTML" };
}

export interface PluginCommand {
  command: string;
  description: string;
  handler: (msg: TelegramBot.Message, match: RegExpExecArray | null, ctx: PluginContext) => void | Promise<void>;
}

export interface Plugin {
  name: string;
  description: string;
  commands?: PluginCommand[];
  onMessage?: (msg: TelegramBot.Message, ctx: PluginContext) => Promise<boolean | void>;
  onLoad?: (ctx: PluginContext) => void | Promise<void>;
}
