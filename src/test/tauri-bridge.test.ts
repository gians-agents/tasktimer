import { beforeEach, describe, expect, it, vi } from "vitest";

const isTauri = vi.fn(() => false);
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauri(),
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  STORAGE_KEY,
  getAppInfo,
  loadPersistedData,
  savePersistedData,
  type AppInfo,
} from "@/lib/tauri-bridge";
import type { PersistedAppData } from "@/types/task";

const sample: PersistedAppData = {
  version: 1,
  settings: { startMinimized: false },
  tasks: [
    {
      id: "t-1",
      name: "Revisar PR",
      estimatedMinutes: 45,
      elapsedSeconds: 120,
      status: "active",
      isRunning: false,
      lastStartedAt: null,
      overtimeNotified: false,
      createdAt: "2026-11-26T10:00:00.000Z",
      finishedAt: null,
    },
  ],
};

describe("Tauri persistence adapter", () => {
  beforeEach(() => {
    isTauri.mockReturnValue(false);
    invoke.mockReset();
    window.localStorage.clear();
  });

  it("reads and writes localStorage when not running inside Tauri", async () => {
    expect(await loadPersistedData()).toBeNull();
    await savePersistedData(sample);
    expect(invoke).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.tasks[0].name).toBe("Revisar PR");
    expect(await loadPersistedData()).toEqual(sample);
  });

  it("returns null for malformed localStorage JSON", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(await loadPersistedData()).toBeNull();
  });

  it("uses invoke for get_app_info, load_app_data and save_app_data inside Tauri", async () => {
    isTauri.mockReturnValue(true);
    const info: AppInfo = { name: "TaskTimer", version: "0.1.0" };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_info") return info;
      if (cmd === "load_app_data") return sample;
      if (cmd === "save_app_data") return undefined;
      throw new Error(`unexpected command ${cmd}`);
    });

    expect(await getAppInfo()).toEqual(info);
    expect(invoke).toHaveBeenCalledWith("get_app_info");

    expect(await loadPersistedData()).toEqual(sample);
    expect(invoke).toHaveBeenCalledWith("load_app_data");

    await savePersistedData(sample);
    expect(invoke).toHaveBeenCalledWith("save_app_data", { payload: sample });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("migrates localStorage into the Tauri backend when the data file is empty", async () => {
    isTauri.mockReturnValue(true);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sample));
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_app_data") return null;
      if (cmd === "save_app_data") return undefined;
      throw new Error(`unexpected command ${cmd}`);
    });

    expect(await loadPersistedData()).toEqual(sample);
    expect(invoke).toHaveBeenCalledWith("save_app_data", { payload: sample });
  });

  it("falls back to localStorage if a Tauri save fails", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("disk full"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await savePersistedData(sample);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(sample);
    spy.mockRestore();
  });

  it("getAppInfo returns null in the browser without calling invoke", async () => {
    expect(await getAppInfo()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
