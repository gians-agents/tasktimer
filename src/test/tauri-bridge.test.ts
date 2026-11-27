import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauri = vi.fn(() => false);
const invoke = vi.fn();
const isPermissionGranted = vi.fn(async () => false);
const requestPermission = vi.fn(async () => "denied" as const);

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauri(),
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
}));

import {
  STORAGE_KEY,
  getAppInfo,
  loadPersistedData,
  minimizeToTray,
  savePersistedData,
  ensureSingleInstance,
  requestNotificationPermission,
  sendOvertimeNotification,
  setStartMinimizedPreference,
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
    expect(await loadPersistedData()).toEqual({ status: "empty" });
    await savePersistedData(sample);
    expect(invoke).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.tasks[0].name).toBe("Revisar PR");
    expect(await loadPersistedData()).toEqual({ status: "ready", data: sample });
  });

  it("returns null for malformed localStorage JSON", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(await loadPersistedData()).toEqual({ status: "empty" });
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

    expect(await loadPersistedData()).toEqual({ status: "ready", data: sample });
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

    expect(await loadPersistedData()).toEqual({ status: "ready", data: sample });
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

  it("does not migrate localStorage or report empty when Tauri load fails", async () => {
    isTauri.mockReturnValue(true);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sample));
    invoke.mockRejectedValue(new Error("JSON inválido: linha 1"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await loadPersistedData()).toEqual({
      status: "error",
      message: "JSON inválido: linha 1",
    });
    expect(invoke).toHaveBeenCalledWith("load_app_data");
    expect(invoke).not.toHaveBeenCalledWith("save_app_data", expect.anything());

    spy.mockRestore();
  });
});

describe("tray and start-minimized stubs", () => {
  beforeEach(() => {
    isTauri.mockReturnValue(false);
    invoke.mockReset();
  });

  it("minimizeToTray returns false in the browser without calling invoke", async () => {
    expect(await minimizeToTray()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("minimizeToTray invokes the hide command inside Tauri and returns true", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
    expect(await minimizeToTray()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("minimize_to_tray");
  });

  it("minimizeToTray returns false if the Tauri command fails", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("no window"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await minimizeToTray()).toBe(false);
    spy.mockRestore();
  });

  it("setStartMinimizedPreference returns false in the browser (settings still persist in localStorage)", async () => {
    expect(await setStartMinimizedPreference(true)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("setStartMinimizedPreference returns true inside Tauri without a separate command", async () => {
    isTauri.mockReturnValue(true);
    expect(await setStartMinimizedPreference(true)).toBe(true);
    expect(await setStartMinimizedPreference(false)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("single-instance stub", () => {
  beforeEach(() => {
    isTauri.mockReturnValue(false);
    invoke.mockReset();
  });

  it("is a no-op that returns true in the browser without calling invoke", async () => {
    expect(await ensureSingleInstance()).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is a no-op that returns true inside Tauri (enforced on the Rust side)", async () => {
    isTauri.mockReturnValue(true);
    expect(await ensureSingleInstance()).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("native overtime notifications", () => {
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    isTauri.mockReturnValue(false);
    invoke.mockReset();
    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
  });

  afterEach(() => {
    if (originalNotification) {
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it("uses the browser Notification API when permission is already granted", async () => {
    const ctor = vi.fn();
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: Object.assign(ctor, { permission: "granted", requestPermission: vi.fn() }),
    });
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("browser");
    expect(ctor).toHaveBeenCalledWith("Tempo estimado ultrapassado", {
      body: '"Revisar PR" passou de 45 min estimados.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to toast-only when the browser permission is denied", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), { permission: "denied", requestPermission: vi.fn() }),
    });
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("toast-only");
  });

  it("requests plugin permission and invokes notify_overtime inside Tauri", async () => {
    isTauri.mockReturnValue(true);
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    invoke.mockResolvedValue(true);
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("tauri");
    expect(requestPermission).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("notify_overtime", {
      taskId: "t-1",
      taskName: "Revisar PR",
      estimatedMinutes: 45,
    });
  });

  it("returns already when the Rust side has already notified this crossing", async () => {
    isTauri.mockReturnValue(true);
    isPermissionGranted.mockResolvedValue(true);
    invoke.mockResolvedValue(false);
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("already");
  });

  it("falls back to toast-only if Tauri permission is denied", async () => {
    isTauri.mockReturnValue(true);
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("toast-only");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to toast-only if the Tauri command fails", async () => {
    isTauri.mockReturnValue(true);
    isPermissionGranted.mockResolvedValue(true);
    invoke.mockRejectedValue(new Error("plugin missing"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendOvertimeNotification("Revisar PR", 45, "t-1")).toBe("toast-only");
    spy.mockRestore();
  });

  it("requestNotificationPermission returns true when the plugin already granted it", async () => {
    isTauri.mockReturnValue(true);
    isPermissionGranted.mockResolvedValue(true);
    expect(await requestNotificationPermission()).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
