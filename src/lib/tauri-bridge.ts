import { invoke, isTauri } from "@tauri-apps/api/core";

import type { PersistedAppData } from "@/types/task";

export { isTauri };

/** @deprecated Prefer `isTauri()` from `@tauri-apps/api/core`. */
export const isTauriRuntime = isTauri;

export const STORAGE_KEY = "tasktimer.state.v1";

export interface AppInfo {
  name: string;
  version: string;
}

export type LoadPersistedResult =
  | { status: "ready"; data: PersistedAppData }
  | { status: "empty" }
  | { status: "error"; message: string };

function readLocalStorage(): PersistedAppData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAppData;
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalStorage(data: PersistedAppData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("[TaskTimer] Falha ao gravar no localStorage:", error);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function getAppInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AppInfo>("get_app_info");
  } catch (error) {
    console.error('[TaskTimer] Falha ao invocar comando Tauri "get_app_info":', error);
    return null;
  }
}

export async function loadPersistedData(): Promise<LoadPersistedResult> {
  if (isTauri()) {
    try {
      const fromTauri = await invoke<PersistedAppData | null>("load_app_data");
      if (fromTauri == null) {
        // File is genuinely absent — migrate a leftover browser snapshot if any.
      } else if (Array.isArray(fromTauri.tasks)) {
        return { status: "ready", data: fromTauri };
      } else {
        return {
          status: "error",
          message: "O arquivo de dados do app está em um formato inesperado.",
        };
      }
    } catch (error) {
      console.error('[TaskTimer] Falha ao invocar comando Tauri "load_app_data":', error);
      return { status: "error", message: errorMessage(error) };
    }

    const fromWeb = readLocalStorage();
    if (fromWeb) {
      try {
        await invoke("save_app_data", { payload: fromWeb });
      } catch (error) {
        console.error("[TaskTimer] Falha ao migrar localStorage para o backend Tauri:", error);
      }
      return { status: "ready", data: fromWeb };
    }

    return { status: "empty" };
  }

  const fromWeb = readLocalStorage();
  return fromWeb ? { status: "ready", data: fromWeb } : { status: "empty" };
}

export async function savePersistedData(data: PersistedAppData): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("save_app_data", { payload: data });
      return;
    } catch (error) {
      console.error('[TaskTimer] Falha ao invocar comando Tauri "save_app_data":', error);
      writeLocalStorage(data);
      return;
    }
  }

  writeLocalStorage(data);
}

// --- Tray, single-instance and native notifications. ---

export async function minimizeToTray(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("minimize_to_tray");
  } catch (error) {
    console.error('[TaskTimer] Falha ao invocar comando Tauri "minimize_to_tray":', error);
    return false;
  }
}

export async function setStartMinimizedPreference(_enabled: boolean): Promise<boolean> {
  // Already persisted on settings.startMinimized via savePersistedData / save_app_data.
  // The Rust side reads that same file on the next launch.
  return isTauri();
}

/**
 * Single-instance is enforced in Rust by `tauri-plugin-single-instance`
 * before the webview starts. A second process exits immediately after
 * asking the first one to show, unminimize and focus the window (even
 * if it was hidden in the tray or started minimized).
 *
 * This frontend helper is a documented no-op: if this JS is running,
 * we are already the surviving instance (or a browser tab).
 */
export async function ensureSingleInstance(): Promise<boolean> {
  return true;
}

export type OvertimeNotificationChannel = "tauri" | "browser" | "toast-only" | "already";

/**
 * Asks for notification permission (no-op grant on desktop Tauri; a prompt
 * in the browser or on mobile). Returns whether we may show a system notification.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } =
        await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch (error) {
      console.error("[TaskTimer] Falha ao verificar permissão de notificação:", error);
      return false;
    }
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const permission = await Notification.requestPermission().catch(() => "denied");
    return permission === "granted";
  }

  return false;
}

/**
 * Shows the overtime alert. In Tauri this goes through `notify_overtime`
 * (task id only; the Rust side looks up name and estimate, then dedupes
 * per crossing). The browser keeps the Notification API. If permission is
 * denied or the plugin is unavailable, the caller should fall back to a toast.
 */
export async function sendOvertimeNotification(
  taskName: string,
  estimatedMinutes: number,
  taskId?: string,
): Promise<OvertimeNotificationChannel> {
  const title = "Tempo estimado ultrapassado";
  const body = `"${taskName}" passou de ${estimatedMinutes} min estimados.`;

  if (isTauri()) {
    try {
      if (!(await requestNotificationPermission())) return "toast-only";
      const sent = await invoke<boolean>("notify_overtime", {
        taskId: taskId ?? "",
      });
      return sent ? "tauri" : "already";
    } catch (error) {
      console.error('[TaskTimer] Falha ao invocar comando Tauri "notify_overtime":', error);
      return "toast-only";
    }
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return "browser";
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission().catch(() => "denied");
      if (permission === "granted") {
        new Notification(title, { body });
        return "browser";
      }
    }
  }

  return "toast-only";
}

export type SaveExportResult =
  | { status: "cancelled" }
  | { status: "saved"; path: string }
  | { status: "browser" };

/** Default Save-As filename, using the local calendar date. */
export function defaultExportFileName(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `tasktimer-${year}-${month}-${day}.json`;
}

function downloadJsonInBrowser(contents: string, fileName: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * In Tauri, opens the native Save dialog and writes the JSON via a Rust command
 * (no broad filesystem plugin scope). In the browser, triggers an anchor download.
 * `cancelled` means the user closed the dialog; write failures are thrown.
 */
export async function saveExportedJson(
  contents: string,
  defaultFileName: string,
): Promise<SaveExportResult> {
  if (isTauri()) {
    try {
      const path = await invoke<string | null>("export_json", {
        contents,
        defaultFileName,
      });
      if (path === null) return { status: "cancelled" };
      return { status: "saved", path };
    } catch (error) {
      console.error('[TaskTimer] Falha ao invocar comando Tauri "export_json":', error);
      throw error;
    }
  }

  downloadJsonInBrowser(contents, defaultFileName);
  return { status: "browser" };
}

/**
 * In Tauri, opens the native Open dialog and returns the file text.
 * Returns `null` when the user cancels, or when not running inside Tauri
 * (the browser still uses a hidden file input).
 */
export async function pickImportedJson(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("import_json");
  } catch (error) {
    console.error('[TaskTimer] Falha ao invocar comando Tauri "import_json":', error);
    throw error;
  }
}
