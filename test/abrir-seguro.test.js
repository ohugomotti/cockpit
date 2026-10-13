'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { lerFonte, globaisFalsos } = require('../testes/raiz');
const { decidirAbertura } = require('../src/abrir-seguro.js');

/* R3-06: o "Abrir no PC" usa o shell.openPath, que segue a associação do Windows. Com o Python Launcher instalado,
   um .py gravado pelo agente RODA no clique de quem só queria ver o arquivo. decidirAbertura é a regra pura (sem
   disco): script e executável só aparecem na pasta ('revelar'); o resto abre normal ('abrir'). */

test('script e executável nunca abrem direto', () => {
  for (const f of ['a.py','a.pyw','a.rb','a.php','a.lua','a.r','a.pl','a.js','a.jse','a.vbs','a.vbe','a.wsf','a.wsh','a.ps1','a.psm1','a.bat','a.cmd','a.com','a.exe','a.msi','a.scr','a.hta','a.cpl','a.lnk','a.reg','a.jar','a.sh','A.PY'])
    assert.equal(decidirAbertura('C:\\x\\' + f), 'revelar', f);
});

test('documento e imagem abrem normal', () => {
  for (const f of ['a.md','a.txt','a.pdf','a.png','a.docx','a.xlsx','a.html','a.csv','pasta'])
    assert.equal(decidirAbertura('C:\\x\\' + f), 'abrir', f);
});

test('o nome como o Windows enxerga: ponto e espaço no fim não escondem a extensão; caminho do Mac e do servidor também valem', () => {
  for (const p of ['C:\\x\\a.py.', 'C:\\x\\a.py ', 'C:\\x\\a.PY. .', 'C:\\x\\.bat', 'C:/x/a.exe', 'C:\\x.txt\\a.py', 'C:\\x\\a.txt:b.py', '/Users/hugo/a.py', '/home/hugo/run.sh', 'a.py'])
    assert.equal(decidirAbertura(p), 'revelar', p);
  // a extensão é a do ÚLTIMO pedaço do caminho: pasta com nome de script e dupla extensão inofensiva não contam
  for (const p of ['C:\\x\\py', 'C:\\x\\a.py.txt', 'C:\\x.py\\nota.md', 'C:\\x\\a.md.', '/home/hugo/readme', 'C:\\x\\pasta.py\\', '', '   ', null, undefined, 42])
    assert.equal(decidirAbertura(p), 'abrir', JSON.stringify(p));
});

/* =====================================================================
   O main: shell:open nunca executa script, devolve { error } de verdade e shell:mostrarNaPasta existe.
   O main não carrega em teste (precisa do Electron): roda o código REAL recortado do main.js, de onde ele importa
   o ./abrir-seguro até o shell:link (handlers + lista de "abre direto" + podeAbrirDireto), com o disco e o shell
   de mentira. Cada toque no shell fica anotado: o que importa é provar que o openPath, que EXECUTA, não é chamado.
   ===================================================================== */
const main = lerFonte('main.js');
const MENSAGEM = 'Caminho de rede bloqueado por segurança.';
const simples = (v) => JSON.parse(JSON.stringify(v));   // o objeto nasce dentro do vm (outro Object.prototype)

function linhaConst(nome) {
  const ini = main.indexOf('const ' + nome + ' = ');
  return ini < 0 ? '' : main.slice(ini, main.indexOf('\n', ini));
}
function recorteDoMain() {
  const meio = main.indexOf("require('./abrir-seguro')");
  assert.ok(meio >= 0, 'o main.js não importa o ./abrir-seguro');
  const ini = main.lastIndexOf('\n', meio) + 1;
  const fim = main.indexOf("ipcMain.handle('shell:link'");
  assert.ok(fim > ini, "não achei o ipcMain.handle('shell:link' depois do import do ./abrir-seguro");
  return main.slice(ini, fim);
}

