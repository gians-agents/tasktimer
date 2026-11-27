import { Check, Pause, Pencil, Play, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatDecimalHours,
  formatDuration,
  getLiveElapsedSeconds,
  getProgressPercent,
  getProgressTone,
} from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import type { ProgressTone, Task } from "@/types/task";

interface TaskCardProps {
  task: Task;
  nowMs: number;
  onTogglePlay: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onComplete: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

const BAR_TONE_CLASS: Record<ProgressTone, string> = {
  safe: "bg-progress-safe",
  warning: "bg-progress-warning",
  overtime: "bg-progress-overtime",
};

const PERCENT_TONE_CLASS: Record<ProgressTone, string> = {
  safe: "text-muted-foreground",
  warning: "text-progress-warning",
  overtime: "text-progress-overtime",
};

export function TaskCard({
  task,
  nowMs,
  onTogglePlay,
  onEdit,
  onComplete,
  onCancel,
  onDelete,
}: TaskCardProps) {
  const elapsedSeconds = getLiveElapsedSeconds(task, nowMs);
  const estimatedSeconds = task.estimatedMinutes * 60;
  const percent = getProgressPercent(elapsedSeconds, task.estimatedMinutes);
  const clampedWidth = Math.min(percent, 100);
  const tone = getProgressTone(percent);
  const decimalHours = formatDecimalHours(elapsedSeconds);

  return (
    <article
      className={cn(
        "task-card rounded-2xl border border-border bg-card p-5 sm:p-6",
        task.isRunning && "task-card-running",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {task.isRunning && (
            <span
              className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-primary"
              aria-label="Em andamento"
            />
          )}
          <h2 className="truncate text-base font-semibold tracking-tight text-card-foreground sm:text-lg">
            {task.name}
          </h2>
        </div>

        <div className="shrink-0 text-right">
          <p className="timer-digits text-lg font-medium tracking-tight sm:text-xl">
            <span className={tone === "overtime" ? "text-progress-overtime" : "text-foreground"}>
              {formatDuration(elapsedSeconds)}
            </span>
            <span className="mx-1.5 text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">{formatDuration(estimatedSeconds)}</span>
          </p>
          <p
            className="timer-digits mt-0.5 text-right text-xs text-muted-foreground"
            title="Horas decimais decorridas"
          >
            {decimalHours} h
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-subtle"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso de ${task.name}`}
        >
          <div
            className={cn("h-full rounded-full transition-all duration-300", BAR_TONE_CLASS[tone])}
            style={{ width: `${clampedWidth}%` }}
          />
        </div>
        <span
          className={cn(
            "timer-digits w-12 shrink-0 text-right text-xs font-semibold",
            PERCENT_TONE_CLASS[tone],
          )}
        >
          {percent}%
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={task.isRunning ? "default" : "secondary"}
            size="sm"
            onClick={() => onTogglePlay(task.id)}
          >
            {task.isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {task.isRunning ? "Pausar" : "Iniciar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit(task)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" onClick={() => onComplete(task.id)}>
            <Check className="h-3.5 w-3.5" />
            Concluir
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCancel(task.id)}>
            <X className="h-3.5 w-3.5" />
            Cancelar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(task.id)}
            aria-label={`Excluir ${task.name}`}
            title="Excluir"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
