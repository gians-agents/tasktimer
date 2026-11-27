import type { PersistedAppData, ProgressTone, Task } from "@/types/task";

/** Must stay in sync with `MAX_DATA_BYTES` in `src-tauri/src/storage.rs`. */
export const MAX_DATA_BYTES = 5 * 1024 * 1024;

export function assertImportPayloadSize(byteLength: number): void {
  if (byteLength > MAX_DATA_BYTES) {
    throw new Error(`arquivo de importação excede o limite de ${MAX_DATA_BYTES} bytes`);
  }
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, "0")).join(":");
}

export function formatDecimalHours(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const rounded = Math.round((safe / 3600) * 10) / 10;
  if (rounded === 0) return "0";
  return Number(rounded.toFixed(1)).toString();
}

export function getProgressPercent(elapsedSeconds: number, estimatedMinutes: number): number {
  if (estimatedMinutes <= 0) return 0;
  const estimatedSeconds = estimatedMinutes * 60;
  return Math.max(0, Math.round((elapsedSeconds / estimatedSeconds) * 100));
}

export function getProgressTone(percent: number): ProgressTone {
  if (percent >= 100) return "overtime";
  if (percent >= 75) return "warning";
  return "safe";
}

export function getLiveElapsedSeconds(task: Task, nowMs: number): number {
  if (!task.isRunning || task.lastStartedAt === null) {
    return task.elapsedSeconds;
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - task.lastStartedAt) / 1000));
  return task.elapsedSeconds + deltaSeconds;
}

/** Detects overtime from wall-clock elapsed time, even if JS timers were throttled. */
export function findNewlyOvertimeTasks(
  tasks: Task[],
  nowMs: number,
): { tasks: Task[]; newlyOvertime: Task[] } {
  const newlyOvertime: Task[] = [];
  const next = tasks.map((task) => {
    if (!task.isRunning || task.overtimeNotified) return task;
    if (getLiveElapsedSeconds(task, nowMs) >= task.estimatedMinutes * 60) {
      newlyOvertime.push(task);
      return { ...task, overtimeNotified: true };
    }
    return task;
  });
  return { tasks: next, newlyOvertime };
}

export function validateTaskDraft(name: string, minutesRaw: string): string | null {
  if (name.trim().length === 0) {
    return "Informe o nome da tarefa.";
  }
  if (name.trim().length > 120) {
    return "O nome da tarefa deve ter no máximo 120 caracteres.";
  }
  const parsed = Number(minutesRaw);
  if (!Number.isFinite(parsed) || minutesRaw.trim() === "") {
    return "Informe um tempo estimado válido em minutos.";
  }
  if (parsed <= 0) {
    return "O tempo estimado deve ser maior que zero.";
  }
  if (parsed > 1440) {
    return "O tempo estimado máximo é de 1440 minutos (24 horas).";
  }
  return null;
}

function isValidTask(item: unknown): item is Task {
  if (typeof item !== "object" || item === null) return false;
  const record = item as Record<string, unknown>;
  const status = record["status"];
  return (
    typeof record["id"] === "string" &&
    record["id"].trim().length > 0 &&
    typeof record["name"] === "string" &&
    record["name"].trim().length > 0 &&
    typeof record["estimatedMinutes"] === "number" &&
    Number.isFinite(record["estimatedMinutes"]) &&
    record["estimatedMinutes"] > 0 &&
    typeof record["elapsedSeconds"] === "number" &&
    Number.isFinite(record["elapsedSeconds"]) &&
    record["elapsedSeconds"] >= 0 &&
    (status === "active" || status === "completed" || status === "canceled")
  );
}

export function parseImportedJson(rawJson: string): { tasks: Task[]; startMinimized?: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("O arquivo não contém um JSON válido.");
  }

  const rawTasks = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as Record<string, unknown>)["tasks"])
      ? ((parsed as Record<string, unknown>)["tasks"] as unknown[])
      : null;

  if (!rawTasks) {
    throw new Error(
      "Formato inválido: esperado um objeto com a lista 'tasks' ou um array de tarefas.",
    );
  }

  const validTasks: Task[] = rawTasks.filter(isValidTask).map((task) => ({
    id: task.id,
    name: task.name.trim(),
    estimatedMinutes: Math.round(task.estimatedMinutes),
    elapsedSeconds: Math.floor(task.elapsedSeconds),
    status: task.status,
    isRunning: false,
    lastStartedAt: null,
    overtimeNotified: Boolean(task.overtimeNotified),
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
    finishedAt: typeof task.finishedAt === "string" ? task.finishedAt : null,
  }));

  if (validTasks.length === 0 && rawTasks.length > 0) {
    throw new Error("Nenhuma tarefa válida encontrada no arquivo JSON.");
  }

  const settingsObj =
    typeof parsed === "object" && parsed !== null
      ? ((parsed as Record<string, unknown>)["settings"] as Record<string, unknown> | undefined)
      : undefined;

  const result: { tasks: Task[]; startMinimized?: boolean } = { tasks: validTasks };
  if (settingsObj && typeof settingsObj["startMinimized"] === "boolean") {
    result.startMinimized = settingsObj["startMinimized"];
  }
  return result;
}

export function serializeExportData(data: PersistedAppData): string {
  const cleanTasks = data.tasks.map((task) => ({
    ...task,
    isRunning: false,
    lastStartedAt: null,
  }));
  return JSON.stringify({ ...data, tasks: cleanTasks }, null, 2);
}
