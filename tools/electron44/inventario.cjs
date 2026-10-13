'use strict';
/* Inventário das APIs do Electron usadas pelo Cockpit.
   Leva 0, tarefa L0-a: auditoria do salto Electron 32.3.3 -> 44.5.1.

   Uso:  node tools/electron44/inventario.cjs   -> grava tools/electron44/inventario.json

   Só LÊ src/**\/*.js (fora src/renderer/vendor e node_modules). Não executa
   nada do Cockpit e não abre Electron.

   Como as APIs são achadas (análise de texto, sem executar):
   1. Comentário, texto entre aspas, template e regex viram espaço; linha e
      coluna continuam iguais. Assim 'renderer/app.js' não vira "app.js".
   2. Nomes ligados ao Electron, por arquivo:
      - desestruturação de require('electron'), com apelido (ipcMain: electronIpcMain);
      - require('electron').X direto;
      - injeção: parâmetro desestruturado com chave de módulo do Electron
        ({ ipcMain: nativeIpc }, { safeStorage }, { app, Menu, nativeTheme ... }).
        Nome genérico (app, session, shell...) só conta se houver ao lado um
        nome inequívoco (ipcMain, Menu, nativeTheme...);
      - parâmetro posicional com nome inequívoco (nativeTheme, systemPreferences...).
   3. Instâncias (instancia: true; modulo = nome da classe na documentação):
      - X = new BrowserWindow(...) e todo X que tenha X.webContents -> BrowserWindow;
      - .webContents -> WebContents; .session -> Session; .mainFrame/.senderFrame
        -> WebFrameMain; .sender e parâmetro "sender" -> WebContents; .thumbnail -> NativeImage;
      - variável que recebe retorno conhecido (clipboard.readImage(), Menu.getApplicationMenu()...);
      - propriedade de objeto que recebe instância ({ imagem: fonte.thumbnail } -> .imagem);
      - nos arquivos que recebem o Electron, parâmetros session/contents/frame/window.
   4. Cada <nome>.<membro> (chamado ou não) vira item; new X(...) vira "(construtor)".
      aguardado = precedido por await ou seguido por .then(.
   Limite: análise por arquivo, sem escopo de função. O que escapa disso foi
   conferido à mão e está no relatório (AUDITORIA-ELECTRON-44.md). */

const fs = require('node:fs');
const path = require('node:path');

const MODULOS = new Set(['app', 'autoUpdater', 'BaseWindow', 'BrowserView', 'BrowserWindow', 'clipboard',
  'ClipboardItem', 'contentTracing', 'contextBridge', 'crashReporter', 'desktopCapturer', 'dialog',
  'globalShortcut', 'inAppPurchase', 'ImageView', 'ipcMain', 'ipcRenderer', 'Menu', 'MenuItem',
  'MessageChannelMain', 'nativeImage', 'nativeTheme', 'net', 'netLog', 'Notification', 'parentPort',
  'powerMonitor', 'powerSaveBlocker', 'protocol', 'pushNotifications', 'safeStorage', 'screen', 'session',
  'ShareMenu', 'shell', 'systemPreferences', 'TouchBar', 'Tray', 'utilityProcess', 'View', 'webContents',
  'WebContentsView', 'webFrame', 'webFrameMain', 'webUtils']);
// Nomes que, no código do Cockpit, só podem ser o módulo do Electron.
const INEQUIVOCOS = new Set(['BaseWindow', 'BrowserView', 'BrowserWindow', 'clipboard', 'ClipboardItem',
  'contentTracing', 'contextBridge', 'crashReporter', 'desktopCapturer', 'globalShortcut', 'ipcMain',
  'ipcRenderer', 'Menu', 'MenuItem', 'nativeImage', 'nativeTheme', 'netLog', 'powerMonitor',
  'powerSaveBlocker', 'safeStorage', 'systemPreferences', 'Tray', 'utilityProcess', 'WebContentsView',
  'webFrame', 'webFrameMain', 'webUtils']);
const CONSTRUTORES = new Set(['BaseWindow', 'BrowserView', 'BrowserWindow', 'ClipboardItem', 'ImageView',
  'Menu', 'MenuItem', 'MessageChannelMain', 'Notification', 'ShareMenu', 'TouchBar', 'Tray', 'View',
  'WebContentsView']);
// tipo + propriedade -> tipo da propriedade ("." = módulo, "#" = instância)
const semProto = (o) => Object.assign(Object.create(null), o); // 'constructor' não pode achar Object.prototype
const PROPRIEDADES = semProto({
  'BrowserWindow#webContents': 'WebContents', 'WebContents#session': 'Session',
  'WebContents#mainFrame': 'WebFrameMain', 'WebContents#hostWebContents': 'WebContents',
  'WebContents#devToolsWebContents': 'WebContents', 'WebFrameMain#parent': 'WebFrameMain',
  'WebFrameMain#top': 'WebFrameMain', 'session.defaultSession': 'Session',
  'app.commandLine': 'CommandLine', 'app.dock': 'Dock',
});
// chamada -> tipo do retorno
const RETORNOS = semProto({
  'nativeImage.createEmpty': 'NativeImage', 'nativeImage.createFromPath': 'NativeImage',
  'nativeImage.createFromBitmap': 'NativeImage', 'nativeImage.createFromBuffer': 'NativeImage',
  'nativeImage.createFromDataURL': 'NativeImage', 'nativeImage.createFromNamedImage': 'NativeImage',
  'clipboard.readImage': 'NativeImage', 'NativeImage#crop': 'NativeImage', 'NativeImage#resize': 'NativeImage',
  'Menu.buildFromTemplate': 'Menu', 'Menu.getApplicationMenu': 'Menu',
  'session.fromPartition': 'Session', 'session.fromPath': 'Session',
  'BrowserWindow.getFocusedWindow': 'BrowserWindow', 'BrowserWindow.fromWebContents': 'BrowserWindow',
  'BrowserWindow.fromId': 'BrowserWindow', 'webContents.fromId': 'WebContents',
  'webContents.getFocusedWebContents': 'WebContents', 'webFrameMain.fromId': 'WebFrameMain',
  'WebContents#getOwnerBrowserWindow': 'BrowserWindow', 'BrowserWindow#getParentWindow': 'BrowserWindow',
});
// propriedade que, no processo principal, só pode ser destes tipos
const PROP_GLOBAIS = semProto({ webContents: 'WebContents', sender: 'WebContents', senderFrame: 'WebFrameMain', thumbnail: 'NativeImage' });
const PARAM_SEMPRE = semProto({ sender: 'WebContents', senderFrame: 'WebFrameMain' });
const PARAM_INJETADOS = semProto({ session: 'Session', ses: 'Session', contents: 'WebContents', webContents: 'WebContents',
  wc: 'WebContents', frame: 'WebFrameMain', mainFrame: 'WebFrameMain', window: 'BrowserWindow',
  win: 'BrowserWindow', janela: 'BrowserWindow' });
