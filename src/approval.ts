export interface PendingApproval {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;

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

  resolveApproval(id: string, allowed: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(allowed);
    return true;
  }

  get size(): number {
    return this.pending.size;
  }

  denyAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
