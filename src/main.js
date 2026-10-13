const { app, BrowserWindow, ipcMain: electronIpcMain, dialog, Menu, shell, clipboard, globalShortcut, desktopCapturer, screen, crashReporter, nativeTheme, systemPreferences, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const plataforma = require('./plataforma');
const { EH_WIN, acharBin, spawnBin, abrirPty, matarProcesso, temBin } = plataforma;
// Prévias não devem registrar atalhos com a identidade do aplicativo instalado.
const WINDOWS_APP_ID = app.isPackaged ? 'com.homeromotti.cockpit' : 'com.homeromotti.cockpit.dev';

/* Formato das mensagens do codex app-server (0.147.0) em funcoes puras e
   testadas: montar thread/start e thread/resume, responder aprovacao,
   permissao e pergunta nativa, ler skills/list e app/list. Fica separado
   porque e' a parte que MUDA quando o Codex muda - e a unica que da' pra
   testar sem subir o Electron (test/codex-protocol.test.js). */
const proto = require('./codex-protocol');
const capabilities = require('./cockpit-capabilities');
const historyPages = require('./cockpit-history');
const cockpitInteractions = require('./cockpit-interactions');
const { createRemoteHostBridge } = require('./cockpit-remote-host');
const { createExperiments, imageData: validateGeneratedImage } = require('./cockpit-experiments');
const { codexApprovalDetails } = require('./cockpit-approval');
const { criarObservabilidade, resultadoFerramenta, listarRuntimeCodex } = require('./cockpit-observability');
const cockpitWorktrees = require('./cockpit-worktrees');
// leva 41 (B6) + Tarefa 6: nome automatico da conversa (acompanha o trabalho) + regra dos nomes (seu > automatico)
const tituloAuto = require('./titulo-auto');
// Tarefas 1 e 3 (26/09): o executor unico do "claude -p" rapido e o Mais detalhes que o usa
const { criarClaudeRapido } = require('./claude-rapido');
const { criarMaisDetalhes } = require('./mais-detalhes');
// Tarefa 7 (27/09): nome dos agentes em portugues de gente (2 palavras + uma linha), pelo mesmo executor
const nomesAgentes = require('./nomes-agentes');
// Tarefa 5 (26/09): reabrir traz a conversa inteira (leitura em blocos, corte por contagem de falas)
const { varrerLinhas, cortarHistorico, historicoParaTela } = require('./historico-leitura');
// Tarefa 8 (26/09): pergunta (AskUserQuestion) e plano pronto (ExitPlanMode) do Claude, em funcoes puras
const interacao = require('./claude-interacao');
// Tarefa 9 (27/09): desfazer a edicao da IA direto no passo (o nucleo puro que decide o conteudo)
const desfazerEdicao = require('./desfazer-edicao');
const { createVisualMacNative } = require('./visual-mac-native');
const { createEngineUpdater } = require('./engine-updates');
const modelBenchmarks = require('./model-benchmarks').createModelBenchmarks({ directory: () => app.getPath('userData') });

const HOME = os.homedir();
/* JANELA DE TESTE (rodada 2 da leva 5i). Com COCKPIT_JANELA_TESTE=1 no ambiente, o app abre marcado como TESTE: o titulo da janela diz isso, a tela
   poe uma faixa vermelha no topo (window.api.janelaDeTeste, vindo do preload) e NENHUMA mensagem sai para motor nenhum (pane:send, pane:steer,
   pane:compactar, o Debater e o Mais detalhes recusam com o aviso abaixo). Nasceu de um incidente: a janela de teste de uma auditoria abriu as
   conversas REAIS do Hugo, e ele digitou numa delas achando que era o Cockpit dele. Quem abre o candidato por tools/auditoria/abrir-candidato-teste.ps1
   (ou pelo rodada1-vital.ps1) ja' ganha isso, numa copia do perfil sem conversas. So' o valor "1" vale; sem a variavel nada muda. */
const JANELA_DE_TESTE = process.env.COCKPIT_JANELA_TESTE === '1';
const TITULO_JANELA_DE_TESTE = 'TESTE — não use';
const AVISO_JANELA_DE_TESTE = 'Janela de teste: o envio de mensagens aos motores está desligado aqui.';
const barrarNaJanelaDeTeste = () => { if (JANELA_DE_TESTE) throw new Error(AVISO_JANELA_DE_TESTE); };
// Perfil explícito para prévias/testes: o mesmo ASAR pode ser conferido sem
// abrir ou gravar o config.json da instalação em uso. Sem a opção, nada muda.
const explicitUserData = app.commandLine?.getSwitchValue('user-data-dir');
if (explicitUserData) {
  if (!path.isAbsolute(explicitUserData)) throw new Error('A pasta de dados precisa ser absoluta.');
  fs.mkdirSync(explicitUserData, { recursive: true });
  app.setPath('userData', explicitUserData);
}
/* Leva 41 (B2): folga de memoria pra tela. O padrao do V8 corta o heap da tela
   bem antes da RAM da maquina acabar; com 20 paineis e conversas longas isso
   vira queda da tela, e a tela que cai leva todos os motores junto. Tem que vir
   antes do 'ready'. O Hugo autorizou gastar RAM (pedido de 14/09). */
try { app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096'); } catch (e) { logMain('js-flags', e); }
// se a tela (ou outro processo do app) cair, fica o dump local pra investigar; nada sobe pra rede
try { if (crashReporter && crashReporter.start) crashReporter.start({ uploadToServer: false }); } catch (e) { logMain('crashReporter', e); }
// no Mac o Claude mora sempre no mesmo lugar; no Windows a gente procura.
// FUNCAO, nao const: congelado no boot, o caminho ficava preso no binario
// velho se o instalador do Claude trocasse de pasta com o app aberto - e o
// acharBin ja revalida o cache a cada chamada justamente pra isso.
function claudeBin() { return EH_WIN ? acharBin('claude') : path.join(HOME, '.local/bin/claude'); }
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

/* Uma janela so'. Sem isto, abrir o Cockpit de novo (ou ele subir no logon e
   voce clicar no atalho) criava uma segunda janela que gravava o MESMO
   config.json: a ultima a salvar apagava os paineis da outra.
   Fica AQUI EM CIMA de proposito: o app.quit() da segunda instancia dispara o
   'before-quit', e um dos ouvintes limpa a pasta de audio, que e' compartilhada
   -- registrado depois, ele apagaria o ditado em andamento da primeira janela. */
if (!app.requestSingleInstanceLock()) {
  // o return e' essencial: app.quit() NAO impede o 'ready' de disparar, e o
  // arranque desta segunda janela apagaria o audio e as perguntas da primeira
  app.quit();
  return;
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
}

let win = null;
const ipcSecurity = require('./cockpit-ipc-security').createIpcSecurity({
  ipcMain: electronIpcMain,
  getMainWindow: () => win,
  getCaptureWindow: () => recorte?.janela,
  mainFile: path.join(__dirname, 'renderer/index.html'),
  captureFile: path.join(__dirname, 'renderer/recorte.html'),
  log: logMain,   // logMain é function (içada): já vale aqui, antes da linha que a define
});
const ipcMain = ipcSecurity.ipcMain;

/* ======================= log de erros da tela ======================= */
/* userData/logs/tela.log (src/log-tela.js). O que quebra na tela (erro de script,
   promessa sem tratamento, console.error) chega pelo canal 'tela:log'; os catch
   do main usam logMain(contexto, erro). Antes, quem quebrava calado nao deixava
   rastro em lugar nenhum (colar imagem parou de funcionar e ninguem viu). So'
   REGISTRA: nao mexe em tela, em motores nem na rotina de quedas (quedas.js). */
/* O require fica DENTRO das funcoes e o estado e' `var` sem valor inicial (nao const/let):
   o logMain tem de funcionar tambem num catch que roda ANTES deste bloco (js-flags e
   crashReporter, nas primeiras linhas do arquivo; a leva 1 troca por logMain). Com const/let
   ele cairia na zona morta e o try/catch do registrarNoMain engoliria o erro; e um `= null`
   aqui zeraria o log que uma chamada de antes ja abriu. */
var logTelaAtual;
// criado no primeiro uso (o 'ready' abre uma vez): o userData so' vale depois do --user-data-dir la' em cima
function logDaTela() {
  if (!logTelaAtual) logTelaAtual = require('./log-tela').criarLogTela({ dir: path.join(app.getPath('userData'), 'logs') });
  return logTelaAtual;
}
function registrarNoMain(tipo, contexto, erro) {
  try {
    const d = require('./log-tela').descreverErro(erro);
    logDaTela().registrar({ origem: 'main', tipo, contexto, msg: d.msg, stack: d.stack });
  } catch {}
}
/* contexto = onde foi ('colar', 'config:set'...); erro = o que o catch pegou (Error,
   texto, objeto, o que for). Nunca lanca: pode ir dentro de qualquer catch. */
function logMain(contexto, erro) { registrarNoMain('erro', contexto, erro); }
/* promessa sem catch: so' anota, o resto segue como esta. So' no Electron de verdade:
   os testes que carregam este arquivo com um Electron falso nao herdam um ouvinte
   global no processo deles. */
if (process.versions && process.versions.electron) {
  process.on('unhandledRejection', (motivo) => registrarNoMain('promessa', 'unhandledRejection', motivo));
}
const TIPOS_DA_TELA = ['erro', 'promessa', 'console'];
ipcMain.on('tela:log', (_e, entrada) => {
  try {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return;
    // a tela nao escolhe a origem nem inventa tipo; so' estes campos entram (o modulo corta e mascara)
    logDaTela().registrar({
      origem: 'tela', tipo: TIPOS_DA_TELA.includes(entrada.tipo) ? entrada.tipo : 'erro',
      msg: entrada.msg, stack: entrada.stack, fonte: entrada.fonte, linha: entrada.linha, coluna: entrada.coluna,
    });
  } catch {}
});

/* ======================= util ======================= */
/* Leva 5 (tela azul de 05/10: o Cockpit voltou do padrao, 2 abas e sem tema, e a 2a gravacao regravou o .bak com ele).
   Arquivo que nao abre por CONTEUDO (JSON ruim, vazio, zeros de queda, null, lista) sai do caminho com a data no nome
   (config.json.corrompido-AAAAMMDD-HHMMSS; nunca e' apagado) e o .bak entra no lugar. Erro de LEITURA (EBUSY, EPERM: o
   antivirus) nao renomeia nada. Se nenhum dos dois abrir, a sessao comeca do padrao e loadConfig.semCopia fica ligado:
   o saveConfig desta sessao nao regrava o .bak (o padrao nunca toma o lugar da ultima copia boa).
   Onda 1 (revisao): arquivo PRESO (EBUSY, EPERM, EACCES: o antivirus) e' lido de novo 3 vezes (20, 40 e 60 ms, como o gravarSeguro)
   e nao liga o semCopia, que so' liga por conteudo ruim. Preso o tempo todo: o .bak entra no lugar; sem .bak a sessao abre do
   padrao e loadConfig.naoLido fica ligado: o saveConfig nao grava por cima do config.json que nao foi lido (volta a gravar quando
   uma leitura der certo). A tela le so' uma vez (config:get): se recebeu o padrao, fica com ele na mao e so' volta a gravar
   relendo (loadConfig.telaComPadrao), senao gravaria o padrao por cima do original assim que o antivirus o soltasse.
   Rodada final: o .bak PRESO tambem liga o naoLido (antes so' o config.json). Com o config ruim ou sumido e o .bak preso, a
   sessao abria do padrao e gravava: o padrao tomava o lugar do .bak bom na 2a gravacao (config sumido) ou na 1a da sessao
   seguinte (config ruim). Primeira execucao (os dois ENOENT) continua gravando. */
function loadConfig() {
  const arquivo = CONFIG_PATH();
  const ler = (alvo) => {
    const cfg = JSON.parse(fs.readFileSync(alvo, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Configuração inválida.');
    return cfg;
  };
  const lerInsistindo = (alvo) => {
    for (let i = 1; ; i++) {
      try { return ler(alvo); }
      catch (e) {
        if (i > 3 || !(e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'))) throw e;
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * i); } catch {}
      }
    }
  };
  const anotar = (onde, e) => { if (typeof logMain === 'function') logMain(onde, e); };
  const guardarRuim = (alvo) => {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const base = alvo + '.corrompido-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
    let nome = base;
    for (let i = 2; fs.existsSync(nome); i++) nome = base + '-' + i;
    try { fs.renameSync(alvo, nome); anotar('config', new Error(path.basename(alvo) + ' não abriu; guardado como ' + path.basename(nome))); }
    catch (e) { anotar('config:guardar-corrompido', e); }
  };
  const avisou = loadConfig.naoLido === true;
  loadConfig.naoLido = false;   // cada leitura reavalia: so' o padrao devolvido por um config preso volta a ligar
  let perdeu = false, preso = false;
  const falhou = (alvo, e) => {
    if (e && e.code === 'ENOENT') return;
    if (e && e.code) { preso = true; return; }   // erro de LEITURA (preso), do config ou do .bak: o arquivo fica onde esta e nao e' arquivo ruim
    perdeu = true; guardarRuim(alvo);   // conteudo ruim
  };
  try { return lerInsistindo(arquivo); } catch (e) { falhou(arquivo, e); }
  // arquivo corrompido (queda no meio de uma gravacao antiga): usa o backup
  try { return lerInsistindo(arquivo + '.bak'); } catch (e) { falhou(arquivo + '.bak', e); }
  if (perdeu) loadConfig.semCopia = true;
  if (preso) {
    loadConfig.naoLido = true;
    if (!avisou) anotar('config', new Error('config.json e config.json.bak não abriram (um deles preso?): a sessão começa do padrão e não grava por cima deles até um ser lido'));
  }
  return {};
}
/* grava em arquivo temporario e so' depois troca pelo bom: se a maquina cair
   no meio, o config antigo continua inteiro (antes perdia tudo de uma vez).
   Leva 5: o temporario vai ao disco (fsync) ANTES do rename, e a copia de seguranca tambem sai por temporario + fsync +
   rename. Sem o fsync o rename chegava ao disco antes dos dados: na tela azul de 05/10 o config e o .bak viraram zeros.
   Antivirus e indexador seguram um arquivo recem-criado ou renomeado por alguns ms (EBUSY, EPERM, EACCES): o temporario e
   o rename final insistem 3 vezes (20, 40 e 60 ms) antes de desistir; outro erro sobe na hora.
   Onda 1 (revisao): sem validador proprio o arquivo antigo so' vira .bak se abre como JSON (o indice, as versoes e o
   cockpit-prompts.json guardavam o vazio ou os zeros de uma queda e perdiam a copia boa). */
function gravarSeguro(destino, texto, validarAnterior) {
  const abreComoJson = (anterior) => { try { JSON.parse(anterior); return true; } catch { return false; } };
  const escrever = (alvo, dados) => {
    const fd = fs.openSync(alvo, 'w');
    try { fs.writeFileSync(fd, dados); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  const insistir = (fn) => {
    for (let i = 1; ; i++) {
      try { return fn(); }
      catch (e) {
        if (i > 3 || !(e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'))) throw e;
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * i); } catch {}
      }
    }
  };
  const tmp = destino + '.tmp';
  try {
    insistir(() => escrever(tmp, texto));
    try {
      if (fs.existsSync(destino)) {
        const anterior = fs.readFileSync(destino);
        if ((validarAnterior || abreComoJson)(anterior.toString('utf8'))) {
          const tmpBak = destino + '.bak.tmp';
          try { escrever(tmpBak, anterior); fs.renameSync(tmpBak, destino + '.bak'); }
          catch { try { fs.unlinkSync(tmpBak); } catch {} }
        }
      }
    } catch {}
    insistir(() => fs.renameSync(tmp, destino));
    return true;
  } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
}
function saveConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
  // onda 1: config.json preso que nao foi lido (sem .bak) nao e' sobrescrito pelo padrao (ver loadConfig.naoLido e telaComPadrao)
  if (typeof loadConfig === 'function' && (loadConfig.naoLido === true || loadConfig.telaComPadrao === true)) return false;
  // leva 5: a sessao que comecou do padrao (config e .bak ruins) nao regrava o .bak (ver loadConfig)
  const semCopia = typeof loadConfig === 'function' && loadConfig.semCopia === true;
  try {
    return gravarSeguro(CONFIG_PATH(), JSON.stringify(cfg, null, 2), (anterior) => {
      if (semCopia) return false;
      const value = JSON.parse(anterior);
      return value && typeof value === 'object' && !Array.isArray(value);
    });
  } catch { return false; }
}

// app GUI nao herda o PATH do shell: monta um PATH completo (ver plataforma.js)
const buildEnv = plataforma.buildEnv;

// Só a instalação normal atualiza motores. Prévias, testes e perfis isolados não
// executam instaladores nem alteram os CLIs da máquina.
let engineUpdateQuitting = false;
const engineUpdates = createEngineUpdater({
  // rodada 2 da leva 5: com o config nao lido o padrao nao e' o "ligado" seu: nao atualiza desta vez (naoLido, ou semCopia com esta
  // leitura devolvendo o padrao). O semCopia nao desliga na sessao: se o .bak soltou e esta leitura trouxe um config de verdade
  // (alguma chave), vale o que foi lido. O start() roda uma vez, no whenReady: sem isso nem o recover() do Codex rodava na sessao.
  enabled: () => app.isPackaged && !explicitUserData && ((c) => c.autoUpdateEngines !== false && loadConfig.naoLido !== true && (loadConfig.semCopia !== true || Object.keys(c).length > 0))(loadConfig()),
  directory: () => path.join(app.getPath('userData'), 'engine-updates'),
  findBin: acharBin, spawnBin, stopProcess: matarProcesso, env: buildEnv,
  onUpdated: () => {
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'versoes-motores.json')); } catch (e) { if (e?.code !== 'ENOENT') logMain('versoes-motores', e); }
  },
});
ipcMain.handle('motores:atualizacoes', () => engineUpdates.snapshot());
let engineUpdatesClosing = false;
app.on('before-quit', event => {
  engineUpdateQuitting = true;
  if (!engineUpdates.running) return;
  event.preventDefault();
  if (engineUpdatesClosing) return;
  engineUpdatesClosing = true;
  // Não sair no meio de uma troca: cancelar o instalador e terminar a restauração.
  engineUpdates.stop().then(() => app.quit(), () => app.quit());
});

/* Leva 41 (B2): quem esta no meio de um turno, que tipo de queda foi, o
   registro em userData/logs/motores.log e o retomar.json (quedas.js). */
const quedas = require('./quedas');
const registrarQueda = quedas.criarRegistro(() => app.getPath('userData'));
const vigiaTurno = quedas.criarVigiaDeTurno({ registrar: registrarQueda });
const retomada = quedas.criarRetomada(() => app.getPath('userData'));

const debateListeners = new Map();

/* Tarefa 9 (27/09): o que o PROPRIO main mandou pra tela como mudanca de
   arquivo (o tool-start do Claude e do ACP, e o diff tardio tool-mudanca do
   ACP), por painel e passo, e como o passo terminou (tool-end). O "Desfazer
   esta mudança" (arquivo:desfazer) usa SO' isto: a tela manda { paneId, id },
   nunca o antes/depois, e so' passo que o main viu terminar ok se desfaz
   (negado ou com erro nao mudou nada). Painel remoto nao entra (o caminho e'
   do servidor). Guarda uma COPIA, com teto de 300 passos e ~8 milhoes de
   letras por painel (o mais velho sai primeiro). O 'busy' ate' o 'turn-end'
   marca o painel trabalhando: o ACP nao passa pelo vigiaTurno.
   Revisao 1: id repetido no painel (um segundo tool-start, ou uma segunda
   mudanca pro mesmo passo) vira marca de "nao desfaz": a tela acharia o passo
   mais novo e o registro teria o primeiro. Os ids vistos sem mudanca (Bash,
   Read...) ficam num mapa leve, com o mesmo teto, so' pra achar a repeticao e
   dar o fim ao diff tardio do ACP. O registro so' e' esquecido quando o
   painel fecha ou a conversa troca (pane:stop com esquecerMudancas): parada
   comum (fim de turno no fundo, troca de aba, conta) mantem o desfazer. */
const mudancasEmitidas = new Map();   // paneId -> { itens: Map(id -> registro), letras, vistos: Map(id -> ''|'ok'|'erro') }
const paineisEmTrabalho = new Set();  // paneId
const MUDANCAS_POR_PAINEL = 300;
const LETRAS_POR_PAINEL = 8 * 1024 * 1024;
function guardarMudancaEmitida(paneId, kind, data) {
  const chave = String(paneId);
  if (kind === 'busy') { paineisEmTrabalho.add(chave); return; }
  if (kind === 'turn-end' || kind === 'engine-down') { paineisEmTrabalho.delete(chave); return; }
  if (kind !== 'tool-start' && kind !== 'tool-mudanca' && kind !== 'tool-end') return;
  if (!data || data.id == null || data.id === '') return;
  if (data.remoto || remotePaneTargets.has(paneId) || claudeRemoto.has(paneId)) return;
  const id = String(data.id);
  let doPainel = mudancasEmitidas.get(chave);
  if (!doPainel) { doPainel = { itens: new Map(), letras: 0, vistos: new Map() }; mudancasEmitidas.set(chave, doPainel); }
  const { itens, vistos } = doPainel;
  const registro = itens.get(id);
  if (kind === 'tool-end') {
    const fim = data.error ? 'erro' : 'ok';
    if (registro) { if (!registro.fim) registro.fim = fim; return; }
    if (!vistos.get(id)) vistos.set(id, fim);   // o primeiro fim vale
  } else if (registro || (kind === 'tool-start' && vistos.has(id))) {
    // id repetido: nenhum dos dois passos se desfaz (e um terceiro aviso nao ressuscita)
    if (registro) doPainel.letras -= registro.letras;
    vistos.delete(id);
    itens.set(id, { repetido: true, letras: 0, fim: '' });
    return;
  } else {
    const m = data.mudanca;
    if (!m || typeof m !== 'object') { if (kind === 'tool-start') vistos.set(id, ''); }
    else {
      const mudanca = desfazerEdicao.daMudancaEmitida(m);
      const letras = mudanca.partes.reduce((n, p) => n + p.antes.length + p.depois.length, 0);
      const fim = vistos.get(id) || '';   // o diff tardio do ACP herda o fim que ja' chegou
      vistos.delete(id);
      itens.set(id, { path: String(m.path || ''), tipo: mudanca.tipo, mudanca, letras, fim });
      doPainel.letras += letras;
    }
  }
  while (itens.size > MUDANCAS_POR_PAINEL || (doPainel.letras > LETRAS_POR_PAINEL && itens.size > 1)) {
    const [velho, reg] = itens.entries().next().value;
    itens.delete(velho);
    doPainel.letras -= reg.letras;
  }
  while (vistos.size > MUDANCAS_POR_PAINEL) vistos.delete(vistos.keys().next().value);
}
/* parou: nao esta mais trabalhando. O que dava pra desfazer so' some quando o
   painel fecha ou a conversa troca (a tela avisa com esquecerMudancas) */
function esquecerMudancasDoPainel(paneId, conversaAcabou) {
  paineisEmTrabalho.delete(String(paneId));
  if (conversaAcabou) mudancasEmitidas.delete(String(paneId));
}

function emit(paneId, kind, data) {
  // fim de turno desliga o "em turno"; 'engine-down' sai dizendo se estava em turno e que tipo de queda foi
  data = vigiaTurno.passar(paneId, kind, data);
  // Identidade do acontecimento, independente do texto e dos rerenders da tela.
  if (['aviso-agente', 'turn-end', 'engine-down'].includes(kind)) {
    emit.origem ||= Date.now().toString(36);
    emit.sequencia = (emit.sequencia || 0) + 1;
    data = { ...data, occurrence: data?.occurrence || `${emit.origem}:${paneId}:${kind}:${emit.sequencia}`, replay: data?.replay === true };
  }
  const debateListener = debateListeners.get(paneId);
  if (debateListener) { debateListener({ paneId, kind, ...data, ...(kind === 'busy' ? { turnId: codex.paneTurn.get(paneId) } : {}) }); return; }
  // Tarefa 9: guarda a mudanca de arquivo que vai pra tela; um erro aqui nunca segura o evento
  try { guardarMudancaEmitida(paneId, kind, data); } catch {}
  if (win && !win.isDestroyed()) win.webContents.send('pane:event', { paneId, kind, ...data });
}

const observabilidade = criarObservabilidade((paneId, kind, data) => emit(paneId, kind, data));

/* ======================= motor CODEX ======================= */
/* um unico `codex app-server` atende todos os paineis, cada painel = uma thread */
const codex = {
  proc: null, id: 0, pend: new Map(), ready: null,
  /* 'proc' existe logo depois do spawn, mas o app-server so' responde de
     verdade DEPOIS do initialize. Quem quiser perguntar algo sem esperar
     (o menu "/") tem que olhar aqui, nao pro processo. */
  pronto: false,
  threadToPane: new Map(),   // threadId -> paneId
  paneToThread: new Map(),   // paneId -> threadId
  paneTurn: new Map(),       // paneId -> turnId em andamento
  paneErrors: new Map(),     // aviso transitório/erro já exibido no turno
  paneMsgId: new Map(),      // paneId -> id da fala que esta chegando letra a letra
  paneCwd: new Map(), generation: 0,
  derrubando: null,          // processo que o proprio app esta derrubando (troca de conta, fechar)
};
/* Onde o agente pode oferecer um arquivo no leitor (apresentar_artefato), ALEM da pasta da propria sessao: o Drive
   (G:\), as Projetos-* da home e as pastas das abas. Lido do config a cada chamada: aba nova vale na hora. Rede nunca. */
const pastasDeTrabalho = () => cockpitInteractions.workRoots({ home: HOME, abas: loadConfig().abas });
const interactionBroker = cockpitInteractions.createInteractionBroker({
  emit: (paneId, kind, data) => emit(paneId, kind, data),
  onHostAction: (scope, kind, data) => {
    const current = scope.engine === 'claude' ? claudePanes.get(scope.paneId) : remoteEngines.panes.get(scope.paneId);
    const valid = scope.engine === 'claude' ? !!current && !current.parandoDeProposito && String(current.geracao) === String(scope.generation)
      : scope.origin.kind === 'remote' ? current?.generation === scope.generation && !current.stopped
      : String(codex.generation) === String(scope.generation) && codex.paneToThread.has(scope.paneId)
        && (codex.paneToThread.get(scope.paneId) === scope.threadId || observabilidade.ownerOfThread(scope.threadId) === scope.paneId);
    if (!valid) return { ok: false };
    emit(scope.paneId, kind, data); return { ok: true };
  },
  validateRemoteFile: async ({ origin, cwd, file, paneId }) => {
    const remote = remotePaneTargets.get(paneId)?.remoto || claudeRemoto.get(paneId);
    if (!remote || String(remote.host).toLowerCase() !== origin.host || remote.usuario !== origin.user || Number(remote.porta || 22) !== Number(origin.port || 22)) throw Error('Destino mudou.');
    const result = await remoteTransport.run(remote, 'test -f ' + qLinux(file) + ' && realpath -- ' + qLinux(cwd) + ' ' + qLinux(file));
    const lines = result.trim().split('\n');
    return { root: lines[0], path: lines[1], isFile: lines.length === 2 };
  },
  workRoots: pastasDeTrabalho,
});
function codexScope(paneId, params = {}) {
  return { paneId, generation: codex.generation, engine: 'codex', origin: { kind: 'local' },
    threadId: params.threadId || params.thread?.id || codex.paneToThread.get(paneId) || '',
    turnId: params.turnId || params.turn?.id || codex.paneTurn.get(paneId) || '', cwd: codex.paneCwd.get(paneId) || HOME };
}
function claudeScope(paneId, m = {}) {
  const st = claudePanes.get(paneId), remote = claudeRemoto.get(paneId);
  return { paneId, generation: st?.geracao || 0, engine: 'claude', threadId: m.session_id || st?.sessionId || String(paneId),
    origin: remote ? { kind: 'remote', host: remote.host, user: remote.usuario, port: remote.porta || 22 } : { kind: 'local' },
    cwd: remote ? (st?.remoteHostCwd || '') : (claudeCwd.get(paneId) || HOME) };
}
ipcMain.handle('connector:respond', (_e, o) => interactionBroker.respond(o));
ipcMain.handle('connector:list', (_e, paneId) => interactionBroker.list(paneId));
const experiments = createExperiments({ folder: () => path.join(app.getPath('userData'), 'experiments'), safeStorage: require('electron').safeStorage, log: logMain });
const liveVoice = require('./cockpit-live').createLive({ request: experiments.request, authorize: experiments.authorize,
  resolveSession: o => {
    let current;
    if (remoteEngines.owns(o.paneId)) { const st = remoteEngines.panes.get(o.paneId); current = { engine: st.engine, threadId: st.session }; }
    else if (o.engine === 'codex') current = { engine: 'codex', threadId: codex.paneToThread.get(o.paneId) };
    else if (o.engine === 'claude') current = { engine: 'claude', threadId: claudePanes.get(o.paneId)?.sessionId };
    if (!current?.threadId || current.threadId !== o.threadId || current.engine !== o.engine) throw Error('Ligue esta sessão antes de conectar a voz.');
    return { paneId: o.paneId, ...current };
  } });
const experimentHandler = fn => async (_e, o) => { try { return await fn(o); } catch (e) { return { error: e.message }; } };
ipcMain.handle('experiments:liveOffer', experimentHandler(o => liveVoice.offer(o)));
ipcMain.handle('experiments:status', experimentHandler(() => experiments.status()));
ipcMain.handle('experiments:key', experimentHandler(key => experiments.setKey(key)));
ipcMain.handle('experiments:grant', experimentHandler(o => ({ grant: experiments.grant(o.feature, o.costAccepted) })));
ipcMain.handle('experiments:image', experimentHandler(o => experiments.generateImage(o)));
ipcMain.handle('experiments:cloudStart', experimentHandler(o => experiments.cloudStart(o)));
ipcMain.handle('experiments:cloudList', experimentHandler(() => experiments.cloudList()));
ipcMain.handle('experiments:cloudRead', experimentHandler(id => experiments.cloudRead(id)));
ipcMain.handle('experiments:cloudCancel', experimentHandler(id => experiments.cloudCancel(id)));
ipcMain.handle('experiments:cloudApprove', experimentHandler(o => experiments.cloudApprove(o)));
/* "Salvar como" no Electron 43+: com SÓ o nome no defaultPath o diálogo abre em Downloads e o Windows deixa de lembrar
   a última pasta. Por isso o defaultPath vai sempre ABSOLUTO: a pasta da conversa (se existir) ou Documentos, mais o
   nome. Só monta as opções; quem abre o diálogo é o handler. Caminho de rede (\\servidor) não é tocado no disco: o
   statSync travaria o app ~21 s e o Windows tentaria autenticar por SMB (a mesma trava do ehCaminhoDeRede). */
function opcoesSalvarComo(nome, pastaPreferida, extras) {
  let pasta = '';
  if (typeof pastaPreferida === 'string' && path.isAbsolute(pastaPreferida) && !ehCaminhoDeRede(pastaPreferida)) {
    try { if (fs.statSync(pastaPreferida).isDirectory()) pasta = pastaPreferida; } catch {}
  }
  if (!pasta) {
    try { pasta = app.getPath('documents'); } catch (e) { logMain('salvar-como', e); pasta = HOME; }
  }
  return { ...extras, defaultPath: path.join(pasta, path.basename(String(nome || '')) || 'arquivo') };
}
ipcMain.handle('experiments:saveImage', experimentHandler(async o => {
  const im = validateGeneratedImage(o.image);
  const r = await dialog.showSaveDialog(win, opcoesSalvarComo('imagem-' + Date.now() + '.png', o.cwd, { filters: [{ name: 'Imagem PNG', extensions: ['png'] }] }));
  if (r.canceled || !r.filePath) return { cancelled: true };
  await fs.promises.writeFile(r.filePath, im.buffer); return { file: r.filePath };
}));
ipcMain.handle('experiments:cloudArtifact', experimentHandler(async o => {
  const r = await dialog.showSaveDialog(win, opcoesSalvarComo(o.name, o.cwd));
  if (r.canceled || !r.filePath) return { cancelled: true };
  const data = await experiments.cloudArtifact(o.sessionId, o.artifactId);
  await fs.promises.writeFile(r.filePath, data); return { file: r.filePath };
}));
app.on('before-quit', () => experiments.close());
ipcMain.handle('connector:openUrl', async (_e, o) => {
  try { const result = interactionBroker.urlFor(o); if (!result.ok) throw Error(result.error); await shell.openExternal(result.url); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

/* o app-server ja usou nomes diferentes pro id do item (itemId, item_id, id).
   Ler so' um deles fazia o texto que chega letra a letra ficar com id
   diferente do texto final - e a resposta aparecia DUAS vezes na tela. */
function idDoItem(o) {
  if (!o || typeof o !== 'object') return '';
  const v = o.itemId != null ? o.itemId : (o.item_id != null ? o.item_id : o.id);
  return v == null ? '' : String(v);
}

function codexStart() {
  if (engineUpdateQuitting) return Promise.reject(new Error('O Cockpit está fechando.'));
  if (!engineUpdates.codexReady) return engineUpdates.waitForCodex().then(codexStart);
  if (engineUpdates.codexError) return Promise.reject(engineUpdates.codexError);
  if (codex.ready) return codex.ready;
  codex.ready = new Promise((resolve, reject) => {
    let p;
    try {
      p = spawnBin('codex', ['app-server'], { cwd: HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      p.stdin.on('error', () => {});   // escrever apos o processo morrer nao pode derrubar o app inteiro
    } catch (e) { return reject(e); }
    codex.proc = p;
    codex.generation++;
    const generation = codex.generation;

    let buf = '';   // proprio deste processo: dois app-servers nao podem se misturar
    p.stdout.setEncoding?.('utf8');    p.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        codexIncoming(m);
      }
    });
    /* logs do rust: ruido na tela, mas o rabo vai pro registro de quedas
       (userData/logs/motores.log) quando o servidor cair - antes ia pro lixo */
    let cauda = '';
    p.stderr.setEncoding?.('utf8');    p.stderr.on('data', (d) => { cauda = (cauda + d.toString('utf8')).slice(-2000); });
    p.on('close', (codigo, sinal) => {
      interactionBroker.cancelScope({ engine: 'codex', generation }, 'O motor foi encerrado.');
      // pendencia deste processo morre com ele, seja ele o atual ou nao: senao
      // quem chamou ficava esperando ate o prazo de 30s sem motivo
      for (const [k, pend] of [...codex.pend]) {
        if (pend && pend.proc && pend.proc !== p) continue;
        codex.pend.delete(k);
        try { pend.reject(new Error('o Codex caiu')); } catch {}
      }
      // o close de um processo ja substituido nao pode zerar o estado do atual
      if (codex.proc && codex.proc !== p) return;
      observabilidade.encerrarMotor('codex', 'O processo Codex foi encerrado; acompanhamento interrompido.');
      codex.proc = null; codex.ready = null; codex.pronto = false;
      codex.paneTurn.clear(); codex.paneErrors?.clear(); codex.paneMsgId.clear();
      // so' as do Codex: as do ACP tambem tem rpcId (o id JSON-RPC do agente) e
      // apaga-las aqui deixaria o agente esperando e o cartao na tela
      for (const [k, a] of [...pendingApprovals]) if (a && a.kind !== 'acp' && a.kind !== 'claude') pendingApprovals.delete(k);
      // pergunta nativa tambem morre com o processo: o rpcId nao existe mais,
      // entao so' tira o cartao da tela (responder aqui seria escrever no vazio)
      for (const [id, q] of [...perguntasCodex]) { perguntasCodex.delete(id); emit(q.paneId, 'pergunta-cancelada', { id }); }
      /* derrubado DE PROPOSITO (troca de conta pelo codex:reiniciar): a tela
         nao pode ler isso como queda e religar os paineis que trabalhavam */
      const deProposito = codex.derrubando === p;
      if (deProposito) codex.derrubando = null;
      for (const paneId of codex.paneToThread.keys()) emit(paneId, 'engine-down', { engine: 'codex', codigo, sinal, cauda, deProposito });
      codex.paneToThread.clear(); codex.threadToPane.clear();
    });
    p.on('error', (e) => {
      if (codex.proc === p) observabilidade.encerrarMotor('codex', 'O processo Codex falhou.');
      codex.ready = null; reject(e);
    });

    codexReq('initialize', { clientInfo: { name: 'cockpit', version: '1.0.0', title: 'Cockpit' }, capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true } })
      .then((info) => { codex.info = capabilities.serverInfo(info); codexNote('initialized', {}); codex.pronto = true; resolve(true); })
      .catch((e) => {
        // sem zerar o 'ready', TODA chamada seguinte recebia esta mesma promessa
        // recusada: o Codex ficava fora do ar ate fechar o app
        codex.ready = null;
        try { matarProcesso(p); } catch {}
        if (codex.proc === p) codex.proc = null;
        reject(e);
      });
  });
  return codex.ready;
}

function codexReq(method, params, msTimeout) {
  return new Promise((resolve, reject) => {
    if (!codex.proc) return reject(new Error('codex fora do ar'));
    const id = ++codex.id;
    // sem prazo, um app-server que nao responde deixava a tela carregando pra sempre
    const t = setTimeout(() => {
      if (codex.pend.delete(id)) reject(new Error('o Codex não respondeu a tempo'));
    }, msTimeout || 30000);
    codex.pend.set(id, {
      proc: codex.proc,   // pra saber de QUEM era a pendencia quando um processo cai
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function codexNote(method, params) {
  if (codex.proc) codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
function codexReply(id, result) {
  if (codex.proc) codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

/* Dizer "nao sei responder isso" do jeito certo. Um result vazio num pedido que
   exige campos (attestation/generate, refresh de token do ChatGPT) nao
   desserializa do outro lado e o turno para calado; um erro JSON-RPC o Codex
   sabe tratar. */
function codexErro(id, mensagem) {
  if (!codex.proc) return;
  codex.proc.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id, error: { code: -32601, message: mensagem || 'o Cockpit não atende este pedido' },
  }) + '\n');
}

const pendingApprovals = new Map();  // approvalKey -> {rpcId, type}
const autoLiberadas = new Map();     // paneId -> Set de ferramentas liberadas "sempre" NESTE painel
/* pergunta que o proprio Codex fez (item/tool/requestUserInput). Vive na
   memoria, nao em disco como a caixa de perguntas do MCP: o outro lado aqui e'
   uma chamada JSON-RPC esperando resposta, e ela morre com o processo. */
const perguntasCodex = new Map();    // idDoCartao -> {rpcId, paneId, questions}
/* Tarefa 8 (26/09): pergunta (AskUserQuestion) e plano (ExitPlanMode) do
   proprio Claude esperando voce. Mapa proprio, fora do pendingApprovals: la'
   dentro a queda do Codex e o serverRequest/resolved apagam o que nao e' deles.
   A chave leva a geracao do processo (claudeGeracao); o pedido guarda o
   PROCESSO que perguntou, e so' ele recebe a resposta. */
const pedidosClaude = new Map();     // chave -> {tipo:'perguntas'|'plano', paneId, processo, reqId, input}
let claudeGeracao = 0;               // sobe a cada processo do Claude (claudeStart)

/* pergunta nativa que nao vale mais (painel parou, processo caiu, turno acabou):
   responde ao Codex pra ele nao ficar esperando e tira o cartao da tela */
function descartarPerguntasCodex(paneId) {
  for (const [id, q] of [...perguntasCodex]) {
    // filtro ESTRITO: um paneId indefinido nao pode significar "cancela tudo"
    if (!q || q.paneId !== paneId) continue;
    perguntasCodex.delete(id);
    try { codexReply(q.rpcId, proto.buildUserInputResponse(q.questions, [], true)); } catch {}
    emit(q.paneId, 'pergunta-cancelada', { id });
  }
}

/* ======================= motor ACP (o quinto, generico) =======================
   Qualquer agente que fale o Agent Client Protocol entra por aqui com um
   comando (gemini --acp, claude-code-acp, codex-acp...). O protocolo e a
   traducao moram em acp.js; aqui so' o encaixe com a tela e as aprovacoes. */
const acpMod = require('./acp');
const acp = acpMod.criarAcp({
  emit, spawnBin, buildEnv, matarProcesso, HOME,
  pastaDados: () => app.getPath('userData'),
  autoLiberada: (paneId, tool) => { const s = autoLiberadas.get(paneId); return !!(s && s.has(tool)); },
  // pedido de permissao do agente vira o MESMO cartao Permitir/Negar do Claude
  aoPedirPermissao: (paneId, rpcId, info) => {
    const key = 'acp_' + paneId + '_' + rpcId;
    pendingApprovals.set(key, { kind: 'acp', paneId, rpcId });
    emit(paneId, 'approval', {
      key, title: info.title || 'O agente quer usar uma ferramenta', detail: info.detail || '', reason: '',
      tool: info.tool || '', rotulo: info.rotulo || '', mudanca: info.mudanca || null, action: info.action || '', target: info.target || '',
    });
  },
  aoCair: (paneId) => descartarPermissoes(paneId),
  // turno acabou com pedido pendurado: mesmo caminho do 'result' do Claude
  aoFimDoTurno: (paneId) => descartarPermissoes(paneId),
});
ipcMain.handle('acp:config', async (_e, { paneId, modelo }) => {
  if (remotePaneTargets.has(paneId)) return remoteEngines.setModel(paneId, modelo);
  if (modelo) return acp.setModelo(paneId, modelo);
  return { error: 'nada a fazer' };
});

function codexIncoming(m) {
  // resposta a uma chamada nossa
  if (m.id !== undefined && m.method === undefined) {
    const p = codex.pend.get(m.id);
    if (p) { codex.pend.delete(m.id); m.error ? p.reject(new Error(proto.normalizeError(m.error))) : p.resolve(m.result); }
    return;
  }
  // servidor pedindo algo (aprovacao)
  if (m.id !== undefined && m.method) { codexServerRequest(m); return; }
  // notificacao
  if (m.method) codexNotification(m.method, m.params || {});
}

function paneOf(params) {
  // os metodos antigos (execCommandApproval, applyPatchApproval) mandam
  // 'conversationId'. Lendo so' threadId, ninguem respondia e o turno do Codex
  // ficava pendurado pra sempre esperando a resposta.
  const tid = params.threadId || (params.thread && params.thread.id) || params.conversationId;
  return tid ? codex.threadToPane.get(tid) : undefined;
}

function codexServerRequest(m) {
  const pane = paneOf(m.params || {}) ?? observabilidade.ownerOfThread(m.params?.threadId);
  const meth = m.method;
  const key = 'ap_' + m.id;
  // pedido de APROVACAO sem painel dono nao aparece pra ninguem: recusa na hora
  // em vez de deixar o Codex esperando pra sempre. Vale so' pra aprovacao - o
  // 'currentTime/read' e os outros pedidos nao tem thread e seguem o fluxo normal.
  const ehAprovacao = /requestApproval$|^execCommandApproval$|^applyPatchApproval$/.test(meth);
  /* os metodos ANTIGOS (execCommandApproval, applyPatchApproval) continuam
     vivos no 0.147.0, mas falam outro vocabulario de resposta: ReviewDecision,
     com approved/denied. Guardar isso no 'kind' e' o que faz a recusa chegar
     legivel dos dois lados - um "decline" neles trava o turno. */
  const kindDe = (metodo) => metodo === 'item/permissions/requestApproval' ? 'perm'
    : metodo === 'execCommandApproval' ? 'cmdLegado'
    : metodo === 'applyPatchApproval' ? 'fileLegado'
    : metodo === 'item/fileChange/requestApproval' ? 'file' : 'cmd';
  if (ehAprovacao && pane === undefined) {
    try { codexReply(m.id, proto.buildApprovalResponse(kindDe(meth), false)); } catch {}
    return;
  }

  if (meth === 'item/commandExecution/requestApproval' || meth === 'execCommandApproval') {
    pendingApprovals.set(key, { rpcId: m.id, kind: kindDe(meth), paneId: pane });
    emit(pane, 'approval', { key, ...codexApprovalDetails(kindDe(meth), m.params) });
    return;
  }
  if (meth === 'item/fileChange/requestApproval' || meth === 'applyPatchApproval') {
    pendingApprovals.set(key, { rpcId: m.id, kind: kindDe(meth), paneId: pane });
    emit(pane, 'approval', { key, ...codexApprovalDetails(kindDe(meth), m.params) });
    return;
  }
  if (meth === 'item/permissions/requestApproval') {
    /* guarda o que ele PEDIU: a resposta certa e' devolver esse mesmo conjunto
       de permissoes com o escopo, nao um {decision} generico - senao o Codex
       recebia uma resposta que nao entende e o pedido morria em silencio */
    pendingApprovals.set(key, { rpcId: m.id, kind: 'perm', paneId: pane, permissions: m.params.permissions || {} });
    emit(pane, 'approval', { key, ...codexApprovalDetails('perm', m.params) });
    return;
  }
  /* pergunta NATIVA do Codex (item/tool/requestUserInput): vira o mesmo cartao
     de perguntas que o Cockpit ja usa. Sem isto ela caia no "responde vazio"
     la embaixo e a pergunta se perdia - o Codex escolhia sozinho ou travava. */
  if (meth === 'item/tool/requestUserInput') {
    if (pane === undefined) { try { codexReply(m.id, { answers: {} }); } catch {} return; }
    const cartao = proto.normalizeUserInputRequest(m.id, m.params || {});
    if (!cartao.perguntas.length) { codexReply(m.id, { answers: {} }); return; }
    /* guarda TODAS as perguntas, nao so' as 4 que cabem no cartao: a tela
       responde por posicao, e as que sobram precisam voltar (mesmo vazias) pra
       ferramenta nao ficar esperando pra sempre */
    perguntasCodex.set(cartao.id, { rpcId: m.id, paneId: pane, questions: cartao.todas });
    /* o cartao mostra 4; as outras voltam em branco. Sem este aviso o usuario
       responde achando que respondeu tudo e nunca fica sabendo do resto. */
    if (cartao.todas.length > cartao.perguntas.length) {
      emit(pane, 'note', {
        text: 'Ele fez ' + cartao.todas.length + ' perguntas de uma vez; o cartão mostra as '
          + cartao.perguntas.length + ' primeiras. As outras vão sem resposta.',
        error: true,
      });
    }
    emit(pane, 'pergunta', cartao);
    return;
  }
  /* segundos inteiros do Unix, nao texto ISO: o schema pede integer, e uma
     string aqui nao desserializa do outro lado - o pedido morre calado */
  if (meth === 'currentTime/read') { codexReply(m.id, { currentTimeAt: Math.floor(Date.now() / 1000) }); return; }
  /* pedidos que EXIGEM campos na resposta: um {} vazio nao desserializa do
     outro lado e o turno para. Aqui a resposta e' "nao", mas valida. */
  if (meth === 'mcpServer/elicitation/request') {
    if (pane === undefined) { codexReply(m.id, { action: 'cancel' }); return; }
    const proc = codex.proc;
    interactionBroker.request(codexScope(pane, m.params), m.id, m.params || {}, result => {
      if (codex.proc === proc) codexReply(m.id, result);
    }); return;
  }
  if (meth === 'item/tool/call') {
    if (pane === undefined) { codexReply(m.id, { success: false, contentItems: [{ type: 'inputText', text: 'Sessão não encontrada.' }] }); return; }
    const proc = codex.proc;
    void interactionBroker.callTool(codexScope(pane, m.params), m.params || {}).then(result => { if (codex.proc === proc) codexReply(m.id, result); }); return;
  }
  // qualquer outro pedido: diz que nao atende, em vez de fingir uma resposta
  codexErro(m.id, 'o Cockpit não atende "' + String(meth).slice(0, 60) + '"');
}

function codexNotification(method, params) {
  const requestOwner = paneOf(params) ?? observabilidade.ownerOfThread(params.threadId);
  if (requestOwner !== undefined) {
    if (method === 'serverRequest/resolved') interactionBroker.resolved(codexScope(requestOwner, params), params.requestId);
    if (method === 'turn/completed') interactionBroker.cancelScope({ engine: 'codex', generation: codex.generation, threadId: params.threadId, turnId: params.turn?.id || params.turnId }, 'Turno encerrado.');
  }
  // Também observa threads filhas conhecidas, sem misturar suas falas no chat
  // do pai. A Torre recebe dados próprios e não ganha controles inventados.
  observabilidade.observarCodex(method, params, paneOf(params));
  if (method === 'thread/started') {
    return; // o paneamento e feito no thread/start
  }
  const pane = paneOf(params);
  if (pane === undefined) return;

  const paneErrors = codex.paneErrors ||= new Map();
  const errorState = () => {
    if (!paneErrors.has(pane)) paneErrors.set(pane, {});
    return paneErrors.get(pane);
  };
  switch (method) {
    case 'serverRequest/resolved': {
      // Já resolvido pelo servidor: retire só o cartão deste painel, sem novo RPC.
      for (const [key, request] of pendingApprovals) {
        if (request.paneId !== pane || request.rpcId !== params.requestId || request.kind === 'acp' || request.kind === 'claude') continue;
        pendingApprovals.delete(key);
        emit(pane, 'permissao-cancelada', { key });
      }
      for (const [id, request] of perguntasCodex) {
        if (request.paneId !== pane || request.rpcId !== params.requestId) continue;
        perguntasCodex.delete(id);
        emit(pane, 'pergunta-cancelada', { id });
      }
      break;
    }
    case 'turn/started':
      paneErrors.delete(pane);
      codex.paneTurn.set(pane, params.turnId || (params.turn && params.turn.id));
      emit(pane, 'busy', {});
      break;

    case 'item/agentMessage/delta': {
      // guarda o id desta fala pra devolver o MESMO no 'completed'
      const idDelta = idDoItem(params) || 'msg';
      codex.paneMsgId.set(pane, idDelta);
      emit(pane, 'text-delta', { id: idDelta, text: params.delta || '' });
      break;
    }

    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      emit(pane, 'think-delta', { text: params.delta || '' });
      break;

    case 'item/started': {
      const it = params.item || {};
      if (it.type === 'commandExecution') emit(pane, 'tool-start', { id: it.id, name: 'Terminal', arg: it.command || '' });
      else if (it.type === 'fileChange') emit(pane, 'tool-start', { id: it.id, name: 'Editando arquivo', arg: fileChangeArg(it) });
      else if (it.type === 'mcpToolCall') emit(pane, 'tool-start', { id: it.id, name: mcpName(it), arg: shortJson(it.arguments) });
      else if (it.type === 'webSearch') emit(pane, 'tool-start', { id: it.id, name: 'Pesquisando na web', arg: it.query || '' });
      else if (it.type === 'imageGeneration') emit(pane, 'tool-start', { id: it.id, name: 'Gerando imagem', arg: it.revisedPrompt || '' });
      /* leva 5i: o agente do Codex (spawnAgent) vira o passo "Chamando um agente", como o Task/Agent do Claude (antes nao virava passo
         nenhum). O id do passo e' o do item: a thread filha so' aparece no fim da chamada. O registro guarda esse id em passoId, para o
         nome em portugues (app.js, aplicarNomesDosAgentes) achar o passo. As outras chamadas (esperar, mandar mensagem, fechar) nao viram passo. */
      else if (it.type === 'collabAgentToolCall' && it.tool === 'spawnAgent' && it.id) emit(pane, 'tool-start', { id: it.id, name: 'Agent', arg: pedidoDoAgente(it) });
      break;
    }

    case 'item/commandExecution/outputDelta':
    case 'command/exec/outputDelta': {
      const output = proto.normalizeCommandOutput(method, params);
      if (output.text) emit(pane, 'tool-output', output);
      break;
    }

    case 'item/mcpToolCall/progress':
      if (typeof params.message === 'string') emit(pane, 'tool-output', { id: params.itemId, text: params.message + '\n' });
      break;

    case 'item/completed': {
      const it = params.item || {};
      if (it.type === 'imageGeneration') {
        const image = require('./cockpit-media').nativeImage(it);
        emit(pane, 'tool-end', { id: it.id, output: image.text || 'Imagem gerada', error: !!image.error });
        emit(pane, 'generated-image', image); break;
      }
      if (it.type === 'agentMessage') {
        // Mensagens assíncronas podem intercalar: o id real identifica a fala.
        const idFim = idDoItem(it) || codex.paneMsgId.get(pane) || 'msg';
        if (codex.paneMsgId.get(pane) === idFim) codex.paneMsgId.delete(pane);
        emit(pane, 'text-final', { id: idFim, ...proto.normalizeAgentMessage(it) });
      } else if (it.type === 'commandExecution') {
        emit(pane, 'tool-end', {
          id: it.id,
          output: it.aggregatedOutput || it.output || '',
          error: (it.exitCode != null && it.exitCode !== 0) || it.status === 'failed',
        });
      } else if (it.type === 'fileChange') {
        emit(pane, 'tool-end', { id: it.id, output: fileChangeSummary(it), error: it.status === 'failed' });
      } else if (it.type === 'mcpToolCall') {
        emit(pane, 'tool-end', { id: it.id, ...resultadoFerramenta(it.error ? [it.result ?? it.output, it.error] : it.result ?? it.output),
          error: it.status === 'failed' || !!it.error || !!it.result?.isError });
      } else if (it.type === 'webSearch') {
        emit(pane, 'tool-end', { id: it.id, output: it.query || '', error: false });
      } else if (it.type === 'collabAgentToolCall' && it.tool === 'spawnAgent' && it.id) {
        // leva 5i: acabou a CHAMADA (o agente nasceu). O que ele faz depois e' do registro (Torre e Workflow), nao do passo
        emit(pane, 'tool-end', { id: it.id, output: '', error: it.status === 'failed' });
      } else if (it.type === 'error') {
        emit(pane, 'note', { text: proto.normalizeError(it), error: true });
      }
      break;
    }

    case 'turn/completed': {
      const failed = params.turn?.status === 'failed' || !!params.turn?.error;
      const previous = paneErrors.get(pane);
      if (failed && (params.turn?.error || !previous?.finalText)) {
        const notice = proto.normalizeErrorNotification({ error: params.turn?.error }, errorState());
        if (!notice.duplicate) emit(pane, 'note', notice);
      }
      descartarPermissoes(pane);
      codex.paneTurn.delete(pane);
      if (!previous?.ended) emit(pane, 'turn-end', { status: params.turn?.status || 'unknown', error: failed });
      paneErrors.delete(pane);
      break;
    }

    case 'turn/failed':
    case 'error': {
      const state = errorState();
      const notice = proto.normalizeErrorNotification(params, state);
      if (!notice.duplicate) emit(pane, 'note', notice);
      // Retentativa não encerra o turno, cancela permissões nem libera a fila.
      if (notice.retrying) break;
      descartarPermissoes(pane);
      codex.paneTurn.delete(pane);
      if (!state.ended) emit(pane, 'turn-end', { status: 'failed', error: true });
      state.ended = true;
      break;
    }

    case 'thread/tokenUsage/updated': {
      const tu = params.tokenUsage || {};
      // "last" e o tamanho da conversa agora; "total" seria o gasto acumulado
      const atual = (tu.last && tu.last.totalTokens) || (tu.total && tu.total.totalTokens) || 0;
      emit(pane, 'tokens', { total: atual, janela: tu.modelContextWindow || undefined });
      break;
    }

    case 'thread/compacted':
      emit(pane, 'compactou', {});
      break;

    /* o PLANO do turno como evento: vira a checklist ao vivo do painel.
       Formato unificado com o TodoWrite do Claude e o write_todos do Gemini. */
    case 'turn/plan/updated': {
      const passos = Array.isArray(params.plan) ? params.plan : [];
      emit(pane, 'plano', { itens: passos.slice(0, 30).map((p) => ({
        txt: String(p.step || '').slice(0, 200),
        estado: p.status === 'completed' ? 'feito' : (p.status === 'inProgress' ? 'fazendo' : 'pendente'),
      })) });
      break;
    }

    /* diff agregado do turno, pronto do lado do motor */
    case 'turn/diff/updated':
      emit(pane, 'diff-turno', { diff: String(params.diff || '').slice(0, 300000) });
      break;

    /* o Codex trocou o modelo no meio (politica dele): avisar em vez de calar */
    case 'model/rerouted':
      emit(pane, 'note', {
        text: 'O Codex trocou o modelo deste turno: ' + (params.fromModel || '?') + ' → ' + (params.toModel || '?')
          + (params.reason === 'highRiskCyberActivity' ? ' (política de segurança dele)' : ''),
        error: false,
      });
      break;

    case 'thread/status/changed':
      // idle descreve a thread, não o resultado do turno. Pode chegar antes
      // de turn/completed; encerrar aqui libera a fila e perde a falha real.
      break;
  }
}

function mcpName(it) { return (it.server ? it.server + ' · ' : '') + (it.tool || 'MCP'); }
// leva 5i: o pedido que o Codex mandou ao agente, numa linha so' e cortado (o passo mostra so' o comeco)
function pedidoDoAgente(it) { return String(it.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
function shortJson(v) { if (v == null) return ''; try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } }
function fileChangeArg(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => c.path || c.file || '').filter(Boolean).join(', ');
  return it.path || '';
}
function fileChangeSummary(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => (c.kind || c.type || 'alterado') + '  ' + (c.path || c.file || '')).join('\n');
  return shortJson(it);
}

/* O app-server nao aplica sozinho o ~/.codex/AGENTS.md, entao mandamos as regras da casa
   junto com cada conversa nova. Se o arquivo existir, ele manda; senao, vai o basico. */
function instrucoesCasa() {
  const base = 'Responda SEMPRE em português do Brasil, nunca em inglês.\n'
    + 'Fale em palavras simples, com exemplos do contexto de quem está perguntando.\n'
    + 'Resposta curta e direta: comece pelo resultado.\n'
    + 'Turno com mais de 8 passos ou mais de 5 minutos termina com um bloco final cujo título é exatamente "## Recibo" (só essa palavra, sem nada depois) e três linhas curtas: o que fiz · o que mudou (arquivos) · como testar.';
  // as regras sao as de quem usa ESTE computador, nao as de quem escreveu o app
  for (const f of [path.join(HOME, '.codex/AGENTS.md'), path.join(HOME, '.claude/CLAUDE.md')]) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      if (txt.trim()) return base + '\n\n--- regras da casa (' + f + ') ---\n' + txt.slice(0, 12000);
    } catch {}
  }
  return base;
}

/* Os modos moram no codex-protocol.js, junto com quem monta o thread/start.
   "revisado" manda os pedidos de aprovacao pra um revisor AUTOMATICO do proprio
   Codex (approvalsReviewer: auto_review), dentro do sandbox de escrita na pasta:
   degrau entre "Auto" e "Sem pedir permissao" - voce nao e' interrompido, mas
   tambem nao e' full-access cego. */
const CODEX_MODE = proto.CODEX_MODE;
const CLAUDE_MODE = { manual: 'manual', 'auto-edit': 'acceptEdits', plan: 'plan', auto: 'auto', bypass: 'bypassPermissions' };

/* Modo de permissao pedido pelo painel. Ate a leva 40 o painel Manual/Auto/Plano
   subia com --setting-sources project,local para escapar de um defaultMode no
   settings.json do usuario -- e isso apagava as skills, agentes e comandos
   pessoais de ~/.claude. Provado em 11/09/2026 (CLI 2.1.268): --permission-mode
   vence o defaultMode de qualquer settings. Este arquivo so' trava o defaultMode
   tambem pelo lado das settings (settings de flag > usuario), por garantia.
   Efeito de ter a fonte do usuario de volta: permissions.additionalDirectories
   do usuario volta a valer nesses modos (hoje e' uma pasta inofensiva). */
const MODO_NAS_SETTINGS = { manual: 'default', 'auto-edit': 'acceptEdits', plan: 'plan', auto: 'auto' };
function claudeTravaDoModo(paneId, modo) {
  const dm = MODO_NAS_SETTINGS[modo];
  if (!dm) return null;
  try {
    // um arquivo por painel: dois paineis subindo juntos nao leem o do outro pela metade
    const marca = String(paneId || 'geral').replace(/[^\w-]/g, '_');
    const out = path.join(app.getPath('userData'), 'claude-modo-' + marca + '.json');
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ permissions: { defaultMode: dm } }), { mode: 0o600 });
    fs.renameSync(tmp, out);
    return out;
  } catch (e) { logMain('claude-modo', e); return null; }
}
/* O init do stream-json diz o modo que o CLI REALMENTE subiu (o Haiku, por
   exemplo, nao tem modo Auto e cai em default calado). */
function modoDoCockpitPeloInit(pm) {
  return ({ default: 'manual', manual: 'manual', acceptEdits: 'auto-edit', plan: 'plan', auto: 'auto', bypassPermissions: 'bypass' })[pm] || '';
}

/* ======================= motor CLAUDE ======================= */
/* um processo `claude` por painel, protocolo stream-json */
const claudePanes = new Map();  // paneId -> {proc, buf, blocks}
const zumbis = new Set();      // processos que ja saíram do mapa mas talvez ainda vivam

const claudeCwd = new Map();
const claudeRemoto = new Map();   // paineis que rodam num servidor, nao aqui
// o Claude Code troca / . : e \ por - no nome da pasta do projeto
function encodeCwd(dir) { return String(dir).replace(/[\\/.:]/g, '-'); }

/* O arquivo desta conversa existe neste PC? Decide entre --resume (existe) e
   --session-id (nao existe: recria com o mesmo id). Checa direto por fs, SEM o
   filtro de 300 bytes da varredura - uma sessao recem-nascida e' pequena, e
   trata-la como inexistente faria o --session-id colidir com arquivo vivo. */
function sessaoLocalExiste(id, cwd) {
  const alvo = String(id) + '.jsonl';
  try { if (fs.existsSync(path.join(CLAUDE_PROJ, encodeCwd(cwd || HOME), alvo))) return true; } catch {}
  // sessao aberta pela lateral pode morar na pasta de OUTRO projeto
  let pastas = [];
  try { pastas = fs.readdirSync(CLAUDE_PROJ); } catch { return false; }
  for (const p of pastas) {
    try { if (fs.existsSync(path.join(CLAUDE_PROJ, p, alvo))) return true; } catch {}
  }
  return false;
}

/* host/usuario que comecam com '-' seriam lidos como OPCAO pelo ssh
   (ex: -oProxyCommand=... roda comando na maquina local) */
/* O ssh explica a falha no stderr, em ingles e no jargao dele. Aqui isso vira
   uma frase que diz o que houve e o que fazer -- antes tudo virava lista vazia,
   igual a "voce nao tem conversa nenhuma". */
function motivoDoSsh(txt, remoto) {
  const s = String(txt || '');
  const onde = (remoto && remoto.host) ? ' (' + remoto.host + ')' : '';
  if (/Permission denied|denied \(publickey/i.test(s))
    return 'O servidor' + onde + ' recusou a chave. Confira o arquivo da chave e o usuário em Editar aba.';
  if (/no such identity|could not open user config|Load key.*No such file/i.test(s))
    return 'Não achei o arquivo da chave no seu PC. Confira o caminho em Editar aba.';
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(s))
    return 'A identidade do servidor' + onde + ' mudou (foi reinstalado?). Por segurança o ssh recusou — limpe a linha dele no known_hosts.';
  if (/Connection refused/i.test(s))
    return 'O servidor' + onde + ' recusou a conexão. O SSH está no ar? A porta é a 22?';
  if (/Connection timed out|Operation timed out|No route to host/i.test(s))
    return 'Não alcancei o servidor' + onde + '. Ele está no ar e liberado para o seu IP?';
  if (/Could not resolve hostname|Name or service not known/i.test(s))
    return 'Não achei o endereço' + onde + '. Confira o host em Editar aba.';
  if (/ssh_exchange_identification/i.test(s))
    return 'O servidor' + onde + ' está recusando conexões novas agora (muitas de uma vez). Tente de novo em instantes.';
  const linha = s.split('\n').map(x => x.trim()).filter(x => x && !/^Warning: Permanently added/i.test(x))[0];
  return linha ? ('O servidor' + onde + ' respondeu: ' + linha.slice(0, 160)) : '';
}

function ssgValido(r) {
  // o primeiro caractere NAO pode ser "-", senao o ssh le como opcao
  const host = String(r?.host || '');
  const ip = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const hostValido = ip.includes(':') ? !ip.includes('%') && require('node:net').isIP(ip) === 6 : /^[\w][\w.-]{0,252}$/.test(host);
  return !!r && hostValido && /^[\w][\w.-]{0,31}$/.test(String(r.usuario || ''))
    && (r.porta == null || (Number.isInteger(Number(r.porta)) && Number(r.porta) >= 1 && Number(r.porta) <= 65535));
}

/* "cd '~/x'" nao funciona: entre aspas o til vira texto, o cd falha e o
   comando acaba rodando na home sem avisar. Testado na VPS. */
function cdRemoto(p) {
  const s = String(p || '~').trim() || '~';
  if (s === '~') return 'cd ~';
  if (s.startsWith('~/')) return 'cd ~/' + qLinux(s.slice(2));
  return 'cd ' + qLinux(s);
}

// aspas de shell POSIX, pro comando que vai dentro do SSH (o servidor remoto e' Linux)
function qLinux(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/* Caminho de arquivo pra dentro do comando remoto. Mesma armadilha do cdRemoto:
   entre aspas o til vira TEXTO, e o comando iria procurar uma pasta chamada "~"
   dentro da home. Entao o "~/" fica de fora das aspas e so' o resto e' citado. */
function qRemoto(p) {
  const s = String(p == null ? '' : p).trim();
  if (s === '~') return '~';
  if (s.startsWith('~/')) return '~/' + qLinux(s.slice(2));
  return qLinux(s);
}

/* contador por painel: o mesmo numero precisa valer pro texto que chega
   letra a letra E pra versao final da mesma mensagem, senao a resposta
   aparece duas vezes na tela */
/* a conta e' por painel E por quem fala: dois sub-agentes rodando junto, cada
   um com o seu 'message_start', embaralhavam um contador unico e a fala de um
   saia com o numero do outro */
const msgSeqPorPane = new Map();
const seqDoPane = (paneId, marca) => msgSeqPorPane.get(paneId + '|' + (marca || '')) || 0;
const somaSeq = (paneId, marca) => msgSeqPorPane.set(paneId + '|' + (marca || ''), seqDoPane(paneId, marca) + 1);
const temSeq = (paneId, marca) => msgSeqPorPane.has(paneId + '|' + (marca || ''));
const limparSeq = (paneId) => {
  for (const k of [...msgSeqPorPane.keys()]) if (k.startsWith(paneId + '|')) msgSeqPorPane.delete(k);
};
/* sub-agente (ferramenta Task) fala pelo MESMO painel. Sem separar, a fala
   dele e a do principal disputam o mesmo lugar na tela e uma apaga a outra.
   Streaming e versao final usam esta mesma funcao, de proposito. */
function marcaSub(m) {
  const pid = m && (m.parent_tool_use_id || m.parentToolUseId);
  return pid ? 's' + String(pid).slice(-8) : '';
}
/* O que o Claude precisa saber sobre ESTA tela. Vai no --append-system-prompt
   so' dos paineis daqui (onde as ferramentas do Cockpit existem). Curto de
   proposito: entra em toda sessao.
   - plano: medido em 30 dias, 0 de 34 turnos longos tinha plano, porque o
     TodoWrite nao existe no --print. A ferramenta e' do Cockpit; sem a dica
     aqui o modelo nao sabe que ela e' a unica janela de andamento.
   - PushNotification: o CLI responde "not sent" no modo sem terminal, e o
     modelo achava que o aviso se perdeu. O Cockpit intercepta a chamada e
     entrega de verdade (tela + sistema). */
/* exemplo minimo do bloco ```excalidraw (conferido por test/quadro-fluxo.test.js
   com o mesmo validador que a tela usa antes de desenhar) */
const EXEMPLO_EXCALIDRAW = '[{"type":"rectangle","id":"a","x":0,"y":0,"width":200,"height":70,"label":{"text":"Ler o pedido"}},'
  + '{"type":"diamond","id":"b","x":0,"y":140,"width":200,"height":110,"label":{"text":"Está claro?"}},'
  + '{"type":"arrow","x":100,"y":70,"start":{"id":"a"},"end":{"id":"b"},"label":{"text":"depois"}}]';
const INSTRUCOES_COCKPIT = [
  'Você está rodando dentro do Cockpit, um painel gráfico sem terminal.',
  'Em qualquer trabalho com mais de 3 passos, chame a ferramenta mcp__cockpit__plano logo no início com todos os passos e de novo a cada mudança de estado: é a única forma de o usuário acompanhar o andamento.',
  'Quando uma decisão mudar o resultado, use mcp__cockpit__perguntar em vez de encerrar o turno com a dúvida no texto.',
  'A ferramenta PushNotification funciona aqui: o Cockpit entrega o aviso na tela e no sistema mesmo que o resultado dela diga not sent. Use-a só quando o usuário provavelmente não está olhando e há algo que ele queira saber agora.',
  'Turno com mais de 8 passos ou mais de 5 minutos termina com um bloco final cujo título é exatamente "## Recibo" (só essa palavra, sem nada depois) e três linhas curtas: o que fiz · o que mudou (arquivos) · como testar.',
  // leva 41 (B5): o Cockpit desenha bloco ```excalidraw na conversa (esqueleto do convertToExcalidrawElements)
  'Para explicar um fluxo (passos, decisões, arquitetura) você pode incluir um bloco de código com a linguagem excalidraw: o Cockpit mostra como desenho. Dentro, uma lista JSON no formato esqueleto (caixa = rectangle, decisão = diamond, seta com start/end apontando pro id), por exemplo:',
  EXEMPLO_EXCALIDRAW,
].join(' ');

/* "claude.ai Make" vira "claude_ai_Make" no nome da ferramenta (conferido no
   system init: ponto, espaco e dois-pontos viram _, o hifen fica) */
/* o CLI so' aceita -w dentro de repositorio git: fora dele morre na hora, a cada
   mensagem, com erro em ingles. Conferir antes de subir. */
function dentroDeGit(dir) {
  let d = path.resolve(dir || HOME);
  for (let i = 0; i < 40; i++) {
    try { if (fs.existsSync(path.join(d, '.git'))) return true; } catch {}
    const acima = path.dirname(d);
    if (acima === d) return false;
    d = acima;
  }
  return false;
}
const nomeDeServidorMcp = (n) => String(n || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

function claudeStart(paneId, opts) {
  claudeStop(paneId);
  claudeCwd.set(paneId, opts.cwd || HOME);
  const remoto = opts.remoto || null;
  if (remoto) claudeRemoto.set(paneId, remoto); else claudeRemoto.delete(paneId);
  // remoto: sempre sem pedir permissao - o canal de aprovacao (stdio + arquivo
  // de settings local) nao atravessa o SSH nesta versao
  const modo = remoto ? 'bypass' : (opts.approval || 'bypass');
  const args = [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages',
    '--permission-mode', CLAUDE_MODE[modo] || 'bypassPermissions',
  ];
  if (modo === 'bypass') {
    args.push('--dangerously-skip-permissions');
  } else {
    // canal para ele perguntar antes de agir
    args.push('--permission-prompt-tool', 'stdio');
    /* Tarefa 8: no Plano que veio do "Sem pedir permissao", o bypass fica
       DISPONIVEL (sem ligar): o Executar do plano volta pra ele na mesma sessao
       (setMode). So' nesse caso -- nunca libera mais do que o modo de antes. */
    if (interacao.liberaBypassNoPlano(modo, opts.modoAntesDoPlano)) args.push('--allow-dangerously-skip-permissions');
    const sf = claudeTravaDoModo(paneId, modo);
    if (sf) args.push('--settings', sf);
  }
  /* A caixa de perguntas so' vale pro painel daqui: no remoto o servidor MCP
     rodaria la, e o arquivo de troca ficaria no servidor, longe desta tela.
     SEM --strict-mcp-config: medido que assim o servidor do Cockpit entra e os
     do usuario continuam todos de pe (com a flag, sobra so' o nosso). */
  if (!remoto) {
    const cfgMcp = configMcpDoPainel(paneId);
    if (cfgMcp) { args.push('--mcp-config', cfgMcp); ligarVigiaPerguntas(); args.push('--append-system-prompt', INSTRUCOES_COCKPIT); }
  }
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.model) args.push('--model', opts.model);
  // se o modelo escolhido cair/sobrecarregar, este assume no lugar (a flag so'
  // funciona com --print, que e' exatamente como o Cockpit roda o Claude)
  if (opts.model && opts.fallback && opts.fallback !== opts.model) args.push('--fallback-model', opts.fallback);
  // depois de cada turno o motor sugere a proxima mensagem (vira chip no campo)
  if (opts.sugestoes !== false) args.push('--prompt-suggestions');
  /* O endereco da sessao e' decidido AQUI, nao esperando o 'system init':
     - retomada normal: --resume
     - ramificar: --resume + --fork-session (sessao NOVA com o historico INTEIRO)
     - retomada de id cujo arquivo nao existe (ficha orfa de um processo que
       morreu antes de gravar): --session-id RECRIA a conversa com o MESMO id,
       em vez de o --resume falhar e derrubar o painel
     - conversa nova: uuid nosso com --session-id - o painel nasce sabendo o
       proprio endereco, sem a janela "mandei mensagem mas nao sei o id" que ja
       rendeu bug de restauracao em tres levas */
  let sessaoDefinida = '';
  if (opts.resumeId && opts.fork) {
    args.push('--resume', opts.resumeId, '--fork-session');
    /* leva 41 (B3): no PC o endereco do RAMO tambem e' nosso (--session-id junto
       do --fork-session: medido no CLI 2.1.270, a sessao nova sai com o id
       pedido). Sem isto o painel ficava sem endereco ate' o 'system init', e uma
       queda nessa janela religava na conversa de ORIGEM. No servidor fica sem:
       a versao do CLI de la' nao foi medida com os dois juntos; o id chega pelo
       init, e a tela so' esquece o fork quando ele chegar. */
    if (!remoto) { sessaoDefinida = crypto.randomUUID(); args.push('--session-id', sessaoDefinida); }
  } else if (opts.resumeId && (remoto || sessaoLocalExiste(opts.resumeId, opts.cwd))) {
    args.push('--resume', opts.resumeId);
  } else {
    sessaoDefinida = (opts.resumeId && /^[0-9a-f-]{36}$/i.test(opts.resumeId)) ? opts.resumeId : crypto.randomUUID();
    args.push('--session-id', sessaoDefinida);
  }
  // acesso amplo de saida so no modo que nao pergunta; nos outros ele pede na hora
  if (!remoto && modo === 'bypass' && opts.cwd && opts.cwd !== HOME) args.push('--add-dir', HOME);
  // worktree: branch isolada em .claude/worktrees/<nome>; o proprio CLI cria (ou
  // reaproveita) e trabalha la' dentro. Fork de CODIGO, completando o de conversa.
  const nomeWt = String(opts.worktree || '');
  if (!remoto && nomeWt && !dentroDeGit(opts.cwd || HOME)) {
    emit(paneId, 'note', { text: 'A pasta deste painel não é um repositório git, e o worktree "' + nomeWt + '" só funciona dentro de um. Use "Sair do worktree" no menu / do painel, ou troque a pasta.', error: true });
    return false;
  }
  // nome que o git aceita como branch: sem "..", sem ".lock" no fim, sem ponto no fim
  if (!remoto && nomeWt && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(nomeWt) && !/\.\.|\.lock$|\.$/.test(nomeWt)) args.push('-w', nomeWt);
  /* conectores que esta aba desligou: --disallowedTools mcp__<servidor> tira as
     ferramentas do servidor do CONTEXTO, nao so' da permissao (medido: Make e
     Notion fora = 635 -> 475 ferramentas), e vale tambem pros conectores do
     claude.ai, que nao vivem em arquivo nenhum - por isso nao e' --strict-mcp-config */
  // o 'cockpit' (perguntar, plano) nunca sai: sem ele a caixa de perguntas some da aba
  const semConectores = (!remoto && Array.isArray(opts.semConectores)) ? opts.semConectores.map(nomeDeServidorMcp).filter((n) => n && n !== 'cockpit') : [];
  if (semConectores.length) args.push('--disallowedTools', ...semConectores.map((n) => 'mcp__' + n));

  /* com -w o CLI entra em .claude/worktrees/<nome> ANTES de resolver a sessao:
     o .jsonl nasce na pasta do worktree, e o caminho emitido tem que ser esse */
  if (!remoto && nomeWt && args.includes('-w')) claudeCwd.set(paneId, path.join(opts.cwd || HOME, '.claude', 'worktrees', nomeWt));
  let proc, st, remoteHost;
  if (remoto) {
    if (!ssgValido(remoto)) { emit(paneId, 'note', { text: 'Servidor com endereço ou usuário inválido. Edite a aba.', error: true }); return false; }
    remoteHost = createRemoteHostBridge({ broker: interactionBroker,
      resolveScope: () => claudeScope(paneId),
      isCurrent: () => !!st && claudePanes.get(paneId) === st && !st.parandoDeProposito,
      write: line => proc.stdin.write(line),
      onReady: ({ cwd }) => { if (st) st.remoteHostCwd = cwd; },
      onUnavailable: message => emit(paneId, 'note', { text: message }),
    });
    // '|| exit 1': se a pasta nao existir, o painel avisa em vez de rodar no lugar errado
    const comando = cdRemoto(remoto.caminhoRemoto) + ' || exit 1; ' + remoteHost.command(args);
    /* Sinal de vida a cada 20s. Sem isto o canal fica em silencio absoluto
       entre um turno e outro - e um turno longo, mais o tempo que voce leva
       lendo a resposta, passa de dez minutos. Conexao parada e' descartada por
       roteador/firewall/operadora sem avisar: os dois lados continuam achando
       que estao ligados e a verdade so' aparece quando voce manda a proxima
       mensagem. Isso mantem o caminho aberto E derruba de verdade em ~2min
       (20s x 6) quando o servidor sai do ar, em vez de travar esperando. */
    proc = spawnBin('ssh', [
      '-i', remoto.chave, '-p', String(remoto.porta || 22), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=6', '-o', 'TCPKeepAlive=yes',
      remoto.usuario + '@' + remoto.host, '--', comando,
    ], { env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    proc = spawnBin(claudeBin(), args, { cwd: opts.cwd || HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  }
  proc.stdin.on('error', () => {});   // escrever apos o processo morrer nao pode derrubar o app inteiro
  /* Tarefa 8: geracao (a chave dos pedidos de pergunta/plano muda junto), o
     modo em que ele subiu, o modo de antes do Plano (so' os 4 de executar; o
     Executar volta pra ele) e se ha' o canal de permissao (stdio). */
  st = {
    proc, remoteHost, buf: '', geracao: ++claudeGeracao, modo,
    modoAntesDoPlano: (modo === 'plan' && Object.prototype.hasOwnProperty.call(interacao.MODO_DO_CLI, opts.modoAntesDoPlano)) ? opts.modoAntesDoPlano : null,
    comCanal: modo !== 'bypass',
  };
  claudePanes.set(paneId, st);
  st.hostCapability = hostCapabilities.get(String(paneId)) || '';

  // o endereco ja e' nosso (--session-id): tela e config ficam sabendo AGORA.
  // O 'system init' vem depois com o mesmo id, e o caminho ja bate.
  if (sessaoDefinida) {
    emit(paneId, 'sessao', {
      id: sessaoDefinida,
      file: remoto ? '' : path.join(CLAUDE_PROJ, encodeCwd(claudeCwd.get(paneId) || opts.cwd || HOME), sessaoDefinida + '.jsonl'),
      remoto: !!remoto,
      /* auditoria 1: no RAMO o endereco ainda e' so' promessa -- o Claude nem
         abriu a origem. A tela so' da' o ramo por nascido no 'system init'. */
      provisorio: !!(opts.resumeId && opts.fork) || undefined,
    });
  }

  proc.stdout.setEncoding?.('utf8');
  proc.stdout.on('data', (chunk) => {
    // este processo ja foi substituido: o rabo da resposta velha nao pode cair
    // dentro da conversa nova (e o 'result' dela apagaria o "trabalhando")
    if (claudePanes.get(paneId) !== st) return;
    st.buf += chunk.toString('utf8');
    let i;
    while ((i = st.buf.indexOf('\n')) >= 0) {
      const line = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      if (remoteHost) { m = remoteHost.route(m); if (!m) continue; }
      claudeMessage(paneId, m);
    }
  });
  /* Guarda as ultimas linhas do erro. Antes isto era um ouvinte vazio e tudo
     que o ssh/claude reclamava ia pro lixo - qualquer causa virava a mesma
     frase generica na tela, e nao dava pra saber o que tinha acontecido. */
  proc.stderr.setEncoding?.('utf8');  proc.stderr.on('data', (d) => {
    // 4 mil: a tela recebe as 3 ultimas linhas; o registro de quedas guarda o rabo inteiro
    st.erro = ((st.erro || '') + d.toString('utf8')).slice(-4000);
  });
  // handshake que liga o canal de permissao (e devolve a lista de skills)
  try { proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-' + paneId, request: { subtype: 'initialize', hooks: {} } }) + '\n'); } catch {}
  proc.on('close', (codigo) => {
    remoteHost?.dispose();
    interactionBroker.cancelScope({ paneId: String(paneId), generation: st.geracao, engine: 'claude' }, 'Processo encerrado.');
    // usa o "st" deste processo, nao o que estiver no mapa agora: se o
    // usuario trocou de processo rapido, o mapa ja pode apontar para o novo
    const atual = claudePanes.get(paneId) === st;
    if (atual) {
      observabilidade.encerrarPainel(paneId, 'claude', 'O processo Claude foi encerrado; acompanhamento interrompido.');
      claudePanes.delete(paneId);
    }
    if (st.parandoDeProposito || !atual) return;
    // manda junto o que o processo reclamou antes de morrer
    const motivo = String(st.erro || '').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^Warning: Permanently added/i.test(l))
      .slice(-3).join(' · ').slice(0, 300);
    // o emit acrescenta emTurno/tipo (quedas.js) e grava a queda no motores.log
    emit(paneId, 'engine-down', { motivo, engine: 'claude', codigo, sinal: proc.signalCode || null, cauda: st.erro || '', remoto: !!remoto });
  });
  proc.on('error', (e) => {
    remoteHost?.dispose();
    interactionBroker.cancelScope({ paneId: String(paneId), generation: st.geracao, engine: 'claude' }, 'Processo encerrado.');
    if (claudePanes.get(paneId) !== st) return;
    observabilidade.encerrarPainel(paneId, 'claude', 'O processo Claude falhou.');
    claudePanes.delete(paneId);
    if (!st.parandoDeProposito) emit(paneId, 'note', { text: 'Erro: ' + e.message, error: true });
  });
  return true;
}

/* pedido de permissao que nao vale mais: responde ao motor (senao a thread do
   Codex fica esperando pra sempre) e manda a tela tirar o cartao */
function descartarPermissoes(paneId) {
  interactionBroker.cancelScope({ paneId: String(paneId) }, 'Sessão encerrada.');
  let tinha = false;
  for (const [k, a] of [...pendingApprovals]) {
    if (!a || a.paneId !== paneId) continue;
    pendingApprovals.delete(k); tinha = true;
    if (a.kind === 'acp') { try { acp.responderPermissao(a.paneId, a.rpcId, null); } catch {} }
    else if (a.rpcId) { try { codexReply(a.rpcId, proto.buildApprovalResponse(a.kind, false)); } catch {} }
  }
  // pergunta nativa do Codex segue o mesmo destino do cartao de permissao
  descartarPerguntasCodex(paneId);
  // Tarefa 8: e a pergunta e o plano do Claude (a caixa e o cartao saem da tela)
  descartarPedidosClaude(paneId);
  if (tinha) emit(paneId, 'permissao-cancelada', {});
}

function claudeStop(paneId) {
  limparAnexosClaudeRemotos(paneId);
  vigiaTurno.desligar(paneId);   // parada de proposito: nada de "estava em turno" depois disto
  observabilidade.encerrarPainel(paneId, 'claude', 'A sessão Claude foi desligada deste painel.');
  limparSeq(paneId);
  limparPerguntasDoPainel(paneId);   // pergunta orfa nao volta na proxima abertura
  claudeRemoto.delete(paneId);
  claudeCwd.delete(paneId);
  autoLiberadas.delete(paneId);   // liberacao vale so' enquanto o painel viver
  // pedido de permissao deste painel morre com o processo: sem isso o cartao
  // continuava na tela e o clique respondia ao processo ERRADO (o novo)
  descartarPermissoes(paneId);
  const st = claudePanes.get(paneId);
  if (st) {
    st.remoteHost?.dispose();
    st.parandoDeProposito = true;
    // solta o ouvinte antes de matar: entre o SIGTERM e a morte de verdade ele
    // ainda despejaria texto do processo velho
    try { st.proc.stdout.removeAllListeners('data'); } catch {}
    if (claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    // ele sai do mapa (pra 'pane:send' nao escrever num morto), mas alguem
    // precisa guardar a alca: se o SIGTERM nao pegar, o processo ficaria orfao
    zumbis.add(st.proc);
    // 'exit' e' o que sempre vem: 'close' espera TODOS os canos fecharem, e um
    // neto do claude (servidor MCP, bash de ferramenta) pode segurar o stdout
    st.proc.once('exit', () => zumbis.delete(st.proc));
    st.proc.once('close', () => zumbis.delete(st.proc));
    try { st.proc.kill('SIGTERM'); } catch {}
  }
}

/* ======================= SSH: conexao reaproveitada =======================
   Arvore de arquivos, @-mencao e visor de um painel remoto abrem uma ida ao
   servidor por pasta expandida e por tecla digitada. Uma conexao nova a cada
   vez custa ~1s e, pior, o sshd padrao (MaxStartups 10:30:100) comeca a RECUSAR
   - a frase de "muitas de uma vez" do motivoDoSsh() viraria rotina.
   Com ControlMaster a primeira conexao fica guardada num socket e as seguintes
   entram por dentro dela, em milissegundos.
   Nem todo ssh sabe multiplexar. Medido nesta maquina em 07/09/2026: NENHUM dos
   dois que existem aqui sabe (detalhe e numeros no bloco da sonda, logo abaixo).
   Por isso a deteccao e' honesta -- ela nao afirma que funciona, so' descarta
   quem comprovadamente nao sabe, e a prova final vem da primeira ida de verdade
   ao servidor. Sem multiplexing tudo continua funcionando do jeito de hoje:
   uma conexao por chamada, sem quebrar nada e sem prometer nada.

   Este bloco fica DEPOIS do claudeStart/claudeStop de proposito: o teste
   teste-ssh.js recorta o trecho que abre o ssh do motor, e um spawn de ssh novo
   la' em cima o faria conferir o bloco errado.                              */

let muxEstado = null;     // null = ainda NAO SEI, true = provado que da', false = provado que nao
let muxProbe = null;      // a sonda local roda UMA vez; quem chegar junto espera esta promessa
let muxProvado = false;   // ja' vi uma chamada COM multiplexing dar certo de verdade
let muxSustos = 0;        // falhas inconclusivas; depois de 3 desiste e fica no modo simples
/* binario usado SO' nas chamadas de arquivo (arvore, "@" e visor) quando ha'
   multiplexing em jogo. A CONVERSA (claudeStart) nunca troca de ssh: ela
   funciona hoje e nao se mexe no que funciona. */
let sshDeArquivo = 'ssh';
const sockUsados = new Map();   // socket de controle -> binario que o criou (e' com ele que se fecha)

function pastaSsh() {
  const dir = path.join(app.getPath('userData'), 'ssh');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

/* O caminho do socket nao pode ter aspa dupla, crase, %, \r nem \n: ele pode
   acabar dentro de uma linha montada pelo cmd.exe (o terminal do painel remoto
   monta uma), e la' esses caracteres fecham o bloco -- o resto rodaria no PC em
   vez do servidor. Se a pasta do usuario tiver algum deles, o multiplexing
   simplesmente nao entra. */
function sockSeguro(p) { return /["`%\r\n]/.test(p) ? '' : p; }

/* Um socket por usuario@host, com nome curto e so' [a-z0-9_-]: socket de
   dominio Unix tem teto de ~104 caracteres no caminho inteiro. */
function caminhoDoSocket(remoto) {
  const alvo = String(remoto && remoto.usuario || '') + '@' + String(remoto && remoto.host || '')
    + ':' + String(remoto && remoto.porta || 22) + ':' + String(remoto && remoto.chave || '');
  const nome = 'cm-' + crypto.createHash('sha1').update(alvo).digest('hex').slice(0, 16);
  return sockSeguro(path.join(pastaSsh(), nome));
}

/* ===== A SONDA DO MULTIPLEXING (medida em 07/09/2026 -- nao desfazer) =====

   1. "ssh -G" NAO testa multiplexing: ele so' LE a configuracao e imprime o
      resultado. O ssh que o app acha nesta maquina e'
      C:\WINDOWS\System32\OpenSSH\ssh.exe (OpenSSH_for_Windows_9.5p2) e ele
      responde ao -G, sem pestanejar:
          controlmaster auto / controlpath ... / controlpersist 120   (saiu 0)
      ...e mesmo assim NAO sabe multiplexar. Uma chamada de verdade com
      ControlMaster=auto, contra a VPS, sai assim:
          getsockname failed: Not a socket
          Read from remote host 203.0.113.10: Unknown error    (saiu != 0, ZERO saida)
      Ou seja: com o -G como prova, o muxEstado=true era falso positivo, o ganho
      da Fase A era ZERO e ainda se gastava uma conexao a mais por chamada ate'
      a degradacao pegar.

   2. Procurei um ssh que soubesse, como manda o achado. O Git for Windows traz
      um OpenSSH do MSYS2 (C:\Program Files\Git\usr\bin\ssh.exe,
      OpenSSH_10.5p1) e ele ATE' levanta o mestre -- o "ssh -O check" responde
      "Master running (pid=10813)". Mas a sessao nao passa pelo socket, porque o
      AF_UNIX emulado do MSYS2 nao passa descritor de arquivo:
          mm_send_fd: sendmsg(2): Broken pipe
          mux_client_request_session: send fds failed          (1a chamada: ZERO saida)
          ControlSocket ... already exists, disabling multiplexing  (as seguintes)
      Medido contra a VPS: 968/675/603 ms com o socket torto contra 511/496/565
      ms do ssh do Windows sem multiplexing nenhum. Conclusao honesta: no
      Windows de hoje NENHUM dos dois multiplexa, e a coisa certa e' nao
      prometer nada e degradar calado pro modo de sempre.

   Por isso a sonda daqui nunca AFIRMA que da' certo -- ela so' DESCLASSIFICA
   quem comprovadamente nao sabe. Quem passa fica em "talvez", e quem decide e'
   a primeira conexao DE VERDADE, no execRemoto, que ja' tem o caminho de
   degradacao pronto.                                                        */

// resposta do ssh que nao sabe multiplexar (o do Windows, a qualquer -O)
const SSH_SEM_MUX = /getsockname failed|not a socket/i;
// vestigio de multiplexing quebrado numa chamada de verdade: desiste na hora
const SSH_MUX_TORTO = /mm_send_fd|mux_client|control master|controlsocket|disabling multiplexing|getsockname/i;
/* Erro que o servidor (ou o ssh, sobre o servidor) ja' respondeu de forma
   fechada: host que nao existe, chave recusada, porta fechada, identidade
   trocada. Repetir isso sem multiplexing so' gasta outra conexao e o dobro do
   tempo pra receber exatamente o mesmo "nao". Sao as mesmas frases que o
   motivoDoSsh sabe nomear -- menos a linha generica dele, que pega qualquer
   coisa e nao serve de prova. */
const SSH_ERRO_FECHADO = /Permission denied|denied \(publickey|no such identity|Load key|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Connection refused|Could not resolve hostname|Name or service not known|No route to host|Connection timed out|Operation timed out|ssh_exchange_identification/i;

/* Candidatos a ssh das chamadas de arquivo. O primeiro e' sempre o ssh de
   sempre; os outros so' entram se o de sempre for descartado. */
function candidatosDeSsh() {
  const lista = ['ssh'];
  if (!EH_WIN) return lista;
  for (const p of [
    'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\ssh.exe',
    path.join(HOME, 'AppData', 'Local', 'Programs', 'Git', 'usr', 'bin', 'ssh.exe'),
  ]) {
    try { if (fs.statSync(p).isFile()) lista.push(p); } catch {}
  }
  return lista;
}

/* Este ssh sabe multiplexar? Dois filtros, os dois locais e instantaneos:
   - a versao: no Windows, um ssh que nao se anuncia como "for_Windows" e' build
     de MSYS2/Cygwin, e foi medido acima que o socket emulado dele nao passa
     descritor de arquivo -- ele levanta o mestre e a sessao morre;
   - "ssh -O check" num socket que nao existe: isto exercita o CLIENTE de
     multiplexing de verdade (coisa que o -G nao faz) sem tocar na rede. Quem
     sabe multiplexar responde "Control socket connect(...): No such file or
     directory"; quem nao sabe responde "getsockname failed: Not a socket". */
async function sabeMultiplexar(bin) {
  const v = await rodar(bin, ['-V'], 5000);
  const versao = String((v && v.errout) || '') + String((v && v.out) || '');
  if (!versao) return false;                                   // nem respondeu: nao afirma nada
  if (EH_WIN && !/for_windows/i.test(versao)) return false;    // MSYS2/Cygwin: medido, nao passa fd
  const falso = sockSeguro(path.join(pastaSsh(), 'cm-sonda'));
  if (!falso) return false;
  const r = await rodar(bin, ['-O', 'check', '-o', 'ControlPath=' + falso,
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', 'cockpit-sonda-multiplexing'], 8000);
  const dito = String((r && r.errout) || '') + String((r && r.out) || '');
  if (!dito) return false;
  return !SSH_SEM_MUX.test(dito);
}

/* Vale a pena TENTAR multiplexar? Nunca responde "sim, funciona" -- responde
   "nenhum ssh daqui esta descartado, entao vale tentar". A prova vem do
   execRemoto, na primeira ida de verdade ao servidor. */
function muxDaConta() {
  if (muxEstado !== null) return Promise.resolve(muxEstado);
  if (muxProbe) return muxProbe;
  muxProbe = (async () => {
    for (const bin of candidatosDeSsh()) {
      if (await sabeMultiplexar(bin)) { sshDeArquivo = bin; return true; }
    }
    // nenhum ssh desta maquina sabe: modo simples, calado, exatamente o de antes
    muxEstado = false;
    return false;
  })().catch(() => { muxEstado = false; return false; });
  return muxProbe;
}

/* O multiplexing nao vingou: modo simples pelo resto da sessao. O ssh das
   chamadas de arquivo volta a ser o de sempre e o mestre torto que ficou
   pendurado sai AGORA -- se ficasse, todo pedido seguinte tropecaria no
   "ControlSocket ... already exists, disabling multiplexing". */
function desistirDoMux() {
  if (muxEstado === false) return;
  muxEstado = false;
  const sobraram = [...sockUsados.keys()];
  fecharMestresSsh();
  for (const s of sobraram) { try { fs.unlinkSync(s); } catch {} }
  sshDeArquivo = 'ssh';
}

/* O mestre do ControlPersist segue vivo em segundo plano depois da ultima
   chamada (ate' 120s), segurando uma conexao aberta com o servidor. Fechar o
   Cockpit -- ou recarregar a tela -- pede pra ele sair AGORA, em vez de deixar
   processo e conexao penduradas. Se o pedido nao chegar, ele morre sozinho no
   tempo dele: aqui nada e' esperado nem reclamado. */
function fecharMestresSsh() {
  for (const [s, bin] of sockUsados) {
    try {
      // com o ControlPath explicito o nome do host nao e' usado pra nada,
      // mas o ssh exige um: qualquer palavra serve. O binario tem que ser o
      // MESMO que abriu o socket -- outro ssh nem entende o formato dele.
      const p = spawnBin(bin || 'ssh', ['-O', 'exit', '-o', 'ControlPath=' + s, 'cockpit'],
        { env: buildEnv(), stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    } catch {}
  }
  sockUsados.clear();
}

const sshDeuCerto = (r) => !!r && !r.falhou && !r.estourou && r.code === 0;

/* Esta falha pode ter sido o proprio multiplexing? E' o filtro que decide se
   vale gastar UMA segunda ida ao servidor sem ele. Em ordem:
     - vestigio explicito no texto (mm_send_fd, mux_client, "disabling
       multiplexing"): e' ele, sem duvida;
     - o comando RODOU la' e voltou com codigo proprio -- pasta inexistente,
       grep sem resultado, script que saiu 1. O tunel funcionou, entao o mux nao
       tem culpa nenhuma. O ssh reserva o 255 pros erros DELE, entao qualquer
       outro codigo veio de dentro do servidor;
     - erro fechado de host, chave ou rede: resposta do outro lado, nao do mux;
     - o resto e' ambiguo e vale a tentativa. Inclusive o "nem chamei o ssh":
       com multiplexing o binario pode ser outro (o do Git), e o de sempre ainda
       pode estar de pe. */
function podeSerCulpaDoMux(r) {
  if (!r) return false;
  const e = String(r.errout || '');
  if (SSH_MUX_TORTO.test(e)) return true;
  if (!r.falhou && !r.estourou && Number.isFinite(r.code) && r.code !== 0 && r.code !== 255) return false;
  return !SSH_ERRO_FECHADO.test(e);
}

/* Uma ida ao servidor. NUNCA rejeita: devolve {code,out,errout} quando rodou,
   {falhou} quando nem chegou a chamar o ssh, {estourou} quando passou do tempo. */
function sshUmaVez(remoto, script, timeout, comMux) {
  return new Promise((resolve) => {
    const sock = comMux ? caminhoDoSocket(remoto) : '';
    /* Sem multiplexing e' SEMPRE o ssh de sempre: um binario alternativo so'
       tem razao de existir se ele multiplexar. Assim o modo simples continua
       byte por byte o de antes desta leva. */
    const bin = sock ? sshDeArquivo : 'ssh';
    const args = ['-i', remoto.chave, '-p', String(remoto.porta || 22), '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
    if (sock) {
      args.push('-o', 'ControlMaster=auto', '-o', 'ControlPath=' + sock, '-o', 'ControlPersist=120');
      sockUsados.set(sock, bin);
    }
    args.push(remoto.usuario + '@' + remoto.host, '--', script);
    let proc;
    try { proc = spawnBin(bin, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ falhou: true, errout: String(e && e.message || e) }); }
    let out = '', errout = '', acabou = false;
    const fim = (r) => { if (acabou) return; acabou = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { proc.kill(); } catch {} fim({ estourou: true, errout }); }, timeout || 20000);
    // 48 MB de folga: o teto de imagem (25 MB) vira ~34 MB depois do base64
    proc.stdout.setEncoding?.('utf8');    proc.stdout.on('data', (d) => { if (out.length < 48 * 1024 * 1024) out += d.toString('utf8'); });
    proc.stderr.setEncoding?.('utf8');    proc.stderr.on('data', (d) => { if (errout.length < 8000) errout += d.toString('utf8'); });
    proc.on('error', (e) => fim({ falhou: true, errout: String(e && e.message || e) }));
    /* o normal e' o 'close' chegar logo depois do 'exit'. Mas o ssh que fica de
       mestre (ControlPersist) segue vivo em segundo plano, e se alguma versao
       dele segurar o cano de saida o 'close' nunca vem -- por isso o 'exit'
       tambem fecha, com um respiro pra terminar de ler o que ja' chegou. */
    proc.on('exit', (code) => { setTimeout(() => fim({ code, out, errout }), 250); });
    proc.on('close', (code) => fim({ code, out, errout }));
  });
}

/* O 'remoto' chega da TELA (nunca do claudeRemoto daqui, que some no
   claudeStop). Aqui ele e' conferido e reduzido aos quatro campos que
   interessam: nada mais do objeto da aba entra num comando. */
function normalizarRemoto(r) {
  if (!r || typeof r !== 'object') return null;
  if (!r.host || !r.usuario || !r.chave) return null;
  if (!ssgValido(r)) return null;
  return {
    host: String(r.host).replace(/^\[([^\]]+)\]$/, '$1'), usuario: String(r.usuario), chave: String(r.chave),
    caminhoRemoto: String(r.caminhoRemoto || '~'), porta: Number(r.porta || 22),
  };
}

/* A tela pediu modo remoto? So' a PRESENCA do objeto decide -- se ele vier
   torto, o pedido vira erro, nunca uma volta calada pro disco daqui. */
function remotoDoPedido(o) {
  const r = o && o.remoto;
  return (r && typeof r === 'object' && (r.host || r.usuario || r.chave)) ? r : null;
}

function erroDoSsh(r, remoto) {
  const onde = (remoto && remoto.host) ? ' (' + remoto.host + ')' : '';
  if (!r) return 'Não consegui falar com o servidor' + onde + '.';
  if (r.estourou) return 'O servidor' + onde + ' não respondeu a tempo. Conexão lenta ou servidor ocupado.';
  if (r.falhou) return 'Não consegui chamar o ssh: ' + String(r.errout || '').slice(0, 200);
  const motivo = motivoDoSsh(r.errout, remoto);
  if (motivo) return motivo;
  return 'O servidor' + onde + ' recusou o comando (código ' + r.code + ').';
}

/* Helper unico de exec remoto: um comando, uma resposta. Devolve {out} ou
   {error} com frase em portugues -- falha de rede NUNCA pode virar resultado
   vazio, que na tela viraria "essa pasta nao tem nada". Nunca rejeita. */
async function execRemoto(remoto, script, timeout) {
  const alvo = normalizarRemoto(remoto);
  if (!alvo) return { error: 'Servidor desta aba está incompleto ou com endereço inválido. Edite a aba.' };
  const podeMux = await muxDaConta();
  let r = await sshUmaVez(alvo, script, timeout, podeMux);
  /* ESTA e' a prova de que o multiplexing funciona -- uma ida de verdade ao
     servidor que voltou certa. A sonda local nunca afirma isso. */
  if (podeMux && sshDeuCerto(r)) { muxEstado = true; muxProvado = true; return { out: r.out }; }
  /* Falhou COM multiplexing: tenta UMA vez do jeito simples. Se ai funcionar, o
     multiplexing sai de cena pelo resto da sessao e nada quebra.
     Esta volta vale SEMPRE, inclusive depois de ele ja' ter sido provado -- era
     esse o buraco: prova velha nao segura mestre morto nem socket vencido no
     meio da sessao, e arvore, "@" e visor ficavam quebrados ate' reiniciar o
     app. Prova de que funcionou uma vez nao e' promessa de que funciona agora.
     Sem laco: e' uma tentativa so', ja' sem mux, e o que ela devolver e' a
     palavra final. E sem gastar conexao a toa -- erro fechado (host errado,
     chave recusada, pasta inexistente) nao volta, porque a resposta seria a
     mesma.
     Se a segunda tambem falhar: cara de multiplexing quebrado derruba o mux na
     hora; falha ambigua so' conta susto enquanto ele nao se provou -- depois
     disso a culpa e' da rede, e nao se aposenta o que ja' funcionou. */
  if (podeMux && podeSerCulpaDoMux(r)) {
    const culpaDoMux = SSH_MUX_TORTO.test(String((r && r.errout) || ''));
    const r2 = await sshUmaVez(alvo, script, timeout, false);
    if (sshDeuCerto(r2)) { desistirDoMux(); return { out: r2.out }; }
    if (culpaDoMux || (!muxProvado && ++muxSustos >= 3)) desistirDoMux();
    r = r2;
  }
  if (sshDeuCerto(r)) return { out: r.out };
  return { error: erroDoSsh(r, alvo) };
}

/* Blocos de imagem de um tool_result (formato conferido num .jsonl real:
   {type:'image', source:{type:'base64', media_type, data}}). Teto por imagem e
   por resultado: e' pra ver o print, nao pra guardar um filme na tela. */
const LIM_IMG_PASSO = 3 * 1024 * 1024;   // em base64 (~2,2 MB de png)

function claudeMessage(paneId, m) {
  observabilidade.observarClaude(paneId, m);
  if (m.type === 'system' && m.subtype === 'init') { const st = claudePanes.get(paneId); if (st) st.sessionId = m.session_id; }
  if (m.type === 'control_cancel_request') { interactionBroker.resolved(claudeScope(paneId, m), m.request_id); return; }
  if (m.type === 'control_request' && m.request?.subtype === 'elicitation') {
    const st = claudePanes.get(paneId);
    if (st) interactionBroker.requestClaude(claudeScope(paneId, m), m, response => {
      if (claudePanes.get(paneId) === st) try { st.proc.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } }) + '\n'); } catch {}
    });
    return;
  }
  if (m.type === 'result') { claudePanes.get(paneId)?.remoteHost?.cancelTurn(); interactionBroker.cancelScope({ paneId: String(paneId), engine: 'claude' }, 'Turno encerrado.'); }
  if (m.type === 'control_response') return;
  /* sugestao de proxima mensagem (--prompt-suggestions). O campo exato pode
     variar entre versoes do CLI: le os nomes conhecidos e descarta o resto. */
  if (m.type === 'prompt_suggestion') {
    const cru = m.suggestion != null ? m.suggestion : (m.prompt != null ? m.prompt : (m.text != null ? m.text : m.value));
    const lista = (Array.isArray(cru) ? cru : [cru])
      .map((x) => {
        if (x == null) return '';
        if (typeof x === 'string') return x.trim();
        return String((x && (x.text || x.prompt || x.suggestion)) || '').trim();
      })
      .filter(Boolean).slice(0, 3);
    if (lista.length) emit(paneId, 'sugestao', { itens: lista });
    return;
  }
  if (m.type === 'control_request' && m.request && m.request.subtype === 'can_use_tool') {
    /* Tarefa 8: a pergunta (AskUserQuestion), o plano (ExitPlanMode) e o pedido
       que o CLI marca como "precisa do usuario" saem daqui ANTES do
       auto-liberar: nem o "Sempre permitir" nem o Permitir de um clique
       respondem por eles. */
    if (pedidoDeInteracaoClaude(paneId, m)) return;
    // ferramenta que voce liberou "sempre" neste painel: responde sozinho.
    // As do proprio Cockpit (perguntar, plano) tambem: so' desenham na tela, e
    // no modo manual um cartao por atualizacao do plano travaria o turno.
    const doCockpit = /^mcp__cockpit__/.test(String(m.request.tool_name || ''));
    const liberadas = autoLiberadas.get(paneId);
    if (doCockpit || (liberadas && liberadas.has(m.request.tool_name))) {
      const st0 = claudePanes.get(paneId);
      if (st0) {
        try {
          st0.proc.stdin.write(JSON.stringify({
            type: 'control_response',
            response: { request_id: m.request_id, subtype: 'success',
              response: { behavior: 'allow', updatedInput: m.request.input } },
          }) + '\n');
        } catch {}
        // deixa rastro: sem isso a acao acontecia sem nada na tela
        if (!doCockpit) emit(paneId, 'auto-liberado', { tool: m.request.tool_name || 'ferramenta',
          arg: claudeToolArg(m.request.tool_name, m.request.input) });
        return;
      }
    }
    const key = 'cl_' + paneId + '_' + m.request_id;
    pendingApprovals.set(key, { kind: 'claude', paneId, reqId: m.request_id, input: m.request.input });
    emit(paneId, 'approval', {
      key, title: 'Claude quer usar: ' + (m.request.tool_name || 'ferramenta'),
      detail: claudeToolArg(m.request.tool_name, m.request.input), reason: '',
      tool: m.request.tool_name || '',
      mudanca: mudancaDaFerramenta(m.request.tool_name, m.request.input, paneId),
    });
    return;
  }
  if (m.type === 'stream_event' && m.event) {
    const ev = m.event;
    const marca = marcaSub(m);
    // mensagem nova comecando: numero novo (aqui, nao no fim)
    if (ev.type === 'message_start') somaSeq(paneId, marca);
    if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') emit(paneId, 'text-delta', { id: 'm' + seqDoPane(paneId, marca) + marca + 'b' + ev.index, text: d.text || '' });
      else if (d.type === 'thinking_delta') emit(paneId, 'think-delta', { text: d.thinking || '' });
    }
    return;
  }
  /* Quanto da janela a conversa ocupa AGORA. Vem do ultimo 'assistant': ali o
     usage descreve UMA chamada de API. O 'result' soma o turno inteiro - cada
     ferramenta rele o cache - e numa resposta longa aquilo passa de 1400k numa
     janela de 1000k, que e impossivel. Medido num .jsonl real: contexto de
     109k virava 4403k somando os cache_read da sessao. */
  if (m.type === 'assistant' && m.message && m.message.usage) {
    const u = m.message.usage || {};
    const total = (u.input_tokens || 0) + (u.output_tokens || 0)
      + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    // sub-agente tem contexto proprio e menor: nao pode reescrever o do painel.
    // As duas grafias aparecem no fluxo - a de baixo e a que o resto do arquivo
    // ja trata, e olhar so' uma deixava metade dos casos passar.
    const deSubAgente = !!(m.parent_tool_use_id || m.parentToolUseId);
    if (total && !deSubAgente) emit(paneId, 'tokens', { total });
    // quem respondeu DE FATO: com --fallback-model, pode nao ser o escolhido
    if (m.message.model && !deSubAgente) emit(paneId, 'modelo-usado', { modelo: m.message.model });
  }
  if (m.type === 'assistant' && m.message) {
    const marca = marcaSub(m);
    // sem streaming (nao veio message_start) o numero ainda nao existe: cria agora
    if (!temSeq(paneId, marca)) somaSeq(paneId, marca);
    const partes = Array.isArray(m.message.content) ? m.message.content
      : (typeof m.message.content === 'string' && m.message.content) ? [{ type: 'text', text: m.message.content }]
      : [];
    /* conferencia final: fala que o PROPRIO CLI escreveu como erro de API (o
       limite de uso chega assim: is_api_error_message no 2.1.270, modelo
       "<synthetic>" nos dois). So' ela pode dizer ao vigia "bateu no limite";
       o texto do modelo citando a frase nunca (quedas.js). */
    const erroDoCli = m.is_api_error_message === true || m.message.model === '<synthetic>';
    partes.forEach((c, i) => {
      if (c.type === 'text') emit(paneId, 'text-final', { id: 'm' + seqDoPane(paneId, marca) + marca + 'b' + i, text: c.text || '', ...(erroDoCli ? { erroDoCli: true } : {}) });
      else if (c.type === 'tool_use' && c.name === 'TodoWrite' && !marca && c.input && Array.isArray(c.input.todos)) {
        /* a lista de tarefas do proprio agente ja chegava aqui e era jogada
           fora - agora vira a checklist ao vivo do painel. So' a do agente
           PRINCIPAL: o plano de um sub-agente nao pode sobrescrever o da tela. */
        emit(paneId, 'plano', { itens: c.input.todos.slice(0, 30).map((t) => ({
          txt: String((t && (t.content || t.description || t.activeForm)) || '').slice(0, 200),
          estado: t && t.status === 'completed' ? 'feito' : (t && t.status === 'in_progress' ? 'fazendo' : 'pendente'),
        })).filter((x) => x.txt) });
      }
      else if (c.type === 'tool_use' && c.name === 'mcp__cockpit__plano' && !marca && c.input && Array.isArray(c.input.itens)) {
        /* a ferramenta de plano do proprio Cockpit (pergunta-mcp.js): a lista
           vem no input da chamada, entao a tela recebe AQUI, sem esperar o
           servidor MCP responder. So' a do agente principal. */
        const itens = c.input.itens.slice(0, 30).map((t) => ({
          txt: String((t && (t.texto || t.content)) || '').slice(0, 200),
          estado: t && (t.estado === 'feito' || t.estado === 'completed') ? 'feito'
            : (t && (t.estado === 'fazendo' || t.estado === 'in_progress') ? 'fazendo' : 'pendente'),
        })).filter((x) => x.txt);
        // lista malformada (o servidor MCP ja devolve erro ao modelo) nao pode
        // apagar o plano bom que esta na tela
        if (itens.length) emit(paneId, 'plano', { itens });
      }
      else if (c.type === 'tool_use' && c.name === 'PushNotification') {
        /* o CLI descarta a notificacao no modo sem terminal ("not sent"). A
           chamada passa por aqui antes: o Cockpit entrega ele mesmo - tambem
           quando vem de um sub-agente (ele te chamou do mesmo jeito). */
        const texto = [c.input && c.input.title, c.input && c.input.message].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (texto) emit(paneId, 'aviso-agente', { texto });
        emit(paneId, 'tool-start', { id: c.id, name: c.name, arg: texto, mudanca: null });
      }
      else if (c.type === 'tool_use' && (c.name === 'AskUserQuestion' || c.name === 'ExitPlanMode')
        && (claudePanes.get(paneId) || {}).comCanal) {
        /* Tarefa 8: com o canal de permissao, pergunta e plano tem tela propria
           (a caixa de perguntas e o cartao "Plano pronto"): nao viram passo.
           Sem o canal (Sem pedir permissao, servidor) segue como era. */
      }
      else if (c.type === 'tool_use') emit(paneId, 'tool-start', { id: c.id, name: c.name, arg: claudeToolArg(c.name, c.input), mudanca: mudancaDaFerramenta(c.name, c.input, paneId) });
    });
    return;
  }
  if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
    for (const c of m.message.content) {
      if (c.type === 'tool_result') {
        emit(paneId, 'tool-end', { id: c.tool_use_id, ...resultadoFerramenta(c.content), error: !!c.is_error });
      }
    }
    return;
  }
  /* Robo em segundo plano: trabalho que continua DEPOIS que o turno acaba.
     O painel fica "parado" e ele segue rodando - sem sinal, voce olha a tela
     e acha que nao tem nada acontecendo.

     O claude manda a LISTA INTEIRA a cada mudanca (e [] quando acabam), entao
     a tela so' espelha o que veio em vez de contar comeco e fim por conta -
     assim nao ha como dessincronizar. Medido antes de escrever: a
     <task-notification> que fecha a tarefa NAO sai no stdout (so' vai pro
     historico gravado), entao ela nao serve pra isto; este evento serve. */
  if (m.type === 'system' && m.subtype === 'background_tasks_changed') {
    const tarefas = (Array.isArray(m.tasks) ? m.tasks : []).map((x) => ({
      id: String((x && x.task_id) || ''),
      tipo: (x && x.task_type) === 'local_bash' ? 'comando' : 'agente',
      desc: String((x && x.description) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })).filter((x) => x.id);
    emit(paneId, 'robos', { tarefas });
    return;
  }
  if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
    // conversa que roda no servidor nao tem arquivo aqui: mandar um caminho
    // local inventado fazia o app procurar no PC e voltar vazio ao reabrir a aba
    const remotoDaqui = claudeRemoto.get(paneId);
    emit(paneId, 'sessao', {
      id: m.session_id,
      file: remotoDaqui ? '' : path.join(CLAUDE_PROJ, encodeCwd(m.cwd || claudeCwd.get(paneId) || HOME), m.session_id + '.jsonl'),
      remoto: !!remotoDaqui,
    });
    if (!remotoDaqui && typeof m.permissionMode === 'string') {
      emit(paneId, 'modo-real', { modo: modoDoCockpitPeloInit(m.permissionMode) });
    }
    // quais conectores esta sessao conhece (locais, plugins e os do claude.ai):
    // e' desta lista que o editor de abas monta os perfis
    if (!remotoDaqui && Array.isArray(m.mcp_servers)) {
      emit(paneId, 'conectores', { itens: m.mcp_servers.map((s) => ({ nome: String((s && s.name) || ''), status: String((s && s.status) || '') })).filter((s) => s.nome) });
    }
    return;
  }
  if (m.type === 'result') {
    limparAnexosClaudeRemotos(paneId);
    // turno acabou: pedido de permissao que sobrou nao vale mais
    descartarPermissoes(paneId);
    // e a conta de mensagem de cada sub-agente tambem morre aqui, senao o mapa
    // ganhava uma chave por Task e nunca soltava
    limparSeq(paneId);
    let janela = 0;
    try { const mu = m.modelUsage || {}; const k = Object.keys(mu)[0]; if (k) janela = mu[k].contextWindow || 0; } catch {}
    // aqui so o TAMANHO da janela: o quanto esta ocupado ja veio do ultimo
    // 'assistant', o unico que enxerga o contexto de verdade
    if (janela) emit(paneId, 'tokens', { janela });
    if (m.is_error) emit(paneId, 'note', { text: String(m.result || m.subtype), error: true });
    /* quanto o TURNO consumiu (nao o tamanho da conversa): vai pro carimbo de
       fim de turno. cache_read fica de fora - e' releitura, nao consumo novo. */
    try {
      const u = m.usage || {};
      const entrada = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const saida = u.output_tokens || 0;
      if (entrada || saida) emit(paneId, 'turno-uso', { entrada, saida });
    } catch {}
    emit(paneId, 'turn-end', {});
  }
}

/* ============ Tarefa 8 (26/09): pergunta e plano do proprio Claude ============
   O can_use_tool que precisa de VOCE e nao cabe no Permitir/Negar:
   - AskUserQuestion vai pra caixa de perguntas (a mesma do mcp__cockpit__perguntar);
     a resposta volta pelo pergunta:responder;
   - ExitPlanMode vira o cartao "Plano pronto" (evento 'plano-pronto'); a
     resposta volta pelo pane:plano;
   - pedido desconhecido que o CLI marca com requires_user_interaction e'
     recusado na hora, com recado: um clique em Permitir aprovaria sem a
     interacao que ele pede.
   UMA resposta por pedido: quem responde (pergunta:responder, pane:plano,
   descartarPedidosClaude) tira o pedido do mapa ANTES de escrever, e so'
   escreve no processo que perguntou (escreverRespostaClaude).
   Devolve true quando o pedido foi tratado aqui. */
function pedidoDeInteracaoClaude(paneId, m) {
  const req = m.request || {};
  const nome = String(req.tool_name || '');
  const nossa = nome === 'AskUserQuestion' || nome === 'ExitPlanMode';
  const pedeVoce = req.requires_user_interaction === true && !/^mcp__cockpit__/.test(nome);
  if (!nossa && !pedeVoce) return false;
  const st = claudePanes.get(paneId);
  const pedido = { paneId, processo: st || null, reqId: m.request_id,
    input: (req.input && typeof req.input === 'object' && !Array.isArray(req.input)) ? req.input : {} };
  const recusar = (nota) => {
    escreverRespostaClaude(pedido, interacao.respostaSemTela(nome));
    emit(paneId, 'note', { text: nota, error: true });
    return true;
  };
  const geracao = st ? st.geracao : 0;
  if (nome === 'AskUserQuestion') {
    const perguntas = interacao.perguntasDoAsk(pedido.input);
    // sem pergunta que de pra mostrar, a caixa nao abre: o motor nao pode ficar esperando por ela
    if (!perguntas.length) return recusar('Ele tentou perguntar algo, mas as perguntas vieram num formato que o Cockpit não mostra. Recusei; ele segue sem elas.');
    const chave = interacao.chaveDoPedido('claude_q_', geracao, m.request_id);
    pedidosClaude.set(chave, { ...pedido, tipo: 'perguntas' });
    emit(paneId, 'pergunta', { id: chave, perguntas, bloqueante: true });
    return true;
  }
  if (nome === 'ExitPlanMode') {
    /* um plano por painel, como na tela (P.planoPendente): um pedido novo
       substitui o velho, que recebe um "nao" -- senao sobraria um pedido que
       nenhum cartao responde e o motor poderia ficar esperando por ele */
    for (const [k, velho] of [...pedidosClaude]) {
      if (!velho || velho.paneId !== paneId || velho.tipo !== 'plano') continue;
      pedidosClaude.delete(k);
      escreverRespostaClaude(velho, interacao.respostaDeDescarte('plano'));
      emit(paneId, 'plano-cancelado', { chave: k });
    }
    const chave = interacao.chaveDoPedido('claude_p_', geracao, m.request_id);
    pedidosClaude.set(chave, { ...pedido, tipo: 'plano' });
    emit(paneId, 'plano-pronto', { chave, plano: String(pedido.input.plan || ''), arquivoDoPlano: String(pedido.input.planFilePath || '') });
    return true;
  }
  return recusar('Ele pediu uma confirmação que o Cockpit ainda não sabe mostrar (' + nome.slice(0, 80) + '). Recusei; ele segue sem ela.');
}

/* Escreve a control_response SO' no processo que perguntou: se o painel ja'
   subiu outro processo (ou este esta' parando), nada sai. try/catch: stdin de
   processo morrendo nao derruba o app. */
function escreverRespostaClaude(a, resposta) {
  const st = a && claudePanes.get(a.paneId);
  if (!st || st !== a.processo || st.parandoDeProposito) return false;
  try {
    st.proc.stdin.write(JSON.stringify({
      type: 'control_response',
      response: { request_id: a.reqId, subtype: 'success', response: resposta },
    }) + '\n');
    return true;
  } catch { return false; }
}

/* Fim de turno, parar, fechar o painel (descartarPermissoes): cada pedido
   pendurado deste painel recebe um "nao" (se o processo que perguntou ainda
   estiver ai') e a tela tira a caixa e o cartao. */
function descartarPedidosClaude(paneId) {
  for (const [chave, a] of [...pedidosClaude]) {
    // filtro ESTRITO: um paneId indefinido nao pode significar "cancela tudo"
    if (!a || a.paneId !== paneId) continue;
    pedidosClaude.delete(chave);
    escreverRespostaClaude(a, interacao.respostaDeDescarte(a.tipo));
    if (a.tipo === 'plano') emit(paneId, 'plano-cancelado', { chave });
    else emit(paneId, 'pergunta-cancelada', { id: chave, texto: 'A pergunta foi encerrada: o turno acabou ou o painel parou.' });
  }
}

/* o que a ferramenta vai mudar no arquivo, pra desenhar o diff na tela.
   O dado ja vinha no input da ferramenta - era so' parar de jogar fora. */
const LIM_DIFF = 100 * 1024;
function mudancaDaFerramenta(name, inp, paneId) {
  if (!inp || typeof inp !== 'object') return null;
  // painel que roda no servidor: o arquivo nao esta neste disco
  const ehRemoto = paneId ? claudeRemoto.has(paneId) : false;
  const corta = (s) => { const t = String(s == null ? '' : s); return t.length > LIM_DIFF ? t.slice(0, LIM_DIFF) + '\n…(cortado)' : t; };
  const caminho = inp.file_path || inp.notebook_path || inp.path || '';
  // Tarefa 9: "todas" (replace_all) vai junto; o desfazer recusa troca de todas as ocorrencias
  if (name === 'Edit' && (inp.old_string !== undefined || inp.new_string !== undefined)) {
    return { path: caminho, antes: corta(inp.old_string), depois: corta(inp.new_string), tipo: 'edit', todas: !!inp.replace_all };
  }
  if (name === 'MultiEdit' && Array.isArray(inp.edits)) {
    return {
      path: caminho, tipo: 'multi',
      partes: inp.edits.slice(0, 20).map((e) => ({ antes: corta(e.old_string), depois: corta(e.new_string) })),
      // a tela ve no maximo 20 trocas; o desfazer precisa saber se a lista veio inteira
      todas: inp.edits.some((e) => !!(e && e.replace_all)), total: inp.edits.length,
    };
  }
  if (name === 'Write' && inp.content !== undefined) {
    // arquivo que ja existe: le o conteudo atual pra mostrar o que SAI.
    // Sem isso, sobrescrever 2000 linhas aparecia como "+50, nada removido".
    let antes = '';
    let existia = false;
    let incerto = !caminho;
    let antesInexato = false;
    // caminho de rede (\\servidor\...) pode demorar muito: nao vale travar o app
    const ehRede = /^\\\\/.test(String(caminho || ''));
    if (!ehRemoto && !ehRede) {
      try {
        if (caminho && fs.existsSync(caminho)) {
          existia = true;
          incerto = true;   // visto no disco: erro/non-file nunca significa arquivo novo
          const st = fs.statSync(caminho);
          if (st.isFile() && st.size <= LIM_DIFF) {
            const bruto = fs.readFileSync(caminho);
            antes = bruto.toString('utf8'); existia = true;
            incerto = false;
            /* Tarefa 9: o desfazer so' devolve o antes se ele for o arquivo de ANTES do motor gravar, byte
               a byte. Sem cartao de permissao (auto, auto-edit, sem pedir permissao, regra "allow") o CLI
               grava sem esperar o main, entao nao confia quando: o arquivo foi mexido desde o comeco do
               turno (pode ja' ser o da IA) ou nao ha' turno conhecido; leu 0 bytes (truncado e ainda nao
               escrito); o tamanho ou a hora mudaram durante a leitura; o UTF-8 nao volta igual. */
            const inicio = paneId ? vigiaTurno.inicioDoTurno(paneId) : 0;
            let depoisDeLer = null;
            try { depoisDeLer = fs.statSync(caminho); } catch {}
            antesInexato = !inicio || st.mtimeMs >= inicio || bruto.length === 0 || bruto.length !== st.size
              || !depoisDeLer || depoisDeLer.size !== st.size || depoisDeLer.mtimeMs !== st.mtimeMs
              || !Buffer.from(antes, 'utf8').equals(bruto);
          }
          else if (st.isFile()) return { path: caminho, tipo: 'write-grande', depois: corta(inp.content), bytes: st.size };
        } else if (caminho) {
          // existsSync tambem devolve false em falhas de acesso. So ENOENT prova ausencia.
          try { fs.lstatSync(caminho); incerto = true; }
          catch (e) { incerto = !e || e.code !== 'ENOENT'; }
        }
      } catch { incerto = true; }
    }
    // sem poder olhar o arquivo, nao afirma que e' novo
    const tipo = (ehRemoto || ehRede || incerto) ? 'write-incerto' : (existia ? 'write' : 'write-novo');
    return { path: caminho, antes: corta(antes), depois: corta(inp.content), tipo, ...(antesInexato ? { antesInexato: true } : {}) };
  }
  return null;
}

/* Tarefa 9 (27/09): "Desfazer esta mudança" no passo. A tela manda SO'
   { paneId, id }; o resto vem do registro do que o proprio main emitiu
   (guardarMudancaEmitida). Recusa sem tocar no disco: painel remoto ou
   trabalhando, passo que o main nao emitiu (ou ja' desfeito, ou com id
   repetido), Write grande ou incerto, caminho relativo ou de rede, "trocar
   todas", passo com varios arquivos, texto cortado ou vazio.
   Depois: atalho (symlink) resolvido pro arquivo de verdade, ate' 5 MB, sem
   link fisico, UTF-8 que volta byte a byte; o nucleo puro (desfazer-edicao.js)
   decide o conteudo; grava por temporario + rename na mesma pasta e so' se o
   arquivo nao mudou desde a leitura. Write de arquivo novo vai pra Lixeira.
   Qualquer duvida: nada muda. */
ipcMain.handle('arquivo:desfazer', async (_e, pedido) => {
  const { MOTIVOS, LIMITE_BYTES } = desfazerEdicao;
  const nao = (codigo, detalhe) => ({ ok: false, erro: (MOTIVOS[codigo] || MOTIVOS.falhou) + (detalhe ? ' (' + detalhe + ')' : '') });
  const o = (pedido && typeof pedido === 'object') ? pedido : {};
  const paneId = typeof o.paneId === 'string' ? o.paneId : '';
  const id = typeof o.id === 'string' ? o.id : '';
  if (!paneId || !id) return nao('sumiu');
  if (remotePaneTargets.has(paneId) || claudeRemoto.has(paneId)) return nao('remoto');
  // o agente trabalhando pode estar mexendo no mesmo arquivo agora
  if (vigiaTurno.esta(paneId) || paineisEmTrabalho.has(paneId)) return nao('trabalhando');
  const doPainel = mudancasEmitidas.get(paneId);
  const reg = doPainel ? doPainel.itens.get(id) : null;
  if (!reg) return nao('sumiu');
  if (reg.repetido) return nao('idRepetido');
  if (reg.desfeita) return nao('desfeita');
  if (reg.andando) return nao('andando');
  // so' o passo que o main viu terminar ok: negado ou com erro nao mudou o arquivo
  if (reg.fim === 'erro') return nao('passoErro');
  if (reg.fim !== 'ok') return nao('passoAberto');
  if (reg.tipo === 'write-grande') return nao('grande');
  if (reg.tipo === 'write-incerto') return nao('incerto');
  if (/^[\\/]{2}/.test(reg.path)) return nao('rede');
  if (!desfazerEdicao.caminhoLocal(reg.path, EH_WIN)) return nao('caminho');
  const recusa = desfazerEdicao.validarMudanca(reg.mudanca);
  if (recusa) return { ok: false, erro: recusa.motivo };
  // daqui pra frente toca no disco; o registro fica preso ate' acabar (dois cliques nao desfazem duas vezes)
  reg.andando = true;
  try {
    let real;
    try { real = fs.realpathSync.native(reg.path); } catch { return nao('naoExiste'); }
    if (/^[\\/]{2}/.test(real)) return nao('rede');   // unidade mapeada que aponta pra rede
    const st = fs.statSync(real);
    if (!st.isFile()) return nao('naoArquivo');
    if (st.size > LIMITE_BYTES) return nao('grandeDemais');
    // link fisico: o temporario + rename quebraria o link, e gravar no lugar nao e' atomico (revisao 1)
    if (st.nlink > 1) return nao('linkFisico');
    const bruto = fs.readFileSync(real);
    const atual = bruto.toString('utf8');
    if (!Buffer.from(atual, 'utf8').equals(bruto)) return nao('naoUtf8');
    const plano = desfazerEdicao.planejarDesfazer(atual, reg.mudanca);
    if (!plano.ok) return { ok: false, erro: plano.motivo };
    // outro programa gravou depois da leitura: nao pisa em cima
    const mexeram = () => { const agora = fs.statSync(real); return agora.size !== st.size || agora.mtimeMs !== st.mtimeMs; };
    if (plano.lixeira) {
      if (mexeram()) return nao('mudou');
      try { await shell.trashItem(real); }
      catch (e) { return nao(e && (e.code === 'EBUSY' || e.code === 'EPERM') ? 'aberto' : 'lixeira'); }
    } else {
      // na MESMA pasta (o rename fica no mesmo disco); nome curto, pra nao estourar o limite do nome
      const tmp = path.join(path.dirname(real), '.' + path.basename(real).slice(0, 60) + '.desfazer-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.tmp');
      let trocou = false;
      try {
        fs.writeFileSync(tmp, plano.novoConteudo, { encoding: 'utf8', flag: 'wx' });
        try { fs.chmodSync(tmp, st.mode & 0o7777); } catch {}   // as permissoes do arquivo de verdade
        if (mexeram()) return nao('mudou');
        fs.renameSync(tmp, real);
        trocou = true;
      } finally { if (!trocou) { try { fs.unlinkSync(tmp); } catch {} } }
    }
    reg.desfeita = true;
    return { ok: true };
  } catch (e) {
    const codigo = e && e.code;
    if (codigo === 'EBUSY' || codigo === 'EPERM') return nao('aberto');
    if (codigo === 'ENOENT') return nao('naoExiste');
    return nao('falhou', codigo || String(e && e.message || e).slice(0, 120));
  } finally { reg.andando = false; }
});

function claudeToolArg(name, inp) {
  if (!inp) return '';
  const v = inp.command || inp.file_path || inp.pattern || inp.query || inp.url || inp.description || inp.skill || inp.notebook_path;
  if (v) return String(v);
  try { return JSON.stringify(inp).slice(0, 160); } catch { return ''; }
}

/* ======================= arvore de arquivos ======================= */
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.cache', 'Library']);
/* as unicas coisas com ponto na frente que a arvore e o "@" mostram. Ficam numa
   lista so' porque a mesma regra e' remontada em shell no ramo remoto -- se as
   duas nao baterem, a mesma pasta aparece aqui e some la'. */
const PONTO_OK = ['.claude', '.codex', '.env.example'];
const escondido = (nome) => nome.startsWith('.') && !PONTO_OK.includes(nome);
// ordem da arvore: pasta antes de arquivo, e dentro de cada grupo por nome
const ordemDaArvore = (a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1);

async function listDir(dir) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return { error: e.message }; }
  const out = [];
  for (const e of entries) {
    if (escondido(e.name)) continue;
    if (IGNORE.has(e.name)) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = (await fs.promises.stat(path.join(dir, e.name))).isDirectory(); } catch { continue; } }
    out.push({ name: e.name, dir: isDir, path: path.join(dir, e.name) });
  }
  out.sort(ordemDaArvore);
  return { entries: out.slice(0, 800) };
}

/* "find -printf" e "base64 -w0" sao do GNU. Em BusyBox/Alpine, num BSD ou num
   Mac o find nem entende a opcao: ele falha, o 2>/dev/null engole o motivo, e o
   codigo de saida do cano e' o do ULTIMO comando (o base64, que sai 0 com
   entrada vazia). Sem a sonda abaixo isso chegava aqui como lista vazia e a
   tela dizia "pasta vazia" -- erro virando resultado, que e' o que o plano
   proibe.
   A sonda custa nada: um find que nao desce em pasta nenhuma e um base64 sem
   entrada, dentro do MESMO comando (nenhuma ida a mais ao servidor).
   A VPS dele e' Ubuntu, entao hoje isto nunca dispara -- fica pro dia em que
   ele abrir uma aba num container Alpine. */
const SONDA_GNU = "find . -maxdepth 0 -printf '' >/dev/null 2>&1 || { echo COCKPIT_FIND_SEM_PRINTF; exit 0; }; "
  + "printf '' | base64 -w0 >/dev/null 2>&1 || { echo COCKPIT_SEM_BASE64; exit 0; }; ";
const AVISO_SEM_GNU = 'Este servidor não tem o find e o base64 do GNU (é Alpine/BusyBox ou BSD?). '
  + 'O Cockpit ainda não sabe listar arquivos aí — não é que a pasta esteja vazia.';
/* devolve a frase quando a sonda tropecou, e '' quando esta' tudo bem */
function erroDaSondaGnu(bruto) {
  return /^COCKPIT_(FIND_SEM_PRINTF|SEM_BASE64)/.test(String(bruto || '')) ? AVISO_SEM_GNU : '';
}

/* A mesma pasta, mas dentro do servidor. Um comando so' por chamada:
   - "%Y" (maiusculo) e' o tipo DEPOIS de seguir o atalho, entao link pra pasta
     aparece como pasta, igual ao ramo local faz com o statSync;
   - os campos vao separados por NUL e o pacote inteiro volta em base64, senao
     nome com espaco, acento ou quebra de linha se perderia no caminho;
   - "head -c" e' o teto de tragada; a peneira e a ordem sao feitas aqui,
     com o MESMO IGNORE e a mesma comparacao do ramo local.
   No remoto os caminhos sao POSIX: path.posix, senao o Windows emitiria "\". */
async function listDirRemoto(remoto, dir) {
  const alvo = String(dir || (remoto && remoto.caminhoRemoto) || '~');
  const script = cdRemoto(alvo) + ' 2>/dev/null || { echo COCKPIT_SEM_PASTA; exit 0; }; '
    + SONDA_GNU
    + "find . -mindepth 1 -maxdepth 1 -printf '%Y\\t%f\\0' 2>/dev/null | head -c 400000 | base64 -w0";
  const r = await execRemoto(remoto, script, 20000);
  if (r.error) return { error: r.error };
  const bruto = String(r.out || '').trim();
  if (bruto.startsWith('COCKPIT_SEM_PASTA')) {
    return { error: 'Não consegui abrir a pasta ' + alvo + ' no servidor. Ela existe e você tem acesso a ela?' };
  }
  // find/base64 que nao sao do GNU: erro com nome, nunca "pasta vazia"
  const semGnu = erroDaSondaGnu(bruto);
  if (semGnu) return { error: semGnu };
  const registros = registrosNul(bruto);
  if (registros.error) return registros;
  const out = [];
  for (const rec of registros.itens) {
    const t = rec.indexOf('\t');
    if (t < 0) continue;                       // linha cortada pelo head: descarta
    const nome = rec.slice(t + 1);
    if (!nome || escondido(nome) || IGNORE.has(nome)) continue;
    out.push({ name: nome, dir: rec.slice(0, t) === 'd', path: path.posix.join(alvo, nome) });
  }
  out.sort(ordemDaArvore);
  return { entries: out.slice(0, 800) };
}

/* desempacota a resposta em base64 de um "-printf ... \0". O ultimo pedaco tem
   que ser vazio (todo registro termina em NUL); quando nao e', o head cortou no
   meio de um nome e aquele pedaco vai fora. */
function registrosNul(b64) {
  if (!b64) return { itens: [] };
  let texto = '';
  try { texto = Buffer.from(b64, 'base64').toString('utf8'); }
  catch { return { error: 'A resposta do servidor veio corrompida.' }; }
  const partes = texto.split('\0');
  if (partes.length && partes[partes.length - 1] !== '') partes.pop();
  return { itens: partes.filter(Boolean) };
}

/* ======================= conversas recentes ======================= */
const CLAUDE_PROJ = path.join(HOME, '.claude/projects');
const NOMES_PATH = () => path.join(app.getPath('userData'), 'nomes.json');
/* Tarefa 6 (revisao): o nomes.json guarda o nome que voce deu a TODAS as
   conversas. Arquivo que nao existe (ou vazio) = nenhum nome ainda ({}).
   Arquivo que existe mas nao deu pra ler (preso por outro programa, uma pasta
   no lugar) ou que nao e' JSON = null: quem GRAVA recusa -- gravar em cima do
   {} apagava todo nome seu, e o nome automatico grava bem mais vezes agora --
   e quem confere nome seu trata como "nao sei", nunca como "nao ha'". A lista
   (lerNomes) segue lendo {} nesse caso: mostra o nome do motor.
   Rodada final da leva 5: vazio, so' espaco ou zeros, ou JSON quebrado (queda no meio da gravacao) le o .bak que o
   gravarSeguro guarda; sem .bak que abra, fica como era. O {} de verdade (voce apagou os nomes) nao cai no .bak. */
function lerNomesSeguro() {
  const objeto = (o) => ((o && typeof o === 'object' && !Array.isArray(o)) ? o : null);
  const daCopia = () => { try { return objeto(JSON.parse(fs.readFileSync(NOMES_PATH() + '.bak', 'utf8'))); } catch { return null; } };
  let texto;
  try { texto = fs.readFileSync(NOMES_PATH(), 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? {} : null; }
  if (/^[\s\0]*$/.test(texto)) return daCopia() || (texto.trim() ? null : {});
  try { return objeto(JSON.parse(texto)); }
  catch { return daCopia(); }
}
function lerNomes() { return lerNomesSeguro() || {}; }
// leva 5: o .bak so' sai de um nomes.json que abre (um vazio de queda tomava o lugar da copia boa)
function salvarNomes(o) { return gravarSeguro(NOMES_PATH(), JSON.stringify(o), (anterior) => { try { const v = JSON.parse(anterior); return !!v && typeof v === 'object' && !Array.isArray(v); } catch { return false; } }); }
const NOMES_ILEGIVEIS = 'Não consegui ler os nomes das conversas (nomes.json). Nada foi gravado, pra não apagar os nomes que você deu.';

ipcMain.handle('sessao:renomear', async (_e, { engine, id, nome, auto, remoto } = {}) => {
  /* Tarefa 6 (27/09): o nome que VOCE deu vence sempre. Ele cancela a revisao
     automatica que estiver rodando pra esta conversa (o claude -p morre), e o
     automatico que chegar depois e' recusado -- a resposta traz o seu nome, e
     a tela adota ele. (revisorDeNomes nasce mais abaixo, com o claude-rapido:
     este canal so' e' chamado depois que o arquivo inteiro carregou.) */
  if (!auto && id) revisorDeNomes.cancelarDaConversa(engine, id);
  // o automatico no servidor fica marcado como automatico (nunca vira nome seu)
  if (remoto != null) return remoteEngines.rename(engine, remoto, id, nome, { auto: !!auto });
  if (auto && !id) return true;
  // nomes.json que existe mas nao deu pra ler: nada e' gravado por cima (apagaria os nomes seus)
  const todos = lerNomesSeguro();
  if (!todos) return { ok: false, error: NOMES_ILEGIVEIS };
  /* leva 41 (B6): o nome do Cockpit mora em "_auto", separado do seu. Nao mexe
     no nome que voce deu nem no do Codex (la' seria "seu"). */
  if (auto) {
    const meu = tituloAuto.nomeDaConversa(todos, id);
    if (meu.manual) return { ok: false, conflito: true, manual: true, nome: meu.nome };
    tituloAuto.gravarNomeAuto(todos, id, nome);
    return salvarNomes(todos) ? true : { ok: false, error: 'Não consegui gravar o nome da conversa.' };
  }
  if (nome && nome.trim()) todos[id] = nome.trim(); else delete todos[id];
  if (!salvarNomes(todos)) return { ok: false, error: 'Não consegui gravar o nome da conversa.' };
  if (engine === 'codex' && id) {
    try { await codexStart(); await codexReq('thread/name/set', { threadId: id, name: nome || null }); } catch {}
  }
  return true;
});

/* Tarefa 1 (26/09): o executor UNICO do "claude -p" rapido fora de painel
   (src/claude-rapido.js: stdin, ambiente limpo, so' com a assinatura). UMA
   instancia, compartilhada por todas as funcoes -- o Mais detalhes, o nome
   da conversa (Tarefa 6) e o dos agentes depois --, para o cache de 10 min do
   "claude auth status" valer para todas. Quem chegar depois usa ESTA; nao
   cria outra. Nasce ANTES do tituloAuto.registrar, que usa esta mesma
   instancia (depois dela, daria erro de TDZ). spawnBin (e nao o spawn
   cru): Claude instalado pelo npm e' um .cmd, que o Node nao deixa chamar
   direto no Windows. */
const claudeRapido = criarClaudeRapido({
  acharBin, spawn: spawnBin, buildEnv: () => buildEnv(), pastaDados: () => app.getPath('userData'),
});

/* Tarefa 3 (26/09): Mais detalhes de um trecho (src/mais-detalhes.js). A
   pergunta roda aqui no PC mesmo pra painel da VPS: e' so' texto. */
const maisDetalhes = criarMaisDetalhes({ claudeRapido });
ipcMain.handle('detalhe:perguntar', (_e, o) => (JANELA_DE_TESTE ? { ok: false, erro: AVISO_JANELA_DE_TESTE } : maisDetalhes.perguntar(o)));   // janela de teste: nada sobe para o claude -p
ipcMain.handle('detalhe:cancelar', (_e, o) => maisDetalhes.cancelar(o));

/* Tarefa 6 (27/09): 'titulo:revisar' e 'titulo:cancelar' -- o nome automatico
   da conversa acompanha o trabalho (src/titulo-auto.js). Usa a instancia UNICA
   do claude-rapido (logo acima): pedido pelo stdin, ambiente limpo, so' com a
   assinatura. Roda aqui no PC mesmo pra painel da VPS (so' texto). O nome seu
   e' conferido antes e depois da chamada: no nomes.json (conversa do PC) ou no
   registro das conversas remotas (remoteStore, criado mais abaixo). */
/* conferencia da rodada 2 da leva 5i (achado A): na janela de teste o nome automatico e o nome dos agentes nao chamam o Haiku. A
   lateral lista as conversas reais e, sem o nomes.json (o saneador tira), a fila mandaria ate' 90 pedidos por abertura. O claudeRapido e'
   um OBJETO ({ perguntar, cancelar, contaDeAssinatura }): na janela de teste vai uma copia em que so' o perguntar recusa, no formato de
   falha que ele ja' devolve. A trava fica DENTRO de cada chamada (e com typeof) porque os testes recortam so' o registrar num vm. */
const revisorDeNomes = tituloAuto.registrar(ipcMain, {
  claudeRapido: (typeof JANELA_DE_TESTE !== 'undefined' && JANELA_DE_TESTE) ? { ...claudeRapido, perguntar: async () => ({ ok: false, erro: 'janela-de-teste', motivo: 'janela-de-teste' }) } : claudeRapido,
  nomeManual: ({ engine, id, remoto }) => {
    if (remoto != null) {
      try { const r = remoteStore.read(remoto, engine, id); return r && r.nomeCustomizado ? String(r.title || '') : ''; } catch { return ''; }
    }
    // null = nao deu pra ler o nomes.json: "nao sei" (o revisor nem chama nem aplica), nunca "nao ha'"
    const todos = lerNomesSeguro();
    if (!todos) return null;
    const meu = tituloAuto.nomeDaConversa(todos, id);
    return meu.manual ? meu.nome : '';
  },
});

/* Tarefa 7 (27/09): 'agentes:nomes' -- o nome dos agentes em portugues de
   gente (src/nomes-agentes.js). A tela junta os agentes que nascem juntos e
   manda UM lote; aqui vai uma chamada so' ao Haiku, pela instancia UNICA do
   claude-rapido (logo acima: stdin, ambiente limpo, so' com a assinatura).
   Liga e desliga junto com o nome automatico da conversa (cfg.tituloAuto,
   ligado por padrao): desligado nos Ajustes, nada sobe. Roda aqui no PC mesmo
   pra painel da VPS (so' texto). */
const nomeadorDeAgentes = nomesAgentes.registrar(ipcMain, {
  claudeRapido: (typeof JANELA_DE_TESTE !== 'undefined' && JANELA_DE_TESTE) ? { ...claudeRapido, perguntar: async () => ({ ok: false, erro: 'janela-de-teste', motivo: 'janela-de-teste' }) } : claudeRapido,
  // rodada 2 da leva 5: com o config nao lido o padrao nao e' o "ligado" seu: nao nomeia desta vez. Duas excecoes:
  // - a tela que leu bem (telaComPadrao false) vale mesmo com a leitura presa agora: ela confere cfg.tituloAuto antes de mandar o
  //   lote, e sem isso o agente, ja' marcado como pedido, ficava em ingles pra sempre;
  // - o semCopia (nao desliga na sessao) so' segura se ESTA leitura deu o padrao (sem chave nenhuma).
  ligado: () => { const c = loadConfig(); return c.tituloAuto !== false && (loadConfig.naoLido !== true || loadConfig.telaComPadrao === false) && (loadConfig.semCopia !== true || Object.keys(c).length > 0); },
});

/* ===== ramificar (fork) de verdade =====
   Claude ramifica no proprio start (--resume + --fork-session). O Codex tem
   thread/fork nativo, com ponto de corte (lastTurnId). O Gemini nao tem fork -
   mas o arquivo de conversa dele e' formato conhecido (cliLerConversa), entao a
   COPIA com id novo, cortada ate' a n-esima fala sua, faz o mesmo papel. */
function forkGemini(id, doFim) {
  const src = acharArquivoSessao('gemini', id);
  if (!src) return { error: 'Não achei o arquivo desta conversa do Gemini.' };
  let texto = '';
  try { texto = fs.readFileSync(src, 'utf8'); } catch (e) { return { error: 'Não consegui ler a conversa: ' + e.message }; }
  const novo = crypto.randomUUID();
  let linhas = texto.split('\n');
  if (doFim != null && doFim >= 1) {
    /* O ponto de corte conta DO FIM ("a K-esima fala sua contando de tras"):
       a tela pode mostrar so' a cauda da conversa, e contar do inicio erraria o
       ponto. Passada 1 conta o total; passada 2 corta na (total - K + 1)-esima.
       Cortar por LINHA respeita a semantica do arquivo ($set repovoa, $rewindTo
       apaga): o que sobra e' exatamente o estado daquele momento. */
    const ehFalaSua = (d) => !!(d && d.type === 'user' && cliFalaDeGente(cliTexto(d.content)));
    const contaDaLinha = (l) => {
      if (l.charCodeAt(0) !== 123) return 0;
      let d; try { d = JSON.parse(l); } catch { return 0; }
      if (d && d.$set && Array.isArray(d.$set.messages)) {
        // o $set carrega falas antigas dentro dele: conta as de la' tambem
        return d.$set.messages.filter(ehFalaSua).length;
      }
      return ehFalaSua(d) ? 1 : 0;
    };
    let total = 0;
    for (const l of linhas) total += contaDaLinha(l);
    const alvo = total - doFim + 1;
    if (alvo < 1) return { error: 'Não achei esse ponto na conversa gravada.' };
    let vistas = 0, corte = -1;
    for (let i = 0; i < linhas.length; i++) {
      vistas += contaDaLinha(linhas[i]);
      if (vistas >= alvo) { corte = i; break; }
    }
    if (corte >= 0) linhas = linhas.slice(0, corte + 1);
  }
  /* troca SO' o id exato desta sessao: um "sessionId" que apareca dentro do
     TEXTO de uma mensagem (alguem colou um json na conversa) fica intacto */
  const marcaVelha = '"sessionId":"' + id + '"';
  const marcaNova = '"sessionId":"' + novo + '"';
  texto = linhas.map((l) => l.split(marcaVelha).join(marcaNova)).join('\n');
  const nomeSrc = path.basename(src);
  // o nome carrega os 8 primeiros do id: e' por eles que acharArquivoSessao acha
  const nomeNovo = /[0-9a-f]{8}\.jsonl?$/i.test(nomeSrc)
    ? nomeSrc.replace(/[0-9a-f]{8}(\.jsonl?)$/i, novo.slice(0, 8) + '$1')
    : ('session-fork-' + novo.slice(0, 8) + '.jsonl');
  try { fs.writeFileSync(path.join(path.dirname(src), nomeNovo), texto, 'utf8'); }
  catch (e) { return { error: 'Não consegui gravar o ramo: ' + e.message }; }
  return { id: novo };
}

/* leva 41 (B3): "voltar para cá" no Claude do PC = ramo cortado de verdade.
   O .jsonl da origem e' copiado ate' ANTES da mensagem escolhida, com sessionId
   novo (a regra do corte e o formato medido estao no ramo-claude.js), ao lado
   do original -- na mesma pasta de projeto, onde o --resume acha. A origem nao
   e' tocada. O painel novo sobe com --resume <novo>, sem --fork-session. */
const ramoClaude = require('./ramo-claude');
function arquivoSessaoClaude(id, cwd) {
  const alvo = String(id) + '.jsonl';
  const direto = path.join(CLAUDE_PROJ, encodeCwd(cwd || HOME), alvo);
  try { if (fs.existsSync(direto)) return direto; } catch {}
  // conversa aberta pela lateral pode morar na pasta de OUTRO projeto
  let pastas = [];
  try { pastas = fs.readdirSync(CLAUDE_PROJ); } catch { return ''; }
  for (const p of pastas) {
    const f = path.join(CLAUDE_PROJ, p, alvo);
    try { if (fs.existsSync(f)) return f; } catch {}
  }
  return '';
}
function forkClaudeCortado({ id, doFim, alvo, repetidasDepois, cwd }) {
  // o id vira nome de arquivo: so' uuid, nunca caminho
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { error: 'conversa sem identificação válida' };
  if (!(Number(doFim) >= 1) && !String(alvo || '').trim()) return { error: 'O Claude ramifica a conversa inteira ao ligar o painel novo.' };
  const src = arquivoSessaoClaude(id, cwd);
  if (!src) return { error: 'Não achei o arquivo desta conversa do Claude.' };
  let bruto = '';
  try {
    /* o corte le e interpreta o arquivo inteiro aqui no main: acima de 150 MB
       (conversa cheia de print) o pico de memoria passa de meio giga numa
       maquina com pouca folga. Ai' a tela leva o resumo, com recado. */
    if (fs.statSync(src).size > 150 * 1024 * 1024) return { error: 'a conversa é grande demais para cortar aqui' };
    bruto = fs.readFileSync(src, 'utf8');
  } catch (e) { return { error: 'Não consegui ler a conversa: ' + e.message }; }
  const novo = crypto.randomUUID();
  // o alvo e' o texto inteiro do balao (com o trecho citado, se houver): o corte le o arquivo com a mesma regra
  const r = ramoClaude.cortarConversa(bruto, { idVelho: id, idNovo: novo, doFim, alvo, repetidasDepois, ehTecnico, semContexto: textoDoBalao });
  if (r.erro) return { error: r.erro };
  if (r.vazio) return { vazio: true };
  const destino = path.join(path.dirname(src), novo + '.jsonl');
  try { fs.writeFileSync(destino, r.texto, { encoding: 'utf8', flag: 'wx' }); }
  catch (e) { return { error: 'Não consegui gravar o ramo: ' + e.message }; }
  return { id: novo, file: destino };
}

async function arquivoClaudeNoServidor(remoto, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Identificação de sessão inválida.');
  const file = (await remoteTransport.run(remoto, 'find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" -maxdepth 2 -type f -name ' + qLinux(id + '.jsonl') + ' -print -quit')).trim();
  if (!file || !file.startsWith('/') || /[\r\n\0]/.test(file)) throw new Error('Não achei esta sessão no servidor.');
  return file;
}
async function forkClaudeRemoto({ remoto, id, doFim, alvo, repetidasDepois }) {
  try {
    if (!(Number(doFim) >= 1) && !String(alvo || '').trim()) return { error: 'O Claude ramifica a conversa inteira ao ligar o painel novo.' };
    const file = await arquivoClaudeNoServidor(remoto, id);
    const bruto = await remoteTransport.run(remoto, 'cat -- ' + qLinux(file));
    const novo = crypto.randomUUID();
    const r = ramoClaude.cortarConversa(bruto, { idVelho: id, idNovo: novo, doFim, alvo, repetidasDepois, ehTecnico, semContexto: textoDoBalao });
    if (r.erro) return { error: r.erro }; if (r.vazio) return { vazio: true };
    const destino = path.posix.join(path.posix.dirname(file), novo + '.jsonl');
    await remoteTransport.run(remoto, 'umask 077; set -C; cat > ' + qLinux(destino), { input: r.texto });
    return { id: novo, file: '', remoto: true };
  } catch(e) { return { error: e.message }; }
}
ipcMain.handle('sessao:fork', async (_e, { engine, id, doFim, alvo, repetidasDepois, cwd, remoto }) => {
  if (remoto != null) return engine === 'claude' ? forkClaudeRemoto({ remoto, id, doFim, alvo, repetidasDepois }) : remoteEngines.fork(engine, remoto, id, doFim);
  try {
    if (!id) return { error: 'conversa sem identificação' };
    if (engine === 'claude') return forkClaudeCortado({ id, doFim, alvo, repetidasDepois, cwd });
    if (engine === 'codex') {
      await codexStart();
      let corte = {};
      let avisoCorte = '';
      if (doFim != null && doFim >= 1) {
        /* a K-esima fala sua CONTANDO DO FIM = K-esimo turno do fim (steer
           entra no MESMO turno, entao a conta fecha; e contar do fim vale
           mesmo quando a tela so' mostra a cauda da conversa).
           sortDirection desc EXPLICITO (e' o padrao do schema, mas aqui o
           indice depende disso): o K-esimo do fim e' turnos[K-1], e a primeira
           pagina sempre traz os mais recentes - sem paginar. */
        try {
          const r = await codexReq('thread/turns/list', { threadId: id, sortDirection: 'desc', limit: Math.min(500, Math.max(50, doFim + 5)) });
          const turnos = (r && (r.data || r.turns || r.items)) || [];
          const alvo = turnos[doFim - 1];
          const tidAlvo = alvo && (alvo.id || alvo.turnId);
          if (tidAlvo) corte = { lastTurnId: tidAlvo };
          else avisoCorte = 'Não achei o ponto exato — o ramo levou a conversa inteira.';
        } catch { avisoCorte = 'Não achei o ponto exato — o ramo levou a conversa inteira.'; }
      }
      const f = await codexReq('thread/fork', { threadId: id, ...corte });
      const nid = f && (f.threadId || (f.thread && f.thread.id));
      return nid ? { id: nid, aviso: avisoCorte || undefined } : { error: 'O Codex não devolveu a conversa nova.' };
    }
    if (engine === 'gemini') return forkGemini(id, doFim);
    return { error: 'Este motor não ramifica por aqui.' };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* procura um pedaço de texto dentro da conversa e devolve o trecho achado */
function acharNaConversa(file, alvo, engine) {
  try {
    const st = fs.statSync(file);
    const dados = st.size > 3 * 1024 * 1024 ? tailRead(file, 3 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
    const baixo = dados.toLowerCase();
    const i = baixo.indexOf(alvo);
    if (i < 0) return null;
    // acha a linha inteira e tenta extrair um texto legivel
    const ini = dados.lastIndexOf('\n', i) + 1;
    const fim = dados.indexOf('\n', i);
    const linha = dados.slice(ini, fim < 0 ? dados.length : fim);
    let trecho = '';
    try {
      const d = JSON.parse(linha);
      const pega = (c) => typeof c === 'string' ? c
        : Array.isArray(c) ? c.map(x => x && (x.text || x.thinking || '')).join(' ') : '';
      trecho = pega(d.message && d.message.content) || pega(d.payload && d.payload.content)
        || (typeof d.text === 'string' ? d.text : '') || '';   // linha da transcricao do ACP
    } catch {}
    if (!trecho) trecho = linha.replace(/\\[nrt]/g, ' ').replace(/[{}"\[\]]/g, ' ');
    const j = trecho.toLowerCase().indexOf(alvo);
    const de = Math.max(0, (j < 0 ? 0 : j) - 45);
    return (de > 0 ? '…' : '') + trecho.slice(de, de + 150).replace(/\s+/g, ' ').trim() + '…';
  } catch { return null; }
}

const respira = () => new Promise((r) => setImmediate(r));
const buscaLocal = require('./cockpit-search');
const consultasConteudo = new WeakMap();
ipcMain.handle('sessions:buscar', async (_e, { engine, termo, itens }) => {
  const owner = _e.sender || _e;
  let pending = consultasConteudo.get(owner);
  if (!pending) { pending = new Map(); consultasConteudo.set(owner, pending); owner.once?.('destroyed', () => { for (const c of pending.values()) c.abort(); }); }
  pending.get(engine)?.abort();
  const controller = new AbortController(); pending.set(engine, controller);
  const allowedRoots = engine === 'claude' ? [CLAUDE_PROJ] : engine === 'codex' ? [CODEX_SESS]
    : engine === 'acp' ? [path.join(app.getPath('userData'), 'acp')] : CLIS[engine]?.conversas ? [CLIS[engine].pastaSessoes()] : [];
  try { return await buscaLocal.searchContents(Array.isArray(itens) ? itens : [], termo, { signal: controller.signal, allowedRoots }); }
  catch (error) { return error.name === 'AbortError' ? { achados: [], cancelled: true } : { error: error.message }; }
  finally { if (pending.get(engine) === controller) pending.delete(engine); }
});

function tailRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
function headRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch { return ''; }
}

const ENTRADAS_DE_GENTE = ['claude-vscode', 'cockpit', 'cli', 'claude-code'];

const INDICE_PATH = () => path.join(app.getPath('userData'), 'indice-conversas.json');
let indice = null;
function lerIndice() { if (indice) return indice; try { indice = JSON.parse(fs.readFileSync(INDICE_PATH(), 'utf8')); } catch { indice = {}; } return indice; }
function gravarIndice() {
  try {
    // tira do indice o que aponta pra arquivo que nao existe mais, senao ele
    // cresce pra sempre com conversa apagada
    const ind = indice || {};
    for (const k of Object.keys(ind)) {
      try { if (!fs.existsSync(k)) delete ind[k]; } catch {}
    }
    gravarSeguro(INDICE_PATH(), JSON.stringify(ind));
  } catch {}
}

const PULAR_PASTA = new Set(['subagents', 'workflows']);

function varrerConversas(dir, achados, nivel) {
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of itens) {
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (PULAR_PASTA.has(e.name) || nivel > 4) continue;   // agentes internos nao sao conversa sua
      varrerConversas(p2, achados, nivel + 1);
    } else if (e.name.endsWith('.jsonl')) {
      try { const st = fs.statSync(p2); if (st.size > 300) achados.push({ f: p2, mtime: st.mtimeMs, size: st.size, id: e.name.replace('.jsonl', '') }); } catch {}
    }
  }
}

/* le titulo/pasta/entrada de um arquivo, guardando em indice para nao reler toda vez */
// so' a parte de texto (sem tocar em disco) - usada tanto pro arquivo local
// quanto pro conteudo que vem da VPS via SSH
function analisarCabecaCauda(head, tail) {
  const em = head.match(/"entrypoint":"([^"]*)"/);
  const entrada = em ? em[1] : '';

  let title = '';
  const tm = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
  if (tm.length) { try { title = JSON.parse('"' + tm[tm.length - 1][1] + '"'); } catch { title = tm[tm.length - 1][1]; } }

  let cwd = '';
  const cm = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (cm) { try { cwd = JSON.parse('"' + cm[1] + '"'); } catch { cwd = cm[1]; } }

  if (!title) {
    for (const linha of head.split('\n')) {
      if (!linha.includes('"type":"user"')) continue;
      try {
        const d = JSON.parse(linha);
        const c = d.message && d.message.content;
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x && x.text || '').join(' ') : '';
        if (t.trim() && !ehTecnico(t)) { title = limparTitulo(t.trim()).slice(0, 90); break; }
      } catch {}
    }
  }
  return { title, cwd, entrada };
}

function fichaConversa(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;
  const head = headRead(it.f, 64 * 1024);
  const tail = tailRead(it.f, 96 * 1024);
  const { title, cwd, entrada } = analisarCabecaCauda(head, tail);
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada };
  ind[it.f] = ficha;
  return ficha;
}

/* ---------- conversas do Claude que rodaram dentro de um servidor remoto ----------
   Elas gravam o .jsonl LA' dentro, nao aqui - por isso a lista da VPS precisa ir
   buscar por SSH, nao da pra so' olhar o disco local. Um comando so' traz tudo
   (path + data + conteudo em base64 de cada sessao recente), pra nao abrir uma
   conexao SSH por arquivo. */
async function claudeSessionsRemoto(remoto, incluirRobos = false) {
  try {
    const rows = await require('./sessions-list').listClaudeAll(async page =>
      JSON.parse(await remoteTransport.run(remoto, require('./claude-sessions-scan').script({ ...page, incluirRobos: !!incluirRobos }), { timeout: 45000 })));
    const nomesMeus = tituloAuto.nomesDoRegistro(remoteStore.list('claude', remoto));
    return rows.map(s => tituloAuto.aplicarNome(s, nomesMeus)).sort((a, b) => b.when - a.when);
  } catch (e) { return { error: 'Não consegui ler todas as conversas do Claude na VPS: ' + e.message }; }
}

function claudeSessions(limit, incluirRobos) {
  const achados = [];
  varrerConversas(CLAUDE_PROJ, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);

  const nomesMeus = lerNomes();
  const alvo = limit || 5000;
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    if (out.length >= alvo) break;
    const fi = fichaConversa(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ENTRADAS_DE_GENTE.includes(fi.entrada)) continue;
    if (!tituloAuto.nomeDaConversa(nomesMeus, it.id).nome && !fi.title) continue;
    // seu nome > o de 3 palavras do Cockpit > o do arquivo (aiTitle / 1a fala)
    out.push(tituloAuto.aplicarNome({ engine: 'claude', id: it.id, title: fi.title, cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada }, nomesMeus));
  }
  if (lidos) gravarIndice();
  return out;
}

/* Tarefa 5 (26/09): a conversa INTEIRA do arquivo, lida em blocos (antes: so'
   os ultimos 6 MB, e dali so' os ultimos 60 itens). O corte e' de quem chama
   (cortarHistorico): a tela leva 600 falas, o exportar 5000. */
async function claudeHistory(file) {
  const leitor = leitorDoJsonl();
  await varrerLinhas(file, leitor.linha);
  return leitor.fim();
}

/* o mesmo parse serve pro arquivo local e pro conteudo que veio do servidor */
function mensagensDoJsonl(data) {
  const leitor = leitorDoJsonl();
  for (const line of String(data || '').split('\n')) leitor.linha(line);
  return leitor.fim();
}

/* UMA linha do .jsonl do Claude vira mensagem(ns) da tela. O leitor guarda o
   que vale entre as linhas (as mensagens e o teto de imagem) e serve aos dois
   caminhos: o arquivo local lido em blocos (claudeHistory) e o texto que veio
   do servidor (mensagensDoJsonl).
   Imagem: o teto total da conversa (LIM_IMG_TOTAL) e' gasto do FIM pro
   comeco -- as recentes ficam. Lendo do comeco, cada imagem nova entra e as
   mais velhas saem ate' caber de novo. Gasto do comeco (como era), com a
   conversa inteira voltando, os 8 MB iam todos pros prints mais antigos. */
function leitorDoJsonl() {
  const msgs = [];
  const fila = [];   // imagens aceitas, da mais velha pra mais nova: { m, im }
  let primeira = 0, gastoEmImagem = 0;
  const linha = (line) => {
    if (line.charCodeAt(0) !== 123) return;   // so' linha de JSON (comeca com chave)
    let d; try { d = JSON.parse(line); } catch { return; }
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
      t = (t || '').trim();
      // as imagens que voce colou ficam gravadas aqui dentro: sem devolver, elas
      // sumiam da conversa toda vez que o app reabria (6 por fala, no maximo)
      const imgs = Array.isArray(c) ? c.filter(x => x && x.type === 'image' && x.source
        && x.source.type === 'base64' && x.source.data).map(x => ({
          mime: x.source.media_type || 'image/png', dados: x.source.data,
        })).filter(x => x.dados.length <= LIM_IMG_HIST).slice(0, 6) : [];
      if ((t && !ehTecnico(t)) || imgs.length) {
        // o trecho citado (Responder) fica: a tela desenha ele em cima da fala
        const m = { role: 'user', text: (t && !ehTecnico(t)) ? (textoDoBalao(t) || t) : '', imagens: imgs };
        msgs.push(m);
        for (const im of imgs) {
          fila.push({ m, im });
          gastoEmImagem += im.dados.length;
          // passou do teto total: sai a mais velha (a da frente da fila)
          while (gastoEmImagem > LIM_IMG_TOTAL && primeira < fila.length) {
            const velha = fila[primeira]; fila[primeira++] = null;
            gastoEmImagem -= velha.im.dados.length;
            const k = velha.m.imagens.indexOf(velha.im);
            if (k >= 0) velha.m.imagens.splice(k, 1);
          }
        }
      }
    } else if (d.type === 'assistant' && d.message) {
      // content as vezes vem como texto puro: percorrer a string letra a letra
      // nao casava com nada e a resposta sumia da conversa reaberta
      const c = Array.isArray(d.message.content) ? d.message.content
        : (typeof d.message.content === 'string' && d.message.content) ? [{ type: 'text', text: d.message.content }]
        : [];
      // o modelo que respondeu vai junto: a conversa reaberta volta nele (leva 41)
      const modelo = typeof d.message.model === 'string' ? d.message.model : '';
      for (const x of c) {
        if (x.type === 'text' && x.text && x.text.trim()) msgs.push(modelo ? { role: 'bot', text: x.text, model: modelo } : { role: 'bot', text: x.text });
        else if (x.type === 'tool_use') msgs.push({ role: 'tool', name: x.name, arg: claudeToolArg(x.name, x.input) });
      }
    }
  };
  // fala que era SO' imagem e perdeu as imagens pro teto nao vira balao vazio
  const fim = () => msgs.filter((m) => m.role !== 'user' || m.text || m.imagens.length);
  return { linha, fim };
}

/* Tarefa 5: o arquivo inteiro do Codex, em blocos (antes: readFileSync de
   uma vez so' e os ultimos 60 itens). O corte e' de quem chama. */
async function codexHistory(file) {
  const msgs = [];
  await varrerLinhas(file, (line) => {
    if (line.charCodeAt(0) !== 123) return;   // so' linha de JSON (comeca com chave)
    let d; try { d = JSON.parse(line); } catch { return; }
    if (d.type !== 'response_item') return;
    const p = d.payload || {};
    if (p.type === 'message') {
      if (p.role === 'developer' || p.role === 'system') return;
      const t = (p.content || []).map(c => c.text || '').join('\n').trim();
      if (!t) return;
      // pula o contexto tecnico que o Codex injeta como se fosse fala do usuario
      if (ehTecnico(t) || t.includes('<workspace_roots>')) return;
      msgs.push({ role: p.role === 'user' ? 'user' : 'bot', text: p.role === 'user' ? (textoDoBalao(t) || t) : t });
    } else if (p.type === 'function_call' || p.type === 'local_shell_call') {
      let arg = '';
      try { const a = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.action || p.arguments || {}); arg = a.command ? (Array.isArray(a.command) ? a.command.join(' ') : a.command) : JSON.stringify(a).slice(0, 120); } catch { arg = String(p.arguments || '').slice(0, 120); }
      msgs.push({ role: 'tool', name: p.name === 'shell' || p.type === 'local_shell_call' ? 'Terminal' : (p.name || 'Ferramenta'), arg });
    }
  });
  return msgs;
}

const sessionScanModule = require('./cockpit-session-scan');
const sessionScanner = sessionScanModule.createScanner();
async function nomesCodex(options = {}) {
  const nomes = Object.create(null);
  try {
    await buscaLocal.untilCancelled(codexStart(), options.signal);
    const threads = await require('./sessions-list').listAll(codexReq, { signal: options.signal });
    for (const thread of threads) if (typeof thread.name === 'string' && thread.name) nomes[thread.id] = thread.name;
  } catch { /* Nomes do app são opcionais; o histórico local continua disponível. */ }
  return nomes;
}
async function sessionsLocaisAsync(engine, incluirRobos, options = {}) {
  let nomes = {};
  // rodada 2 da leva 5: o nomes.json que nao abre (vazio, zeros ou pela metade de uma queda) vai pelo lerNomes, que le o .bak
  try { const read = await buscaLocal.readWindow(NOMES_PATH(), 8 * 1024 * 1024, { signal: options.signal }); if (!read.truncated) nomes = JSON.parse(read.text); }
  catch (error) { if (error.name === 'AbortError') throw error; if (typeof lerNomes === 'function') nomes = lerNomes(); }
  if (!nomes || typeof nomes !== 'object' || Array.isArray(nomes)) nomes = {};
  /* Codex: o titulo e' o pedido, sem o embrulho que o Codex poe em volta dele (imagem
     colada, arquivo mencionado). Ficam FORA do TECNICO de proposito: o pedido vem no
     mesmo turno, e fala tecnica some da conversa reaberta. */
  return sessionScanner.scan({ root: engine === 'claude' ? CLAUDE_PROJ : CODEX_SESS, engine,
    ...options, parse: engine === 'claude' ? analisarCabecaCauda : parseCodexDoHistorico,
    decorate: item => {
      const origins = engine === 'claude' ? ENTRADAS_DE_GENTE : ORIGENS_DE_GENTE;
      if (!incluirRobos && item.entrada && !origins.includes(item.entrada)) return null;
      const name = tituloAuto.nomeDaConversa(nomes, item.id), fromApp = options.nomesDoApp?.[item.id];
      if (engine === 'claude') return name.nome || item.title ? tituloAuto.aplicarNome({ ...item, cwd: item.cwd || HOME }, nomes) : null;
      const title = name.nome || fromApp || item.title;
      return title ? { ...item, title: title.slice(0, 120), cwd: item.cwd || HOME,
        ...(name.manual ? { nome: title } : (name.auto || fromApp) ? { tituloAuto: true } : {}) } : null;
    } });
}
const sessionsScanBroker = sessionScanModule.createBroker(async (request, options) => {
  if (!['claude', 'codex'].includes(request.engine) || request.remoto) return { error: 'Varredura progressiva disponível para Claude e Codex locais.' };
  // Primeiras linhas saem antes de consultar os nomes do app-server. Essa
  // consulta não roda nenhum turno; o resultado final preserva os nomes dele.
  const names = request.engine === 'codex' ? nomesCodex(options) : Promise.resolve({});
  const result = await sessionsLocaisAsync(request.engine, !!request.incluirRobos, options);
  const appNames = await buscaLocal.untilCancelled(names, options.signal); buscaLocal.check(options.signal);
  if (request.engine === 'codex') result.items = result.items.map(item => !item.nome && !item.tituloAuto && appNames[item.id] ? { ...item, title: String(appNames[item.id]).slice(0, 120), tituloAuto: true } : item);
  return result;
});
ipcMain.handle('sessions:scan', (event, request) => sessionsScanBroker.start(event.sender, request));
ipcMain.handle('sessions:scan-cancel', (event, id) => sessionsScanBroker.cancel(event.sender, id));
ipcMain.handle('sessions:claude', async (_e, incluirRobos) => {
  try { return (await sessionsLocaisAsync('claude', incluirRobos)).items; } catch (error) { return { error: error.message }; }
});
const CODEX_SESS = path.join(HOME, '.codex/sessions');
const ORIGENS_DE_GENTE = ['cockpit', 'codex-tui', 'codex_tui', 'codex_vscode', 'codex-vscode', 'codex_app', 'codex-app', 'vscode'];

/* o '-' faltava na classe: <task-notification> e <local-command-stdout> nao
   casavam e vazavam pra tela como se fossem mensagem sua */
/* imagem grande demais nao vale a pena reconstruir: pesa no IPC e na tela.
   Alem do teto por imagem, ha um teto TOTAL por conversa - sem ele, uma
   conversa cheia de print mandava dezenas de MB numa resposta so'. */
const LIM_IMG_HIST = 900 * 1024;
const LIM_IMG_TOTAL = 8 * 1024 * 1024;
/* Lista FECHADA, nao curinga. O '^<[a-z_-]+>' pegava qualquer coisa que
   comecasse com uma tag - '<meta-tag>', '<mat-icon>', '<b>negrito</b> revisa
   isso' - e sumia com a mensagem inteira, da tela E do historico.
   '# AGENTS.md instructions for <pasta>': o Codex grava o AGENTS.md da pasta
   como a 1a fala do usuario; sem isso ele virava o titulo de toda conversa do
   Codex no Historico (e um balao enorme na conversa reaberta).
   O sub-agente "guardian" do Codex (a conversa que ele sobe pra avaliar cada
   acao) tambem entra: a fala dele e' o prompt todo e virava o titulo de dezenas
   de conversas. O padrao mora no titulo-auto.js, que o mutirao dos nomes le. */
const TECNICO = /<recommended_plugins>|<environment_context>|<user_instructions>|<system-reminder>|<available_tools>|<plugins>|^Caveat:|^#[ \t]*AGENTS\.md instructions for\b|^<(task-notification|local-command-stdout|local-command-stderr|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr)>/i;
const ehTecnico = (t) => {
  if (!t) return true;
  const s = t.trim().slice(0, 400);
  return TECNICO.test(s) || tituloAuto.FALA_SUBAGENTE_CODEX.test(s);
};

/* Titulo das conversas do Codex no Historico: o pedido, sem o embrulho de imagem e arquivo (semEnvelopeCodex).
   O guardian (acima) e' a conversa que o Codex sobe pra avaliar cada acao: toda fala de usuario dela e' tecnica,
   entao o titulo caia na 1a resposta, que e' o JSON do veredito ({"risk_level":"low",...}). Quando a conversa e'
   dele E nao tem nenhum pedido real, ganha um titulo fixo; ela CONTINUA na lista (nada filtra). Pedido de
   verdade vence sempre, e o nome que voce deu (nomes.json) vence no decorate, como em toda conversa.
   3 palavras de proposito: a lista (HistoricoLista.preparar), com o nome automatico ligado, encurta titulo de mais de
   3 palavras, e "Guardião do Codex (revisão de risco)" aparecia como "Guardião Codex (revisão".
   A ficha vai com guardiao:true: a lista (HistoricoLista.preparar / fila) o tira da fila do Haiku. Sem assunto, ele so'
   gastava uma das 30 vagas da pasta (e lia a conversa inteira) para o Haiku voltar "sem-assunto". */
const TITULO_GUARDIAO = 'Guardião do Codex';
const ehFalaDoGuardiao = (t) => !!t && tituloAuto.FALA_SUBAGENTE_CODEX.test(t.trim().slice(0, 400));
async function parseCodexDoHistorico(head, tail, meta) {
  let guardiao = false, pedido = false;
  const ficha = await sessionScanModule.parseCodexFile(head, tail, meta, {
    technical: (t) => { if (ehFalaDoGuardiao(t)) guardiao = true; return ehTecnico(t); },
    clean: (t) => { const titulo = limparTitulo(tituloAuto.semEnvelopeCodex(t)); if (titulo) pedido = true; return titulo; },
  });
  return guardiao && !pedido ? { ...ficha, title: TITULO_GUARDIAO, guardiao: true } : ficha;
}

/* O que o balao da tela mostra como fala sua: sem o contexto que a troca de
   motor cola na frente e sem a lista de anexos. O trecho citado pelo Responder
   (app.js, comCitacao) FICA: o balao desenha ele em cima da fala, e o "voltar
   para ca'" do Claude corta pelo texto inteiro do balao (ramo-claude.js). */
function textoDoBalao(t) {
  if (!t) return t;
  const i = t.indexOf('Agora, o novo pedido:');
  if (i >= 0) return t.slice(i + 'Agora, o novo pedido:'.length).trim();
  const j = t.indexOf('Arquivos que anexei');
  if (j > 0) return t.slice(0, j).trim();
  return t;
}
/* So' o que VOCE pediu: o texto do balao sem o trecho citado (o trecho e' da
   resposta da IA, nao pedido seu). Da' o nome da conversa na lista. A regra do
   bloco e' a mesma do separarCitacao da tela (app.js). */
const CITACAO_ABRE = 'Sobre este trecho da sua resposta:';
function semContexto(t) {
  const s = textoDoBalao(t);
  if (!s || !s.startsWith(CITACAO_ABRE + '\n')) return s;
  const resto = s.slice(CITACAO_ABRE.length + 1);
  const fim = resto.indexOf('\n\n');
  if (fim < 0) return s;
  const linhas = resto.slice(0, fim).split('\n');
  if (!linhas.every((l) => l.startsWith('> ') || l === '>')) return s;
  return resto.slice(fim + 2).trim();
}
const limparTitulo = (t) => (semContexto(t) || '').slice(0, 90);

function fichaCodex(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;

  let head = headRead(it.f, 96 * 1024);
  let id = '', cwd = '', origem = '', title = '', doAssistente = '';
  const varrer = (texto) => {
  for (const linha of texto.split('\n')) {
    if (!linha.startsWith('{')) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (d.type === 'session_meta') {
      const p2 = d.payload || {};
      id = p2.id || p2.session_id || '';
      cwd = p2.cwd || '';
      origem = p2.originator || p2.source || '';
      continue;
    }
    if (!title && d.type === 'response_item') {
      const p2 = d.payload || {};
      if (p2.type === 'message') {
        const t = (p2.content || []).map(c => c.text || '').join(' ').trim();
        if (p2.role === 'user' && t && !ehTecnico(t)) title = limparTitulo(t).slice(0, 90);
        else if (p2.role === 'assistant' && t && !doAssistente) doAssistente = t.slice(0, 90);
      }
    }
    if (title && id) return true;
  }
  return false;
  };
  if (!varrer(head) && it.size > 96 * 1024) varrer(fs.readFileSync(it.f, 'utf8'));   // arquivo grande: le tudo
  if (!title) title = doAssistente;                       // ao menos a primeira resposta
  if (!title) title = 'Conversa de ' + new Date(it.mtime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada: origem, sid: id };
  ind[it.f] = ficha;
  return ficha;
}

function codexSessions(incluirRobos, nomesDoApp) {
  const achados = [];
  varrerConversas(CODEX_SESS, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);
  const meus = lerNomes();
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    const fi = fichaCodex(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ORIGENS_DE_GENTE.includes(fi.entrada)) continue;
    const id = fi.sid || it.id;
    /* seu nome (nomes.json) > o de 3 palavras do Cockpit > o nome do app do
       Codex > a 1a mensagem do arquivo.
       Mudou aqui: o nome do app do Codex nao conta mais como SEU. O Codex 0.155
       batiza a thread sozinho ('Comando sleep em segundo plano', 'Estudo do
       codigo enviado' - 51 das 319 threads deste PC), entao tratar aquilo como
       nome dado a mao escondia o de 3 palavras do Cockpit em toda conversa que
       o Codex ja tinha batizado, e ainda marcava a linha como 'nome seu' - o
       que fazia o painel reaberto por ela nunca mais pedir nome.
       O que VOCE renomeia continua vencendo: renomear aqui grava na raiz do
       nomes.json (manual) e o thread/name/set so' acompanha. */
    const n = tituloAuto.nomeDaConversa(meus, id);
    const doApp = nomesDoApp && nomesDoApp[id];
    const title = n.nome || doApp || fi.title;
    if (!title) continue;
    const marca = n.manual ? { nome: title } : ((n.auto || doApp) ? { tituloAuto: true } : {});
    out.push({ engine: 'codex', id, title: title.slice(0, 120), cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada, ...marca });
  }
  if (lidos) gravarIndice();
  return out;
}

ipcMain.handle('sessions:codex', async (_e, incluirRobos) => {
  if (incluirRobos?.remoto != null) return remoteEngines.sessions('codex', incluirRobos.remoto);
  // nomes que o proprio Codex guarda (renomeadas por lá)
  const nomesDoApp = await nomesCodex();
  try { return (await sessionsLocaisAsync('codex', incluirRobos, { nomesDoApp })).items; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle('sessions:titulo', (_e, { engine, file, id }) => {
  try {
    if (engine !== 'claude') return '';
    /* leva 41 (B6): a releitura do aiTitle nao passa por cima do nome que voce
       deu nem do de 3 palavras do Cockpit: se houver, e' ele que volta. */
    const meu = tituloAuto.nomeDaConversa(lerNomes(), id);
    if (meu.nome) return meu.nome;
    let f = file;
    if ((!f || !fs.existsSync(f)) && id) {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find(a => a.id === id);
      if (it) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return '';
    const tail = tailRead(f, 96 * 1024);
    const m = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
    if (!m.length) return '';
    try { return JSON.parse('"' + m[m.length - 1][1] + '"'); } catch { return m[m.length - 1][1]; }
  } catch { return ''; }
});

/* le o .jsonl de uma conversa que rodou no servidor. Procura pelo id em
   ~/.claude/projects e traz o conteudo em base64 (uma conexao so').
   Tarefa 5: continua trazendo so' os ultimos 6 MB (subir o teto estoura o
   prazo de 25 s), mas volta TUDO o que veio neles: o corte de 60 itens saiu,
   quem chama aplica o cortarHistorico. */
function claudeHistoryRemoto(remoto, id) {
  return new Promise((resolve) => {
    if (!remoto || !id || !ssgValido(remoto)) return resolve([]);
    const idSeguro = String(id).replace(/[^\w-]/g, '');
    if (!idSeguro) return resolve([]);
    const script = "f=$(find ~/.claude/projects -name " + qLinux(idSeguro + '.jsonl')
      + " -print -quit 2>/dev/null); [ -n \"$f\" ] && tail -c 6000000 \"$f\" | base64 -w0";
    let proc;
    try {
      proc = spawnBin('ssh', ['-i', remoto.chave, '-p', String(remoto.porta || 22), '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        remoto.usuario + '@' + remoto.host, '--', script],
        { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return resolve([]); }
    let out = '';
    let erroSsh = '';
    const limite = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ error: 'O servidor não respondeu a tempo (25s). Conexão lenta ou servidor ocupado.' });
    }, 25000);
    proc.stdout.setEncoding?.('utf8');    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.stderr.setEncoding?.('utf8');    proc.stderr.on('data', (d) => { erroSsh += d.toString('utf8'); });
    proc.on('error', (e) => { clearTimeout(limite); resolve({ error: 'Não consegui chamar o ssh: ' + (e && e.message || e) }); });
    proc.on('close', (code) => {
      clearTimeout(limite);
      const b64 = out.trim();
      if (!b64) {
        const motivo = motivoDoSsh(erroSsh, remoto);
        if (motivo) return resolve({ error: motivo });
        // o find sai com 1 quando nao acha o arquivo: a conversa nao esta' mais la',
        // e isso e' resposta, nao falha de conexao
        if (erroSsh.trim()) return resolve({ error: 'Não consegui abrir esta conversa no servidor (código ' + code + ').' });
        return resolve([]);
      }
      let texto = '';
      try { texto = Buffer.from(b64, 'base64').toString('utf8'); } catch { return resolve({ error: 'A resposta do servidor veio corrompida.' }); }
      resolve(mensagensDoJsonl(texto));
    });
  });
}

/* Tarefa 5: o que volta pra tela passa pelo historicoParaTela -- as ultimas
   600 falas (das ferramentas, 250) e, se fala ficou de fora, a nota na frente.
   Antes: os ultimos 60 itens, ferramenta contando como item. */
ipcMain.handle('sessions:historyRemoto', async (_e, { remoto, id }) => {
  try { return historicoParaTela(await claudeHistoryRemoto(remoto, id)); }
  catch (e) { return { error: 'Não consegui ler a conversa no servidor: ' + (e && e.message || e) }; }
});

ipcMain.handle('sessions:history', async (_e, { engine, file, id, remoto, inteiro = false }) => {
  const finish = msgs => historicoParaTela(msgs, inteiro ? Infinity : 600);
  if (remoto != null) {
    const fallback = () => engine === 'claude' ? claudeHistoryRemoto(remoto, id) : remoteEngines.history(engine, remoto, id);
    return finish(inteiro && engine === 'codex' && id
      ? await historyPages.readAll((m, p) => remoteEngines.query(remoto, m, p), id, fallback) : await fallback());
  }
  if (engine === 'acp') return finish(await acp.historico(id, file));
  let f = file;
  // caminho salvo errado ou de outra maquina: procura pelo id da conversa
  if (engine === 'claude' && id && (!f || !fs.existsSync(f))) {
    const achados = [];
    varrerConversas(CLAUDE_PROJ, achados, 0);
    const it = achados.find(a => a.id === id);
    if (it) f = it.f;
  }
  if (!f || !fs.existsSync(f)) return [];
  // o arquivo inteiro, em blocos: a leitura devolve o controle a cada 8 ms
  // (outro IPC responde enquanto uma conversa de 50 MB e' lida)
  if (engine === 'claude') return finish(await claudeHistory(f));
  // sem isto, conversa de Gemini caia no leitor do Codex e voltava vazia
  if (ehCli(engine)) return finish(await cliHistory(f));
  return finish(inteiro && id && codex.pronto ? await historyPages.readAll(codexReq, id, () => codexHistory(f)) : await codexHistory(f));
});

/* ======================= comandos e skills ======================= */
function readSkillDirs(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (e.isDirectory()) {
        const f = path.join(d, e.name, 'SKILL.md');
        if (fs.existsSync(f)) out.push({ name: e.name, desc: skillDesc(f) });
      } else if (e.name.endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/, ''), desc: skillDesc(path.join(d, e.name)) });
      }
    }
  }
  return out;
}
function skillDesc(file) {
  const head = headRead(file, 1600);
  const m = head.match(/^description:\s*(.+)$/m);
  if (m) return m[1].replace(/^["']|["']$/g, '').slice(0, 140);
  const t = head.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('name:'));
  return (t || '').replace(/^#+\s*/, '').slice(0, 140);
}

let skillCache = { claude: null, codex: null };
let skillQuando = { claude: 0, codex: 0 };
const SKILL_VALE = 60 * 1000;   // um minuto: skill nova aparece sem reabrir o app
/* Comandos proprios dos motores por turno.

   O Gemini guarda os dele em ~/.gemini/commands, um arquivo .toml por comando,
   e o nome sai do caminho: commands/git/commit.toml vira "git:commit". Isso foi
   lido no codigo do proprio gemini-cli (Storage.getUserCommandsDir mais o glob
   de "**''/*.toml"), nao chutado.

   O Grok nao tem convencao confirmada aqui - devolve lista vazia, em vez de
   emprestar a do Codex e prometer skill que ele nao tem. */
function comandosDoCli(engine) {
  const cli = CLIS[engine];
  if (!cli || !cli.comandos) return [];
  const raizCmd = path.join(path.dirname(cli.pastaSessoes()), 'commands');
  const out = [];
  const olhar = (dir, prefixo, fundo) => {
    if (fundo > 4) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(p, prefixo + it.name + ':', fundo + 1); continue; }
      if (!/\.toml$/i.test(it.name)) continue;
      out.push({ name: prefixo + it.name.replace(/\.toml$/i, ''), desc: descricaoDoToml(p) });
    }
  };
  olhar(raizCmd, '', 0);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* Do arquivo inteiro so' a linha "description = ..." interessa pro menu. Trazer
   um leitor de TOML pra dentro do app por causa de uma linha nao se paga. */
function descricaoDoToml(file) {
  const cabeca = headRead(file, 2000);
  const m = cabeca.match(/^[ \t]*description[ \t]*=[ \t]*(.+)$/m);
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '').slice(0, 140);
}

ipcMain.handle('skills:list', async (_e, pedido) => {
  /* o painel manda { engine, paneId, cwd }; a forma antiga (so' a string do
     motor) continua valendo pra nao quebrar chamada de fora */
  const ped = (pedido && typeof pedido === 'object') ? pedido : { engine: pedido };
  const engine = ped.engine;
  const servidor = ped.remoto ?? remotePaneTargets.get(ped.paneId)?.remoto;
  if (servidor != null) {
    if (engine === 'codex') { try { return proto.normalizeSkillsResponse(await remoteEngines.query(servidor, 'skills/list', { cwds: [ped.cwd || servidor.caminhoRemoto || '~'] }), ped.cwd || servidor.caminhoRemoto || '~'); } catch(e) { return { error: e.message }; } }
    if (engine === 'acp') return remoteEngines.panes.get(ped.paneId)?.comandos || [];
    return { error: 'O menu de comandos deste motor remoto é gerenciado no servidor.' };
  }
  // painel ACP: os comandos sao do agente DAQUELE painel
  if (engine === 'acp') return acp.comandos(ped.paneId) || [];
  const chave = engine === 'codex' ? 'codex:' + (ped.cwd || HOME) : engine;
  if (skillCache[chave] && (Date.now() - skillQuando[chave]) < SKILL_VALE) return skillCache[chave];
  /* o "senao" la embaixo mandava TUDO que nao fosse Claude ler ~/.codex/skills:
     num painel do Gemini o menu "/" listava as skills do Codex, que ele nao tem
     como usar. Cada motor tem o formato dele. */
  if (ehCli(engine)) {
    const so = comandosDoCli(engine);
    skillCache[chave] = so; skillQuando[chave] = Date.now();
    return so;
  }
  /* No Codex quem sabe as skills de verdade e' o proprio app-server: ele ja
     resolve escopo (pessoal, projeto, plugin), respeita o que esta desligado e
     enxerga a pasta do painel. A varredura de disco continua embaixo como
     complemento - ela e' quem acha os prompts de ~/.codex/prompts - e como
     rede de seguranca se a chamada nativa falhar. */
  let nativas = [];
  let perguntei = false;   // pasta sem skill nativa tambem devolve zero: sao coisas diferentes
  if (engine === 'codex') {
    /* so' pergunta se o app-server JA esta de pe. Esperar o codexStart aqui
       segurava o menu "/" por ate' 45s na primeira abertura (30s do initialize
       + 15s da chamada) - o menu tem que abrir na hora, com o que houver. */
    if (!codex.pronto) codexStart().catch(() => {});
    else {
      try {
        const r = await codexReq('skills/list', { cwds: [ped.cwd || HOME] }, 6000);
        nativas = proto.normalizeSkillsResponse(r, ped.cwd || HOME);
        perguntei = true;
      } catch { nativas = []; }
    }
  }
  let dirs;
  if (engine === 'claude') {
    dirs = [path.join(HOME, '.claude/skills'), path.join(HOME, '.claude/commands')];
    // skills que vem de plugins
    const pc = path.join(HOME, '.claude/plugins/cache');
    try {
      for (const owner of fs.readdirSync(pc)) {
        const od = path.join(pc, owner);
        for (const plug of fs.readdirSync(od)) {
          const pd = path.join(od, plug);
          for (const ver of fs.readdirSync(pd)) {
            const sd = path.join(pd, ver, 'skills');
            if (fs.existsSync(sd)) dirs.push(sd);
          }
        }
      }
    } catch {}
  } else {
    dirs = [path.join(HOME, '.codex/skills'), path.join(HOME, '.codex/prompts'), path.join(HOME, '.agents/skills')];
  }
  const seen = new Set(); const out = [];
  // a nativa vale mais que a do disco quando as duas tem o mesmo nome
  for (const s of nativas) { if (seen.has(s.name)) continue; seen.add(s.name); out.push(s); }
  for (const s of readSkillDirs(dirs)) { if (seen.has(s.name)) continue; seen.add(s.name); out.push(s); }
  out.sort((a, b) => a.name.localeCompare(b.name));
  /* lista que saiu SO' do disco (o app-server ainda estava subindo) nao vira
     cache: senao o menu ficaria um minuto sem as skills nativas. Pasta sem
     skill nativa nenhuma, essa entra: a pergunta foi feita e respondida. */
  if (engine !== 'codex' || perguntei) {
    skillCache[chave] = out; skillQuando[chave] = Date.now();
    // uma chave por pasta aberta: joga fora a mais velha quando passa de 12
    const chaves = Object.keys(skillCache);
    if (chaves.length > 12) {
      const velha = chaves.sort((a, b) => (skillQuando[a] || 0) - (skillQuando[b] || 0))[0];
      delete skillCache[velha]; delete skillQuando[velha];
    }
  }
  return out;
});

/* ---------- conectores (MCP) ---------- */
function rodar(bin, args, timeout) {
  if ((bin === 'codex' || bin === acharBin('codex')) && !engineUpdates.codexReady) {
    return engineUpdates.waitForCodex().then(() => rodar(bin, args, timeout));
  }
  // spawnBin em vez de execFile porque no Windows o binario pode ser um .cmd,
  // que o Node se recusa a chamar direto desde a correcao de seguranca do Node 20
  return new Promise((res) => {
    let out = '', errout = '', acabou = false;
    const p = spawnBin(bin, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => {
      const error = new Error('O comando excedeu o tempo de espera.');
      error.code = 'ETIMEDOUT';
      // Fechar um filho pode não fechar seus pipes (netos ainda os seguram).
      // O prazo precisa resolver o pedido mesmo sem o evento close.
      fim(error);
      try { matarProcesso(p); } catch { try { p.kill(); } catch {} }
    }, timeout || 60000);
    const fim = (err) => { if (acabou) return; acabou = true; clearTimeout(t); res({ err, out, errout }); };
    p.stdout.setEncoding?.('utf8');    p.stdout.on('data', (d) => { if (out.length < 4 * 1024 * 1024) out += d.toString('utf8'); });
    p.stderr.setEncoding?.('utf8');    p.stderr.on('data', (d) => { if (errout.length < 4 * 1024 * 1024) errout += d.toString('utf8'); });
    p.on('error', (e) => fim(e));
    p.on('close', (code) => fim(code === 0 ? null : new Error('saiu com código ' + code)));
  });
}
/* ---------- terminal embutido: roda no app, sem abrir o Terminal do sistema ----------
   Dá um terminal de verdade (pty) ao comando, assim as telinhas interativas
   (login, colar codigo) funcionam dentro do Cockpit. No Mac quem faz isso é o
   ptybridge.py; no Windows é o ConPTY. Quem escolhe é o plataforma.js.        */
const terms = new Map();
const PTY_BRIDGE = app.isPackaged
  ? path.join(process.resourcesPath, 'ptybridge.py')
  : path.join(__dirname, 'ptybridge.py');

function termEnviar(id, kind, data) {
  if (win && !win.isDestroyed()) win.webContents.send('term:event', { id, kind, ...data });
}

function termRodar({ id, linha, cols, rows }) {
  if (!id || !linha) return { error: 'faltou o comando' };
  termMatar(id);
  const c = Math.max(40, Math.min(400, Number(cols) || 100));
  const r = Math.max(10, Math.min(200, Number(rows) || 30));
  let p;
  try {
    p = abrirPty({
      linha, cols: c, rows: r, cwd: HOME, ptyBridge: PTY_BRIDGE,
      env: { ...buildEnv(), TERM: 'xterm-256color', COLUMNS: String(c), LINES: String(r) },
    });
  } catch (e) { return { error: e.message }; }
  terms.set(id, p);
  p.onData((d) => termEnviar(id, 'data', { data: d }));
  p.onErro((e) => termEnviar(id, 'data', { data: '\r\n[erro: ' + e.message + ']\r\n' }));
  // so' apaga se a entrada ainda for DESTE pty: o velho morrendo depois apagava
  // o terminal novo que ja tinha ocupado o mesmo id
  p.onFim((code) => { if (terms.get(id) === p) { terms.delete(id); termEnviar(id, 'exit', { code }); } });
  return { ok: true };
}

function termMatar(id) {
  const p = terms.get(id);
  if (!p) return { ok: true };
  terms.delete(id);
  p.matar();
  return { ok: true };
}

ipcMain.handle('term:run', (_e, o) => termRodar(o || {}));
ipcMain.handle('term:input', (_e, { id, data }) => {
  const p = terms.get(id);
  if (!p) return { error: 'esse terminal já fechou' };
  try { p.escrever(data); } catch (e) { return { error: e.message }; }
  return { ok: true };
});
ipcMain.handle('term:resize', (_e, { id, cols, rows }) => {
  const p = terms.get(id);
  if (!p) return { ok: true };
  p.redimensionar(Math.round(cols), Math.round(rows));
  return { ok: true };
});
ipcMain.handle('term:kill', (_e, { id }) => termMatar(id));

app.on('before-quit', () => { for (const id of [...terms.keys()]) termMatar(id); });

function alvoDoTransporte(t) {
  if (!t) return '';
  if (t.url) return t.url;
  const c = t.command;
  if (Array.isArray(c)) return c.join(' ');
  if (typeof c === 'string') return c + (Array.isArray(t.args) ? ' ' + t.args.join(' ') : '');
  return t.type || '';
}

async function listarMcpConfigurados(engine) {
  // sem isto, um painel Gemini listava os conectores do CLAUDE dizendo que eram dele
  if (engine === 'acp') return { error: 'Os conectores do agente ACP se configuram no próprio agente, pelo terminal (ex.: "gemini mcp").' };
  if (ehCli(engine)) return { error: 'Os conectores do ' + CLIS[engine].nome + ' se configuram pelo terminal: "' + CLIS[engine].bin + ' mcp".' };
  if (engine === 'codex') {
    const r = await rodar('codex', ['mcp', 'list', '--json'], 45000);
    if (r.err) return { error: 'O CLI Codex não confirmou a lista de conectores.' };
    try {
      const arr = JSON.parse(r.out);
      return arr.map(m => ({
        nome: m.name,
        alvo: alvoDoTransporte(m.transport),
        ligado: m.enabled !== false,
        auth: m.auth_status || 'unknown',
        precisaEntrar: m.auth_status === 'not_logged_in' && (m.transport || {}).type !== 'stdio',
        // Login salvo/configuração não comprova conexão nesta conversa.
        status: m.enabled === false ? 'desativado' : m.auth_status === 'not_logged_in'
          && (m.transport || {}).type !== 'stdio' ? 'precisa entrar' : 'configurado',
      }));
    } catch (e) { return { error: 'não consegui ler a lista do Codex: ' + String(e.message).slice(0, 160) }; }
  }
  const r = await rodar(claudeBin(), ['mcp', 'list'], 90000);
  if (r.err) return { error: 'O CLI Claude não confirmou a lista de conectores.' };
  const linhas = (r.out + '\n' + r.errout).split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of linhas) {
    const m = l.match(/^(.+?):\s+(\S+)\s+-\s+(.+)$/);
    if (!m) continue;
    const st = m[3];
    out.push({
      nome: m[1], alvo: m[2],
      ligado: true,
      precisaEntrar: /authentication|auth/i.test(st),
      auth: /authentication|auth/i.test(st) ? 'notLoggedIn' : 'unknown',
      status: /Connected/i.test(st) ? 'conectado na verificação do CLI' : /authentication/i.test(st) ? 'precisa entrar' : st.replace(/[✔✗!⏸]/g, '').trim(),
    });
  }
  return out;
}
ipcMain.handle('mcp:list', (_e, engine) => engine?.remoto != null ? { error: 'Conectores pertencem ao servidor; use o terminal do destino.' } : listarMcpConfigurados(typeof engine === 'object' ? engine.engine : engine));

ipcMain.handle('agentes:sessao', (_e, o) => observabilidade.agentesSessao(o || {}));

async function diagnosticarMcp({ engine, paneId, remoto } = {}) {
  const servidor = remoto ?? remotePaneTargets.get(paneId)?.remoto;
  if (servidor != null) return { engine, itens: [], avisos: ['Conectores pertencem ao destino remoto. Inspecione pelo próprio agente ou terminal do servidor.'] };
  if (!['codex', 'claude'].includes(engine)) return { error: 'Diagnóstico disponível para Codex e Claude.' };
  if (engine === 'claude' && claudeRemoto.has(paneId)) return { engine, itens: [], avisos: ['Esta sessão roda em outro computador; os conectores locais não representam seu estado.'] };
  const avisos = [];
  let configurados = [], runtime = [];
  try {
    const r = await listarMcpConfigurados(engine);
    if (Array.isArray(r)) configurados = r;
    else avisos.push(r?.error || 'Não foi possível ler a configuração dos conectores.');
  } catch { avisos.push('Não foi possível consultar a configuração dos conectores.'); }
  if (engine === 'codex') {
    const threadId = codex.paneToThread.get(paneId);
    if (codex.pronto && threadId) {
      try {
        const r = await listarRuntimeCodex(codexReq, threadId);
        runtime = r.itens;
        if (r.parcial) avisos.push('Inventário parcial: limite de 500 conectores atingido.');
      } catch { avisos.push('Não foi possível consultar os conectores carregados nesta conversa.'); }
    } else avisos.push('Sem conversa Codex conectada neste painel; o estado carregado é desconhecido.');
  } else avisos.push('Claude: carregamento observado na abertura da sessão. A verificação do CLI ocorre em outro processo.');
  const resultado = observabilidade.diagnostico(engine, paneId, configurados, runtime);
  resultado.avisos = avisos;
  return resultado;
}
ipcMain.handle('mcp:diagnostico', (_e, o) => diagnosticarMcp(o));

ipcMain.handle('mcp:recarregar', async (_e, { engine, paneId, remoto } = {}) => {
  if (remoto != null || remotePaneTargets.has(paneId)) return { error: 'Reabra o painel remoto para carregar os conectores do servidor.' };
  if (engine !== 'codex') return { error: 'O Claude aplica a configuração na próxima abertura da sessão. Esta ação não reinicia sua conversa.' };
  if (!codex.pronto) return { error: 'O Codex não está conectado.' };
  if (codex.paneTurn.size) return { error: 'Aguarde todos os turnos Codex terminarem: o servidor de conectores é compartilhado.' };
  try {
    await codexReq('config/mcpServer/reload', null, 30000);
    const diagnostico = await diagnosticarMcp({ engine, paneId });
    return { ok: true, recarregado: true, diagnostico,
      aviso: 'O Codex aceitou a recarga. Consulte o estado carregado; isso ainda não comprova uma chamada de ferramenta.' };
  } catch { return { error: 'O Codex não confirmou a recarga dos conectores.' }; }
});

ipcMain.handle('mcp:acao', async (_e, { engine, acao, nome, url, comando, remoto, paneId }) => {
  if (remoto != null || remotePaneTargets.has(paneId)) return { error: 'Altere este conector pelo terminal do servidor.' };
  // e MUITO menos gravar: um "adicionar" num painel Gemini escrevia no CODEX
  if (engine === 'acp') return { error: 'Adicione pelo terminal do próprio agente ACP.' };
  if (ehCli(engine)) return { error: 'Adicione pelo terminal: "' + CLIS[engine].bin + ' mcp".' };
  const bin = engine === 'claude' ? claudeBin() : 'codex';
  const cru = engine === 'claude' ? claudeBin() : acharBin('codex');
  const nomeBin = /[ ()]/.test(cru) ? '"' + cru + '"' : cru;
  if (acao === 'login' || acao === 'logout') {
    // roda no terminal embutido do Cockpit, sem abrir o Terminal do Mac
    // nome de conector e' texto de terceiro: so' aceita o que e' inofensivo em shell
    if (!/^[\w.@:-]{1,64}$/.test(String(nome || ''))) {
      return { error: 'Nome de conector com caractere não permitido: ' + String(nome).slice(0, 40) };
    }
    return { terminal: nomeBin + ' mcp ' + acao + ' ' + (EH_WIN ? '"' + nome + '"' : qLinux(nome)),
             titulo: (acao === 'login' ? 'Entrar no conector ' : 'Sair do conector ') + nome };
  }
  if (acao === 'remove') {
    const r = await rodar(bin, ['mcp', 'remove', nome], 30000);
    return r.err ? { error: (r.errout || r.err.message).slice(0, 300) } : { ok: true };
  }
  if (acao === 'add') {
    if (!nome) return { error: 'falta o nome' };
    let args;
    if (url) {
      args = engine === 'claude' ? ['mcp', 'add', '--transport', 'http', nome, url] : ['mcp', 'add', nome, '--url', url];
    } else if (comando) {
      const partes = comando.split(/\s+/).filter(Boolean);
      args = engine === 'claude' ? ['mcp', 'add', nome, '--', ...partes] : ['mcp', 'add', nome, '--', ...partes];
    } else return { error: 'informe o endereço ou o comando' };
    const r = await rodar(bin, args, 45000);
    return r.err ? { error: (r.errout || r.out || r.err.message).slice(0, 300) } : { ok: true };
  }
  return { error: 'ação desconhecida' };
});

/* ===================== CAIXA DE PERGUNTAS =====================
   O motor ganha uma ferramenta pra PERGUNTAR e ESPERAR a resposta, em vez de
   escolher sozinho ou encerrar o turno com a duvida no texto.

   Como as pecas se ligam:
     Cockpit  ->  escreve um mcp-config por painel e passa no --mcp-config
     claude   ->  sobe o pergunta-mcp.js como servidor MCP daquela sessao
     ferramenta chamada  ->  o mcp escreve <id>.pedido.json e fica esperando
     Cockpit  ->  ve o pedido, manda pra tela, voce responde
     Cockpit  ->  escreve <id>.resposta.json  ->  a ferramenta devolve e o turno segue

   Painel remoto fica de fora: o servidor rodaria no servidor, e o arquivo de
   troca estaria la, longe da sua tela. */
const PASTA_PERGUNTAS = () => path.join(app.getPath('userData'), 'perguntas');
const PASTA_MCP = () => path.join(app.getPath('userData'), 'mcp');
const MCP_PERGUNTA = path.join(__dirname, 'pergunta-mcp.js');
const hostCapabilities = new Map();
let hostMailbox;
function ensureHostMailbox() {
  const directory = path.join(app.getPath('userData'), 'host-mailbox');
  if (!hostMailbox) hostMailbox = cockpitInteractions.createMcpHostMailbox({ directory, broker: interactionBroker,
    resolveScope: ({ paneId, capability }) => {
      const st = claudePanes.get(paneId);
      if (!st || !capability || st.hostCapability !== capability || hostCapabilities.get(String(paneId)) !== capability) return null;
      return claudeScope(paneId);
    } });
  return directory;
}
app.on('before-quit', () => { hostMailbox?.dispose(); interactionBroker.dispose(); });

/* Um arquivo de config por painel: e' nele que vai o COCKPIT_PAINEL, e e' assim
   que o pedido que chega sabe de qual painel veio. */
function configMcpDoPainel(paneId) {
  try {
    if (!fs.existsSync(MCP_PERGUNTA)) return '';
    const dir = PASTA_MCP();
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(PASTA_PERGUNTAS(), { recursive: true });
    const alvo = path.join(dir, 'perguntas-' + String(paneId).replace(/[^a-zA-Z0-9]/g, '') + '.json');
    const capability = crypto.randomUUID() + crypto.randomUUID(); hostCapabilities.set(String(paneId), capability);
    const cfg = {
      mcpServers: {
        cockpit: {
          type: 'stdio',
          // o proprio Electron roda como node: nao depende de ter node no PATH
          command: process.execPath,
          args: [MCP_PERGUNTA],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            COCKPIT_PERGUNTAS: PASTA_PERGUNTAS(),
            COCKPIT_PAINEL: String(paneId),
            COCKPIT_HOST_MAILBOX: ensureHostMailbox(),
            COCKPIT_HOST_CAPABILITY: capability,
          },
        },
      },
    };
    fs.writeFileSync(alvo, JSON.stringify(cfg), 'utf8');
    return alvo;
  } catch { return ''; }
}

/* Vigia a pasta e avisa a tela quando um pedido novo aparece. fs.watch avisa
   rapido; a varredura de 1s existe porque fs.watch perde evento no Windows com
   alguma frequencia - e uma pergunta perdida deixaria o motor parado ate o teto
   de 30 minutos. */
/* Quem ja foi pra tela. O pedido chega por DOIS caminhos (o fs.watch e a
   varredura de 1s), entao sem isto a caixa era desenhada de novo e apagava o
   que voce ja tinha marcado. Marcar ANTES de emitir fecha a corrida entre os
   dois caminhos. */
const perguntasVistas = new Set();
let vigiaPerguntas = null;
let varrendo = false;

/* o Set so' crescia: numa maquina dias aberta vira lista de id morto */
function podarVistas() {
  if (perguntasVistas.size < 200) return;
  let vivos;
  try { vivos = new Set(fs.readdirSync(PASTA_PERGUNTAS()).map((n) => n.split('.')[0])); }
  catch { return; }
  // sem arquivo nenhum na pasta, aquele id acabou: pode sair da lista sem risco
  // de a pergunta voltar (nao ha mais pedido pra varredura achar)
  for (const id of [...perguntasVistas]) if (!vivos.has(id)) perguntasVistas.delete(id);
}

function lerPedido(arquivo) {
  try {
    const cru = fs.readFileSync(arquivo, 'utf8');
    if (!cru.trim()) return null;
    return JSON.parse(cru);
  } catch { return null; }
}

function varrerPerguntas() {
  if (varrendo) return;              // o fs.watch dispara em rajada
  varrendo = true;
  try { varrerPerguntasAgora(); } finally { varrendo = false; }
}

/* Acima do teto que o servidor espera (30 min), um pedido so' pode ser orfao:
   ou o painel dele fechou, ou o processo morreu sem limpar. Fica na pasta sem
   nunca virar caixa e sem nunca sair - lixo que so' cresce. */
const VIDA_MAX_PEDIDO = 35 * 60 * 1000;

function varrerPerguntasAgora() {
  let nomes;
  try { nomes = fs.readdirSync(PASTA_PERGUNTAS()); } catch { return; }
  podarVistas();
  const agora = Date.now();
  for (const nome of nomes) {
    if (nome.endsWith('.pedido.json')) {
      const cheio = path.join(PASTA_PERGUNTAS(), nome);
      let velho = false;
      try { velho = agora - fs.statSync(cheio).mtimeMs > VIDA_MAX_PEDIDO; } catch {}
      if (velho) {
        try { fs.unlinkSync(cheio); } catch {}
        perguntasVistas.delete(nome.slice(0, -'.pedido.json'.length));
        continue;
      }
    }
    /* resposta que ninguem leu: o normal e' o servidor apagar assim que le, mas
       se ele morreu antes disso o arquivo ficaria na pasta pra sempre */
    if (nome.endsWith('.resposta.json')) {
      const cheio = path.join(PASTA_PERGUNTAS(), nome);
      try { if (agora - fs.statSync(cheio).mtimeMs > VIDA_MAX_PEDIDO) fs.unlinkSync(cheio); } catch {}
      continue;
    }
    if (nome.endsWith('.cancelar')) {
      // o motor desistiu de esperar: a caixa some da tela
      const id = nome.slice(0, -'.cancelar'.length);
      try { fs.unlinkSync(path.join(PASTA_PERGUNTAS(), nome)); } catch {}
      const painel = id.split('-')[0];
      emit(painel, 'pergunta-cancelada', { id });
      perguntasVistas.delete(id);
      continue;
    }
    if (!nome.endsWith('.pedido.json')) continue;
    const id = nome.slice(0, -'.pedido.json'.length);
    if (perguntasVistas.has(id)) continue;
    const o = lerPedido(path.join(PASTA_PERGUNTAS(), nome));
    if (!o || !Array.isArray(o.perguntas) || !o.perguntas.length) continue;
    perguntasVistas.add(id);   // ANTES de emitir: fecha a corrida entre watch e varredura
    emit(o.painel || id.split('-')[0], 'pergunta', { id: o.id || id, perguntas: o.perguntas });
  }
}

function ligarVigiaPerguntas() {
  if (vigiaPerguntas) return;
  try { fs.mkdirSync(PASTA_PERGUNTAS(), { recursive: true }); } catch {}
  try { fs.watch(PASTA_PERGUNTAS(), () => setTimeout(varrerPerguntas, 60)); } catch {}
  vigiaPerguntas = setInterval(varrerPerguntas, 1000);
  varrerPerguntas();
}

ipcMain.handle('pergunta:responder', (_e, { id, respostas, cancelado, textoLivre }) => {
  /* Leva 5h: o X do cartao ("a minha proxima mensagem vira a resposta"). O texto livre responde o pedido INTEIRO: cada caminho
     o transforma no formato que ja' usa, sem mudar protocolo nenhum. Cancelar ("Decide voce") vale mais que o texto. */
  const texto = (!cancelado && typeof textoLivre === 'string') ? textoLivre.trim() : '';
  if (remoteEngines.questionOwns(id)) return remoteEngines.answer(id, respostas, cancelado, texto);
  const seguro = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!seguro) return { error: 'pergunta sem identificação' };
  /* Tarefa 8: pergunta do proprio Claude (AskUserQuestion). O outro lado e' o
     can_use_tool parado esperando: a resposta vai por control_response, pro
     processo que perguntou. O pedido sai do mapa ANTES de escrever (um segundo
     envio nao acha nada), e id "claude_q_" sem pedido nunca cai no caminho dos
     arquivos do MCP. */
  if (seguro.startsWith('claude_q_')) {
    const a = pedidosClaude.get(seguro);
    if (!a || a.tipo !== 'perguntas') return { error: 'Esta pergunta já foi encerrada.' };
    pedidosClaude.delete(seguro);
    // o texto livre vira a resposta de cada pergunta que a tela mostrou (as mesmas que o respostaDoAsk le por posicao)
    const doAsk = texto ? interacao.perguntasDoAsk(a.input).map(() => texto) : respostas;
    if (!escreverRespostaClaude(a, interacao.respostaDoAsk(a.input, doAsk, !!cancelado))) {
      emit(a.paneId, 'pergunta-cancelada', { id: seguro, texto: 'A pergunta foi encerrada: o motor deste painel não está mais esperando.' });
      return { error: 'O motor deste painel não está mais esperando esta resposta.' };
    }
    return { ok: true };
  }
  /* pergunta NATIVA do Codex nao passa por arquivo: o outro lado e' uma chamada
     JSON-RPC parada esperando. Responde direto e sai. */
  const nativa = perguntasCodex.get(seguro);
  if (nativa) {
    perguntasCodex.delete(seguro);
    // todas as perguntas do pedido (nativa.questions), nao so' as 4 do cartao: o texto responde o pedido inteiro
    const doCodex = texto ? nativa.questions.map(() => texto) : respostas;
    try { codexReply(nativa.rpcId, proto.buildUserInputResponse(nativa.questions, doCodex, !!cancelado)); }
    catch (e) { return { error: String((e && e.message) || e) }; }
    return { ok: true };
  }
  try {
    const dir = PASTA_PERGUNTAS();
    fs.mkdirSync(dir, { recursive: true });
    /* Rodada 2 da leva 5h: sem o pedido na pasta ninguem espera esta resposta (o painel parou, o motor desistiu no teto de 30 min, ou ela
       ja' foi respondida: quem responde apaga o pedido). Gravar a resposta so' deixaria um arquivo orfao, e a tela acreditaria que o texto
       chegou - o X do cartao engolia a mensagem seguinte assim. Devolve o erro: a tela devolve o texto a caixa (responderPerguntaPelaCaixa). */
    if (!fs.existsSync(path.join(dir, seguro + '.pedido.json'))) return { error: 'Esta pergunta já foi encerrada: o motor deste painel não está mais esperando.' };
    const alvo = path.join(dir, seguro + '.resposta.json');
    const tmp = alvo + '.tmp';
    // com o texto livre o arquivo leva so' ele: quem le (pergunta-mcp.js, textoDaResposta) conta ao modelo que foi por texto
    fs.writeFileSync(tmp, JSON.stringify(texto ? { textoLivre: texto } : { respostas: respostas || [], cancelado: !!cancelado }), 'utf8');
    fs.renameSync(tmp, alvo);
    /* O pedido sai daqui, nao la do servidor. Deixar essa limpeza pro processo
       do outro lado significava que, se ele morresse antes de ler (o painel
       parou, o app fechou no meio), o arquivo ficava na pasta e a varredura
       reabria a MESMA pergunta pra sempre, logo depois de voce responder.
       E o id fica na lista de vistos: respondida uma vez, nao volta. */
    try { fs.unlinkSync(path.join(dir, seguro + '.pedido.json')); } catch {}
    perguntasVistas.add(seguro);
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});

/* pergunta que ficou pendurada de um painel que morreu nao pode voltar
   assombrando a tela na proxima abertura.
   Rodada 2 da leva 5h: o pedido (ou o cancelar) que sai da pasta TAMBEM avisa a tela, com o mesmo pergunta-cancelada que a pergunta nativa
   do Codex e o AskUserQuestion ja' mandam (descartarPerguntasCodex, descartarPedidosClaude). Sem o aviso, o X do cartao ("a minha proxima
   mensagem vira a resposta") deixava o selo vivo depois de uma troca de modelo, de esforco, de Sonnet reserva ou de motor, que param o
   Claude: a mensagem seguinte virava resposta de uma pergunta morta e nao chegava a lugar nenhum. Painel que ja' fechou nao quebra nada:
   a tela ignora evento de painel que nao existe mais. A limpeza da abertura do app (paneId vazio) nao avisa: ainda nao ha tela. */
function limparPerguntasDoPainel(paneId) {
  const marca = String(paneId || '');
  const encerradas = new Set();
  try {
    const dir = PASTA_PERGUNTAS();
    if (!fs.existsSync(dir)) return;
    const agora = Date.now();
    for (const nome of fs.readdirSync(dir)) {
      if (marca && !nome.startsWith(marca + '-')) continue;
      const cheio = path.join(dir, nome);
      /* Resposta recem-escrita fica: fechar o painel escreve "cancelado" pra
         soltar o motor, e esta limpeza vem logo atras pelo paneStop - sem esta
         guarda ela apagava justamente o aviso que acabou de ser dado, e o outro
         lado ficaria esperando ate o teto de 30 minutos. */
      if (nome.endsWith('.resposta.json')) {
        try { if (agora - fs.statSync(cheio).mtimeMs < 15000) continue; } catch {}
      }
      try { fs.unlinkSync(cheio); } catch {}
      const id = nome.replace(/\.(pedido|resposta)\.json$|\.cancelar$/, '');
      perguntasVistas.delete(id);
      if (marca && /\.(pedido\.json|cancelar)$/.test(nome)) encerradas.add(id);
    }
  } catch {}
  for (const id of encerradas) emit(paneId, 'pergunta-cancelada', { id, texto: 'A pergunta foi encerrada: o turno acabou ou o painel parou.' });
}

/* ---------- audio virando texto, tudo aqui no PC ----------
   O navegador grava em webm; o ffmpeg converte pra wav 16k (o que o modelo
   espera) e o faster-whisper transcreve offline. Nada sai da maquina. */
const PY_TRANSCRICAO = path.join(HOME, 'venv-transcricao', 'Scripts', EH_WIN ? 'python.exe' : 'python');

/* Motor de voz: 'whisper' (base pra legenda + small pro passe caprichado, como
   sempre) ou 'parakeet' (UM processo faz os dois papeis: 4x mais rapido que o
   small, pontuacao nativa, nao trava em silencio; precisao empatou com o small
   na bancada de TTS - ferramentas/voz/RESULTADO.md). A tela escolhe nos Ajustes. */
let motorVoz = 'whisper';
const PARAKEET_FONTE = path.join(__dirname, 'assets', 'ouvinte-parakeet.py');
// o Python nao le de dentro do asar: o script vai pro userData (so' quando muda)
function scriptParakeet() {
  const alvo = path.join(app.getPath('userData'), 'ouvinte-parakeet.py');
  try {
    const novo = fs.readFileSync(PARAKEET_FONTE, 'utf8');
    let atual = ''; try { atual = fs.readFileSync(alvo, 'utf8'); } catch {}
    if (atual !== novo) fs.writeFileSync(alvo, novo, 'utf8');
  } catch {}
  return alvo;
}
const modeloDoPapel = (rapido) => (motorVoz === 'parakeet' ? 'parakeet' : (rapido ? 'base' : 'small'));
const PASTA_AUDIO = () => path.join(app.getPath('userData'), 'audio');

function temTranscricao() {
  try { return fs.existsSync(PY_TRANSCRICAO); } catch { return false; }
}

ipcMain.handle('audio:disponivel', () => ({ ok: temTranscricao() }));
/* O modelo pesa ~460 MB e demora ~10s pra carregar. Carregar a cada ditado
   deixaria tudo lento, entao um processo fica vivo esperando: manda o caminho
   do wav numa linha, recebe o texto de volta na outra. */
const OUVINTE = (nome) => [
  'import sys, json',
  'import numpy as np',
  'from faster_whisper import WhisperModel',
  '# 4 threads por modelo: com o padrao, os dois pegam os 12 nucleos e brigam',
  '# entre si (medido: a legenda passava de 1,4s para 5s)',
  'modelo = WhisperModel("' + nome + '", device="cpu", compute_type="int8", cpu_threads=4)',
  'print(json.dumps({"pronto": True}), flush=True)',
  'for linha in sys.stdin:',
  '    linha = linha.strip()',
  '    if not linha: continue',
  '    try:',
  '        pedido = json.loads(linha)',
  '    except Exception:',
  '        continue',
  '    ident = pedido.get("id")',
  '    try:',
  '        # "pcm" e um arquivo de amostras cruas 16 bits / 16 kHz escrito pelo app.',
  '        # Evita o ffmpeg no caminho do ditado ao vivo: este pedido se repete',
  '        # a cada segundo enquanto a pessoa fala, entao cada etapa a menos conta.',
  '        alvo = pedido.get("pcm")',
  '        if alvo:',
  '            dados = np.fromfile(alvo, dtype=np.int16).astype(np.float32) / 32768.0',
  '            # microfone fraco: leva o pico ate 0.7 antes de transcrever.',
  '            # Silencio puro (pico < 0.004) fica como esta - amplificar so',
  '            # o chiado faz o modelo inventar frase que ninguem falou.',
  '            pico = float(np.max(np.abs(dados))) if dados.size else 0.0',
  '            if 0.004 < pico < 0.5:',
  '                dados = dados * (0.7 / pico)',
  '        else:',
  '            dados = pedido.get("wav")',
  '        rapido = bool(pedido.get("rapido"))',
  '        segs, _ = modelo.transcribe(dados, language="pt",',
  '            beam_size=1 if rapido else 5,',
  '            # sem vad_filter: o painel ja corta o silencio antes de mandar, e',
  '            # ligado aqui ele descartava o trecho INTEIRO e voltava vazio',
  '            vad_filter=False,',
  '            without_timestamps=rapido,',
  '            condition_on_previous_text=False)',
  '        texto = " ".join(s.text.strip() for s in segs).strip()',
  '        print(json.dumps({"id": ident, "texto": texto}), flush=True)',
  '    except Exception as e:',
  '        print(json.dumps({"id": ident, "erro": str(e)}), flush=True)',
].join('\n');

/* Dois ouvintes: o "small" e o caprichado (texto que fica) e o "base" e o
   rapido, que faz a legenda enquanto a pessoa fala. Separados de proposito -
   com um so, o passe caprichado de uma frase seguraria na fila a legenda da
   frase seguinte, e a legenda ficaria cada vez mais atrasada. */
const ouvintes = new Map();

function novoOuvinte(modelo) {
  return { modelo, proc: null, buf: '', pedidos: new Map(), seq: 0, pronto: false };
}
/* O nome vai interpolado DENTRO do codigo Python do ouvinte. Hoje so' chega o
   que esta escrito neste arquivo, mas um valor vindo de fora viraria execucao
   de codigo - entao a lista fecha a porta antes. */
const MODELOS_VOZ = ['base', 'small', 'parakeet'];
function pegarOuvinte(modelo) {
  const nome = MODELOS_VOZ.includes(modelo) ? modelo : 'small';
  let o = ouvintes.get(nome);
  if (!o) { o = novoOuvinte(nome); ouvintes.set(nome, o); }
  return o;
}
// o de sempre continua sendo o "small": o resto do arquivo fala com ele
const ouvinte = pegarOuvinte('small');

function ligarOuvinte(modelo) {
  const ou = pegarOuvinte(modelo || 'small');
  if (ou.proc || !temTranscricao()) return ou;
  let proc;
  try {
    // UTF-8 na marra: sem isso um caminho com acento derruba o Python, que
    // volta a subir e cai de novo, em loop
    // o Parakeet e' um script proprio (assets/ouvinte-parakeet.py); os whisper
    // continuam sendo o codigo inline de sempre
    proc = spawnBin(PY_TRANSCRICAO, ou.modelo === 'parakeet' ? ['-u', scriptParakeet()] : ['-u', '-c', OUVINTE(ou.modelo)],
      { env: { ...buildEnv(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { ou.proc = null; return ou; }
  ou.proc = proc; ou.erroFatal = ''; ou.pronto = false; ou.buf = '';
  /* a fila de pedidos e' DESTE processo. Trocar o motor de voz no meio de um
     ditado matava o Python velho depois que o novo ja tinha subido, e o 'close'
     do velho zerava o novo (ficava orfao) e matava o pedido em voo. */
  const pedidos = new Map();
  ou.pedidos = pedidos;

  /* O caprichado cede a vez pra legenda. Sem isto o texto ao vivo parava por
     ~8s toda vez que uma frase fechava: os dois modelos brigavam pela CPU e
     quem esperava era justamente o que a pessoa esta olhando.
     (o Parakeet faz a legenda tambem: nao pode ceder a vez) */
  if (ou.modelo === 'small') {
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  }
  proc.stdin.on('error', () => {});
  proc.stdout.setEncoding?.('utf8');  proc.stdout.on('data', (chunk) => {
    if (ou.proc !== proc) return;   // processo ja substituido: o rabo dele nao entra
    ou.buf += chunk.toString('utf8');
    let i;
    while ((i = ou.buf.indexOf('\n')) >= 0) {
      const linha = ou.buf.slice(0, i).trim();
      ou.buf = ou.buf.slice(i + 1);
      if (!linha) continue;
      let o; try { o = JSON.parse(linha); } catch { continue; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      // ouvinte que nao conseguiu subir (ex: modelo do Parakeet nao baixado)
      // explica o porque - e a explicacao chega na tela, nao "a transcricao parou"
      if (o.pronto === false) {
        ou.erroFatal = String(o.erro || 'o ouvinte não subiu');
        if (ou.modelo === 'parakeet' && motorVoz === 'parakeet') {
          // sem o modelo, volta sozinho pro Whisper em vez de subir um Python
          // por segundo enquanto a pessoa fala - e a tela fica sabendo
          motorVoz = 'whisper';
          if (win && !win.isDestroyed()) win.webContents.send('voz:motor-caiu', { motivo: ou.erroFatal });
        }
        continue;
      }
      if (o.pronto) { ou.pronto = true; continue; }
      const espera = pedidos.get(o.id);
      if (espera) { pedidos.delete(o.id); espera(o); }
      // resposta de um pedido que ja desistiu: descarta, sem bagunçar os outros
    }
  });
  proc.stderr.setEncoding?.('utf8');  proc.stderr.on('data', () => {});
  const caiu = () => {
    // fecha SO' a fila deste processo; o estado do ouvinte so' e' zerado se
    // este ainda for o processo dele (senao o novo virava orfao)
    for (const [, espera] of pedidos) espera({ erro: ou.erroFatal || 'a transcrição parou' });
    pedidos.clear();
    if (ou.proc !== proc) return;
    ou.proc = null; ou.pronto = false; ou.buf = '';
  };
  proc.on('close', caiu);
  proc.on('error', caiu);
  return ou;
}

// os dois morrem junto com o app, senao ficam Pythons vivos segurando 650 MB
app.on('before-quit', () => {
  for (const ou of ouvintes.values()) { try { ou.proc && ou.proc.kill(); } catch {} }
  limparAudioDoDisco();
});

function transcreverArquivo(wav, extra) {
  return new Promise((resolve) => {
    // legenda ao vivo vai no rapido; todo o resto, no caprichado
    const ou = ligarOuvinte(modeloDoPapel(!!(extra && extra.rapido)));
    if (!ou.proc) return resolve({ erro: ou.erroFatal || 'não consegui iniciar a transcrição' });
    const id = 'a' + (++ou.seq);
    // o ditado ao vivo desiste rapido: legenda que chega tarde nao serve
    const espera = (extra && extra.rapido) ? 30000 : 300000;
    const limite = setTimeout(() => {
      ou.pedidos.delete(id);
      resolve({ erro: 'a transcrição demorou demais' });
    }, espera);
    ou.pedidos.set(id, (o) => { clearTimeout(limite); resolve(o); });
    try { ou.proc.stdin.write(JSON.stringify({ id, wav, ...(extra || {}) }) + '\n'); }
    catch { clearTimeout(limite); ou.pedidos.delete(id); resolve({ erro: 'não consegui falar com a transcrição' }); }
  });
}

/* ---------- ditado ao vivo ----------
   O painel manda as amostras cruas (16 bits, 16 kHz, mono) que ja capturou
   desde o comeco da frase; aqui elas viram arquivo e vao pro mesmo ouvinte, em
   modo rapido. Sem ffmpeg e sem webm: e o caminho mais curto possivel, porque
   este pedido se repete a cada segundo enquanto a pessoa fala.

   Um painel so pode ter UM pedido em voo. Se chegar outro antes da resposta, o
   novo volta com "ocupado" - enfileirar so faria a legenda ficar cada vez mais
   atrasada em relacao a fala. */
const ditando = new Map();   // paneId -> { emVoo, geracao }

function estadoDitado(paneId) {
  let d = ditando.get(paneId);
  if (!d) { d = { emVoo: false, geracao: 0 }; ditando.set(paneId, d); }
  return d;
}

/* Nome UNICO por chamada. Com nome fixo por painel, uma frase que fecha e o
   fim do ditado logo em seguida escreviam no mesmo arquivo, e a segunda apagava
   o audio da primeira antes de ele ser lido. */
/* Buffer.from(typedArray) copia os VALORES, um byte cada - o que destroi
   amostra de 16 bits. Para audio e preciso apontar pro buffer de verdade. */
function bytesCrus(x) {
  if (Buffer.isBuffer(x)) return x;
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  return Buffer.from(x || []);
}

/* O ditado grava a VOZ da pessoa em arquivo pra mandar pro modelo. No caminho
   normal cada um e apagado logo depois; se o app fechar no meio, nao ha quem
   apague. Entao a pasta e varrida ao abrir e ao fechar o app. */
function limparAudioDoDisco() {
  try {
    const dir = PASTA_AUDIO();
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(pcm|wav|webm|ogg)$/i.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    }
  } catch {}
}

let seqArquivoDitado = 0;
function arquivoDitado(paneId, prefixo) {
  const limpo = String(paneId || 'x').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'x';
  return path.join(PASTA_AUDIO(), prefixo + '-' + limpo + '-' + (++seqArquivoDitado) + '.pcm');
}

ipcMain.handle('audio:ditado-cancelar', (_e, { paneId }) => {
  // a geracao muda: resposta de pedido antigo que ainda chegar e descartada
  const chave = String(paneId || '');
  const d = estadoDitado(chave);
  d.geracao++;
  // sem nada em voo, o painel sai do mapa - senao ele so' crescia, um item por
  // painel que ja ditou, ate o app fechar
  if (!d.emVoo) ditando.delete(chave);
  return { ok: true };
});

ipcMain.handle('audio:ditado', async (_e, { paneId, amostras }) => {
  if (!temTranscricao()) return { error: 'A transcrição ainda não está instalada nesta máquina.' };
  const chave = String(paneId || '');
  const d = estadoDitado(chave);
  if (d.emVoo) return { ocupado: true };
  const minhaGeracao = d.geracao;
  d.emVoo = true;
  const bruto = arquivoDitado(chave, 'ditado');
  try {
    try { fs.mkdirSync(PASTA_AUDIO(), { recursive: true }); } catch {}
    fs.writeFileSync(bruto, bytesCrus(amostras));
    // 2 bytes por amostra: se isto falhar, o audio chegou truncado
    if (fs.statSync(bruto).size % 2) return { error: 'áudio chegou incompleto' };
    const r = await transcreverArquivo(null, { pcm: bruto, rapido: true });
    // parou de gravar (ou virou outra frase) enquanto isto rodava
    if (d.geracao !== minhaGeracao) return { descartado: true };
    if (r.erro) return { error: r.erro };
    return { texto: String(r.texto || '') };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  } finally {
    d.emVoo = false;
    try { fs.unlinkSync(bruto); } catch {}
  }
});

/* fim do ditado: as mesmas amostras, agora com beam cheio e VAD ligado - o
   passe caprichado, que corrige o que a legenda ao vivo entendeu errado */
ipcMain.handle('audio:ditado-final', async (_e, { paneId, amostras }) => {
  if (!temTranscricao()) return { error: 'A transcrição ainda não está instalada nesta máquina.' };
  const bruto = arquivoDitado(paneId, 'final');
  try {
    try { fs.mkdirSync(PASTA_AUDIO(), { recursive: true }); } catch {}
    fs.writeFileSync(bruto, bytesCrus(amostras));
    const r = await transcreverArquivo(null, { pcm: bruto, rapido: false });
    if (r.erro) return { error: r.erro };
    return { texto: String(r.texto || '') };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  } finally {
    try { fs.unlinkSync(bruto); } catch {}
  }
});

ipcMain.handle('audio:aquecer', () => {
  // sobe os dois: o rapido vai legendar em segundos, e o caprichado vai ser
  // cobrado assim que a primeira frase fechar
  const rap = ligarOuvinte(modeloDoPapel(true));
  const cap = ligarOuvinte(modeloDoPapel(false));   // no Parakeet e' o mesmo processo
  return { ok: !!(rap.proc && cap.proc), pronto: rap.pronto };
});

// a tela escolhe o motor de voz; trocar derruba os ouvintes vivos (sobem de
// novo no proximo ditado, ja no motor novo)
ipcMain.handle('audio:motor', async (_e, { motor }) => {
  const novo = motor === 'parakeet' ? 'parakeet' : 'whisper';
  if (novo === 'parakeet' && novo !== motorVoz) {
    // sem o modelo baixado nao adianta trocar: recusa explicando, e a tela volta o seletor
    const info = await infoDoParakeet();
    if (info.error) return { error: info.error, motor: motorVoz };
    if (!info.baixado) return { error: 'O modelo do Parakeet ainda não está baixado. Rode no terminal: ' + info.comando, motor: motorVoz };
  }
  if (novo !== motorVoz) {
    motorVoz = novo;
    // mata os ouvintes vivos; quem zera o estado e' o 'close' de cada um
    // (assim um pedido em voo recebe o erro e o proximo start nao vira orfao)
    for (const ou of ouvintes.values()) { if (ou.proc) { try { ou.proc.kill(); } catch {} } }
  }
  return { ok: true, motor: motorVoz };
});
// o modelo do Parakeet (640 MB) esta' baixado? sem carregar nada
let cacheInfoParakeet = { quando: 0, r: null };   // o boot pergunta duas vezes seguidas; um Python importando onnxruntime basta
async function infoDoParakeet() {
  if (!temTranscricao()) return { error: 'A transcrição de áudio não está instalada nesta máquina.' };
  if (cacheInfoParakeet.r && Date.now() - cacheInfoParakeet.quando < 60000) return cacheInfoParakeet.r;
  const comando = '"' + PY_TRANSCRICAO + '" "' + scriptParakeet() + '" --baixar';
  let resp;
  try {
    const r = await rodar(PY_TRANSCRICAO, ['-u', scriptParakeet(), '--info'], 30000);
    let j = null; try { j = JSON.parse(String(r.out || '').trim().split('\n').pop()); } catch {}
    // sem JSON (Python travado, timeout) nao e' "modelo nao baixado": e' "nao consegui conferir"
    if (!j) return { error: 'Não consegui conferir o modelo do Parakeet' + (String(r.errout || '').trim() ? ' (' + String(r.errout).trim().replace(/\s+/g, ' ').slice(0, 120) + ')' : '') + '.', comando };
    // o script responde {baixado, pasta, mb} ou {baixado:false, erro}
    resp = { baixado: !!j.baixado, detalhe: j.baixado ? (String(j.pasta || '') + (j.mb ? ' (' + j.mb + ' MB)' : '')) : String(j.erro || ''), comando };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
  cacheInfoParakeet = { quando: Date.now(), r: resp };
  return resp;
}
ipcMain.handle('audio:motorInfo', () => infoDoParakeet());

/* ---------- contas guardadas: trocar sem refazer login ----------
   Cada engine guarda a credencial num arquivo. Guardando uma copia por apelido,
   da' pra alternar entre contas ja logadas trocando o arquivo de volta. */
/* o Claude pode guardar a credencial em dois lugares no Windows; no Mac ela
   vive no Chaveiro e nao da' pra copiar como arquivo */
const { inspectCredential, credentialPaths, authenticationStatus } = require('./cockpit-credentials');
function arqCred(engine) {
  const lista = credentialPaths(engine, HOME, buildEnv(), path);
  for (const p of lista) { try { if (fs.existsSync(p)) return p; } catch {} }
  return lista[0];
}
const PASTA_CONTAS = () => path.join(app.getPath('userData'), 'contas');
const credentialStore = require('./cockpit-credential-store').createCredentialStore({ folder: PASTA_CONTAS, activePath: arqCred, validate: (engine, text) => accountComparison.profileState(engine, text) });
const lerCredencial = engine => credentialStore.readActive(engine);
function trocaDeContaDisponivel(engine) {
  if (!EH_WIN && engine === 'claude') return false;
  const info = accountComparison.profileState(engine, lerCredencial(engine));
  return info.valido && info.podeUsar;
}
function capacidadesConta(engine, remoto) {
  const gerenciado = engine === 'claude' || (engine === 'codex' && !remoto);
  const arquivo = gerenciado && (EH_WIN || engine === 'codex' || !!remoto);
  return { gerenciado, salvar: arquivo, trocar: arquivo, login: gerenciado, logout: gerenciado,
    consulta: engine === 'claude' || engine === 'codex',
    orientacao: gerenciado ? '' : 'A autenticação deste motor é administrada no terminal ' + (remoto ? 'do servidor.' : 'do próprio agente.') };
}

/* ---------- conta do Claude NO SERVIDOR (aba de SSH) ----------
   O painel remoto roda o claude do servidor, com a credencial do servidor. Ate'
   a leva 41 estes canais so' conheciam o PC: /login numa aba da VPS logava o PC,
   /logout deslogava o PC, "Trocar de conta" trocava o arquivo do PC e a VPS
   seguia na conta antiga. Agora todo canal de conta aceita { engine, remoto }.
   So' a PRESENCA do objeto 'remoto' decide: se ele vier torto, o pedido vira
   erro -- nunca uma volta calada pro disco daqui. Os comandos em si moram no
   cockpit-contas-remoto.js (testavel sem Electron). */
const contasRemoto = require('./cockpit-contas-remoto');
const motorDoPedido = (o) => (o && typeof o === 'object') ? o.engine : o;
const remotoDaConta = (o) => (o && typeof o === 'object' && o.remoto != null)
  ? (typeof o.remoto === 'object' ? o.remoto : { invalido: true }) : null;
// Gestão de arquivos de login pelo Cockpit existe para Claude; os demais mantêm login no destino.
const MOTOR_COM_CONTA_REMOTA = { claude: true };
const SO_CLAUDE_NO_SERVIDOR = 'A gestão de credenciais deste motor é feita no terminal do servidor. Nenhuma credencial deste computador será alterada.';
const SERVIDOR_TORTO = 'Servidor desta aba está incompleto ou com endereço inválido. Edite a aba.';
const lugarDoServidor = (alvo) => alvo.usuario + '@' + (String(alvo.host).includes(':') ? '[' + String(alvo.host).replace(/^\[|\]$/g, '') + ']' : alvo.host) + (Number(alvo.porta || 22) === 22 ? '' : ':' + alvo.porta);

/* A conta do servidor custa uma ida ao servidor + um "claude auth status" la'.
   A tela pede de novo a cada troca de aba e a cada 5 min: guarda por host um
   pouco menos que isso, pra o relogio de 5 min sempre trazer dado novo. Pedido
   em voo e' reaproveitado (cartao e medidor pedem ao mesmo tempo). */
const PRAZO_CONTA_REMOTA = 290 * 1000;
const cacheContaRemota = new Map();   // usuario@host -> { t, valor }
const contaRemotaEmVoo = new Map();   // usuario@host -> Promise
/* a conta mudou (troca, login, logout): o que estava guardado sai, e uma leitura
   que ainda estava em voo -- comecou ANTES da mudanca -- nao pode voltar a
   guardar a conta velha quando chegar */
const versaoContaRemota = new Map();  // usuario@host -> numero
function esquecerContaRemota(alvo) {
  if (!alvo) return;
  const lugar = lugarDoServidor(alvo);
  cacheContaRemota.delete(lugar); contaRemotaEmVoo.delete(lugar);
  versaoContaRemota.set(lugar, (versaoContaRemota.get(lugar) || 0) + 1);
}

async function contaRemotaLer(remoto, fresco) {
  const alvo = normalizarRemoto(remoto);
  if (!alvo) return { entrou: false, erro: true, motivo: SERVIDOR_TORTO };
  const lugar = lugarDoServidor(alvo);
  const guardado = cacheContaRemota.get(lugar);
  if (!fresco && guardado && Date.now() - guardado.t < PRAZO_CONTA_REMOTA) return guardado.valor;
  if (!fresco && contaRemotaEmVoo.has(lugar)) return contaRemotaEmVoo.get(lugar);
  const versao = versaoContaRemota.get(lugar) || 0;
  const pedido = (async () => {
    const r = await execContaRemota(alvo, contasRemoto.scriptConta(), 45000);
    // falha de conexao NAO e' "nao esta logado": a tela mostra o motivo
    if (r.error) return { entrou: false, erro: true, motivo: r.error, lugar };
    const lido = contasRemoto.lerConta(r.out);
    // o token so' serve pra perguntar o limite; nunca entra no que vai pra tela
    const u = lido.token ? await usoComToken(lido.token) : null;
    const valor = { ...contaDoClaude(lido.status || {}, u), remoto: true, lugar };
    if (!lido.status) valor.motivo = lido.motivo;
    if ((versaoContaRemota.get(lugar) || 0) === versao) cacheContaRemota.set(lugar, { t: Date.now(), valor });
    return valor;
  })();
  contaRemotaEmVoo.set(lugar, pedido);
  try { return await pedido; } finally { if (contaRemotaEmVoo.get(lugar) === pedido) contaRemotaEmVoo.delete(lugar); }
}

const execContaRemota = (alvo, script, prazo) => execRemoto(alvo, 'exec ${SHELL:-/bin/sh} -lc ' + qLinux(script), prazo);
async function contasRemotas(acao, o) {
  const engine = motorDoPedido(o);
  if (!MOTOR_COM_CONTA_REMOTA[engine]) return acao === 'listar' ? [] : { error: SO_CLAUDE_NO_SERVIDOR };
  const alvo = normalizarRemoto(remotoDaConta(o));
  if (!alvo) return { error: SERVIDOR_TORTO };
  if (acao === 'listar') {
    const r = await execContaRemota(alvo, contasRemoto.scriptListar(), 20000);
    if (r.error) return { error: r.error };
    if (/COCKPIT_SEM_NODE|COCKPIT_ERRO_OPERACAO/.test(r.out)) return contasRemoto.lerResposta(r.out);
    const rows = contasRemoto.lerLista(r.out);
    try {
      const profiles = await accountComparison.profiles(engine, alvo, new AbortController().signal, Infinity);
      for (const row of rows) {
        const profile = profiles.find(p => p.apelido === row.apelido);
        if (!profile) continue;
        const state = accountComparison.profileState(engine, profile.credential, alvo);
        Object.assign(row, { podeUsar: state.podeUsar, precisaLogin: state.precisaLogin, motivo: state.motivo || '' });
      }
    } catch { return { error: 'Não foi possível validar o estado das contas do servidor.' }; }
    return rows;
  }
  if (acao === 'disponivel') {
    const r = await execContaRemota(alvo, contasRemoto.scriptDisponivel(), 20000);
    if (r.error) return { ok: false, error: r.error };
    return /COCKPIT_SEM_NODE|COCKPIT_ERRO_OPERACAO/.test(r.out) ? { ok: false, ...contasRemoto.lerResposta(r.out) } : { ok: /\bCOCKPIT_SIM\b/.test(r.out) };
  }
  const apelido = contasRemoto.apelidoValido(o && o.apelido);
  if (!apelido) return { error: acao === 'salvar' ? 'Dê um apelido para esta conta.' : 'Essa conta não está mais guardada.' };
  if (acao === 'salvar') {
    const r = await execContaRemota(alvo, contasRemoto.scriptSalvar(apelido), 20000);
    if (r.error) return { error: r.error };
    return contasRemoto.lerResposta(r.out, {
      COCKPIT_SEM_CONTA: 'Não achei uma conta logada no servidor para guardar.',
      COCKPIT_ERRO_PASTA: 'Não consegui criar a pasta das contas no servidor.',
      COCKPIT_ERRO_COPIA: 'Não consegui guardar a cópia no servidor.',
    });
  }
  if (acao === 'trocar') {
    try {
      const known = await accountComparison.validateSaved(engine, alvo, apelido);
      if (known && !known.podeUsar) return { error: known.motivo || 'Esta conta precisa de novo login.' };
    } catch { return { error: 'Não foi possível validar a conta guardada no servidor. A credencial não foi alterada.' }; }
    const r = await execContaRemota(alvo, contasRemoto.scriptTrocar(apelido), 20000);
    if (r.error) return { error: r.error };
    const res = contasRemoto.lerResposta(r.out, {
      COCKPIT_SEM_CONTA: 'Essa conta não está mais guardada no servidor.',
      COCKPIT_CORROMPIDA: 'O arquivo desta conta no servidor está corrompido — não vou trocar.',
      COCKPIT_ERRO_PASTA: 'Não consegui abrir a pasta da credencial no servidor.',
      COCKPIT_ERRO_TROCA: 'Não consegui trocar a credencial no servidor agora. Tente de novo.',
    });
    if (res.ok) esquecerContaRemota(alvo);
    return res;
  }
  if (acao === 'esquecer') {
    const r = await execContaRemota(alvo, contasRemoto.scriptEsquecer(apelido), 20000);
    if (r.error) return { error: r.error };
    return contasRemoto.lerResposta(r.out, { COCKPIT_ERRO: 'Não consegui apagar a cópia guardada no servidor.' });
  }
  return { error: 'ação desconhecida' };
}

ipcMain.handle('contas:disponivel', async (_e, o) => {
  const engine = motorDoPedido(o), remoto = remotoDaConta(o), caps = capacidadesConta(engine, remoto);
  if (remoto) {
    if (!caps.gerenciado) return { ...caps, ok: false };
    const result = await contasRemotas('disponivel', o);
    return { ...caps, ...result, salvar: caps.salvar && !!result.ok, trocar: caps.trocar && !result.error };
  }
  const ok = trocaDeContaDisponivel(engine);
  return { ...caps, ok, salvar: caps.salvar && ok };
});
ipcMain.handle('contas:listar', (_e, o) => {
  if (remotoDaConta(o)) return contasRemotas('listar', o);
  try { return credentialStore.list(motorDoPedido(o)); }
  catch { return { error: 'Não foi possível ler as contas guardadas.' }; }
});

/* o Codex mantem UM processo pra todos os paineis, com a credencial ja lida.
   Sem derrubar esse processo, trocar de conta nao muda nada.
   So' mata: quem limpa o estado e' o 'close' la de cima, que ja faz isso certo. */
ipcMain.handle('codex:reiniciar', async () => {
  observabilidade.encerrarMotor('codex', 'O servidor Codex está sendo reiniciado.');
  const p = codex.proc;
  if (!p) { codex.ready = null; codex.pronto = false; return { ok: true }; }
  let cancelarEspera;
  const caiu = new Promise((r) => {
    let terminou = false;
    const concluir = (fechado) => {
      if (terminou) return;
      terminou = true; clearTimeout(prazo); p.removeListener('close', fim); r(fechado);
    };
    const fim = () => concluir(true);
    const prazo = setTimeout(() => concluir(false), 4000);
    cancelarEspera = () => concluir(false);
    p.once('close', fim);
  });
  // de proposito: o 'close' avisa a tela sem "estava em turno", e nada religa sozinho
  codex.derrubando = p;
  for (const paneId of codex.paneToThread.keys()) vigiaTurno.desligar(paneId);
  try { matarProcesso(p); } catch { cancelarEspera(); }
  if (!await caiu) return { error: 'O Codex ainda não confirmou o encerramento. A conta não foi alterada. Aguarde e tente novamente.' };
  // Uma consulta de conta/modelos pode ter iniciado outro servidor durante o
  // close. Nunca apagar seus mapas nem anunciar que está parado nesse caso.
  if (codex.proc && codex.proc !== p) return { error: 'Outra consulta reabriu o Codex durante a troca. A conta não foi alterada. Tente novamente.' };
  if (codex.proc === p) codex.proc = null;
  codex.ready = null; codex.pronto = false;
  // O processo terminou de verdade: solta qualquer ouvinte remanescente.
  try { p.stdout.removeAllListeners('data'); } catch {}
  codex.paneToThread.clear(); codex.threadToPane.clear(); codex.paneTurn.clear(); codex.paneErrors?.clear(); codex.paneMsgId.clear();
  return { ok: true };
});

for (const [acao, method] of [['salvar', 'save'], ['trocar', 'change'], ['esquecer', 'forget']]) {
  ipcMain.handle('contas:' + acao, (_e, o) => {
    if (remotoDaConta(o)) return contasRemotas(acao, o);
    // Entre o pedido de parada e esta chamada uma consulta pode ter aberto
    // outro app-server. Nunca trocar o arquivo por baixo de um Codex vivo.
    if (acao === 'trocar' && o?.engine === 'codex' && codex.proc)
      return { error: 'O Codex voltou a abrir durante a troca. A conta não foi alterada. Tente novamente.' };
    try { return credentialStore[method](o?.engine, o?.apelido); }
    catch (e) { return { error: /EBUSY|EPERM|EACCES/.test(String(e.code))
      ? 'O arquivo da conta está em uso ou sem permissão. A operação não foi concluída.'
      : 'Não foi possível ' + acao + ' a conta. ' + (e.code ? '(' + e.code + ')' : e.message) }; }
  });
}

/* ---------- conta e limite de uso ---------- */
// Mac: Chaveiro. Windows: arquivo de credenciais. Detalhe em plataforma.js
const tokenDoClaude = () => {
  if (!EH_WIN && !buildEnv().CLAUDE_CONFIG_DIR) return plataforma.tokenClaude();
  const info = inspectCredential('claude', lerCredencial('claude'));
  return info.valido ? info.access : '';
};

/* O limite de uso vem da API com o token da conta. O do PC sai do arquivo (ou
   do Chaveiro) daqui; o do servidor o contaRemotaLer traz de la'. Em nenhum dos
   dois o token volta pra tela.
   A API de uso tem limite de chamadas: medido em 14/09, o token do PC levou
   429 com Retry-After de ~16 min e o medidor sumiu. Cartao e medidor pedem
   juntos, e agora a troca de aba tambem repinta: a resposta boa fica 60s
   guardada POR TOKEN (conta nova = token novo = leitura nova, sem precisar
   invalidar), e um 429 segura novas tentativas pelo tempo que a API pediu. */
const cacheUso = new Map();   // token -> { t, u }
/* Pela rede do Chromium (net.fetch), nao pelo fetch do Node: nesta maquina, em
   14/09, o fetch do Node falhou as vezes com "self-signed certificate in
   certificate chain" (o antivirus inspeciona HTTPS com certificado proprio) e o
   medidor sumia calado. O Chromium confia nos certificados do Windows, como o
   navegador. Sem Electron pronto (teste), cai no fetch de sempre. */
function buscarNaRede(url, opcoes) {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function' && app.isReady && app.isReady()) return net.fetch(url, opcoes);
  } catch (e) { logMain('uso:rede', e); }
  return fetch(url, opcoes);
}
async function usoComToken(t) {
  if (!t) return null;
  const guardado = cacheUso.get(t);
  // a API mandou esperar (429 + Retry-After): insistir so' estica o castigo
  if (guardado && guardado.ate && Date.now() < guardado.ate) return null;
  if (guardado && !guardado.ate && Date.now() - guardado.t < 60000) return guardado.u;
  try {
    const r = await buscarNaRede('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + t, 'anthropic-beta': 'oauth-2025-04-20' },
    });
    if (r.status === 429) {
      const retry = r.headers && r.headers.get && r.headers.get('retry-after');
      const seconds = retry != null && Number.isFinite(Number(retry)) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
      cacheUso.set(t, { t: Date.now(), u: null, ate: Date.now() + Math.max(30, Number.isFinite(seconds) ? seconds : 60) * 1000 });
      return null;
    }
    if (!r.ok) return null;
    const u = await r.json();
    if (cacheUso.size > 20) cacheUso.clear();
    cacheUso.set(t, { t: Date.now(), u });
    return u;
  } catch (e) { logMain('uso:conta', e); return null; }
}
function usoDoClaude() { return usoComToken(tokenDoClaude()); }

// o "claude auth status" + o uso, no formato que a tela desenha (PC e servidor)
function contaDoClaude(conta, u) {
  const janela = (x) => x ? { pct: Math.round(x.utilization || 0), reseta: x.resets_at ? Date.parse(x.resets_at) : 0 } : null;
  return {
    entrou: typeof conta.loggedIn === 'boolean' ? conta.loggedIn : null,
    email: conta.email || '',
    nome: (conta.orgName || '').replace(/'s Organization$/, '') || conta.email || '',
    plano: conta.subscriptionType || '',
    via: conta.authMethod || '',
    sessao: u ? janela(u.five_hour) : null,
    semana: u ? janela(u.seven_day) : null,
    extra: u && u.extra_usage ? {
      ligado: !!u.extra_usage.is_enabled,
      usado: u.extra_usage.used_credits || 0,
      teto: u.extra_usage.monthly_limit || 0,
      moeda: u.extra_usage.currency || '',
    } : null,
  };
}

ipcMain.handle('conta:ler', async (_e, o) => {
  if (remotoDaConta(o)) {
    if (motorDoPedido(o) === 'codex') { const r = await accountComparison.compare('codex', o.remoto, { forcar: !!o.fresco }); const a = r.contas.find(c => c.atual); return a ? { entrou: a.estado === 'ok' ? true : a.estado === 'login' ? false : null, ...a.dados, motivo: a.erro || '', remoto: true, lugar: r.onde } : { entrou: null, motivo: r.erro || r.aviso || 'Consumo indisponível neste servidor.', remoto: true }; }
    if (!MOTOR_COM_CONTA_REMOTA[motorDoPedido(o)]) return { entrou: null, motivo: SO_CLAUDE_NO_SERVIDOR, remoto: true };
    return contaRemotaLer(remotoDaConta(o), !!o.fresco);
  }
  const engine = motorDoPedido(o);
  if (engine === 'acp') {
    // nao da' pra conferir daqui: a conta e' do programa que o painel escolher
    return { entrou: null, nome: 'Agente ACP', motivo: 'A conta é a do próprio agente ACP, configurada no terminal dele; o Cockpit não confere daqui. Se ele pedir login, aparece no painel.' };
  }
  if (ehCli(engine)) {
    const cli = CLIS[engine];
    /* Nao da' pra saber daqui se a conta esta' logada sem rodar o motor. Entao
       so' afirmamos o que da' pra verificar: o programa existe. Dizer "entrou"
       sem checar era mentira -- e a lateral chegava a mostrar conta conectada
       com o Gemini deslogado. */
    return temBin(cli.bin)
      ? { entrou: null, instalado: true, email: '', nome: cli.nome, plano: '', motivo: 'Programa instalado; autenticação administrada no terminal.', via: 'a conta é a que você usa no terminal' }
      : { entrou: false, motivo: cli.nome + ' não está instalado nesta máquina.' };
  }
  if (engine === 'claude') {
    let conta = {};
    try { conta = JSON.parse((await rodar(claudeBin(), ['auth', 'status'], 25000)).out || '{}'); } catch {}
    return contaDoClaude(conta, await usoDoClaude());
  }

  await codexStart();
  let conta = {}, lim = {};
  try { conta = await codexReq('account/read', {}); } catch {}
  try { lim = await codexReq('account/rateLimits/read', {}); } catch {}
  const rl = (lim && lim.rateLimits) || {};
  const jan = (x) => x ? { pct: Math.round(x.usedPercent || 0), reseta: (x.resetsAt || 0) * 1000, mins: x.windowDurationMins || 0 } : null;
  const a = jan(rl.primary), b = jan(rl.secondary);
  const curta = [a, b].find(x => x && x.mins && x.mins <= 1440) || null;
  const longa = [a, b].find(x => x && x.mins && x.mins > 1440) || null;
  const c = (conta && conta.account) || {};
  return {
    entrou: c.type === 'apiKey' || c.type === 'api_key' || !!c.email,
    email: c.email || '',
    nome: c.email || '',
    plano: c.planType || rl.planType || '',
    via: c.type || '',
    sessao: curta,
    semana: longa,
    extra: rl.credits ? {
      ligado: !!rl.credits.hasCredits,
      usado: 0,
      teto: rl.credits.unlimited ? -1 : Number(rl.credits.balance || 0),
      moeda: 'créditos',
    } : null,
  };
});

/* Entrar/sair da conta NO SERVIDOR. Antes, o /login numa aba da VPS logava o
   PC (a VPS seguia na conta antiga) e o /logout deslogava o PC. Agora o
   terminal embutido abre um "ssh -t" que roda o "claude auth login" LA'; o link
   de login continua abrindo no navegador daqui (o terminal mostra o botao). */
async function authNoServidor(o) {
  const { engine, acao } = o || {};
  if (!MOTOR_COM_CONTA_REMOTA[engine]) return { error: SO_CLAUDE_NO_SERVIDOR };
  if (!['login', 'logout', 'status'].includes(acao)) return { error: 'ação desconhecida' };
  const alvo = normalizarRemoto(remotoDaConta(o));
  if (!alvo) return { error: SERVIDOR_TORTO };
  const lugar = lugarDoServidor(alvo);
  if (acao === 'status') {
    const r = await execContaRemota(alvo, contasRemoto.scriptStatus(), 45000);
    if (r.error) return { error: r.error };
    return { ...authenticationStatus(engine, r.out), texto: String(r.out || '').trim().slice(0, 800) };
  }
  const linha = contasRemoto.linhaTerminal(alvo, acao, EH_WIN);
  if (!linha) return { error: 'Um dos campos desta aba (usuário, host ou chave) tem caractere que não pode entrar num comando — normalmente aspas ou %. Confira em Editar aba.' };
  // a conta do servidor vai mudar: o que estava guardado dela nao vale mais
  esquecerContaRemota(alvo);
  return { terminal: linha, remoto: true,
           titulo: (acao === 'login' ? 'Entrar na conta do Claude no servidor ' : 'Sair da conta do Claude no servidor ') + lugar };
}

ipcMain.handle('auth:acao', async (_e, o) => {
  if (remotoDaConta(o)) return authNoServidor(o);
  const { engine, acao } = o || {};
  /* o codigo antigo caia em "codex" pra tudo que nao fosse claude: entrar ou
     SAIR da conta num painel Gemini rodava "codex login"/"codex logout" */
  if (engine === 'acp') return { error: 'A conta do agente ACP se resolve no terminal: rode o comando dele e entre por lá.' };
  if (ehCli(engine)) {
    return { error: 'A conta do ' + CLIS[engine].nome + ' se resolve no terminal: rode "' + CLIS[engine].bin + '" e entre por lá.' };
  }
  if (!['claude', 'codex'].includes(engine)) return { error: 'Motor desconhecido.' };
  const bin = engine === 'claude' ? claudeBin() : 'codex';
  const cmd = engine === 'claude'
    ? { login: 'auth login', logout: 'auth logout', status: 'auth status' }[acao]
    : { login: 'login', logout: 'logout', status: 'login status' }[acao];
  if (!cmd) return { error: 'ação desconhecida' };

  if (acao === 'status') {
    const r = await rodar(bin, cmd.split(' '), 25000);
    return authenticationStatus(engine, [r.out, r.errout].filter(Boolean).join('\n'), !!r.err);
  }
  // login e logout sao interativos: rodam no terminal embutido, dentro do Cockpit
  const alvo = engine === 'claude' ? claudeBin() : acharBin('codex');
  const linha = (/[ ()]/.test(alvo) ? '"' + alvo + '"' : alvo) + ' ' + cmd;
  return { terminal: linha,
           titulo: (acao === 'login' ? 'Entrar na conta do ' : 'Sair da conta do ') + (engine === 'claude' ? 'Claude' : 'Codex') };
});

ipcMain.handle('user:pickPhoto', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath: HOME,
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const f = r.filePaths[0];
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const b = fs.readFileSync(f);
    // a tela reduz pra 256 px antes de gravar (leva 41): o teto aqui so' evita
    // mandar um arquivo absurdo pela ponte
    if (b.length > 25 * 1024 * 1024) return { error: 'Imagem muito pesada (mais de 25 MB). Use uma menor.' };
    return { dataUrl: 'data:image/' + mime + ';base64,' + b.toString('base64') };
  } catch (e) { return { error: e.message }; }
});

const EXT_IMG = ['png','jpg','jpeg','gif','webp','bmp','heic','svg'];
/* O colar de verdade nasce na tela (app.js, evento "paste": arquivo com caminho ou os bytes da imagem
   pela ponte colarSalvarImagem). Isto aqui e' a RESERVA, quando o evento nao trouxe nada: o main le a
   area de transferencia sozinho. No Electron 44 o clipboard do main e' assincrono (read, readText,
   writeText e has devolvem Promise) e perdeu readImage, readBuffer e availableFormats; read() devolve
   ClipboardItems (types + getType -> Blob). Nenhum catch aqui fica calado: tudo vai pro tela.log. */
/* arquivos copiados no Explorer/Finder: o 44 entrega a lista inteira como text/uri-list (um file: por linha) */
async function arquivosColados() {
  const achados = [];
  try {
    const { fileURLToPath } = require('url');
    for (const item of (await clipboard.read()) || []) {
      if (!Array.from((item && item.types) || []).includes('text/uri-list')) continue;
      const lista = await (await item.getType('text/uri-list')).text();
      for (const linha of String(lista).split(/\r?\n/)) {
        const l = linha.trim();
        if (!/^file:/i.test(l)) continue;   // linha vazia, comentario (#) ou outro esquema
        try {
          const p = fileURLToPath(l);
          // \\servidor: o existsSync abaixo travaria o app ~21 s e o Windows tentaria SMB sozinho
          if (!ehCaminhoDeRede(p)) achados.push(p);
        } catch (e) { logMain('colar', e); }
      }
    }
  } catch (e) { logMain('colar', e); }
  return [...new Set(achados)].filter(f => fs.existsSync(f));
}
/* o print (Win+Shift+S) na area de transferencia: image/png, ou o formato bruto "PNG" do Windows */
async function pngDaAreaDeTransferencia() {
  for (const item of (await clipboard.read()) || []) {
    const tipos = Array.from((item && item.types) || []);
    const tipo = tipos.find(t => t === 'image/png') || tipos.find(t => /format="PNG"/i.test(t));
    if (!tipo) continue;
    const png = Buffer.from(await (await item.getType(tipo)).arrayBuffer());
    if (png.length) return png;
  }
  return null;
}

const EXT_VIS_IMG = ['png','jpg','jpeg','gif','webp','bmp','svg'];
const EXT_VIS_TXT = /^(txt|md|markdown|mdown|mkd|mdx|json|jsonc|js|jsx|mjs|cjs|ts|tsx|py|html|css|scss|csv|log|sh|ps1|yml|yaml|toml|xml|sql|rs|go|java|c|h|cpp|hpp|rb|php|htm|tsv|ini|cfg|bat|cmd)$/;
const TETO_VIS_IMG = 25 * 1024 * 1024;
const TETO_VIS_TXT = 600 * 1024;
const mimeDaImagem = (ext) => (ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext);
/* Bytes -> texto com o acento certo (UI 7.2-5). BOM UTF-8: sai (o .md perdia o 1o titulo). BOM UTF-16 LE/BE (o
   Out-File do PowerShell 5, o "Unicode" do Bloco de Notas): decodifica. Sem BOM: UTF-8 ESTRITO e, se nao for UTF-8
   valido, Windows-1252 (o CSV do Excel virava "Descri��o"). Byte nulo sem BOM UTF-16 = nao e' texto: null. */
function textoDosBytes(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
/* O que o leitor faz com o arquivo, pelo NOME (UI 7.2-3); o conteudo e o tamanho decidem depois. Texto: EXT_VIS_TXT,
   o .env.example e arquivo sem extensao (LEIAME, Makefile) -- com byte nulo vira 'outro' (textoDosBytes). Word e
   Excel: a tela diz "abra no programa". PDF: abre numa janela propria (pdf:abrir), nada e' lido aqui.
   Credencial (.env, .env.*, .npmrc, .git-credentials, .netrc, id_rsa/dsa/ecdsa/ed25519, *.pem, *.key, *.p12, *.pfx):
   'credencial', decidido pelo NOME antes de qualquer leitura -- o arquivo sem extensao abre como texto e esses nomes
   (.env, id_rsa...) sao exatamente assim. So' o .env.example (modelo, sem valor) segue como texto. */
const EXT_VIS_DOC = ['docx', 'xlsx'];
function tipoDoVisor(nome, ext) {
  const segredo = /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519))$|\.(?:pem|key|p12|pfx)$/i;
  if (segredo.test(nome) && !/^\.env\.example$/i.test(nome)) return 'credencial';
  if (EXT_VIS_IMG.includes(ext)) return 'imagem';
  if (!ext || EXT_VIS_TXT.test(ext) || /^\.env\.example$/i.test(nome)) return 'texto';
  if (ext === 'pdf') return 'pdf';
  return EXT_VIS_DOC.includes(ext) ? 'documento' : 'outro';
}

/* Caminho de rede (\\servidor, //servidor, /\servidor). stat/openPath num caminho assim trava o processo
   principal ~21 s com o servidor fora do ar e, com ele no ar, faz o Windows tentar autenticar por SMB (o hash
   da senha vai junto). A tela ja' nao monta link assim (file-links.js); esta e' a segunda trava: arquivo:ver,
   shell:open e shell:link recusam ANTES de encostar no disco. */
const MSG_CAMINHO_DE_REDE = 'Caminho de rede bloqueado por segurança.';
const ehCaminhoDeRede = (p) => /^[\\/]{2}/.test(String(p || '').trim());

function verArquivoLocal(file) {
  // a tela do visor le' "erro"; "error" e' o nome que shell:open e shell:link usam
  if (ehCaminhoDeRede(file)) return { erro: MSG_CAMINHO_DE_REDE, error: MSG_CAMINHO_DE_REDE, path: file, nome: path.basename(String(file)) };
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    // pasta nao e' arquivo: continua 'outro' (sem extensao ela passaria por texto)
    const tipo = st.isFile() ? tipoDoVisor(base.nome, ext) : 'outro';
    const teto = tipo === 'imagem' ? TETO_VIS_IMG : tipo === 'texto' ? TETO_VIS_TXT : 0;
    if (teto && st.size > teto) {
      // o problema e' o TAMANHO, nao o tipo: a tela diz "Grande demais para o leitor (725 KB; limite 600 KB)" (UI 7.2-5)
      base.tipo = 'grande';
      base.limite = teto;
    } else if (tipo === 'imagem') {
      base.tipo = 'imagem';
      base.dados = 'data:image/' + mimeDaImagem(ext) + ';base64,' + fs.readFileSync(file).toString('base64');
    } else if (tipo === 'texto') {
      const texto = textoDosBytes(fs.readFileSync(file));
      base.tipo = texto === null ? 'outro' : 'texto';
      if (texto !== null) base.dados = texto;
    } else {
      base.tipo = tipo;   // 'pdf', 'documento' ou 'outro': nada e' lido
    }
    return base;
  } catch (e) { return { erro: e.message, path: file, nome: path.basename(file) }; }
}

/* O mesmo arquivo, mas no servidor. Um comando so': confere que existe, diz o
   tamanho e - so' se couber no MESMO teto do ramo local - manda o conteudo em
   base64 (que serve pra imagem e pra texto; o acento sai do textoDosBytes, como
   no ramo local). Quem nao cabe volta como 'grande' (com o limite), e quem nao
   e' de um tipo que a tela abre volta com o tipo dele ('pdf', 'documento',
   'outro'), sem gastar rede. O "exit 0" no fim e' o que impede um "nao cabe" de
   virar codigo de erro e ser lido como falha de conexao. */
async function verArquivoRemoto(remoto, file, tetoImagem = TETO_VIS_IMG) {   // tetoImagem: a imagem do .md pede 10 MB, o visor segue com 25
  const alvo = String(file || '');
  const nome = path.posix.basename(alvo);
  if (!alvo) return { erro: 'Faltou o caminho do arquivo.', path: alvo, nome };
  const ext = path.posix.extname(alvo).slice(1).toLowerCase();
  const tipo = tipoDoVisor(nome, ext);
  const ehImg = tipo === 'imagem';
  const teto = ehImg ? tetoImagem : tipo === 'texto' ? TETO_VIS_TXT : 0;
  const q = qRemoto(alvo);
  const script = '[ -e ' + q + ' ] || { echo COCKPIT_SEM_ARQUIVO; exit 0; }; '
    + 't=$(stat -c %s -- ' + q + ' 2>/dev/null || echo -1); '
    + "printf 'COCKPIT_TAM %s\\n' \"$t\"; "
    + (teto > 0 ? '[ -f ' + q + ' ] && [ "$t" -ge 0 ] && [ "$t" -le ' + teto + ' ] && base64 -w0 -- ' + q + '; ' : '')
    + 'exit 0';
  const r = await execRemoto(remoto, script, 60000);
  if (r.error) return { erro: r.error, path: alvo, nome };
  const bruto = String(r.out || '');
  if (bruto.startsWith('COCKPIT_SEM_ARQUIVO')) {
    return { erro: 'Não achei este arquivo no servidor.', path: alvo, nome };
  }
  const quebra = bruto.indexOf('\n');
  const bytes = Number(((quebra >= 0 ? bruto.slice(0, quebra) : bruto).match(/^COCKPIT_TAM\s+(-?\d+)/) || [])[1]);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return { erro: 'Não consegui ler este arquivo no servidor.', path: alvo, nome };
  }
  const b64 = quebra >= 0 ? bruto.slice(quebra + 1).trim() : '';
  const base = { path: alvo, nome, ext, bytes };
  /* Arquivo de ZERO byte nao imprime nada no "base64 -w0": o pacote vem vazio
     porque o arquivo e' vazio, nao porque o tipo e' desconhecido. Antes isso
     virava 'outro' e a tela dizia "Este tipo nao abre aqui dentro" para um .txt
     em branco -- enquanto o ramo local mostra um <pre> vazio. Agora empatam.
     A distincao que sustenta isso: quem manda e' o TAMANHO que o servidor disse.
       - pacote vazio com tamanho 0  -> conteudo vazio (texto vazio, como local);
       - pacote vazio com tamanho > 0 -> nao e' arquivo comum ou o base64 nao
         rodou: continua 'outro', que nada afirma (o que nao coube no teto vira
         'grande', com o limite: o problema e' o tamanho, UI 7.2-5);
       - resposta sem tamanho nenhum (stat falhou, ssh mudo) ja' virou ERRO la'
         em cima, e continua sendo. Falha nunca vira "arquivo vazio". */
  if (teto === 0) { base.tipo = tipo; return base; }   // 'pdf', 'documento' ou 'outro': nada foi baixado
  if (bytes > teto) { base.tipo = 'grande'; base.limite = teto; return base; }
  if (!b64 && bytes > 0) { base.tipo = 'outro'; return base; }
  if (ehImg) {
    base.tipo = 'imagem';
    base.dados = 'data:image/' + mimeDaImagem(ext) + ';base64,' + b64;
    return base;
  }
  let texto;
  try { texto = textoDosBytes(Buffer.from(b64, 'base64')); }
  catch { return { erro: 'A resposta do servidor veio corrompida.', path: alvo, nome }; }
  // byte nulo: binario (arquivo sem extensao que nao e' texto), como no ramo local
  if (texto === null) { base.tipo = 'outro'; return base; }
  base.tipo = 'texto';
  base.dados = texto;
  return base;
}

/* PDF do leitor (UI 7.2-3): abre numa janela PROPRIA, com o visualizador de PDF do Chromium. A janela e' presa:
   sandbox, contextIsolation, sem preload e sem Node (o PDF nao alcanca o window.api nem o disco). Ela carrega so'
   o arquivo pedido; janela nova, navegacao (link dentro do PDF) e <webview> sao recusados. Subframe so' navega pro
   proprio visualizador -- desde o Electron 41 ele mora num subframe chrome-extension:// e, travado, o PDF nao abre
   (conferido no 44.5.1, com janela oculta) -- e pro PDF pedido. Fecha junto com a janela do Cockpit. */
const MSG_PDF_SEM_VISUALIZADOR = 'O visualizador de PDF não está disponível aqui.';
const MSG_PDF_FALHOU = 'Não consegui abrir este PDF aqui.';
const VISUALIZADOR_PDF = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
function opcoesJanelaPdf(nome) {
  return {
    title: nome, width: 960, height: 760, minWidth: 420, minHeight: 320, show: false, autoHideMenuBar: true,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false, webviewTag: false, spellcheck: false,
    },
  };
}
function travarJanelaPdf(wc, url) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
  // link pra fora (http, outro arquivo, \\servidor) nao navega nem dentro do quadro do visualizador
  wc.on('will-frame-navigate', (e) => {
    const destino = String(e.url || '');
    if (!e.isMainFrame && !destino.startsWith(VISUALIZADOR_PDF) && destino.split('#')[0] !== url) e.preventDefault();
  });
}
/* Sem o visualizador, o Chromium BAIXA o PDF em vez de mostrar: o loadURL falha e o will-download chega logo
   depois. Ate' o PDF aparecer, download desta janela e' cortado (nada de "Salvar como") e vira o aviso; depois,
   o botao de baixar do proprio visualizador volta a valer. */
async function abrirPdfNaJanela(arquivo) {
  const url = require('url').pathToFileURL(arquivo).href;
  const janela = new BrowserWindow(opcoesJanelaPdf(path.basename(arquivo)));
  const wc = janela.webContents, ses = wc.session;
  travarJanelaPdf(wc, url);
  let aberto = false, baixou = false;
  const aoBaixar = (e, _item, quem) => { if (quem === wc && !aberto) { e.preventDefault(); baixou = true; } };
  ses.on('will-download', aoBaixar);
  // aberta depois do Cockpit fechar, ela seguraria o app vivo (e o atalho nao reabriria a janela principal)
  const principal = win;
  const fecharJunto = () => { if (!janela.isDestroyed()) janela.close(); };
  if (principal) principal.once('closed', fecharJunto);
  janela.once('closed', () => {
    ses.removeListener('will-download', aoBaixar);
    if (principal) principal.removeListener('closed', fecharJunto);
  });
  try {
    await janela.loadURL(url);
    aberto = true;
    janela.show();
    return { ok: true };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 800));   // o will-download chega depois da falha do loadURL
    if (!janela.isDestroyed()) janela.destroy();
    if (baixou) return { error: MSG_PDF_SEM_VISUALIZADOR };
    logMain('pdf:abrir', e);
    return { error: MSG_PDF_FALHOU };
  }
}
async function abrirPdf(arquivo) {
  const s = String(arquivo || '');
  // caminho de rede: recusado ANTES de qualquer fs.* (R5-01), como no arquivo:ver
  if (ehCaminhoDeRede(s)) return { error: MSG_CAMINHO_DE_REDE };
  if (!path.isAbsolute(s) || path.extname(s).toLowerCase() !== '.pdf') return { error: 'Só abro PDF deste computador.' };
  let arquivoComum = false;
  try { arquivoComum = fs.statSync(s).isFile(); } catch {}
  if (!arquivoComum) return { error: 'Não achei este PDF.' };
  try { return await abrirPdfNaJanela(s); }
  catch (e) { logMain('pdf:abrir', e); return { error: MSG_PDF_FALHOU }; }
}
ipcMain.handle('pdf:abrir', (_e, arquivo) => abrirPdf(arquivo));

/* Aceita as duas formas: a string de sempre (o preload e' superficie publica) e
   { file, remoto }. Quem manda o 'remoto' e' a TELA, painel por painel -- de
   proposito, porque anexo colado mora aqui no PC mesmo quando o painel e'
   remoto, e so' o chamador sabe a diferenca. */
const readerComments = require('./reader-comments').createStore({ directory: () => path.join(app.getPath('userData'), 'reader-comments') });
ipcMain.handle('arquivo:ver', async (_e, f) => {
  const o = (f && typeof f === 'object') ? f : { file: f };
  const rem = remotoDoPedido(o);
  const result = rem ? await verArquivoRemoto(rem, o.file) : verArquivoLocal(o.file);
  if (result.tipo === 'texto' && typeof result.dados === 'string') {
    try { result.document = readerComments.registerDocument(result.path || o.file, rem, result.dados); }
    catch { result.annotationError = 'Não consegui identificar este documento para guardar anotações.'; }
  }
  return result;
});
ipcMain.handle('reader-comments:get', (_e, document) => readerComments.get(document));
ipcMain.handle('reader-comments:save', (_e, input) => readerComments.save(input));

ipcMain.handle('clipboard:anexos', async () => {
  const arquivos = await arquivosColados();
  if (arquivos.length) return { arquivos };
  try {
    const png = await pngDaAreaDeTransferencia();
    if (png) {
      const dir = path.join(app.getPath('userData'), 'colados');
      fs.mkdirSync(dir, { recursive: true });
      const nome = 'colado-' + Date.now() + '.png';
      const destino = path.join(dir, nome);
      fs.writeFileSync(destino, png);
      return { arquivos: [destino] };
    }
  } catch (e) { logMain('colar', e); }
  return { arquivos: [] };
});

/* texto da area de transferencia pro terminal embutido (colar o codigo do
   login / copiar o que foi marcado). Pelo main: o navigator.clipboard do
   renderer depende da janela estar em foco. */
/* teto de 1 MB: um texto gigante copiado sem querer travaria o terminal (e o
   pty) colando por minutos. Acima disso recusa e a tela avisa. */
/* No 44 o readText devolve Promise: sem o await o main mandava a Promise pelo IPC ("could not be
   cloned") e o colar no terminal embutido morria. O canal devolve sempre texto, nunca a Promise. */
async function lerTextoCopiado(ler) {
  let t = '';
  try { t = (await ler()) || ''; } catch (e) { logMain('clipboard:texto', e); t = ''; }
  if (typeof t !== 'string') { logMain('clipboard:texto', 'readText devolveu ' + typeof t + ' em vez de texto'); t = ''; }
  if (t.length > 1024 * 1024) return { texto: '', erro: 'grande' };
  return { texto: t };
}
ipcMain.handle('clipboard:texto', () => lerTextoCopiado(() => clipboard.readText()));
// o writeText tambem e' assincrono no 44: sem o await este canal dizia "copiado" antes de gravar (e o erro sumia)
ipcMain.handle('clipboard:copiar', async (_e, t) => {
  if (typeof t !== 'string' || !t) return false;
  try { await clipboard.writeText(t.slice(0, 1000000)); return true; } catch (e) { logMain('clipboard:copiar', e); return false; }
});

/* A tela le os bytes da imagem colada (o File do evento "paste" nao tem caminho no disco) e manda pra ca;
   o main so' grava em colados/ (mesma limpeza de 7 dias) e devolve o caminho. So' png, jpeg, webp e gif,
   ate' 25 MB. Nao depende do clipboard do Electron. */
const IMAGEM_COLADA_EXT = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
const IMAGEM_COLADA_TETO = 25 * 1024 * 1024;
ipcMain.handle('colar:salvar-imagem', (_e, bytes, tipo) => {
  try {
    const ext = IMAGEM_COLADA_EXT.get(String(tipo || '').toLowerCase());
    if (!ext) return { error: 'Formato de imagem não aceito (use png, jpg, webp ou gif).' };
    // ArrayBuffer ou Uint8Array, como chegarem pelo IPC; Buffer.from nao copia (o teto vale antes de gravar)
    const dados = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : (Object.prototype.toString.call(bytes) === '[object ArrayBuffer]' ? Buffer.from(bytes) : null);
    if (!dados || !dados.length) return { error: 'A imagem veio vazia.' };
    if (dados.length > IMAGEM_COLADA_TETO) return { error: 'Imagem muito pesada (mais de 25 MB). Use uma menor.' };
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    // dois prints no mesmo milissegundo nao se sobrescrevem
    let ts = Date.now(), destino;
    while (fs.existsSync(destino = path.join(dir, 'colado-' + ts + '.' + ext))) ts++;
    fs.writeFileSync(destino, dados);
    return { arquivo: destino };
  } catch (e) { logMain('colar', e); return { error: String(e && e.message || e) }; }
});

ipcMain.handle('anexo:ler', (_e, file) => {
  /* Anexar (colar do Explorer, arrastar ou o +) termina aqui: o statSync num \\servidor trava o app ~21 s e o
     Windows tenta autenticar por SMB. Recusa ANTES de encostar no disco, com o mesmo texto do arquivo:ver (R5-01).
     "erro" e' o nome que este canal ja' usava; "error", o dos outros canais (shell:open, shell:link). */
  if (ehCaminhoDeRede(file)) return { erro: MSG_CAMINHO_DE_REDE, error: MSG_CAMINHO_DE_REDE, path: file, nome: path.basename(String(file)) };
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    if (EXT_IMG.includes(ext) && st.size <= 8 * 1024 * 1024) {
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      base.mini = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    }
    return base;
  } catch (e) { return { path: file, nome: path.basename(file), erro: e.message }; }
});

/* Imagem dentro de um .md aberto no leitor (UI 7.2-4). A CSP da tela so' aceita img-src 'self' data: e NAO abre
   pra https: quem busca e' o main, que devolve a imagem como data:. Dois pedidos, os dois com teto de 10 MB:
   - { arquivo }: a tela ja' resolveu o src relativo a partir da PASTA DO DOCUMENTO. Le' aqui no PC (assincrono: o
     Drive do G: pode demorar e o main nao trava) ou, com 'remoto', no servidor pelo mesmo canal do arquivo:ver,
     ja' com o teto de 10 MB no pedido (o servidor nao manda o que passa disso);
   - { url }: so' https, pelo net.request (a rede do Chromium), 10 s no total, sem cookie, content-type image/*. A tela
     so' pede isto DEPOIS de um clique (abrir o .md nao faz GET sozinho em endereco escolhido por quem o escreveu). Cada
     salto de redirecionamento passa pela mesma conferencia do 1o endereco (https, sem login, sem host privado: quem
     escreve o .md nao faz o PC buscar o roteador, um servico local ou a nuvem de metadados) e sao no maximo 5.
   Caminho de rede (\\servidor, //servidor, file://servidor) e' recusado ANTES de qualquer fs.* e do ssh, como no
   arquivo:ver. Falha vira { erro } curto: a tela troca a imagem por "imagem nao carregou" e o documento segue. */
const TETO_IMG_DOC = 10 * 1024 * 1024;
const TEMPO_IMG_WEB = 10000;
const ERRO_IMG_GRANDE = 'Imagem maior que 10 MB.';
const MAX_SALTOS_IMG = 5;

/* Host que NAO e' da internet publica. Recebe o hostname do new URL(), que ja' normaliza 2130706433 e 0x7f.1 pra
   127.0.0.1 e escreve o IPv6 comprimido e em minusculo (entre colchetes: aqui saem). Recusa: localhost, *.localhost,
   *.local, *.internal, host sem ponto; IPv4 em 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12 e 192.168/16; IPv6 em
   0000::/8 (:: , ::1 e o IPv4 mapeado ::ffff:), fc00::/7 e fe80::/10. NAO resolve DNS: um nome publico que aponta pra
   dentro (tipo nip.io) passa -- mas so' vira imagem se o certificado https dele for valido e a resposta for image/*. */
function hostPrivado(host) {
  let h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.replace(/\.+$/, '');   // "localhost." e' o mesmo localhost
  if (!h) return true;
  if (h.includes(':')) return h.startsWith('::') || /^[0-9a-f]{1,2}:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return !h.includes('.') || /\.(?:localhost|local|internal)$/.test(h);
}

/* O endereco (um URL) que o main aceita buscar, no 1o pedido e em CADA salto: https, sem login e com host publico.
   Devolve o motivo da recusa, ou '' se pode. */
function recusaDoEnderecoDaWeb(alvo) {
  if (alvo.protocol !== 'https:' || !alvo.hostname || alvo.username || alvo.password) return 'Só imagens por https são buscadas.';
  if (hostPrivado(alvo.hostname)) return 'Endereço de rede interna: a imagem não é buscada.';
  return '';
}

async function imagemDaWeb(url, tempo = TEMPO_IMG_WEB) {
  let alvo;
  try { alvo = new URL(String(url)); } catch { return { erro: 'Endereço da imagem inválido.' }; }
  const recusa = recusaDoEnderecoDaWeb(alvo);
  if (recusa) return { erro: recusa };
  return new Promise((resolve) => {
    const partes = [];
    let total = 0, saltos = 0, req = null, fim = false, relogio = null;
    // um resultado so': o primeiro que chegar (imagem, erro, recusa ou o relogio) encerra e corta o pedido
    const acabar = (r) => {
      if (fim) return;
      fim = true;
      clearTimeout(relogio);
      if (req) { try { req.abort(); } catch {} }   // resposta que nao foi lida (status ruim, nao e' imagem, grande demais) nao segura a conexao aberta
      resolve(r);
    };
    relogio = setTimeout(() => acabar({ erro: 'A imagem demorou mais de 10 s.' }), tempo);   // o mesmo relogio vale pro caminho todo: saltos, cabecalhos e corpo
    try {
      req = require('electron').net.request({ method: 'GET', url: alvo.href, redirect: 'manual', credentials: 'omit' });
      req.setHeader('accept', 'image/*');
      /* redirect 'manual': o Electron so' segue se o followRedirect() vier AQUI, sincrono, de dentro do evento; sem ele
         (ou com abort) o pedido para. O destino passa pela MESMA conferencia do 1o endereco antes de qualquer pedido. */
      req.on('redirect', (_status, _metodo, destino) => {
        if (fim) return;
        let proximo;
        try { proximo = new URL(String(destino)); } catch { acabar({ erro: 'Endereço da imagem inválido.' }); return; }
        const motivo = ++saltos > MAX_SALTOS_IMG ? 'A imagem passou por redirecionamentos demais.' : recusaDoEnderecoDaWeb(proximo);
        if (motivo) {
          logMain('arquivo:imagemMd', new Error('redirecionamento recusado: ' + proximo.hostname + ' (' + motivo + ')'));   // so' o host: caminho e query podem ter segredo
          acabar({ erro: motivo });
          return;
        }
        req.followRedirect();
      });
      req.on('response', (res) => {
        if (fim) return;
        const status = res.statusCode;
        if (status < 200 || status > 299) { acabar({ erro: 'O site respondeu ' + status + '.' }); return; }
        const tipo = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!/^image\/[a-z0-9][a-z0-9.+-]*$/.test(tipo)) { acabar({ erro: 'O endereço não devolveu uma imagem.' }); return; }
        if (Number(res.headers['content-length']) > TETO_IMG_DOC) { acabar({ erro: ERRO_IMG_GRANDE }); return; }
        res.on('data', (pedaco) => {
          if (fim) return;
          total += pedaco.length;
          // o content-length pode faltar ou mentir: conta o que chega e para de ler no teto
          if (total > TETO_IMG_DOC) { acabar({ erro: ERRO_IMG_GRANDE }); return; }
          partes.push(pedaco);
        });
        res.on('end', () => acabar(total
          ? { dados: 'data:' + tipo + ';base64,' + Buffer.concat(partes).toString('base64'), bytes: total }
          : { erro: 'A resposta veio sem conteúdo.' }));
        res.on('error', (e) => { if (fim) return; logMain('arquivo:imagemMd', e); acabar({ erro: 'Não consegui buscar a imagem.' }); });
        res.on('close', () => acabar({ erro: 'A conexão caiu antes de a imagem chegar.' }));   // depois do 'end' o resultado ja' saiu: nao muda nada
      });
      req.on('error', (e) => { if (fim) return; logMain('arquivo:imagemMd', e); acabar({ erro: 'Não consegui buscar a imagem.' }); });
      req.end();
    } catch (e) {
      logMain('arquivo:imagemMd', e);
      acabar({ erro: 'Não consegui buscar a imagem.' });
    }
  });
}

async function imagemDoDocumento(o) {
  const url = o && typeof o.url === 'string' ? o.url.trim() : '';
  const arquivo = o && typeof o.arquivo === 'string' ? o.arquivo.trim() : '';
  if ((url && arquivo) || (!url && !arquivo)) return { erro: 'Faltou o endereço da imagem.' };   // um dos dois, nunca os dois
  if (url) return imagemDaWeb(url);
  // rede ANTES de qualquer fs.* e do ssh (o tab no meio do caminho nao esconde o "//": controle e' recusado)
  if (/[\u0000-\u001f\u007f]/.test(arquivo)) return { erro: 'Caminho da imagem inválido.' };
  if (ehCaminhoDeRede(arquivo) || /^file:\/\/[^/]/i.test(arquivo)) return { erro: MSG_CAMINHO_DE_REDE };
  const ext = path.extname(arquivo).slice(1).toLowerCase();
  if (!EXT_VIS_IMG.includes(ext)) return { erro: 'Só arquivo de imagem aparece aqui.' };
  const rem = remotoDoPedido(o);
  // so' a PRESENCA do remoto decide: um remoto torto e' erro, nunca uma volta calada pro disco daqui
  if (o.remoto && !rem) return { erro: 'Servidor desta aba está incompleto. Edite a aba.' };
  if (rem) {
    if (!/^(?:\/|~\/)/.test(arquivo)) return { erro: 'Caminho da imagem inválido.' };
    // o teto de 10 MB vai no pedido: o servidor nao manda o que passa disso (antes baixava ate' 25 MB pra so' depois recusar)
    const r = await verArquivoRemoto(rem, arquivo, TETO_IMG_DOC);
    if (r.erro) return { erro: r.erro };
    if (r.tipo === 'grande') return { erro: ERRO_IMG_GRANDE };
    if (r.tipo !== 'imagem' || typeof r.dados !== 'string') return { erro: 'A imagem não veio do servidor.' };
    if (r.bytes > TETO_IMG_DOC) return { erro: ERRO_IMG_GRANDE };
    return { dados: r.dados, bytes: r.bytes };
  }
  if (!path.isAbsolute(arquivo)) return { erro: 'Caminho da imagem inválido.' };
  try {
    const st = await fs.promises.stat(arquivo);
    if (!st.isFile()) return { erro: 'Isso não é um arquivo de imagem.' };
    if (st.size > TETO_IMG_DOC) return { erro: ERRO_IMG_GRANDE };
    const dados = await fs.promises.readFile(arquivo);
    if (dados.length > TETO_IMG_DOC) return { erro: ERRO_IMG_GRANDE };   // cresceu depois do stat
    return { dados: 'data:image/' + mimeDaImagem(ext) + ';base64,' + dados.toString('base64'), bytes: dados.length };
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { erro: 'Não achei a imagem.' };
    throw e;
  }
}

ipcMain.handle('arquivo:imagemMd', async (_e, o) => {
  try { return await imagemDoDocumento(o); }
  catch (e) { logMain('arquivo:imagemMd', e); return { erro: 'Não consegui carregar a imagem.' }; }
});

ipcMain.handle('dialog:pickFiles', async (_e, kind) => {
  const opt = { properties: ['multiSelections'], defaultPath: HOME };
  if (kind === 'folder') opt.properties = ['openDirectory'];
  else opt.properties.push('openFile');
  if (kind === 'image') opt.filters = [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'] }];
  const r = await dialog.showOpenDialog(win, opt);
  return r.canceled ? [] : r.filePaths;
});

/* Vigia do arquivo aberto no leitor (Leva 2, Task 5). A tela pede ('arquivo:vigiar') quando abre um arquivo LOCAL e
   manda parar ('arquivo:vigiar-parar') ao fechar o visor, ao trocar de documento e quando o painel morre; o
   shutdown() solta tudo quando a tela recarrega, cai ou fecha. O aviso volta pelo canal 'arquivo:mudou'. A regra
   (so' arquivo local, nunca de rede, debounce de 300 ms) esta em src/vigia-arquivo.js. */
const vigiaDoLeitor = require('./vigia-arquivo').criarVigia({
  fs, ehCaminhoDeRede, log: logMain,
  avisar: (aviso) => { if (win && !win.isDestroyed()) win.webContents.send('arquivo:mudou', aviso); },
});
ipcMain.handle('arquivo:vigiar', (_e, pedido) => {
  const o = (pedido && typeof pedido === 'object') ? pedido : {};
  // arquivo de servidor nao existe neste disco (o mesmo caminho pode existir aqui, por acaso): nunca vigiado
  if (o.remoto) return { ok: false, motivo: 'servidor' };
  return vigiaDoLeitor.vigiar(o.chave, o.arquivo);
});
ipcMain.handle('arquivo:vigiar-parar', (_e, chave) => {
  return { ok: vigiaDoLeitor.parar(chave) };
});

/* ======================= janela ======================= */
/* fundo de cada tema (o --bg do style.css / motti-brand.css): a janela nasce na
   cor do tema salvo, em vez de sempre escura -- quem usa Claro/Jornal via piscar */
const FUNDO_DO_TEMA = { escuro: '#1e1e1e', claro: '#ffffff', jornal: '#fdf6e3', motti: '#07182f', azul: '#07182f' };
const visualMacNative = createVisualMacNative({
  app, ipcMain, Menu, nativeTheme, systemPreferences, nativeImage,
  getWindow: () => win, loadConfig, saveConfig, log: logMain,
});
visualMacNative.install();
app.on('will-quit', () => visualMacNative.dispose());
function temaSalvo() {
  const t = (loadConfig() || {}).tema;
  return t === 'motti' ? 'azul' : t === 'automatico' || FUNDO_DO_TEMA[t] ? t : 'escuro';
}
function createWindow() {
  visualMacNative.syncConfig(loadConfig());
  win = new BrowserWindow({
    title: JANELA_DE_TESTE ? TITULO_JANELA_DE_TESTE : 'Cockpit',
    icon: path.join(__dirname, 'assets', EH_WIN ? 'icon.ico' : 'icon.png'),
    ...(EH_WIN && app.isPackaged ? { show: false } : {}),
    width: 1500, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: FUNDO_DO_TEMA[temaSalvo()] || (nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7'),
    // Windows mantém os botões nativos e o Snap; Mac mantém hiddenInset.
    ...visualMacNative.windowOptions(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      // janela de teste: o preload le esta flag em process.argv e entrega window.api.janelaDeTeste a tela (faixa vermelha e envio barrado)
      ...(JANELA_DE_TESTE ? { additionalArguments: ['--cockpit-janela-teste'] } : {}) },
  });
  // o titulo da janela de teste nao e' trocado pelo da pagina (<title>Cockpit</title>)
  if (JANELA_DE_TESTE) win.on('page-title-updated', (e) => e.preventDefault());
  ipcSecurity.installSession(win.webContents.session);
  visualMacNative.attachWindow();
  if (EH_WIN && app.isPackaged) {
    // Antes de mostrar, informa ao Windows o ícone e o executável reais.
    // Evita que um atalho antigo Electron.lnk forneça a identidade da barra.
    try {
      win.setAppDetails({
        appId: WINDOWS_APP_ID,
        appIconPath: process.execPath,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}"`,
        relaunchDisplayName: 'Cockpit',
      });
    } catch (err) { console.warn('Não foi possível registrar o ícone da barra de tarefas:', err.message); }
    win.show();
  }
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // recarregar a tela (Ctrl+R) recomeca os ids dos paineis; sem isso os
  // processos e terminais da sessao anterior ficavam orfaos rodando
  win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    // isInPlace = pulo de ancora (#secao) dentro da propria pagina: NAO e' recarga.
    // Sem esta checagem, clicar num "[ir pro topo](#x)" que o modelo escreveu
    // derrubava todos os paineis de uma vez.
    if (isMainFrame && !isInPlace) shutdown();
  });
  /* Leva 41 (B2): a tela caiu (falta de memoria, erro do Chromium). Antes nada
     tratava isso: a janela ficava branca e os motores seguiam sem ninguem
     ouvindo. Agora fica registrado e a tela volta sozinha; o shutdown anota
     quem estava em turno e a tela nova religa esses paineis. */
  win.webContents.on('render-process-gone', (_e, d) => {
    const motivo = (d && d.reason) || '?';
    registrarQueda({ motor: 'tela', tipo: 'tela-caiu', motivo, codigo: d && d.exitCode != null ? d.exitCode : null });
    if (motivo === 'clean-exit') return;
    shutdown();
    setTimeout(() => { try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch (e) { logMain('tela:recarregar', e); } }, 800);
  });
  win.on('unresponsive', () => registrarQueda({ motor: 'tela', tipo: 'tela-travou' }));
  win.on('responsive', () => registrarQueda({ motor: 'tela', tipo: 'tela-voltou' }));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // clicar num link NUNCA troca a tela do app - nem pra arquivo local.
  // (navegar pra um html local reinjetaria o preload nele, dando acesso
  //  ao window.api inteiro, que sabe rodar comando)
  const barraNavegacao = (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', barraNavegacao);
  win.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame) e.preventDefault(); });
  win.on('closed', () => { win = null; shutdown(); });
}

function shutdown() {
  /* Leva 41 (B2): antes de matar, anota quem estava NO MEIO de um turno. Na
     proxima tela (recarga, tela que caiu ou app reaberto em ate' 2 h) esses
     paineis religam e pedem pra continuar. Chamado varias vezes seguidas
     (closed + window-all-closed + before-quit), nao duplica: depois do primeiro
     os motores ja foram parados de proposito e a lista sai vazia. */
  try { retomada.juntarEGravar(vigiaTurno.emTurnoAgora()); } catch {}
  // os DOIS ouvintes (o rapido e o caprichado). Matando so' um, o outro ficava
  // vivo a cada recarga da tela segurando memoria, e outro subia por cima.
  for (const ou of ouvintes.values()) {
    if (ou.proc) { try { ou.proc.kill(); } catch {} }   // o 'close' zera o estado e fecha a fila
  }
  void remoteEngines.close();
  limparAudioDoDisco();
  fecharMestresSsh();   // mestre do ControlPersist nao fica pendurado depois do app
  for (const id of [...terms.keys()]) termMatar(id);   // sem isso, cada recarga deixava um pty vivo
  for (const id of [...claudePanes.keys()]) claudeStop(id);
  for (const id of [...cliPanes.keys()]) cliParar(id);
  try { acp.pararTodos(); } catch {}
  // Mais detalhes em andamento: a janelinha sumiu junto com a tela
  try { maisDetalhes.cancelarTodos(); } catch {}
  // Tarefa 6: revisao do nome automatico em andamento tambem (nenhum claude -p fica orfao)
  try { revisorDeNomes.cancelarTodos(); } catch {}
  // Tarefa 7: e o nome dos agentes
  try { nomeadorDeAgentes.cancelarTodos(); } catch {}
  // Leva 2 (Task 5): a vigia do arquivo aberto no leitor nao sobrevive a tela (recarga, queda ou fechamento)
  try { vigiaDoLeitor.pararTodos(); } catch (e) { logMain('vigia:parar-todos', e); }
  // Leva 5i: as paginas do navegador interno sao views da JANELA, nao do HTML: recarregar a tela sem soltar deixaria cada uma flutuando por cima da tela nova
  try { navegador.fecharTodos(); } catch (e) { logMain('navegador:fechar-todos', e); }
  // quem nao morreu com o SIGTERM vai no grito: sem isso ficava processo orfao
  for (const p of [...zumbis]) { try { p.kill('SIGKILL'); } catch {} }
  zumbis.clear();
  // debate em andamento para junto (Ver > Recarregar tambem passa aqui). O
  // try cobre a subida: 'debates' e' criado mais abaixo neste arquivo.
  try { debates.stopAll(); } catch {}
  if (codex.proc) {
    // fechar/recarregar e' de proposito: sem soltar os paineis antes, o 'close'
    // do servidor registrava uma "queda" por painel a cada Ctrl+R
    codex.derrubando = codex.proc;
    for (const paneId of codex.paneToThread.keys()) vigiaTurno.desligar(paneId);
    codex.paneToThread.clear(); codex.threadToPane.clear(); codex.paneTurn.clear(); codex.paneErrors?.clear();
    matarProcesso(codex.proc); codex.proc = null; codex.ready = null;
  }
}

/* ======================= IPC ======================= */
ipcMain.handle('config:get', () => { const c = loadConfig(); loadConfig.telaComPadrao = loadConfig.naoLido === true; return c; });   // onda 1: a tela que recebeu o padrao de um config preso so' grava depois de reler
ipcMain.handle('config:set', (_e, c) => {
  // Rodada 2 da leva 5: a tela leu bem, mas outro leitor do main (pastasDeTrabalho, ligado(), setVisualMac) pegou o config preso e
  // ligou o naoLido. O que a tela tem na mão não é o padrão: relê antes de gravar (solto, grava; ainda preso, recusa sem "Reabra").
  if (typeof loadConfig === 'function' && loadConfig.telaComPadrao === false && loadConfig.naoLido === true) loadConfig();
  if (!saveConfig(c)) {
    // O renderer centraliza um aviso mesmo para chamadas que não aguardam
    // a Promise. Nenhum caminho, conteúdo ou erro técnico sai neste evento.
    // Rodada final da leva 5: a recusa da tela que recebeu o padrão (telaComPadrao) dura até reabrir; a tela diz isso.
    const reler = typeof loadConfig === 'function' && loadConfig.telaComPadrao === true;
    try { _e.sender?.send('config:save-error', reler ? { reler: true } : {}); } catch (e) { logMain('config:save-error', e); }
    return false;
  }
  visualMacNative.syncConfig(c);
  return true;
});
// sincrono de proposito: o preload pega o tema ANTES do app.js pintar a tela
ipcMain.on('config:tema', (e) => { try { e.returnValue = temaSalvo(); } catch { e.returnValue = 'escuro'; } });
ipcMain.handle('sys:home', () => HOME);
ipcMain.handle('sys:versao', () => app.getVersion());

/* Aceita a string de sempre (pasta de partida) ou { start, titulo }: o mesmo
   dialogo serve pro painel e pra pasta padrao, e o titulo "deste painel"
   aparecia tambem quando voce escolhia a pasta dos paineis NOVOS. */
ipcMain.handle('dialog:pickFolder', async (_e, pedido) => {
  const o = (pedido && typeof pedido === 'object') ? pedido : { start: pedido };
  const titulo = (typeof o.titulo === 'string' && o.titulo.trim()) ? o.titulo.slice(0, 80) : 'Pasta de trabalho deste painel';
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: (typeof o.start === 'string' && o.start) || HOME, title: titulo });
  return r.canceled ? null : r.filePaths[0];
});
/* Aceita as duas formas: a string de sempre (o preload e' superficie publica) e
   { dir, remoto }. O 'remoto' vem da TELA -- nunca do claudeRemoto daqui, que e'
   apagado no claudeStop: a arvore voltaria pro disco do PC sem avisar ninguem
   assim que o motor do painel parasse. */
ipcMain.handle('fs:list', async (_e, d) => {
  const o = (d && typeof d === 'object') ? d : { dir: d };
  const rem = remotoDoPedido(o);
  if (!rem) return listDir(o.dir);
  return await listDirRemoto(rem, o.dir);
});

/* lista de arquivos da pasta do painel, pra completar o caminho quando voce
   digita "@" no campo. Guarda em memoria por 30s pra nao varrer o disco a
   cada tecla. */
/* Chave por ALVO, nao so' pela raiz: duas abas de servidores diferentes com
   caminhoRemoto '~' sao pastas diferentes, e o '~' delas nao tem nada a ver com
   a home deste PC. Chaveado so' pela raiz, uma envenenava a lista da outra. */
const cacheArquivos = new Map();   // destino SSH completo + raiz (ou local|raiz)
const arquivosEmAndamento = new Map();
const chaveDoCache = (remoto, raiz) =>
  (remoto ? JSON.stringify([String(remoto.usuario), String(remoto.host), Number(remoto.porta || 22), String(remoto.chave || '')]) : 'local') + '|' + raiz;

function varrerArquivos(raiz, limite) {
  const achados = [];
  const fila = [raiz];
  let visitadas = 0;
  while (fila.length && achados.length < limite && visitadas < 4000) {
    const dir = fila.shift();
    visitadas++;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of itens) {
      if (escondido(e.name)) continue;
      if (IGNORE.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (fila.length < 2000) fila.push(p); }
      else { achados.push(p); if (achados.length >= limite) break; }
    }
  }
  return achados;
}

/* A mesma varredura, dentro do servidor, num comando so'. As podas do find sao
   montadas a partir do IGNORE e do PONTO_OK -- e' a mesma peneira do ramo local,
   escrita em shell. -maxdepth segura o custo, "head -c" segura a tragada, e o
   base64 traz nome com espaco e acento inteiro.
   Roda UMA vez a cada 30s (o cache la' de cima), nao a cada tecla: sem isso o
   "@" abriria uma conexao por letra digitada. */
async function varrerArquivosRemoto(remoto, raiz, limite) {
  const alvo = String(raiz || (remoto && remoto.caminhoRemoto) || '~');
  // as com ponto na frente ja' caem na regra do '.*'; aqui vao so' as outras
  const podas = [...IGNORE].filter((n) => !n.startsWith('.')).map((n) => '-name ' + qLinux(n)).join(' -o ');
  const semPonto = "-name '.*' " + PONTO_OK.map((n) => '! -name ' + qLinux(n)).join(' ');
  const script = cdRemoto(alvo) + ' 2>/dev/null || { echo COCKPIT_SEM_PASTA; exit 0; }; '
    + SONDA_GNU
    + 'find . -mindepth 1 -maxdepth 8 \\( \\( ' + semPonto + ' \\)'
    + (podas ? ' -o ' + podas : '') + ' \\) -prune -o '
    + "-type f -printf '%p\\0' 2>/dev/null | head -c 2000000 | base64 -w0";
  const r = await execRemoto(remoto, script, 30000);
  if (r.error) return { error: r.error };
  const bruto = String(r.out || '').trim();
  if (bruto.startsWith('COCKPIT_SEM_PASTA')) {
    return { error: 'Não consegui abrir a pasta ' + alvo + ' no servidor. Ela existe e você tem acesso a ela?' };
  }
  // mesma armadilha da arvore: sem o find do GNU isto voltaria como lista vazia
  const semGnu = erroDaSondaGnu(bruto);
  if (semGnu) return { error: semGnu };
  const registros = registrosNul(bruto);
  if (registros.error) return registros;
  const lista = [];
  for (const p of registros.itens) {
    if (!p.startsWith('./')) continue;              // pedaco cortado pelo head
    lista.push(path.posix.join(alvo, p.slice(2)));  // POSIX: no Windows o path.join emitiria "\"
    if (lista.length >= limite) break;
  }
  return { lista };
}

/* pontuacao do "@": nome igual > comeca com > contem > o caminho contem.
   O basename muda de dialeto conforme o alvo -- caminho remoto e' sempre POSIX. */
function pontuarArquivos(lista, termo, remoto) {
  const pb = remoto ? path.posix : path;
  const normalizar = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
  const alvo = normalizar(termo);
  if (!alvo) return lista.slice(0, 40).map((p) => ({ path: p, nome: pb.basename(p) }));
  const pontua = (p) => {
    const nome = normalizar(pb.basename(p));
    if (nome === alvo) return 0;
    if (nome.startsWith(alvo)) return 1;
    if (nome.includes(alvo)) return 2;
    if (normalizar(p).includes(alvo)) return 3;
    return 99;
  };
  return lista.map((p) => ({ p, s: pontua(p) })).filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.p.length - b.p.length).slice(0, 40)
    .map((x) => ({ path: x.p, nome: pb.basename(x.p) }));
}

/* Aceita { cwd, termo } (como sempre) e agora tambem { cwd, termo, remoto }.
   RESPOSTA: no ramo local continua sendo a LISTA crua, byte por byte como antes.
   No ramo remoto e' { itens, error } -- a busca remota pode falhar por rede, e
   devolver lista vazia mentiria "essa pasta nao tem arquivo nenhum". */
ipcMain.handle('fs:buscarArquivos', async (_e, d) => {
  const o = (d && typeof d === 'object') ? d : {};
  const rem = remotoDoPedido(o);
  const raiz = o.cwd || (rem ? (rem.caminhoRemoto || '~') : HOME);
  const agora = Date.now();
  const chave = chaveDoCache(rem, raiz);
  let c = cacheArquivos.get(chave);
  if (!c || (agora - c.quando) > 30000) {
    let lista;
    if (rem) {
      const r = await varrerArquivosRemoto(rem, raiz, 20000);
      // falha de rede NAO entra no cache: envenenaria a lista por 30s
      if (r.error) return { itens: [], error: r.error };
      lista = r.lista;
    } else {
      let pending = arquivosEmAndamento.get(chave);
      if (!pending) {
        pending = buscaLocal.scanFiles(raiz, { ignore: name => escondido(name) || IGNORE.has(name) });
        arquivosEmAndamento.set(chave, pending);
      }
      try { lista = (await pending).files; }
      finally { if (arquivosEmAndamento.get(chave) === pending) arquivosEmAndamento.delete(chave); }
    }
    c = { quando: agora, lista };
    cacheArquivos.set(chave, c);
    if (cacheArquivos.size > 8) cacheArquivos.delete(cacheArquivos.keys().next().value);
  }
  const achados = pontuarArquivos(c.lista, o.termo, rem);
  return rem ? { itens: achados } : achados;
});

// Gestao Git comum ao Codex e Claude; nao remove, integra nem limpa arquivos.
for (const [action, operation] of Object.entries({
  list: (request) => cockpitWorktrees.list(request),
  open: (request) => cockpitWorktrees.open(request),
  create: (request) => cockpitWorktrees.create(request, { baseDir: path.join(HOME, 'Projetos-Codex', 'cockpit-worktrees') }),
})) {
  ipcMain.handle('git:worktrees:' + action, async (_event, request) => {
    try { return await operation(request || {}); }
    catch (error) { return { error: String(error.message || error).slice(0, 1200) }; }
  });
}

/* -z preserva espaços, quebras de linha e " -> " nos nomes. Em rename,
   o destino vem primeiro e o nome antigo ocupa o próximo registro NUL. */
function lerStatusGit(saida) {
  const linhas = String(saida || '').split('\0');
  let branch = '';
  const arquivos = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith('## ')) {
      branch = l.slice(3).replace(/^(?:No commits yet on |Initial commit on )/, '').split('...')[0].split(' ')[0];
      continue;
    }
    if (l.length < 4) continue;
    const estado = l.slice(0, 2).trim();
    const nome = l.slice(3);
    if (nome) arquivos.push({ estado, nome });
    if (/[RC]/.test(l.slice(0, 2))) i++;
  }
  return { branch, arquivos };
}
/* branch e arquivos mexidos da pasta do painel */
ipcMain.handle('git:status', async (_e, { cwd } = {}) => {
  if (!cwd) return null;
  try { if (!fs.existsSync(path.join(cwd, '.git'))) return null; } catch { return null; }
  const r = await rodar('git', ['-C', cwd, '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-b', '-z'], 8000);
  return r.err ? null : lerStatusGit(r.out);
});

ipcMain.handle('git:diff', async (_e, { cwd, arquivo }) => {
  if (!cwd || !arquivo) return '';
  const r = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--', arquivo], 10000);
  if (r.err || !String(r.out || '').trim()) {
    const r2 = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--cached', '--', arquivo], 10000);
    return r2.err ? '' : String(r2.out || '').slice(0, 120000);
  }
  return String(r.out || '').slice(0, 120000);
});

/* apagar manda pra Lixeira (da' pra voltar atras) e limpa os registros */
/* So' apaga arquivo de conversa: dentro das pastas de sessao e terminado em
   .jsonl. Sem isto, um caminho qualquer gravado na ficha do painel ia pra
   Lixeira ao clicar em "Apagar conversa". */
function ehArquivoDeConversa(f) {
  try {
    const p = path.resolve(String(f || ''));
    if (!/\.jsonl$/i.test(p)) return false;
    const raizes = [CLAUDE_PROJ, CODEX_SESS, path.join(app.getPath('userData'), 'acp')].filter(Boolean).map((r) => path.resolve(r));
    const dentro = (r, alvo) => {
      const rel = path.relative(r, alvo);
      return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
    };
    const real = (alvo) => (fs.realpathSync.native || fs.realpathSync)(alvo);
    if (!fs.statSync(p).isFile()) return false;
    const alvo = real(p);
    // Uma junction dentro de sessions não autoriza apagar arquivo fora dela.
    return raizes.some((r) => {
      try { return dentro(r, p) && dentro(real(r), alvo) && /\.jsonl$/i.test(alvo); }
      catch { return false; }
    });
  } catch { return false; }
}

ipcMain.handle('sessao:apagar', async (_e, { id, file, engine, remoto }) => {
  // conferencia da rodada 2 da leva 5i (achado C): a janela de teste lista as conversas REAIS; apagar mandaria o .jsonl de verdade para a Lixeira
  if (typeof JANELA_DE_TESTE !== 'undefined' && JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };   // typeof: os testes recortam o canal num vm
  if (remoto != null) { if (engine === 'claude') { try { const remoteFile = await arquivoClaudeNoServidor(remoto, id); await remoteTransport.run(remoto, 'rm -- ' + qLinux(remoteFile)); return { ok: true }; } catch(e) { return { error: e.message }; } } return remoteEngines.remove(engine, remoto, id); }
  try {
    let f = ehArquivoDeConversa(file) ? file : null;
    // conversa do ACP com caminho de outra maquina: o id acha o arquivo daqui
    if ((!f || !fs.existsSync(f)) && id) { const g = acp.arquivoDe(id); if (fs.existsSync(g)) f = g; }
    if (!f || !fs.existsSync(f)) {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find((a) => a.id === id);
      if (it) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return { error: 'Não achei o arquivo desta conversa.' };
    // Os caminhos encontrados pelo id e pelo índice passam pela mesma regra.
    if (!ehArquivoDeConversa(f)) return { error: 'Este arquivo não pertence às pastas de conversas.' };
    await shell.trashItem(f);
    const ind = lerIndice(); delete ind[f]; gravarIndice();
    // o seu e o automatico (nomes.json que nao deu pra ler fica como esta': gravar em cima apagaria os outros)
    const nomes = lerNomesSeguro(); if (nomes) { tituloAuto.esquecerNome(nomes, id); salvarNomes(nomes); }
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* exporta a conversa como .md legivel */
ipcMain.handle('sessao:exportar', async (_e, { engine, id, file, titulo, msgs, remoto }) => {
  try {
  if (remoto != null && !Array.isArray(msgs)) { msgs = engine === 'claude' ? await claudeHistoryRemoto(remoto,id) : await remoteEngines.history(engine,remoto,id); if (!Array.isArray(msgs)) return msgs; }
    let linhas = Array.isArray(msgs) ? msgs : null;
    if (!linhas) {
      let f = file;
      if (ehCli(engine) && (!f || !fs.existsSync(f))) f = acharArquivoSessao(engine, id);
      if (ehCli(engine) && (!f || !fs.existsSync(f))) return { error: 'Não achei o arquivo desta conversa.' };
      if (engine === 'acp' && (!f || !fs.existsSync(f))) f = acp.arquivoDe(id);
      if (engine === 'acp' && (!f || !fs.existsSync(f))) return { error: 'Não achei o arquivo desta conversa.' };
      if (!f || !fs.existsSync(f)) {
        const achados = [];
        varrerConversas(engine === 'codex' ? CODEX_SESS : CLAUDE_PROJ, achados, 0);
        const it = achados.find((a) => a.id === id);
        if (it) f = it.f;
      }
      if (!f || !fs.existsSync(f)) return { error: 'Não achei o arquivo desta conversa.' };
      // Tarefa 5: a conversa INTEIRA, lida em blocos (o teto de 6 MB do Claude saiu)
      linhas = engine === 'claude' ? await claudeHistory(f) : engine === 'acp' ? await acp.historico(id, f) : ehCli(engine) ? await cliHistory(f) : await codexHistory(f);
    }
    /* "cortou" pela CONTAGEM: o arquivo leva as ultimas 5000 falas (com as
       ferramentas delas, todas) e o aviso sai so' se alguma fala ficou de fora.
       Antes olhava o tamanho do arquivo (6 MB) e contava ferramenta como fala. */
    const corte = cortarHistorico(linhas, 5000, Infinity);
    linhas = corte.msgs;
    const cortou = corte.cortou;
    const quem = engine === 'codex' ? 'Codex' : engine === 'acp' ? 'Agente ACP' : ehCli(engine) ? CLIS[engine].nome : 'Claude';
    let md = '# ' + (titulo || 'Conversa') + '\n\n_exportado do Cockpit em ' + new Date().toLocaleString('pt-BR') + '_\n\n';
    if (cortou) md += '> ⚠️ Conversa longa: este arquivo tem só a parte final dela.\n\n';
    for (const x of linhas) {
      if (x.role === 'user') md += '\n## Você\n\n' + x.text + '\n';
      else if (x.role === 'bot') md += '\n## ' + quem + '\n\n' + x.text + '\n';
      else if (x.role === 'tool') md += '\n> `' + (x.name || 'ferramenta') + '` ' + (x.arg || '') + '\n';
    }
    const limpo = String(titulo || 'conversa').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('downloads'), limpo + '.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return { cancelado: true };
    fs.writeFileSync(r.filePath, md, 'utf8');
    return { ok: true, caminho: r.filePath };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
ipcMain.handle('fs:read', (_e, f) => {
  try {
    if (fs.statSync(f).size > 500 * 1024) return { error: 'Arquivo grande demais para ver aqui.' };
    return { content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { error: e.message }; }
});
/* Script e executavel NUNCA abrem direto (R3-06): o openPath segue a associacao do Windows e, com o Python
   instalado, um .py gravado pelo agente RODA no clique de quem so' queria ver o arquivo. A regra pura mora em
   abrir-seguro.js; aqui o arquivo so' aparece na pasta. */
const { decidirAbertura } = require('./abrir-seguro');
ipcMain.handle('shell:open', async (_e, p) => {
  const s = String(p || '');
  if (ehCaminhoDeRede(s)) return { error: MSG_CAMINHO_DE_REDE };
  if (decidirAbertura(s) === 'revelar') {
    // pasta com nome de script ("site.com", "next.js") abre normal: o que roda e' arquivo, nao pasta
    let pasta = false;
    try { pasta = fs.statSync(s).isDirectory(); } catch {}
    if (!pasta) {
      try { shell.showItemInFolder(s); } catch (e) { return { error: String((e && e.message) || e) }; }
      return { ok: true, revelado: true };
    }
  }
  if (!podeAbrirDireto(s)) {
    // em vez de so' recusar, mostra na pasta: voce decide o que fazer com ele
    try { shell.showItemInFolder(s); } catch (e) { logMain('shell:open', e); }
    return { error: 'Esse tipo de arquivo o Cockpit não abre direto — abri a pasta dele pra você.' };
  }
  /* o openPath NAO lanca: devolve o TEXTO do erro ('' quando abriu). A tela le { error }, entao o texto cru
     passava calado (UI 7.2-8). */
  try {
    const erro = await shell.openPath(s);
    return erro ? { error: String(erro) } : { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});
/* "Mostrar na pasta": o arquivo aparece selecionado no Explorer, sem abrir nada (script e executavel tambem).
   Caminho de rede e' recusado como nos outros canais (R5-01). */
ipcMain.handle('shell:mostrarNaPasta', (_e, p) => {
  const s = String(p || '');
  if (ehCaminhoDeRede(s)) return { error: MSG_CAMINHO_DE_REDE };
  try {
    if (!s || !fs.existsSync(s)) return { error: 'Caminho não encontrado.' };
    shell.showItemInFolder(s);
    return { ok: true };
  } catch (e) { return { error: String((e && e.message) || e) }; }
});
/* Lista de PERMITIDOS, nao de proibidos.
   A lista de proibidos deixava passar .lnk, .hta, .url, .pif e
   .settingcontent-ms -- e o .lnk executa de verdade pelo openPath (e' um atalho
   que aponta pra qualquer coisa). Como nao da' pra prever a proxima extensao
   que o Windows resolve executar, o certo e' dizer o que PODE abrir. */
const EXT_ABRE_DIRETO = new Set([
  // texto e codigo
  'txt','md','markdown','json','jsonl','yaml','yml','toml','ini','cfg','conf','env','log','csv','tsv',
  'html','htm','xml','css','scss','less','sql','graphql','diff','patch','lock','gitignore',
  // py, rb, php, lua e r NAO entram: o Windows EXECUTA esses arquivos em vez de abrir num editor (R3-06)
  'go','rs','java','kt','swift','c','h','cpp','hpp','cs','ipynb',
  'ts','tsx','jsx','mjs','cjs','vue','svelte','astro',
  // documento
  'pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','epub',
  // imagem, som e video
  'png','jpg','jpeg','gif','webp','svg','bmp','ico','avif','heic','tif','tiff',
  'mp3','wav','ogg','m4a','flac','aac','mp4','mov','mkv','webm','avi','m4v',
  // arquivo compactado (abre o descompactador, nao executa)
  'zip','tar','gz','tgz','bz2','7z','rar',
  // legenda e arte, que ele mexe todo dia
  'srt','vtt','ass','psd','ai','eps','indd','mdx','rst','tex','mpg','mpeg','wmv','opus','xlsm',
  // do dia a dia dele: extrato do banco, chave e certificado da VPS, fonte,
  // Apps Script, o atalho das 5 janelas do VS Code
  'ofx','pem','crt','cer','key','gs','code-workspace','ttf','otf','woff','woff2',
  'ndjson','ics','bak','cr3','nef','dng','heif','jfif',
]);
// arquivo de configuracao famoso nao tem extensao (ou a extensao E' o nome)
const SEM_PONTO_OK = new Set([
  'dockerfile','makefile','license','readme','changelog','procfile','gemfile','rakefile','justfile','vagrantfile',
]);
const OCULTOS_ABRE_DIRETO = new Set([
  '.env', '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.editorconfig',
  '.npmrc', '.yarnrc', '.nvmrc', '.node-version', '.python-version', '.eslintrc',
  '.prettierrc', '.babelrc', '.browserslistrc', '.stylelintrc',
]);
function podeAbrirDireto(p) {
  const s = String(p || '');
  const barra = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const nome = s.slice(barra + 1);
  if (!s || /[\x00-\x1f]/.test(s) || /[ .]$/.test(nome)) return false;
  // O Windows remove pontos/espaços finais e interpreta ':' como fluxo ADS.
  // Validar a grafia original evita uma extensão inofensiva mascarar outra.
  if (EH_WIN && s.replace(/^[A-Za-z]:/, '').includes(':')) return false;
  // Configurações ocultas conhecidas são permitidas pelo nome exato.
  // As demais seguem a mesma lista de extensões dos arquivos visíveis.
  const oculto = nome.toLowerCase();
  if (OCULTOS_ABRE_DIRETO.has(oculto)) return true;
  if (/^\.env\.(local|development|production|test|staging)(\.local)?$/.test(oculto)) return true;
  const ponto = nome.lastIndexOf('.');
  if (ponto > 0 && EXT_ABRE_DIRETO.has(nome.slice(ponto + 1).toLowerCase())) return true;
  if (ponto <= 0 && SEM_PONTO_OK.has(nome.toLowerCase())) return true;   // Dockerfile, Makefile...
  /* pasta abre normal. Vem por ULTIMO de proposito: statSync num caminho de
     rede fora do ar demora 21 segundos, e nesse tempo o processo principal nao
     atende nenhum painel. Os testes de nome acima resolvem a maioria sem
     encostar no disco. */
  try { if (fs.statSync(s).isDirectory()) return true; } catch {}
  return false;
}
ipcMain.handle('shell:link', (_e, url) => {
  const s = String(url || '');
  if (ehCaminhoDeRede(s)) return { error: MSG_CAMINHO_DE_REDE };
  if (/^https?:\/\//i.test(s)) return shell.openExternal(s);
  // nao e' link web: so' abre se for arquivo/pasta que existe E nao for executavel
  if (!podeAbrirDireto(s)) {
    let mostrei = false;
    try { if (fs.existsSync(s)) { shell.showItemInFolder(s); mostrei = true; } } catch (e) { logMain('shell:link', e); }
    return { error: mostrei
      ? 'Esse tipo de arquivo o Cockpit não abre direto — abri a pasta dele pra você.'
      : 'Esse tipo de arquivo o Cockpit não abre direto.' };
  }
  try { if (!fs.existsSync(s)) return { error: 'Caminho não encontrado.' }; } catch { return { error: 'Caminho inválido.' }; }
  return shell.openPath(s);
});
ipcMain.handle('shell:openUrl', (_e, u) => {
  if (!/^https?:\/\//i.test(String(u || ''))) return { error: 'link inválido' };
  shell.openExternal(u); return { ok: true };
});

/* ======================= navegador interno (leva 5i) =======================
   O link de site abre no visor do painel, numa pagina NATIVA (WebContentsView) que o src/navegador-interno.js poe por cima da janela.
   A tela so' manda estes comandos e o retangulo do corpo do visor, e ouve 'navegador:estado' e 'navegador:download'. A pagina nao
   fala com o IPC do app: sem preload, e o cockpit-ipc-security.js recusa outro webContents. Login do Cockpit (Claude, Codex,
   conectores) continua no navegador do Windows: connector:openUrl e shell:openUrl nao passam por aqui. */
const { WebContentsView, session: sessaoDoElectron } = require('electron');
const navegador = require('./navegador-interno').criarNavegadorInterno({
  WebContentsView, session: sessaoDoElectron, shell,
  getWindow: () => win,
  pastaDownloads: () => app.getPath('downloads'),
  emit: (canal, dados) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(canal, dados); },
  log: logMain,
});
// o pedido vem da tela como { paneId, ... }: um objeto qualquer nao pode derrubar o canal (o modulo valida cada campo de novo)
const canalDoNavegador = (nome, executar) => ipcMain.handle('navegador:' + nome, (_e, pedido) => {
  try { return executar(pedido && typeof pedido === 'object' ? pedido : {}); }
  catch (e) { logMain('navegador:' + nome, e); return { ok: false, erro: 'O navegador não respondeu.' }; }
});
canalDoNavegador('abrir', (o) => navegador.abrir(o.paneId, o.url, o.rect));
canalDoNavegador('posicionar', (o) => navegador.posicionar(o.paneId, o.rect));
canalDoNavegador('visivel', (o) => navegador.visivel(o.paneId, o.visivel === true));
canalDoNavegador('voltar', (o) => navegador.voltar(o.paneId));
canalDoNavegador('avancar', (o) => navegador.avancar(o.paneId));
canalDoNavegador('recarregar', (o) => navegador.recarregar(o.paneId, o.semCache === true));
canalDoNavegador('parar', (o) => navegador.parar(o.paneId));
canalDoNavegador('irPara', (o) => navegador.irPara(o.paneId, o.url));
canalDoNavegador('externo', (o) => navegador.externo(o.paneId));
canalDoNavegador('fechar', (o) => navegador.fechar(o.paneId));


/* ======================= Gemini e Grok =======================
   Os dois rodam "headless": um prompt por chamada, resposta em JSON linha a
   linha. E' diferente do Claude, que fica de pe' esperando no stdin, e do
   Codex, que e' um servidor so' pra todos os paineis.

   Aqui cada mensagem sobe um processo, responde e morre. A conversa nao se
   perde porque o identificador da sessao e' sempre o mesmo: na primeira
   mensagem a gente batiza a sessao, e nas seguintes manda continuar aquele
   arquivo. Traduzimos os eventos deles para os mesmos que a tela ja entende,
   entao o painel do Gemini se comporta igual ao do Claude. */

const CLIS = {
  gemini: {
    nome: 'Gemini',
    bin: 'gemini',
    pastaSessoes: () => path.join(HOME, '.gemini', 'tmp'),
    // formato do arquivo conferido no codigo do proprio gemini-cli
    conversas: true,
    // ~/.gemini/commands/**/*.toml, do jeito que o proprio CLI le
    comandos: true,
    /* default = pergunta antes (mas nao ha' como perguntar sem tela, entao o
       proprio Gemini recusa a ferramenta); plan = so' leitura; yolo = faz tudo */
    modo: { bypass: 'yolo', auto: 'auto_edit', plan: 'plan', manual: 'default' },
    porStdin: true,
    args(o) {
      /* "--skip-trust": sem isto o Gemini recusa qualquer pasta que voce nao
         tenha confiado NA TELA dele -- sai com codigo 55 e nao escreve uma
         linha. Como o Cockpit sempre roda sem tela, nao havia como confiar a
         pasta por aqui: o painel ficava mudo pra sempre. */
      const a = ['-o', 'stream-json', '--skip-trust'];
      if (o.modo) a.push('--approval-mode', o.modo);
      if (o.model) a.push('-m', o.model);
      if (o.arquivoSessao) a.push('--session-file', o.arquivoSessao);
      else if (o.sessao) a.push('--session-id', o.sessao);
      return a;
    },
  },
  grok: {
    nome: 'Grok',
    bin: 'grok',
    pastaSessoes: () => path.join(HOME, '.grok', 'sessions'),
    /* o Grok nao esta instalado nesta maquina: nao ha um arquivo de conversa
       de verdade pra conferir o formato. Enquanto for assim, o sessions:cli
       devolve a lista VAZIA (marcada semLista), sem texto de aviso: o Historico
       e a busca ficam limpos e o painel mostra so' "Nenhuma conversa ainda." (R4-03). */
    conversas: false,
    comandos: false,
    /* o Grok tem os modos dele, mas ainda nao confirmei a flag exata (precisa de
       assinatura pra testar). Ate' confirmar, a tela nao oferece escolha de modo
       aqui -- prometer "so' leitura" sem mandar nada seria mentira. */
    modo: null,
    porStdin: true,
    args(o) {
      const a = ['--output-format', 'streaming-json'];
      if (o.model) a.push('--model', o.model);
      if (o.sessao) a.push('--session-id', o.sessao);
      return a;
    },
  },
};
const ehCli = (engine) => Object.prototype.hasOwnProperty.call(CLIS, engine);
const remoteTransport = require('./cockpit-remote-transport').createTransport({ spawnBin, buildEnv, HOME, kill: matarProcesso });
const remotePaneTargets = new Map();
const remoteClaudeUploads = new Map();
function limparAnexosClaudeRemotos(paneId) { const st = remoteClaudeUploads.get(paneId); if (!st) return; remoteClaudeUploads.delete(paneId); st.abort.abort(); for (const u of st.uploads) void u.cleanup(); }
const remoteStore = require('./cockpit-remote-sessions').createStore(() => path.join(app.getPath('userData'), 'remote-sessions'));
const remoteEngines = require('./cockpit-remote').createRemote({
  transport: remoteTransport, store: remoteStore,
  observeCodex: (method, params, paneId, origin) => observabilidade.observarCodex(method, params, paneId, origin),
  ownerOfThread: (threadId, origin) => observabilidade.ownerOfThread(threadId, origin),
  restoreCodex: (paneId, rootId, threads, origin) => observabilidade.restoreCodex(paneId, rootId, threads, origin),
  interactions: interactionBroker,
  onScopeClosed: (paneId) => observabilidade.encerrarPainel(paneId, 'codex', 'A conexão com o servidor foi encerrada.'),
  emit: (paneId, kind, data) => { if (kind === 'turn-end' || kind === 'engine-down') vigiaTurno.desligar(paneId); emit(paneId, kind, data); },
  cliArgs: (engine, st) => CLIS[engine].args({ modo: CLIS[engine].modo?.[st.approval] || '', model: st.model, sessao: st.session, arquivoSessao: st.arquivoSessao }),
  cliEvent: cliEvento, cliFlush: mandarFala,
});
ipcMain.handle('agents:history', async (_e, { paneId, threadId } = {}) => {
  try {
    const agent = observabilidade.agentesSessao({ paneId, engine: 'codex' }).itens.find(a => a.threadId === threadId);
    if (!agent) throw new Error('Subagente não pertence a esta conversa.');
    const remote = remotePaneTargets.get(paneId)?.remoto;
    const origin = remote ? require('./cockpit-remote-transport').key(remote) : 'local';
    if ((agent.origin || 'local') !== origin) throw new Error('O destino desta conversa mudou. Reabra o painel de origem.');
    if (!remote) await codexStart();
    const request = remote ? (m, p) => remoteEngines.query(remote, m, p) : codexReq;
    const messages = await historyPages.readAll(request, threadId, async () => {
      const r = await request('thread/read', { threadId, includeTurns: true });
      return (r.thread?.turns || []).flatMap(t => (t.items || []).map(item => historyPages.fromItem({ item, turnId: t.id })).filter(Boolean));
    });
    return { messages, agent, readOnly: true };
  } catch (e) { return { error: e.message }; }
});
const accountComparison = require('./cockpit-accounts').createAccounts({ folder: PASTA_CONTAS, readActive: lerCredencial, transport: remoteTransport, fetch: buscarNaRede });
ipcMain.handle('contas:comparar', (_e, o) => accountComparison.compare(o.engine, o.remoto, o));
ipcMain.handle('contas:compararCancelar', (_e, id) => accountComparison.cancel(id));
ipcMain.handle('sessions:remoto', (_e, o) => o.engine === 'claude' ? claudeSessionsRemoto(o.remoto, o.incluirRobos) : remoteEngines.sessions(o.engine, o.remoto));


const cliPanes = new Map();   // paneId -> { engine, cwd, model, modo, sessao, proc, buf, erro, primeira }

/* Acha o arquivo da conversa pelo pedaco do identificador que o Gemini poe no
   nome (session-<data>-<8 letras>.jsonl). Sem isto, "continuar a conversa"
   dependeria de "a mais recente da pasta" -- e dois paineis na mesma pasta
   pegariam a conversa um do outro. */
function acharArquivoSessao(engine, sessao) {
  if (!sessao) return '';
  const cli = CLIS[engine]; if (!cli) return '';
  const raiz = cli.pastaSessoes();
  const pedaco = String(sessao).slice(0, 8).toLowerCase();
  let achado = '', melhor = 0;
  const olhar = (dir, fundo) => {
    if (fundo > 3) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(p, fundo + 1); continue; }
      if (!it.name.toLowerCase().includes(pedaco)) continue;
      if (!/\.jsonl?$/i.test(it.name)) continue;
      // o Gemini grava DOIS arquivos com o mesmo nome: a conversa em "chats" e o
      // log do desenvolvedor em "logs". Continuar pelo log daria conversa vazia.
      if (/[\\/]logs[\\/]/i.test(p)) continue;
      try {
        const mt = fs.statSync(p).mtimeMs;
        if (mt > melhor) { melhor = mt; achado = p; }
      } catch {}
    }
  };
  olhar(raiz, 0);
  return achado;
}

/* O Gemini e o Grok reclamam em ingles, com codigo de cor no meio e um texto
   longo. Aqui isso vira uma frase curta que diz o que fazer. O resto e' limpo:
   sem escape de cor, sem stack trace, sem muro de JSON. */
function motivoDoCli(txt, cli, codigo) {
  const s = String(txt || '').replace(/\x1b\[[0-9;]*m/g, '');   // tira cor de terminal
  const nome = (cli && cli.nome) || 'motor';
  const bin = (cli && cli.bin) || 'gemini';
  if (/set an Auth method|GEMINI_API_KEY|not authenticated|Please login|no credentials/i.test(s))
    return 'O ' + nome + ' ainda não está conectado. Abra o terminal, rode "' + bin + '" e entre na sua conta — depois volte aqui.';
  if (/not running in a trusted directory|trust this directory/i.test(s))
    return 'O ' + nome + ' não confia nesta pasta. Rode "' + bin + '" nela uma vez pelo terminal e confirme.';
  /* "limit: 0" e' diferente de cota esgotada: o modelo NUNCA teve camada gratis
     nesta conta (ex: 3.1-pro-preview). Dizer "acabou a cota" mandaria o Hugo
     esperar por algo que nunca vem. Tem que vir ANTES do teste generico de
     cota, porque a mesma mensagem contem RESOURCE_EXHAUSTED. */
  if (/limit:\s*0[,\s]/i.test(s))
    return 'Esse modelo não entra na camada grátis da sua conta. Troque de modelo no menu do painel.';
  if (/no longer available|has been discontinued|deprecated model/i.test(s))
    return 'O Google aposentou esse modelo. Troque de modelo no menu do painel.';
  if (/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(s))
    return 'Acabou a cota do ' + nome + ' por agora. Tente mais tarde ou troque de conta pelo terminal.';
  if (/Session ID already exists/i.test(s))
    return 'Essa conversa já existe no ' + nome + '. Comece uma conversa nova neste painel.';
  if (/ENOENT|is not recognized|não é reconhecido/i.test(s))
    return 'Não achei o ' + nome + ' nesta máquina. Instale e entre na conta pelo terminal.';
  if (/permission denied|EACCES/i.test(s))
    return 'O ' + nome + ' não teve permissão para isso nesta pasta.';
  /* nada conhecido: manda a primeira linha util, sem aviso de rotina e sem
     rastro de pilha (que so' confunde) */
  const linha = s.split('\n').map((l) => l.trim())
    .filter((l) => l && !/^\s*at /.test(l) && !/YOLO mode is enabled/i.test(l) && !/^\{/.test(l))[0];
  return linha ? linha.slice(0, 200) : ('O ' + nome + ' saiu com erro (código ' + codigo + ').');
}

/* ---- lista de conversas dos motores por turno (Gemini, Grok) ----

   O arquivo e' um JSONL com regra propria, lida no codigo do proprio gemini-cli
   (chatRecordingService / loadConversationRecord) em vez de adivinhada: a
   primeira linha e' o cabecalho (sessionId, projectHash), uma linha com "id" e'
   uma mensagem que ENTRA no mapa por id, um "$set.messages" LIMPA o mapa e
   repovoa, e um "$rewindTo" apaga dali pra frente. Ler de outro jeito devolveria
   conversa duplicada ou fala apagada de volta na tela.

   Cada mensagem do Cockpit vira um processo novo, e cada processo grava o seu
   proprio "$set.messages" no comeco -- por isso o mapa e' por id, e nao um
   append cego. */

/* A primeira fala e' sempre o <session_context> que o proprio CLI injeta;
   comando ("/algo") e busca ("?algo") tambem nao servem de titulo. A regra e' a
   mesma do isIgnoredUserContent do gemini-cli. */
function cliFalaDeGente(t) {
  const s = String(t || '').trim();
  return !!s && !s.startsWith('/') && !s.startsWith('?')
    && !s.startsWith('<session_context>') && !s.startsWith('<hook_context>');
}
const cliTexto = (c) => (Array.isArray(c)
  ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
  : (typeof c === 'string' ? c : ''));

/* Remonta o mapa de mensagens de um arquivo de conversa, na mesma ordem e com
   as mesmas regras do CLI, UMA linha por vez (linha). Serve aos dois jeitos
   de ler: so' a cabeca, pra lista (cliLerCabeca), e o arquivo inteiro em
   blocos, pra reabrir (cliLerConversa). conversa() devolve { meta, msgs }. */
function cliMontador() {
  const mapa = new Map();
  let meta = {};
  const linha = (l) => {
    // chave aberta como TEXTO engana o contador de chaves de quem extrai a
    // funcao pra testar (ja quebrou o andaime). Aqui vai o codigo do caractere.
    if (l.charCodeAt(0) !== 123) return;
    let d; try { d = JSON.parse(l); } catch { return; }
    if (typeof d.$rewindTo === 'string') {
      // apaga dali pra frente; se o id nao esta no mapa, o CLI limpa tudo
      const ids = [...mapa.keys()];
      const i = ids.indexOf(d.$rewindTo);
      if (i < 0) mapa.clear();
      else for (const id of ids.slice(i)) mapa.delete(id);
      return;
    }
    if (d.$set && typeof d.$set === 'object') {
      if (Array.isArray(d.$set.messages)) {
        mapa.clear();
        for (const m of d.$set.messages) if (m && typeof m.id === 'string') mapa.set(m.id, m);
      }
      meta = { ...meta, ...d.$set };
      return;
    }
    if (typeof d.id === 'string') { mapa.set(d.id, d); return; }
    if (typeof d.sessionId === 'string') meta = { ...meta, ...d };
  };
  return { linha, conversa: () => ({ meta, msgs: [...mapa.values()] }) };
}
/* so' a cabeca do arquivo (o titulo da lista nao precisa dele inteiro) */
function cliLerCabeca(file, tetoBytes) {
  const m = cliMontador();
  for (const l of headRead(file, tetoBytes).split('\n')) m.linha(l);
  return m.conversa();
}
/* Tarefa 5: o arquivo INTEIRO, em blocos (antes: readFileSync de uma vez so') */
async function cliLerConversa(file) {
  const m = cliMontador();
  await varrerLinhas(file, m.linha);
  return m.conversa();
}

/* ~/.gemini/projects.json guarda "caminho em minusculas" -> "nome da pasta em
   tmp". Sem ele a lista mostraria "hugom" como se fosse a pasta do painel, e o
   filtro por aba nunca casaria. */
function cliMapaProjetos(engine) {
  const fora = {};
  const raizCli = path.dirname(CLIS[engine].pastaSessoes());
  try {
    const j = JSON.parse(fs.readFileSync(path.join(raizCli, 'projects.json'), 'utf8'));
    for (const [caminho, apelido] of Object.entries((j && j.projects) || {})) {
      fora[apelido] = String(caminho).replace(/^([a-z]):/, (_m, d) => d.toUpperCase() + ':');
    }
  } catch {}
  return fora;
}

const CLI_TETO_TITULO = 512 * 1024;   // pro titulo nao precisa do arquivo inteiro

function cliSessions(engine) {
  const cli = CLIS[engine];
  if (!cli || !cli.conversas) return [];
  const raizCli = cli.pastaSessoes();
  if (!fs.existsSync(raizCli)) return [];
  const projetos = cliMapaProjetos(engine);
  const out = [];
  const olhar = (dir, fundo, apelido) => {
    if (fundo > 3) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(p, fundo + 1, fundo === 0 ? it.name : apelido); continue; }
      if (!/\.jsonl?$/i.test(it.name)) continue;
      if (/[\\/]logs[\\/]/i.test(p)) continue;   // log do desenvolvedor nao e' conversa
      let quando = 0;
      try { quando = fs.statSync(p).mtimeMs; } catch { continue; }
      const { meta, msgs } = cliLerCabeca(p, CLI_TETO_TITULO);
      const id = meta && meta.sessionId;
      if (!id) continue;
      const primeira = msgs.find((m) => m.type === 'user' && cliFalaDeGente(cliTexto(m.content)));
      if (!primeira) continue;   // conversa que nunca saiu do contexto inicial
      out.push({
        engine, id, file: p, when: quando, entrada: 'cockpit',
        cwd: projetos[apelido] || HOME,
        title: cliTexto(primeira.content).replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
  };
  olhar(raizCli, 0, '');
  out.sort((a, b) => b.when - a.when);
  return out.slice(0, 300);
}

/* Reabrir a conversa na tela, no mesmo formato que o Claude e o Codex ja
   devolvem: { role: 'user' | 'bot' | 'tool', text, name, arg }. Tarefa 5: a
   conversa inteira (o corte, cortarHistorico, e' de quem chama). */
async function cliHistory(file) {
  const { msgs } = await cliLerConversa(file);
  const out = [];
  for (const m of msgs) {
    if (!m || m.type === 'info' || m.type === 'error' || m.type === 'warning') continue;
    const texto = cliTexto(m.content).trim();
    if (m.type === 'user') {
      if (!cliFalaDeGente(texto)) continue;
      out.push({ role: 'user', text: texto });
      continue;
    }
    // o CLI chama a fala do modelo de "gemini"
    if (texto) out.push({ role: 'bot', text: texto });
    for (const t of (m.toolCalls || [])) {
      let arg = '';
      try { arg = t.args ? JSON.stringify(t.args).slice(0, 120) : ''; } catch {}
      out.push({ role: 'tool', name: t.name || 'Ferramenta', arg });
    }
  }
  return out;
}

ipcMain.handle('sessions:cli', (_e, engine) => {
  if (engine?.remoto != null) return remoteEngines.sessions(engine.engine, engine.remoto);
  if (engine && typeof engine === 'object') engine = engine.engine;
  // as conversas do ACP sao as que o proprio Cockpit anotou (acp.js)
  /* leva 41 (B6): Gemini e ACP tambem mostram o nome que voce deu e o de 3
     palavras do Cockpit (antes a lista deles ignorava o nomes.json). */
  const comNomes = (lista) => { if (!Array.isArray(lista)) return lista; const nomes = lerNomes(); return lista.map((s) => tituloAuto.aplicarNome(s, nomes)); };
  if (engine === 'acp') { try { return comNomes(acp.sessoes()); } catch (e) { return { error: String(e && e.message || e) }; } }
  const cli = CLIS[engine];
  if (!cli) return [];
  /* Motor sem lista de conversas (hoje, o Grok, que nem esta instalado): lista
     VAZIA marcada com semLista e SEM texto de aviso. O aviso fixo ("a lista ainda
     nao foi ligada") grudava no Historico da lateral e no fim de toda busca, mesmo
     pra quem nunca usou o motor (R4-03). Falha de leitura de verdade continua
     voltando como { error } logo abaixo, e essa a tela mostra. A marca existe pra
     quem precisar separar "sem lista" de "lista vazia" (ex.: Ajustes > Motores). */
  if (!cli.conversas) return { itens: [], semLista: true };
  try { return comNomes(cliSessions(engine)); }
  catch (e) { return { error: e.message }; }
});

function cliStart(paneId, engine, opts) {
  const cli = CLIS[engine];
  if (!cli) throw new Error('motor desconhecido: ' + engine);
  if (opts.remoto) throw new Error('O ' + cli.nome + ' ainda não roda em servidor remoto.');
  if (!temBin(cli.bin)) throw new Error('Não achei o ' + cli.nome + ' nesta máquina. Instale e entre na conta pelo terminal.');

  cliParar(paneId, true);
  const sessao = opts.resumeId || crypto.randomUUID();
  const st = {
    engine, cwd: opts.cwd || HOME, model: opts.model || '',
    modo: cli.modo ? (cli.modo[opts.approval] || cli.modo.bypass) : '',
    sessao, proc: null, buf: '', erro: '',
    // conversa retomada ja tem arquivo la' fora; a nova so' ganha depois da 1a resposta
    primeira: !opts.resumeId,
  };
  cliPanes.set(paneId, st);
  // manda o arquivo junto: sem ele, ao reabrir o app o motor lembrava da
  // conversa e a TELA voltava em branco
  emit(paneId, 'sessao', { id: sessao, file: acharArquivoSessao(engine, sessao) });
  return true;
}

function cliParar(paneId, quieto) {
  const st = cliPanes.get(paneId);
  if (!st) return;
  if (st.timerFala) { clearTimeout(st.timerFala); st.timerFala = null; }
  if (st.proc) {
    st.parandoDeProposito = true; matarProcesso(st.proc); st.proc = null;
    // a conversa ja existe no disco: sem isto a proxima mensagem tentaria
    // batizar de novo e o Gemini recusa ("Session ID already exists")
    st.primeira = false; st.msgId = null; st.acc = '';
  }
  if (!quieto) cliPanes.delete(paneId);
}

function cliEnviar(paneId, texto) {
  const st = cliPanes.get(paneId);
  if (!st) return false;
  const cli = CLIS[st.engine];
  if (st.proc) return false;   // ainda respondendo a anterior

  const arquivoSessao = st.primeira ? '' : acharArquivoSessao(st.engine, st.sessao);
  let proc;
  try {
    proc = spawnBin(cli.bin, cli.args({
      modo: st.modo, model: st.model, sessao: st.sessao, arquivoSessao,
    }), { cwd: st.cwd, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    emit(paneId, 'engine-down', { motivo: 'Não consegui rodar o ' + cli.nome + ': ' + (e && e.message || e) });
    return false;
  }
  st.proc = proc; st.buf = ''; st.erro = ''; st.parandoDeProposito = false;
  proc.stdin.on('error', () => {});
  /* o texto vai pelo CANO, nunca por argumento: no Windows a linha passa pelo
     cmd.exe, que corta na primeira quebra de linha e recusa acima de ~8 mil
     caracteres -- justo o caso de colar codigo ou trocar de motor com conversa */
  try { proc.stdin.write(texto); } catch {}
  try { proc.stdin.end(); } catch {}
  emit(paneId, 'busy', {});

  proc.stdout.setEncoding?.('utf8');
  proc.stdout.on('data', (chunk) => {
    if (cliPanes.get(paneId) !== st || st.proc !== proc) return;   // processo ja trocado
    st.buf += chunk.toString('utf8');
    let i;
    while ((i = st.buf.indexOf('\n')) >= 0) {
      const linha = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
      if (!linha) continue;
      let ev; try { ev = JSON.parse(linha); } catch { continue; }
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
      cliEvento(paneId, st, ev);
    }
  });
  proc.stderr.setEncoding?.('utf8');  proc.stderr.on('data', (d) => { st.erro = (st.erro + d.toString('utf8')).slice(-1200); });

  proc.on('close', (codigo) => {
    if (cliPanes.get(paneId) !== st || st.proc !== proc) return;
    st.proc = null;
    mandarFala(paneId, st, true);   // o ultimo pedaco nao pode ficar pra tras
    st.msgId = null; st.acc = '';   // turno acabou: a proxima fala comeca do zero
    st.primeira = false;   // a partir de agora ha' conversa gravada pra continuar
    if (st.parandoDeProposito) return;
    if (codigo !== 0) {
      emit(paneId, 'note', { text: motivoDoCli(st.erro, cli, codigo), error: true });
    }
    emit(paneId, 'turn-end', {});
  });
  proc.on('error', (e) => {
    if (cliPanes.get(paneId) !== st) return;
    st.proc = null;
    emit(paneId, 'engine-down', { motivo: 'Não consegui rodar o ' + cli.nome + ': ' + (e && e.message || e) });
  });
  return true;
}

/* Traduz o que o Gemini/Grok fala para os mesmos avisos que a tela ja entende.
   O vocabulario deles e' quase o mesmo do Claude Code, o que faz esta ponte
   caber em poucas linhas. */
function cliEvento(paneId, st, ev) {
  const tipo = ev && ev.type;
  if (!tipo) return;
  if (tipo === 'init') {
    if (ev.session_id && ev.session_id !== st.sessao) {
      st.sessao = ev.session_id;
      emit(paneId, 'sessao', { id: ev.session_id, file: acharArquivoSessao(st.engine, ev.session_id) });
    }
    return;
  }
  if (tipo === 'message') {
    // a fala do usuario o painel ja desenhou quando voce mandou
    if (ev.role === 'user') return;
    const txt = typeof ev.content === 'string' ? ev.content : textoDeConteudo(ev.content);
    if (!txt) return;
    /* a resposta chega em pedacos. Sem juntar, cada pedaco virava uma BOLHA
       separada na tela ("Claro" / ", vou" / " olhar"...), o historico ficava
       picado e bloco de codigo partido no meio nunca era desenhado. */
    if (!st.msgId) { somaSeq(paneId); st.msgId = 'm' + seqDoPane(paneId); st.acc = ''; }
    st.acc = (st.acc || '') + txt;
    /* nao redesenha a cada pedaco: desenhar de novo custa o texto INTEIRO, e com
       195 pedacos isso ja foi medido em 20x mais processador. Junta e manda no
       maximo 10 vezes por segundo -- o mesmo freio que o Claude usa. */
    mandarFala(paneId, st);
    return;
  }
  if (tipo === 'tool_use') {
    mandarFala(paneId, st, true);   // fecha a fala antes do passo
    st.msgId = null; st.acc = '';   // o que ele falar depois da ferramenta e' outra fala
    /* a checklist do Gemini (write_todos: {todos:[{description,status}]},
       formato lido no bundle do CLI) vira o MESMO plano vivo do Claude/Codex,
       em vez de um passo mudo "write_todos" */
    const nomeFerr = ev.tool_name || ev.name || '';
    if (nomeFerr === 'write_todos') {
      const ts = ((ev.parameters && ev.parameters.todos) || (ev.args && ev.args.todos) || []);
      if (Array.isArray(ts) && ts.length) {
        emit(paneId, 'plano', { itens: ts.slice(0, 30).map((t) => ({
          txt: String((t && (t.description || t.content)) || '').slice(0, 200),
          estado: t && t.status === 'completed' ? 'feito' : (t && (t.status === 'in_progress' || t.status === 'inProgress') ? 'fazendo' : 'pendente'),
        })).filter((x) => x.txt) });
        return;
      }
    }
    emit(paneId, 'tool-start', {
      id: ev.tool_id || ev.id || ('t' + Date.now()),
      name: nomeFerr || 'ferramenta',
      arg: resumoDoArgumento(ev.parameters || ev.args),
    });
    return;
  }
  if (tipo === 'tool_result') {
    const saida = typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output || '');
    emit(paneId, 'tool-end', {
      id: ev.tool_id || ev.id, output: String(saida || '').slice(0, 8000),
      error: ev.status === 'error' || !!ev.error,
    });
    return;
  }
  if (tipo === 'error') {
    const cli = CLIS[st.engine];
    emit(paneId, 'note', { text: motivoDoCli(ev.message, cli, 0), error: true });
    return;
  }
  if (tipo === 'result') {
    const s = ev.stats || {};
    const entrada = s.input_tokens || s.inputTokens || 0;
    const saida = s.output_tokens || s.outputTokens || 0;
    // 'total' e' o nome que a tela le; mandar 'janela: 0' zerava a barrinha
    if (entrada || saida) emit(paneId, 'tokens', { total: entrada + saida });
    // e o consumo DESTE turno vai pro carimbo de fim de turno
    if (entrada || saida) emit(paneId, 'turno-uso', { entrada, saida });
    if (ev.status === 'error' && ev.error) {
      emit(paneId, 'note', { text: motivoDoCli(ev.error.message, CLIS[st.engine], 0), error: true });
    }
    // o 'turn-end' sai no fechamento do processo, pra nao terminar antes da hora
  }
}

/* Manda a fala acumulada com freio. O ultimo pedaco nunca se perde: quem
   termina o turno chama isto com "agora" e o que estiver pendente sai. */
function mandarFala(paneId, st, agora) {
  if (!st.msgId) return;
  if (agora) {
    if (st.timerFala) { clearTimeout(st.timerFala); st.timerFala = null; }
    emit(paneId, 'text-final', { id: st.msgId, text: st.acc });
    return;
  }
  if (st.timerFala) return;
  st.timerFala = setTimeout(() => {
    st.timerFala = null;
    if (st.msgId) emit(paneId, 'text-final', { id: st.msgId, text: st.acc });
  }, 100);
}

// texto de um conteudo que pode vir como lista de blocos
function textoDeConteudo(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).filter(Boolean).join('');
}

// so' o essencial do argumento, que e' o que cabe na linha do passo
function resumoDoArgumento(a) {
  if (!a) return '';
  if (typeof a === 'string') return a.slice(0, 200);
  const p = a.file_path || a.path || a.absolute_path || a.command || a.pattern || a.query || a.url;
  if (p) return String(p).slice(0, 200);
  try { return JSON.stringify(a).slice(0, 200); } catch { return ''; }
}

/* Quais motores existem nesta maquina. A tela usa isto pra nao oferecer um
   motor que nao esta' instalado -- e pra explicar como instalar, em vez de
   deixar o painel falhar depois que voce ja mandou a mensagem. */
const iasAcp = require('./renderer/acp-presets');   // leva 5i: a tabela das IAs do ACP, a mesma da tela e do servidor
ipcMain.handle('motores:disponiveis', async (_e, pedido) => {
  if (pedido?.remoto != null) return remoteEngines.inspect(pedido.remoto);
  const out = {
    claude: fs.existsSync(claudeBin()) || temBin('claude'),
    codex: temBin('codex'),
  };
  for (const eng of Object.keys(CLIS)) out[eng] = temBin(CLIS[eng].bin);
  /* o comando do agente ACP e' configuravel; "disponivel" = ha' com que rodar algum preset. Leva 5i: cada preset (OpenCode, Cursor, Goose…)
     confere o PROPRIO programa, o 1o termo do comando (antes so' se via gemini, npx, opencode e qwen), e o motor ACP fica disponivel se houver
     qualquer um. Os adaptadores do Gemini, do Claude Code e do Codex continuam contando (gemini e npx). A lista dos instalados vai no
     modo detalhado, dentro da entrada do acp, para o menuzinho do motor mostrar so' os logos das IAs que existem. */
  const presets = iasAcp.instalados(temBin);
  out.acp = presets.length > 0;
  return pedido?.detalhado ? Object.fromEntries(Object.entries(out).map(([e, disponivel]) => [e, { disponivel, remoto: false, ...(e === 'acp' ? { presets } : {}) }])) : out;
});

/* ===== versao instalada x ultima de cada motor =====
   Este radar achou o Claude 13 versoes atras sem ninguem saber. A checagem
   roda no maximo 1x a cada 20h (cache em disco) e nunca atrapalha o boot:
   quem chama e' a tela, atrasado, e qualquer falha vira lista vazia. */
const VERSOES_PATH = () => path.join(app.getPath('userData'), 'versoes-motores.json');
const NPM_DOS_MOTORES = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
};
ipcMain.handle('motores:versoes', async () => {
  try {
    const c = JSON.parse(fs.readFileSync(VERSOES_PATH(), 'utf8'));
    if (c && c.quando && (Date.now() - c.quando) < 20 * 60 * 60 * 1000) return c.dados || {};
  } catch {}
  const dados = {};
  const soVersao = (s) => { const m = String(s || '').match(/(\d+\.\d+\.\d+)/); return m ? m[1] : ''; };
  for (const eng of Object.keys(NPM_DOS_MOTORES)) {
    const bin = eng === 'claude' ? claudeBin() : eng;
    if (eng !== 'claude' && !temBin(bin)) continue;   // motor que nao esta na maquina nao entra
    const [inst, ult] = await Promise.all([
      rodar(bin, ['--version'], 15000).then((r) => soVersao(r.out + ' ' + r.errout)).catch(() => ''),
      rodar('npm', ['view', NPM_DOS_MOTORES[eng], 'version'], 20000).then((r) => soVersao(r.out)).catch(() => ''),
    ]);
    if (inst) dados[eng] = { instalada: inst, ultima: ult };
  }
  try { gravarSeguro(VERSOES_PATH(), JSON.stringify({ quando: Date.now(), dados })); } catch {}
  return dados;
});

/* Sessoes do Claude vivas nesta maquina, dentro OU fora do Cockpit (VS Code,
   terminal, Telegram): 'claude agents --json'. Cache curto porque a Torre
   repinta a cada poucos segundos e o comando leva ~1s.
   Leva 41: a resposta so' diz ok quando leu uma LISTA de verdade (antes, JSON
   torto ou vazio virava "nenhuma" calado); UMA busca em voo por vez (dois
   cliques em "Atualizar" subiam dois processos); 'forcar' fura o cache mas
   pega carona na busca que ja' esta' voando. */
let cacheAgentes = { quando: 0, itens: [] };
let buscaAgentes = null;
/* De onde a sessao veio. O 'kind' do 'claude agents' e' sempre 'interactive';
   quem sabe a porta de entrada e' o registro ~/.claude/sessions/<pid>.json
   ("cockpit", "cli", "claude-vscode"...). Sem o arquivo, fica vazio -- a tela
   diz "sessão do Claude" em vez de chutar. */
function origemDaSessao(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return '';
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'sessions', n + '.json'), 'utf8'));
    // numero de processo reaproveitado pelo Windows nao pode emprestar a origem de outro
    if (!reg || Number(reg.pid) !== n) return '';
    return String(reg.entrypoint || '').slice(0, 40);
  } catch { return ''; }
}
function buscarAgentesClaude() {
  return rodar(claudeBin(), ['agents', '--json'], 20000).then((r) => {
    // rodar() nao rejeita: falha e timeout chegam como {err} com saida vazia
    const txt = String((r && r.out) || '').trim();
    if (r && r.err && !txt) return { ok: false, erro: String((r.err && r.err.message) || r.err).slice(0, 100) };
    let arr = null;
    try { arr = JSON.parse(txt); } catch { return { ok: false, erro: 'a resposta do claude agents veio ilegível' }; }
    if (!Array.isArray(arr)) return { ok: false, erro: 'a resposta do claude agents não é uma lista' };
    const itens = arr.filter((a) => a && typeof a === 'object').map((a) => ({
      pid: Number(a.pid) || 0, cwd: String(a.cwd || ''), kind: String(a.kind || ''), startedAt: Number(a.startedAt) || 0,
      sessionId: String(a.sessionId || ''), name: String(a.name || ''), status: String(a.status || ''),
      origem: origemDaSessao(a.pid),
    }));
    cacheAgentes = { quando: Date.now(), itens };
    return { ok: true };
  }, (e) => ({ ok: false, erro: String((e && e.message) || e).slice(0, 100) }));
}
ipcMain.handle('agentes:claude', async (_e, o) => {
  const forcar = !!(o && o.forcar);
  let r = { ok: true };
  if (buscaAgentes || forcar || !cacheAgentes.quando || Date.now() - cacheAgentes.quando >= 15000) {
    if (!buscaAgentes) buscaAgentes = buscarAgentesClaude().finally(() => { buscaAgentes = null; });
    r = await buscaAgentes;
  }
  if (!r.ok) return { ok: false, erro: r.erro || 'sem resposta' };
  /* "daqui" = processo que ESTE Cockpit abriu (o pid bate com um painel dele).
     Conferido na hora de responder, nao na hora de ler: o cache dura 15 s e
     paineis nascem e morrem nesse meio tempo. */
  const meus = new Set([...claudePanes.values()].map((s) => s && s.proc && s.proc.pid).filter(Boolean));
  return { ok: true, quando: cacheAgentes.quando, itens: cacheAgentes.itens.map((a) => ({ ...a, daqui: meus.has(a.pid) })) };
});

/* ===================== ROTINAS: as tarefas agendadas do Windows =====================
   As automacoes que rodam sozinhas nesta maquina (backup da VPS, radar diario,
   gestor de trafego...). O buraco que isto tapa e' o SILENCIO: quando uma para
   de rodar, ninguem fica sabendo -- duas estavam paradas ha semanas sem aviso
   nenhum. Por isso o que vale aqui e' a falha, e ela sai traduzida em vez do
   codigo hexadecimal cru do Agendador.
   So' Windows: em outro sistema o Agendador nem existe. */

/* Um comando so' por chamada, no mesmo espirito dos scripts remotos. Vai por
   -EncodedCommand (base64 de UTF-16) porque o script tem aspas, contrabarra e
   quebra de linha: passar isso como texto solto na linha de comando do Windows
   e' pedir pra quebrar. O ProgressPreference calado tira o CLIXML que o
   PowerShell despeja no stderr a cada modulo que carrega.
   Ano < 2000 e' o "nunca rodou" do Agendador (ele grava 1899 ou 1999). */
const ROTINAS_PS = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  "function Dt($d) { if ($null -eq $d) { return '' } if ($d.Year -lt 2000) { return '' } return $d.ToString('o') }",
  '$out = @()',
  'foreach ($t in (Get-ScheduledTask)) {',
  "  if ($t.TaskPath -like '\\Microsoft\\*' -or $t.TaskPath -like '\\Windows\\*') { continue }",
  '  $i = $null',
  '  try { $i = Get-ScheduledTaskInfo -InputObject $t } catch {}',
  // a primeira acao que roda um programa (acao COM ou de e-mail nao tem Execute)
  '  $acao = @($t.Actions | Where-Object { $_.Execute }) | Select-Object -First 1',
  '  $out += [pscustomobject]@{',
  '    nome = [string]$t.TaskName',
  '    caminho = [string]$t.TaskPath',
  '    estado = [string]$t.State',
  "    ultima = if ($i) { Dt $i.LastRunTime } else { '' }",
  // LastTaskResult e' UInt32: 0xC000013A nao cabe em Int32 e [int] estoura
  '    resultado = if ($i -and $null -ne $i.LastTaskResult) { [int64]$i.LastTaskResult } else { $null }',
  "    proxima = if ($i) { Dt $i.NextRunTime } else { '' }",
  // autor e programa: e' este par que separa as automacoes DELE das do sistema
  '    autor = [string]$t.Author',
  '    programa = [string]$acao.Execute',
  /* leva 41: o que a tela precisava e nao tinha. A descricao diz em portugues o
     que a automacao faz (o Hugo escreve uma em quase todas); argumentos e pasta
     de trabalho dizem ONDE ela mora (o "abrir a pasta"); os gatilhos dizem de
     quanto em quanto ela roda -- sem eles, as que rodam "ao entrar no Windows"
     apareciam como "sem proxima marcada", como se estivessem paradas. */
  '    descricao = [string]$t.Description',
  '    args = [string]$acao.Arguments',
  '    pastaTrabalho = [string]$acao.WorkingDirectory',
  '    gatilhos = @($t.Triggers | ForEach-Object { [pscustomobject]@{',
  '      tipo = [string]$_.CimClass.CimClassName',
  '      inicio = [string]$_.StartBoundary',
  '      dias = $_.DaysInterval',
  '      semanas = $_.WeeksInterval',
  '      diasSemana = $_.DaysOfWeek',
  "      intervalo = if ($_.Repetition) { [string]$_.Repetition.Interval } else { '' }",
  // Enabled pode vir nulo: nulo NAO e' desligado
  '      ativo = ($_.Enabled -ne $false)',
  '      mudanca = $_.StateChange',
  '    } })',
  '  }',
  '}',
  // -Depth 5: tarefa > gatilhos > gatilho. Com 3 o gatilho virava texto
  'ConvertTo-Json -InputObject @($out) -Compress -Depth 5',
].join('\n');

const psBase64 = (script) => Buffer.from(script, 'utf16le').toString('base64');
// texto literal do PowerShell: aspas simples nao interpolam nada, e a unica
// fuga dentro delas e' dobrar a propria aspa
const psTexto = (s) => "'" + String(s).replace(/['‘’‚‛]/g, (c) => c + c) + "'";   // o PowerShell tambem fecha string em ’ ‘ ‚ ‛ (auditoria 1)

/* Erro que sai pelo stderr redirecionado vem serializado em CLIXML. Jogar isso
   na tela e' pior que nao dizer nada: aqui sobra so' o texto das mensagens. */
function psErroLimpo(bruto) {
  let s = String(bruto || '');
  if (/^#< CLIXML/.test(s)) {
    const partes = [...s.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]);
    s = partes.length ? partes.join(' ') : s.replace(/<[^>]*>/g, ' ');
  }
  return s
    .replace(/_x000D__x000A_|_x000D_|_x000A_/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* O Agendador guarda o resultado da ultima execucao como numero. Aqui so'
   entram os codigos de que se tem certeza; o que nao estiver na tabela sai
   como hexadecimal, sem inventar significado. */
const ROTINA_CODIGOS = {
  0x0: 'deu certo',
  0x1: 'o programa terminou com erro',
  0x41300: 'pronta pra rodar',
  0x41301: 'está rodando agora',
  0x41302: 'a tarefa está desativada',
  0x41303: 'nunca rodou',
  0x41304: 'não tem mais execução marcada',
  0x41306: 'a última execução foi interrompida',
  0x41325: 'está na fila do agendador',
  0x8004131f: 'já havia uma execução em andamento',
  0x80070002: 'o Windows não achou o programa da tarefa',
  0x8007010b: 'a pasta de trabalho da tarefa não existe',
  0x800710e0: 'o agendador recusou a execução',
  0xc000013a: 'o processo foi interrompido',
};
/* Resultado diferente de zero que NAO e' falha: sao recados de estado do
   proprio Agendador. Sem esta lista, "nunca rodou" e "rodando agora" pintavam
   de vermelho e afogavam as duas quebras de verdade no meio de dezenas. */
const ROTINA_SEM_FALHA = new Set([0x0, 0x41300, 0x41301, 0x41303, 0x41304, 0x41325]);
const ROTINA_ESTADO = { Ready: 'pronta', Running: 'rodando', Disabled: 'desativada', Queued: 'na fila' };

/* De quem e' a rotina: dele ou do computador?
   MEDIDO nesta maquina em 07/09/2026, nas 35 tarefas de fora de \Microsoft\ e
   \Windows\: a PASTA nao separa nada -- OneDrive, Realtek e Zoom moram na raiz
   "\" igualzinho as automacoes dele. Quem separa e' o par AUTOR + PROGRAMA:
     - dele: Author vazio ou o proprio usuario do Windows (HUGOMOTTI\hugom) E o
       programa e' um interpretador de script (wscript, powershell, pwsh...) ou
       mora dentro da pasta do usuario;
     - do PC: Author de fabricante ("Microsoft Corporation", "Realtek",
       "Zoom Communications, Inc.", "Samsung Recovery 8"...) ou programa
       instalado em Program Files / Windows.
   Conferido nas 35 desta maquina: as 19 dele entram e as 16 de fabricante ficam
   de fora -- inclusive as tres do Chrome, que trazem o usuario como Author mas
   rodam um .exe de Program Files.
   E quando NAO ha' programa nenhum? A acao pode ser COM handler ou e-mail, e ai
   nao existe caminho pra olhar. Nesse caso vale a mesma politica da tela ("na
   duvida a rotina e' DELE, porque o erro de esconder e' pior"), com dois
   desempates antes do chute -- estao no fim do rotinaEhDele.
   Isto NAO esconde nada: a tela mostra os dois grupos. So' o destaque vermelho
   fica com o que e' dele. Antes o bloco vinha com 4 falhas e metade era ruido
   (OneDrive 0x8004EE04 e Realtek 0x40010004 no meio de RadarSkillsMCP
   0x800710E0 e SkillReviewMensal 0xC000013A). */
const USUARIO_DA_MAQUINA = (() => {
  let u = '';
  try { u = os.userInfo().username; } catch { u = ''; }
  return String(u || process.env.USERNAME || '').trim().toLowerCase();
})();
const RODA_SCRIPT = /^(wscript|cscript|powershell|pwsh|cmd|node|python|python3|py|bash|sh)(\.exe)?$/i;
// tudo em minusculas e com uma barra so', pra comparar caminho do Windows sem susto
const soUmaBarra = (x) => String(x || '').toLowerCase().split('/').join('\\').replace(/\\+$/, '');
function rotinaEhDele(autor, programa, caminho) {
  const a = String(autor || '').trim();
  // "HUGOMOTTI\hugom" -> "hugom"; autor vazio tambem conta (o agendador nao exige um)
  const assinou = !!a && !!USUARIO_DA_MAQUINA && a.toLowerCase().split('\\').pop() === USUARIO_DA_MAQUINA;
  const dono = !a || assinou;
  if (!dono) return false;
  // o Agendador guarda o programa com aspas (as vezes duas), como em ""C:\...\x.exe""
  const p = String(programa || '').trim().replace(/^"+/, '').replace(/"+$/, '');
  if (p) {
    const nome = soUmaBarra(p).split('\\').pop();
    if (RODA_SCRIPT.test(nome)) return true;
    const casa = soUmaBarra(HOME);
    return !!casa && soUmaBarra(p).startsWith(casa + '\\');
  }
  /* SEM programa: a acao nao e' "rode este .exe" -- e' COM handler ou e-mail, e
     nao sobrou caminho pra olhar. Isto virava "nao e' dele" DURO, e a rotina caia
     no grupo recolhido "Do sistema e de programas" -- justamente onde o destaque
     de falha nao chega. A tela ja' decide o contrario quando falta o campo
     (t.dele !== false, "na duvida a rotina e' DELE, porque o erro de esconder e'
     pior"); agora o main diz a mesma coisa. Dois desempates antes do chute, pra
     duvida nao virar ruido no bloco vermelho:
       1. ele mesmo assinou a tarefa -- ai nao ha' duvida nenhuma;
       2. senao, o chute so' vale na RAIZ do Agendador, que e' onde as 19 dele
          moram. Pasta de fabricante nao ganha o beneficio da duvida: as quatro
          SoftLanding* desta maquina sao exatamente este caso (COM handler, sem
          autor e sem programa) e vivem em \SoftLanding\S-1-5-21-...\ -- seguem
          fora, e o total continua 19 dele / 16 de fabricante. */
  if (assinou) return true;
  const c = String(caminho == null ? '\\' : caminho).trim();
  return c === '' || c === '\\' || c === '/';
}
const rotinaHex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase();
function rotinaMotivo(n) {
  if (!Number.isFinite(n)) return '';
  const conhecido = ROTINA_CODIGOS[n];
  if (conhecido) return conhecido;
  // 1..255 e' codigo de saida de programa, nao codigo do Windows
  if (n > 0 && n < 256) return 'o programa saiu com código ' + n;
  return 'código ' + rotinaHex(n);
}
const rotinaFalhou = (n) => Number.isFinite(n) && !ROTINA_SEM_FALHA.has(n);

/* De quanto em quanto a automacao roda, em portugues ("todo dia", "seg a sex, a
   cada 10 min", "ao entrar no Windows"). Sem isto, as 7 desta maquina que rodam
   ao entrar no Windows diziam "sem proxima marcada" -- como se estivessem
   paradas. A hora fica de fora: a tela ja' mostra a proxima execucao.
   Gatilho mensal chega do Windows sem os dias (classe generica MSFT_TaskTrigger):
   ai' volta vazio e a tela fica so' com a proxima, sem inventar. */
const ROTINA_DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ROTINA_DIA_TODO = ['todo domingo', 'toda segunda', 'toda terça', 'toda quarta', 'toda quinta', 'toda sexta', 'todo sábado'];
// "PT10M" -> "10 min", "PT1H30M" -> "1 h 30 min", "P1D" -> "1 dia"
function rotinaDuracao(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || '').trim());
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return '';
  const partes = [];
  if (+m[1]) partes.push(m[1] + (+m[1] === 1 ? ' dia' : ' dias'));
  if (+m[2]) partes.push(m[2] + ' h');
  if (+m[3]) partes.push(m[3] + ' min');
  if (+m[4] && !partes.length) partes.push(m[4] + ' s');
  return partes.join(' ');
}
function rotinaDiasDaSemana(mascara) {
  const n = Number(mascara) || 0;
  const dias = [0, 1, 2, 3, 4, 5, 6].filter((i) => n & (1 << i));
  if (!dias.length) return '';
  if (dias.length === 7) return 'todo dia';
  if (dias.length === 1) return ROTINA_DIA_TODO[dias[0]];
  if (dias.join() === '1,2,3,4,5') return 'seg a sex';
  const nomes = dias.map((i) => ROTINA_DIA_CURTO[i]);
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}
function rotinaRepeteUm(g) {
  const tipo = String((g && g.tipo) || '').replace(/^MSFT_Task/, '').replace(/Trigger$/, '');
  const cada = rotinaDuracao(g && g.intervalo);
  const aCada = cada && cada !== '1 dia' ? 'a cada ' + cada : '';
  if (tipo === 'Daily') {
    const d = Number(g.dias) || 1;
    return [d > 1 ? 'a cada ' + d + ' dias' : 'todo dia', aCada].filter(Boolean).join(', ');
  }
  if (tipo === 'Weekly') {
    const s = Number(g.semanas) || 1;
    const dias = rotinaDiasDaSemana(g.diasSemana) || 'toda semana';
    return [dias + (s > 1 ? ', a cada ' + s + ' semanas' : ''), aCada].filter(Boolean).join(', ');
  }
  if (tipo === 'Time') return cada === '1 dia' ? 'todo dia' : (aCada || 'uma vez só');
  if (tipo === 'Logon') return 'ao entrar no Windows';
  if (tipo === 'Boot') return 'ao ligar o PC';
  if (tipo === 'Idle') return 'com o PC parado';
  if (tipo === 'Event') return 'quando o Windows registra um evento';
  if (tipo === 'Registration') return 'quando foi criada';
  if (tipo === 'SessionStateChange') {
    const m = Number(g.mudanca);
    return m === 8 ? 'ao desbloquear a tela' : m === 7 ? 'ao bloquear a tela' : 'ao mudar de sessão';
  }
  return '';   // generico (mensal) ou desconhecido: nao inventa
}
function rotinaRepete(gatilhos) {
  const lista = Array.isArray(gatilhos) ? gatilhos : (gatilhos ? [gatilhos] : []);
  const textos = [];
  for (const g of lista) {
    if (!g || g.ativo === false) continue;
    const t = rotinaRepeteUm(g);
    if (t && !textos.includes(t)) textos.push(t);
  }
  return textos.slice(0, 2).join(' e ') + (textos.length > 2 ? '…' : '');
}

/* Onde a automacao mora, pro "abrir a pasta": a pasta de trabalho; senao a do
   script que ela roda (quase todas as dele sao wscript/pwsh + um .vbs/.ps1 nos
   argumentos); senao a do proprio programa, se nao for um interpretador (esse
   mora no System32 e nao diz nada). Sem path.win32 de proposito: e' texto do
   Windows, e isto roda igual em qualquer sistema (e no teste). */
const ROTINA_SCRIPT = /\.(vbs|vbe|js|wsf|ps1|cmd|bat|py|pyw|sh)$/i;
const rotinaSemAspas = (x) => String(x || '').trim().replace(/^"+/, '').replace(/"+$/, '').trim();
const rotinaPastaDe = (p) => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  const d = i > 0 ? p.slice(0, i) : '';
  return /^[a-z]:$/i.test(d) ? d + '\\' : d;   // "C:\x.ps1" mora em "C:\", nao em "C:"
};
const rotinaEhAbsoluto = (p) => /^[a-z]:[\\/]/i.test(p) || /^\\\\[^\\]/.test(p);
function rotinaScript(args) {
  const s = String(args || '');
  for (const m of s.matchAll(/"([^"]+)"|(\S+)/g)) {
    const p = rotinaSemAspas(m[1] || m[2]);
    if (rotinaEhAbsoluto(p) && ROTINA_SCRIPT.test(p)) return p;
  }
  return '';
}
function rotinaPasta(programa, args, pastaTrabalho) {
  const pt = rotinaSemAspas(pastaTrabalho);
  if (pt && rotinaEhAbsoluto(pt) && !pt.includes('%')) return pt.replace(/[\\/]+$/, '');
  const script = rotinaScript(args);
  if (script) return rotinaPastaDe(script);
  const p = rotinaSemAspas(programa);
  if (p && rotinaEhAbsoluto(p) && !RODA_SCRIPT.test(p.split(/[\\/]/).pop())) return rotinaPastaDe(p);
  return '';
}
// o que ela roda, em uma palavra: o script, ou o programa
function rotinaPrograma(programa, args) {
  const alvo = rotinaScript(args) || rotinaSemAspas(programa);
  return alvo ? alvo.split(/[\\/]/).pop() : '';
}

let cacheRotinas = { quando: 0, itens: [] };
let rotinasEmVoo = null;   // a leitura que o PowerShell esta' fazendo agora (uma por vez)
/* Sobe a cada acao que muda o Agendador (rodar, ligar, desligar). Leitura que
   comecou ANTES da acao nao serve pra ninguem que pergunta DEPOIS dela, nem
   pode gravar no cache. Provado na tela: uma leitura em voo durante o
   "desligar" era reaproveitada e a linha voltava a dizer "pronta". */
let rotinasVersao = 0;
/* leva 41: o botao "Atualizar agora" da tela passa { forcar: true } e fura o
   cache de 15 s -- antes, clicado ate' 15 s depois da ultima leitura, ele
   devolvia a MESMA lista e nada mudava (a tarefa que acabou de rodar seguia
   "rodando agora"). Quem chega com uma leitura em voo pega a resposta dela:
   dois pedidos juntos nao sobem dois PowerShell (mesma regra da Torre). */
ipcMain.handle('rotinas:listar', async (_e, o) => {
  if (!EH_WIN) return { itens: [], error: 'As automações agendadas só existem no Windows.' };
  const forcar = !!(o && o.forcar === true);
  if (!forcar && Date.now() - cacheRotinas.quando < 15000) return { itens: cacheRotinas.itens };
  if (!rotinasEmVoo) {
    const p = lerRotinasDoAgendador(rotinasVersao).finally(() => { if (rotinasEmVoo === p) rotinasEmVoo = null; });
    rotinasEmVoo = p;
  }
  return rotinasEmVoo;
});
async function lerRotinasDoAgendador(versao) {
  try {
    const r = await rodar('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psBase64(ROTINAS_PS)], 30000);
    /* rodar() nao rejeita: falha e timeout chegam como {err} com saida vazia, e
       isso nao pode virar "nenhuma rotina" nem apagar a lista boa de antes. O
       motivo do PowerShell vale mais que "saiu com codigo 1". */
    if (r.err && !String(r.out || '').trim()) {
      const detalhe = psErroLimpo(r.errout);
      throw new Error(detalhe ? detalhe.slice(0, 160) : String((r.err && r.err.message) || r.err));
    }
    const arr = JSON.parse(String(r.out || '').trim() || '[]');
    // campo a campo, com o tipo forcado: objeto cru do PowerShell nunca sai daqui
    const itens = (Array.isArray(arr) ? arr : []).map((t) => {
      /* resultado ausente e' DESCONHECIDO, nunca zero: Number(null) e Number('')
         dao 0, e 0 e' "deu certo" -- seria o app dizendo que rodou bem uma
         rotina sobre a qual nao sabe nada. */
      const cru = t ? t.resultado : null;
      const resultado = (cru === null || cru === undefined || cru === '' || !Number.isFinite(Number(cru))) ? null : Number(cru);
      const estadoBruto = String((t && t.estado) || '');
      const estado = ROTINA_ESTADO[estadoBruto] || (estadoBruto ? estadoBruto.toLowerCase() : 'desconhecida');
      /* Rotina que esta' RODANDO AGORA nao pode sair como quebrada: o resultado
         guardado e' o da execucao ANTERIOR. Ao vivo nesta maquina:
         "RtkAudUService64_BG || falhou em hoje 13:00: codigo 0x40010004" -- e o
         estado dela era Running. Quem esta' trabalhando ganha do codigo velho. */
      const rodando = estado === 'rodando';
      return {
        nome: String((t && t.nome) || ''),
        caminho: String((t && t.caminho) || '\\'),
        estado,
        ultima: String((t && t.ultima) || ''),
        proxima: String((t && t.proxima) || ''),
        resultado,
        motivo: rotinaMotivo(resultado),
        falhou: rotinaFalhou(resultado) && !rodando,
        // e' automacao dele ou tarefa de fabricante? separa o destaque do ruido
        dele: rotinaEhDele(t && t.autor, t && t.programa, t && t.caminho),
        // leva 41: o que ela faz, de quanto em quanto roda e onde mora
        descricao: String((t && t.descricao) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        repete: rotinaRepete(t && t.gatilhos),
        pasta: rotinaPasta(t && t.programa, t && t.args, t && t.pastaTrabalho),
        programa: rotinaPrograma(t && t.programa, t && t.args),
      };
    }).filter((t) => t.nome);
    // lida antes de uma acao que ja' terminou: responde a quem pediu, mas nao vira cache
    if (versao === rotinasVersao) cacheRotinas = { quando: Date.now(), itens };
    return { itens };
  } catch (e) { return { itens: cacheRotinas.itens, velho: cacheRotinas.itens.length > 0, error: String(e && e.message || e).slice(0, 200) }; }
}

/* Um comando do Agendador sobre UMA tarefa (rodar, ligar, desligar), com a
   mesma conferencia e a mesma traducao de erro pros tres. */
async function rotinaNoAgendador(cmdlet, nome, caminho, naoConfirmou) {
  if (!EH_WIN) return { error: 'As automações agendadas só existem no Windows.' };
  const n = String(nome || '');
  const c = String(caminho || '\\');
  /* nome vem da tela, entao e' conferido aqui tambem: quebra de linha ou byte
     zero dentro do script do PowerShell viraria outro comando. Espaco e acento
     passam -- metade das tarefas desta maquina tem ("OneDrive Reporting Task"). */
  if (!n || n.length > 300 || /[\r\n\0]/.test(n)) return { error: 'nome de rotina inválido' };
  if (c.length > 300 || /[\r\n\0]/.test(c)) return { error: 'caminho de rotina inválido' };
  try {
    /* O erro sai pelo stdout, em texto: se ele fosse pro stderr o PowerShell o
       serializaria em CLIXML (uma sopa de XML), e era ISSO que ia parar na
       faixa de avisos no lugar do motivo. Enable/Disable devolvem a tarefa: o
       Out-Null cala isso, senao o "ok" nao seria a ultima linha. */
    const script = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
      'try { ' + cmdlet + ' -TaskName ' + psTexto(n) + ' -TaskPath ' + psTexto(c) + " | Out-Null; Write-Output 'ok' }",
      "catch { Write-Output ('erro: ' + $_.Exception.Message) }",
    ].join('\n');
    const r = await rodar('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psBase64(script)], 30000);
    const saida = String(r.out || '').replace(/\r/g, '').trim();
    if (/(^|\n)ok$/.test(saida)) {
      cacheRotinas.quando = 0;   // proxima leitura ja pega o estado novo
      rotinasVersao++;           // ...e nao pega carona numa leitura de ANTES da acao
      rotinasEmVoo = null;
      return { ok: true };
    }
    const dito = /(^|\n)erro:\s*([\s\S]*)$/.exec(saida);
    const bruto = psErroLimpo(dito ? dito[2] : (r.errout || saida));
    const motivo = /não pode encontrar|não foi encontrad|was not found|cannot find|does not exist|No MSFT_ScheduledTask/i.test(bruto) ? 'o Windows não achou essa rotina'
      : /Acesso negado|Access is denied|denied|não autorizad|Unauthorized/i.test(bruto) ? 'o Windows negou acesso (a rotina pode pedir administrador)'
      // provado com tarefa de teste: rodar uma desligada da' "A tarefa está desabilitada." (0x80041326)
      : /desabilitad|is disabled|0x80041326/i.test(bruto) ? 'ela está desligada: ligue antes de rodar'
      : bruto ? bruto.slice(0, 160)
      : (r.err ? 'o agendador não respondeu' : naoConfirmou);
    return { error: motivo };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
}
ipcMain.handle('rotinas:disparar', async (_e, { nome, caminho } = {}) =>
  rotinaNoAgendador('Start-ScheduledTask', nome, caminho, 'o agendador não confirmou o disparo'));
/* leva 41: ligar/desligar. Desligar NAO apaga nada: a tarefa fica no Agendador,
   so' para de rodar sozinha ate' ser ligada de novo. 'ligar' tem que vir
   true/false de verdade -- qualquer outra coisa e' pedido quebrado, e na duvida
   nao se mexe numa automacao. */
ipcMain.handle('rotinas:ligar', async (_e, { nome, caminho, ligar } = {}) => {
  if (typeof ligar !== 'boolean') return { error: 'pedido inválido (ligar ou desligar?)' };
  return rotinaNoAgendador(ligar ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask', nome, caminho,
    ligar ? 'o agendador não confirmou que ligou' : 'o agendador não confirmou que desligou');
});

/* Pasta de trabalho de um motor LOCAL. Se ela sumiu (apagada, renomeada, pen
   drive ou unidade do Drive que nao montou), o spawn morria com "ENOENT" e
   parecia que o motor nem estava instalado. Agora abre na pasta pessoal e diz.
   Pura: 'existe' vem de fora (o teste passa um falso). */
function cwdQueExiste(p, home, existe) {
  if (!p) return { cwd: home, aviso: '' };
  if (existe(p)) return { cwd: p, aviso: '' };
  return { cwd: home, aviso: 'A pasta ' + p + ' não existe mais (ou a unidade não está montada). Abri na sua pasta pessoal.' };
}
const ehPasta = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/* Religar sozinho (leva 41, B2) nunca pode criar um SEGUNDO motor numa conversa
   que outro painel vivo ja esta usando: dois 'claude --resume' no mesmo .jsonl
   se atropelam, e no Codex o threadToPane seria roubado. */
function outroDonoDaSessao(engine, sessaoId, paneId) {
  if (!sessaoId) return null;
  if (engine === 'codex') {
    const dono = codex.threadToPane.get(sessaoId);
    return (dono !== undefined && dono !== paneId) ? dono : null;
  }
  for (const id of claudePanes.keys()) if (id !== paneId && vigiaTurno.sessaoDe(id) === String(sessaoId)) return id;
  return null;
}

ipcMain.handle('pane:start', async (_e, { paneId, engine, cwd, model, approval, resumeId, effort, remoto, fork, fallback, sugestoes, worktree, semConectores, abaId, religar, modoAntesDoPlano }) => {
  if (remoto != null) { remotePaneTargets.set(paneId, { engine, remoto }); try { require('./cockpit-remote-transport').target(remoto); } catch(e) { emit(paneId, 'note', { text: e.message, error: true }); return false; } } else remotePaneTargets.delete(paneId);
  if (remoto != null && engine !== 'claude') {
    if (claudePanes.has(paneId)) claudeStop(paneId);
    if (cliPanes.has(paneId)) cliParar(paneId);
    acp.parar(paneId);
    const localThread = codex.paneToThread.get(paneId), localTurn = codex.paneTurn.get(paneId);
    if (localThread && localTurn) void codexReq('turn/interrupt', { threadId: localThread, turnId: localTurn }).catch(() => {});
    if (localThread) codex.threadToPane.delete(localThread);
    codex.paneToThread.delete(paneId); codex.paneTurn.delete(paneId); codex.paneErrors?.delete(paneId);
    vigiaTurno.registrarPainel(paneId, { engine, abaId: abaId || '', remoto: true });
    return remoteEngines.start(paneId, { engine, cwd, model, approval, resumeId, effort, remoto, fork });
  }
  if (remoteEngines.owns(paneId)) await remoteEngines.stop(paneId);
  vigiaTurno.registrarPainel(paneId, { engine, abaId: abaId || '', remoto: !!remoto });
  if (religar && outroDonoDaSessao(engine, resumeId, paneId) != null) {
    emit(paneId, 'note', { text: 'Esta conversa já está aberta em outro painel. Não religuei aqui para não ter dois motores na mesma conversa.', error: true });
    return false;
  }
  // painel remoto: a pasta e' do servidor, nao do disco deste PC
  if (!remoto) {
    const conferida = cwdQueExiste(cwd, HOME, ehPasta);
    if (conferida.aviso) emit(paneId, 'note', { text: conferida.aviso, error: true });
    cwd = conferida.cwd;
  }
  // modoAntesDoPlano (Tarefa 8): so' o Claude usa, pra deixar o Executar do plano voltar pro modo de antes
  if (engine === 'claude') return claudeStart(paneId, { cwd, model, approval, resumeId, effort, remoto, fork, fallback, sugestoes, worktree, semConectores, modoAntesDoPlano });
  if (engine === 'acp') {
    // no painel ACP o "model" e' o COMANDO do agente (gemini --acp, claude-code-acp...)
    if (remoto) { emit(paneId, 'note', { text: 'O agente ACP ainda não roda em servidor remoto.', error: true }); return false; }
    // cartao pendurado e "sempre permitir" sao do agente anterior deste painel
    descartarPermissoes(paneId); autoLiberadas.delete(paneId);
    // quem limpa um start que falhou e' o proprio acp.js, por identidade: um
    // parar(paneId) aqui derrubava o SEGUNDO start (dois Enter durante o "Ligando…")
    try { return await acp.start(paneId, { comando: model, cwd, approval, resumeId }); }
    catch (e) {
      emit(paneId, 'note', { text: 'Não consegui ligar o agente ACP: ' + String(e && e.message || e).slice(0, 300), error: true });
      return false;
    }
  }
  if (ehCli(engine)) return cliStart(paneId, engine, { cwd, model, approval, resumeId, remoto });
  await codexStart();
  /* cartao pendurado e liberacao "sempre" sao da conversa ANTERIOR deste
     painel: comecar outra sem limpar deixava o pedido velho na tela, e o
     clique respondia a uma thread que ja nao existe (o ramo ACP ja fazia isso) */
  descartarPermissoes(paneId); autoLiberadas.delete(paneId);
  // painel que ja tinha thread: sem apagar o vinculo velho, DUAS threads
  // ficavam apontando pro mesmo painel e a antiga nunca era interrompida
  const threadVelha = codex.paneToThread.get(paneId);
  if (threadVelha) codex.threadToPane.delete(threadVelha);
  // quem era o dono desta conversa antes; so' e' desligado se o resume DER CERTO
  const donoAntes = resumeId ? codex.threadToPane.get(resumeId) : undefined;
  /* Retomar conversa passa pelas MESMAS escolhas de uma conversa nova: pasta,
     modo de permissao, modelo e as regras da casa. Antes o resume ia so' com o
     threadId, e a conversa voltava com o que estava gravado no arquivo dela -
     entao trocar pra "Sem pedir permissao" (ou de modelo) na hora de retomar
     nao valia de nada. O app-server 0.147.0 aceita todos esses campos nos dois
     metodos; quem monta e' o codex-protocol.js. */
  const { method, params } = proto.buildThreadOpenRequest({
    resumeId,
    cwd: cwd || HOME,
    model,
    approval,
    developerInstructions: instrucoesCasa(),
  });
  if (method === 'thread/start') params.dynamicTools = cockpitInteractions.dynamicTools();
  let res;
  try { res = await codexReq(method, params); }
  catch (e) {
    if (params.dynamicTools && /unknown field.*dynamic|unsupported.*dynamic|dynamic.*not supported/i.test(e.message)) { delete params.dynamicTools; res = await codexReq(method, params); }
    else throw e;
  }
  codex.paneCwd.set(paneId, cwd || HOME);
  const tid = (res && (res.threadId || (res.thread && res.thread.id))) || resumeId;
  if (!tid) throw new Error('Codex não devolveu a conversa');
  /* Deu certo: agora sim o painel que tinha esta conversa larga o osso. Antes
     do await ele seria desligado mesmo se o resume falhasse - e, pior, ficaria
     "trabalhando" pra sempre, porque nada avisava a tela dele. */
  if (donoAntes !== undefined && donoAntes !== paneId) {
    codex.paneToThread.delete(donoAntes);
    codex.paneTurn.delete(donoAntes); codex.paneErrors?.delete(donoAntes); codex.paneMsgId.delete(donoAntes);
    descartarPermissoes(donoAntes);
    emit(donoAntes, 'turn-end', {});
    emit(donoAntes, 'note', { text: 'Esta conversa foi aberta em outro painel; aqui ela parou.', error: true });
  }
  codex.threadToPane.set(tid, paneId);
  codex.paneToThread.set(paneId, tid);
  emit(paneId, 'sessao', { id: tid, file: (res && res.thread && res.thread.path) || '' });
  return true;
});

/* imagens vao dentro da mensagem; o resto continua indo como caminho no texto */
const MIME_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function blocosDeImagem(anexos) {
  const blocos = [], sobraram = [];
  for (const f of (anexos || [])) {
    const mime = MIME_IMG[path.extname(f).slice(1).toLowerCase()];
    if (!mime) { sobraram.push(f); continue; }
    try {
      if (fs.statSync(f).size > 4 * 1024 * 1024) { sobraram.push(f); continue; }  // pesada: vai o caminho
      blocos.push({ type: 'image', source: { type: 'base64', media_type: mime, data: fs.readFileSync(f).toString('base64') } });
    } catch { sobraram.push(f); }
  }
  return { blocos, sobraram };
}

ipcMain.handle('pane:send', async (_e, { paneId, engine, text, effort, anexos }) => {
  barrarNaJanelaDeTeste();   // janela de teste: nenhuma mensagem sai para motor nenhum (a tela ja barra antes; esta e' a rede de seguranca)
  if (remotePaneTargets.has(paneId) && engine !== 'claude') { vigiaTurno.ligar(paneId); const ok = await remoteEngines.send(paneId, text, effort, anexos); if (!ok) vigiaTurno.desligar(paneId); return ok; }
  // ACP: imagem vai como bloco do protocolo quando o agente anuncia que aceita
  if (engine === 'acp') return acp.enviar(paneId, text, anexos);
  if (ehCli(engine)) {
    // estes motores nao recebem imagem dentro da mensagem: vai o caminho, e o
    // proprio modelo abre o arquivo com a ferramenta de leitura dele
    let t = text;
    const lista = (anexos || []);
    if (lista.length && !t.includes('Arquivos que anexei')) {
      t += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + lista.map((f) => '- ' + f).join('\n');
    }
    return cliEnviar(paneId, t);
  }
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    if (!st) return false;
    const servidorClaude = claudeRemoto.get(paneId);
    if (servidorClaude && anexos?.length) {
      const uploads = remoteClaudeUploads.get(paneId) || { abort: new AbortController(), uploads: [] }; remoteClaudeUploads.set(paneId, uploads);
      try {
        const u = await remoteTransport.upload(servidorClaude, anexos, uploads.abort.signal);
        if (uploads.abort.signal.aborted || claudePanes.get(paneId) !== st) { await u.cleanup(); return false; }
        uploads.uploads.push(u);
        for (let i = 0; i < anexos.length; i++) text = text.split(anexos[i]).join(u.paths[i]);
        text += '\n\nArquivos disponíveis no servidor:\n' + u.paths.join('\n'); anexos = [];
      } catch (e) { emit(paneId, 'note', { text: e.message, error: true }); return false; }
    }
    const { blocos, sobraram } = blocosDeImagem(anexos);
    let t = text;
    // so' lista o que o renderer NAO listou (ele ja cola os nao-imagem no texto);
    // aqui entra apenas imagem que nao coube como imagem (>4MB)
    const jaNoTexto = t.includes('Arquivos que anexei');
    if (sobraram.length && !jaNoTexto) t += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + sobraram.map(f => '- ' + f).join('\n');
    else if (sobraram.length) t += '\n' + sobraram.map(f => '- ' + f).join('\n');
    const content = [...blocos, { type: 'text', text: t }];
    vigiaTurno.ligar(paneId);   // em turno ate' o 'result': se o processo morrer antes, a tela religa
    st.remoteHost?.beginTurn();
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    return true;
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return false;
  // em turno ja' antes da resposta: o turn/start pode levar o turno inteiro pra voltar
  vigiaTurno.ligar(paneId);
  /* imagem vai como item localImage DENTRO do turno - o turn/start aceita
     (conferido no schema do app-server 0.147). Antes ia so' o caminho no texto
     e o modelo precisava abrir o arquivo na mao. */
  const itensImg = [];
  for (const f of (anexos || [])) {
    try {
      if (!MIME_IMG[path.extname(f).slice(1).toLowerCase()]) continue;
      if (fs.statSync(f).size > 20 * 1024 * 1024) continue;   // pesada demais: fica o caminho no texto
      itensImg.push({ type: 'localImage', path: f });
    } catch {}
  }
  // prazo longo: se o app-server so' responde quando o turno acaba, o padrao de
  // 30s dizia "falhou" com o trabalho ainda rodando na tela
  try {
    await codexReq('turn/start', { threadId: tid, input: [...itensImg, { type: 'text', text }], ...(effort ? { effort } : {}) }, 15 * 60 * 1000);
  } catch (e) {
    /* o turno nem comecou: nao fica marcado como "em turno". Se foi o servidor
       que caiu, o 'engine-down' ja' saiu antes (o close avisa primeiro). */
    vigiaTurno.desligar(paneId);
    throw e;
  }
  return true;
});

ipcMain.handle('pane:compactar', async (_e, { paneId, engine }) => {
  if (JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };   // "/compact" e' uma mensagem ao motor
  if (remotePaneTargets.has(paneId) && engine !== 'claude') return remoteEngines.operation(paneId, 'compactar');
  if (engine === 'acp') return { error: 'O agente ACP não tem "compactar" por aqui. Comece uma conversa nova quando ela ficar longa.' };
  if (ehCli(engine)) {
    return { error: 'O ' + (CLIS[engine] ? CLIS[engine].nome : engine) + ' não tem "compactar". Comece uma conversa nova quando ela ficar longa.' };
  }
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    if (!st) return { error: 'sessão fora do ar' };
    st.remoteHost?.beginTurn();
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '/compact' }] } }) + '\n');
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return { error: 'nenhuma conversa aberta' };
  // compactar chama o modelo: 30s nao da
  try { await codexReq('thread/compact/start', { threadId: tid }, 10 * 60 * 1000); return { ok: true }; }
  catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('pane:steer', async (_e, { paneId, engine, text }) => {
  if (JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };   // fala no meio do trabalho: tambem e' mensagem ao motor
  if (remotePaneTargets.has(paneId) && engine !== 'claude') return remoteEngines.operation(paneId, 'steer', text);
  if (engine === 'acp') return { error: 'Neste motor não dá para falar no meio do trabalho. Espere terminar ou clique em parar.' };
  if (ehCli(engine)) {
    return { error: 'Neste motor não dá para falar no meio do trabalho. Espere terminar ou clique em parar.' };
  }
  if (engine === 'claude') {
    // o CLI aceita uma fala nova no meio do turno pelo mesmo canal
    const st = claudePanes.get(paneId);
    if (!st) return { error: 'sessão fora do ar' };
    st.remoteHost?.beginTurn();
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  const turno = codex.paneTurn.get(paneId);
  if (!tid || !turno) return { error: 'nenhum trabalho em andamento' };
  try {
    await codexReq('turn/steer', { threadId: tid, expectedTurnId: turno, input: [{ type: 'text', text }] });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('pane:interrupt', async (_e, { paneId, engine }) => {
  if (engine === 'claude' && claudeRemoto.has(paneId)) limparAnexosClaudeRemotos(paneId);
  if (remotePaneTargets.has(paneId) && engine !== 'claude') { vigiaTurno.desligar(paneId); return remoteEngines.interrupt(paneId); }
  // voce mandou parar: se o processo morrer daqui ate' o fim do turno, nao e' queda pra religar
  vigiaTurno.desligar(paneId);
  // ACP tem cancelamento de verdade (session/cancel): o turno termina com
  // stopReason 'cancelled' e o 'turn-end' sai pelo caminho normal
  if (engine === 'acp') { acp.interromper(paneId); return true; }
  if (ehCli(engine)) {
    // aqui nao ha' canal de interrupcao: parar o processo E' a interrupcao
    const st = cliPanes.get(paneId);
    if (st && st.proc) {
      st.parandoDeProposito = true; matarProcesso(st.proc); st.proc = null;
      st.primeira = false; st.msgId = null; st.acc = '';
      emit(paneId, 'turn-end', {});
    }
    return true;
  }
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    st?.remoteHost?.cancelTurn();
    if (st) st.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'i' + Date.now(), request: { subtype: 'interrupt' } }) + '\n');
    return true;
  }
  const tid = codex.paneToThread.get(paneId);
  const turn = codex.paneTurn.get(paneId);
  if (tid && turn) { try { await codexReq('turn/interrupt', { threadId: tid, turnId: turn }); } catch {} }
  return true;
});

ipcMain.handle('pane:stop', (_e, { paneId, engine, esquecerMudancas }) => {
  // Tarefa 9: parou = nao trabalha mais; o desfazer so' e' esquecido se o painel fechou ou a conversa trocou
  esquecerMudancasDoPainel(paneId, esquecerMudancas === true);
  if (remotePaneTargets.has(paneId) && engine !== 'claude') { vigiaTurno.desligar(paneId); return remoteEngines.stop(paneId); }
  vigiaTurno.desligar(paneId);   // parada de proposito (trocar motor, modelo, conta, fechar...)
  if (engine === 'acp') { acp.parar(paneId); autoLiberadas.delete(paneId); }   // liberacao vale so' enquanto o painel viver
  else if (ehCli(engine)) cliParar(paneId);
  else if (engine === 'claude') claudeStop(paneId);
  else {
    observabilidade.encerrarPainel(paneId, 'codex', 'A conversa Codex foi desligada deste painel.');
    const tid = codex.paneToThread.get(paneId);
    const turno = codex.paneTurn.get(paneId);
    // interrompe de verdade: sem isso o turno seguia rodando sem tela nenhuma
    if (tid && turno) { try { codexReq('turn/interrupt', { threadId: tid, turnId: turno }).catch(() => {}); } catch {} }
    codex.paneTurn.delete(paneId); codex.paneErrors?.delete(paneId); codex.paneMsgId.delete(paneId);
    if (tid) { codex.threadToPane.delete(tid); codex.paneToThread.delete(paneId); }
  }
  // aprovacao que ficou pendurada NESTE painel: responde nao, senao a thread
  // do Codex fica esperando resposta pra sempre
  for (const [k, a] of [...pendingApprovals]) {
    if (!a || a.paneId !== paneId) continue;
    if (a.kind === 'acp') { try { acp.responderPermissao(a.paneId, a.rpcId, null); } catch {} }
    else if (a.rpcId) { try { codexReply(a.rpcId, proto.buildApprovalResponse(a.kind, false)); } catch {} }
    pendingApprovals.delete(k);
  }
  descartarPerguntasCodex(paneId);   // e a pergunta nativa que ficou pendurada
  return true;
});

ipcMain.handle('pane:autoLiberar', (_e, { paneId, tool }) => {
  if (!paneId || !tool) return false;
  // Tarefa 8: pergunta e plano do Claude pedem voce toda vez (nunca "Sempre permitir")
  if (interacao.FERRAMENTAS_DE_INTERACAO.has(String(tool))) return false;
  if (!autoLiberadas.has(paneId)) autoLiberadas.set(paneId, new Set());
  autoLiberadas.get(paneId).add(tool);
  return true;
});

/* Tarefa 8 (26/09): a resposta do cartao "Plano pronto" (ExitPlanMode).
   Executar = allow + setMode pro modo de ANTES do Plano -- o que o processo
   subiu sabendo (st.modoAntesDoPlano, o mesmo que decidiu a flag
   --allow-dangerously-skip-permissions); sem ele, Manual. O motor segue na
   MESMA sessao, sem religar. Ajustar = deny com o texto, e ele refaz o plano.
   Um envio por plano: o pedido sai do mapa antes de escrever, e so' o
   processo que perguntou recebe. Devolve o modo aplicado, pra tela pintar. */
ipcMain.handle('pane:plano', (_e, o) => {
  const { paneId, chave, aprovar, texto } = (o && typeof o === 'object') ? o : {};
  const k = String(chave || '');
  const a = pedidosClaude.get(k);
  if (!a || a.tipo !== 'plano' || a.paneId !== paneId) return { error: 'Este plano não está mais esperando resposta.', encerrado: true };
  const executar = aprovar === true;
  const ajuste = String(texto == null ? '' : texto).trim();
  if (!executar && !ajuste) return { error: 'Escreva o que mudar no plano.' };
  pedidosClaude.delete(k);
  const st = a.processo;
  // processo que nao subiu no Plano (ele entrou no Plano sozinho): volta pro modo em que subiu
  const modo = interacao.modoDeVolta(st && st.modo === 'plan' ? st.modoAntesDoPlano : (st && st.modo));
  if (!escreverRespostaClaude(a, interacao.respostaDoPlano(a.input, { aprovar: executar, modoAntes: modo, texto: ajuste }))) {
    emit(a.paneId, 'plano-cancelado', { chave: k });
    return { error: 'O motor deste painel não está mais esperando este plano.', encerrado: true };
  }
  return executar ? { ok: true, modo } : { ok: true };
});

ipcMain.handle('pane:liberacoes', (_e, { paneId, limpar }) => {
  if (limpar) { autoLiberadas.delete(paneId); return []; }
  return [...(autoLiberadas.get(paneId) || [])];
});

ipcMain.handle('pane:approve', (_e, { key, allow }) => {
  if (remoteEngines.approvalOwns(key)) return remoteEngines.approve(key, allow);
  const a = pendingApprovals.get(key);
  if (!a) return false;
  pendingApprovals.delete(key);
  if (a.kind === 'acp') return acp.responderPermissao(a.paneId, a.rpcId, !!allow) !== false;
  if (a.kind === 'claude') {
    const st = claudePanes.get(a.paneId);
    if (st) st.proc.stdin.write(JSON.stringify({
      type: 'control_response',
      response: { request_id: a.reqId, subtype: 'success',
        response: allow ? { behavior: 'allow', updatedInput: a.input } : { behavior: 'deny', message: 'Negado por você' } },
    }) + '\n');
    return true;
  }
  /* "reject" era do protocolo antigo. O app-server 0.147.0 so' aceita
     accept / acceptForSession / decline / cancel - e, no pedido de permissao,
     nem decisao ele quer: quer o conjunto de permissoes e o escopo de volta. */
  codexReply(a.rpcId, proto.buildApprovalResponse(a.kind, !!allow, { permissions: a.permissions }));
  return true;
});

ipcMain.handle('models:comparison', (_e, options) => modelBenchmarks.get({refresh:options?.refresh === true}));

ipcMain.handle('claude:models', async (_e, remoto) => {
  try {
    if (remoto && !ssgValido(remoto)) throw new Error('Destino inválido.');
    const models = await capabilities.listClaudeModels(args => {
      const options = { env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
      if (!remoto) return spawnBin(claudeBin(), args, { ...options, cwd: HOME });
      const command = 'exec claude ' + args.map(qLinux).join(' ');
      return spawnBin('ssh', ['-i', remoto.chave, '-p', String(remoto.porta || 22),
        '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
        remoto.usuario + '@' + remoto.host, '--', command], options);
    });
    return { models };
  } catch {
    return { models: [], error: 'Não foi possível atualizar os modelos deste destino. Tente novamente.' };
  }
});
ipcMain.handle('codex:models', async (_e, remoto) => {
  try {
    if (remoto == null) await codexStart();
    const request = remoto != null ? (m, p) => remoteEngines.query(remoto, m, p) : codexReq;
    const models = await capabilities.listModels(request);
    const info = remoto != null ? remoteEngines.info(remoto) : codex.info;
    return models.map(m => ({ ...m, server: info || {}, destination: remoto ? 'remote' : 'local' }));
  } catch { return []; }
});

/* Apps do ChatGPT (os "conectores" da conta, nao os MCP daqui do PC).
   Duas chamadas: app/list diz o que existe e app/installed diz o que ja esta
   ligado nesta maquina. A conta pode nao ter direito a isso - o app-server
   responde 403 - e nesse caso a tela mostra o recado em vez de ficar vazia. */
ipcMain.handle('codex:apps', async (_e, remoto) => {
  if (remoto != null) { try { const [list, installed] = await Promise.all([remoteEngines.query(remoto, 'app/list'), remoteEngines.query(remoto, 'app/installed')]); return { apps: proto.mergeApps(list, installed) }; } catch(e) { return { error: e.message }; } }
  try { await codexStart(); }
  catch (e) { return { error: 'O Codex não está no ar: ' + String((e && e.message) || e).slice(0, 160) }; }
  const [lista, instalados] = await Promise.all([
    codexReq('app/list', {}, 20000).catch((e) => ({ __erro: String((e && e.message) || e) })),
    codexReq('app/installed', {}, 20000).catch((e) => ({ __erro: String((e && e.message) || e) })),
  ]);
  /* o 403 do catalogo vem com uma pagina HTML inteira do Cloudflare junto:
     jogar isso na tela nao ajuda ninguem. Corta na primeira tag, mas se a
     mensagem COMECAR com "<" sobraria texto nenhum - e ai o recado sumia e a
     tela dizia "nenhum App", que e' mentira. */
  /* o "sem acesso" tem que ser procurado no texto INTEIRO: cortado em 160
     caracteres, o "403" da pagina do Cloudflare fica de fora e o recado
     amigavel virava uma sopa de HTML picotado */
  const semAcesso = (t) => /\b403\b|forbidden|not permitted|unauthorized/i.test(String(t || ''));
  const limpa = (t) => {
    const cru = String(t || '').trim();
    const semTag = cru.split('<')[0].trim();
    return (semTag || cru.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || 'o Codex recusou o pedido').slice(0, 160);
  };
  const falhouLista = !!(lista && lista.__erro);
  const falhouInst = !!(instalados && instalados.__erro);
  const erroLista = falhouLista ? limpa(lista.__erro) : '';
  const erroInst = falhouInst ? limpa(instalados.__erro) : '';
  const apps = proto.mergeApps(falhouLista ? null : lista, falhouInst ? null : instalados);
  /* so' e' ERRO quando as DUAS falharam. Catalogo vazio com o installed fora do
     ar nao e' "nao consegui ler": e' que nao ha' App nenhum mesmo. */
  if (!apps.length && falhouLista && falhouInst) {
    return { error: (semAcesso(lista.__erro) || semAcesso(instalados.__erro))
      ? 'Sua conta do ChatGPT ainda não libera a lista de Apps por aqui.'
      : ('Não consegui ler os Apps: ' + (erroLista || erroInst)) };
  }
  /* deu pra listar mesmo com uma das duas fora do ar (foi o que aconteceu no
     teste real: app/installed devolveu 13 e app/list deu 403). Mostra o que da'
     e diz qual metade esta faltando - senao a tela mente sem avisar. */
  const aviso = erroLista ? 'Só consegui ver o que já está instalado nesta máquina.'
    : erroInst ? 'Não consegui ver quais já estão ligados aqui: o estado pode estar desatualizado.'
    : '';
  return { apps, aviso };
});

/* ======================= ENTRADA SEM DIGITAR (leva 36) =======================
   Outras portas alem do teclado: recorte de tela, foto da webcam, quadro,
   texto tirado de imagem (OCR do Windows), prompts salvos e uma caixa de
   entrada em disco pra celular/bots. Tudo local; o que vira imagem cai em
   colados/ (mesma limpeza de 7 dias do print colado). */

// imagem que a tela gerou (foto, quadro, recorte) vira arquivo em colados/
ipcMain.handle('imagem:salvar', (_e, { dados, prefixo }) => {
  try {
    const cru = String(dados || '');
    if (cru.length > 30 * 1024 * 1024) return { error: 'imagem grande demais (limite de ~20 MB)' };
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(cru);
    if (!m) return { error: 'imagem inválida' };
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const nome = String(prefixo || 'imagem').replace(/[^\w-]/g, '') + '-' + Date.now() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    const destino = path.join(dir, nome);
    fs.writeFileSync(destino, Buffer.from(m[2], 'base64'));
    return { arquivo: destino };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

// texto gerado na tela (a cena .excalidraw do quadro) vira arquivo em colados/
// leitura de texto SEM o teto de 500 KB do fs:read (a cena do quadro com print colado passa disso)
ipcMain.handle('arquivo:lerTexto', (_e, { arquivo }) => {
  try {
    const f = String(arquivo || '');
    if (ehCaminhoDeRede(f)) return { error: MSG_CAMINHO_DE_REDE };   // antes do statSync: \\servidor trava o app ~21 s e o Windows tenta SMB
    if (!/\.(excalidraw|json|txt|md)$/i.test(f)) return { error: 'tipo de arquivo não permitido' };
    const st = fs.statSync(f);   // ANTES de ler: se o arquivo mudar no meio, o aviso do Salvar erra para o lado de avisar a mais, nunca a menos
    if (st.size > 20 * 1024 * 1024) return { error: 'arquivo grande demais (limite de 20 MB)' };
    const content = fs.readFileSync(f, 'utf8');
    // o "Salvar" do quadro (quadro:salvar, logo abaixo) só vale para um .excalidraw que o main leu por aqui, e avisa se a data ou o tamanho mudaram depois
    if (/\.excalidraw$/i.test(f)) quadrosLidos.set(chaveDoQuadro(f), { mtimeMs: st.mtimeMs, size: st.size });
    return { content };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
ipcMain.handle('arquivo:salvarTexto', (_e, { texto, prefixo, ext, nome }) => {
  try {
    const e = String(ext || 'txt').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!['excalidraw', 'json', 'txt', 'md'].includes(e)) return { error: 'tipo de arquivo não permitido' };
    const t = String(texto == null ? '' : texto);
    if (t.length > 20 * 1024 * 1024) return { error: 'arquivo grande demais' };
    // 'nome' fixo: arquivo proprio (ex: a cena do quadro de um painel), regravado no lugar
    const fixo = String(nome || '').replace(/[^\w-]/g, '').slice(0, 80);
    const dir = path.join(app.getPath('userData'), fixo ? 'quadros' : 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const destino = fixo ? path.join(dir, fixo + '.' + e) : path.join(dir, String(prefixo || 'texto').replace(/[^\w-]/g, '') + '-' + Date.now() + '.' + e);
    fs.writeFileSync(destino, t, 'utf8');
    return { arquivo: destino };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* Quadro aberto de um .excalidraw do disco (leva 2, Task 7): "Salvar" grava no ORIGINAL, depois de este lado perguntar
   "Substituir <nome>?", e "Salvar como" grava onde o Hugo escolher no diálogo do Windows. Quem decide ONDE gravar é o main,
   nunca a tela: só .excalidraw, nunca caminho de rede (a trava vem ANTES de qualquer fs) e só uma cena do Excalidraw. A barreira
   de verdade é a caixa nativa "Substituir <nome>?", que a tela não tem como pular. O registro abaixo (quadrosLidos, preenchido por
   arquivo:lerTexto, acima) é só guarda contra BUG da tela, que mande um caminho errado: uma tela hostil leria o arquivo que
   quisesse e entraria no registro. Ele também guarda a data e o tamanho do arquivo de quando o quadro o abriu, para a pergunta
   avisar se ele mudou desde então (o agente pode ter reescrito). */
const quadrosLidos = new Map();
const chaveDoQuadro = (f) => { const r = path.resolve(String(f)); return EH_WIN ? r.toLowerCase() : r; };
/* Como o gravarSeguro (temporário na MESMA pasta e depois renameSync: o arquivo é trocado de uma vez, e uma queda ou falta de
   espaço no meio da escrita deixa o antigo inteiro), mas LANÇA o erro: o gravarSeguro o engole, e aqui quem chamou mostra o
   motivo ao Hugo e registra no log. Se algo falhar, o temporário é apagado. */
function gravarAtomico(destino, texto) {
  const tmp = destino + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.tmp';
  try {
    fs.writeFileSync(tmp, texto, 'utf8');
    fs.renameSync(tmp, destino);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (u) { if (u?.code !== 'ENOENT') logMain('quadro:temporario', u); }
    throw e;
  }
}
// recusa que volta para a tela como { error }: também deixa rastro no log (antes só o erro inesperado, o do catch, ia)
const recusarGravacao = (contexto, erro) => { logMain(contexto, new Error(erro)); return { error: erro }; };
function erroDoDesenho(texto) {
  if (typeof texto !== 'string' || !texto) return 'O desenho veio vazio.';
  // o teto é do ARQUIVO (bytes em UTF-8), não de texto.length: acento e emoji ocupam mais de uma posição
  if (Buffer.byteLength(texto, 'utf8') > 20 * 1024 * 1024) return 'Desenho grande demais (limite de 20 MB).';
  // só entra no lugar de um .excalidraw o que é cena do Excalidraw (o que o q.cena() do quadro serializa)
  let cena = null;
  try { cena = JSON.parse(texto); } catch {}   // texto que não é JSON cai na recusa logo abaixo
  if (!cena || cena.type !== 'excalidraw' || !Array.isArray(cena.elements)) return 'O conteúdo não é um desenho do Excalidraw. Nada foi gravado.';
  return '';
}
function erroDoDestinoDoDesenho(destino) {
  if (ehCaminhoDeRede(destino)) return MSG_CAMINHO_DE_REDE;
  const s = String(destino || '');
  // no Windows o ":" depois da letra do disco é fluxo alternativo do NTFS (a.txt:b.excalidraw), não um arquivo .excalidraw
  if (!path.isAbsolute(s) || !/\.excalidraw$/i.test(s) || /[\x00-\x1f]/.test(s) || (EH_WIN && s.replace(/^[A-Za-z]:/, '').includes(':'))) {
    return 'O desenho só é gravado em arquivo .excalidraw.';
  }
  return '';
}
ipcMain.handle('quadro:salvar', async (_e, o) => {
  try {
    const arquivo = String((o && o.arquivo) || '');
    const texto = o && o.texto;
    const erro = erroDoDestinoDoDesenho(arquivo) || erroDoDesenho(texto);
    if (erro) return recusarGravacao('quadro:salvar', erro);
    const visto = quadrosLidos.get(chaveDoQuadro(arquivo));
    if (!visto) return recusarGravacao('quadro:salvar', 'Só dá para salvar no arquivo que o quadro abriu.');
    if (!fs.existsSync(arquivo)) return recusarGravacao('quadro:salvar', 'O arquivo original não está mais lá. Use "Salvar como".');
    // o agente (ou outro programa) pode ter reescrito o arquivo desde que o quadro o abriu: a pergunta avisa, quem decide é o Hugo
    const agora = fs.statSync(arquivo);
    const mudou = agora.mtimeMs !== visto.mtimeMs || agora.size !== visto.size;
    const r = await dialog.showMessageBox(win, {
      type: 'question', title: 'Salvar desenho', message: 'Substituir ' + path.basename(arquivo) + '?',
      detail: (mudou ? 'O arquivo mudou depois que você abriu (o agente pode ter reescrito). Se substituir, a versão mais nova dele se perde.\n\n' : '')
        + 'O desenho do quadro vai ocupar o lugar do que está em ' + path.normalize(arquivo) + '.',
      buttons: ['Substituir', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (r.response !== 0) return { cancelado: true };
    gravarAtomico(arquivo, texto);
    // a gravação acabou de mudar a data e o tamanho: sem renovar, o próximo Salvar acusaria "mudou" por causa dela mesma
    const gravado = fs.statSync(arquivo);
    quadrosLidos.set(chaveDoQuadro(arquivo), { mtimeMs: gravado.mtimeMs, size: gravado.size });
    return { ok: true, arquivo };
  } catch (e) { logMain('quadro:salvar', e); return { error: String((e && e.message) || e) }; }
});
ipcMain.handle('quadro:salvarComo', async (_e, o) => {
  try {
    const texto = o && o.texto;
    const erro = erroDoDesenho(texto);
    if (erro) return recusarGravacao('quadro:salvar-como', erro);
    // o caminho que a tela manda só dá a dica (nome e pasta) do diálogo; quem escolhe o destino é o Hugo
    const dica = String((o && o.arquivo) || '');
    const r = await dialog.showSaveDialog(win, opcoesSalvarComo(path.basename(dica) || 'desenho.excalidraw', path.dirname(dica), {
      title: 'Salvar desenho como', filters: [{ name: 'Desenho do Excalidraw', extensions: ['excalidraw'] }],
    }));
    if (r.canceled || !r.filePath) return { cancelado: true };
    const erroDestino = erroDoDestinoDoDesenho(r.filePath);
    if (erroDestino) return recusarGravacao('quadro:salvar-como', erroDestino);
    gravarAtomico(r.filePath, texto);
    return { ok: true, arquivo: r.filePath };
  } catch (e) { logMain('quadro:salvar-como', e); return { error: String((e && e.message) || e) }; }
});

/* OCR local: o motor do proprio Windows (Windows.Media.Ocr, pt-BR ja instalado
   nesta maquina, ~1s). Roda no PowerShell 5 (o WinRT nao entra no pwsh 7). O
   script mora no userData porque de dentro do asar o PowerShell nao le. */
const OCR_PS1 = "param([Parameter(Mandatory=$true)][string]$Caminho, [string]$Idioma = 'pt-BR')\n$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null\n[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null\n[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null\n[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null\nAdd-Type -AssemblyName System.Runtime.WindowsRuntime\n$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]\nfunction Await($op, $t) { $m = $asTask.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }\n$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Caminho)) ([Windows.Storage.StorageFile])\n$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])\n$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])\n$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])\n$engine = $null\ntry { $lang = New-Object Windows.Globalization.Language $Idioma; $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) } catch {}\nif (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }\nif (-not $engine) { Write-Error 'sem motor de OCR'; exit 2 }\n$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])\n$result.Lines | ForEach-Object { $_.Text }\n";
let seqOcr = 0;
ipcMain.handle('ocr:ler', async (_e, { arquivo }) => {
  if (!EH_WIN) return { error: 'O OCR local só está pronto no Windows.' };
  try {
    const f = String(arquivo || '');
    if (!f || !fs.existsSync(f)) return { error: 'arquivo não encontrado' };
    const script = path.join(app.getPath('userData'), 'ocr.ps1');
    let atual = ''; try { atual = fs.readFileSync(script, 'utf8'); } catch {}
    if (atual !== OCR_PS1) fs.writeFileSync(script, OCR_PS1, 'utf8');
    /* o OCR do Windows recusa imagem acima de 2600 px por lado (recorte 4K, print
       de pagina rolada, foto do celular): encolhe antes, numa copia */
    let alvo = f;
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(f);
      const tam = img.getSize();
      if (tam.width > 2500 || tam.height > 2500) {
        const fator = 2500 / Math.max(tam.width, tam.height);
        // nome proprio por chamada: dois OCR ao mesmo tempo nao trocam o texto entre si
        alvo = path.join(app.getPath('userData'), 'ocr-' + Date.now() + '-' + (++seqOcr) + '.png');
        fs.writeFileSync(alvo, img.resize({ width: Math.round(tam.width * fator), height: Math.round(tam.height * fator) }).toPNG());
      }
    } catch (e) { logMain('ocr:encolher', e); }
    let r;
    try { r = await rodar('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Caminho', alvo], 45000); }
    finally { if (alvo !== f) { try { fs.unlinkSync(alvo); } catch {} } }
    const texto = String(r.out || '').replace(/\r/g, '').trim();
    if (!texto && r.err && !String(r.errout || '').trim()) return { error: 'o OCR não respondeu em 45 s' };
    if (!texto) {
      const erro = String(r.errout || '').trim();
      const motivo = /dimension/i.test(erro) ? 'imagem grande demais pro OCR do Windows'
        : /Language|idioma/i.test(erro) ? 'o pacote de idioma do OCR (pt-BR) não está instalado no Windows'
        : /sem motor/i.test(erro) ? 'o Windows não tem motor de OCR instalado'
        : erro ? 'o OCR falhou (' + erro.replace(/\s+/g, ' ').slice(0, 120) + ')' : 'não achei texto nessa imagem';
      return { error: motivo };
    }
    return { texto };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
});

// prompts salvos: um json seu, fora do app (~/.claude/cockpit-prompts.json)
const PROMPTS_PATH = () => path.join(HOME, '.claude', 'cockpit-prompts.json');
ipcMain.handle('prompts:ler', () => {
  try {
    // rodada final da leva 5: vazio, so' espaco ou zeros, ou JSON quebrado (queda) le o .bak; o [] de verdade nao cai nele
    const ler = (alvo) => { const t = fs.readFileSync(alvo, 'utf8'); if (/^[\s\0]*$/.test(t)) throw new Error('vazio'); return JSON.parse(t); };
    let j;
    try { j = ler(PROMPTS_PATH()); } catch (e) { if (e && e.code) throw e; j = ler(PROMPTS_PATH() + '.bak'); }
    return Array.isArray(j) ? j.filter((p) => p && p.nome && p.texto).slice(0, 200) : [];
  } catch { return []; }
});
ipcMain.handle('prompts:salvar', (_e, lista) => {
  try {
    const limpa = (Array.isArray(lista) ? lista : [])
      .filter((p) => p && String(p.nome || '').trim() && String(p.texto || '').trim())
      .map((p) => ({ nome: String(p.nome).trim().slice(0, 80), texto: String(p.texto).slice(0, 50000), quando: Number(p.quando) || Date.now() }))
      .slice(0, 200);
    gravarSeguro(PROMPTS_PATH(), JSON.stringify(limpa, null, 2));
    return { ok: true };
  }
  catch (e) { return { error: String(e && e.message || e) }; }
});

/* Caixa de entrada: o que cair em userData/inbox vira aviso na tela com "usar".
   E' o contrato pro bot do Telegram (audio ja transcrito em .txt, foto em
   .png/.jpg) e pra qualquer script: escrever o arquivo la' basta. */
const PASTA_INBOX = () => path.join(app.getPath('userData'), 'inbox');
const inboxVistos = new Set();
const inboxRestaurados = new Map();
const inboxAnunciados = new Map();
function arquivosInbox() {
  const arquivos = new Map();
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA_INBOX()); } catch { return arquivos; }
  for (const nome of nomes) {
    if (!['.txt', '.md', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(nome).toLowerCase())) continue;
    try { const stat = fs.statSync(path.join(PASTA_INBOX(), nome)); if (stat.isFile()) arquivos.set(nome, stat); } catch {}
  }
  return arquivos;
}
function parInbox(nome, arquivos) {
  const igual = value => typeof EH_WIN !== 'undefined' && EH_WIN ? value.toLowerCase() : value;
  const ext = path.extname(nome), base = igual(nome.slice(0, -ext.length));
  const grupo = [...arquivos.keys()].filter(n => igual(n.slice(0, -path.extname(n).length)) === base);
  const imagens = ['.png', '.jpg', '.jpeg', '.webp'];
  const imagem = grupo.filter(n => imagens.includes(path.extname(n).toLowerCase()))
    .sort((a, b) => imagens.indexOf(path.extname(a).toLowerCase()) - imagens.indexOf(path.extname(b).toLowerCase()) || a.localeCompare(b))[0];
  // Um texto pertence a uma imagem só. Se vierem .txt e .md, o .txt é a
  // legenda e o .md continua sendo mensagem independente, sem sumir oculto.
  const legenda = imagem && ['.txt', '.md'].map(e => grupo.find(n => path.extname(n).toLowerCase() === e)).find(Boolean);
  return { imagem: imagem || null, legenda: legenda || null };
}
function ocorrenciaInbox(nome, stat, legenda) {
  const versao = (n, s) => [n, String(s.mtimeMs), String(Number(s.size) || 0), String(s.ctimeMs || 0), String(s.ino || 0)];
  return JSON.stringify([versao(nome, stat), legenda ? versao(legenda.nome, legenda.stat) : null]);
}
function itemInbox(nome, arquivos) {
  const stat = arquivos.get(nome);
  if (!stat) return null;
  const par = parInbox(nome, arquivos);
  const legenda = par.imagem === nome && par.legenda ? { nome: par.legenda, stat: arquivos.get(par.legenda) } : null;
  return { nome, stat, legenda, ehLegenda: par.legenda === nome, occurrence: ocorrenciaInbox(nome, stat, legenda) };
}
function prepararReplayInbox() {
  // Fotografa o disco ANTES da carga, sem tratar a primeira varredura como
  // novidade. Um arquivo que chegar durante a carga continua sendo novo.
  inboxRestaurados.clear();
  const arquivos = arquivosInbox();
  for (const nome of arquivos.keys()) inboxRestaurados.set(nome, itemInbox(nome, arquivos).occurrence);
}
let inboxOuvinte = false;   // a tela DESTA carga ja registrou o onInbox (senao o aviso vai pro vazio)
ipcMain.handle('inbox:ouvindo', () => { inboxOuvinte = true; setTimeout(varrerInbox, 100); return { ok: true }; });
function varrerInbox() {
  // a tela ainda carregando nao ouve: anunciar agora perderia o aviso pra sempre
  if (!inboxOuvinte || !win || win.isDestroyed() || win.webContents.isLoading()) return;
  const arquivos = arquivosInbox();
  const conjunto = new Set(arquivos.keys());
  for (const n of arquivos.keys()) {
    const ext = path.extname(n).toLowerCase();
    const f = path.join(PASTA_INBOX(), n);
    const item = itemInbox(n, arquivos), st = item.stat;
    if (item.ehLegenda) continue;
    // recem-escrito (ate' 700 ms, inclusive uns ms 'no futuro' por relogio do disco): espera assentar;
    // mtime muito no futuro (arquivo vindo de maquina com relogio errado) nao fica preso pra sempre
    if ([st, item.legenda?.stat].filter(Boolean).some(s => { const idade = Date.now() - s.mtimeMs; return idade > -5000 && idade < 700; })) continue;
    // A versão inclui a legenda: alterá-la com a imagem intacta é novidade.
    const occurrence = item.occurrence;
    if (inboxVistos.has(occurrence)) continue;
    const ehImagem = ext !== '.txt' && ext !== '.md';
    let texto = '', legenda = '';
    try {
      if (!ehImagem) texto = fs.readFileSync(f, 'utf8').trim().slice(0, 20000);
      if (item.legenda) legenda = fs.readFileSync(path.join(PASTA_INBOX(), item.legenda.nome), 'utf8').trim().slice(0, 4000);
      // Se o produtor escreveu enquanto líamos, esperar a próxima varredura.
      const agora = { nome: item.legenda?.nome, stat: item.legenda ? fs.statSync(path.join(PASTA_INBOX(), item.legenda.nome)) : null };
      if (ocorrenciaInbox(n, fs.statSync(f), item.legenda ? agora : null) !== occurrence) continue;
    } catch { continue; }
    inboxVistos.add(occurrence);
    const replay = inboxRestaurados.get(n) === occurrence || inboxAnunciados.get(n) === occurrence;
    inboxAnunciados.set(n, occurrence);
    win.webContents.send('inbox', { arquivo: f, nome: n, tipo: ehImagem ? 'imagem' : 'texto', texto, legenda, quando: st.mtimeMs, occurrence, replay });
  }
  // Uma ocorrência por arquivo: repetir a varredura após o limite de vistos
  // não produz som/abertura novamente, nem acumula versões já removidas.
  for (const mapa of [inboxRestaurados, inboxAnunciados]) {
    for (const nome of mapa.keys()) if (!conjunto.has(nome)) mapa.delete(nome);
  }
  if (inboxVistos.size > 500) inboxVistos.clear();
}
function ligarInbox() {
  try { fs.mkdirSync(PASTA_INBOX(), { recursive: true }); } catch {}
  prepararReplayInbox();
  try { fs.watch(PASTA_INBOX(), () => setTimeout(varrerInbox, 800)).on('error', () => {}); } catch {}   // pasta renomeada nao derruba o main
  setInterval(varrerInbox, 3000);
  // a cada carga da tela (abertura e Ctrl+R) tudo que sobrou e' anunciado de novo
  if (win && !win.isDestroyed()) {
    win.webContents.on('did-start-loading', () => { inboxOuvinte = false; prepararReplayInbox(); });   // Ctrl+R: a tela nova ainda nao ouve
    win.webContents.on('did-finish-load', () => { inboxVistos.clear(); });      // tudo que sobrou volta a ser anunciado quando ela avisar
  }
  limparInboxAntiga();
}
// o que ficou 7 dias na caixa sem ninguem usar nem descartar vai embora
function limparInboxAntiga() {
  try {
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const n of fs.readdirSync(PASTA_INBOX())) {
      const f = path.join(PASTA_INBOX(), n);
      try { if (fs.statSync(f).mtimeMs < limite) fs.unlinkSync(f); } catch {}
    }
  } catch {}
}
// "usar": texto e' consumido (some da caixa); imagem vai pra colados/ e vira anexo
ipcMain.handle('inbox:consumir', (_e, { arquivo, apagar, occurrence } = {}) => {
  try {
    const f = path.resolve(String(arquivo || ''));
    // tem que estar DENTRO da caixa (pasta igual, sem caso no Windows): o
    // startsWith em texto deixava passar "inbox2\x" e "inbox-velha.txt"
    const raiz = path.resolve(PASTA_INBOX());
    const mesma = (a, b) => (EH_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (!mesma(path.dirname(f), raiz)) return { error: 'fora da caixa de entrada' };
    const arquivos = arquivosInbox();
    const nome = [...arquivos.keys()].find(n => mesma(n, path.basename(f)));
    const item = nome && itemInbox(nome, arquivos);
    if (!item) return { error: 'Este item não está mais na caixa de entrada.' };
    if (item.ehLegenda) return { code: 'CONFLICT', error: 'Este texto agora acompanha uma imagem. Use a mensagem mais recente da central.' };
    if (occurrence && item.occurrence !== occurrence)
      return { code: 'CONFLICT', error: 'Este item mudou. Use a mensagem mais recente da central.' };
    const ext = path.extname(f).toLowerCase();
    // A legenda só sai DEPOIS que a imagem foi movida/apagada com sucesso.
    // Textos independentes nunca apagam outro texto de mesmo nome-base.
    const limparLegenda = () => {
      if (!item.legenda) return;
      const legenda = path.join(raiz, item.legenda.nome);
      try {
        if (ocorrenciaInbox(item.legenda.nome, fs.statSync(legenda)) === ocorrenciaInbox(item.legenda.nome, item.legenda.stat)) fs.unlinkSync(legenda);
      } catch {} // legenda travada fica guardada e reaparece como texto
    };
    if (apagar || ext === '.txt' || ext === '.md') { fs.unlinkSync(f); limparLegenda(); return { ok: true }; }
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'celular-' + Date.now() + '-' + crypto.randomUUID() + ext);
    fs.renameSync(f, destino);
    limparLegenda();
    return { ok: true, arquivo: destino };
  } catch { return { error: 'Não consegui consumir este item. O conteúdo que não foi movido continua na caixa de entrada; tente novamente.' }; }
});
ipcMain.handle('inbox:pasta', () => PASTA_INBOX());

/* ===== recorte de tela =====
   Esconde o Cockpit, fotografa a tela onde esta' o mouse (desktopCapturer),
   abre uma janela sem moldura por cima com a foto, voce arrasta o retangulo,
   o pedaco vira PNG em colados/ e entra como anexo no painel que pediu.
   (Win+Shift+S + Ctrl+V ja funcionava; isto poupa a ida ao clipboard.) */
let recorte = null;      // { janela, imagem, paneId, estavaVisivel, boundsW, boundsH }
let recortando = false;  // entre o pedido e a janela existir (o guarda de cima nao cobre o await)
ipcMain.handle('tela:recortar', async (_e, { paneId }) => {
  if (recorte || recortando) return { error: 'já tem um recorte aberto' };
  recortando = true;
  const estavaVisivel = !!(win && !win.isDestroyed() && win.isVisible());
  let janela = null;
  try {
    const ponto = screen.getCursorScreenPoint();
    const tela = screen.getDisplayNearestPoint(ponto);
    const escala = tela.scaleFactor || 1;
    if (estavaVisivel) win.hide();
    await new Promise((r) => setTimeout(r, 350));   // a janela precisa sumir de verdade antes da foto
    const fontes = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(tela.size.width * escala), height: Math.round(tela.size.height * escala) },
    });
    // so' a tela onde esta' o mouse: cair na primaria em silencio recortava a
    // foto de OUTRO monitor por cima deste
    const fonte = fontes.find((f) => String(f.display_id) === String(tela.id));
    if (!fonte || fonte.thumbnail.isEmpty()) { if (estavaVisivel) win.show(); return { error: 'não achei a tela onde está o mouse (' + fontes.length + (fontes.length === 1 ? ' tela' : ' telas') + ')' }; }
    janela = new BrowserWindow({
      x: tela.bounds.x, y: tela.bounds.y, width: tela.bounds.width, height: tela.bounds.height,
      frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, backgroundColor: '#000000', show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-recorte.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    ipcSecurity.installSession(janela.webContents.session);
    ipcSecurity.protectCaptureWindow(janela);
    recorte = { janela, imagem: fonte.thumbnail, paneId, estavaVisivel, boundsW: tela.bounds.width, boundsH: tela.bounds.height };
    janela.setAlwaysOnTop(true, 'screen-saver');
    // se a janela nunca pintar (renderer morreu antes do primeiro quadro) o Cockpit
    // ficaria escondido e todo recorte seguinte diria "ja tem um aberto": vigia de 8 s
    const vigia = setTimeout(() => { if (recorte && recorte.janela === janela && !janela.isDestroyed() && !janela.isVisible()) { try { janela.close(); } catch (e) { logMain('recorte:vigia', e); } } }, 8000);
    janela.once('ready-to-show', () => { clearTimeout(vigia); try { janela.show(); janela.focus(); } catch (e) { logMain('recorte:mostrar', e); } });   // sem flash preto
    janela.webContents.on('did-fail-load', () => { try { janela.close(); } catch (e) { logMain('recorte:falha-ao-carregar', e); } });        // sem tela preta presa
    janela.webContents.on('render-process-gone', () => { try { janela.close(); } catch (e) { logMain('recorte:renderer-caiu', e); } });
    janela.loadFile(path.join(__dirname, 'renderer/recorte.html'));
    janela.on('closed', () => {
      const r = recorte; recorte = null;
      if (r && r.estavaVisivel && win && !win.isDestroyed()) { win.show(); win.focus(); }
    });
    return { ok: true };
  } catch (e) {
    recorte = null;
    if (janela) { try { janela.close(); } catch (err) { logMain('recorte:limpar', err); } }
    if (estavaVisivel && win && !win.isDestroyed()) win.show();
    return { error: String(e && e.message || e) };
  } finally { recortando = false; }
});
// so' a janela do recorte fala nestes canais (o preload principal nem os expoe;
// e' defesa barata)
const daJanelaDeRecorte = (e) => !!(recorte && recorte.janela && !recorte.janela.isDestroyed() && e.sender === recorte.janela.webContents);
ipcMain.handle('recorte:dados', (e) => {
  if (!daJanelaDeRecorte(e)) return null;
  const tam = recorte.imagem.getSize();
  return { png: recorte.imagem.toDataURL(), escala: tam.width / (recorte.boundsW || tam.width) };
});
ipcMain.handle('recorte:pronto', (e, { x, y, w, h }) => {
  const r = recorte;
  if (!r || !daJanelaDeRecorte(e)) return { error: 'sem recorte aberto' };
  try {
    // escala REAL da foto (pixels por px de CSS), por eixo, medida na propria
    // imagem - nao no scaleFactor, que pode divergir entre monitores
    const tam = r.imagem.getSize();
    const kx = tam.width / (r.boundsW || tam.width), ky = tam.height / (r.boundsH || tam.height);
    const rect = {
      x: Math.max(0, Math.min(tam.width - 1, Math.round(x * kx))), y: Math.max(0, Math.min(tam.height - 1, Math.round(y * ky))),
      width: Math.max(1, Math.round(w * kx)), height: Math.max(1, Math.round(h * ky)),
    };
    rect.width = Math.min(rect.width, tam.width - rect.x); rect.height = Math.min(rect.height, tam.height - rect.y);
    const png = r.imagem.crop(rect).toPNG();
    const dir = path.join(app.getPath('userData'), 'colados');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'recorte-' + Date.now() + '.png');
    fs.writeFileSync(destino, png);
    emit(r.paneId, 'anexo-pronto', { arquivo: destino, origem: 'recorte' });
    try { r.janela.close(); } catch (err) { logMain('recorte:fechar', err); }
    return { ok: true, arquivo: destino };
  } catch (e) { try { r.janela.close(); } catch (err) { logMain('recorte:fechar-erro', err); } return { error: String(e && e.message || e) }; }
});
ipcMain.handle('recorte:cancelar', (e) => { const r = recorte; if (r && daJanelaDeRecorte(e)) { try { r.janela.close(); } catch (err) { logMain('recorte:cancelar', err); } } return { ok: true }; });

/* atalhos globais (valem com o Cockpit em segundo plano): falar sem clicar e
   recortar a tela. Se outro programa ja tiver o atalho, o register devolve
   false e fica so' o caminho pelo menu - nao derruba nada. */
const atalhosFalhos = [];
/* Desligados por padrao: um atalho global ganha de TODO programa enquanto o
   Cockpit estiver aberto (Ctrl+Shift+R e' recarregar no Chrome/VS Code). Quem
   liga nos Ajustes sabe o que esta' cedendo; e as combinacoes com Alt sao raras. */
function ligarAtalhosGlobais(ligado) {
  try { globalShortcut.unregisterAll(); } catch (e) { logMain('atalhos:desligar', e); }
  atalhosFalhos.length = 0;
  if (!ligado) return;
  const atalhos = { 'Control+Alt+Space': 'ditar', 'Control+Alt+R': 'recortar' };
  for (const [tecla, acao] of Object.entries(atalhos)) {
    try {
      const ok = globalShortcut.register(tecla, () => {
        if (!win || win.isDestroyed()) return;
        if (acao === 'ditar') { win.show(); win.focus(); }
        win.webContents.send('menu', acao);
      });
      if (!ok) atalhosFalhos.push(tecla);
    } catch { atalhosFalhos.push(tecla); }
  }
}
ipcMain.handle('atalhos:estado', () => ({ falhos: atalhosFalhos.slice() }));
ipcMain.handle('atalhos:ligar', (_e, { ligado }) => { ligarAtalhosGlobais(!!ligado); return { falhos: atalhosFalhos.slice() }; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { logMain('atalhos:sair', e); } });

/* ======================= menu ======================= */
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Painel', submenu: [
      { label: 'Novo painel ao lado', accelerator: 'CmdOrCtrl+T', click: () => win && win.webContents.send('menu', 'newPane') },
      { label: 'Fechar painel', accelerator: 'CmdOrCtrl+W', click: () => win && win.webContents.send('menu', 'closePane') },
      { type: 'separator' },
      { label: 'Nova conversa', accelerator: 'CmdOrCtrl+N', click: () => win && win.webContents.send('menu', 'novaConversa') },
      { label: 'Buscar conversa…', accelerator: 'CmdOrCtrl+K', click: () => win && win.webContents.send('menu', 'buscarConversa') },
      { label: 'Escrever no painel', accelerator: 'CmdOrCtrl+L', click: () => win && win.webContents.send('menu', 'focarInput') },
      { type: 'separator' },
      /* 23/09/2026, decisao do Hugo: o Ctrl+Tab virou troca de PASTA, com o
         gesto do Alt+Tab (cockpit-ui.js); painel seguinte/anterior foram pro
         Ctrl+PageDown/PageUp. */
      { label: 'Painel seguinte', accelerator: 'Control+PageDown', click: () => win && win.webContents.send('menu', 'painelProximo') },
      { label: 'Painel anterior', accelerator: 'Control+PageUp', click: () => win && win.webContents.send('menu', 'painelAnterior') },
      { type: 'separator' },
      /* Ctrl+Tab e' do RENDERER: ele precisa ver o Ctrl sendo segurado e solto
         (a lista aparece com o Ctrl embaixo e a troca acontece ao soltar). Um
         acelerador registrado dispara no aperto e toma a tecla da pagina. Com
         registerAccelerator: false (Windows/Linux, Electron 32) o menu so'
         MOSTRA a combinacao; pelo mouse, o item troca direto, sem lista. */
      { label: 'Próxima pasta', accelerator: 'Control+Tab', registerAccelerator: false, click: () => win && win.webContents.send('menu', 'pastaProxima') },
      { label: 'Pasta anterior', accelerator: 'Control+Shift+Tab', registerAccelerator: false, click: () => win && win.webContents.send('menu', 'pastaAnterior') },
      { type: 'separator' },
      { label: 'Trocar pasta do painel…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu', 'pickFolder') },
      /* Ctrl+SHIFT+M, nao Ctrl+Alt+M: em teclado ABNT2 o AltGr E' Ctrl+Alt, e
         um atalho Ctrl+Alt+letra dispara sozinho no meio da digitacao. Os
         Ctrl+Alt que existem no app sao globalShortcut e sao opt-in nos
         Ajustes justamente por isso; atalho de janela aqui e' CmdOrCtrl. */
      { label: 'Trocar de motor', accelerator: 'CmdOrCtrl+Shift+M', click: () => win && win.webContents.send('menu', 'trocarMotor') },
      { label: 'Limpar conversa', accelerator: 'CmdOrCtrl+Shift+K', click: () => win && win.webContents.send('menu', 'clearPane') },
      { label: 'Parar o que está rodando (Esc)', click: () => win && win.webContents.send('menu', 'parar') },
    ]},
    { role: 'editMenu', label: 'Editar' },
    { label: 'Ver', submenu: [
      { label: 'Mostrar/ocultar barra lateral', accelerator: 'CmdOrCtrl+B', click: () => win && win.webContents.send('menu', 'toggleSidebar') },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { role: 'reload', label: 'Recarregar' },
    ]},
    /* Rodada 2 da leva 5i: no lugar do { role: 'windowMenu' }. O role traz o item "Fechar" com o acelerador Ctrl+W (CmdOrCtrl+W), e a
       tabela de atalhos do Electron guarda UM item por acelerador: o ultimo. O "Fechar" da janela (aqui embaixo) ganhava do "Fechar
       painel" (la' em cima) e, com o foco na pagina do navegador interno, o Ctrl+W fechava o Cockpit INTEIRO. O Ctrl+W tem um dono
       so': o "Fechar painel". O resto do menu e' o mesmo (Minimizar, e o Zoom da janela); para fechar a janela ficam o X e o Alt+F4.
       Quem acrescentar um item aqui nao pode repetir acelerador: test/menu-atalhos.test.js confere a tabela inteira. */
    { label: 'Janela', submenu: [
      { role: 'minimize', label: 'Minimizar' },
      { label: 'Maximizar ou restaurar', click: () => { if (!win || win.isDestroyed()) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); } },
    ]},
  ]));
}

/* print colado vira arquivo em disco e nada nunca apagava */
/* a cena do quadro mora em quadros/quadro-<id do painel>.excalidraw e o id do
   painel muda a cada abertura do app: o arquivo da abertura anterior ficava la'
   pra sempre. Some o que nenhuma ficha aponta (com 1 dia de folga) */
function limparQuadrosOrfaos() {
  try {
    const dir = path.join(app.getPath('userData'), 'quadros');
    const fichas = JSON.stringify(loadConfig());   // as fichas guardam o caminho inteiro, escapado igual
    // rodada 2 da leva 5: config nao lido (preso, ou config e .bak ruins): o padrao nao aponta quadro nenhum; nao apaga nada desta vez
    if (loadConfig.naoLido === true || loadConfig.semCopia === true) return;
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        if (fs.statSync(p).mtimeMs > limite) continue;
        if (!fichas.includes(JSON.stringify(p).slice(1, -1))) fs.unlinkSync(p);
      } catch {}
    }
  } catch (e) { if (e?.code !== 'ENOENT') logMain('limpar-quadros', e); }
}
function limparColadosAntigos() {
  try {
    const dir = path.join(app.getPath('userData'), 'colados');
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {}
    }
  } catch (e) { if (e?.code !== 'ENOENT') logMain('limpar-colados', e); }
}

/* a copia do settings virou UMA POR PAINEL (dois paineis subindo juntos liam o
   arquivo pela metade). Como o id do painel muda a cada abertura do app, as
   copias velhas se acumulariam pra sempre no userData. */
function limparSettingsAntigos() {
  try {
    const dir = app.getPath('userData');
    for (const f of fs.readdirSync(dir)) {
      if (!/^claude-settings-sem-bypass/.test(f)) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  } catch (e) { if (e?.code !== 'ENOENT') logMain('limpar-settings', e); }
}

if (EH_WIN) { try { app.setAppUserModelId(WINDOWS_APP_ID); } catch (e) { logMain('app-user-model-id', e); } }
/* GPU, rede, utilitarios do Chromium: quando um cai, fica anotado (a saida
   normal no fechamento, 'clean-exit', nao e' queda) */
app.on('child-process-gone', (_e, d) => {
  if (!d || d.reason === 'clean-exit') return;
  registrarQueda({ motor: 'electron', tipo: 'processo-caiu', processo: d.type || '', nome: d.name || d.serviceName || '', motivo: d.reason || '', codigo: d.exitCode != null ? d.exitCode : null });
});

/* A tela restaurou um painel: esta conversa estava no meio de um turno quando
   o app fechou (ou a tela recarregou)? Devolve e TIRA da lista: a mesma
   conversa nunca e' retomada duas vezes. */
ipcMain.handle('retomar:pegar', (_e, o) => {
  if (!o || typeof o !== 'object') return null;
  return retomada.pegar({ engine: String(o.engine || ''), sessaoId: o.sessaoId ? String(o.sessaoId) : '', paneId: o.paneId ? String(o.paneId) : '' });
});

app.whenReady().then(() => {
  try { logDaTela(); } catch {}   // abre o log de erros (tela.log) junto com o app (se falhar, o app abre igual); antes disso o primeiro logMain abre sozinho
  void engineUpdates.start();
  // o retomar.json da ultima vez: le, apaga, fica com o que tem menos de 2 h
  try { retomada.carregar(); } catch {}
  menu();
  createWindow();
  limparColadosAntigos();
  limparQuadrosOrfaos();
  limparSettingsAntigos();
  limparAudioDoDisco();          // voz que sobrou de um fechamento anormal
  limparPerguntasDoPainel('');   // e pergunta pendurada de uma sessao que morreu
  /* O vigia da caixa de perguntas comeca com o app. Preso ao start do painel,
     como estava, o pedido ficava parado sempre que o motor ja estivesse de pe
     antes - religou sozinho, voltou de outra aba - porque ninguem tinha
     chamado o vigia naquela volta. */
  ligarVigiaPerguntas();
  ligarInbox();
  try { ligarAtalhosGlobais(!!loadConfig().atalhosGlobais); } catch { ligarAtalhosGlobais(false); }
  setTimeout(() => codexStart().catch(() => {}), 1500);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { shutdown(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', shutdown);

/* Discussão acionada pela interface: histórico comum, identidades nativas separadas. */
const { DebateManager } = require('./cockpit-debate');
const { createDebateRunner } = require('./cockpit-debate-adapters');
const { captureReview } = require('./cockpit-review');
const debateRunner = createDebateRunner({
  codexReady: codexStart, codexRequest: codexReq,
  subscribe: (paneId, listener) => { debateListeners.set(paneId, listener); return () => debateListeners.delete(paneId); },
  bindThread: (tid, paneId) => { codex.threadToPane.set(tid, paneId); codex.paneToThread.set(paneId, tid); },
  unbindThread: (tid, paneId) => {
    descartarPermissoes(paneId); descartarPerguntasCodex(paneId);
    codex.threadToPane.delete(tid); codex.paneToThread.delete(paneId); codex.paneTurn.delete(paneId); codex.paneErrors?.delete(paneId); codex.paneMsgId.delete(paneId);
    observabilidade.encerrarPainel(paneId, 'codex', 'Discussão encerrada');
  },
  spawnClaude: (args, cwd) => spawnBin(claudeBin(), args, { cwd, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] }),
  stopProcess: matarProcesso,
  workspace: () => { const dir = path.join(app.getPath('userData'), 'debate-workspace'); fs.mkdirSync(dir, { recursive: true }); return dir; },
  /* o Codex le o projeto por este servidor MCP so' de leitura (o Electron roda
     como node, igual ao pergunta-mcp.js). Ver leitura-mcp.js pro porque. */
  leitor: (cwd) => ({ command: process.execPath, args: [path.join(__dirname, 'leitura-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1', COCKPIT_RAIZ: cwd } }),
  /* auditoria 2: o terminal do Codex nunca liga no debate (nem com o sandbox
     so'-leitura pronto): por ele um `type .env` lia o segredo que o leitor nega.
     O leitor acima basta pra ler o projeto. */
});
const debates = new DebateManager({
  directory: () => path.join(app.getPath('userData'), 'debates'), runTurn: debateRunner,
  onUpdate: state => { if (win && !win.isDestroyed()) win.webContents.send('debate:event', state); },
});
const debateCall = fn => async (_event, input) => { try { return await fn(input); } catch (error) { return { error: String(error.message || error).slice(0, 1500) }; } };
ipcMain.handle('debate:start', debateCall(input => { barrarNaJanelaDeTeste(); return debates.start(input); }));   // o Debater poe agentes a trabalhar na pasta de verdade
ipcMain.handle('debate:get', debateCall(id => debates.get(id)));
ipcMain.handle('debate:list', debateCall(() => debates.list()));
// a tela pergunta antes de abrir o dialogo (auditoria 2): a mesma regra que decide a leitura
ipcMain.handle('debate:leitura', debateCall(input => { const l = debates.leituraDe({ cwd: input?.cwd, remoto: false }); return { ...l, ampla: l.semLeitura === 'ampla' }; }));
ipcMain.handle('debate:continue', debateCall(async input => {
  barrarNaJanelaDeTeste();
  const state = debates.get(input.id);
  if (state.review) {
    const actual = await captureReview(state.review.cwd);
    if (actual.hash !== state.review.hash) throw new Error('O código mudou desde a revisão. Inicie um novo debate para revisar a versão atual.');
  }
  return debates.continue(input);
}));
ipcMain.handle('debate:stop', debateCall(id => debates.stop(id)));
ipcMain.handle('debate:review', debateCall(input => captureReview(input?.cwd)));
app.on('before-quit', () => debates.stopAll());
