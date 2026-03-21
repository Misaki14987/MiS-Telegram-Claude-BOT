import { describe, it, expect } from "vitest";
import { ApprovalQueue } from "../src/approval.js";

describe("ApprovalQueue", () => {
  it("creates a pending approval and resolves it", async () => {
    const queue = new ApprovalQueue();
    const { id, promise } = queue.requestApproval("Bash", {
      command: "echo hi",
    });

    expect(id).toMatch(/^approval_/);
    expect(queue.size).toBe(1);

    queue.resolveApproval(id, true);
    const result = await promise;
    expect(result).toBe(true);
    expect(queue.size).toBe(0);
  });

  it("denies an approval", async () => {
    const queue = new ApprovalQueue();
    const { id, promise } = queue.requestApproval("Bash", {
      command: "rm -rf /",
    });

    queue.resolveApproval(id, false);
    const result = await promise;
    expect(result).toBe(false);
  });

  it("returns false for unknown approval ID", () => {
    const queue = new ApprovalQueue();
    expect(queue.resolveApproval("nonexistent", true)).toBe(false);
  });

  it("getPending returns the pending entry", () => {
    const queue = new ApprovalQueue();
    const { id } = queue.requestApproval("Write", {
      file_path: "/tmp/x",
    });

    const entry = queue.getPending(id);
    expect(entry).toBeDefined();
    expect(entry!.toolName).toBe("Write");
  });

  it("denyAll resolves all pending as false", async () => {
    const queue = new ApprovalQueue();
    const { promise: p1 } = queue.requestApproval("Bash", { command: "a" });
    const { promise: p2 } = queue.requestApproval("Bash", { command: "b" });

    expect(queue.size).toBe(2);
    queue.denyAll();
    expect(queue.size).toBe(0);

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
  });

  it("generates unique IDs", () => {
    const queue = new ApprovalQueue();
    const { id: id1 } = queue.requestApproval("Bash", { command: "a" });
    const { id: id2 } = queue.requestApproval("Bash", { command: "b" });
    expect(id1).not.toBe(id2);
  });
});
