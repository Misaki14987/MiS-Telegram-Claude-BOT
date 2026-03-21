/**
 * X Monitor Plugin
 *
 * 监控 X (Twitter) 用户 @_kuroki_honoka 的新推文，
 * 发现更新时通过 Telegram 推送通知。
 *
 * 所需环境变量：
 *   X_BEARER_TOKEN    — X API v2 Bearer Token（必需）
 *   NOTIFY_CHAT_ID    — 接收通知的 Telegram Chat ID（必需）
 *   X_POLL_INTERVAL_MS — 轮询间隔，毫秒（可选，默认 900000 = 15 分钟）
 *
 * 提供的命令：
 *   /xcheck  — 手动触发一次检查
 *   /xstatus — 显示监控状态
 */

import type { Plugin } from "../src/plugin.js";

// ── 配置 ──────────────────────────────────────────────────────────────────────
const USERNAME = "_kuroki_honoka";
const BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const NOTIFY_CHAT_ID = process.env.NOTIFY_CHAT_ID;
const POLL_INTERVAL = parseInt(process.env.X_POLL_INTERVAL_MS || "900000", 10); // 默认 15 分钟

// ── 状态 ──────────────────────────────────────────────────────────────────────
let userId: string | null = null;
let lastTweetId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollTime: Date | null = null;
let lastPollError: string | null = null;
let totalNotified = 0;

// ── X API 工具函数 ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function xGet(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** 获取用户 ID（缓存） */
async function resolveUserId(): Promise<string> {
  if (userId) return userId;
  const data = await xGet(
    `https://api.twitter.com/2/users/by/username/${USERNAME}?user.fields=name`
  );
  if (!data.data) throw new Error("User not found");
  userId = data.data.id;
  return userId!;
}

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
}

/**
 * 拉取最新推文。
 * 若提供 sinceId，只返回比该 ID 更新的推文（不含转推和回复）。
 */
async function fetchNewTweets(sinceId: string | null): Promise<Tweet[]> {
  const uid = await resolveUserId();
  let url =
    `https://api.twitter.com/2/users/${uid}/tweets` +
    `?max_results=10&tweet.fields=created_at,text&exclude=retweets,replies`;
  if (sinceId) url += `&since_id=${sinceId}`;

  const data = await xGet(url);
  return (data.data as Tweet[]) || [];
}

// ── 推文格式化 ────────────────────────────────────────────────────────────────

function formatTweet(tweet: Tweet): string {
  const link = `https://x.com/${USERNAME}/status/${tweet.id}`;
  return (
    `🐦 <b>@${USERNAME} 发布了新推文</b>\n\n` +
    `${escapeHtml(tweet.text)}\n\n` +
    `<a href="${link}">🔗 查看原推</a>`
  );
}

// ── 轮询核心逻辑 ──────────────────────────────────────────────────────────────

