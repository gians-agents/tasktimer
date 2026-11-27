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

No app desktop (Tauri), a bandeja do sistema, a opção de iniciar minimizado, a instância única, as notificações nativas ao ultrapassar o tempo estimado e a exportação JSON com o diálogo nativo “Salvar como” já estão disponíveis.

Uma segunda execução do TaskTimer não abre outra janela: o processo novo encerra e o já em execução mostra, desminimiza e foca a janela principal — mesmo se ela estiver oculta na bandeja ou se a preferência “iniciar minimizado” estiver ativa (essa preferência vale só na primeira abertura do processo).

## Notificações nativas (overtime)

Quando uma tarefa em execução ultrapassa o tempo estimado, o app desktop envia uma notificação do sistema — inclusive se a janela estiver oculta na bandeja ou sem foco. Há no máximo **uma notificação por travessia** do limite (`overtimeNotified` + deduplicação no Rust).

O tempo é medido em relógio de parede (`lastStartedAt`). O webview pode ter o `setInterval` restringido ou pausado com a janela oculta, então um watchdog no processo Rust revisa as tarefas em execução a cada segundo (a partir do último `save_app_data`) e dispara a notificação mesmo se o JavaScript estiver congelado. A flag `overtimeNotified` é gravada no arquivo de dados na hora do disparo (e de novo ao sair pela bandeja), para que um “Sair” com a janela oculta — quando o JavaScript não consegue persistir — não gere uma segunda notificação na próxima abertura. Quando o webview volta, ele só sincroniza a flag e o toast — não manda uma segunda notificação nativa.

Clicar na notificação tenta mostrar, desminimizar e focar a janela principal. No Windows o clique só é reportado enquanto o toast está visível, não depois de ir para a Central de Ações. No Linux depende do servidor de notificações.

**Linux:** é preciso um daemon de notificações no ambiente (por exemplo o da GNOME, KDE, `xfce4-notifyd` ou Dunst). Sem ele a notificação não aparece; o toast da interface continua valendo quando a janela está visível.

**Windows:** em builds de desenvolvimento/não assinadas o plugin pode exibir o nome e o ícone do PowerShell. A identidade do TaskTimer vale nos pacotes instalados (`Only works for installed apps` na documentação do plugin).

## Exportação e importação JSON (desktop)

No app desktop, **Exportar JSON** abre o diálogo nativo “Salvar como”, com o nome sugerido `tasktimer-YYYY-MM-DD.json` (data local) e filtro `*.json`. O caminho é escolhido pelo usuário no diálogo e a escrita é feita por um comando Rust (gravação atômica, limite de 5 MB) — o frontend não recebe permissão ampla de sistema de arquivos. Se o diálogo for cancelado, nada acontece (sem toast de erro). Em caso de falha na gravação, aparece um toast de erro. No sucesso, o toast mostra o caminho do arquivo.

**Importar JSON** no desktop abre o diálogo nativo “Abrir”, lê o arquivo escolhido (mesmo limite de tamanho) e aplica as tarefas na interface. Cancelar também é silencioso. A validação do conteúdo continua no frontend (`parseImportedJson`).

No navegador, a exportação segue o download por âncora e a importação usa o seletor de arquivo da página.


## Desenvolvimento

```sh
bun install
bun run dev
```

Também é possível usar `npm install` e `npm run dev`. Para o build de produção:

```sh
bun run build
```

## Lint e verificação de tipos

No frontend:

```sh
bun run lint
bun run typecheck
bun run format:check
```

Para reescrever a formatação automaticamente: `bun run format`.

No crate Rust (`src-tauri`):

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

## Pacotes Linux (bandeja)

O ícone da bandeja usa Ayatana AppIndicator (`libayatana-appindicator3`). A biblioteca é carregada em runtime (não aparece no `ldd` do binário).

- **.deb:** declara a dependência de sistema `libayatana-appindicator3-1` em `bundle.linux.deb.depends`. O CLI do Tauri também acrescenta essa dependência automaticamente quando a feature `tray-icon` está ativa.
- **AppImage:** com `tray-icon`, o CLI do Tauri v2 copia `libayatana-appindicator3.so.1` para `/usr/lib/` dentro do bundle (`bundle.linux.appimage.files`). Não é necessário ter o pacote instalado no sistema para o ícone funcionar no AppImage; essa cópia é injetada pelo CLI e não precisa ser repetida no `tauri.conf.json`.
