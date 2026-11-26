import { useMemo, useState } from "react";
import { CheckCircle2, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDecimalHours, formatDuration, getProgressPercent } from "@/lib/time-utils";
import type { Task } from "@/types/task";

interface HistoryDialogProps {
  open: boolean;
  tasks: Task[];
  onOpenChange: (open: boolean) => void;
  onDeleteTask: (taskId: string) => void;
}

type HistoryFilter = "all" | "completed" | "canceled";

function formatFinishedDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function HistoryDialog({
  open,
  tasks,
  onOpenChange,
  onDeleteTask,
}: HistoryDialogProps) {
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const completedCount = useMemo(
    () => tasks.filter((task) => task.status === "completed").length,
    [tasks],
  );
  const canceledCount = useMemo(
    () => tasks.filter((task) => task.status === "canceled").length,
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (filter === "all") return tasks;
    return tasks.filter((task) => task.status === filter);
  }, [filter, tasks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Histórico de tarefas</DialogTitle>
          <DialogDescription>
            Tarefas concluídas e canceladas registradas localmente.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as HistoryFilter)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">Todas ({tasks.length})</TabsTrigger>
            <TabsTrigger value="completed">Concluídas ({completedCount})</TabsTrigger>
            <TabsTrigger value="canceled">Canceladas ({canceledCount})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-2 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {visibleTasks.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma tarefa neste filtro ainda.
            </p>
          ) : (
            visibleTasks.map((task) => {
              const isCompleted = task.status === "completed";
              const percent = getProgressPercent(task.elapsedSeconds, task.estimatedMinutes);
              return (
                <div
                  key={task.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-subtle/60 p-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0 text-progress-safe"
                          aria-label="Concluída"
                        />
                      ) : (
                        <XCircle
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-label="Cancelada"
                        />
                      )}
                      <p className="truncate text-sm font-medium text-foreground">{task.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isCompleted ? "Concluída" : "Cancelada"}
                      {task.finishedAt ? ` em ${formatFinishedDate(task.finishedAt)}` : ""}
                      {` · ${percent}% do estimado`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="timer-digits text-sm font-medium text-foreground">
                        {formatDuration(task.elapsedSeconds)}
                        <span className="mx-1 text-muted-foreground/60">/</span>
                        <span className="text-muted-foreground">
                          {formatDuration(task.estimatedMinutes * 60)}
                        </span>
                      </p>
                      <p className="timer-digits text-xs text-muted-foreground">
                        {formatDecimalHours(task.elapsedSeconds)} h
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteTask(task.id)}
                      aria-label={`Remover ${task.name} do histórico`}
                      title="Remover do histórico"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}