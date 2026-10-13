'use strict';
/* Sonda das APIs do Electron usadas pelo Cockpit (leva 0, tarefa L0-a).

   App Electron mínimo. Lê ../inventario.json e, para cada módulo/membro que o
   Cockpit usa, grava se EXISTE, o typeof e, se for função, o length. Depois
   CHAMA só leituras sem efeito colateral (lista do brief) e grava se o retorno
   é Promise e de que tipo ele é. Sai sozinha com app.quit().

   Rodar SEMPRE com pasta de dados temporária (fora do perfil do Hugo):
     <runtime>\electron.exe tools\electron44\sonda --user-data-dir=<pasta temporária>
   Saída: tools/electron44/resultado-<versão do Electron>.json

   PROIBIDO chamar (aqui só typeof): tudo de shell, dialog e protocol; clipboard.write
   (todas as variantes) e clipboard.clear; session.clear (todas); app.relaunch;
   loadURL; Notification.show; globalShortcut.register. Da área de transferência grava só TIPO e TAMANHO,
   nunca o conteúdo. A janela de teste nasce escondida e nunca carrega página. */
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');

const PASTA = path.resolve(__dirname, '..');
const versao = process.versions.electron;
const destino = path.join(PASTA, 'resultado-' + versao + '.json');

// Isolamento: sem --user-data-dir a sonda não roda (não cria nada no AppData do Hugo).
const argDados = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (!argDados) {
  console.error('Use --user-data-dir=<pasta temporária>.');
  process.exit(2);
}
const pastaDados = argDados.slice('--user-data-dir='.length).replace(/^"|"$/g, '');
app.setPath('userData', pastaDados); // o main.js do Cockpit faz o mesmo (linha 51)

const SO_NO_RENDERER = new Set(['ipcRenderer', 'contextBridge', 'webFrame', 'webUtils']);
// PNG transparente de 1x1 px
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const resultado = {
  electron: versao, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
  plataforma: process.platform, arquitetura: process.arch, criadoEm: new Date().toISOString(),
  inventario: 'tools/electron44/inventario.json', incompleto: false,
  membros: [], chamadas: [], extras: {}, disponiveis: {}, avisos: [],
};
function gravar() { fs.writeFileSync(destino, JSON.stringify(resultado, null, 2) + '\n'); }
const trava = setTimeout(() => {
  resultado.incompleto = true;
  resultado.avisos.push('tempo esgotado (45 s)');
  gravar();
  app.exit(3);
}, 45000);
process.on('unhandledRejection', (e) => resultado.avisos.push('promessa rejeitada sem dono: ' + nomeErro(e)));

const nomeErro = (e) => (e && e.name ? e.name + ': ' : '') + String((e && e.message) || e).slice(0, 200);
function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'Array';
  if (Buffer.isBuffer(v)) return 'Buffer';
  if (typeof v === 'object') return (v.constructor && v.constructor.name) || 'object';
  return typeof v;
}
// Nome de formato pode revelar de onde o Hugo copiou (ex.: um app). Só os padrões ficam.
function tipoPublico(t) {
  const s = String(t);
  if (/^(text\/(plain|html|rtf|uri-list)|image\/(png|jpeg|gif|bmp|webp|svg\+xml))$/i.test(s)) return s;
  if (s.startsWith('electron application/')) return 'electron application/* (formato nativo)';
  return 'outro formato';
}
const tiposPublicos = (lista) => [...new Set(lista.map(tipoPublico))];
const ehPromessa = (v) => !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('sem resposta em ' + ms + ' ms')), ms))]);
function nomesDisponiveis(obj) {
  const nomes = new Set();
  let o = obj;
  while (o && o !== Object.prototype && o !== Function.prototype) {
    for (const n of Object.getOwnPropertyNames(o)) if (n !== 'constructor' && !n.startsWith('_')) nomes.add(n);
    o = Object.getPrototypeOf(o);
  }
  return [...nomes].sort();
}
function lerMembro(alvo, membro) {
  try {
    const valor = membro === '(módulo)' || membro === '(construtor)' ? alvo : alvo[membro];
    const t = typeof valor;
    return { existe: valor !== undefined, typeof: t, length: t === 'function' ? valor.length : null };
  } catch (e) { return { existe: false, typeof: 'erro', length: null, erro: nomeErro(e) }; }
}