async function poll(ctx: { bot: any }): Promise<Tweet[]> {
  lastPollTime = new Date();
  const tweets = await fetchNewTweets(lastTweetId);

  if (tweets.length === 0) return [];

  // X API 返回时间倒序；倒转后按时间正序发送
  const ordered = [...tweets].reverse();

  for (const tweet of ordered) {
    await ctx.bot.sendMessage(NOTIFY_CHAT_ID!, formatTweet(tweet), {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
    totalNotified++;
  }

  // 记录最新的推文 ID（列表第一条，即最新）
  lastTweetId = tweets[0].id;
  return ordered;
}

// ── Plugin 定义 ───────────────────────────────────────────────────────────────

const plugin: Plugin = {
  name: "X Monitor",
  description: `监控 @${USERNAME} 的新推文并推送 Telegram 通知`,

  commands: [
    {
      command: "xcheck",
      description: `立即检查 @${USERNAME} 是否有新推文`,
      handler: async (msg, _match, ctx) => {
        if (!BEARER_TOKEN) {
          ctx.bot.sendMessage(msg.chat.id, "❌ 未配置 <code>X_BEARER_TOKEN</code>，插件未激活。", ctx.parseMode);
          return;
        }
        ctx.bot.sendMessage(msg.chat.id, "🔍 正在检查新推文…", ctx.parseMode);
        try {
          const tweets = await poll(ctx);
          lastPollError = null;
          if (tweets.length === 0) {
            ctx.bot.sendMessage(
              msg.chat.id,
              `✅ <b>@${USERNAME}</b> 暂无新推文。`,
              ctx.parseMode
            );
          } else {
            ctx.bot.sendMessage(
              msg.chat.id,
              `✅ 已发送 ${tweets.length} 条新推文。`,
              ctx.parseMode
            );
          }
        } catch (err: any) {
          lastPollError = err.message;
          ctx.bot.sendMessage(
            msg.chat.id,
            `❌ 检查失败：<code>${escapeHtml(err.message)}</code>`,
            ctx.parseMode
          );
        }
      },
    },

    {
      command: "xstatus",
      description: "查看 X Monitor 插件状态",
      handler: (msg, _match, ctx) => {
        const lines: string[] = [
          `<b>X Monitor 状态</b>`,
          ``,
          `👤 监控账号：<b>@${USERNAME}</b>`,
          `🔑 API Token：${BEARER_TOKEN ? "✅ 已配置" : "❌ 未配置"}`,
          `📢 通知频道：${NOTIFY_CHAT_ID ? `<code>${NOTIFY_CHAT_ID}</code>` : "❌ 未配置"}`,
          `⏱ 轮询间隔：${Math.round(POLL_INTERVAL / 60000)} 分钟`,
          `🕐 上次检查：${lastPollTime ? lastPollTime.toLocaleString("zh-CN") : "尚未检查"}`,
          `📌 最新推文 ID：${lastTweetId ? `<code>${lastTweetId}</code>` : "未知"}`,
          `📊 本次运行共通知：${totalNotified} 条推文`,
        ];
        if (lastPollError) {
          lines.push(`⚠️ 上次错误：<code>${escapeHtml(lastPollError)}</code>`);
        }
        ctx.bot.sendMessage(msg.chat.id, lines.join("\n"), ctx.parseMode);
      },
    },
  ],

  onLoad: async (ctx) => {
    // 前置检查
    if (!BEARER_TOKEN) {
      console.log(`  X Monitor: ⚠️  缺少 X_BEARER_TOKEN，插件已跳过`);
      return;
    }
    if (!NOTIFY_CHAT_ID) {
      console.log(`  X Monitor: ⚠️  缺少 NOTIFY_CHAT_ID，插件已跳过`);
      return;
    }

    // 初始化：拉取最新推文 ID，不发通知（避免重复推送历史内容）
    try {
      const uid = await resolveUserId();
      console.log(`  X Monitor: 用户 @${USERNAME} 的 ID = ${uid}`);

      const latest = await fetchNewTweets(null);
      if (latest.length > 0) {
        lastTweetId = latest[0].id;
        console.log(`  X Monitor: 基线推文 ID = ${lastTweetId}`);
      } else {
        console.log(`  X Monitor: 该账号暂无可见推文`);
      }
    } catch (err: any) {
      console.error(`  X Monitor: 初始化失败 — ${err.message}`);
      lastPollError = err.message;
    }

    // 启动定时轮询
    pollTimer = setInterval(async () => {
      try {
        await poll(ctx);
        lastPollError = null;
      } catch (err: any) {
        lastPollError = err.message;
        console.error(`  X Monitor: 轮询失败 — ${err.message}`);
      }
    }, POLL_INTERVAL);

    console.log(
      `  X Monitor: ✅ 已启动，每 ${Math.round(POLL_INTERVAL / 60000)} 分钟检查 @${USERNAME} 的新推文`
    );

    // 优雅退出时清理 timer
    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  },
};

export default plugin;