function montarMain({ openPath = '', existe = () => true, pasta = () => false, mostrarFalha = null } = {}) {
  const toques = [];
  const handlers = {};
  const ctx = {
    path, EH_WIN: true,
    fs: {
      statSync: (p) => { toques.push({ nome: 'fs.statSync', p }); if (!existe(p)) throw new Error('ENOENT: ' + p); return { isDirectory: () => pasta(p) }; },
      existsSync: (p) => { toques.push({ nome: 'fs.existsSync', p }); return existe(p); },
    },
    shell: {
      openPath: async (p) => {
        toques.push({ nome: 'shell.openPath', p });
        if (openPath instanceof Error) throw openPath;
        return typeof openPath === 'function' ? openPath(p) : openPath;
      },
      showItemInFolder: (p) => { toques.push({ nome: 'shell.showItemInFolder', p }); if (mostrarFalha) throw mostrarFalha; },
    },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    require: (nome) => { if (nome === './abrir-seguro') return require('../src/abrir-seguro.js'); throw new Error('require inesperado no recorte: ' + nome); },
  };
  vm.createContext(ctx);
  for (const nome of ['MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede']) vm.runInContext(linhaConst(nome), ctx);
  vm.runInContext(recorteDoMain(), ctx);
  const noShell = () => toques.filter((t) => t.nome.startsWith('shell.'));
  return { ctx, toques, noShell, chamar: (canal, ...args) => handlers[canal]({}, ...args) };
}

test('shell:open: script e executável só aparecem na pasta; o openPath (que executa) nunca é chamado', async () => {
  for (const f of ['a.py', 'A.PY', 'a.pyw', 'a.rb', 'a.php', 'a.lua', 'a.r', 'a.js', 'a.ps1', 'a.bat', 'a.cmd', 'a.exe', 'a.lnk', 'a.sh', 'a.vbs', 'a.jar', 'a.py.']) {
    const caminho = 'C:\\Users\\hugom\\proj\\' + f;
    const { noShell, chamar } = montarMain();
    assert.deepEqual(simples(await chamar('shell:open', caminho)), { ok: true, revelado: true }, f);
    assert.deepEqual(noShell(), [{ nome: 'shell.showItemInFolder', p: caminho }], 'só mostrar na pasta: ' + f);
  }
});

test('shell:open: pasta com nome de script (site.com, next.js) abre normal, não só aparece na pasta', async () => {
  for (const nome of ['site.com', 'next.js', 'ferramenta.exe']) {
    const caminho = 'C:\\Users\\hugom\\' + nome;
    const { noShell, chamar } = montarMain({ pasta: () => true });
    assert.deepEqual(simples(await chamar('shell:open', caminho)), { ok: true }, nome);
    assert.deepEqual(noShell(), [{ nome: 'shell.openPath', p: caminho }], nome);
  }
});

test('shell:open: o texto de erro do openPath vira { error } na tela; vazio é sucesso; exceção também vira { error }', async () => {
  const caminho = 'C:\\Users\\hugom\\nota.md';
  const falha = montarMain({ openPath: 'Failed to open path' });
  assert.deepEqual(simples(await falha.chamar('shell:open', caminho)), { error: 'Failed to open path' });
  assert.deepEqual(falha.noShell(), [{ nome: 'shell.openPath', p: caminho }]);
  const abriu = montarMain({ openPath: '' });
  assert.deepEqual(simples(await abriu.chamar('shell:open', caminho)), { ok: true });
  const explode = montarMain({ openPath: new Error('o shell caiu') });
  assert.deepEqual(simples(await explode.chamar('shell:open', caminho)), { error: 'o shell caiu' });
});

test('shell:open: tipo fora da lista de permitidos continua recusado: abre a pasta e explica', async () => {
  const caminho = 'C:\\Users\\hugom\\a.dll';
  const { noShell, chamar } = montarMain();
  const r = simples(await chamar('shell:open', caminho));
  assert.match(r.error, /não abre direto/);
  assert.deepEqual(noShell(), [{ nome: 'shell.showItemInFolder', p: caminho }]);
});

test('lista de "abre direto": py, rb, php, lua e r saíram (o Windows executa); o resto continua', () => {
  const { ctx } = montarMain();
  for (const e of ['py', 'rb', 'php', 'lua', 'r']) assert.equal(ctx.podeAbrirDireto('C:\\x\\a.' + e), false, e);
  for (const e of ['md', 'txt', 'json', 'go', 'rs', 'java', 'cs', 'ipynb', 'ts', 'pdf', 'png']) assert.equal(ctx.podeAbrirDireto('C:\\x\\a.' + e), true, e);
});

