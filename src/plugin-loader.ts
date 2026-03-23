import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import type { Plugin, PluginContext } from "./plugin.js";

const PLUGINS_DIR = resolve(process.env.PLUGINS_DIR || join(process.cwd(), "plugins"));

export async function loadPlugins(ctx: PluginContext): Promise<Plugin[]> {
  const plugins: Plugin[] = [];

  let files: string[];
  try {
    files = await readdir(PLUGINS_DIR);
  } catch {
    console.log(`  No plugins directory at ${PLUGINS_DIR}`);
    return plugins;
  }

  for (const file of files.filter((f) => f.endsWith(".ts") || f.endsWith(".js"))) {
    try {
      const fullPath = join(PLUGINS_DIR, file);
      // Use Function constructor to avoid ncc/webpack intercepting the dynamic import
      const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<any>;
      const mod = await dynamicImport(pathToFileURL(fullPath).href);
      const plugin: Plugin = mod.default || mod;
      if (!plugin.name) continue;

      if (plugin.commands) {
        for (const cmd of plugin.commands) {
          const regex = new RegExp(`^\\/${cmd.command}(?:\\s+(.+))?$`);
          ctx.bot.onText(regex, (msg, match) => cmd.handler(msg, match, ctx));
        }
      }

      if (plugin.onMessage) {
        const handler = plugin.onMessage;
        ctx.bot.on("message", async (msg) => {
          if (!msg.text || msg.text.startsWith("/")) return;
          await handler(msg, ctx);
        });
      }

      if (plugin.onLoad) {
        await plugin.onLoad(ctx);
      }

      plugins.push(plugin);
      console.log(`  Plugin loaded: ${plugin.name}`);
    } catch (err: any) {
      console.error(`  Plugin failed: ${file} - ${err.message}`);
    }
  }

  return plugins;
}
