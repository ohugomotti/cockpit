# Mudanças oficiais do Electron 33.0 a 44.0 × Cockpit

Leva 0, tarefa L0-a. Gerado em 01/10/2026.

- **Fonte:** `https://raw.githubusercontent.com/electron/electron/main/docs/breaking-changes.md`, baixado em 01/10/2026 (seções 44.0 até 33.0; 3.586 linhas no total).
- **Cruzamento:** cada mudança foi procurada no `tools/electron44/inventario.json` (495 usos de API em 9 arquivos, opções dos dois `new BrowserWindow`) e por busca direta em `src/` (fora `src/renderer/vendor`). A prova de execução está em `resultado-32.3.3.json`, `resultado-44.5.1.json` e `diferencas.json`.
- **Linhas:** valem para o `src/` do HEAD `8145ea6` (01/10/2026, já com o log da tela da Task 2, commit `91cb529`). O `inventario.json` e o `diferencas.json` foram gerados de novo nesse HEAD: o `main.js` andou 4 linhas desde a primeira rodada. Se o arquivo mudar, procure pelo nome do canal ou da função citado ao lado.
- **Conferência da lista:** os 64 itens das seções 33.0 a 44.0 estão nas tabelas abaixo (alguns agrupados na mesma linha).

Legenda da coluna **Afeta?**: ✅ não afeta · ⚠️ afeta pouco ou só em outro sistema · ❌ quebra.

## 44.0 (a versão instalada é a 44.5.1)

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| **`clipboard` reescrito no padrão W3C**: `readText`, `read`, `has`, `writeText` e `write` viram Promise; somem `readImage`, `readBuffer`, `availableFormats`, `readHTML`, `readRTF`, `readBookmark`, `readFindText` e os `write*` equivalentes; `read()` devolve uma lista de `ClipboardItem`; `text/uri-list` passa a ser a lista de arquivos do Explorer (CF_HDROP). | ❌ | `main.js:4423` (`clipboard:anexos`, `readImage`), `main.js:4291` e `:4301` (`arquivosColados`, `readBuffer`), `main.js:4312` (`read(fmt)`), `main.js:4447` (`clipboard:texto`, `readText`), `main.js:4450` (`clipboard:copiar`, `writeText`) | Colar imagem não anexa nada e não avisa. Ctrl+V no terminal embutido (código do login) diz "Não tem texto copiado pra colar" mesmo com texto copiado. Colar arquivo copiado no Explorer pode não anexar. Copiar não apareceu quebrado, mas não foi provado (a sonda não escreve na área de transferência, então não se sabe se o `writeText` assíncrono grava); um erro na cópia some sem rastro. | leva 1: corrigir |
| `clipboard` não existe mais no renderer (já estava avisado no 40). | ✅ | O preload não usa `clipboard`; o renderer usa `navigator.clipboard.writeText` (web), que não mudou. | Nada. | ok |
| ANGLE embutido no executável: `libEGL.dll` e `libGLESv2.dll` saem do pacote. | ✅ | Empacotamento: `tools/runtime/aplicar-unificado.ps1:135` já trata as duas DLLs como obsoletas. | Nada (a instalação de 30/09 já passou por isso). | ok |
| `net.request` recusa destino de quadro sem `Sec-Fetch-Mode: navigate`. | ✅ | O Cockpit usa `net.fetch` (`main.js:4116`, medidor de uso) e não define `Sec-Fetch-*`. | Nada. | ok |
| `select-client-certificate` pode vir com `webContents` nulo. | ✅ | Evento não usado. | Nada. | ok |
| Fim do Windows 32 bits e do Linux ARM 32. | ✅ | Runtime é win32-x64 (`artifacts/runtime-candidate.json`). | Nada. | ok |
| Fim do macOS 12; `openAsHidden` e campos de "login item" removidos; `app.isUnityRunning()` removido (Linux). | ✅ | Nada disso é usado. No Mac do Homero, exige macOS 13 ou mais novo. | Nada no Windows. | ok |

