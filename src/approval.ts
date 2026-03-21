export interface PendingApproval {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

/**
 * ApprovalQueue bridges Claude SDK's canUseTool callback with Telegram inline buttons.
 *
 * When Claude wants to use a tool that needs approval:
 * 1. canUseTool calls requestApproval() → creates a Promise and stores it
 * 2. Telegram bot sends a message with Allow/Deny buttons (keyed by approval ID)
 * 3. User clicks a button → callback_query triggers resolveApproval()
 * 4. The Promise resolves → canUseTool returns allow/deny to Claude
 */
export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;

  /**
   * Request approval for a tool call. Returns a Promise that resolves
   * to true (allowed) or false (denied) when the user responds.
   */
  requestApproval(
    toolName: string,
    input: Record<string, unknown>
  ): { id: string; promise: Promise<boolean> } {
    const id = `approval_${++this.counter}_${Date.now()}`;
    const promise = new Promise<boolean>((resolve) => {
      this.pending.set(id, { toolName, input, resolve });
    });
    return { id, promise };
  }

  /**
   * Resolve a pending approval. Called when user clicks Allow/Deny in Telegram.
   * Returns false if the approval ID was not found (expired or already resolved).
   */
  resolveApproval(id: string, allowed: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(allowed);
    return true;
  }

  /**
   * Get a pending approval by ID (for display purposes).
   */
  getPending(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  /**
   * Number of currently pending approvals.
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Deny all pending approvals (e.g. on session clear or timeout).
   */
  denyAll(): void {
    for (const [id, entry] of this.pending) {
      entry.resolve(false);
      this.pending.delete(id);
    }
  }
}
