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

No app desktop (Tauri), a bandeja do sistema, a opção de iniciar minimizado, a instância única e as notificações nativas ao ultrapassar o tempo estimado já estão disponíveis.

Uma segunda execução do TaskTimer não abre outra janela: o processo novo encerra e o já em execução mostra, desminimiza e foca a janela principal — mesmo se ela estiver oculta na bandeja ou se a preferência “iniciar minimizado” estiver ativa (essa preferência vale só na primeira abertura do processo).

## Notificações nativas (overtime)

Quando uma tarefa em execução ultrapassa o tempo estimado, o app desktop envia uma notificação do sistema — inclusive se a janela estiver oculta na bandeja ou sem foco. Há no máximo **uma notificação por travessia** do limite (`overtimeNotified` + deduplicação no Rust).

O tempo é medido em relógio de parede (`lastStartedAt`). O webview pode ter o `setInterval` restringido ou pausado com a janela oculta, então um watchdog no processo Rust revisa as tarefas em execução a cada segundo (a partir do último `save_app_data`) e dispara a notificação mesmo se o JavaScript estiver congelado. A flag `overtimeNotified` é gravada no arquivo de dados na hora do disparo (e de novo ao sair pela bandeja), para que um “Sair” com a janela oculta — quando o JavaScript não consegue persistir — não gere uma segunda notificação na próxima abertura. Quando o webview volta, ele só sincroniza a flag e o toast — não manda uma segunda notificação nativa.

Clicar na notificação tenta mostrar, desminimizar e focar a janela principal. No Windows o clique só é reportado enquanto o toast está visível, não depois de ir para a Central de Ações. No Linux depende do servidor de notificações.

**Linux:** é preciso um daemon de notificações no ambiente (por exemplo o da GNOME, KDE, `xfce4-notifyd` ou Dunst). Sem ele a notificação não aparece; o toast da interface continua valendo quando a janela está visível.

**Windows:** em builds de desenvolvimento/não assinadas o plugin pode exibir o nome e o ícone do PowerShell. A identidade do TaskTimer vale nos pacotes instalados (`Only works for installed apps` na documentação do plugin).

A exportação nativa em “Salvar como” entra em um PR seguinte.

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
