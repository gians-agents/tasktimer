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

No app desktop (Tauri), a bandeja do sistema, a opção de iniciar minimizado e a instância única já estão disponíveis. Notificações nativas ao ultrapassar o tempo estimado entram em PRs seguintes.

Uma segunda execução do TaskTimer não abre outra janela: o processo novo encerra e o já em execução mostra, desminimiza e foca a janela principal — mesmo se ela estiver oculta na bandeja ou se a preferência “iniciar minimizado” estiver ativa (essa preferência vale só na primeira abertura do processo).

## Desenvolvimento

```sh
bun install
bun run dev
```

Também é possível usar `npm install` e `npm run dev`. Para o build de produção:

```sh
bun run build
```

## Pacotes Linux (bandeja)

O ícone da bandeja usa Ayatana AppIndicator (`libayatana-appindicator3`). A biblioteca é carregada em runtime (não aparece no `ldd` do binário).

- **.deb:** declara a dependência de sistema `libayatana-appindicator3-1` em `bundle.linux.deb.depends`. O CLI do Tauri também acrescenta essa dependência automaticamente quando a feature `tray-icon` está ativa.
- **AppImage:** com `tray-icon`, o CLI do Tauri v2 copia `libayatana-appindicator3.so.1` para `/usr/lib/` dentro do bundle (`bundle.linux.appimage.files`). Não é necessário ter o pacote instalado no sistema para o ícone funcionar no AppImage; essa cópia é injetada pelo CLI e não precisa ser repetida no `tauri.conf.json`.
