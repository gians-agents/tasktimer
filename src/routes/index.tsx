import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Header } from "@/components/Header";
import { HistoryDialog } from "@/components/HistoryDialog";
import { TaskCard } from "@/components/TaskCard";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { Button } from "@/components/ui/button";
import { useTaskTimer } from "@/hooks/use-task-timer";
import type { Task } from "@/types/task";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TaskTimer — Timer de Tarefas" },
      {
        name: "description",
        content:
          "Gerencie tarefas ativas com timer em tempo real, horas decimais, barra de progresso e histórico.",
      },
      { property: "og:title", content: "TaskTimer — Timer de Tarefas" },
      {
        property: "og:description",
        content:
          "Gerencie tarefas ativas com timer em tempo real, horas decimais, barra de progresso e histórico.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const {
    activeTasks,
    historyTasks,
    settings,
    appInfo,
    storageError,
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
  } = useTaskTimer();

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const openCreateDialog = () => {
    setEditingTask(null);
    setFormOpen(true);
  };

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    setFormOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        historyCount={historyTasks.length}
        startMinimized={settings.startMinimized}
        appVersion={appInfo?.version ?? null}
        onAddClick={openCreateDialog}
        onHistoryClick={() => setHistoryOpen(true)}
        onExportJson={exportJson}
        onImportJson={(file) => void importJson(file)}
        onMinimizeToTray={() => void handleMinimizeToTray()}
        onToggleStartMinimized={(enabled) => void toggleStartMinimized(enabled)}
      />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {storageError ? (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
          >
            <p className="font-medium">Não foi possível carregar as tarefas salvas.</p>
            <p className="mt-1 text-muted-foreground">
              O arquivo do app foi preservado para não sobrescrever seus dados. {storageError}
            </p>
          </div>
        ) : null}

        {!hydrated ? (
          <div className="space-y-4" aria-busy="true">
            <div className="h-40 animate-pulse rounded-2xl border border-border bg-card/60" />
            <div className="h-40 animate-pulse rounded-2xl border border-border bg-card/60" />
          </div>
        ) : activeTasks.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
            <h2 className="text-base font-semibold text-foreground">Nenhuma tarefa ativa</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Adicione uma tarefa com tempo estimado para começar a cronometrar.
            </p>
            <Button onClick={openCreateDialog} className="mt-5">
              <Plus className="h-4 w-4" />
              Adicionar tarefa
            </Button>
          </section>
        ) : (
          <section aria-label="Tarefas ativas" className="space-y-4">
            {activeTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                nowMs={nowMs}
                onTogglePlay={togglePlayPause}
                onEdit={openEditDialog}
                onComplete={(id) => finishTask(id, "completed")}
                onCancel={(id) => finishTask(id, "canceled")}
                onDelete={deleteTask}
              />
            ))}
          </section>
        )}
      </main>

      <TaskFormDialog
        open={formOpen}
        editingTask={editingTask}
        onOpenChange={setFormOpen}
        onSubmit={(draft) => {
          if (editingTask) {
            editTask(editingTask.id, draft);
          } else {
            addTask(draft);
          }
        }}
      />

      <HistoryDialog
        open={historyOpen}
        tasks={historyTasks}
        onOpenChange={setHistoryOpen}
        onDeleteTask={deleteTask}
      />
    </div>
  );
}
