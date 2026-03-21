import { query } from "@anthropic-ai/claude-agent-sdk";
import { ApprovalQueue } from "./approval.js";
import { formatToolCall } from "./utils.js";

/** Tools that are always auto-approved (read-only). */
const AUTO_ALLOW = new Set(["Read", "Glob", "Grep", "LSP", "WebSearch", "WebFetch"]);

/** Tools that are auto-approved but notify the user (file edits). */
const NOTIFY_ALLOW = new Set(["Write", "Edit", "NotebookEdit"]);

export interface SessionCallbacks {
  /** Called when Claude produces text output. */
  onText: (text: string) => void;
  /** Called when a tool needs user approval. Returns the approval ID for the Telegram button. */
  onApprovalNeeded: (
    id: string,
    toolName: string,
    input: Record<string, unknown>
  ) => void;
  /** Called when an auto-approved tool is used (for notification). */
  onToolNotify: (toolName: string, input: Record<string, unknown>) => void;
  /** Called when the session finishes. */
  onDone: (result: string, isError: boolean) => void;
}

export class ClaudeSession {
  private sessionId: string | undefined;
  private approvalQueue: ApprovalQueue;
  private workDir: string;
  private model: string;

  constructor(
    approvalQueue: ApprovalQueue,
    workDir: string,
    model = "sonnet"
  ) {
    this.approvalQueue = approvalQueue;
    this.workDir = workDir;
    this.model = model;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  clearSession(): void {
    this.sessionId = undefined;
    this.approvalQueue.denyAll();
  }

  setWorkDir(dir: string): void {
    this.workDir = dir;
  }

  getWorkDir(): string {
    return this.workDir;
  }

  async run(prompt: string, callbacks: SessionCallbacks): Promise<void> {
    const options: Record<string, unknown> = {
      model: this.model,
      permissionMode: "default" as const,
      cwd: this.workDir,
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>
      ): Promise<
        | { behavior: "allow"; updatedInput: Record<string, unknown> }
        | { behavior: "deny"; message: string }
      > => {
        // Auto-allow read-only tools
        if (AUTO_ALLOW.has(toolName)) {
          return { behavior: "allow", updatedInput: input };
        }

        // Auto-allow file edits but notify
        if (NOTIFY_ALLOW.has(toolName)) {
          callbacks.onToolNotify(toolName, input);
          return { behavior: "allow", updatedInput: input };
        }

        // Everything else needs Telegram approval
        const { id, promise } = this.approvalQueue.requestApproval(
          toolName,
          input
        );
        callbacks.onApprovalNeeded(id, toolName, input);

        const allowed = await promise;
        if (allowed) {
          return { behavior: "allow", updatedInput: input };
        } else {
          return {
            behavior: "deny",
            message: "User denied this action via Telegram.",
          };
        }
      },
    };

    // Resume existing session if available
    if (this.sessionId) {
      (options as any).resume = this.sessionId;
    }

    try {
      let resultText = "";

      for await (const message of query({
        prompt,
        options: options as any,
      })) {
        if (message.type === "system" && (message as any).subtype === "init") {
          this.sessionId = (message as any).session_id;
        }

        if (message.type === "assistant") {
          const content = (message as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if ("text" in block && block.text) {
                callbacks.onText(block.text);
                resultText = block.text;
              }
            }
          }
        }

        if (message.type === "result") {
          const result = (message as any).result || resultText || "(no output)";
          const isError = (message as any).is_error || false;
          callbacks.onDone(result, isError);
        }
      }
    } catch (err: any) {
      callbacks.onDone(`Error: ${err.message}`, true);
    }
  }
}
