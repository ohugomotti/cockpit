'use strict';
/* Colar no Electron 44 (UI 7.1, Task 4 da leva 1).

   O defeito: no 44 o clipboard do processo principal virou assincrono (readText, read, writeText e has
   devolvem Promise) e perdeu readImage, readBuffer e availableFormats. O colar de print morria calado
   ({ arquivos: [] }) e o clipboard:texto mandava uma Promise pelo IPC ("could not be cloned"), o que
   quebrava o colar no terminal embutido. Os testes antigos simulavam readText sincrono e seguiam verdes
   com o app quebrado.

   Aqui roda o codigo REAL, recortado do main.js e do app.js, contra uma area de transferencia no formato
   do 44: sem readImage, sem readBuffer, tudo assincrono. Nada toca na area de transferencia de verdade.

   Tres camadas:
   1. tela: o evento de colar entrega o File da imagem; os bytes sobem pela ponte (colarSalvarImagem) e o
      preventDefault sai ANTES do primeiro await (depois dele o evento ja acabou);
   2. main: clipboard:anexos / clipboard:texto / clipboard:copiar no formato do 44, so' de reserva;
   3. nunca calado: cada catch desse caminho registra com logMain('colar', e) e a caixa avisa. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const PRELOAD = lerFonte('preload.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'); // cabecalho PNG basta
const NATIVO_PNG = 'electron application/osclipboard;format="PNG"';   // o formato bruto "PNG" do Windows
const simples = (v) => JSON.parse(JSON.stringify(v));   // o objeto nasce dentro do vm (outro Object.prototype)
const tique = () => new Promise((r) => setImmediate(r));
// pastas temporarias dos testes: saem todas no fim
const temporarias = [];
const pastaTemporaria = (prefixo) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); temporarias.push(d); return d; };
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ */
/* area de transferencia NO FORMATO DO 44                              */
/* ------------------------------------------------------------------ */
// ClipboardItem do 44: types + getType(tipo) -> Promise<Blob> (tipo que nao existe = erro, como no W3C)
function item(tipos, conteudos) {
  return {
    types: tipos,
    getType: async (tipo) => {
      if (!tipos.includes(tipo)) throw new Error('NotFoundError: ' + tipo);
      return new Blob([conteudos[tipo]], { type: tipo });
    },
  };
}
const itemDePrint = (tipos = ['image/png', NATIVO_PNG]) => item(tipos, { 'image/png': PNG, [NATIVO_PNG]: PNG });
const itemDeArquivos = (linhas) => item(['text/uri-list', 'text/plain'], { 'text/uri-list': linhas.join('\r\n'), 'text/plain': 'x' });
// so' clear/has/read/readText/write/writeText: sem readImage, sem readBuffer, sem availableFormats
function clipboard44({ itens = [], texto = '', escrever, ler } = {}) {
  return {
    read: ler || (async () => itens),
    readText: async () => texto,
    writeText: async (t) => { if (escrever) await escrever(t); },
    has: async (tipo) => itens.some((i) => i.types.includes(tipo)),
    clear: async () => {},
    write: async () => {},
  };
}

/* ------------------------------------------------------------------ */
/* main: os handlers reais, recortados do main.js                      */
/* ------------------------------------------------------------------ */
// "const nome = ...;" numa linha so'
function linhaConst(nome) {
  const ini = MAIN.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'nao achei: const ' + nome);
  return MAIN.slice(ini, MAIN.indexOf('\n', ini));
}
const corte = (ini, fim) => {
  const i = MAIN.indexOf(ini);
  const j = MAIN.indexOf(fim, i);
  assert.ok(i > 0 && j > i, 'trecho nao achado: ' + ini);
  return MAIN.slice(i, j);
};
const TRECHO_ARQUIVOS = () => corte(MAIN.includes('async function arquivosColados() {') ? 'async function arquivosColados() {' : 'function arquivosColados() {', 'const EXT_VIS_IMG');
const TRECHO_CANAIS = () => corte("ipcMain.handle('clipboard:anexos'", "ipcMain.handle('anexo:ler'");

