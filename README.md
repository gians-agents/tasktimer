# Task Timer

Funcionalidades principais:

- Lista de tarefas ativas, cada uma em um card com:

- - Nome da tarefa

- - Timer no formato HH:MM:SS / HH:MM:SS (tempo decorrido / tempo estimado)

- - Abaixo do timer, um número menor mostrando as horas decimais decorridas (ex: 0.2, 1.5, 3)

- - Barra de progresso full-width com porcentagem ao lado

- - Botões: Play/Pause, Editar, Concluir (destaque), Cancelar, Excluir

- Botão “+” no header para adicionar nova tarefa (nome + tempo estimado em minutos)

- Botão de histórico no header (mostra tarefas concluídas e canceladas)

- Minimizar para a bandeja do sistema (tray)

- Opção de iniciar minimizado

- Instância única

- Tema claro/escuro automático

- Exportar e importar tarefas em JSON

- Notificação nativa quando uma tarefa ultrapassar o tempo estimado

- Persistência local (as tarefas continuam ao fechar e reabrir o app)

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