## 43.0

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| Diálogos abrem em **Downloads** quando não recebem `defaultPath`, e o sistema deixa de lembrar a última pasta. | ⚠️ (a confirmar) | Todos os diálogos passam `defaultPath`. Abrir arquivo/pasta passam a pasta pessoal (`main.js:4271`, `:4471`, `:4619`) e "Exportar conversa" passa o caminho completo em Downloads (`main.js:4888`): sem mudança. "Salvar imagem" e "salvar arquivo" passam **só o nome**, sem pasta (`main.js:371`, `:376`). | Talvez a janela "Salvar como" de imagem gerada passe a abrir sempre em Downloads, em vez da última pasta usada. | leva 1: conferir ao vivo; se mudou, guardar a última pasta e passar caminho completo |
| `NativeImage.toBitmap()` normaliza cor para sRGB. | ✅ | O Cockpit só **cria** imagem de bitmap (`createFromBitmap`, selo da barra de tarefas em `visual-mac-native.js:195`); não lê bitmap. | Nada. | ok |
| Cantos arredondados e botões da janela (WCO) seguindo o tema no Linux; `showHiddenFiles` removido no Linux; CSS de extensão em quadros extras. | ✅ | Só Linux ou extensões; o Cockpit roda no Windows e no Mac e não usa extensões. | Nada. | ok |

## 42.0

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| Notificação no macOS passa para `UNNotification` e exige app **assinado**; sem assinatura, a notificação falha. | ⚠️ só Mac | Notificações web do renderer: `renderer/app.js:5238`, `:5680`, `:8176`, `:10901` (`new Notification`). O Cockpit não é assinado. | No Windows, nada. No Mac, os avisos "uma pergunta pra você" e "precisa da sua permissão" podem parar de aparecer. | ok no Windows; anotar para o Mac |
| `electron` do npm não baixa mais o binário no `postinstall`. | ✅ | Só afeta ferramenta que roda `npx electron`; o app usa o runtime do ZIP oficial. | Nada. | ok |
| `quotas` em `clearStorageData`, `hslShift` em lista no `createFromNamedImage`, escala 1.0 no offscreen. | ✅ | Não usados. | Nada. | ok |

## 41.0, 40.0 e 39.0

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| 41: PDF não cria mais um `WebContents` separado; causa da mudança de cookie; `showHiddenFiles` no Linux (aviso). | ✅ | O Cockpit não abre PDF em `WebContents` nem lê cookies. | Nada. | ok |
| 40: `clipboard` no renderer avisado (removido no 44); símbolos do Mac em `.tar.xz`. | ✅ | Ver linha do 44. | Nada. | ok |
| 39: `window.open` sempre redimensionável. | ✅ | Toda tentativa de abrir janela é negada (`setWindowOpenHandler`, `main.js:4539` e `cockpit-ipc-security.js:137`). | Nada. | ok |
| 39: `desktopCapturer` no Mac ≥ 14.2 pede `NSAudioCaptureUsageDescription` para áudio. | ✅ | O recorte de tela usa só a foto da tela, sem áudio (`main.js:6746`). | Nada. | ok |
| 39: `--host-rules` avisado; evento `paint` do offscreen mudou. | ✅ | Não usados. | Nada. | ok |

