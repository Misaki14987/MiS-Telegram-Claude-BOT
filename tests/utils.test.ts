import { describe, it, expect } from "vitest";
import {
  splitMessage,
  isAllowed,
  parseUserIds,
  formatToolCall,
} from "../src/utils.js";

describe("splitMessage", () => {
  it("returns single element for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits at newline within limit", () => {
    const text = "line1\nline2\nline3";
    const parts = splitMessage(text, 10);
    expect(parts[0]).toBe("line1");
    expect(parts.length).toBeGreaterThan(1);
  });

  it("splits at limit when no newline found", () => {
    const text = "a".repeat(100);
    const parts = splitMessage(text, 30);
    expect(parts[0].length).toBe(30);
    expect(parts.join("")).toBe(text);
  });

  it("handles empty string", () => {
    expect(splitMessage("")).toEqual([""]);
  });
});

describe("isAllowed", () => {
  it("allows all when set is empty", () => {
    expect(isAllowed(123, new Set())).toBe(true);
  });

  it("allows user in set", () => {
    expect(isAllowed(123, new Set([123, 456]))).toBe(true);
  });

  it("denies user not in set", () => {
    expect(isAllowed(789, new Set([123, 456]))).toBe(false);
  });
});

describe("parseUserIds", () => {
  it("parses comma-separated IDs", () => {
    expect(parseUserIds("123,456,789")).toEqual(new Set([123, 456, 789]));
  });

  it("handles spaces", () => {
    expect(parseUserIds("123, 456 , 789")).toEqual(new Set([123, 456, 789]));
  });

  it("ignores invalid values", () => {
    expect(parseUserIds("123,abc,456")).toEqual(new Set([123, 456]));
  });

  it("returns empty set for empty string", () => {
    expect(parseUserIds("")).toEqual(new Set());
  });
});

describe("formatToolCall", () => {
  it("formats Bash with command", () => {
    const result = formatToolCall("Bash", { command: "echo hello" });
    expect(result).toContain("Bash");
    expect(result).toContain("$ echo hello");
  });

  it("formats Write with file path", () => {
    const result = formatToolCall("Write", {
      file_path: "/tmp/test.txt",
      content: "hi",
    });
    expect(result).toContain("Write");
    expect(result).toContain("/tmp/test.txt");
  });

  it("formats unknown tool with key summary", () => {
    const result = formatToolCall("CustomTool", { foo: "bar", baz: 42 });
    expect(result).toContain("CustomTool");
    expect(result).toContain("foo: bar");
  });
});
