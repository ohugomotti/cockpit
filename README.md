# Cockpit

App de desktop (Electron) que roda **Claude Code**, **Codex**, **Gemini**, **Grok** e qualquer
agente **ACP** em até 12 painéis lado a lado, com abas por lugar de trabalho — uma pasta do PC
ou um servidor por SSH.

Escrito originalmente por **Homero Motti**. Este repositório guarda a versão em uso no
Windows, com as correções e as levas de melhoria feitas em cima dela.

---

## O que ele faz

- **Painéis lado a lado** — até 12, cada um com seu motor, modelo, modo de permissão e pasta.
- **Cinco motores** — Claude Code, Codex, Gemini, Grok e o motor **ACP** genérico (qualquer
  agente que fale o *Agent Client Protocol* entra por um comando). Dá para trocar de motor no
  meio da conversa levando o que já foi dito.
- **Abas por lugar** — cada aba é uma pasta do computador ou um servidor remoto (SSH).
  O painel de uma aba de servidor roda o agente lá dentro, não aqui.
- **Servidor de primeira classe** — árvore de arquivos, @-menção e visor de arquivo funcionam
  no remoto igual ao local, não só na pasta do PC.
- **Torre de controle** — todos os painéis de todas as abas numa tela só (trabalhando ·
  esperando você autorizar · parado · guardado), mais as sessões do Claude que rodam **fora**
  do Cockpit (VS Code, terminal, Telegram).
- **Rotinas** — as tarefas agendadas do Windows numa view própria, com bloco vermelho no topo
  para o que parou de funcionar em silêncio.
- **Trocar de conta sem refazer login** — guarda credenciais por apelido e alterna entre elas.
- **Permissão com o diff na frente** — antes de autorizar, você vê o que vai mudar no arquivo.
- **Terminal embutido**, chip do git, busca dentro das conversas, grupos de conversa, painel em
  worktree do git, perfis de conectores por aba, exportar conversa em `.md`.

### Entrada sem digitar

- **Ditado por voz ao vivo** — o texto vai aparecendo na barra de escrita enquanto você fala.
  Roda **offline**, no próprio PC; nada de áudio sai da máquina. Dois motores: Whisper
  (faster-whisper) ou **Parakeet TDT 0.6B v3**, que dá legenda em 0,6–0,8 s por frase.
- **Voz sem clique** — atalho global opt-in (`Ctrl+Alt+Space`) liga o ditado no painel em foco
  mesmo com o Cockpit atrás, e a frase fechada aceita comandos: "manda", "cancela", "apaga isso",
  "próximo painel".
- **Recorte de tela** (`Ctrl+Alt+R`, opt-in), **foto** pela webcam, e **OCR local** que tira o
  texto de qualquer anexo de imagem.
- **Quadro branco** — Excalidraw embutido (sem CDN, sob a CSP do app). Anexa como PNG ou como
  `.excalidraw`, que o agente edita e escreve de volta.