## 38.0, 37.0 e 36.0

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| 38: `webFrame.routingId` e `findFrameByRoutingId` avisados (renderer). | ✅ | O Cockpit usa `routingId` do **`WebFrameMain`** (processo principal) na trava do IPC (`cockpit-ipc-security.js:27-28`). A sonda prova que ele ainda existe no 44.5.1; `frameToken` também existe. | Nada hoje. | ok (no futuro, trocar por `frameToken`) |
| 38: fim do macOS 11, do evento `plugin-crashed` e de variáveis de ambiente do Linux. | ✅ | Não usados. | Nada. | ok |
| 37: rejeição solta não derruba mais o *utility process*; `process.exit()` síncrono nele; WebUSB/WebSerial com lista de bloqueio; `ProtocolResponse.session = null` removido. | ✅ | O Cockpit não usa `utilityProcess`, WebUSB, WebSerial nem `protocol`. | Nada. | ok |
| 37: `BrowserWindow.isVisibleOnAllWorkspaces()` devolve `false` no Linux com a janela escondida. | ✅ | Não usado (nem `setVisibleOnAllWorkspaces`); só Linux. | Nada. | ok |
| 36: **`app.commandLine` converte maiúsculas**. | ✅ (provado) | O Cockpit lê `--user-data-dir` por `app.commandLine.getSwitchValue` (`main.js:47`) e grava `--max-old-space-size` (`main.js:57`, já minúsculo). A sonda passou uma pasta com maiúsculas: o valor voltou **igual** no 32.3.3 e no 44.5.1. | Nada: o perfil do Homero (`--user-data-dir`) continua na mesma pasta. | ok |
| 36: `getBitmap` avisado; `isDefault`/`status` saem de `PrinterInfo`; `syncable` sai de `clearStorageData` e a opção `quota` fica avisada; `ProtocolResponse.session = null` avisado (removido no 37); extensões vão para `session.extensions`; GTK 4 no GNOME. | ✅ | Não usados (nem `getBitmap`/`toBitmap`, `getPrinters`, `clearStorageData` ou `protocol`). | Nada. | ok |
| 36: `systemPreferences.isAeroGlassEnabled()` removido (avisado no 35). | ✅ | Não usado (a sonda confirma que sumiu). | Nada. | ok |

## 35.0, 34.0 e 33.0

| Mudança oficial | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| 35: evento `console-message` com argumentos soltos avisado; `setPreloads` avisado; `fromVersionID` avisado; `urls: []` do `WebRequestFilter`; diálogo do Linux. | ✅ | Nenhum usado. O log da tela da leva 0 captura o console **pelo renderer** (`tela:log`), não por `console-message`. | Nada. | ok |
| 34: barra de menu some em tela cheia no Windows. | ✅ | A janela já usa barra de título própria com `setMenuBarVisibility(false)` (`visual-mac-native.js:213`). | Nada. | ok |
| 33: `document.execCommand("paste")` avisado. | ✅ | Não usado no renderer (os `execCommand` do código são nomes do protocolo do Codex). | Nada. | ok |
| 33: propriedades de quadro podem vir **desligadas** (`detached`) ou nulas. | ✅ (melhorou) | A trava do IPC lê `event.senderFrame` na hora, sem `await` (`cockpit-ipc-security.js:52`), e já testa `frame.detached` e `frame.isDestroyed?.()` (linhas 25-26). No 32.3.3 esses dois **não existiam** (a sonda mostra `undefined`); no 44.5.1 existem. A checagem, que era inerte, passou a valer. | Nada visível; um quadro em troca de página passa a ser recusado, como manda a trava. | ok |
| 33: protocolo próprio com caminho do Windows; `webContents` nulo no evento `login`; `type: 'textured'` avisado; fim do macOS 10.15; `accessibilityDisplayShouldReduceTransparency` avisado. | ✅ | Não usados. | Nada. | ok |
| 33: módulos nativos exigem C++20. | ✅ (provado em 30/09) | `@lydell/node-pty` (terminal embutido). A prova do runtime de 30/09 (`artifacts/runtime-probe.json`) abriu o PTY no 44.5.1. | Nada. | ok |

## Chromium 128 → 152 no renderer

Versões medidas pela sonda: Chromium 128.0.6613.186 (Electron 32.3.3) → 152.0.7977.130 (Electron 44.5.1). A lista oficial do Electron não cobre o Chromium; abaixo, o que o renderer do Cockpit usa (seções `web` e `css` do `inventario.json`) e o que se sabe do salto.