test('shell:open e shell:mostrarNaPasta recusam caminho de rede (script inclusive) antes de tocar no disco ou no shell', async () => {
  for (const canal of ['shell:open', 'shell:mostrarNaPasta']) {
    for (const p of ['\\\\servidor\\pasta\\a.py', '//servidor/pasta/a.md', '/\\servidor/pasta/a.exe', '\\\\?\\UNC\\servidor\\pasta\\a.md']) {
      const { toques, chamar } = montarMain();
      assert.deepEqual(simples(await chamar(canal, p)), { error: MENSAGEM }, canal + ' ' + p);
      assert.deepEqual(toques, [], 'encostou em algo: ' + canal + ' ' + p);
    }
  }
});

test('shell:mostrarNaPasta: só mostra o arquivo na pasta, sem abrir nada (script, executável e pasta também)', async () => {
  for (const f of ['a.md', 'a.py', 'a.exe', 'pasta']) {
    const caminho = 'C:\\Users\\hugom\\' + f;
    const { noShell, chamar } = montarMain();
    assert.deepEqual(simples(await chamar('shell:mostrarNaPasta', caminho)), { ok: true }, f);
    assert.deepEqual(noShell(), [{ nome: 'shell.showItemInFolder', p: caminho }], f);
  }
});

test('shell:mostrarNaPasta: arquivo que não existe e falha do shell viram { error }, não silêncio', async () => {
  const sumiu = montarMain({ existe: () => false });
  assert.deepEqual(simples(await sumiu.chamar('shell:mostrarNaPasta', 'C:\\x\\sumiu.md')), { error: 'Caminho não encontrado.' });
  assert.deepEqual(sumiu.noShell(), []);
  assert.deepEqual(simples(await montarMain().chamar('shell:mostrarNaPasta', '')), { error: 'Caminho não encontrado.' });
  assert.deepEqual(simples(await montarMain().chamar('shell:mostrarNaPasta', undefined)), { error: 'Caminho não encontrado.' });
  const quebra = montarMain({ mostrarFalha: new Error('o Explorer não respondeu') });
  assert.deepEqual(simples(await quebra.chamar('shell:mostrarNaPasta', 'C:\\x\\a.md')), { error: 'o Explorer não respondeu' });
});

/* =====================================================================
   A ponte (preload)
   ===================================================================== */
