import { useRef } from "react";
import { Download, History, Minimize2, MoreHorizontal, Plus, Timer, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  historyCount: number;
  startMinimized: boolean;
  appVersion?: string | null;
  onAddClick: () => void;
  onHistoryClick: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onMinimizeToTray: () => void;
  onToggleStartMinimized: (enabled: boolean) => void;
}

export function Header({
  historyCount,
  startMinimized,
  appVersion,
  onAddClick,
  onHistoryClick,
  onExportJson,
  onImportJson,
  onMinimizeToTray,
  onToggleStartMinimized,
}: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Timer className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">TaskTimer</h1>
            {appVersion ? (
              <span className="timer-digits text-xs text-muted-foreground">v{appVersion}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportJson(file);
              event.target.value = "";
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais opções">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={onExportJson}>
                <Download className="mr-2 h-4 w-4" />
                Exportar JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Importar JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onMinimizeToTray}>
                <Minimize2 className="mr-2 h-4 w-4" />
                Minimizar para bandeja
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={startMinimized}
                onCheckedChange={(checked) => onToggleStartMinimized(Boolean(checked))}
              >
                Iniciar minimizado
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={onHistoryClick} className="gap-1.5">
            <History className="h-4 w-4" />
            <span>Histórico</span>
            {historyCount > 0 && (
              <span className="timer-digits text-xs text-muted-foreground">({historyCount})</span>
            )}
          </Button>

          <Button size="icon" onClick={onAddClick} aria-label="Nova tarefa" title="Nova tarefa">
            <Plus className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
