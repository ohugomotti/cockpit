'use strict';
/* Leva 2, Task 5 (UI 7.2-6): navegacao no leitor.

   1) Voltar: abrir OUTRO documento a partir do leitor empilha o de agora (por painel); o botao Voltar (arrow-left) e o
      Alt+← voltam ao anterior, na mesma rolagem. A pilha some ao fechar o visor. O Alt+← so' vale com o visor aberto e
      nunca rouba tecla de campo de texto, do Esc, da aba Previa/Codigo ou de Ctrl/Shift.
   2) Recarga: o leitor pede ao main uma vigia do arquivo LOCAL que nao e' de rede (src/vigia-arquivo.js, fs.watch com
      debounce de 300 ms). Quando o arquivo muda, o leitor se recarrega mantendo a rolagem; se ele some, um aviso discreto.
   3) Zero vazamento: a vigia para ao fechar o visor, ao trocar de documento e quando o painel morre (no main, tambem
      quando a tela recarrega, cai ou fecha). Arquivo de rede nunca e' vigiado.
   4) Integracao do leitor (Fix A): PDF aberto a partir do leitor volta ao documento de antes (nao apaga o Voltar); PDF
      nao se vigia e a recarga automatica nunca o reabre; HTML nao recarrega sozinho (so' "O arquivo mudou · Reler");
      na recarga automatica o foco nunca cai no X.

   Como o resto da suite: o main nao carrega em teste (Electron), entao o trecho REAL do main.js roda num vm; o visor e'
   o trecho REAL do app.js (entre os dois marcadores) com um DOM de mentira; a vigia e' o modulo de verdade, com fs e
   relogio falsos (e uma rodada com o fs.watch real, numa pasta temporaria). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');

const source = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const carregar = () => require('../src/vigia-arquivo.js');   // preguicoso: sem o modulo, cada teste falha por si

const REDE = [
  '\\\\servidor\\pasta\\a.md', '//servidor/pasta/a.md', '/\\servidor/pasta/a.md', '\\/servidor/pasta/a.md',
  '  \\\\servidor\\pasta\\a.md', '\\\\?\\UNC\\servidor\\pasta\\a.md',
];
const PASTA = path.join(os.tmpdir(), 'cockpit-vigia-teste');
const ARQ = path.join(PASTA, 'Relatório.md');
const OUTRO = path.join(PASTA, 'Plano.md');
const tick = () => new Promise((r) => setImmediate(r));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const simples = (v) => JSON.parse(JSON.stringify(v));   // o que nasce no vm tem outro Object.prototype

// "const nome = ...;" em uma linha so' (o helper de rede do main e' o de verdade, nao uma copia)
function linhaConst(nome) {
  const ini = source.indexOf('const ' + nome + ' = ');
  return ini < 0 ? '' : source.slice(ini, source.indexOf('\n', ini));
}
const ehCaminhoDeRede = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(linhaConst('ehCaminhoDeRede'), ctx);
  return vm.runInContext('ehCaminhoDeRede', ctx);
})();

/* =====================================================================
   A vigia (src/vigia-arquivo.js)
   ===================================================================== */
// um disco de mentira: so' o que a vigia usa (watch e fs.promises.stat). Cada toque fica anotado.
function fsFalso(arquivos = {}) {
  const watchers = [], toques = [], estado = new Map(Object.entries(arquivos));
  return {
    watchers, toques, estado,
    watch(pasta, opcoes, ouvinte) {
      toques.push('watch:' + pasta);
      const w = new EventEmitter();
      Object.assign(w, { pasta, opcoes, ouvinte, fechado: false });
      w.close = () => { w.fechado = true; };
      watchers.push(w);
      return w;
    },
    // o statSync congelava o main numa unidade de rede fora do ar: a vigia nao pode mais usar (Fix C, item 2)
    statSync() { throw new Error('statSync nao pode ser usado pela vigia'); },
    promises: {
      // le o estado na chamada, como o disco: quem muda o arquivo depois nao altera um stat que ja' foi pedido
      async stat(caminho) {
        toques.push('stat:' + caminho);
        const e = estado.get(caminho);
        if (!e) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        return { ...e };
      },
    },
  };
}
// relogio de mentira: o teste decide quando o tempo passa
function relogioFalso() {
  let agora = 0, seq = 0;
  const pendentes = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; pendentes.set(id, { fn, quando: agora + ms }); return id; },
    clearTimer: (id) => { pendentes.delete(id); },
    avancar(ms) {
      agora += ms;
      for (const [id, t] of [...pendentes]) if (t.quando <= agora && pendentes.has(id)) { pendentes.delete(id); t.fn(); }
    },
    get pendentes() { return pendentes.size; },
  };
}
function montar({ arquivos = { [ARQ]: { mtimeMs: 10, size: 5 }, [OUTRO]: { mtimeMs: 10, size: 5 } }, avisarLanca = false } = {}) {
  const { criarVigia } = carregar();
  const f = fsFalso(arquivos), rel = relogioFalso(), avisos = [], logs = [];
  const vigia = criarVigia({
    fs: f, ehCaminhoDeRede,
    avisar: (a) => { if (avisarLanca) throw new Error('o aviso quebrou'); avisos.push(a); },
    log: (contexto, erro) => logs.push([contexto, erro && erro.code]),
    setTimer: rel.setTimer, clearTimer: rel.clearTimer,
  });
  return { vigia, f, rel, avisos, logs };
}

test('vigia: abre o watch na PASTA do arquivo, sem segurar o processo, e fica na lista', () => {
  const { vigia, f } = montar();
  assert.deepEqual(vigia.vigiar('p1', ARQ), { ok: true });
  assert.equal(f.watchers.length, 1);
  assert.equal(f.watchers[0].pasta, PASTA);
  assert.equal(f.watchers[0].opcoes.persistent, false);
  assert.deepEqual(vigia.ativas(), ['p1']);
});

test('vigia: o debounce e de 300 ms e uma rajada de eventos vira UM aviso', async () => {
  const { ATRASO_MS } = carregar();
  assert.equal(ATRASO_MS, 300);
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  const w = f.watchers[0];
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  w.ouvinte('change', 'Relatório.md'); rel.avancar(100);
  w.ouvinte('change', 'Relatório.md'); rel.avancar(100);
  w.ouvinte('rename', 'Relatório.md'); rel.avancar(299);
  await tick();
  assert.deepEqual(avisos, [], 'ainda nao passaram 300 ms desde o ultimo evento');
  rel.avancar(1);
  await tick();   // o stat e' assincrono: o aviso chega quando ele responde
  assert.deepEqual(avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'mudou' }]);
  rel.avancar(10000);
  await tick();
  assert.equal(avisos.length, 1, 'um aviso so\'');
});

test('vigia: so\' conta o evento do proprio arquivo (outro nome da pasta, nada; acento NFC/NFD, caixa e nome ausente casam)', async () => {
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  const w = f.watchers[0];
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  w.ouvinte('change', 'outro-arquivo.md');
  assert.equal(rel.pendentes, 0, 'outro arquivo da pasta nao arma o temporizador');
  w.ouvinte('change', 'relato\u0301rio.MD');   // o "ó" decomposto (macOS) e a caixa trocada
  assert.equal(rel.pendentes, 1);
  rel.avancar(300);
  await tick();
  assert.equal(avisos.length, 1);
  f.estado.set(ARQ, { mtimeMs: 30, size: 11 });
  w.ouvinte('change', null);   // algumas plataformas nao dizem o nome: confere por garantia
  assert.equal(rel.pendentes, 1);
  rel.avancar(300);
  await tick();
  assert.equal(avisos.length, 2);
});

test('vigia: evento sem mudanca de data e tamanho nao avisa (ler o arquivo tambem dispara "change" no Windows)', async () => {
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  f.watchers[0].ouvinte('change', 'Relatório.md');
  rel.avancar(300);
  await tick();
  assert.deepEqual(avisos, [], 'a data e o tamanho sao os mesmos de quando a vigia comecou');
  // e depois de avisar uma vez, o mesmo estado nao avisa de novo (sem laco: a recarga nao se vigia a si mesma)
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md'); rel.avancar(300); await tick();
  f.watchers[0].ouvinte('change', 'Relatório.md'); rel.avancar(300); await tick();
  assert.equal(avisos.length, 1);
});

test('vigia: arquivo apagado avisa "apagado" uma vez; criado de novo avisa "mudou"', async () => {
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  const w = f.watchers[0];
  f.estado.delete(ARQ);
  w.ouvinte('rename', 'Relatório.md'); rel.avancar(300); await tick();
  w.ouvinte('rename', 'Relatório.md'); rel.avancar(300); await tick();
  assert.deepEqual(avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'apagado' }], 'apagado, uma vez so\'');
  f.estado.set(ARQ, { mtimeMs: 50, size: 3 });
  w.ouvinte('rename', 'Relatório.md'); rel.avancar(300); await tick();
  assert.deepEqual(avisos.map((a) => a.evento), ['apagado', 'mudou']);
});