test('preload: mostrarNaPasta chama shell:mostrarNaPasta, e o openPath segue em shell:open', async () => {
  const bus = new EventEmitter(), chamadas = []; let api;
  bus.sendSync = () => ({}); bus.invoke = async (...args) => { chamadas.push(args); return { ok: true }; };
  vm.runInNewContext(lerFonte('preload.js'), {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  assert.equal(typeof api.mostrarNaPasta, 'function', 'falta api.mostrarNaPasta');
  await api.mostrarNaPasta('C:\\x\\a.py');
  await api.openPath('C:\\x\\a.md');
  assert.deepEqual(chamadas, [['shell:mostrarNaPasta', 'C:\\x\\a.py'], ['shell:open', 'C:\\x\\a.md']]);
});

/* =====================================================================
   A tela: o trecho REAL do visor (app.js) rodando num vm, com um DOM de mentira que tem o painel do index.html
   (visor-top com o botão "Abrir no PC", caminho, barra de leitura e corpo).
   ===================================================================== */
const app = lerFonte('renderer', 'app.js');
const trechoVisor = app.slice(
  app.indexOf('/* ============ visualizador de arquivo ============ */'),
  app.indexOf('/* ============ conversas recentes ============ */'));
assert.ok(trechoVisor.length > 200, 'não achei o trecho do visor no app.js');

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.eventos = {};
    this.texto = ''; this.html = ''; this.scrollTop = 0; this.title = '';
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const no = this;
    return {
      add: (...c) => c.forEach((x) => no.classes.add(x)),
      remove: (...c) => c.forEach((x) => no.classes.delete(x)),
      contains: (c) => no.classes.has(c),
      toggle: (c, liga) => { const on = liga === undefined ? !no.classes.has(c) : !!liga; if (on) no.classes.add(c); else no.classes.delete(c); return on; },
    };
  }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = String(v); this.texto = ''; this.esvaziar(); }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.esvaziar(); }
  get isConnected() { return true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  esvaziar() { for (const f of this.filhos) f.pai = null; this.filhos = []; }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  focus() {}
  scrollIntoView() {}
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  querySelectorAll(sel) {
    const casa = sel.startsWith('.') ? (n) => n.classes.has(sel.slice(1)) : (n) => n.tagName.toLowerCase() === sel;
    return this.descendentes.filter(casa);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function filho(pai, tag, classes = '') { const n = new No(tag); n.className = classes; pai.appendChild(n); return n; }

// o painel do index.html: o visor mora dentro do painel (template tplPane)
function painelComVisor() {
  const el = new No('section');
  const v = filho(el, 'div', 'modal p-visor hidden');
  const cx = filho(v, 'div', 'visor-cx');
  const top = filho(cx, 'div', 'visor-top');
  const ident = filho(top, 'div', 'visor-identidade'); filho(ident, 'span', 'visor-nome'); filho(ident, 'span', 'visor-origem');
  filho(top, 'button', 'visor-abrir'); filho(top, 'button', 'visor-x');
  filho(cx, 'div', 'visor-caminho');
  const barra = filho(cx, 'div', 'visor-toolbar hidden');
  const modos = filho(barra, 'div', 'visor-modos'); filho(modos, 'button', 'visor-previa'); filho(modos, 'button', 'visor-fonte');
  filho(barra, 'button', 'visor-copiar');
  filho(cx, 'div', 'visor-corpo');
  return { P: { id: 'p1', el }, v };
}

function montarTela(resposta = { tipo: 'texto', nome: 'a.txt', bytes: 8, dados: 'um texto' }) {
  const { P, v } = painelComVisor();
  const corpoDoc = new No('body');
  const api = {
    verArquivo: async () => resposta,
    openPath: async () => ({ ok: true }),
    mostrarNaPasta: async () => ({ ok: true }),
  };
  const ctx = {
    ...globaisFalsos(), console,
    document: { body: corpoDoc, activeElement: null, createElement: (t) => new No(t) },
    $: (sel, raiz) => (raiz || corpoDoc).querySelector(sel),
    $$: (sel) => (sel === '.p-visor' ? [v] : []),
    ico: (n) => '<i>' + n + '</i>',
    note() {}, abrirQuadro() {}, ESTE_PC: 'PC',
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    tamanhoBonito: (b) => b + ' B',
    faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
    AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    window: { api },
  };
  vm.createContext(ctx);
  vm.runInContext(trechoVisor, ctx);
  return { ctx, P, v, api, corpo: v.querySelector('.visor-corpo') };
}
const avisos = (corpo) => corpo.filhos.filter((f) => f.getAttribute('role') === 'alert');

test('visor: "Abrir no PC" troca o ícone upload por external-link e nasce "Mostrar na pasta" logo ao lado', async () => {
  const { ctx, P, v } = montarTela();
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  const abrir = v.querySelector('.visor-abrir');
  const pasta = v.querySelector('.visor-pasta');
  assert.ok(pasta, 'falta o botão "Mostrar na pasta" no visor');
  assert.equal(abrir.innerHTML, '<i>external-link</i>');
  assert.equal(abrir.getAttribute('aria-label'), 'Abrir no PC');
  assert.equal(pasta.innerHTML, '<i>folder-open</i>');
  assert.equal(pasta.title, 'Mostrar na pasta');
  assert.equal(pasta.getAttribute('aria-label'), 'Mostrar na pasta');
  assert.equal(pasta.pai.filhos[pasta.pai.filhos.indexOf(abrir) + 1], pasta, 'fica logo depois do "Abrir no PC"');
  assert.ok(pasta.classes.has('visor-abrir'), 'o CSS do visor é por classe: sem a classe do vizinho o botão aparece sem estilo');
  // abrir outro arquivo não cria um segundo botão
  await ctx.verArquivo(P, 'C:\\x\\b.txt', null);
  assert.equal(v.querySelectorAll('.visor-pasta').length, 1);
});

test('visor: cada botão chama o seu canal com o caminho do arquivo', async () => {
  const { ctx, P, v, api } = montarTela();
  const pedidos = [];
  api.openPath = async (p) => { pedidos.push(['openPath', p]); return { ok: true }; };
  api.mostrarNaPasta = async (p) => { pedidos.push(['mostrarNaPasta', p]); return { ok: true }; };
  await ctx.verArquivo(P, 'C:\\x\\a.py', null);
  await v.querySelector('.visor-abrir').onclick();
  await v.querySelector('.visor-pasta').onclick();
  assert.deepEqual(pedidos, [['openPath', 'C:\\x\\a.py'], ['mostrarNaPasta', 'C:\\x\\a.py']]);
});

test('visor: no servidor os dois botões somem (o arquivo não está neste PC) e voltam no arquivo local', async () => {
  const { ctx, P, v } = montarTela();
  await ctx.verArquivo(P, '/home/hugo/a.txt', { usuario: 'hugo', host: 'vps', chave: 'k' });
  assert.equal(v.querySelector('.visor-abrir').classes.has('hidden'), true);
  assert.equal(v.querySelector('.visor-pasta').classes.has('hidden'), true);
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  assert.equal(v.querySelector('.visor-abrir').classes.has('hidden'), false);
  assert.equal(v.querySelector('.visor-pasta').classes.has('hidden'), false);
});

test('visor: o { error } do main aparece no corpo; outro clique troca o texto em vez de empilhar; sucesso limpa', async () => {
  const { ctx, P, v, api, corpo } = montarTela();
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  const abrir = v.querySelector('.visor-abrir');
  api.openPath = async () => ({ error: 'Failed to open path' });
  await abrir.onclick();
  assert.match(corpo.textContent, /Failed to open path/);
  assert.equal(avisos(corpo).length, 1);
  api.openPath = async () => ({ error: 'Outro motivo' });
  await abrir.onclick();
  assert.doesNotMatch(corpo.textContent, /Failed to open path/);
  assert.match(corpo.textContent, /Outro motivo/);
  assert.equal(avisos(corpo).length, 1, 'um aviso só, não um por clique');
  api.openPath = async () => ({ ok: true, revelado: true });
  await abrir.onclick();
  assert.equal(avisos(corpo).length, 0, 'revelado na pasta não é erro: nada na tela e o aviso velho sai');
  assert.doesNotMatch(corpo.textContent, /Outro motivo/);
});

test('visor: texto cru (formato antigo do openPath) e promessa recusada também aparecem; o "Mostrar na pasta" usa o mesmo aviso', async () => {
  const { ctx, P, v, api, corpo } = montarTela();
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  api.openPath = async () => 'Failed to open path';
  await v.querySelector('.visor-abrir').onclick();
  assert.match(corpo.textContent, /Failed to open path/);
  api.openPath = async () => { throw new Error('Esta janela não pode acessar este recurso do Cockpit.'); };
  await v.querySelector('.visor-abrir').onclick();
  assert.match(corpo.textContent, /não pode acessar este recurso/);
  assert.equal(avisos(corpo).length, 1);
  api.mostrarNaPasta = async () => ({ error: MENSAGEM });
  await v.querySelector('.visor-pasta').onclick();
  assert.match(corpo.textContent, /Caminho de rede bloqueado/);
  assert.equal(avisos(corpo).length, 1);
});

test('visor: o aviso mostra o motivo como texto (não vira marcação) e resposta tardia não pinta em outro arquivo', async () => {
  const { ctx, P, v, api, corpo } = montarTela();
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  api.openPath = async () => ({ error: '<img src=x onerror=alert(1)>' });
  await v.querySelector('.visor-abrir').onclick();
  assert.equal(avisos(corpo)[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(avisos(corpo)[0].html, '', 'foi por textContent, não por innerHTML');

  // o erro do arquivo A chega depois de abrir o arquivo B
  let soltar;
  api.openPath = () => new Promise((resolve) => { soltar = resolve; });
  await ctx.verArquivo(P, 'C:\\x\\a.txt', null);
  const clique = v.querySelector('.visor-abrir').onclick();
  await ctx.verArquivo(P, 'C:\\x\\b.txt', null);
  soltar({ error: 'erro do arquivo A' });
  await clique;
  assert.doesNotMatch(corpo.textContent, /erro do arquivo A/);
  // ... ou depois de fechar o visor
  const clique2 = v.querySelector('.visor-abrir').onclick();
  ctx.fecharVisor();
  soltar({ error: 'erro com o visor fechado' });
  await clique2;
  assert.doesNotMatch(corpo.textContent, /visor fechado/);
});
