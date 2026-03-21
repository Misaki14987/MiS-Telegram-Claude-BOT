import { query } from "@anthropic-ai/claude-agent-sdk";
import { ApprovalQueue } from "./approval.js";

const AUTO_ALLOW = new Set(["Read", "Glob", "Grep", "LSP", "WebSearch", "WebFetch"]);
const NOTIFY_ALLOW = new Set(["Write", "Edit", "NotebookEdit"]);

export interface SessionCallbacks {
  onText: (text: string) => void;
  onToolUse: (toolName: string, input: Record<string, unknown>) => void;
  onApprovalNeeded: (id: string, toolName: string, input: Record<string, unknown>) => void;
  onToolNotify: (toolName: string, input: Record<string, unknown>) => void;
  onDone: (result: string, isError: boolean) => void;
}

export class ClaudeSession {
  private sessionId: string | undefined;
  private approvalQueue: ApprovalQueue;
  private workDir: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(approvalQueue: ApprovalQueue, workDir: string, model = "sonnet") {
    this.approvalQueue = approvalQueue;
    this.workDir = workDir;
    this.model = model;
  }

  get isRunning(): boolean {
    return this.abortController !== null;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.approvalQueue.denyAll();
  }

  clearSession(): void {
    this.abort();
    this.sessionId = undefined;
  }

  setWorkDir(dir: string): void { this.workDir = dir; }
  getWorkDir(): string { return this.workDir; }
  setModel(model: string): void { this.model = model; }
  getModel(): string { return this.model; }

  async run(prompt: string, cb: SessionCallbacks): Promise<void> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const claudePath = process.env.CLAUDE_PATH 

    const options: Record<string, unknown> = {
      pathToClaudeCodeExecutable: claudePath,
      model: this.model,
      permissionMode: "default",
      cwd: this.workDir,
      signal,
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>
      ) => {
        if (AUTO_ALLOW.has(toolName)) {
          return { behavior: "allow", updatedInput: input };
        }
        if (NOTIFY_ALLOW.has(toolName)) {
          cb.onToolNotify(toolName, input);
          return { behavior: "allow", updatedInput: input };
        }
        const { id, promise } = this.approvalQueue.requestApproval(toolName, input);
        cb.onApprovalNeeded(id, toolName, input);
        const allowed = await promise;
        return allowed
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "User denied this action via Telegram." };
      },
    };

    if (this.sessionId) {
      (options as any).resume = this.sessionId;
    }

    try {
      let resultText = "";
      for await (const message of query({ prompt, options: options as any })) {
        if (message.type === "system" && (message as any).subtype === "init") {
          this.sessionId = (message as any).session_id;
        }
        if (message.type === "assistant") {
          const content = (message as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if ("text" in block && block.text) {
                cb.onText(block.text);
                resultText = block.text;
              } else if ("name" in block && block.name) {
                cb.onToolUse(block.name as string, (block as any).input || {});
              }
            }
          }
        }
        if (message.type === "result") {
          cb.onDone((message as any).result || resultText || "(no output)", (message as any).is_error || false);
        }
      }
    } catch (err: any) {
      cb.onDone(signal.aborted ? "Stopped by user." : `Error: ${err.message}`, !signal.aborted);
    } finally {
      this.abortController = null;
    }
  }
}
