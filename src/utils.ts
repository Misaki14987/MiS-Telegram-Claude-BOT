export function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      parts.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = limit;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return parts;
}

export function isAllowed(userId: number, allowedUsers: Set<number>): boolean {
  return allowedUsers.size === 0 || allowedUsers.has(userId);
}

export function parseUserIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id))
  );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mdToTelegramHtml(text: string): string {
  const codeBlocks: string[] = [];
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const i = codeBlocks.length;
    const attr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    codeBlocks.push(`<pre><code${attr}>${escapeHtml(code.trimEnd())}</code></pre>`);
    return `\x00CB${i}\x00`;
  });

  const inlineCodes: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_m, code) => {
    const i = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${i}\x00`;
  });

  result = escapeHtml(result);
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");
  result = result.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");
  result = result.replace(/\x00CB(\d+)\x00/g, (_m, i) => codeBlocks[parseInt(i)]);
  result = result.replace(/\x00IC(\d+)\x00/g, (_m, i) => inlineCodes[parseInt(i)]);

  return result;
}

export function formatToolCall(
  toolName: string,
  input: Record<string, unknown>
): string {
  let s = `🔧 <b>${escapeHtml(toolName)}</b>`;
  if (toolName === "Bash" && input.command) {
    s += `\n<code>$ ${escapeHtml(String(input.command))}</code>`;
  } else if ((toolName === "Write" || toolName === "Edit" || toolName === "Read") && input.file_path) {
    const icon = toolName === "Write" ? "📄" : toolName === "Edit" ? "✏️" : "📖";
    s += `\n${icon} <code>${escapeHtml(String(input.file_path))}</code>`;
  } else {
    const keys = Object.keys(input).slice(0, 3);
    if (keys.length > 0) {
      s += "\n" + keys.map((k) => `${escapeHtml(k)}: <code>${escapeHtml(String(input[k]).slice(0, 100))}</code>`).join("\n");
    }
  }
  return s;
}