function montar({ clip, userData, fsExtra = {}, extras = {} } = {}) {
  const dir = userData || pastaTemporaria('colar44-');
  const toques = [];   // tudo que passou por fs.existsSync (o caminho de rede nunca pode chegar la')
  const fsVigiado = new Proxy(fs, {
    get: (alvo, nome) => {
      if (nome in fsExtra) return fsExtra[nome];
      if (nome === 'existsSync') return (p) => { toques.push(String(p)); return alvo.existsSync(p); };
      return alvo[nome];
    },
  });
  const handlers = {};
  const logs = [];
  const ctx = {
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    clipboard: clip, fs: fsVigiado, path, Buffer, console, process: { platform: 'win32' },
    app: { getPath: () => dir },
    logMain: (contexto, erro) => logs.push([contexto, erro]),
    require: (nome) => { assert.equal(nome, 'url', 'o recorte so' + "'" + ' pode pedir o modulo url'); return require('node:url'); },
    ...extras,
  };
  vm.createContext(ctx);
  vm.runInContext(linhaConst('ehCaminhoDeRede'), ctx);   // o helper de verdade (Task 1)
  vm.runInContext(TRECHO_ARQUIVOS() + '\n' + TRECHO_CANAIS(), ctx);
  return { handlers, logs, toques, userData: dir };
}

test('clipboard:anexos: Ctrl+V de print (Win+Shift+S) vira anexo', async () => {
  const { handlers, userData } = montar({ clip: clipboard44({ itens: [itemDePrint()] }) });
  const r = simples(await handlers['clipboard:anexos']());
  assert.equal(r.arquivos.length, 1, 'nenhum arquivo: o print morreu calado -> ' + JSON.stringify(r));
  assert.ok(fs.readFileSync(r.arquivos[0]).equals(PNG));
  assert.equal(path.dirname(r.arquivos[0]), path.join(userData, 'colados'));
  assert.match(path.basename(r.arquivos[0]), /^colado-\d+\.png$/);
});

test('clipboard:anexos: print que so\' vem no formato bruto "PNG" do Windows tambem vira anexo', async () => {
  const { handlers } = montar({ clip: clipboard44({ itens: [itemDePrint([NATIVO_PNG])] }) });
  const r = simples(await handlers['clipboard:anexos']());
  assert.equal(r.arquivos.length, 1, JSON.stringify(r));
  assert.ok(fs.readFileSync(r.arquivos[0]).equals(PNG));
});

test('clipboard:anexos: arquivo copiado no Explorer (text/uri-list) anexa TODOS; rede e o que nao existe ficam de fora', async () => {
  const dir = pastaTemporaria('colar44-arq-');
  const a = path.join(dir, 'relatório de março.png');
  const b = path.join(dir, 'b.pdf');
  fs.writeFileSync(a, 'x');
  fs.writeFileSync(b, 'y');
  const lista = ['# lista do Explorer', pathToFileURL(a).href, pathToFileURL(b).href, 'file://servidor/pasta/rede.png',
    pathToFileURL(path.join(dir, 'sumiu.png')).href, 'https://exemplo.com/a.png', ''];
  const { handlers, toques } = montar({ clip: clipboard44({ itens: [itemDeArquivos(lista)] }) });
  const r = simples(await handlers['clipboard:anexos']());
  assert.deepEqual(r.arquivos, [a, b]);
  // caminho de rede nem chega no disco: o existsSync num \\servidor trava o app e o Windows tenta SMB
  assert.deepEqual(toques.filter((p) => /servidor/i.test(p)), [], 'tocou no disco com caminho de rede');
});

test('clipboard:anexos: area de transferencia sem imagem nem arquivo (so\' texto) devolve lista vazia, sem erro no log', async () => {
  const { handlers, logs } = montar({ clip: clipboard44({ itens: [item(['text/plain'], { 'text/plain': 'oi' })] }) });
  assert.deepEqual(simples(await handlers['clipboard:anexos']()), { arquivos: [] });
  assert.deepEqual(logs, []);
});