const PROCESSO_ELECTRON = new Set(['resourcesPath', 'type', 'getSystemMemoryInfo', 'getProcessMemoryInfo',
  'getHeapStatistics', 'getCPUUsage', 'getBlinkMemoryInfo', 'getCreationTime', 'getSystemVersion',
  'takeHeapSnapshot', 'defaultApp', 'mas', 'windowsStore', 'contextIsolated', 'sandboxed', 'noAsar', 'parentPort']);
const METODOS_EVENTO = new Set(['on', 'once', 'off', 'addListener', 'removeListener', 'prependListener',
  'prependOnceListener', 'removeAllListeners', 'emit', 'listenerCount']);
const METODOS_CANAL = new Set(['handle', 'handleOnce', 'removeHandler', 'invoke', 'send', 'sendSync', 'sendToHost', 'postMessage']);
const ANTES_DE_EXPRESSAO = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const PALAVRAS_CONTROLE = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'typeof']);

/* ---------- 1. limpar: comentário, texto, template e regex viram espaço ---------- */
function limpar(fonte) {
  const src = fonte.charCodeAt(0) === 0xfeff ? ' ' + fonte.slice(1) : fonte;
  const n = src.length;
  const out = src.split('');
  const literais = [];
  const pilha = []; // profundidade de chaves dentro de cada ${ } aberto
  let i = 0, ultimoSig = '', ultimaPalavra = '';
  const apaga = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const ehPalavra = (c) => /[A-Za-z0-9_$]/.test(c);

  function lerTemplate(k) { // k: logo depois de ` ou do } que fecha um ${
    const inicio = k;
    while (k < n) {
      const ch = src[k];
      if (ch === '\\') { k += 2; continue; }
      if (ch === '`') { apaga(inicio, k); return { fim: k + 1, fechou: true }; }
      if (ch === '$' && src[k + 1] === '{') { apaga(inicio, k); pilha.push(0); return { fim: k + 2, fechou: false }; }
      k++;
    }
    apaga(inicio, n);
    return { fim: n, fechou: true };
  }
  function fimRegex(k) { // k: na barra de abertura
    let j = k + 1, classe = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\n' || ch === '\r') return null;
      if (ch === '\\') { j += 2; continue; }
      if (classe) { if (ch === ']') classe = false; } else if (ch === '[') classe = true; else if (ch === '/') break;
      j++;
    }
    if (j >= n) return null;
    let f = j + 1;
    while (f < n && /[a-z]/i.test(src[f])) f++;
    return { corpoFim: j, fim: f };
  }
  function podeRegex() {
    if (!ultimoSig) return true;
    if ('(,=:[!&|?{};+-*%<>~^}'.includes(ultimoSig)) return true;
    return ultimoSig === 'a' && ANTES_DE_EXPRESSAO.has(ultimaPalavra);
  }

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { let f = src.indexOf('\n', i); if (f < 0) f = n; apaga(i, f); i = f; continue; }
    if (c === '/' && src[i + 1] === '*') { let f = src.indexOf('*/', i + 2); f = f < 0 ? n : f + 2; apaga(i, f); i = f; continue; }
    if (c === '"' || c === "'") {
      let k = i + 1, valor = '';
      while (k < n && src[k] !== c && src[k] !== '\n') {
        if (src[k] === '\\') { valor += src[k + 1] || ''; k += 2; continue; }
        valor += src[k]; k++;
      }
      apaga(i + 1, k);
      literais.push({ inicio: i, fim: k + 1, valor, tipo: 'texto' });
      i = k + 1; ultimoSig = c; ultimaPalavra = ''; continue;
    }
    if (c === '`') {
      const r = lerTemplate(i + 1);
      if (r.fechou) literais.push({ inicio: i, fim: r.fim, valor: src.slice(i + 1, r.fim - 1), tipo: 'template' });
      i = r.fim; ultimoSig = r.fechou ? '`' : '{'; ultimaPalavra = ''; continue;
    }
    if (c === '{') { if (pilha.length) pilha[pilha.length - 1]++; ultimoSig = c; ultimaPalavra = ''; i++; continue; }
    if (c === '}') {
      if (pilha.length && pilha[pilha.length - 1] === 0) {
        pilha.pop();
        const r = lerTemplate(i + 1);
        i = r.fim; ultimoSig = r.fechou ? '`' : '{'; ultimaPalavra = ''; continue;
      }
      if (pilha.length) pilha[pilha.length - 1]--;
      ultimoSig = c; ultimaPalavra = ''; i++; continue;
    }
    if (c === '/' && podeRegex()) {
      const r = fimRegex(i);
      if (r) {
        apaga(i + 1, r.corpoFim);
        literais.push({ inicio: i, fim: r.fim, valor: src.slice(i + 1, r.corpoFim), tipo: 'regex' });
        i = r.fim; ultimoSig = 'a'; ultimaPalavra = ''; continue;
      }
    }
    if (ehPalavra(c)) {
      let k = i; while (k < n && ehPalavra(src[k])) k++;
      ultimaPalavra = src.slice(i, k); ultimoSig = 'a'; i = k; continue;
    }
    ultimoSig = c; ultimaPalavra = ''; i++;
  }
  return { limpo: out.join(''), literais };
}