| Área | Afeta? | Onde no Cockpit | O que o Hugo sentiria | Ação |
|---|---|---|---|---|
| **Colar no campo de mensagem** (evento `paste`, `clipboardData`). | ❌ por tabela | `renderer/app.js:900`. O evento só resolve arquivo que já tem caminho no disco. Imagem copiada (print) não tem caminho: o código pede ao processo principal (`window.api.colados()`, `app.js:907`), que quebrou no 44 (`readImage` sumiu). | Colar print/imagem não anexa nada. | leva 1: corrigir (no main, `clipboard.read()` com `image/png`; ou ler o `File` do próprio evento) |
| **Colar no terminal embutido** (Ctrl+V, botão direito, botão "Colar" do login). | ❌ por tabela | `renderer/app.js:8606` chama `window.api.textoCopiado()`; o main devolve `{ texto: Promise }`, que a ponte não consegue enviar ("#<Promise> could not be cloned", provado na sonda); o `catch {}` da linha 8606 engole o erro. | "Não tem texto copiado pra colar" com texto copiado; no login, "Cole o código diretamente no campo com Ctrl+V". | leva 1: corrigir |
| `navigator.clipboard.writeText` (copiar mensagem, bloco de código, caminho). | ✅ | `renderer/app.js:3344`, `:9199`; `renderer/reader-tools.js:122`. A permissão `clipboard-sanitized-write` continua liberada em `cockpit-ipc-security.js:7`. Nenhuma mudança conhecida no salto. | Nada. | ok |
| `File.path` (caminho do arquivo arrastado). | ✅ | Saiu no Electron **32.0**, antes do 32.3.3. O Cockpit já usa `webUtils.getPathForFile` (`preload.js:23`); o `f.path` de reserva em `renderer/app.js:1359` é código morto desde então. A assinatura de `getPathForFile` é a mesma nas tipagens oficiais 32.3.3 e 44.5.1. | Nada novo. | ok |
| Notificação web, microfone (`getUserMedia`, `enumerateDevices`), `AudioContext`, `ResizeObserver`. | ✅ | `renderer/app.js:539`, `:560`, `:12330`, `:12371`; `renderer/live-voice.js`. A prova do runtime de 30/09 enumerou o microfone no 44.5.1. | Nada no Windows (notificação no Mac: ver 42.0). | ok |
| Evento `unload`. | ✅ | `renderer/app.js:13149` só solta um ouvinte quando a página fecha. Os outros três (`app.js:3038`, `cockpit-ui.js:2963`, `live-voice.js:192`) são `beforeunload`, que não está saindo. | Nada, mesmo se o Chromium deixar de disparar `unload`. | ok |
| **CSS**: `color-mix()` (54), `:focus-visible` (38), `:has()` (32), `::-webkit-scrollbar` (23) com `scrollbar-width/color` (12), `@container` (12), `-webkit-app-region` (9), `backdrop-filter` (8), `appearance` (5), `-webkit-line-clamp` (4), `::selection` (1), `env(titlebar-area-*)` (1). | ⚠️ (só visual, a confirmar) | `src/renderer/*.css`. Tudo isso já existia no Chromium 128. Mudanças conhecidas no caminho: (1) desde o 121, `scrollbar-width/color` vencem `::-webkit-scrollbar` no mesmo elemento: já valia no 128; (2) áreas com rolagem sem nada focável passam a receber o Tab (Chromium 130): o Tab pode parar numa lista; (3) herança de `::selection` (Chromium 134): a regra do Cockpit vale para todos os elementos (`html[data-tema="motti"] ::selection`), então não muda. | Talvez o Tab pare em painéis com rolagem. Diferença de desenho só se vê abrindo a tela. | ok na API; conferência visual fica com a auditoria de tela |

## Node 20.18.1 → 24.21.0 no processo principal

O Electron 44.5.1 traz o Node 24.21.0 (o 32.3.3 trazia o 20.18.1). A suíte do Cockpit (`node --test`) já roda no Node 24.21.0 desta máquina, então o código do processo principal que tem teste já é exercitado no Node novo. O único módulo nativo (`@lydell/node-pty`) foi provado no runtime 44.5.1 em 30/09.

