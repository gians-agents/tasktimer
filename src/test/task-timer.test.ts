import { describe, expect, it } from "vitest";

import {
  formatDecimalHours,
  formatDuration,
  getProgressPercent,
  getProgressTone,
  parseImportedJson,
  validateTaskDraft,
} from "@/lib/time-utils";

describe("TaskTimer time & progress rules", () => {
  it("formats elapsed and estimated durations as HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(720)).toBe("00:12:00");
    expect(formatDuration(5940)).toBe("01:39:00");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("formats decimal hours cleanly without trailing .0 (e.g. 0.2, 1.5, 3)", () => {
    expect(formatDecimalHours(0)).toBe("0");
    expect(formatDecimalHours(720)).toBe("0.2");
    expect(formatDecimalHours(5400)).toBe("1.5");
    expect(formatDecimalHours(10800)).toBe("3");
  });

  it("maps progress percentage to green, yellow, and red tones", () => {
    expect(getProgressPercent(720, 60)).toBe(20);
    expect(getProgressTone(20)).toBe("safe");
    expect(getProgressTone(74)).toBe("safe");
    expect(getProgressTone(75)).toBe("warning");
    expect(getProgressTone(99)).toBe("warning");
    expect(getProgressTone(100)).toBe("overtime");
    expect(getProgressTone(120)).toBe("overtime");
  });

  it("validates empty name, non-numeric, negative, and out-of-range minutes", () => {
    expect(validateTaskDraft("   ", "30")).not.toBeNull();
    expect(validateTaskDraft("Tarefa", "")).not.toBeNull();
    expect(validateTaskDraft("Tarefa", "abc")).not.toBeNull();
    expect(validateTaskDraft("Tarefa", "0")).not.toBeNull();
    expect(validateTaskDraft("Tarefa", "-15")).not.toBeNull();
    expect(validateTaskDraft("Tarefa", "2000")).not.toBeNull();
    expect(validateTaskDraft("Tarefa válida", "45")).toBeNull();
  });

  it("parses exported JSON tasks and rejects malformed payloads", () => {
    const parsed = parseImportedJson(
      JSON.stringify({
        version: 1,
        settings: { startMinimized: true },
        tasks: [
          {
            id: "t-1",
            name: "Importada",
            estimatedMinutes: 45,
            elapsedSeconds: 900,
            status: "active",
            isRunning: true,
            lastStartedAt: 123456,
            overtimeNotified: false,
            createdAt: "2026-11-26T10:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    );

    expect(parsed.startMinimized).toBe(true);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.isRunning).toBe(false);
    expect(parsed.tasks[0]?.lastStartedAt).toBeNull();
    expect(() => parseImportedJson("not-json")).toThrow();
    expect(() => parseImportedJson(JSON.stringify({ invalid: true }))).toThrow();
  });
});