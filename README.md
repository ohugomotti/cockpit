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
node testes/teste-duplicacao.js
node testes/teste-segundo-plano.js
node testes/teste-contas.js
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

**Painel de aba que não está na tela pode continuar rodando.** Quando você troca de aba, o
painel que está trabalhando tem o elemento removido do DOM mas segue vivo em `panesFundo`,
recebendo eventos. Por isso, dentro do renderer, `panes` **não** é a lista completa: use
`acharPainel(id)`. E cuidado com `isConnected` — num elemento destacado ele é sempre `false`.

## Configuração

Fica em `%APPDATA%\cockpit\config.json` (Windows) — abas, painéis, grupos e preferências.
**Não é versionado**, e editar esse arquivo com o app aberto não adianta: ele tem tudo em
memória e sobrescreve na ação seguinte.

A aba "VPS" nasce **em branco de propósito** — endereço, usuário e caminho da chave são seus e
não moram no código. Duplo clique na aba para preencher.

## Licença

MIT — ver `src/package.json`. Autoria original de Homero Motti.
