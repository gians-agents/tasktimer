export type TaskStatus = "active" | "completed" | "canceled";

export type ProgressTone = "safe" | "warning" | "overtime";

export interface Task {
  id: string;
  name: string;
  estimatedMinutes: number;
  elapsedSeconds: number;
  status: TaskStatus;
  isRunning: boolean;
  lastStartedAt: number | null;
  overtimeNotified: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface AppSettings {
  startMinimized: boolean;
}

export interface PersistedAppData {
  version: 1;
  tasks: Task[];
  settings: AppSettings;
}

export interface TaskDraft {
  name: string;
  estimatedMinutes: number;
}