/* Chama uma leitura. Grava: deu certo?, é Promise?, tipo do valor (já resolvido)
   e um detalhe SEM conteúdo (tamanho, quantidade). */
async function chamar(id, modulo, membro, fn, descrever = () => ({}), instancia = false) {
  const reg = { id, modulo, membro, instancia };
  let bruto;
  try { bruto = fn(); } catch (e) {
    reg.ok = false; reg.erro = nomeErro(e); resultado.chamadas.push(reg);
    return { ok: false };
  }
  reg.ok = true;
  reg.promise = ehPromessa(bruto);
  let valor = bruto;
  if (reg.promise) {
    try { valor = await comPrazo(bruto, 5000); } catch (e) {
      reg.ok = false; reg.rejeitou = true; reg.erro = nomeErro(e); resultado.chamadas.push(reg);
      return { ok: false, bruto };
    }
  }
  reg.tipo = tipoDe(valor);
  try { Object.assign(reg, descrever(valor)); } catch (e) { reg.detalheErro = nomeErro(e); }
  resultado.chamadas.push(reg);
  return { ok: true, valor, bruto };
}

function membrosDoInventario() {
  const inv = JSON.parse(fs.readFileSync(path.join(PASTA, 'inventario.json'), 'utf8'));
  const unicos = new Map();
  for (const i of inv.itens) {
    const chave = i.modulo + (i.instancia ? '#' : '.') + i.membro;
    if (!unicos.has(chave)) unicos.set(chave, { modulo: i.modulo, membro: i.membro, instancia: !!i.instancia, usos: 0 });
    unicos.get(chave).usos++;
  }
  return [...unicos.values()];
}

