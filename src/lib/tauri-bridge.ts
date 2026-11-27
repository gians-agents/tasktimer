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
        return { status: "error", message: "O arquivo de dados do app está em um formato inesperado." };
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

// --- Later steps (tray, single-instance, native notifications). Stubs keep the UI working. ---

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

export async function ensureSingleInstance(): Promise<boolean> {
  return true;
}

export async function sendOvertimeNotification(
  taskName: string,
  estimatedMinutes: number,
): Promise<"tauri" | "browser" | "toast-only"> {
  const title = "Tempo estimado ultrapassado";
  const body = `"${taskName}" passou de ${estimatedMinutes} min estimados.`;

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