test('clipboard:anexos: nunca calado -- clipboard.read que falha vai pro log como "colar" e a lista volta vazia', async () => {
  const erro = new Error('area de transferencia ocupada');
  const { handlers, logs } = montar({ clip: clipboard44({ ler: async () => { throw erro; } }) });
  assert.deepEqual(simples(await handlers['clipboard:anexos']()), { arquivos: [] });
  assert.ok(logs.length >= 1, 'o erro sumiu sem registro');
  for (const [contexto] of logs) assert.equal(contexto, 'colar');
  assert.ok(logs.some(([, e]) => e === erro));
});

test('clipboard:anexos: getType quebrado (dado corrompido) tambem vai pro log em vez de sumir', async () => {
  const quebrado = { types: ['image/png'], getType: async () => { throw new Error('dado corrompido'); } };
  const { handlers, logs } = montar({ clip: clipboard44({ itens: [quebrado] }) });
  assert.deepEqual(simples(await handlers['clipboard:anexos']()), { arquivos: [] });
  assert.ok(logs.some(([contexto, e]) => contexto === 'colar' && /dado corrompido/.test(String(e && e.message))));
});

test('clipboard:texto devolve algo que o IPC consegue clonar (o colar no terminal embutido)', async () => {
  const { handlers } = montar({ clip: clipboard44({ texto: 'codigo-do-login' }) });
  const r = await handlers['clipboard:texto']();
  assert.deepEqual(structuredClone(r), { texto: 'codigo-do-login' });
});

test('clipboard:texto: acima de 1 MB recusa; readText que falha vai pro log e devolve texto vazio', async () => {
  const grande = montar({ clip: clipboard44({ texto: 'x'.repeat(1024 * 1024 + 1) }) });
  assert.deepEqual(structuredClone(await grande.handlers['clipboard:texto']()), { texto: '', erro: 'grande' });

  const erro = new Error('sem acesso');
  const falha = montar({ clip: { ...clipboard44(), readText: async () => { throw erro; } } });
  assert.deepEqual(structuredClone(await falha.handlers['clipboard:texto']()), { texto: '' });
  assert.deepEqual(falha.logs.map(([c, e]) => [c, e === erro]), [['clipboard:texto', true]]);
});

test('clipboard:texto: se um dia o readText devolver outra coisa que texto, nao vaza pelo IPC e fica anotado', async () => {
  const { handlers, logs } = montar({ clip: { ...clipboard44(), readText: async () => ({ inesperado: true }) } });
  assert.deepEqual(structuredClone(await handlers['clipboard:texto']()), { texto: '' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'clipboard:texto');
});

test('clipboard:copiar espera o writeText assincrono antes de dizer "copiado"', async () => {
  const gravado = [];
  let terminou = false;
  const escrever = async (t) => { await tique(); gravado.push(t); terminou = true; };
  const { handlers } = montar({ clip: clipboard44({ escrever }) });
  assert.equal(await handlers['clipboard:copiar']({}, 'olá'), true);
  assert.equal(terminou, true, 'respondeu "copiado" antes de o writeText terminar');
  assert.deepEqual(gravado, ['olá']);
  // teto de 1 milhao de letras, como antes; vazio e nao-texto nem chamam o writeText
  await handlers['clipboard:copiar']({}, 'x'.repeat(1000001));
  assert.equal(gravado[1].length, 1000000);
  assert.equal(await handlers['clipboard:copiar']({}, ''), false);
  assert.equal(await handlers['clipboard:copiar']({}, { texto: 'a' }), false);
  assert.equal(gravado.length, 2);
});

test('clipboard:copiar: se o writeText falhar, devolve false e deixa no log (nao diz "copiado" em falso)', async () => {
  const erro = new Error('clipboard recusou');
  const { handlers, logs } = montar({ clip: clipboard44({ escrever: async () => { throw erro; } }) });
  assert.equal(await handlers['clipboard:copiar']({}, 'abc'), false);
  assert.deepEqual(logs.map(([c, e]) => [c, e === erro]), [['clipboard:copiar', true]]);
});

/* colar:salvar-imagem: a tela leu os bytes do File do evento de colar; o main so' grava em colados/ */
test('colar:salvar-imagem grava userData/colados/colado-<ts>.png (ArrayBuffer ou Uint8Array) e devolve o caminho', async () => {
  const { handlers, userData } = montar({ extras: { Date: { now: () => 1700000000000 } } });
  assert.equal(typeof handlers['colar:salvar-imagem'], 'function', 'falta o canal colar:salvar-imagem');
  const ab = PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length);

  const r1 = simples(await handlers['colar:salvar-imagem']({}, ab, 'image/png'));
  assert.equal(r1.error, undefined, JSON.stringify(r1));
  assert.equal(r1.arquivo, path.join(userData, 'colados', 'colado-1700000000000.png'));
  assert.ok(fs.readFileSync(r1.arquivo).equals(PNG));

  // dois prints no mesmo milissegundo: o segundo nao pode sobrescrever o primeiro
  const r2 = simples(await handlers['colar:salvar-imagem']({}, new Uint8Array(ab), 'image/png'));
  assert.notEqual(r2.arquivo, r1.arquivo);
  assert.ok(fs.readFileSync(r2.arquivo).equals(PNG));

  // uma fatia de um Buffer maior (byteOffset diferente de zero) grava so' a fatia
  const grande = Buffer.concat([Buffer.from('lixo'), PNG, Buffer.from('lixo')]);
  const r3 = simples(await handlers['colar:salvar-imagem']({}, grande.subarray(4, 4 + PNG.length), 'image/png'));
  assert.ok(fs.readFileSync(r3.arquivo).equals(PNG));
});

