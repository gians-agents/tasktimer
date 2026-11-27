import { describe, expect, it } from "vitest";

import {
  findNewlyOvertimeTasks,
  formatDecimalHours,
  formatDuration,
  getLiveElapsedSeconds,
  getProgressPercent,
  getProgressTone,
  assertImportPayloadSize,
  MAX_DATA_BYTES,
  parseImportedJson,
  validateTaskDraft,
} from "@/lib/time-utils";
import type { Task } from "@/types/task";

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
describe("overtime detection after a delayed tick", () => {
  const base: Task = {
    id: "t-1",
    name: "Revisar PR",
    estimatedMinutes: 1,
    elapsedSeconds: 10,
    status: "active",
    isRunning: true,
    lastStartedAt: 1_000_000,
    overtimeNotified: false,
    createdAt: "2026-11-26T10:00:00.000Z",
    finishedAt: null,
  };

  it("uses lastStartedAt so a long pause still counts as overtime", () => {
    // 10s already elapsed + 80s wall-clock since lastStartedAt = 90s >= 60s estimate.
    const now = 1_000_000 + 80_000;
    expect(getLiveElapsedSeconds(base, now)).toBe(90);
    const { tasks, newlyOvertime } = findNewlyOvertimeTasks([base], now);
    expect(newlyOvertime).toHaveLength(1);
    expect(newlyOvertime[0]?.id).toBe("t-1");
    expect(tasks[0]?.overtimeNotified).toBe(true);
  });

  it("does not notify a task that is paused or already flagged", () => {
    const paused = { ...base, isRunning: false, lastStartedAt: null };
    const already = { ...base, overtimeNotified: true };
    expect(findNewlyOvertimeTasks([paused, already], 1_000_000 + 80_000).newlyOvertime).toEqual([]);
  });
});

describe("import payload size limit", () => {
  it("accepts payloads at the limit and rejects anything larger", () => {
    expect(() => assertImportPayloadSize(MAX_DATA_BYTES)).not.toThrow();
    expect(() => assertImportPayloadSize(MAX_DATA_BYTES + 1)).toThrow(/excede o limite/);
  });
});
