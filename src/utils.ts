/**
 * Split long text into chunks that fit Telegram's 4096 char limit.
 */
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

/**
 * Check if a Telegram user ID is in the allowed set.
 * If allowedUsers is empty, all users are allowed.
 */
export function isAllowed(userId: number, allowedUsers: Set<number>): boolean {
  return allowedUsers.size === 0 || allowedUsers.has(userId);
}

/**
 * Parse comma-separated user IDs from env string.
 */
export function parseUserIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id))
  );
}

/**
 * Format a tool call for display in Telegram.
 */
export function formatToolCall(
  toolName: string,
  input: Record<string, unknown>
): string {
  let summary = `🔧 ${toolName}`;
  if (toolName === "Bash" && input.command) {
    summary += `\n$ ${input.command}`;
  } else if (toolName === "Write" && input.file_path) {
    summary += `\n📄 ${input.file_path}`;
  } else if (toolName === "Edit" && input.file_path) {
    summary += `\n✏️ ${input.file_path}`;
  } else if (toolName === "Read" && input.file_path) {
    summary += `\n📖 ${input.file_path}`;
  } else {
    const keys = Object.keys(input).slice(0, 3);
    if (keys.length > 0) {
      summary +=
        "\n" +
        keys.map((k) => `${k}: ${String(input[k]).slice(0, 100)}`).join("\n");
    }
  }
  return summary;
}