test('vigia: arquivo que ainda nao existe e vigiado, e avisa quando nasce', async () => {
  const { vigia, f, rel, avisos } = montar({ arquivos: {} });
  assert.deepEqual(vigia.vigiar('p1', ARQ), { ok: true });
  f.estado.set(ARQ, { mtimeMs: 1, size: 1 });
  f.watchers[0].ouvinte('rename', 'Relatório.md'); rel.avancar(300); await tick();
  assert.deepEqual(avisos.map((a) => a.evento), ['mudou']);
});

test('vigia: caminho de rede nunca chega ao disco (nem watch, nem stat) em nenhuma das formas', () => {
  for (const p of REDE) {
    const { vigia, f } = montar();
    assert.deepEqual(vigia.vigiar('p1', p), { ok: false, motivo: 'rede' }, JSON.stringify(p));
    assert.deepEqual(f.toques, [], 'encostou no disco: ' + JSON.stringify(p));
    assert.deepEqual(vigia.ativas(), []);
  }
});

test('vigia: pedido torto e recusado antes do disco (relativo, caractere de controle, chave ou arquivo invalidos)', () => {
  const casos = [
    ['p1', 'Relatório.md', 'caminho'], ['p1', './Relatório.md', 'caminho'], ['p1', path.join(PASTA, 'a\tb.md'), 'caminho'],
    ['p1', '/\t/servidor/a.md', 'caminho'],   // a tela tira o controle e ve rede; aqui o controle ja barra
    ['', ARQ, 'pedido'], [undefined, ARQ, 'pedido'], [42, ARQ, 'pedido'], ['x'.repeat(201), ARQ, 'pedido'],
    ['p1', '', 'pedido'], ['p1', null, 'pedido'], ['p1', { path: ARQ }, 'pedido'],
  ];
  for (const [chave, arquivo, motivo] of casos) {
    const { vigia, f } = montar();
    assert.deepEqual(vigia.vigiar(chave, arquivo), { ok: false, motivo }, JSON.stringify([chave, arquivo]));
    assert.deepEqual(f.toques, [], 'encostou no disco: ' + JSON.stringify([chave, arquivo]));
  }
});

test('vigia: parar fecha o watcher, cancela o temporizador pendente e nada mais e avisado; parar de novo e inofensivo', async () => {
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  const w = f.watchers[0];
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  w.ouvinte('change', 'Relatório.md');
  assert.equal(rel.pendentes, 1);
  assert.equal(vigia.parar('p1'), true);
  assert.equal(w.fechado, true, 'o watcher foi fechado');
  assert.equal(rel.pendentes, 0, 'o temporizador do debounce foi cancelado');
  rel.avancar(10000);
  await tick();
  assert.deepEqual(avisos, []);
  w.ouvinte('change', 'Relatório.md');   // evento que ja estava a caminho quando parou
  assert.equal(rel.pendentes, 0, 'evento de vigia que ja saiu nao arma nada');
  assert.deepEqual(vigia.ativas(), []);
  assert.equal(vigia.parar('p1'), false);
  assert.equal(vigia.parar('nao-existe'), false);
  assert.equal(vigia.parar(undefined), false);
});

test('vigia: trocar de documento (mesma chave) fecha a vigia anterior; o aviso atrasado da velha nao vale', async () => {
  const { vigia, f, rel, avisos } = montar();
  vigia.vigiar('p1', ARQ);
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md');   // a velha tem um debounce pendente
  assert.deepEqual(vigia.vigiar('p1', OUTRO), { ok: true });
  assert.equal(f.watchers[0].fechado, true, 'a vigia do documento anterior foi fechada');
  assert.equal(f.watchers[1].fechado, false);
  assert.equal(rel.pendentes, 0, 'o temporizador da velha foi cancelado');
  assert.deepEqual(vigia.ativas(), ['p1'], 'uma vigia por painel');
  f.watchers[0].ouvinte('change', 'Relatório.md');   // evento atrasado da velha
  assert.equal(rel.pendentes, 0);
  f.estado.set(OUTRO, { mtimeMs: 99, size: 1 });
  f.watchers[1].ouvinte('change', 'Plano.md'); rel.avancar(300);
  await tick();
  assert.deepEqual(avisos, [{ chave: 'p1', arquivo: OUTRO, evento: 'mudou' }]);
});

test('vigia: trocar por um documento recusado (rede, relativo) tambem solta a vigia anterior', () => {
  for (const novo of [REDE[0], 'relativo.md', path.join(PASTA, 'a\tb.md')]) {
    const { vigia, f } = montar();
    vigia.vigiar('p1', ARQ);
    assert.equal(vigia.vigiar('p1', novo).ok, false);
    assert.equal(f.watchers[0].fechado, true, 'o leitor ja saiu do documento antigo: ' + JSON.stringify(novo));
    assert.deepEqual(vigia.ativas(), []);
  }
});

test('vigia: dois paineis nao se atrapalham, e pararTodos fecha tudo', () => {
  const { vigia, f, rel } = montar();
  vigia.vigiar('p1', ARQ); vigia.vigiar('p2', OUTRO);
  assert.deepEqual(vigia.ativas().sort(), ['p1', 'p2']);
  vigia.parar('p1');
  assert.deepEqual([f.watchers[0].fechado, f.watchers[1].fechado], [true, false]);
  f.estado.set(OUTRO, { mtimeMs: 77, size: 2 });
  f.watchers[1].ouvinte('change', 'Plano.md');
  assert.equal(rel.pendentes, 1);
  vigia.pararTodos();
  assert.equal(f.watchers[1].fechado, true);
  assert.equal(rel.pendentes, 0);
  assert.deepEqual(vigia.ativas(), []);
  vigia.pararTodos();   // de novo: nada
});

test('vigia: erro do watcher tira a vigia da lista e vai pro log (pasta que sumiu avisa "apagado")', async () => {
  const um = montar();
  um.vigia.vigiar('p1', ARQ);
  um.f.watchers[0].emit('error', Object.assign(new Error('EPERM: watch'), { code: 'EPERM' }));
  assert.equal(um.f.watchers[0].fechado, true);
  assert.deepEqual(um.vigia.ativas(), []);
  await tick();
  assert.deepEqual(um.logs, [['vigia:watch', 'EPERM']]);
  assert.deepEqual(um.avisos, [], 'o arquivo continua la: nada a avisar');

  const dois = montar();
  dois.vigia.vigiar('p1', ARQ);
  dois.f.estado.delete(ARQ);   // a pasta foi apagada junto
  dois.f.watchers[0].emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  await tick();
  assert.deepEqual(dois.avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'apagado' }]);
  assert.deepEqual(dois.logs, [], 'pasta que sumiu e esperado: nao polui o log');
  assert.deepEqual(dois.vigia.ativas(), []);
});

test('vigia: fs.watch que lanca nao deixa nada pendurado (e so\' falha inesperada vai pro log)', () => {
  const { criarVigia } = carregar();
  for (const [codigo, vaiProLog] of [['ENOENT', false], ['ENOTDIR', false], ['EMFILE', true], ['EPERM', true]]) {
    const logs = [];
    const f = fsFalso({ [ARQ]: { mtimeMs: 1, size: 1 } });
    f.watch = () => { throw Object.assign(new Error(codigo), { code: codigo }); };
    const vigia = criarVigia({ fs: f, ehCaminhoDeRede, avisar() {}, log: (c, e) => logs.push([c, e.code]) });
    assert.deepEqual(vigia.vigiar('p1', ARQ), { ok: false, motivo: 'erro' }, codigo);
    assert.deepEqual(vigia.ativas(), [], codigo);
    assert.deepEqual(logs, vaiProLog ? [['vigia:abrir', codigo]] : [], codigo);
  }
});

test('vigia: aviso que lanca nao derruba a vigia nem repete o aviso', async () => {
  const { vigia, f, rel, logs } = montar({ avisarLanca: true });
  vigia.vigiar('p1', ARQ);
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md');
  assert.doesNotThrow(() => rel.avancar(300));
  await tick();
  assert.deepEqual(logs, [['vigia:avisar', undefined]]);
  assert.deepEqual(vigia.ativas(), ['p1']);
});

test('vigia: zero vazamento — 500 aberturas, trocas, rajadas e fechamentos nao deixam watcher nem temporizador pendurados', async () => {
  const { vigia, f, rel } = montar();
  let semente = 7;
  const sorteio = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  for (let i = 0; i < 500; i++) {
    const chave = 'p' + sorteio(3), arquivo = sorteio(2) ? ARQ : OUTRO;
    const passo = sorteio(5);
    if (passo === 0) vigia.parar(chave);
    else if (passo === 1) { const w = f.watchers.filter((x) => !x.fechado).at(-1); if (w) w.ouvinte('change', path.basename(ARQ)); }
    else if (passo === 2) rel.avancar(sorteio(400));
    else vigia.vigiar(chave, arquivo);   // abrir ou trocar de documento
    const abertos = f.watchers.filter((w) => !w.fechado).length;
    assert.equal(abertos, vigia.ativas().length, 'passo ' + i + ': watcher aberto sem vigia na lista (vazou)');
    assert.ok(abertos <= 3, 'uma vigia por painel (3 paineis)');
    assert.ok(rel.pendentes <= abertos, 'passo ' + i + ': temporizador pendurado sem vigia');
    await tick();   // as conferencias (stat assincrono) terminam no meio do sorteio e nao podem reviver nada
  }
  vigia.pararTodos();
  assert.equal(f.watchers.filter((w) => !w.fechado).length, 0);
  assert.equal(rel.pendentes, 0);
  assert.deepEqual(vigia.ativas(), []);
  assert.ok(f.watchers.length > 50, 'o sorteio abriu bastante coisa (' + f.watchers.length + ')');
});