- **Prompts salvos** e **caixa de entrada** — o que cair em `%APPDATA%\cockpit\inbox` (texto ou
  imagem) vira tarja com "usar"; o bot do Telegram despeja ali com `/cockpit`.

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
node testes/rodar-tudo.js                # a bateria inteira: 21 testes
node testes/teste-duplicacao.js          # ou um de cada vez
node --test test/codex-protocol.test.js  # 19 casos do protocolo do Codex
```

A bateria de `testes/` não usa framework: carrega as funções **reais** do `main.js` e do
`renderer/app.js` (via `vm`, com o mínimo de DOM falso) e verifica o comportamento. O
`teste-contas.js` vai além e carrega o `main.js` inteiro com um Electron de mentira, chamando os
handlers `ipcMain` de verdade contra uma HOME temporária.

Cada teste existe por causa de um bug que aconteceu de verdade — o nome dos casos diz qual.

O `test/codex-protocol.test.js` é o único que usa `node:test`, porque o `src/codex-protocol.js`
é puro: não depende do Electron e dá para exercitar direto.

## Como o app é organizado

| Arquivo | O que é |
|---|---|
| `src/main.js` | Processo principal: sobe os motores, fala com os CLIs, IPC, terminais, sessões |
| `src/preload.js` | A ponte: o único caminho entre a tela e o processo principal |
| `src/plataforma.js` | O que muda entre Windows e Mac (caminhos, credencial, pty) |
| `src/acp.js` | O motor ACP: JSON-RPC por stdio e a tradução para os eventos do app. Sem Electron |
| `src/codex-protocol.js` | O vocabulário do `codex app-server` (0.147/0.153). Sem Electron |
| `src/pergunta-mcp.js` | O servidor MCP que entrega plano e pergunta do agente à tela |
| `src/preload-recorte.js` | Ponte da janela de recorte de tela |
| `src/assets/ouvinte-parakeet.py` | Ouvinte de voz do Parakeet, mesmo protocolo do de Whisper |
| `src/renderer/app.js` | A tela inteira: painéis, abas, lista de conversas, menus, side-views |
| `src/renderer/index.html` | Estrutura e o template de painel |
| `src/renderer/recorte.html` e `recorte.js` | A janela sem moldura que arrasta o retângulo do recorte |
| `src/renderer/style.css` | Temas (escuro, claro, jornal) e o layout dos painéis |
| `src/renderer/vendor/` | xterm, marked, purify e o bundle do Excalidraw com as fontes locais |

### Coisas que não são óbvias no código

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

**O cache de arquivos é por servidor, não por caminho.** `cacheArquivos` é chaveado por
`usuario@host|caminho`. Antes, duas abas ssh com `caminhoRemoto:'~'` colidiam entre si — e com
o `~` do Windows.

**Motor novo não é `if` novo.** Os 25 `if (eng === ...)` do `main.js` viraram consulta a uma
tabela de motores; a tela lê a mesma tabela (`MOTORES`, `NOME_MOTOR`, `CAIXA_MOTOR`). Acrescentar
motor é acrescentar linha, não ramo.

## Configuração

Fica em `%APPDATA%\cockpit\config.json` (Windows) — abas, painéis, grupos e preferências.
**Não é versionado**, e editar esse arquivo com o app aberto não adianta: ele tem tudo em
memória e sobrescreve na ação seguinte.

A aba "VPS" nasce **em branco de propósito** — endereço, usuário e caminho da chave são seus e
não moram no código. Duplo clique na aba para preencher.

## O que entrou nas últimas levas

| Leva | O que entrou |
|---|---|
| 27–32 | Registro de motores (a tabela no lugar dos 25 `if`), motor de turno para Grok e Gemini, tela orientada pela tabela |
| 33 | **Motor ACP** — qualquer agente que fale o Agent Client Protocol entra por um comando (`src/acp.js`), com modos, modelos e a mesma barra de permissão |
| 34 | **Sinais** — plano do agente via MCP, PushNotification entregue na tela, linha do tempo sem teto, prints inline, "Continuar", retomada honesta |
| 35 | **Torre** — torre de controle, painel em worktree do git (`-w`), perfis de conectores por aba (`--disallowedTools`), recibo do turno |
| 36 | **Entrada** — voz sem clique e comandos de voz, motor Parakeet, recorte de tela, foto, quadro Excalidraw embutido, OCR local, prompts salvos, caixa de entrada do Telegram |
| 37 | **Remoto de 1ª classe** — árvore, @-menção e visor de arquivo no servidor; view **Rotinas** com as tarefas agendadas do Windows |
| 38 | **Codex app-server 0.147/0.153** — retomar reaplica as escolhas, recusa chega ao Codex, pergunta do próprio Codex vira cartão (com campo oculto para senha), skills nativas e Apps do ChatGPT na tela de conectores |

As levas 35 e 36 passaram por 4 rodadas de auditoria dupla: **94 achados, 176 correções**.

### O que foi corrigido antes disso (levas 17–20)

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
- O quadro branco roda sob a CSP do app: bundle e fontes locais, sem CDN, sem `eval`, sem wasm.
- Os atalhos globais (`Ctrl+Alt+Space`, `Ctrl+Alt+R`) nascem **desligados** — um atalho global
  toma a combinação de todos os programas, então é escolha sua nos Ajustes.

## Licença

MIT — ver `src/package.json`. Autoria original de Homero Motti.
