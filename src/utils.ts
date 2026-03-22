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

function renderMdTable(tableText: string): string {
  const lines = tableText.trim().split("\n");

  // 解析各行，跳过分隔行（只含 -、:、|、空格）
  const rows: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue; // 分隔行
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    rows.push(cells);
  }

  if (rows.length === 0) return tableText;

  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      colWidths[i] = Math.max(colWidths[i], (row[i] ?? "").length);
    }
  }

  const hline = (l: string, m: string, r: string) =>
    l + colWidths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const renderRow = (row: string[]) =>
    "│" + colWidths.map((w, i) => ` ${(row[i] ?? "").padEnd(w)} `).join("│") + "│";

  const out: string[] = [];
  out.push(hline("┌", "┬", "┐"));
  out.push(renderRow(rows[0]));
  if (rows.length > 1) {
    out.push(hline("├", "┼", "┤"));
    for (let i = 1; i < rows.length; i++) out.push(renderRow(rows[i]));
  }
  out.push(hline("└", "┴", "┘"));

  return `<pre><code>${escapeHtml(out.join("\n"))}</code></pre>`;
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

  const tables: string[] = [];
  result = result.replace(/^(?:\|.+\n)+/gm, (match) => {
    const hasSep = match.split("\n").some((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
    if (!hasSep) return match;
    const i = tables.length;
    tables.push(renderMdTable(match));
    return `\x00TB${i}\x00\n`;
  });

  const links: string[] = [];
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) => {
    const i = links.length;
    links.push(`<a href="${escapeHtml(url)}">${escapeHtml(linkText)}</a>`);
    return `\x00LK${i}\x00`;
  });

  result = escapeHtml(result);

  result = result.replace(/^### (.+)$/gm, "<b>$1</b>");
  result = result.replace(/^## (.+)$/gm, "\n<b>$1</b>");
  result = result.replace(/^# (.+)$/gm, "\n<b>$1</b>\n");

  result = result.replace(/^[ \t]*(\-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "──────────────────");

  result = result.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  result = result.replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>");
  result = result.replace(/__(.+?)__/gs, "<b>$1</b>");
  result = result.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

  result = result.replace(/\x00LK(\d+)\x00/g, (_m, i) => links[parseInt(i)]);
  result = result.replace(/\x00TB(\d+)\x00/g, (_m, i) => tables[parseInt(i)]);
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