test('vigia: tem teto (uma por painel; passar do teto e bug da tela e nao vira vazamento) e parar libera vaga', () => {
  const { LIMITE_VIGIAS } = carregar();
  const { vigia, f } = montar();
  for (let i = 0; i < LIMITE_VIGIAS; i++) assert.deepEqual(vigia.vigiar('p' + i, ARQ), { ok: true }, 'vaga ' + i);
  const toques = f.toques.length;
  assert.deepEqual(vigia.vigiar('excedente', ARQ), { ok: false, motivo: 'limite' });
  assert.equal(f.toques.length, toques, 'recusou antes do disco');
  assert.deepEqual(vigia.vigiar('p3', OUTRO), { ok: true }, 'a mesma chave troca de documento, nao ocupa vaga nova');
  assert.equal(vigia.ativas().length, LIMITE_VIGIAS);
  vigia.parar('p0');
  assert.deepEqual(vigia.vigiar('excedente', ARQ), { ok: true });
  vigia.pararTodos();
  assert.equal(f.watchers.filter((w) => !w.fechado).length, 0, 'nenhum watcher ficou aberto');
});

test('vigia: sem fs.watch, sem aviso ou sem a trava de rede ela nem nasce', () => {
  const { criarVigia } = carregar();
  const bom = { fs: fsFalso(), ehCaminhoDeRede, avisar() {} };
  assert.throws(() => criarVigia(), TypeError);
  assert.throws(() => criarVigia({ ...bom, ehCaminhoDeRede: undefined }), TypeError);
  assert.throws(() => criarVigia({ ...bom, avisar: undefined }), TypeError);
  assert.throws(() => criarVigia({ ...bom, fs: {} }), TypeError);
  assert.doesNotThrow(() => criarVigia(bom));
});

