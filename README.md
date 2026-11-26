# TaskTimer

O TaskTimer é um aplicativo multipataforma de timer de tarefas. Ele ajuda a acompanhar o tempo gasto em cada atividade, com progresso visual, histórico e persistência local.

A interface atual é uma aplicação web (Vite, React e TanStack Start). A integração com o Tauri está planejada para distribuir o app no desktop e, no futuro, em outras plataformas.

## Funcionalidades

- Lista de tarefas ativas em cards, com nome, timer no formato HH:MM:SS / tempo estimado, horas decimais e barra de progresso
- Ações por tarefa: play/pause, editar, concluir, cancelar e excluir
- Inclusão de novas tarefas (nome e tempo estimado em minutos)
- Histórico de tarefas concluídas e canceladas
- Tema claro/escuro conforme o sistema
- Exportação e importação de tarefas em JSON
- Persistência local (as tarefas permanecem ao fechar e reabrir o app)

Recursos nativos como bandeja do sistema, iniciar minimizado, instância única e notificações ao ultrapassar o tempo estimado entram com a integração do Tauri.

## Desenvolvimento

```sh
bun install
bun run dev
```

Também é possível usar `npm install` e `npm run dev`. Para o build de produção:

```sh
bun run build
```
