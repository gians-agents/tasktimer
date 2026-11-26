import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createSampleTasks } from "@/lib/sample-tasks";
import {
  ensureSingleInstance,
  getAppInfo,
  isTauri,
  loadPersistedData,
  minimizeToTray,
  savePersistedData,
  sendOvertimeNotification,
  setStartMinimizedPreference,
  type AppInfo,
} from "@/lib/tauri-bridge";
import {
  getLiveElapsedSeconds,
  parseImportedJson,
  serializeExportData,
} from "@/lib/time-utils";
import type { AppSettings, PersistedAppData, Task, TaskDraft } from "@/types/task";

const DEFAULT_SETTINGS: AppSettings = { startMinimized: false };

export function useTaskTimer() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tasksRef = useRef<Task[]>([]);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);

  tasksRef.current = tasks;
  settingsRef.current = settings;

  const persist = useCallback((nextTasks: Task[], nextSettings: AppSettings) => {
    const payload: PersistedAppData = {
      version: 1,
      tasks: nextTasks,
      settings: nextSettings,
    };
    void savePersistedData(payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureSingleInstance();
      const [saved, info] = await Promise.all([loadPersistedData(), getAppInfo()]);
      if (cancelled) return;
      if (saved) {
        setTasks(saved.tasks);
        setSettings(saved.settings ?? DEFAULT_SETTINGS);
      } else {
        setTasks(createSampleTasks());
      }
      if (info) setAppInfo(info);
      setNowMs(Date.now());
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasRunningTask = useMemo(() => tasks.some((t) => t.isRunning), [tasks]);

  useEffect(() => {
    if (!hasRunningTask) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      const newlyOvertime: Task[] = [];
      const updated = tasksRef.current.map((task) => {
        if (!task.isRunning || task.overtimeNotified) return task;
        const elapsed = getLiveElapsedSeconds(task, now);
        if (elapsed >= task.estimatedMinutes * 60) {
          newlyOvertime.push(task);
          return { ...task, overtimeNotified: true };
        }
        return task;
      });

      if (newlyOvertime.length > 0) {
        setTasks(updated);
        persist(updated, settingsRef.current);
        for (const task of newlyOvertime) {
          void sendOvertimeNotification(task.name, task.estimatedMinutes);
          toast.warning(`Tempo estimado ultrapassado`, {
            description: `"${task.name}" passou de ${task.estimatedMinutes} min.`,
          });
        }
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [hasRunningTask, persist]);

  const updateTasks = useCallback(
    (updater: (current: Task[]) => Task[]) => {
      setTasks((prev) => {
        const next = updater(prev);
        persist(next, settingsRef.current);
        return next;
      });
    },
    [persist],
  );

  const addTask = useCallback(
    (draft: TaskDraft) => {
      const newTask: Task = {
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        estimatedMinutes: Math.round(draft.estimatedMinutes),
        elapsedSeconds: 0,
        status: "active",
        isRunning: false,
        lastStartedAt: null,
        overtimeNotified: false,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      updateTasks((prev) => [newTask, ...prev]);
      toast.success("Tarefa adicionada");
    },
    [updateTasks],
  );

  const editTask = useCallback(
    (taskId: string, draft: TaskDraft) => {
      const now = Date.now();
      updateTasks((prev) =>
        prev.map((task) => {
          if (task.id !== taskId) return task;
          const currentElapsed = getLiveElapsedSeconds(task, now);
          const estimatedMinutes = Math.round(draft.estimatedMinutes);
          return {
            ...task,
            name: draft.name.trim(),
            estimatedMinutes,
            elapsedSeconds: currentElapsed,
            lastStartedAt: task.isRunning ? now : null,
            overtimeNotified: currentElapsed >= estimatedMinutes * 60,
          };
        }),
      );
      toast.success("Tarefa atualizada");
    },
    [updateTasks],
  );

  const togglePlayPause = useCallback(
    (taskId: string) => {
      const now = Date.now();
      setNowMs(now);
      if (
        !isTauri() &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission().catch(() => undefined);
      }
      updateTasks((prev) =>
        prev.map((task) => {
          if (task.id !== taskId || task.status !== "active") return task;
          if (task.isRunning) {
            return {
              ...task,
              elapsedSeconds: getLiveElapsedSeconds(task, now),
              isRunning: false,
              lastStartedAt: null,
            };
          }
          return { ...task, isRunning: true, lastStartedAt: now };
        }),
      );
    },
    [updateTasks],
  );

  const finishTask = useCallback(
    (taskId: string, status: "completed" | "canceled") => {
      const now = Date.now();
      updateTasks((prev) =>
        prev.map((task) => {
          if (task.id !== taskId) return task;
          return {
            ...task,
            elapsedSeconds: getLiveElapsedSeconds(task, now),
            status,
            isRunning: false,
            lastStartedAt: null,
            finishedAt: new Date(now).toISOString(),
          };
        }),
      );
      toast.success(status === "completed" ? "Tarefa concluída" : "Tarefa cancelada");
    },
    [updateTasks],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      updateTasks((prev) => prev.filter((task) => task.id !== taskId));
      toast("Tarefa excluída");
    },
    [updateTasks],
  );

  const toggleStartMinimized = useCallback(
    async (enabled: boolean) => {
      const nextSettings: AppSettings = { ...settingsRef.current, startMinimized: enabled };
      setSettings(nextSettings);
      persist(tasksRef.current, nextSettings);
      const handledByTauri = await setStartMinimizedPreference(enabled);
      toast(
        handledByTauri
          ? enabled
            ? "Iniciar minimizado ativado"
            : "Iniciar minimizado desativado"
          : "Preferência salva (ativa no app desktop Tauri)",
      );
    },
    [persist],
  );

  const handleMinimizeToTray = useCallback(async () => {
    const handled = await minimizeToTray();
    if (!handled) {
      toast.info("Bandeja do sistema disponível ao executar no Tauri");
    }
  }, []);

  const exportJson = useCallback(() => {
    const now = Date.now();
    const snapshotTasks = tasksRef.current.map((task) => ({
      ...task,
      elapsedSeconds: getLiveElapsedSeconds(task, now),
    }));
    const json = serializeExportData({
      version: 1,
      tasks: snapshotTasks,
      settings: settingsRef.current,
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tasktimer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Tarefas exportadas em JSON");
  }, []);

  const importJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const imported = parseImportedJson(text);
        const nextSettings: AppSettings =
          imported.startMinimized !== undefined
            ? { ...settingsRef.current, startMinimized: imported.startMinimized }
            : settingsRef.current;
        setTasks(imported.tasks);
        setSettings(nextSettings);
        persist(imported.tasks, nextSettings);
        toast.success(`${imported.tasks.length} tarefa(s) importada(s)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao importar JSON.";
        toast.error(message);
      }
    },
    [persist],
  );

  const activeTasks = useMemo(() => tasks.filter((t) => t.status === "active"), [tasks]);
  const historyTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== "active")
        .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt)),
    [tasks],
  );

  return {
    activeTasks,
    historyTasks,
    settings,
    appInfo,
    hydrated,
    nowMs,
    addTask,
    editTask,
    togglePlayPause,
    finishTask,
    deleteTask,
    toggleStartMinimized,
    handleMinimizeToTray,
    exportJson,
    importJson,
  };
}