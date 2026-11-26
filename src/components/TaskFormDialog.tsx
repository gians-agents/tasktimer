import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateTaskDraft } from "@/lib/time-utils";
import type { Task, TaskDraft } from "@/types/task";

interface TaskFormDialogProps {
  open: boolean;
  editingTask: Task | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: TaskDraft) => void;
}

export function TaskFormDialog({
  open,
  editingTask,
  onOpenChange,
  onSubmit,
}: TaskFormDialogProps) {
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingTask) {
      setName(editingTask.name);
      setMinutes(String(editingTask.estimatedMinutes));
    } else {
      setName("");
      setMinutes("60");
    }
    setError(null);
  }, [open, editingTask]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateTaskDraft(name, minutes);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit({ name: name.trim(), estimatedMinutes: Math.round(Number(minutes)) });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingTask ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>
            Defina o nome e o tempo estimado em minutos para acompanhar o progresso.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">Nome da tarefa</Label>
            <Input
              id="task-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Ex: Implementar tela de relatórios"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-minutes">Tempo estimado (minutos)</Label>
            <Input
              id="task-minutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
                if (error) setError(null);
              }}
              placeholder="60"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">{editingTask ? "Salvar alterações" : "Adicionar tarefa"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}