test('colar:salvar-imagem: extensao pelo tipo; so\' png, jpeg, webp e gif', async () => {
  const { handlers, userData } = montar();
  const bytes = new Uint8Array([1, 2, 3]);
  for (const [tipo, ext] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['IMAGE/PNG', 'png']]) {
    const r = simples(await handlers['colar:salvar-imagem']({}, bytes, tipo));
    assert.equal(r.error, undefined, tipo + ' -> ' + JSON.stringify(r));
    assert.equal(path.extname(r.arquivo), '.' + ext, tipo);
    assert.equal(path.dirname(r.arquivo), path.join(userData, 'colados'));
  }
  const antes = fs.readdirSync(path.join(userData, 'colados')).length;
  for (const tipo of ['image/svg+xml', 'image/bmp', 'text/html', 'application/pdf', '', undefined, null, 'constructor', '__proto__']) {
    const r = simples(await handlers['colar:salvar-imagem']({}, bytes, tipo));
    assert.equal(typeof r.error, 'string', 'tipo recusado: ' + String(tipo));
    assert.equal(r.arquivo, undefined);
  }
  assert.equal(fs.readdirSync(path.join(userData, 'colados')).length, antes, 'tipo recusado nao pode gravar arquivo');
});

test('colar:salvar-imagem: vazio e fora do formato recusa; o teto e\' 25 MB (25 MB passa, 25 MB + 1 byte nao)', async () => {
  const gravados = [];
  const { handlers } = montar({ fsExtra: { writeFileSync: (destino, dados) => { gravados.push(dados.length); } } });
  for (const ruim of [new Uint8Array(0), new ArrayBuffer(0), 'texto', null, undefined, { length: 3 }, 42]) {
    const r = simples(await handlers['colar:salvar-imagem']({}, ruim, 'image/png'));
    assert.equal(typeof r.error, 'string', 'bytes ruins: ' + String(ruim));
    assert.equal(r.arquivo, undefined);
  }
  const limite = 25 * 1024 * 1024;
  const passa = simples(await handlers['colar:salvar-imagem']({}, new Uint8Array(limite), 'image/png'));
  assert.equal(passa.error, undefined, JSON.stringify(passa));
  const estoura = simples(await handlers['colar:salvar-imagem']({}, new Uint8Array(limite + 1), 'image/png'));
  assert.match(estoura.error, /25 MB/);
  assert.deepEqual(gravados, [limite], 'so\' o que coube no teto pode ir pro disco');
});