/* ---------- utilidades sobre o texto limpo ---------- */
const ID = /[A-Za-z_$][\w$]*/y;
function pularEspacos(t, k) { while (k < t.length && /\s/.test(t[k])) k++; return k; }
function anteriorSig(t, k) { k--; while (k >= 0 && /\s/.test(t[k])) k--; return k; }
function fecharPar(t, abre) {
  const par = { '(': ')', '[': ']', '{': '}' };
  const pilha = [par[t[abre]]];
  for (let k = abre + 1; k < t.length; k++) {
    const c = t[k];
    if (par[c]) pilha.push(par[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (pilha.pop() !== c) return -1;
      if (!pilha.length) return k;
    }
  }
  return -1;
}
function abrirPar(t, fecha) { // de um } volta até o { que o abre
  let prof = 0;
  for (let k = fecha; k >= 0; k--) {
    if (t[k] === '}') prof++;
    else if (t[k] === '{') { prof--; if (prof === 0) return k; }
  }
  return -1;
}
function palavraAntes(t, k) { // palavra que termina logo antes de k (pulando espaço)
  const p = anteriorSig(t, k);
  if (p < 0 || !/[\w$]/.test(t[p])) return '';
  let a = p; while (a > 0 && /[\w$]/.test(t[a - 1])) a--;
  return t.slice(a, p + 1);
}
function indiceDeLinhas(t) {
  const inicios = [0];
  for (let k = 0; k < t.length; k++) if (t[k] === '\n') inicios.push(k + 1);
  return (pos) => {
    let lo = 0, hi = inicios.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (inicios[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { linha: lo + 1, coluna: pos - inicios[lo] + 1 };
  };
}

/* Cadeia: nome(.membro | ?.membro | (args) | ?.(args))*  */
function lerCadeia(t, ini) {
  ID.lastIndex = ini;
  const m0 = ID.exec(t);
  const segs = [{ nome: m0[0], pos: ini, chamada: null }];
  let k = ID.lastIndex;
  for (;;) {
    let j = pularEspacos(t, k);
    if (t[j] === '?' && t[j + 1] === '.') {
      j = pularEspacos(t, j + 2);
      if (t[j] === '(') {
        const f = fecharPar(t, j); if (f < 0) break;
        if (segs[segs.length - 1].chamada) break;
        segs[segs.length - 1].chamada = { abre: j, fecha: f }; k = f + 1; continue;
      }
      if (t[j] === '[') break;
    } else if (t[j] === '.' && t[j + 1] !== '.') {
      j = pularEspacos(t, j + 1);
    } else if (t[j] === '(') {
      const f = fecharPar(t, j); if (f < 0) break;
      if (segs[segs.length - 1].chamada) break;
      segs[segs.length - 1].chamada = { abre: j, fecha: f }; k = f + 1; continue;
    } else break;
    ID.lastIndex = j;
    const m = ID.exec(t);
    if (!m) break;
    segs.push({ nome: m[0], pos: j, chamada: null });
    k = ID.lastIndex;
  }
  return { ini, segs, fim: k };
}
function listarCadeias(t) {
  const cadeias = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(t))) {
    const ini = m.index;
    if (ini > 0 && /[\w$]/.test(t[ini - 1])) continue;
    const p = anteriorSig(t, ini);
    if (p >= 0 && t[p] === '.' && !(t[p - 1] === '.' && t[p - 2] === '.')) continue; // é membro de outra cadeia
    cadeias.push(lerCadeia(t, ini));
    re.lastIndex = ini + m[0].length;
  }
  return cadeias;
}

/* ---------- 2. análise de um arquivo ---------- */
function prepararArquivo(raiz, abs) {
  const codigo = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(raiz, abs).split(path.sep).join('/');
  const { limpo, literais } = limpar(codigo);
  const base = path.basename(rel);
  return {
    rel, codigo, limpo, literais,
    literalEm: new Map(literais.map((l) => [l.inicio, l])),
    linhas: codigo.split('\n').map((l) => l.replace(/\r$/, '')),
    posicao: indiceDeLinhas(codigo),
    ehRenderer: rel.startsWith('src/renderer/') || /^preload/.test(base),
    cadeias: listarCadeias(limpo),
    vinculos: new Map(),  // nome -> { tipo: 'modulo'|'instancia'|'namespace', nome, origem }
    props: new Map(),     // nome de propriedade -> tipo de instância
    ciente: false,        // recebe Electron (require ou injeção)
  };
}

function vincular(arq, nome, alvo) { if (!arq.vinculos.has(nome)) arq.vinculos.set(nome, alvo); }

function entradasDesestruturacao(texto) {
  return texto.split(',').map((e) => e.trim()).filter(Boolean).map((e) => {
    const semPadrao = e.split('=')[0].trim();
    const [chave, apelido] = semPadrao.split(':').map((s) => s && s.trim());
    return { chave, apelido: apelido || chave };
  }).filter((e) => /^[A-Za-z_$][\w$]*$/.test(e.chave) && /^[A-Za-z_$][\w$]*$/.test(e.apelido));
}

function argumentoTexto(arq, seg) {
  if (!seg.chamada) return null;
  const j = pularEspacos(arq.limpo, seg.chamada.abre + 1);
  const lit = arq.literalEm.get(j);
  return lit && lit.tipo !== 'regex' ? lit.valor : null;
}

function vinculosIniciais(arq, itensModulo) {
  const t = arq.limpo;
  // require('electron'): desestruturação, namespace e direto
  const reReq = /(?<![\w$.])require\s*\(\s*(['"`])/g;
  let m;
  while ((m = reReq.exec(t))) {
    const aspas = m.index + m[0].length - 1;
    const lit = arq.literalEm.get(aspas);
    if (!lit || lit.valor !== 'electron') continue;
    arq.ciente = true;
    const antes = t.slice(Math.max(0, m.index - 4000), m.index);
    const des = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*$/.exec(antes);
    const ns = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(antes);
    if (des) {
      const inicioDes = m.index - antes.length + des.index + des[0].indexOf('{') + 1;
      let cursor = inicioDes;
      for (const e of entradasDesestruturacao(des[1])) {
        if (!MODULOS.has(e.chave)) continue;
        vincular(arq, e.apelido, { tipo: 'modulo', nome: e.chave, origem: 'require' });
        const p = t.indexOf(e.chave, cursor);
        const pos = p >= 0 ? p : m.index;
        cursor = pos + e.chave.length;
        itensModulo.push({ modulo: e.chave, membro: '(módulo)', pos, origem: 'require' });
      }
    } else if (ns && t[pularEspacos(t, lit.fim)] === ')' && t[pularEspacos(t, pularEspacos(t, lit.fim) + 1)] !== '.') {
      vincular(arq, ns[1], { tipo: 'namespace', nome: 'electron', origem: 'require' });
    }
  }
  // injeção: parâmetro desestruturado com módulo do Electron
  const reDes = /\(\s*\{([^{}]*)\}\s*(?:=\s*\{\s*\})?\s*(?:,[^()]*)?\)\s*(?:=>|\{)/g;
  while ((m = reDes.exec(t))) {
    const entradas = entradasDesestruturacao(m[1]);
    if (!entradas.some((e) => INEQUIVOCOS.has(e.chave))) continue;
    for (const e of entradas) {
      if (!MODULOS.has(e.chave)) continue;
      vincular(arq, e.apelido, { tipo: 'modulo', nome: e.chave, origem: 'injecao' });
      arq.ciente = true;
    }
  }
  // parâmetros posicionais
  const listas = [];
  const reFn = /function\s*[\w$]*\s*\(([^()]*)\)/g;
  while ((m = reFn.exec(t))) listas.push(m[1]);
  const reSeta = /(?<![\w$])\(([^()]*)\)\s*=>/g;
  while ((m = reSeta.exec(t))) listas.push(m[1]);
  const reUm = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = reUm.exec(t))) listas.push(m[1]);
  const reMetodo = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g;
  while ((m = reMetodo.exec(t))) if (!PALAVRAS_CONTROLE.has(m[1])) listas.push(m[2]);
  const nomes = [];
  for (const lista of listas) {
    for (const p of lista.split(',')) {
      const nome = p.split('=')[0].replace(/^\s*\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nome)) nomes.push(nome);
    }
  }
  for (const nome of nomes) {
    if (INEQUIVOCOS.has(nome)) { vincular(arq, nome, { tipo: 'modulo', nome, origem: 'injecao' }); arq.ciente = true; }
  }
  for (const nome of nomes) {
    if (!arq.ehRenderer && PARAM_SEMPRE[nome]) vincular(arq, nome, { tipo: 'instancia', nome: PARAM_SEMPRE[nome], origem: 'parametro' });
    if (!arq.ehRenderer && arq.ciente && PARAM_INJETADOS[nome]) vincular(arq, nome, { tipo: 'instancia', nome: PARAM_INJETADOS[nome], origem: 'parametro' });
  }
}

/* Percorre a cadeia. Devolve o tipo final e, se pedido, os itens. */
function percorrer(arq, cad, aoItem) {
  const segs = cad.segs;
  const raiz = segs[0];
  let obj = null;
  const v = arq.vinculos.get(raiz.nome);
  if (raiz.nome === 'require' && raiz.chamada && argumentoTexto(arq, raiz) === 'electron') obj = { tipo: 'namespace' };
  else if (raiz.nome === 'process' && segs[1] && PROCESSO_ELECTRON.has(segs[1].nome)) obj = { tipo: 'processo' };
  else if (v && !raiz.chamada) obj = v;
  for (let s = 1; s < segs.length; s++) {
    const seg = segs[s];
    if (obj && obj.tipo === 'namespace') {
      if (!MODULOS.has(seg.nome)) { obj = null; continue; }
      if (aoItem) aoItem({ modulo: seg.nome, membro: '(módulo)', pos: seg.pos, origem: 'require', seg, segs, s });
      obj = { tipo: 'modulo', nome: seg.nome, origem: 'require' };
      if (seg.chamada) obj = null;
      continue;
    }
    if (obj && obj.tipo === 'processo') {
      if (aoItem) aoItem({ modulo: 'process', membro: seg.nome, pos: seg.pos, origem: 'processo', seg, segs, s });
      obj = null; continue;
    }
    if (obj && (obj.tipo === 'modulo' || obj.tipo === 'instancia')) {
      const instancia = obj.tipo === 'instancia';
      if (aoItem) aoItem({ modulo: obj.nome, membro: seg.nome, pos: seg.pos, instancia, origem: obj.origem || 'instancia', seg, segs, s });
      const chave = obj.nome + (instancia ? '#' : '.') + seg.nome;
      const prox = seg.chamada ? RETORNOS[chave] : PROPRIEDADES[chave];
      obj = prox ? { tipo: 'instancia', nome: prox, origem: 'instancia' } : null;
      continue;
    }
    // dono desconhecido: propriedade que só pode ser de um tipo
    let tipo = null;
    if (!arq.ehRenderer && PROP_GLOBAIS[seg.nome]) tipo = PROP_GLOBAIS[seg.nome];
    else if (arq.props.has(seg.nome)) tipo = arq.props.get(seg.nome);
    // { janela } (atalho de objeto) leva a janela junto: recorte.janela é a janela
    else if (['BrowserWindow', 'WebContents', 'Session'].includes(arq.vinculos.get(seg.nome)?.nome)
      && arq.vinculos.get(seg.nome).tipo === 'instancia') tipo = arq.vinculos.get(seg.nome).nome;
    obj = tipo && !seg.chamada ? { tipo: 'instancia', nome: tipo, origem: 'instancia' } : null;
  }
  return obj;
}

function tipoDaExpressao(arq, pos) {
  const t = arq.limpo;
  let j = pularEspacos(t, pos);
  if (t.startsWith('await', j) && !/[\w$]/.test(t[j + 5] || '')) j = pularEspacos(t, j + 5);
  const novo = /^new\s+([A-Za-z_$][\w$]*)\s*\(/.exec(t.slice(j, j + 80));
  if (novo) {
    const v = arq.vinculos.get(novo[1]);
    if (v && v.tipo === 'modulo' && CONSTRUTORES.has(v.nome)) return { tipo: 'instancia', nome: v.nome, origem: 'instancia' };
    return null;
  }
  if (!/[A-Za-z_$]/.test(t[j] || '')) return null;
  const cad = lerCadeia(t, j);
  // só vale se a expressão ACABA na cadeia: "x = img ? a : b" não faz x virar imagem
  const prox = pularEspacos(t, cad.fim);
  const quebrouLinha = /[\r\n]/.test(t.slice(cad.fim, prox));
  const padrao = t.startsWith('||', prox) || t.startsWith('??', prox); // "e.sender || e": o valor é o da cadeia
  if (prox < t.length && !padrao && !';,)}]'.includes(t[prox]) && !(quebrouLinha && /[A-Za-z_$}]/.test(t[prox]))) return null;
  return percorrer(arq, cad, null);
}

function vinculosPorTipo(arq) {
  const t = arq.limpo;
  // X.webContents -> X é janela
  if (!arq.ehRenderer) {
    for (const cad of arq.cadeias) {
      const [raiz, seg] = cad.segs;
      if (!seg || seg.nome !== 'webContents' || raiz.chamada) continue;
      if (['this', 'event', 'e', '_e', 'evento'].includes(raiz.nome)) continue;
      if (!arq.vinculos.has(raiz.nome)) vincular(arq, raiz.nome, { tipo: 'instancia', nome: 'BrowserWindow', origem: 'instancia' });
    }
  }
  // atribuição: X = <expressão de tipo conhecido>
  const reAtrib = /(?<![\w$.])(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
  let m;
  while ((m = reAtrib.exec(t))) {
    if (arq.vinculos.has(m[1])) continue;
    const tipo = tipoDaExpressao(arq, m.index + m[0].length);
    if (tipo && (tipo.tipo === 'instancia' || tipo.tipo === 'modulo')) vincular(arq, m[1], tipo);
  }
  // propriedade de objeto: { chave: <instância> }
  const reProp = /(?<![\w$.?])([A-Za-z_$][\w$]*)\s*:(?!:)/g;
  while ((m = reProp.exec(t))) {
    const p = anteriorSig(t, m.index);
    if (p < 0 || (t[p] !== '{' && t[p] !== ',')) continue;
    if (arq.props.has(m[1])) continue;
    const tipo = tipoDaExpressao(arq, m.index + m[0].length);
    if (tipo && tipo.tipo === 'instancia') arq.props.set(m[1], tipo.nome);
  }
}

function aguardado(arq, item) {
  const { seg, segs, s } = item;
  if (!seg.chamada) return false;
  const prox = segs[s + 1];
  if (prox && prox.nome === 'then' && prox.chamada) return true;
  if (segs.slice(s + 1).some((x) => x.chamada)) return false;
  let k = segs[0].pos;
  while (true) { const p = anteriorSig(arq.limpo, k); if (p >= 0 && arq.limpo[p] === '(') k = p; else break; }
  return palavraAntes(arq.limpo, k) === 'await';
}

function montarItem(arq, bruto) {
  const { linha, coluna } = arq.posicao(bruto.pos);
  const item = {
    modulo: bruto.modulo, membro: bruto.membro, arquivo: arq.rel, linha, coluna,
    aguardado: bruto.seg ? aguardado(arq, bruto) : false,
    chamada: bruto.membro === '(construtor)' || !!(bruto.seg && bruto.seg.chamada),
    instancia: !!bruto.instancia, origem: bruto.origem || 'require',
    evento: null, canal: null,
    trecho: arq.linhas[linha - 1].trim().slice(0, 200),
  };
  if (bruto.seg && bruto.seg.chamada) {
    const texto = argumentoTexto(arq, bruto.seg);
    if (METODOS_EVENTO.has(bruto.membro)) item.evento = texto;
    else if (METODOS_CANAL.has(bruto.membro)) item.canal = texto;
  }
  // nativeTheme.themeSource = 'dark' é escrita (setter), não leitura
  if (bruto.seg && !bruto.seg.chamada && !bruto.segs[bruto.s + 1]) {
    const j = pularEspacos(arq.limpo, bruto.seg.pos + bruto.seg.nome.length);
    if (arq.limpo[j] === '=' && arq.limpo[j + 1] !== '=' && arq.limpo[j + 1] !== '>') item.escrita = true;
  }
  Object.defineProperty(item, '_pos', { value: bruto.pos, enumerable: false });
  return item;
}

function itensDoArquivo(arq) {
  const brutos = [];
  vinculosIniciais(arq, brutos);
  for (let volta = 0; volta < 3; volta++) vinculosPorTipo(arq);
  for (const cad of arq.cadeias) {
    const raiz = cad.segs[0];
    const v = arq.vinculos.get(raiz.nome);
    // new X(...)
    if (v && v.tipo === 'modulo' && CONSTRUTORES.has(v.nome) && palavraAntes(arq.limpo, raiz.pos) === 'new') {
      brutos.push({ modulo: v.nome, membro: '(construtor)', pos: raiz.pos, origem: v.origem, construtor: cad });
    }
    percorrer(arq, cad, (b) => brutos.push(b));
  }
  const vistos = new Set();
  const itens = [];
  for (const b of brutos) {
    const chave = b.modulo + '|' + b.membro + '|' + b.pos;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const item = montarItem(arq, b);
    if (b.construtor) Object.defineProperty(item, '_cadeia', { value: b.construtor, enumerable: false });
    itens.push(item);
  }
  return itens;
}

/* ---------- 3. opções de new BrowserWindow({...}) ---------- */
function partesDoObjeto(t, abre) {
  const fecha = fecharPar(t, abre);
  if (fecha < 0) return [];
  const partes = [];
  let prof = 0, ini = abre + 1;
  for (let k = abre + 1; k < fecha; k++) {
    const c = t[k];
    if (c === '(' || c === '[' || c === '{') prof++;
    else if (c === ')' || c === ']' || c === '}') prof--;
    else if (c === ',' && prof === 0) { partes.push([ini, k]); ini = k + 1; }
  }
  partes.push([ini, fecha]);
  return partes.filter(([a, b]) => t.slice(a, b).trim());
}
const curto = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 90);
function lerObjeto(arq, abre) {
  const chaves = [], valores = {}, espalhadas = [], aninhados = {};
  for (const [a, b] of partesDoObjeto(arq.limpo, abre)) {
    const limpo = arq.limpo.slice(a, b), orig = arq.codigo.slice(a, b);
    const ini = a + (limpo.length - limpo.trimStart().length);
    if (limpo.trim().startsWith('...')) { const k = limpo.indexOf('...'); espalhadas.push({ inicio: ini + 3, fim: b, expressao: curto(orig.slice(k + 3)) }); continue; }
    const kv = /^\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:/.exec(orig);
    if (kv) {
      const chave = kv[1].replace(/^['"]|['"]$/g, '');
      chaves.push(chave);
      valores[chave] = curto(orig.slice(kv[0].length));
      const iv = pularEspacos(arq.limpo, a + kv[0].length);
      if (arq.limpo[iv] === '{') aninhados[chave] = lerObjeto(arq, iv);
      continue;
    }
    const nome = orig.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(nome)) { chaves.push(nome); valores[nome] = nome; }
  }
  return { chaves, valores, espalhadas, aninhados };
}
function chavesDaFuncao(arquivos, nomeFn) {
  for (const arq of arquivos) {
    const re = new RegExp('function\\s+' + nomeFn.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
    const m = re.exec(arq.limpo);
    if (!m) continue;
    const abreArgs = m.index + m[0].length - 1;
    const fechaArgs = fecharPar(arq.limpo, abreArgs);
    const abre = arq.limpo.indexOf('{', fechaArgs);
    const fecha = fecharPar(arq.limpo, abre);
    const corpo = arq.limpo.slice(abre, fecha + 1);
    const ret = /return\s+([A-Za-z_$][\w$]*)\s*;/.exec(corpo);
    const chaves = new Set();
    if (ret) {
      const reAtr = new RegExp('(?<![\\w$.])' + ret[1] + '\\.([A-Za-z_$][\\w$]*)\\s*=(?![=>])', 'g');
      let a; while ((a = reAtr.exec(corpo))) chaves.add(a[1]);
    }
    return { arquivo: arq.rel, linha: arq.posicao(m.index).linha, chaves: [...chaves] };
  }
  return null;
}
function opcoesDasJanelas(arquivos, itens) {
  const saida = [];
  for (const item of itens) {
    if (item.modulo !== 'BrowserWindow' || item.membro !== '(construtor)') continue;
    const arq = arquivos.find((a) => a.rel === item.arquivo);
    const cad = item._cadeia;
    const raiz = cad.segs[0];
    if (!raiz.chamada) continue;
    const j = pularEspacos(arq.limpo, raiz.chamada.abre + 1);
    if (arq.limpo[j] !== '{') { saida.push({ arquivo: arq.rel, linha: item.linha, argumento: curto(arq.codigo.slice(j, raiz.chamada.fecha)) }); continue; }
    const obj = lerObjeto(arq, j);
    const espalhadas = obj.espalhadas.map((e) => {
      const chaves = new Set();
      let origem = null;
      for (let k = e.inicio; k < e.fim; k++) {
        if (arq.limpo[k] !== '{') continue;
        const f = fecharPar(arq.limpo, k);
        for (const c of lerObjeto(arq, k).chaves) chaves.add(c);
        k = f;
      }
      const chamadas = [...arq.limpo.slice(e.inicio, e.fim).matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]);
      for (const nomeFn of chamadas.reverse()) {
        const achado = chavesDaFuncao(arquivos, nomeFn);
        if (achado) { for (const c of achado.chaves) chaves.add(c); origem = achado.arquivo + ':' + achado.linha + ' (' + nomeFn + ')'; break; }
      }
      return { expressao: e.expressao, chaves: [...chaves], origem };
    });
    const wp = obj.aninhados.webPreferences;
    saida.push({
      arquivo: arq.rel, linha: item.linha, chaves: obj.chaves, valores: obj.valores, espalhadas,
      webPreferences: wp ? wp.chaves : [], valoresWebPreferences: wp ? wp.valores : {},
    });
  }
  return saida;
}

/* ---------- 4. catch vazios em volta de API do Electron ----------
   Brief: catch {}, catch (e) {}, catch (_) {}, .catch(() => {}) e .catch(() => null)
   a até 3 linhas de uma chamada do inventário. Para try/catch a regra usa o
   BLOCO try inteiro (mais preciso: o clipboard.readBuffer de main.js fica 5
   linhas acima do seu catch e a regra das 3 linhas o perderia). Para .catch()
   vale a regra das 3 linhas. Também marca, à parte, catch "silencioso": tem
   corpo, mas só devolve um valor padrão, sem registrar o erro. */
function catchesDoArquivo(arq, itens) {
  const t = arq.limpo, o = arq.codigo;
  const saida = [];
  const apiDe = (i) => i.modulo + (i.instancia ? '#' : '.') + i.membro;
  const reCatch = /(?<![\w$.])catch\s*(\(\s*([^()]*)\))?\s*\{/g;
  let m;
  while ((m = reCatch.exec(t))) {
    const abreCorpo = m.index + m[0].length - 1;
    const fechaCorpo = fecharPar(t, abreCorpo);
    if (fechaCorpo < 0) continue;
    const corpoLimpo = t.slice(abreCorpo + 1, fechaCorpo);
    const corpoOrig = o.slice(abreCorpo + 1, fechaCorpo);
    const vazio = corpoLimpo.trim() === '';
    const registra = /console\s*\.|\blog\w*\s*\(|\bthrow\b|registr\w*\s*\(|\breject\s*\(|\bwarn\s*\(|\berro\w*\s*\(|\baviso\w*\s*\(|\bnote\s*\(|\bemit\s*\(/.test(corpoLimpo);
    // devolver o erro para a tela (error: / e.message) também conta como avisar
    const param = (m[2] || '').trim();
    const usaParam = !!param && /^[A-Za-z_$][\w$]*$/.test(param)
      && corpoLimpo.split(/[^\w$]+/).includes(param);
    const repassa = /\berro(?:r)?\s*:/.test(corpoLimpo) || usaParam;
    const silencioso = !vazio && !registra && !repassa;
    if (!vazio && !silencioso) continue;
    const fimTry = anteriorSig(t, m.index);
    if (fimTry < 0 || t[fimTry] !== '}') continue;
    const abreTry = abrirPar(t, fimTry);
    if (abreTry < 0 || palavraAntes(t, abreTry) !== 'try') continue;
    const dentro = itens.filter((i) => i._pos > abreTry && i._pos < fimTry);
    if (!dentro.length) continue;
    const { linha } = arq.posicao(m.index);
    saida.push({
      arquivo: arq.rel, linha, tryLinha: arq.posicao(abreTry).linha,
      forma: m[1] ? 'catch (' + (m[2] || '').trim() + ') {…}' : 'catch {…}',
      classe: vazio ? 'vazio' : 'silencioso', soComentario: vazio && corpoOrig.trim() !== '',
      corpo: vazio ? '' : curto(corpoOrig),
      apis: [...new Set(dentro.map(apiDe))], linhasApis: [...new Set(dentro.map((i) => i.linha))],
      trecho: arq.linhas[linha - 1].trim().slice(0, 200),
    });
  }
  const rePromessa = /\.\s*catch\s*\(\s*(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/g;
  while ((m = rePromessa.exec(t))) {
    const { linha } = arq.posicao(m.index);
    const perto = itens.filter((i) => i.linha >= linha - 3 && i.linha <= linha && i._pos < m.index);
    if (!perto.length) continue;
    saida.push({
      arquivo: arq.rel, linha, tryLinha: null,
      forma: m[1].startsWith('{') ? '.catch(() => {})' : '.catch(() => ' + m[1] + ')',
      classe: 'vazio', soComentario: false, corpo: '',
      apis: [...new Set(perto.map(apiDe))], linhasApis: [...new Set(perto.map((i) => i.linha))],
      trecho: arq.linhas[linha - 1].trim().slice(0, 200),
    });
  }
  return saida;
}

/* ---------- 5. APIs web e CSS do renderer (para o salto do Chromium 128 -> 152) ---------- */
const WEB = [
  ['navigator.clipboard', /\bnavigator\s*\.\s*clipboard\s*\.\s*([A-Za-z_$][\w$]*)/g],
  ['evento colar (clipboardData)', /\.\s*clipboardData\b/g],
  ['document.execCommand', /\bdocument\s*\.\s*execCommand\s*\(/g],
  ['Notification (web)', /\bnew\s+Notification\s*\(|\bNotification\s*\.\s*(?:requestPermission|permission)\b/g],
  ['navigator.mediaDevices', /\bnavigator\s*\.\s*mediaDevices\s*\.\s*([A-Za-z_$][\w$]*)/g],
  ['window.open', /\bwindow\s*\.\s*open\s*\(/g],
  ['RTCPeerConnection', /\bnew\s+RTCPeerConnection\s*\(/g],
  ['MediaRecorder', /\bnew\s+MediaRecorder\s*\(/g],
  ['AudioContext', /\bnew\s+(?:webkit)?AudioContext\s*\(/g],
  ['fetch (renderer)', /(?<![\w$.])fetch\s*\(/g],
  ['WebSocket', /\bnew\s+WebSocket\s*\(/g],
  ['caminho de arquivo (webUtils.getPathForFile)', /\b(?:getPathForFile|caminhoDoArquivo)\b/g],
  ['dataTransfer.files', /\.\s*(?:dataTransfer|clipboardData)\s*\.\s*files\b/g],
  ['ResizeObserver', /\bnew\s+ResizeObserver\s*\(/g],
  ['unload/beforeunload', /addEventListener\s*\(\s*['"](?:unload|beforeunload)['"]/g],
];
function webDoArquivo(arq) {
  const saida = [];
  const vistos = new Set();
  for (const [api, re] of WEB) {
    const alvo = re.source.includes("['\"]") ? arq.codigo : arq.limpo;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(alvo))) {
      if (alvo === arq.codigo && arq.limpo.slice(m.index, m.index + 3) !== arq.codigo.slice(m.index, m.index + 3)) continue;
      const { linha } = arq.posicao(m.index);
      const nome = m[1] ? api + '.' + m[1] : api;
      if (vistos.has(nome + '|' + linha)) continue;
      vistos.add(nome + '|' + linha);
      saida.push({ api: nome, arquivo: arq.rel, linha, trecho: arq.linhas[linha - 1].trim().slice(0, 160) });
    }
  }
  return saida;
}
const CSS = [
  ['-webkit-app-region', /-webkit-app-region\s*:/g], ['zoom', /(?<![\w-])zoom\s*:/g],
  ['::-webkit-scrollbar', /::-webkit-scrollbar/g], ['scrollbar-width / scrollbar-color', /(?<![\w-])scrollbar-(?:width|color)\s*:/g],
  ['backdrop-filter', /(?<![\w-])(?:-webkit-)?backdrop-filter\s*:/g], ['::selection', /::selection/g],
  [':has()', /:has\(/g], ['@container', /@container\b/g], ['text-wrap', /(?<![\w-])text-wrap\s*:/g],
  ['field-sizing', /field-sizing\s*:/g], ['anchor positioning', /(?:anchor-name|position-anchor|position-area)\s*:/g],
  ['-webkit-line-clamp', /-webkit-line-clamp\s*:/g], ['overflow: overlay', /overflow(?:-[xy])?\s*:\s*overlay/g],
  ['appearance', /(?<![\w-])(?:-webkit-)?appearance\s*:/g], ['color-mix()', /color-mix\(/g],
  ['@layer', /@layer\b/g], ['@property', /@property\b/g], ['view-transition', /view-transition/g],
  ['content-visibility', /content-visibility\s*:/g], ['env(titlebar-area-*)', /env\(\s*titlebar-area/g],
  ['interpolate-size / calc-size()', /interpolate-size\s*:|calc-size\(/g], ['@starting-style', /@starting-style\b/g],
  [':focus-visible', /:focus-visible/g], ['text-box', /(?<![\w-])text-box(?:-trim|-edge)?\s*:/g],
];
function cssDoArquivo(raiz, abs) {
  const codigo = fs.readFileSync(abs, 'utf8');
  const semComentario = codigo.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const posicao = indiceDeLinhas(semComentario);
  const rel = path.relative(raiz, abs).split(path.sep).join('/');
  const saida = [];
  for (const [recurso, re] of CSS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(semComentario))) saida.push({ recurso, arquivo: rel, linha: posicao(m.index).linha });
  }
  return saida;
}

/* ---------- inventário completo ---------- */
function listarArquivos(dir, extensao) {
  const saida = [];
  (function anda(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { if (ent.name === 'node_modules' || ent.name === 'vendor') continue; anda(p); }
      else if (extensao.test(ent.name)) saida.push(p);
    }
  })(dir);
  return saida;
}

function inventariar({ raiz, pasta = 'src' } = {}) {
  const base = path.join(raiz, pasta);
  const arquivos = listarArquivos(base, /\.(c|m)?js$/).map((abs) => prepararArquivo(raiz, abs));
  const itens = [], catchVazios = [], web = [];
  for (const arq of arquivos) {
    const doArquivo = itensDoArquivo(arq);
    itens.push(...doArquivo);
    catchVazios.push(...catchesDoArquivo(arq, doArquivo));
    if (arq.ehRenderer) web.push(...webDoArquivo(arq));
  }
  const opcoesBrowserWindow = opcoesDasJanelas(arquivos, itens);
  const css = [];
  for (const abs of listarArquivos(path.join(base, 'renderer'), /\.css$/)) css.push(...cssDoArquivo(raiz, abs));
  const resumo = {};
  for (const i of itens) {
    const k = i.modulo + (i.instancia ? ' (instância)' : '');
    resumo[k] = (resumo[k] || 0) + 1;
  }
  const cssResumo = {};
  for (const c of css) cssResumo[c.recurso] = (cssResumo[c.recurso] || 0) + 1;
  return {
    pasta, arquivosLidos: arquivos.map((a) => a.rel), totalItens: itens.length, resumo,
    itens, opcoesBrowserWindow, catchVazios, web, css: { resumo: cssResumo, ocorrencias: css },
  };
}

module.exports = { inventariar, limpar, listarCadeias, MODULOS, _interno: { prepararArquivo, itensDoArquivo } };

if (require.main === module) {
  const raiz = path.resolve(__dirname, '..', '..');
  const r = inventariar({ raiz });
  const destino = path.join(__dirname, 'inventario.json');
  fs.writeFileSync(destino, JSON.stringify(r, null, 2) + '\n');
  const vazios = r.catchVazios.filter((c) => c.classe === 'vazio').length;
  console.log('inventario.json: ' + r.totalItens + ' usos de API em ' + new Set(r.itens.map((i) => i.arquivo)).size
    + ' arquivos; ' + r.opcoesBrowserWindow.length + ' new BrowserWindow; ' + vazios + ' catch vazios e '
    + (r.catchVazios.length - vazios) + ' silenciosos em volta de API.');
}