test('vigia de verdade (fs.watch real): avisa mudou, apagado e mudou de novo; depois de parar, silencio', async () => {
  const { criarVigia } = carregar();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-vigia-'));
  const arquivo = path.join(pasta, 'nota.md');
  fs.writeFileSync(arquivo, 'um');
  const avisos = [];
  const vigia = criarVigia({ fs, ehCaminhoDeRede, avisar: (a) => avisos.push(a), atrasoMs: 40 });
  const esperar = async (evento, desde) => {
    for (let i = 0; i < 100; i++) { if (avisos.slice(desde).some((a) => a.evento === evento)) return; await pausa(30); }
    assert.fail('nao chegou o aviso "' + evento + '": ' + JSON.stringify(avisos));
  };
  try {
    assert.deepEqual(vigia.vigiar('p1', arquivo), { ok: true });
    fs.writeFileSync(path.join(pasta, 'outro.md'), 'x');   // outro arquivo da pasta: nao conta
    await pausa(150);
    assert.deepEqual(avisos, [], 'outro arquivo da pasta nao avisa');
    fs.writeFileSync(arquivo, 'dois, bem mais comprido');
    await esperar('mudou', 0);
    assert.equal(avisos[0].arquivo, arquivo);
    let marca = avisos.length;
    fs.rmSync(arquivo);
    await esperar('apagado', marca);
    marca = avisos.length;
    fs.writeFileSync(arquivo, 'voltou');
    await esperar('mudou', marca);
    vigia.parar('p1');
    marca = avisos.length;
    fs.writeFileSync(arquivo, 'escrito depois de parar');
    await pausa(250);
    assert.equal(avisos.length, marca, 'depois de parar, nenhum aviso chega');
    assert.deepEqual(vigia.ativas(), []);
  } finally {
    vigia.pararTodos();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

/* =====================================================================
   O main: o trecho REAL do main.js (canais, fachada, trava de rede, shutdown)
   ===================================================================== */
function trechoDoCanal(canal) {
  const ini = source.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, 'nao achei ipcMain.handle(' + canal + ')');
  return source.slice(ini, source.indexOf('\n});', ini) + 4);
}
function trechoDaVigia() {
  const ini = source.indexOf('const vigiaDoLeitor = ');
  assert.ok(ini >= 0, 'o main.js precisa criar a vigia do leitor (const vigiaDoLeitor = ...)');
  return source.slice(ini, source.indexOf('\n});', ini) + 4);
}
// um "main.js em miniatura": o disco e' o falso (cada toque anotado) e o relogio tambem
function mainEmMiniatura({ janela = true } = {}) {
  const f = fsFalso({ [ARQ]: { mtimeMs: 10, size: 5 } }), rel = relogioFalso();
  const handlers = {}, enviados = [], logs = [];
  const real = carregar();
  const ctx = {
    fs: f,
    require: (nome) => {
      if (nome !== './vigia-arquivo') throw new Error('require inesperado: ' + nome);
      return { criarVigia: (o) => real.criarVigia({ ...o, setTimer: rel.setTimer, clearTimer: rel.clearTimer }) };
    },
    logMain: (contexto, erro) => logs.push([contexto, erro && erro.code]),
    win: janela ? { isDestroyed: () => false, webContents: { send: (canal, dados) => enviados.push([canal, dados]) } } : null,
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
  };
  vm.createContext(ctx);
  vm.runInContext(linhaConst('ehCaminhoDeRede'), ctx);
  vm.runInContext(trechoDaVigia(), ctx);
  for (const canal of ['arquivo:vigiar', 'arquivo:vigiar-parar']) vm.runInContext(trechoDoCanal(canal), ctx);
  return { ctx, f, rel, enviados, logs, chamar: (canal, ...args) => handlers[canal]({}, ...args) };
}

test('main: arquivo:vigiar abre a vigia de um arquivo local e o aviso vai pela janela no canal arquivo:mudou', async () => {
  const { f, rel, enviados, chamar } = mainEmMiniatura();
  assert.deepEqual(simples(chamar('arquivo:vigiar', { chave: 'p1', arquivo: ARQ })), { ok: true });
  assert.equal(f.watchers.length, 1);
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md'); rel.avancar(300);
  await tick();
  assert.deepEqual(simples(enviados), [['arquivo:mudou', { chave: 'p1', arquivo: ARQ, evento: 'mudou' }]]);
});

test('main: arquivo:vigiar recusa caminho de rede e arquivo de servidor sem encostar no disco', () => {
  for (const arquivo of REDE) {
    const { f, chamar } = mainEmMiniatura();
    assert.deepEqual(simples(chamar('arquivo:vigiar', { chave: 'p1', arquivo })), { ok: false, motivo: 'rede' }, JSON.stringify(arquivo));
    assert.deepEqual(f.toques, [], 'encostou no disco: ' + JSON.stringify(arquivo));
  }
  // o mesmo caminho pode existir neste disco por acaso: arquivo do servidor nunca e' vigiado aqui
  const { f, chamar } = mainEmMiniatura();
  assert.deepEqual(simples(chamar('arquivo:vigiar', { chave: 'p1', arquivo: ARQ, remoto: { host: 'vps', usuario: 'hugo' } })), { ok: false, motivo: 'servidor' });
  assert.deepEqual(simples(chamar('arquivo:vigiar', 'qualquer coisa')), { ok: false, motivo: 'pedido' });
  assert.deepEqual(simples(chamar('arquivo:vigiar')), { ok: false, motivo: 'pedido' });
  assert.deepEqual(f.toques, []);
});

test('main: arquivo:vigiar-parar fecha a vigia; parar o que nao existe responde ok:false', async () => {
  const { f, rel, enviados, chamar } = mainEmMiniatura();
  chamar('arquivo:vigiar', { chave: 'p1', arquivo: ARQ });
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md');
  assert.deepEqual(simples(chamar('arquivo:vigiar-parar', 'p1')), { ok: true });
  assert.equal(f.watchers[0].fechado, true);
  rel.avancar(1000);
  await tick();
  assert.deepEqual(enviados, []);
  assert.deepEqual(simples(chamar('arquivo:vigiar-parar', 'p1')), { ok: false });
});

test('main: sem janela (ja fechou) o aviso nao lanca nem derruba a vigia; falha vai pro logMain', async () => {
  const { f, rel, logs, chamar } = mainEmMiniatura({ janela: false });
  chamar('arquivo:vigiar', { chave: 'p1', arquivo: ARQ });
  f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  f.watchers[0].ouvinte('change', 'Relatório.md');
  assert.doesNotThrow(() => rel.avancar(300));
  await tick();
  f.watch = () => { throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' }); };
  assert.deepEqual(simples(chamar('arquivo:vigiar', { chave: 'p2', arquivo: ARQ })), { ok: false, motivo: 'erro' });
  assert.deepEqual(logs, [['vigia:abrir', 'EMFILE']], 'a falha nova vai pro logMain');
});

test('main: o shutdown (recarga da tela, queda, fechar) solta todas as vigias', () => {
  assert.match(pegarBloco(source, 'function shutdown(', 'shutdown'), /vigiaDoLeitor\.pararTodos\(\)/);
  // a fachada de seguranca e' o ipcMain do main: nada de ipcMain cru
  assert.match(trechoDoCanal('arquivo:vigiar'), /^ipcMain\.handle\('arquivo:vigiar'/);
});

/* =====================================================================
   A ponte (preload) e o simulador da previa (mock-api)
   ===================================================================== */
test('preload: vigiarArquivo, pararVigia e onArquivoMudou usam os canais certos (o ouvinte e removivel)', async () => {
  const bus = new EventEmitter(), chamadas = []; let api;
  bus.sendSync = () => ({}); bus.invoke = async (...args) => { chamadas.push(args); return { ok: true }; };
  vm.runInNewContext(lerFonte('preload.js'), {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  for (const m of ['vigiarArquivo', 'pararVigia', 'onArquivoMudou']) assert.equal(typeof api[m], 'function', 'falta api.' + m);
  await api.vigiarArquivo({ chave: 'p1', arquivo: ARQ });
  await api.pararVigia('p1');
  assert.deepEqual(chamadas, [['arquivo:vigiar', { chave: 'p1', arquivo: ARQ }], ['arquivo:vigiar-parar', 'p1']]);
  const recebidos = [];
  const soltar = api.onArquivoMudou((aviso) => recebidos.push(aviso));
  bus.emit('arquivo:mudou', {}, { chave: 'p1', arquivo: ARQ, evento: 'mudou' });
  assert.deepEqual(recebidos, [{ chave: 'p1', arquivo: ARQ, evento: 'mudou' }], 'so\' os dados cruzam a ponte, sem o evento do Electron');
  soltar();
  bus.emit('arquivo:mudou', {}, { chave: 'p1', arquivo: ARQ, evento: 'mudou' });
  assert.equal(recebidos.length, 1, 'depois de soltar, nao ouve mais');
});

test('preload: os metodos novos ficam ao lado do verArquivo (nao no fim do objeto)', () => {
  const preload = lerFonte('preload.js');
  const pos = (m) => preload.indexOf('  ' + m + ':');
  assert.ok(pos('vigiarArquivo') > pos('verArquivo') && pos('vigiarArquivo') - pos('verArquivo') < 2000, 'vigiarArquivo perto do verArquivo (os vizinhos abrirPdf e imagemDoMd entraram na leva 2)');
  assert.ok(pos('pararVigia') > pos('vigiarArquivo') && pos('onArquivoMudou') > pos('pararVigia'));
  assert.ok(pos('onArquivoMudou') < pos('onMenu'), 'nao foi parar no fim do objeto');
});

test('mock-api: declara vigiarArquivo e pararVigia (nada em __qa.missing) e devolve { ok: true }', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'tools', 'redesenho', 'mock-api.js'), 'utf8'), ctx);
  assert.deepEqual(simples(await win.api.vigiarArquivo({ chave: 'p1', arquivo: 'C:/QA/a.md' })), { ok: true });
  assert.deepEqual(simples(await win.api.pararVigia('p1')), { ok: true });
  assert.ok(!win.__qa.missing.has('vigiarArquivo') && !win.__qa.missing.has('pararVigia'), 'ficaram em __qa.missing');
  let recebido = null;
  win.api.onArquivoMudou((a) => { recebido = a; });
  win.__qa.emit('onArquivoMudou', { chave: 'p1', evento: 'mudou' });
  assert.deepEqual(simples(recebido), { chave: 'p1', evento: 'mudou' }, 'o QA consegue simular o aviso do main');
});

/* =====================================================================
   A tela: o trecho REAL do visor (app.js) com um DOM de mentira
   ===================================================================== */
const trechoVisor = APP.slice(
  APP.indexOf('/* ============ visualizador de arquivo ============ */'),
  APP.indexOf('/* ============ conversas recentes ============ */'));
assert.ok(trechoVisor.length > 200, 'nao achei o trecho do visor no app.js');
const closePaneReal = pegarBloco(APP, 'async function closePane(', 'closePane');

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.eventos = {};
    this.texto = ''; this.html = ''; this.scrollTop = 0; this.title = ''; this.focos = 0;
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
  esvaziar() {
    // o navegador tira o foco de quem sai da arvore
    const doc = No.documento;
    for (const f of this.filhos) { if (doc && doc.activeElement && (f === doc.activeElement || f.contains(doc.activeElement))) doc.activeElement = null; f.pai = null; }
    this.filhos = [];
  }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  focus() { this.focos++; if (No.documento) No.documento.activeElement = this; }
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
function painelComVisor(id) {
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
  return { P: { id, el }, v };
}
const baseNome = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
const A = 'C:\\docs\\a.txt', B = 'C:\\docs\\b.txt', C = 'C:\\docs\\c.txt';
const PDF = 'C:\\docs\\relatorio.pdf', PAGINA = 'C:\\docs\\pagina.html';
const RESP_PDF = { tipo: 'pdf', nome: 'relatorio.pdf', ext: 'pdf', bytes: 9 };
const SERVIDOR = { usuario: 'hugo', host: 'vps', chave: 'k' };

/* A tela com N paineis. `chamadas` e' tudo que a tela pediu ao main, na ordem. `vigias()` repete esse historico do
   jeito que o main entende (uma vigia por chave, pedir outra troca, parar tira): o que SOBRARIA vigiando agora. */
function tela({ respostas = {}, paineis = 1, comVigia = true, pdf = { ok: true } } = {}) {
  const corpoDoc = new No('body'), relogio = relogioFalso(), chamadas = [], mapa = new Map(), visores = [], montagens = [], descartes = [];
  const documento = {
    body: corpoDoc, activeElement: null, createElement: (t) => new No(t),
    createTextNode: (t) => { const n = new No('#text'); n.texto = String(t); return n; },
  };
  No.documento = documento;
  const lista = [];
  for (let i = 1; i <= paineis; i++) { const { P, v } = painelComVisor('p' + i); mapa.set(P.id, P); visores.push(v); lista.push({ P, v }); }
  const api = {
    verArquivo: async (caminho, remoto) => {
      chamadas.push(['verArquivo', caminho, remoto ? 'remoto' : 'local']);
      return respostas[caminho] || { tipo: 'texto', nome: baseNome(caminho), bytes: 8, dados: 'texto de ' + baseNome(caminho) };
    },
    openPath: async () => ({ ok: true }), mostrarNaPasta: async () => ({ ok: true }), paneStop: async () => true,
    // a janela do PDF (main): `pdf` e' a resposta que ela da' ({ ok: true } ou { error })
    abrirPdf: async (caminho) => { chamadas.push(['abrirPdf', caminho]); return pdf; },
  };
  if (comVigia) {
    api.vigiarArquivo = async (o) => { chamadas.push(['vigiarArquivo', o.chave, o.arquivo]); return { ok: true }; };
    api.pararVigia = async (chave) => { chamadas.push(['pararVigia', chave]); return { ok: true }; };
  }
  const ctx = {
    ...globaisFalsos(), console,
    setTimeout: relogio.setTimer, clearTimeout: relogio.clearTimer,
    document: documento,
    $: (sel, raiz) => (raiz || corpoDoc).querySelector(sel),
    $$: (sel) => (sel === '.p-visor' ? visores : []),
    ico: (n) => '<i>' + n + '</i>',
    note() {}, abrirQuadro() {}, ESTE_PC: 'PC', baseNome,
    tamanhoBonito: (b) => b + ' B',
    faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
    AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    mdSeguro: (t) => t, linkarArquivos() {}, marcarLinksWeb() {},
    acharPainel: (id) => mapa.get(id),
    panes: mapa, quadro: null, focusPane: null,
    pararIrProFim() {}, soltarNavArquivos() {}, soltarPendente() {}, matarTerminaisDoPainel() {}, montarColunas() {}, savePanes() {}, sincronizarPendencias() {},
    window: {
      api,
      CockpitFileLinks: require('../src/renderer/file-links.js'),
      CockpitReaderTools: {
        renderIcon: (n, f) => f(n),
        mount: (o) => {
          // o mount de verdade MOVE o corpo no DOM (body.before(layout); layout.appendChild(body)) e o navegador solta o foco de quem se move
          if (documento.activeElement && o.body.contains(documento.activeElement)) documento.activeElement = null;
          montagens.push(o);
          return { dispose() { descartes.push(o.path); }, beforeRender() {}, afterRender() {} };
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(trechoVisor + '\n' + closePaneReal, ctx);
  const vigias = () => {
    const m = {};
    for (const c of chamadas) { if (c[0] === 'vigiarArquivo') m[c[1]] = c[2]; else if (c[0] === 'pararVigia') delete m[c[1]]; }
    return m;
  };
  return { ctx, ...lista[0], lista, chamadas, relogio, montagens, descartes, vigias, api, documento, mapa, visores };
}
const botaoVoltar = (v) => v.querySelector('.visor-voltar');
const corpoDe = (v) => v.querySelector('.visor-corpo');
const origemDe = (v) => v.querySelector('.visor-origem');
const avisoMudou = (v) => v.querySelector('.visor-aviso-mudou');   // o "O arquivo mudou · Reler" do HTML
const abertos = (chamadas) => chamadas.filter((c) => c[0] === 'verArquivo').map((c) => c[1]);
// um keydown do jeito que o navegador entrega ao visor (o ouvinte e' o onkeydown do proprio visor)
function teclar(v, tecla, extra = {}) {
  const ev = {
    key: tecla, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, target: v,
    defaultPrevented: false, parou: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; },
    ...extra,
  };
  v.onkeydown(ev);
  return ev;
}
const altEsquerda = (v, extra) => teclar(v, 'ArrowLeft', { altKey: true, ...extra });

test('Voltar: abrir outro documento com o leitor aberto empilha o de agora e o botao Voltar (arrow-left) aparece no canto', async () => {
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, A, null);
  const bt = botaoVoltar(v);
  assert.ok(bt, 'falta o botao Voltar no visor');
  assert.equal(bt.classes.has('hidden'), true, 'primeiro documento: nada pra onde voltar');
  assert.equal(bt.innerHTML, '<i>arrow-left</i>');
  assert.equal(bt.classes.has('visor-abrir'), false, 'com a classe do "Abrir no PC" o verArquivo acharia este botao no lugar dele');
  assert.equal(bt.classes.has('visor-voltar'), true);
  assert.equal(bt.pai.filhos[0], bt, 'fica no canto esquerdo da barra de cima');
  assert.equal(bt.pai.classes.has('visor-top'), true);
  await ctx.verArquivo(P, B, null);
  assert.equal(botaoVoltar(v), bt, 'um botao so\', reaproveitado');
  assert.equal(bt.classes.has('hidden'), false);
  assert.equal(bt.title, 'Voltar para a.txt (Alt+←)');
  assert.equal(bt.getAttribute('aria-label'), bt.title);
});

test('Voltar: o "Abrir no PC" e o "Mostrar na pasta" continuam sendo eles mesmos depois de abrir varios documentos', async () => {
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null); await ctx.verArquivo(P, C, null);
  const abrir = v.querySelector('.visor-abrir'), voltar = botaoVoltar(v);
  assert.notEqual(abrir, voltar, 'o primeiro .visor-abrir tem que ser o "Abrir no PC"');
  assert.equal(abrir.innerHTML, '<i>external-link</i>');
  assert.equal(abrir.getAttribute('aria-label'), 'Abrir no PC');
  assert.equal(v.querySelector('.visor-pasta').innerHTML, '<i>folder-open</i>');
  assert.equal(voltar.innerHTML, '<i>arrow-left</i>', 'e o Voltar continua com a seta');
  assert.equal(v.querySelectorAll('.visor-voltar').length, 1);
});

test('Voltar: o clique volta ao documento anterior (e so\' a ele) e o botao some quando a pilha acaba', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null); await ctx.verArquivo(P, C, null);
  const bt = botaoVoltar(v);
  assert.equal(bt.title, 'Voltar para b.txt (Alt+←)');
  await bt.onclick();
  assert.deepEqual(abertos(chamadas), [A, B, C, B], 'voltou pro B');
  assert.equal(v.querySelector('.visor-nome').textContent, 'b.txt  ·  8 B');
  assert.equal(bt.title, 'Voltar para a.txt (Alt+←)', 'agora o de tras e o A');
  await bt.onclick();
  assert.deepEqual(abertos(chamadas), [A, B, C, B, A]);
  assert.equal(bt.classes.has('hidden'), true, 'acabou a pilha');
  assert.equal(await ctx.voltarVisor(P), false, 'sem pilha, nada a fazer');
  assert.deepEqual(abertos(chamadas), [A, B, C, B, A]);
});

test('Voltar: voltar nao empilha de novo (o documento de onde saiu nao entra na pilha)', async () => {
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  assert.equal(P._visorPilha.length, 1);
  await ctx.voltarVisor(P);
  assert.equal(P._visorPilha.length, 0, 'voltar desempilha e nao empilha o B');
  assert.equal(botaoVoltar(v).classes.has('hidden'), true);
});

test('Voltar: a pilha e por painel (um painel nao ve a historia do outro) e some quando o visor de outro painel abre', async () => {
  const { ctx, lista } = tela({ paineis: 2 });
  const [{ P: P1, v: v1 }, { P: P2, v: v2 }] = lista;
  await ctx.verArquivo(P1, A, null); await ctx.verArquivo(P1, B, null);
  assert.equal(P1._visorPilha.length, 1);
  await ctx.verArquivo(P2, C, null);   // so' um visor aberto por vez: o do P1 fecha, e a pilha dele junto
  assert.equal(botaoVoltar(v2).classes.has('hidden'), true, 'o P2 comecou do zero');
  assert.deepEqual([...P1._visorPilha], [], 'a pilha do P1 morreu com o visor dele');
  assert.equal(P2._visorPilha.length, 0);
  assert.equal(v1.classes.has('hidden'), true);
});

test('Voltar: o mesmo documento nao empilha (Reler do leitor e abrir o mesmo arquivo de novo); local e servidor sao documentos diferentes', async () => {
  const { ctx, P, v, montagens } = tela();
  await ctx.verArquivo(P, A, null);
  montagens[0].reload();   // "Mais > Reler arquivo"
  await tick();
  await ctx.verArquivo(P, A, null);
  assert.equal(botaoVoltar(v).classes.has('hidden'), true, 'reler nao e navegar');
  assert.equal(P._visorPilha.length, 0);
  await ctx.verArquivo(P, A, SERVIDOR);   // mesmo texto de caminho, mas no servidor: outro documento
  assert.equal(P._visorPilha.length, 1);
  await ctx.verArquivo(P, A, { ...SERVIDOR });   // o remoto do painel vem como objeto novo a cada vez: igual por conteudo
  assert.equal(P._visorPilha.length, 1);
});

test('Voltar: volta na mesma rolagem', async () => {
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, A, null);
  corpoDe(v).scrollTop = 120;   // o usuario rolou o A
  await ctx.verArquivo(P, B, null);
  assert.equal(corpoDe(v).scrollTop, 0, 'o B abre no comeco');
  await ctx.voltarVisor(P);
  assert.equal(corpoDe(v).scrollTop, 120, 'o A volta onde estava');
});

