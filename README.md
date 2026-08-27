# Cockpit

App de desktop (Electron) que roda **Claude Code** e **Codex** em até 12 painéis lado a lado,
com abas por lugar de trabalho — uma pasta do PC ou um servidor por SSH.

Escrito originalmente por **Homero Motti**. Este repositório guarda a versão em uso no
Windows, com as correções feitas em cima dela.

---

## O que ele faz

- **Painéis lado a lado** — até 12, cada um com seu motor, modelo, modo de permissão e pasta.
- **Dois motores** — Claude Code e Codex, e dá para trocar de motor no meio da conversa
  levando o que já foi dito.
- **Abas por lugar** — cada aba é uma pasta do computador ou um servidor remoto (SSH).
  O painel de uma aba de servidor roda o Claude lá dentro, não aqui.
- **Trocar de conta sem refazer login** — guarda credenciais por apelido e alterna entre elas.
- **Permissão com o diff na frente** — antes de autorizar, você vê o que vai mudar no arquivo.
- **Ditado por voz ao vivo** — o texto vai aparecendo na barra de escrita enquanto você fala.
  Roda **offline**, no próprio PC (faster-whisper); nada de áudio sai da máquina.
- **Terminal embutido**, árvore de arquivos, chip do git, @-menção de arquivo, busca dentro
  das conversas, grupos de conversa, exportar conversa em `.md`.

## Rodando

```bash
cd src
npm install
npx electron .
```

Precisa do `claude` e/ou do `codex` instalados e logados na máquina — o app conversa com os
CLIs, não com a API direto.

### Empacotar

```bash
npx @electron/asar pack src dist/app.asar --unpack-dir "node_modules/@lydell/node-pty"
```

O `--unpack-dir` do `node-pty` **não é opcional**: é binário nativo e, dentro do asar, o
terminal embutido quebra.

## Testes

```bash
node testes/rodar-tudo.js        # a bateria inteira
node testes/teste-duplicacao.js  # ou um de cada vez
```

Eles não usam framework: carregam as funções **reais** do `main.js` e do `renderer/app.js`
(via `vm`, com o mínimo de DOM falso) e verificam o comportamento. O `teste-contas.js` vai
além e carrega o `main.js` inteiro com um Electron de mentira, chamando os handlers `ipcMain`
de verdade contra uma HOME temporária.

Cada teste existe por causa de um bug que aconteceu de verdade — o nome dos casos diz qual.

## Como o app é organizado

| Arquivo | O que é |
|---|---|
| `src/main.js` | Processo principal: sobe os motores, fala com os CLIs, IPC, terminais, sessões |
| `src/preload.js` | A ponte: o único caminho entre a tela e o processo principal |
| `src/plataforma.js` | O que muda entre Windows e Mac (caminhos, credencial, pty) |
| `src/renderer/app.js` | A tela inteira: painéis, abas, lista de conversas, menus |
| `src/renderer/index.html` | Estrutura e o template de painel |
| `src/renderer/style.css` | Temas (escuro, claro, jornal) e o layout dos painéis |

### Duas coisas que não são óbvias no código

**Um processo de Claude por painel, mas um único Codex para todos.** O Codex roteia por
thread (`threadToPane`), então tudo que mexe em conta ou reinício precisa derrubar o processo
compartilhado — parar o painel não basta.

**Todo painel de aba que não está na tela continua guardado.** Quando você troca de aba, o
elemento sai do DOM mas o painel segue inteiro em `panesFundo`, com a conversa desenhada — é
o que faz a volta ser instantânea, sem recarregar histórico. Quem estava **trabalhando** mantém
também o motor rodando e continua recebendo eventos; quem estava parado tem só o motor
desligado. Por isso, dentro do renderer, `panes` **não** é a lista completa: use
`acharPainel(id)`. E cuidado com `isConnected` — num elemento destacado ele é sempre `false`.

**Desligar o motor sem perder a conversa.** Ao ligar, o app passa `--resume` e zera o
`P.resumeId` (aquele id já foi gasto); de lá em diante quem guarda o endereço da conversa é o
`P.sessaoId`. Todo ponto que desliga um motor precisa devolver esse endereço antes — é o que
`desligarMotor(P)` faz. Esquecer isso já custou duas vezes: a próxima mensagem sobe uma
conversa **nova**, com o histórico ainda desenhado na tela e o modelo sem lembrar de nada.

**O canal SSH precisa de sinal de vida.** Um turno dura minutos e depois ninguém escreve nada
por mais um tanto. Conexão parada é descartada por roteador/firewall sem avisar: os dois lados
seguem achando que estão ligados e a verdade só aparece quando alguém escreve. Daí o
`ServerAliveInterval` no `spawn` do ssh.

## Configuração

Fica em `%APPDATA%\cockpit\config.json` (Windows) — abas, painéis, grupos e preferências.
**Não é versionado**, e editar esse arquivo com o app aberto não adianta: ele tem tudo em
memória e sobrescreve na ação seguinte.

A aba "VPS" nasce **em branco de propósito** — endereço, usuário e caminho da chave são seus e
não moram no código. Duplo clique na aba para preencher.

## O que foi corrigido nesta versão

Cada item abaixo tem um teste em `testes/` que reproduz o problema antes de provar a correção.

| Problema que aparecia na tela | O que era de verdade |
|---|---|
| A mesma resposta saía duplicada | delta e final chegavam com ids diferentes e viravam dois balões |
| Trocar de aba recarregava todos os chats | painel parado era destruído e remontado do zero na volta |
| "Esta é uma sessão nova" com o histórico na tela | o `--resume` era perdido em 3 pontos que desligavam o motor |
| Resposta parecia quebrada em várias | a caixa de ferramentas era arrastada para o fim a cada nova ferramenta |
| Contexto marcando 1465k de 1000k | somava o `usage` do turno inteiro; o certo é o do último `assistant` |
| Painel voltava "vivo" mas sem funcionar nada | ele voltava marcado como morto — 16 caminhos do app desistem nesse estado |
| O botão de voz não funcionava | `Buffer.from(Int16Array)` truncava cada amostra em 1 byte e destruía o áudio |
| A aba do servidor caía entre mensagens | canal SSH sem keepalive, descartado por ficar ocioso |
| Shift+Tab chegava em "sem pedir permissão" | e ainda gravava isso como padrão de todo painel novo |

### Segurança

- O microfone é fechado em qualquer tropeço do caminho de áudio (antes podia ficar aberto sem
  indicação na tela e sem jeito de parar).
- O áudio do ditado vira arquivo temporário; a pasta é varrida ao abrir **e** ao fechar o app.
- Os processos de transcrição morrem junto com o app (antes sobreviviam a um Ctrl+R).
- O nome do modelo de voz é interpolado dentro de um script Python — passa por lista fechada.
- O `stderr` dos motores deixou de ser descartado: o motivo real da queda aparece no aviso.

## Licença

MIT — ver `src/package.json`. Autoria original de Homero Motti.