test('colar:salvar-imagem: erro de disco vai pro log como "colar" e volta como { error }, nunca lanca', async () => {
  const erro = new Error('disco cheio');
  const { handlers, logs } = montar({ fsExtra: { writeFileSync: () => { throw erro; } } });
  const r = simples(await handlers['colar:salvar-imagem']({}, new Uint8Array([1]), 'image/png'));
  assert.match(r.error, /disco cheio/);
  assert.deepEqual(logs.map(([c, e]) => [c, e === erro]), [['colar', true]]);
});

/* ------------------------------------------------------------------ */
/* o fonte: nada de API que sumiu no 44; nada calado                   */
/* ------------------------------------------------------------------ */
test('main.js: so\' usa o clipboard que existe no 44, sempre esperando a Promise', () => {
  const codigo = MAIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const usos = [...codigo.matchAll(/(await\s+|=>\s*)?\bclipboard\.(\w+)\(/g)];
  assert.ok(usos.length >= 4, 'sumiram os usos do clipboard? (' + usos.length + ')');
  for (const [, espera, nome] of usos) {
    assert.ok(['read', 'readText', 'writeText', 'has'].includes(nome), 'clipboard.' + nome + '() nao existe no Electron 44');
    assert.ok(espera, 'clipboard.' + nome + '() sem await: no 44 devolve Promise');
  }
});

test('main.js: nenhum catch do caminho do colar fica calado (todos registram com logMain)', () => {
  const trecho = TRECHO_ARQUIVOS() + TRECHO_CANAIS();
  const catches = trecho.match(/catch\b[^{]*\{[^}]*\}/g) || [];
  assert.ok(catches.length >= 5, 'achou so\' ' + catches.length + ' catch no caminho do colar');
  for (const c of catches) assert.match(c, /logMain\(/, 'catch sem registro: ' + c);
});

test('preload: colarSalvarImagem fica ao lado do colados e leva (bytes, tipo) pro canal certo', () => {
  // assert.ok (e nao match): quando falha, o match despejaria o preload inteiro na tela
  assert.ok(/colados: \(\) => ipcRenderer\.invoke\('clipboard:anexos'\),\n\s+colarSalvarImagem: \(bytes, tipo\) => ipcRenderer\.invoke\('colar:salvar-imagem', bytes, tipo\),/.test(PRELOAD),
    'falta, logo depois do colados, a linha: colarSalvarImagem: (bytes, tipo) => ipcRenderer.invoke(\'colar:salvar-imagem\', bytes, tipo),');
});

/* ------------------------------------------------------------------ */
/* tela: o evento de colar da caixa de escrever (camada 1)             */
/* ------------------------------------------------------------------ */
function montarColar({ api = {} } = {}) {
  const log = [];
  const P = { id: 'p1', anexos: [] };
  const apiFalsa = {
    // o webUtils: arquivo do Explorer tem caminho no disco; print nao tem
    caminhoDoArquivo: (f) => f._caminho || '',
    colarSalvarImagem: async (bytes, tipo) => { log.push(['salvar', tipo, bytes.byteLength]); return { arquivo: 'C:\\dados\\colados\\colado-1.png' }; },
    colados: async () => { log.push(['colados']); return { arquivos: [] }; },
    ...api,
  };
  const ctx = {
    ...globaisFalsos(),
    console: { log() {}, error: (...a) => log.push(['erro', ...a.map(String)]) },
    window: { api: apiFalsa },
    setFocus: () => log.push(['foco']),
    anexar: async (_P, caminhos) => { log.push(['anexar', [...caminhos]]); },
    note: (_P, texto, erro) => log.push(['nota', texto, erro === true]),
  };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(APP, 'function pasteDoTerminal(', 'pasteDoTerminal'), ctx);
  vm.runInContext(pegarBloco(APP, 'function caminhosDosArquivos(', 'caminhosDosArquivos'), ctx);
  const ini = APP.indexOf('const colar = async (e) => {');
  const fim = APP.indexOf("el.addEventListener('paste', colar)", ini);
  assert.ok(ini > 0 && fim > ini, 'nao achei o colar do painel no app.js');
  const colar = vm.runInContext('(function (P) {\n' + APP.slice(ini, fim) + '\nreturn colar;\n})', ctx)(P);
  return { colar, log, P };
}
// File do evento de colar: print = image/png sem caminho; arquivo do Explorer = com caminho no disco
function arquivoColado({ tipo = 'image/png', caminho = '', bytes = PNG, falha } = {}) {
  return {
    type: tipo, name: caminho ? path.basename(caminho) : 'image.png', size: bytes.length, _caminho: caminho,
    // o arrayBuffer de verdade e' assincrono: este so' resolve depois de uma volta do laco
    arrayBuffer: () => (falha
      ? Promise.reject(new Error(falha))
      : new Promise((ok) => setImmediate(() => ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))))),
  };
}
function eventoDeColar({ arquivos = [], texto = false, noTerminal = false } = {}) {
  return {
    prevenido: 0, preventDefault() { this.prevenido++; },
    target: { closest: (sel) => (noTerminal && sel === '.cx-term' ? {} : null) },
    clipboardData: {
      files: arquivos,
      items: [...(texto ? [{ kind: 'string', type: 'text/plain' }] : []), ...arquivos.map((f) => ({ kind: 'file', type: f.type }))],
    },
  };
}
const so = (log, tipo) => log.filter((x) => x[0] === tipo);