test('Voltar: PDF aberto a partir do leitor abre a janela dele e o leitor volta ao documento de antes (mesma rolagem, Voltar de pe), em vez de fechar e apagar tudo', async () => {
  const { ctx, P, v, chamadas } = tela({ respostas: { [PDF]: RESP_PDF } });
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  corpoDe(v).scrollTop = 120;   // o usuario rolou o B ate o link do PDF
  await ctx.verArquivo(P, PDF, null);   // o clique no link pro PDF
  assert.deepEqual(chamadas.filter((c) => c[0] === 'abrirPdf'), [['abrirPdf', PDF]], 'a janela do PDF foi pedida');
  assert.equal(v.classes.has('hidden'), false, 'o leitor nao fechou');
  assert.equal(P._visorDoc.caminho, B, 'o leitor voltou ao documento de onde o link saiu');
  assert.deepEqual(abertos(chamadas), [A, B, PDF, B]);
  assert.equal(corpoDe(v).scrollTop, 120, 'na mesma rolagem');
  assert.deepEqual(simples(P._visorPilha.map((d) => d.caminho)), [A], 'a pilha do Voltar continua (so o B saiu dela)');
  assert.equal(botaoVoltar(v).classes.has('hidden'), false);
  assert.equal(botaoVoltar(v).title, 'Voltar para a.txt (Alt+←)');
  await botaoVoltar(v).onclick();
  assert.equal(P._visorDoc.caminho, A, 'e o Voltar segue funcionando');
});

test('Voltar: PDF aberto sem nada pra voltar (do cartao da conversa, leitor fechado) fecha o leitor como sempre', async () => {
  const { ctx, P, v, chamadas } = tela({ respostas: { [PDF]: RESP_PDF } });
  await ctx.verArquivo(P, PDF, null);
  assert.deepEqual(chamadas.filter((c) => c[0] === 'abrirPdf'), [['abrirPdf', PDF]]);
  assert.equal(v.classes.has('hidden'), true, 'o PDF esta na janela dele: o leitor fecha');
  assert.equal(P._visorDoc, null);
  assert.deepEqual(abertos(chamadas), [PDF], 'nao leu mais nada');
});

test('Voltar: PDF que nao abriu deixa o recado na tela e a pilha do Voltar intacta (nada de voltar sozinho)', async () => {
  const { ctx, P, v } = tela({ respostas: { [PDF]: RESP_PDF }, pdf: { error: 'O visualizador de PDF não está disponível aqui.' } });
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, PDF, null);
  assert.equal(v.classes.has('hidden'), false);
  assert.match(corpoDe(v).textContent, /O visualizador de PDF não está disponível aqui\./);
  assert.equal(P._visorDoc.caminho, PDF);
  assert.deepEqual(simples(P._visorPilha.map((d) => d.caminho)), [A]);
});

test('Voltar: a pilha tem teto (nao cresce sem fim) e guarda os mais recentes', async () => {
  const { ctx, P } = tela();
  for (let i = 0; i < 80; i++) await ctx.verArquivo(P, 'C:\\docs\\d' + i + '.txt', null);
  assert.ok(P._visorPilha.length <= 50, 'teto da pilha: ' + P._visorPilha.length);
  assert.equal(P._visorPilha.at(-1).caminho, 'C:\\docs\\d78.txt', 'o ultimo empilhado e o anterior ao de agora');
});