app.whenReady().then(async () => {
  const { clipboard, nativeImage, screen, nativeTheme, systemPreferences, powerMonitor, safeStorage,
    webContents, BrowserWindow, Menu } = electron;
  const membros = membrosDoInventario();

  /* ---- 1) leituras do brief (antes de abrir a janela de teste) ---- */
  const texto = await chamar('clipboard.readText()', 'clipboard', 'readText', () => clipboard.readText(),
    (v) => ({ tamanho: typeof v === 'string' ? v.length : null }));
  await chamar("clipboard.has('image/png')", 'clipboard', 'has', () => clipboard.has('image/png'),
    (v) => (typeof v === 'boolean' ? { valor: v } : {}));
  await chamar('clipboard.availableFormats()', 'clipboard', 'availableFormats', () => clipboard.availableFormats(),
    (v) => (Array.isArray(v) ? { quantidade: v.length, formatos: tiposPublicos(v) } : {}));
  await chamar('clipboard.readImage()', 'clipboard', 'readImage', () => clipboard.readImage(),
    (v) => ({ isEmpty: v && typeof v.isEmpty === 'function' ? v.isEmpty() : null }));
  await chamar("clipboard.read('text/uri-list')", 'clipboard', 'read', () => clipboard.read('text/uri-list'), (v) => {
    if (typeof v === 'string') return { tamanho: v.length };
    if (!Array.isArray(v)) return {};
    return { itens: v.length, tiposDosItens: tiposPublicos(v.flatMap((i) => (Array.isArray(i && i.types) ? i.types : []))),
      tipoDoGetType: v[0] ? typeof v[0].getType : null };
  });
  await chamar("clipboard.readBuffer('FileNameW')", 'clipboard', 'readBuffer', () => clipboard.readBuffer('FileNameW'),
    (v) => (Buffer.isBuffer(v) ? { bytes: v.length } : {}));
  await chamar("app.getPath('userData')", 'app', 'getPath', () => app.getPath('userData'));
  await chamar('app.getVersion()', 'app', 'getVersion', () => app.getVersion());
  await chamar('app.getLocale()', 'app', 'getLocale', () => app.getLocale());
  await chamar('screen.getPrimaryDisplay()', 'screen', 'getPrimaryDisplay', () => screen.getPrimaryDisplay(),
    (v) => ({ temScaleFactor: typeof (v && v.scaleFactor) === 'number' }));
  await chamar('nativeTheme.shouldUseDarkColors', 'nativeTheme', 'shouldUseDarkColors', () => nativeTheme.shouldUseDarkColors);
  await chamar('systemPreferences.getAccentColor()', 'systemPreferences', 'getAccentColor', () => systemPreferences.getAccentColor(),
    (v) => ({ formatoRRGGBBAA: typeof v === 'string' && /^[0-9a-f]{8}$/i.test(v) }));
  await chamar('powerMonitor.getSystemIdleTime()', 'powerMonitor', 'getSystemIdleTime', () => powerMonitor.getSystemIdleTime());
  await chamar('safeStorage.isEncryptionAvailable()', 'safeStorage', 'isEncryptionAvailable', () => safeStorage.isEncryptionAvailable(),
    (v) => ({ valor: v }));
  await chamar('webContents.getAllWebContents()', 'webContents', 'getAllWebContents', () => webContents.getAllWebContents(),
    (v) => ({ quantidade: v.length }));
  await chamar('BrowserWindow.getAllWindows()', 'BrowserWindow', 'getAllWindows', () => BrowserWindow.getAllWindows(),
    (v) => ({ quantidade: v.length }));
  await chamar('Menu.getApplicationMenu()', 'Menu', 'getApplicationMenu', () => Menu.getApplicationMenu());
  await chamar('nativeImage.createEmpty()', 'nativeImage', 'createEmpty', () => nativeImage.createEmpty(),
    (v) => ({ isEmpty: v.isEmpty() }));
  const img = await chamar('nativeImage.createFromDataURL(PNG 1 px)', 'nativeImage', 'createFromDataURL',
    () => nativeImage.createFromDataURL(PNG_1PX));
  if (img.ok) {
    const imagem = img.valor;
    await chamar('NativeImage#isEmpty()', 'NativeImage', 'isEmpty', () => imagem.isEmpty(), (v) => ({ valor: v }), true);
    await chamar('NativeImage#toPNG()', 'NativeImage', 'toPNG', () => imagem.toPNG(), (v) => ({ bytes: Buffer.isBuffer(v) ? v.length : null }), true);
    await chamar('NativeImage#getSize()', 'NativeImage', 'getSize', () => imagem.getSize(), (v) => ({ largura: v.width, altura: v.height }), true);
  }

  /* ---- 2) leituras extras, também sem efeito colateral ----
     a) Electron 36: app.commandLine passou a converter maiúsculas. O Cockpit lê
        --user-data-dir por aqui (main.js:47) e usa o valor como pasta de dados.
     b) A ponte (IPC) não carrega Promise. Se o retorno do readText virou Promise,
        mandar { texto: <Promise> } para a tela falha ("could not be cloned").
        v8.serialize usa o mesmo serializador estruturado do V8.
     c) ClipboardItem e clipboard.selection são novos no 44 (troca do readImage). */
  const sw = await chamar("app.commandLine.getSwitchValue('user-data-dir')", 'CommandLine', 'getSwitchValue',
    () => app.commandLine.getSwitchValue('user-data-dir'), () => ({}), true);
  await chamar("app.commandLine.hasSwitch('user-data-dir')", 'CommandLine', 'hasSwitch',
    () => app.commandLine.hasSwitch('user-data-dir'), (v) => ({ valor: v }), true);
  if (sw.ok && typeof sw.valor === 'string') {
    resultado.extras.commandLineUserDataDir = {
      igualAoPassado: sw.valor === pastaDados,
      igualIgnorandoMaiusculas: sw.valor.toLowerCase() === pastaDados.toLowerCase(),
      virouMinusculo: sw.valor !== pastaDados && sw.valor === pastaDados.toLowerCase(),
      passadoTinhaMaiuscula: pastaDados !== pastaDados.toLowerCase(),
    };
  }
  if (texto.ok || texto.bruto !== undefined) {
    try { v8.serialize({ texto: texto.bruto }); resultado.extras.ponteCarregaRetornoDoReadText = { lanca: false }; }
    catch (e) { resultado.extras.ponteCarregaRetornoDoReadText = { lanca: true, erro: nomeErro(e) }; }
  }
  resultado.extras.ClipboardItem = typeof electron.ClipboardItem;
  resultado.extras.clipboardSelection = typeof clipboard.selection;

  /* ---- 3) janela escondida, sem página: typeof dos membros de instância ---- */
  let win = null;
  try {
    win = new BrowserWindow({ show: false, width: 200, height: 200,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  } catch (e) { resultado.avisos.push('janela de teste não abriu: ' + nomeErro(e)); }
  let menuTeste = null;
  const INSTANCIAS = {
    BrowserWindow: () => win,
    WebContents: () => win && win.webContents,
    Session: () => electron.session.defaultSession,
    WebFrameMain: () => win && win.webContents.mainFrame,
    NativeImage: () => (img.ok ? img.valor : null),
    Menu: () => menuTeste || (menuTeste = Menu.getApplicationMenu() || new Menu()),
    CommandLine: () => app.commandLine,
    Dock: () => app.dock,
  };
  if (win) {
    try { resultado.extras.mainFrameMesmoObjeto = win.webContents.mainFrame === win.webContents.mainFrame; } catch (e) { resultado.extras.mainFrameMesmoObjeto = nomeErro(e); }
    try { resultado.extras.sessaoDaJanelaEhAPadrao = win.webContents.session === electron.session.defaultSession; } catch (e) { resultado.extras.sessaoDaJanelaEhAPadrao = nomeErro(e); }
  }

  /* ---- 4) existe / typeof / length de cada membro do inventário ---- */
  for (const m of membros) {
    const reg = { modulo: m.modulo, membro: m.membro, instancia: m.instancia, usos: m.usos };
    if (!m.instancia && SO_NO_RENDERER.has(m.modulo)) {
      Object.assign(reg, { verificavel: false, motivo: 'só existe no preload/renderer; conferido pela tipagem oficial' });
    } else if (m.instancia) {
      let alvo = null, motivo = null;
      try { alvo = INSTANCIAS[m.modulo] ? INSTANCIAS[m.modulo]() : null; } catch (e) { motivo = nomeErro(e); }
      if (alvo == null) Object.assign(reg, { verificavel: false, motivo: motivo || (m.modulo === 'Dock' ? 'só existe no macOS' : 'sem instância de teste') });
      else Object.assign(reg, { verificavel: true }, lerMembro(alvo, m.membro));
    } else {
      const alvo = m.modulo === 'process' ? process : m.membro === '(módulo)' || m.membro === '(construtor)' ? electron[m.modulo] : (() => { try { return electron[m.modulo]; } catch { return undefined; } })();
      if (m.membro !== '(módulo)' && m.membro !== '(construtor)' && alvo == null) Object.assign(reg, { verificavel: true, existe: false, typeof: 'undefined', length: null, moduloAusente: true });
      else Object.assign(reg, { verificavel: true }, lerMembro(alvo, m.membro));
    }
    resultado.membros.push(reg);
  }
  for (const nome of [...new Set(membros.filter((m) => !m.instancia && !SO_NO_RENDERER.has(m.modulo) && m.modulo !== 'process').map((m) => m.modulo))]) {
    try { resultado.disponiveis[nome] = nomesDisponiveis(electron[nome]); } catch (e) { resultado.disponiveis[nome] = nomeErro(e); }
  }
  for (const [nome, prov] of Object.entries(INSTANCIAS)) {
    try { const alvo = prov(); if (alvo != null) resultado.disponiveis[nome + ' (instância)'] = nomesDisponiveis(alvo); } catch { /* sem instância */ }
  }

  clearTimeout(trava);
  gravar();
  try { if (win) win.destroy(); } catch { /* já fechada */ }
  app.quit();
}).catch((e) => {
  resultado.incompleto = true;
  resultado.avisos.push('falha geral: ' + nomeErro(e));
  gravar();
  app.exit(4);
});
