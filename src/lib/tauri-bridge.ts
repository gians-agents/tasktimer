import type { PersistedAppData } from "@/types/task";

const STORAGE_KEY = "tasktimer.state.v1";

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await window.__TAURI_INTERNALS__!.invoke<T>(command, args);
  } catch (error) {
    console.error(`[TaskTimer] Falha ao invocar comando Tauri "${command}":`, error);
    return null;
  }
}

export async function loadPersistedData(): Promise<PersistedAppData | null> {
  if (isTauriRuntime()) {
    const fromTauri = await invokeTauri<PersistedAppData | null>("load_tasks");
    if (fromTauri) return fromTauri;
  }

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

export async function savePersistedData(data: PersistedAppData): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("[TaskTimer] Falha ao gravar no localStorage:", error);
    }
  }

  if (isTauriRuntime()) {
    await invokeTauri("save_tasks", { payload: data });
  }
}

export async function minimizeToTray(): Promise<boolean> {
  if (isTauriRuntime()) {
    await invokeTauri("minimize_to_tray");
    return true;
  }
  return false;
}

export async function setStartMinimizedPreference(enabled: boolean): Promise<boolean> {
  if (isTauriRuntime()) {
    await invokeTauri("set_start_minimized", { enabled });
    return true;
  }
  return false;
}

export async function ensureSingleInstance(): Promise<boolean> {
  if (isTauriRuntime()) {
    const ok = await invokeTauri<boolean>("check_single_instance");
    return ok ?? true;
  }
  return true;
}

export async function sendOvertimeNotification(
  taskName: string,
  estimatedMinutes: number,
): Promise<"tauri" | "browser" | "toast-only"> {
  const title = "Tempo estimado ultrapassado";
  const body = `"${taskName}" passou de ${estimatedMinutes} min estimados.`;

  if (isTauriRuntime()) {
    await invokeTauri("send_native_notification", { title, body });
    return "tauri";
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