test('Voltar: a pilha some ao fechar o visor (Esc, X, fecharVisor); reabrir comeca do zero', async () => {
  for (const fechar of [(v) => teclar(v, 'Escape'), (v) => v.querySelector('.visor-x').onclick(), (v, ctx) => ctx.fecharVisor()]) {
    const { ctx, P, v } = tela();
    await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
    assert.equal(P._visorPilha.length, 1);
    fechar(v, ctx);
    assert.equal(v.classes.has('hidden'), true);
    assert.deepEqual([...P._visorPilha], [], 'a pilha foi embora com o visor');
    await ctx.verArquivo(P, C, null);
    assert.equal(botaoVoltar(v).classes.has('hidden'), true, 'reabrir nao mostra Voltar');
    assert.equal(await ctx.voltarVisor(P), false);
  }
});

test('Alt+←: com o visor aberto e algo pra voltar, volta; o evento e consumido so\' nesse caso', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null);
  const semPilha = altEsquerda(v);
  assert.equal(semPilha.defaultPrevented, false, 'sem pilha nao toma a tecla de ninguem');
  assert.equal(semPilha.parou, false);
  await ctx.verArquivo(P, B, null);
  const ev = altEsquerda(v);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.parou, true, 'consumido: nao sobe pros ouvintes do document');
  await tick();
  assert.deepEqual(abertos(chamadas), [A, B, A], 'voltou ao A');
  assert.equal(botaoVoltar(v).classes.has('hidden'), true);
});

test('Alt+←: nao rouba nada — campo de texto (palavra anterior no Mac), Ctrl/Shift/Meta (AltGr), tecla segurada, composicao', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  const campo = filho(v, 'textarea'), busca = filho(v, 'input');
  const editavel = new No('div'); editavel.isContentEditable = true; v.appendChild(editavel);
  for (const alvo of [campo, busca, editavel]) {
    const ev = altEsquerda(v, { target: alvo });
    assert.equal(ev.defaultPrevented || ev.parou, false, 'tomou a tecla de ' + alvo.tagName);
  }
  for (const extra of [{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }, { repeat: true }, { isComposing: true }]) {
    const ev = altEsquerda(v, extra);
    assert.equal(ev.defaultPrevented || ev.parou, false, 'tomou a tecla com ' + JSON.stringify(extra));
  }
  for (const tecla of ['ArrowRight', 'ArrowUp', 'Home', 'Backspace', 'b']) {
    const ev = teclar(v, tecla, { altKey: true });
    assert.equal(ev.defaultPrevented || ev.parou, false, 'tomou Alt+' + tecla);
  }
  const sem = teclar(v, 'ArrowLeft');   // seta esquerda sozinha: e' do leitor (rolar, mover o cursor)
  assert.equal(sem.defaultPrevented || sem.parou, false);
  await tick();
  assert.deepEqual(abertos(chamadas), [A, B], 'nenhuma dessas voltou');
  assert.equal(P._visorPilha.length, 1);
});

test('Alt+←: nao funciona com o visor fechado', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  ctx.fecharVisor();
  const ev = altEsquerda(v);
  assert.equal(ev.defaultPrevented || ev.parou, false);
  await tick();
  assert.deepEqual(abertos(chamadas), [A, B]);
  assert.equal(v.classes.has('hidden'), true, 'continua fechado');
});

test('Alt+←: o Esc continua fechando o visor e a aba Previa/Codigo nao toma a tecla (mas segue com as setas sem modificador)', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  const modos = v.querySelector('.visor-modos'), previa = v.querySelector('.visor-previa'), codigo = v.querySelector('.visor-fonte');
  const cliques = [];
  previa.click = () => cliques.push('previa'); codigo.click = () => cliques.push('codigo');
  // setas sem modificador seguem trocando o modo (WAI-ARIA tablist)
  const seta = { key: 'ArrowRight', altKey: false, ctrlKey: false, metaKey: false, preventDefault() { this.defaultPrevented = true; } };
  modos.onkeydown(seta);
  assert.deepEqual(cliques, ['codigo']);
  assert.equal(seta.defaultPrevented, true);
  // com Alt: a tablist nao consome; o evento sobe ate o visor, que volta
  const ev = { key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, target: previa,
    defaultPrevented: false, parou: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; } };
  modos.onkeydown(ev);
  assert.deepEqual(cliques, ['codigo'], 'Alt+← nao e uma seta da aba');
  assert.equal(ev.defaultPrevented, false, 'a aba nao consumiu o evento');
  v.onkeydown(ev);
  await tick();
  assert.deepEqual(abertos(chamadas), [A, B, A]);
  // o Esc, como sempre
  const esc = teclar(v, 'Escape');
  assert.equal(esc.defaultPrevented, true);
  assert.equal(v.classes.has('hidden'), true);
});

test('Vigia: arquivo local e vigiado ANTES da leitura (so\' assim a mudanca entre ler e vigiar nao se perde)', async () => {
  const { ctx, P, chamadas, vigias } = tela();
  await ctx.verArquivo(P, A, null);
  assert.deepEqual(chamadas, [['vigiarArquivo', 'p1', A], ['verArquivo', A, 'local']]);
  assert.deepEqual(vigias(), { p1: A });
});

test('Vigia: arquivo de servidor e de rede nunca sao vigiados (a tela nem pede)', async () => {
  for (const [caminho, remoto] of [['/home/hugo/a.md', SERVIDOR], ...REDE.map((r) => [r, null])]) {
    const { ctx, P, chamadas } = tela();
    await ctx.verArquivo(P, caminho, remoto);
    assert.deepEqual(chamadas.filter((c) => c[0] === 'vigiarArquivo'), [], 'pediu vigia de ' + JSON.stringify(caminho));
  }
});

test('Vigia: PDF nunca e vigiado (a janela dele e do main) e a recarga automatica nunca chama abrirPdf, nem com o recado de falha na tela', async () => {
  const { ctx, P, v, chamadas, vigias } = tela({ respostas: { [PDF]: RESP_PDF }, pdf: { error: 'O visualizador de PDF não está disponível aqui.' } });
  await ctx.verArquivo(P, PDF, null);
  assert.deepEqual(chamadas.filter((c) => c[0] === 'vigiarArquivo'), [], 'pediu vigia de PDF');
  assert.deepEqual(vigias(), {});
  const recado = corpoDe(v).textContent;
  assert.match(recado, /não está disponível/);
  // um aviso que chegasse mesmo assim (arquivo mexido, vigia velha) e a recarga chamada direto: nenhum reabre a janela
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PDF, evento: 'mudou' });
  await ctx.recarregarVisor(P, v);
  assert.equal(chamadas.filter((c) => c[0] === 'abrirPdf').length, 1, 'a janela do PDF abriu sozinha de novo');
  assert.equal(corpoDe(v).textContent, recado, 'o recado nao foi trocado por "abrindo..."');
  assert.deepEqual(abertos(chamadas), [PDF], 'nem leu o arquivo de novo');
});

test('Vigia: o PDF aberto a partir de outro documento tambem nao e vigiado, e o documento de antes volta a ser vigiado ao voltar', async () => {
  const { ctx, P, chamadas, vigias } = tela({ respostas: { [PDF]: RESP_PDF } });
  await ctx.verArquivo(P, A, null);
  assert.deepEqual(vigias(), { p1: A });
  await ctx.verArquivo(P, PDF, null);   // abre a janela e o leitor volta ao A
  assert.deepEqual(chamadas.filter((c) => c[0] === 'vigiarArquivo').map((c) => c[2]), [A, A], 'o PDF nao entrou na conta: so o A, antes e depois');
  assert.deepEqual(vigias(), { p1: A });
});

test('Vigia: se a ponte nao tem a vigia (preload velho, previa), o leitor abre normal', async () => {
  const { ctx, P, chamadas } = tela({ comVigia: false });
  await ctx.verArquivo(P, A, null);
  await ctx.verArquivo(P, B, null);
  ctx.fecharVisor();
  assert.deepEqual(abertos(chamadas), [A, B]);
});

test('Vigia: PARA ao fechar o visor (Esc, X ou fecharVisor) e nao sobra nenhuma', async () => {
  for (const fechar of [(v) => teclar(v, 'Escape'), (v) => v.querySelector('.visor-x').onclick(), (v, ctx) => ctx.fecharVisor()]) {
    const { ctx, P, v, chamadas, vigias } = tela();
    await ctx.verArquivo(P, A, null);
    assert.deepEqual(vigias(), { p1: A });
    fechar(v, ctx);
    assert.deepEqual(vigias(), {}, 'o visor fechou e a vigia ficou');
    assert.equal(chamadas.filter((c) => c[0] === 'pararVigia').length, 1);
    ctx.fecharVisor();   // fechar de novo nao manda parada de vigia que nao existe
    assert.equal(chamadas.filter((c) => c[0] === 'pararVigia').length, 1);
  }
});