test('colar (tela): print sem caminho -> bytes pela ponte, preventDefault ANTES de qualquer await e o anexo entra', async () => {
  const { colar, log } = montarColar();
  const ev = eventoDeColar({ arquivos: [arquivoColado()] });
  const pronto = colar(ev);
  // o async roda sincrono ate' o primeiro await: se o preventDefault ja' aconteceu aqui, ele valeu DENTRO do evento
  assert.equal(ev.prevenido, 1, 'o preventDefault tem de vir antes de qualquer await (depois dele o evento ja acabou)');
  assert.deepEqual(so(log, 'salvar'), [], 'ainda nao podia ter ido ao main: os bytes do File sao assincronos');
  await pronto;
  assert.deepEqual(so(log, 'salvar'), [['salvar', 'image/png', PNG.length]]);
  assert.deepEqual(so(log, 'anexar'), [['anexar', ['C:\\dados\\colados\\colado-1.png']]]);
  assert.deepEqual(so(log, 'colados'), [], 'com a imagem salva a reserva do main nao entra');
  assert.deepEqual(so(log, 'nota'), []);
  assert.equal(ev.prevenido, 1);
});

test('colar (tela): arquivo copiado no Explorer (com caminho) anexa pelo caminho, sem ir ao main', async () => {
  const { colar, log } = montarColar();
  const ev = eventoDeColar({ arquivos: [
    arquivoColado({ tipo: 'application/pdf', caminho: 'C:\\Users\\hugom\\a.pdf' }),
    arquivoColado({ tipo: 'image/png', caminho: 'C:\\Users\\hugom\\foto.png' }),
  ] });
  const pronto = colar(ev);
  assert.equal(ev.prevenido, 1, 'arquivo do Explorer tambem cancela o colar nativo, dentro do evento');
  await pronto;
  assert.deepEqual(so(log, 'anexar'), [['anexar', ['C:\\Users\\hugom\\a.pdf', 'C:\\Users\\hugom\\foto.png']]]);
  assert.deepEqual([...so(log, 'salvar'), ...so(log, 'colados')], [], 'o caminho do disco basta: nem bytes nem reserva');
});

test('colar (tela): varias imagens coladas de uma vez entram juntas', async () => {
  const { colar, log } = montarColar();
  await colar(eventoDeColar({ arquivos: [arquivoColado(), arquivoColado({ tipo: 'image/jpeg' })] }));
  assert.deepEqual(so(log, 'salvar').map((x) => x[1]), ['image/png', 'image/jpeg']);
  assert.equal(so(log, 'anexar').length, 1);
  assert.equal(so(log, 'anexar')[0][1].length, 2);
});