Lista oficial cruzada: `https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/deprecations.md`, baixada em 01/10/2026. Entre o 20.18.1 e o 24.21.0 ela tem **31 remoções** (End-of-Life: `util.is*` e `util.log`, `tls.createSecurePair`/`SecurePair`, `crypto.createCipher`/`createDecipher`, `fs.truncate` com descritor, `timers.enroll`/`unenroll`/`active`/`_unrefActive`, `process.assert`, `zlib.bytesRead`, `net._setSimultaneousAccepts`, `tls` `Server.setOptions`, `OutgoingMessage._headers`, `dirent.path`, `--trace-atomics-wait`, prioridade do HTTP/2) e **16 avisos novos** (Runtime/Application: `SlowBuffer`, `punycode`, `util.isArray`, `util._extend`, `crypto.fips`, `url.parse`, `promisify` de Promise, `fs.F_OK`…, `new Hash`/`Hmac`/`fs.Stats`, GCM curto, `zlib`/`repl` sem `new`, `fs.existsSync` com tipo errado, `spawn` com `shell: true` e argumentos).

| API do Node que o Cockpit usa | Mudança 20 → 24 | Onde | Afeta? | Ação |
|---|---|---|---|---|
| `readdir`/`readdirSync` com `withFileTypes` e `fs.opendir` | `dirent.path` removido no 24 (DEP0178) | `main.js:2073`, `:2492`, `:2954`, `:2994`, `:4652`, `:5102`, `:5253`; `cockpit-search.js:46`; `claude-sessions-scan.js:10`; `cockpit-remote-native.js:20`; `leitura-mcp.js:91` | ✅ Só leem `.name` e montam o caminho com `path.join(dir, e.name)`. (`main.js:849` lê `it.path` de um item do protocolo do Codex, não de pasta.) | ok |
| `fs.existsSync` (43 usos) | Argumento que não é texto passa a gerar aviso no console (DEP0187, Node 24) | ex.: `main.js:4320`, `:4975`, `:5535`; `acp.js:777` | ✅ Todos recebem texto ou vêm depois de `!f \|\|`; o resultado continua o mesmo. | ok |
| `child_process.spawn` | `shell: true` com lista de argumentos passa a avisar (DEP0190, Node 24) | `main.js:2` e o que roda motores | ✅ Nenhuma chamada usa a opção `shell` (as ocorrências de `shell:` são nomes de canal, `main.js:4903`, `:4969`, `:4983`). | ok |
| Achar e rodar `.cmd`/`.bat` no Windows (`claude.cmd`, `codex.cmd`) | Exigência de shell para `.cmd`/`.bat` (CVE-2024-27980) | `plataforma.js:77`, `:152`; `engine-updates.js:83` | ✅ Não mudou entre as duas versões: já valia desde o Node 20.12.2, antes do 20.18.1 do Electron 32.3.3. | ok |
| `crypto.randomBytes`, `createHmac`, `randomUUID` | `new Hash`/`new Hmac` avisados (DEP0179/0181) | `cockpit-experiments.js:78-80`; `cockpit-remote-transport.js:127` | ✅ Usa as funções de fábrica, não o `new`. | ok |
| `fetch` global do Node (undici 6 → 7) | Motor de rede trocado; sem remoção na lista oficial | `cockpit-experiments.js:71`, `main.js:4118` (reserva do `net.fetch`), `model-benchmarks.js:78` | ✅ Nenhuma mudança conhecida no uso do Cockpit; a suíte roda no Node 24.21.0. Rede real não testada. | ok |

Procurado em `src/` (fora `vendor`): nenhuma das 31 remoções aparece. Os dois "achados" da busca eram outra coisa: `window.bytesRead` (`cockpit-search.js:116`) é o retorno de leitura de arquivo do próprio Cockpit, e `marked.setOptions` (`renderer/app.js:116`) é da biblioteca de Markdown.