test('Vigia: PARA ao trocar de documento (a nova so\' vigia o novo; servidor e rede soltam a velha e nao vigiam nada)', async () => {
  const { ctx, P, vigias } = tela();
  await ctx.verArquivo(P, A, null);
  await ctx.verArquivo(P, B, null);
  assert.deepEqual(vigias(), { p1: B }, 'so\' o documento de agora');
  await ctx.verArquivo(P, '/home/hugo/c.md', SERVIDOR);
  assert.deepEqual(vigias(), {}, 'arquivo de servidor: a vigia do B foi solta e nada novo');
  await ctx.verArquivo(P, C, null);
  assert.deepEqual(vigias(), { p1: C });
  await ctx.verArquivo(P, REDE[0], null);
  assert.deepEqual(vigias(), {}, 'caminho de rede: solta a velha e nao vigia a nova');
  await ctx.verArquivo(P, A, null);
  assert.deepEqual(vigias(), { p1: A });
  await ctx.voltarVisor(P);   // Voltar tambem e trocar de documento: volta pro caminho de rede, que nao e vigiado
  assert.deepEqual(vigias(), {});
});

test('Vigia: PARA quando o painel morre (closePane de verdade) e a de outro painel nao e tocada', async () => {
  const { ctx, lista, mapa, vigias, chamadas } = tela({ paineis: 3 });
  const [{ P: P1 }, { P: P2 }] = lista;
  ctx.focusPane = P2;
  await ctx.verArquivo(P1, A, null);
  assert.deepEqual(vigias(), { p1: A });
  await ctx.closePane('p1');
  assert.equal(mapa.has('p1'), false, 'o painel morreu');
  assert.deepEqual(vigias(), {}, 'o painel morreu e a vigia ficou');
  assert.equal(P1.morto, true);
  // fechar outro painel (sem visor) nao mexe na vigia de quem esta lendo
  await ctx.verArquivo(P2, B, null);
  await ctx.closePane('p3');
  assert.deepEqual(vigias(), { p2: B });
  assert.equal(chamadas.filter((c) => c[0] === 'pararVigia').length, 1, 'uma parada so\': a do painel que morreu, nenhuma a mais');
});

test('Recarga: arquivo que mudou recarrega o leitor na mesma rolagem, sem empilhar e sem trocar de lugar na pilha', async () => {
  const { ctx, P, v, chamadas, vigias } = tela();
  await ctx.verArquivo(P, A, null);
  corpoDe(v).scrollTop = 340;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.deepEqual(abertos(chamadas), [A, A], 'leu de novo');
  assert.equal(corpoDe(v).scrollTop, 340, 'mesma rolagem');
  assert.equal(botaoVoltar(v).classes.has('hidden'), true, 'recarregar nao e navegar');
  assert.equal(P._visorPilha.length, 0);
  assert.deepEqual(vigias(), { p1: A }, 'a vigia continua no mesmo arquivo');
  assert.equal(P._visorDoc.caminho, A);
});

test('Recarga: no meio da pilha o Voltar continua apontando pro mesmo lugar', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);
  corpoDe(v).scrollTop = 55;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: B, evento: 'mudou' });
  assert.equal(P._visorPilha.length, 1);
  assert.equal(botaoVoltar(v).title, 'Voltar para a.txt (Alt+←)');
  assert.equal(corpoDe(v).scrollTop, 55);
  await ctx.voltarVisor(P);
  assert.deepEqual(abertos(chamadas), [A, B, B, A]);
});

test('Recarga: aviso de outro documento, de visor fechado ou de painel que nao existe nao recarrega (e pede pra vigia parar)', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null);
  const antes = chamadas.length;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: B, evento: 'mudou' });   // aviso atrasado do B, que ja saiu da tela
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'qualquer' });
  await ctx.arquivoMudou(null); await ctx.arquivoMudou({}); await ctx.arquivoMudou({ chave: 42 });
  assert.equal(chamadas.length, antes, 'nada foi lido nem parado');
  ctx.fecharVisor();
  const paradas = chamadas.filter((c) => c[0] === 'pararVigia').length;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });   // visor fechado: a vigia nem devia existir
  assert.deepEqual(abertos(chamadas), [A], 'nao reabriu o visor');
  assert.equal(v.classes.has('hidden'), true);
  assert.equal(chamadas.filter((c) => c[0] === 'pararVigia').length, paradas + 1, 'pediu pra vigia sobrante parar');
  await ctx.arquivoMudou({ chave: 'p99', arquivo: A, evento: 'mudou' });   // painel que ja morreu
  assert.deepEqual(chamadas.at(-1), ['pararVigia', 'p99']);
  P.morto = true;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.deepEqual(abertos(chamadas), [A]);
});

test('Recarga: arquivo apagado mantem o que esta na tela e avisa discretamente; quando ele volta, recarrega e o aviso some', async () => {
  const { ctx, P, v, chamadas } = tela();
  await ctx.verArquivo(P, A, null);
  const antes = corpoDe(v).textContent;
  assert.equal(origemDe(v).textContent, 'Este PC');
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'apagado' });
  assert.match(origemDe(v).textContent, /apagado ou movido/);
  assert.equal(corpoDe(v).textContent, antes, 'o conteudo continua na tela');
  assert.deepEqual(abertos(chamadas), [A], 'apagado nao recarrega (nao ha o que ler)');
  assert.equal(v.classes.has('hidden'), false, 'e nao fecha o leitor');
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(origemDe(v).textContent, 'Este PC', 'voltou: o aviso saiu');
  assert.deepEqual(abertos(chamadas), [A, A]);
});

test('Recarga: HTML nao recarrega sozinho (o iframe rola por dentro e a tela nao le a posicao: voltaria ao topo) — aparece "O arquivo mudou · Reler", e o Reler recarrega', async () => {
  const { ctx, P, v, chamadas, montagens, documento } = tela();
  await ctx.verArquivo(P, PAGINA, null);
  const lidos = abertos(chamadas).length;
  assert.equal(avisoMudou(v), null, 'nada mudou ainda: sem aviso');
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'mudou' });
  assert.equal(abertos(chamadas).length, lidos, 'o HTML nao foi lido de novo sozinho');
  assert.equal(montagens.length, 1, 'e o leitor nao foi remontado');
  const aviso = avisoMudou(v);
  assert.ok(aviso, 'falta o aviso discreto');
  assert.equal(aviso.textContent, 'O arquivo mudou · Reler');
  assert.equal(aviso.getAttribute('role'), 'status');
  const reler = aviso.querySelector('button');
  assert.ok(reler && reler.textContent === 'Reler', 'falta o botao Reler');
  // mais mudancas: o mesmo aviso, nunca outro, e nada e lido
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'mudou' });
  assert.equal(v.querySelectorAll('.visor-aviso-mudou').length, 1);
  assert.equal(abertos(chamadas).length, lidos);
  // o Reler recarrega (nao e navegar: a pilha nao mexe), o aviso sai e o foco vai pro corpo, nao pro X
  reler.focus();
  await reler.onclick();
  assert.equal(abertos(chamadas).length, lidos + 1, 'o Reler leu de novo');
  assert.equal(avisoMudou(v), null, 'releu: o aviso saiu');
  assert.equal(P._visorPilha.length, 0);
  assert.equal(corpoDe(v).dataset.tipo, 'html');
  assert.equal(documento.activeElement, corpoDe(v), 'depois do Reler o foco fica no corpo (um Enter a mais nao fecha o leitor)');
  // e a mudanca seguinte avisa de novo
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'mudou' });
  assert.ok(avisoMudou(v));
  // so' o HTML e' assim: texto e markdown seguem recarregando sozinhos, sem aviso
  for (const texto of ['C:\\docs\\nota.md', A]) {
    const t = tela();
    await t.ctx.verArquivo(t.P, texto, null);
    await t.ctx.arquivoMudou({ chave: 'p1', arquivo: texto, evento: 'mudou' });
    assert.deepEqual(abertos(t.chamadas), [texto, texto], texto + ' recarrega sozinho');
    assert.equal(avisoMudou(t.v), null, texto + ' nao tem aviso');
  }
});

test('Recarga: HTML apagado e criado de novo — o "apagado ou movido" sai e o aviso do Reler aparece', async () => {
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, PAGINA, null);
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'apagado' });
  assert.match(origemDe(v).textContent, /apagado ou movido/);
  assert.equal(avisoMudou(v), null, 'apagado nao tem o que reler');
  await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'mudou' });
  assert.equal(origemDe(v).textContent, 'Este PC', 'o arquivo voltou: o recado de apagado saiu');
  assert.ok(avisoMudou(v));
});

test('Recarga: o aviso do HTML sai junto com o documento (fechar, trocar de documento, Voltar) e nao vaza pro proximo', async () => {
  const saidas = [
    (ctx) => ctx.fecharVisor(),
    (ctx, P) => ctx.verArquivo(P, A, null),
    (ctx, P) => ctx.verArquivo(P, PAGINA, null),   // o Reler do leitor ("Mais > Reler arquivo") tambem tira o aviso
  ];
  for (const sair of saidas) {
    const { ctx, P, v, relogio } = tela();
    await ctx.verArquivo(P, PAGINA, null);
    await ctx.arquivoMudou({ chave: 'p1', arquivo: PAGINA, evento: 'mudou' });
    assert.ok(avisoMudou(v));
    await sair(ctx, P);
    assert.equal(avisoMudou(v), null, 'o aviso ficou pendurado');
    assert.equal(relogio.pendentes, 0);
  }
  const { ctx, P, v } = tela();
  await ctx.verArquivo(P, PAGINA, null);
  await ctx.verArquivo(P, A, null);
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(avisoMudou(v), null, 'o aviso do HTML nao pula pro texto');
  await ctx.voltarVisor(P);   // de volta ao HTML: nasce sem aviso
  assert.equal(avisoMudou(v), null);
});