test('colar (tela): so\' texto -> o campo cola sozinho (sem preventDefault e sem ir ao main)', async () => {
  const { colar, log } = montarColar();
  const ev = eventoDeColar({ texto: true });
  await colar(ev);
  assert.equal(ev.prevenido, 0);
  assert.deepEqual(log, []);
});

test('colar (tela): texto junto da imagem (planilha, Word) -> o texto continua colando e a imagem entra como anexo', async () => {
  const { colar, log } = montarColar();
  const ev = eventoDeColar({ texto: true, arquivos: [arquivoColado()] });
  const pronto = colar(ev);
  assert.equal(ev.prevenido, 0, 'nao pode engolir o texto que veio junto');
  await pronto;
  assert.equal(ev.prevenido, 0);
  assert.deepEqual(so(log, 'anexar'), [['anexar', ['C:\\dados\\colados\\colado-1.png']]]);
});

test('colar (tela): evento sem arquivo nem texto -> pergunta ao main (reserva) e anexa o que ele achar', async () => {
  const { colar, log } = montarColar({ api: { colados: async () => ({ arquivos: ['C:\\dados\\colados\\colado-9.png'] }) } });
  await colar(eventoDeColar());
  assert.deepEqual(so(log, 'anexar'), [['anexar', ['C:\\dados\\colados\\colado-9.png']]]);
});

test('colar (tela): se salvar a imagem falhar, a reserva do main entra', async () => {
  const { colar, log } = montarColar({ api: {
    colarSalvarImagem: async () => ({ error: 'Formato de imagem não aceito.' }),
    colados: async () => ({ arquivos: ['C:\\dados\\colados\\colado-7.png'] }),
  } });
  await colar(eventoDeColar({ arquivos: [arquivoColado()] }));
  assert.deepEqual(so(log, 'anexar'), [['anexar', ['C:\\dados\\colados\\colado-7.png']]]);
  assert.deepEqual(so(log, 'nota'), [], 'a reserva deu certo: nao tem o que avisar');
  assert.equal(so(log, 'erro').length, 1, 'a falha da ponte tem de ficar no log da tela');
});

test('colar (tela): tinha imagem e nada foi anexado -> AVISA na caixa e registra (nunca calado)', async () => {
  for (const falha of [
    { api: { colarSalvarImagem: async () => { throw new Error('ponte caiu'); } }, arquivo: arquivoColado() },
    { api: { colarSalvarImagem: async () => ({ error: 'imagem muito pesada' }) }, arquivo: arquivoColado() },
    { api: {}, arquivo: arquivoColado({ falha: 'blob ilegivel' }) },
  ]) {
    const { colar, log } = montarColar({ api: falha.api });
    await colar(eventoDeColar({ arquivos: [falha.arquivo] }));
    assert.deepEqual(so(log, 'anexar'), []);
    const notas = so(log, 'nota');
    assert.equal(notas.length, 1, 'faltou o aviso na caixa');
    assert.match(notas[0][1], /imagem/i);
    assert.equal(notas[0][2], true, 'o aviso e\' de erro');
    assert.ok(so(log, 'erro').some((x) => x[1] === '[colar]'), 'faltou o console.error("[colar]", ...) que vai pro tela.log');
    assert.equal(so(log, 'colados').length, 1, 'a reserva do main foi tentada antes de desistir');
  }
});

test('colar (tela): paste dentro do terminal embutido nao vira anexo e nao mexe em nada', async () => {
  const { colar, log } = montarColar();
  const ev = eventoDeColar({ arquivos: [arquivoColado()], noTerminal: true });
  await colar(ev);
  assert.equal(ev.prevenido, 0);
  assert.deepEqual(log, []);
});

test('colar (tela): a reserva do main que falha tambem fica no log', async () => {
  const { colar, log } = montarColar({ api: { colados: async () => { throw new Error('ponte caiu'); } } });
  await colar(eventoDeColar());
  assert.deepEqual(so(log, 'anexar'), []);
  assert.ok(so(log, 'erro').some((x) => x[1] === '[colar]'));
});
