# Changelog

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.2.0-beta.1] - 2026-11-27

Primeira versão beta, com os recursos de desktop adicionados depois da `v0.1.0-alpha`.

### Adicionado

- Bandeja do sistema e preferência para iniciar minimizado ([#8](https://github.com/gians-agents/tasktimer/pull/8)).
- Instância única no desktop: uma segunda execução encerra o processo novo e foca a janela já aberta, inclusive se ela estiver oculta na bandeja ([#9](https://github.com/gians-agents/tasktimer/pull/9)).
- Notificação nativa ao ultrapassar o tempo estimado, mesmo com a janela oculta ou sem foco ([#10](https://github.com/gians-agents/tasktimer/pull/10)).
- Exportação e importação JSON no desktop pelos diálogos nativos “Salvar como” e “Abrir” ([#11](https://github.com/gians-agents/tasktimer/pull/11)).
- Lint, verificação de tipos, Prettier, rustfmt e Clippy no CI do aplicativo ([#12](https://github.com/gians-agents/tasktimer/pull/12)).
- Capturas reais da interface no site, nos temas claro e escuro, com `<picture>` e `prefers-color-scheme` ([#13](https://github.com/gians-agents/tasktimer/pull/13)).
- A página de downloads embute o release publicado mais recente (incluindo pré-releases) e passa a usar uma CSP mais restrita ([#7](https://github.com/gians-agents/tasktimer/pull/7)).

### Corrigido

- A flag de overtime não é rearmada ao aumentar o tempo estimado. Ela também é persistida ao sair com a janela oculta, para não repetir a notificação na próxima abertura ([#10](https://github.com/gians-agents/tasktimer/pull/10)).
- A segunda instância não relê o arquivo de dados ao focar a janela já em execução ([#9](https://github.com/gians-agents/tasktimer/pull/9)).
- A exportação JSON no Windows usa arquivos temporários únicos (sem clobber de `.bak`/`.tmp`); o toast de importação é honesto quando a persistência está bloqueada; o limite de 5 MiB vale no navegador e no backend ([#11](https://github.com/gians-agents/tasktimer/pull/11)).

### Limitações conhecidas

- Os instaladores **não são assinados**. O Windows SmartScreen pode exibir um aviso ao abrir o `.exe` ou o `.msi`.
- No Linux, o ícone da bandeja no pacote `.deb` depende de `libayatana-appindicator3-1`. O AppImage já inclui essa biblioteca no bundle.
- As notificações no Linux exigem um daemon no ambiente (por exemplo o da GNOME, KDE, `xfce4-notifyd` ou Dunst). Sem ele, só o toast da interface aparece quando a janela está visível.
- Não há build para macOS neste release.
- O instalador MSI (WiX) exige um `ProductVersion` só numérico. A versão do app continua `0.2.0-beta.1`, mas o MSI usa `0.2.0` via `bundle.windows.wix.version`. O Windows Installer considera apenas os três primeiros campos, então esta beta e um futuro `0.2.0` estável aparecem como a mesma versão para o MSI; no Windows, desinstale ou reinstale na mão ao trocar entre esses pacotes. O instalador NSIS e os pacotes Linux usam o semver completo.

## [0.1.0-alpha] - 2026-11-26

Primeira versão publicada do TaskTimer (pré-release alpha), com o aplicativo desktop para Windows e Linux e a página de downloads.

### Adicionado

- Interface de timer de tarefas: lista ativa, histórico, tema claro/escuro conforme o sistema, persistência local e exportação/importação JSON no navegador.
- Backend Tauri com persistência no desktop ([#4](https://github.com/gians-agents/tasktimer/pull/4)).
- Ícone do aplicativo ([#2](https://github.com/gians-agents/tasktimer/pull/2)).
- CI de build para Windows e Linux, com rascunho de release nas tags `v*` ([#3](https://github.com/gians-agents/tasktimer/pull/3)).
- Página estática no GitHub Pages para baixar os instaladores ([#5](https://github.com/gians-agents/tasktimer/pull/5), [#6](https://github.com/gians-agents/tasktimer/pull/6)).

### Alterado

- Remoção das referências ao Lovable, deixando o repositório pronto para a integração com o Tauri ([#1](https://github.com/gians-agents/tasktimer/pull/1)).

[0.2.0-beta.1]: https://github.com/gians-agents/tasktimer/compare/v0.1.0-alpha...v0.2.0-beta.1
[0.1.0-alpha]: https://github.com/gians-agents/tasktimer/releases/tag/v0.1.0-alpha