test('Recarga: o foco nao e roubado — quem lia no corpo continua nele; quem esta escrevendo espera (comentario, busca, texto marcado)', async () => {
  const { ctx, P, v, chamadas, relogio, documento } = tela();
  await ctx.verArquivo(P, A, null);
  const x = v.querySelector('.visor-x'), corpo = corpoDe(v);
  assert.equal(documento.activeElement, x, 'ao abrir, o foco vai pro X (como sempre foi)');
  // lendo com o foco no corpo (PageDown): a recarga devolve o foco ao corpo, nao ao X
  corpo.focus();
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(documento.activeElement, corpo, 'continua lendo no corpo (o mount do leitor soltou o foco e a recarga o devolveu)');
  // escrevendo um comentario: espera, e nao perde o lugar
  const campo = filho(v, 'textarea');
  campo.focus();
  const lidos = abertos(chamadas).length;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(abertos(chamadas).length, lidos, 'esperou: tem alguem escrevendo');
  assert.equal(documento.activeElement, campo);
  assert.equal(relogio.pendentes, 1, 'um temporizador de espera, nunca mais de um');
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(relogio.pendentes, 1, 'mais um aviso nao empilha outro temporizador');
  relogio.avancar(1500);
  assert.equal(abertos(chamadas).length, lidos, 'ainda escrevendo: espera de novo');
  assert.equal(relogio.pendentes, 1);
  documento.activeElement = null;   // saiu do campo
  relogio.avancar(1500);
  await tick();
  assert.equal(abertos(chamadas).length, lidos + 1, 'saiu do campo: recarregou');
  assert.equal(relogio.pendentes, 0);
  // texto marcado no leitor (o usuario ia comentar): tambem espera
  ctx.window.getSelection = () => ({ rangeCount: 1, isCollapsed: false, anchorNode: corpoDe(v) });
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(abertos(chamadas).length, lidos + 1, 'tem texto marcado: espera');
  ctx.window.getSelection = () => ({ rangeCount: 0, isCollapsed: true, anchorNode: null });
  relogio.avancar(1500); await tick();
  assert.equal(abertos(chamadas).length, lidos + 2);
});

test('Recarga: se a leitura falhar o foco fica onde estava; quem estava no X vai pro corpo (so a abertura foca o X)', async () => {
  const falha = tela({ respostas: { [A]: { erro: 'sumiu' } } });
  await falha.ctx.verArquivo(falha.P, A, null);
  corpoDe(falha.v).focus();
  await falha.ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.match(corpoDe(falha.v).textContent, /Não consegui abrir/);
  assert.equal(falha.documento.activeElement, corpoDe(falha.v), 'leitura que falhou nao derruba o foco pro corpo da pagina');
  const noX = tela();
  await noX.ctx.verArquivo(noX.P, A, null);
  assert.equal(noX.documento.activeElement, noX.v.querySelector('.visor-x'), 'ao abrir, o foco vai pro X (como sempre foi)');
  await noX.ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(noX.documento.activeElement, corpoDe(noX.v), 'a recarga automatica nunca poe o foco no X: quem estava nele (ou em qualquer controle do leitor) vai pro corpo');
});

test('Recarga: o foco nunca cai no X — de qualquer controle do leitor (aba Prévia/Código, Copiar, Voltar, Abrir no PC) volta ao corpo; de fora do leitor, nao vai a lugar nenhum', async () => {
  const { ctx, P, v, documento } = tela();
  await ctx.verArquivo(P, A, null); await ctx.verArquivo(P, B, null);   // o B tem Voltar
  const x = v.querySelector('.visor-x'), corpo = corpoDe(v);
  const controles = {
    'aba Prévia': v.querySelector('.visor-previa'), 'aba Código': v.querySelector('.visor-fonte'), Copiar: v.querySelector('.visor-copiar'),
    Voltar: botaoVoltar(v), 'Abrir no PC': v.querySelector('.visor-abrir'),
  };
  for (const [nome, controle] of Object.entries(controles)) {
    controle.focus();
    await ctx.arquivoMudou({ chave: 'p1', arquivo: B, evento: 'mudou' });
    assert.notEqual(documento.activeElement, x, nome + ': o foco caiu no X (um Espaco ou Enter logo depois fecharia o leitor)');
    assert.equal(documento.activeElement, corpo, nome + ': o foco devia voltar ao corpo do leitor');
  }
  // fora do leitor (ou sem foco nenhum): a recarga automatica nao puxa o foco pra lugar nenhum, muito menos pro X
  const fora = filho(P.el, 'textarea');
  fora.focus();
  await ctx.arquivoMudou({ chave: 'p1', arquivo: B, evento: 'mudou' });
  assert.equal(documento.activeElement, fora, 'o foco de fora do leitor ficou onde estava');
  documento.activeElement = null;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: B, evento: 'mudou' });
  assert.notEqual(documento.activeElement, x, 'sem foco nenhum, a recarga nao pode puxar o foco pro X');
  // abrir de verdade (nao e recarga) continua focando o X
  await ctx.verArquivo(P, C, null);
  assert.equal(documento.activeElement, x);
});

test('Recarga: a espera nao vaza — fechar o visor, trocar de documento ou "apagado" cancelam o temporizador', async () => {
  for (const cancelar of [
    (ctx) => ctx.fecharVisor(),
    (ctx, P) => ctx.verArquivo(P, B, null),
    (ctx) => ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'apagado' }),
  ]) {
    const { ctx, P, v, chamadas, relogio } = tela();
    await ctx.verArquivo(P, A, null);
    filho(v, 'textarea').focus();
    await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
    assert.equal(relogio.pendentes, 1);
    await cancelar(ctx, P);
    assert.equal(relogio.pendentes, 0, 'o temporizador de espera ficou pendurado');
    const lidos = abertos(chamadas).length;
    relogio.avancar(60000); await tick();
    assert.equal(abertos(chamadas).length, lidos, 'a espera disparou depois de cancelada');
  }
});

test('Recarga: o leitor e remontado pelo mesmo caminho do Reler (o dispose do anterior guarda rolagem, busca e rascunho)', async () => {
  const { ctx, P, v, montagens, descartes } = tela();
  await ctx.verArquivo(P, A, null);
  corpoDe(v).scrollTop = 77;
  await ctx.arquivoMudou({ chave: 'p1', arquivo: A, evento: 'mudou' });
  assert.equal(montagens.length, 2, 'o leitor foi montado de novo');
  assert.deepEqual(descartes, [A], 'o anterior foi descartado: e no dispose que o reader-tools guarda o estado');
  assert.equal(corpoDe(v).scrollTop, 77);
});

test('app.js: o aviso do main e ouvido UMA vez no boot (nao por visor), ao lado do onPaneEvent', () => {
  const ocorrencias = APP.match(/window\.api\.onArquivoMudou\b/g) || [];
  assert.equal(ocorrencias.length, 1, 'um ouvinte so\', registrado no boot');
  assert.ok(APP.indexOf('window.api.onArquivoMudou') > APP.indexOf('window.api.onPaneEvent('), 'perto do onPaneEvent');
  assert.match(APP, /window\.api\.onArquivoMudou\?\.\(\(ev\) => \{ try \{ arquivoMudou\(ev\); \}/);
});

test('CSS: o botao Voltar tem visual proprio (classe propria) no visor, no visor amplo e no visual Mac', () => {
  const css = lerFonte('renderer', 'style.css'), mac = lerFonte('renderer', 'visual-mac.css');
  assert.match(css, /\.visor-voltar\{width:24px;height:24px;[^}]*display:grid;place-items:center;flex:none\}/);
  assert.match(css, /\.visor-voltar:hover\{/);
  assert.match(css, /\.visor-voltar \.ic\{width:13px;height:13px\}/);
  assert.match(css, /\.visor-amplo \.visor-voltar\{width:30px;height:30px;/);
  assert.match(css, /\.visor-amplo \.visor-voltar:hover\{/);
  assert.match(mac, /html\.visual-mac \.ck-app \.visor-amplo \.visor-voltar \{ border-radius: 50%; \}/);
  // o icone mora no ICONES de base (o teste renderer-logos so' le' esse literal): se faltar, o botao aparece vazio
  const ini = APP.indexOf('const ICONES = ');
  const base = vm.runInContext('(' + APP.slice(ini + 'const ICONES = '.length, APP.indexOf(';\n', ini)) + ')', vm.createContext({}));
  assert.match(base['arrow-left'], /^<path d="[^"]+" \/>(?: <path d="[^"]+" \/>)*$/);
});

test('app.js: o teclado do visor nao ganhou ouvinte global (o Alt+← mora no onkeydown do proprio visor)', () => {
  assert.doesNotMatch(trechoVisor, /document\.addEventListener\(\s*['"]keydown/);
  assert.doesNotMatch(trechoVisor, /window\.addEventListener\(\s*['"]keydown/);
  assert.match(trechoVisor, /e\.key === 'ArrowLeft' && e\.altKey/);
});
