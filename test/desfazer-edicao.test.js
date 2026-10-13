'use strict';
/* Tarefa 9 (27/09/2026): Desfazer a edicao da IA direto no passo.

   Porte do Cockpit do Homero (main.js 1475-1493 e 1518, renderer/app.js
   3632-3643), com o que ele nao fazia: a tela manda SO' { paneId, id } (o main
   desfaz com o que ELE emitiu, nunca com antes/depois vindos da tela), recusa
   passo com erro, painel remoto, painel trabalhando, caminho relativo ou de
   rede, "trocar todas", texto cortado; adapta LF/CRLF; MultiEdit tudo ou
   nada; Write de arquivo novo vai pra Lixeira.

   Tres camadas:
   1) o nucleo puro (src/desfazer-edicao.js): planejarDesfazer e caminhoLocal;
   2) o main.js de verdade: mudancaDaFerramenta, o registro do que foi emitido
      (guardarMudancaEmitida), emit, pane:stop e o canal arquivo:desfazer,
      recortados e rodados num vm (molde handler() de
      test/main-diff-export.test.js) com arquivos REAIS numa pasta temporaria;
   3) a tela: acharPasso/toolStart/anexarMudancaAoPasso/toolEnd e as pecas
      novas recortadas do app.js (molde telaPassos() do "achado 16" de
      test/auditoria1.test.js), num DOM pequeno.
   E a previa (mock-api e fixtures), o preload e o CSS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco, globaisFalsos, RAIZ } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const CSS = lerFonte('renderer', 'cockpit-ui.css');
const PRELOAD = lerFonte('preload.js');
const MOCK = fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'mock-api.js'), 'utf8');
const FIXTURES = fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'fixtures.js'), 'utf8');
// carregado na hora: antes de existir, cada teste falha sozinho (e nao o arquivo inteiro)
const D = () => require('../src/desfazer-edicao');
const CORTE = '\n…(cortado)';   // a marca do corta() do main.js e do acp.js
const EH_WIN = process.platform === 'win32';
const tiques = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const PASTAS = [];
function pastaTemp() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'desfazer-edicao-'));
  PASTAS.push(p);
  return p;
}
test.after(() => { for (const p of PASTAS) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } });

/* =====================================================================
   1) o nucleo puro
   ===================================================================== */
const edit = (antes, depois, extra) => ({ tipo: 'edit', partes: [{ antes, depois }], todas: false, ...(extra || {}) });

test('nucleo: Edit em arquivo LF volta o trecho antigo', () => {
  const r = D().planejarDesfazer('a\nconst x = 2;\nb\n', edit('const x = 1;', 'const x = 2;'));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, 'a\nconst x = 1;\nb\n');
});

test('nucleo: CRLF de varias linhas desfaz e continua CRLF (o Claude manda o texto em LF)', () => {
  const atual = 'um\r\nDOIS\r\nTRES\r\nquatro\r\nfim\r\n';
  const r = D().planejarDesfazer(atual, edit('dois\ntres', 'DOIS\nTRES\nquatro'));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, 'um\r\ndois\r\ntres\r\nfim\r\n');
  assert.doesNotMatch(r.novoConteudo, /(^|[^\r])\n/, 'nenhuma quebra LF solta num arquivo CRLF');
});

test('nucleo: texto em CRLF num arquivo LF tambem acha (adapta pro arquivo)', () => {
  const r = D().planejarDesfazer('x\nnovo\nfeito\ny\n', edit('velho\r\nfeito', 'novo\r\nfeito'));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, 'x\nvelho\nfeito\ny\n');
});

test('nucleo: recusa arquivo que mudou, texto repetido, marca de corte, "todas" e depois vazio', () => {
  const { planejarDesfazer } = D();
  const casos = [
    ['mudou', 'a\nOUTRA\nb\n', edit('x', 'y')],
    ['repetido', 'y\nmeio\ny\n', edit('x', 'y')],
    ['repetido', 'aaa', edit('b', 'aa')],   // sobreposto conta como duas vezes
    ['cortada', 'a\n' + 'y'.repeat(50) + CORTE + '\n', edit('x', 'y'.repeat(50) + CORTE)],
    ['cortada', 'a\ny\n', edit('x'.repeat(50) + CORTE, 'y')],
    ['todas', 'a\ny\n', edit('x', 'y', { todas: true })],
    ['vazia', 'a\nb\n', edit('x', '')],
  ];
  for (const [codigo, atual, mudanca] of casos) {
    const r = planejarDesfazer(atual, mudanca);
    assert.equal(r.ok, false, codigo);
    assert.equal(r.codigo, codigo, JSON.stringify(mudanca));
    assert.equal(r.novoConteudo, undefined, 'recusa nao traz conteudo novo');
    assert.equal(typeof r.motivo, 'string');
  }
});

test('nucleo: MultiEdit desfaz da ultima parte para a primeira', () => {
  // e1: alpha -> beta; e2: beta -> gamma. So' na ordem de tras pra frente o texto bate.
  const r = D().planejarDesfazer('x gamma y', { tipo: 'multi', partes: [{ antes: 'alpha', depois: 'beta' }, { antes: 'beta', depois: 'gamma' }], todas: false });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, 'x alpha y');
});

test('nucleo: MultiEdit e tudo ou nada (a ultima parte volta, a primeira nao acha: nada muda)', () => {
  const r = D().planejarDesfazer('um DOIS', { tipo: 'multi', partes: [{ antes: 'um', depois: 'UM' }, { antes: 'dois', depois: 'DOIS' }], todas: false });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'mudou');
  assert.equal(r.novoConteudo, undefined);
});

test('nucleo: MultiEdit que veio cortado na lista (mais de 20 trocas) recusa', () => {
  const partes = Array.from({ length: 20 }, (_, i) => ({ antes: 'a' + i, depois: 'b' + i }));
  const r = D().planejarDesfazer(partes.map((p) => p.depois).join(' '), { tipo: 'multi', partes, todas: false, total: 25 });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'incompleta');
});

test('nucleo: Write volta o antes exato se o arquivo ainda e o que a IA gravou (tolera a troca de LF por CRLF)', () => {
  const { planejarDesfazer } = D();
  const antes = '\uFEFFtítulo\r\nação\r\n';
  const w = (depois, extra) => ({ tipo: 'write', partes: [{ antes, depois }], todas: false, ...(extra || {}) });
  let r = planejarDesfazer('novo\nconteudo\n', w('novo\nconteudo\n'));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, antes, 'o antes volta como foi lido, BOM e CRLF inclusos');
  r = planejarDesfazer('novo\r\nconteudo\r\n', w('novo\nconteudo\n'));
  assert.equal(r.ok, true, 'a ferramenta gravou em CRLF: continua sendo o que a IA escreveu');
  assert.equal(r.novoConteudo, antes);
  r = planejarDesfazer('novo\nconteudo\nmais uma linha sua\n', w('novo\nconteudo\n'));
  assert.equal(r.codigo, 'mudou');
  r = planejarDesfazer('novo\n', w('novo\n', { antesInexato: true }));
  assert.equal(r.codigo, 'inexato', 'antes que nao era UTF-8 nao volta');
  r = planejarDesfazer(antes, { tipo: 'write', partes: [{ antes, depois: antes }], todas: false });
  assert.equal(r.codigo, 'nada');
});

test('nucleo: Write de arquivo novo vira Lixeira so se o arquivo ainda e o que a IA gravou', () => {
  const { planejarDesfazer } = D();
  const novo = { tipo: 'write-novo', partes: [{ antes: '', depois: 'criado\n' }], todas: false };
  const r = planejarDesfazer('criado\n', novo);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.lixeira, true);
  assert.equal(planejarDesfazer('criado\ne mexido\n', novo).codigo, 'mudou');
  assert.equal(planejarDesfazer('', { ...novo, partes: [{ antes: '', depois: '' }] }).codigo, 'vazia', 'arquivo criado vazio: nada a comparar');
});

test('nucleo: arquivo com quebras misturadas so aceita o texto literal e nunca parte um CRLF', () => {
  const { planejarDesfazer } = D();
  const misto = 'a\r\nb\nc\r\nd\n';
  let r = planejarDesfazer(misto, edit('B\nC', 'b\nc'));
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.novoConteudo, 'a\r\nB\nC\r\nd\n', 'so a regiao literal troca; o resto do arquivo fica igual');
  // "\nc" existe literal, mas logo depois de um \r: trocar deixaria um \r solto
  r = planejarDesfazer('a\r\nc\nz\n', edit('x', '\nc'));
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'quebra');
});

test('nucleo: tipos que nao desfazem (write-grande, write-incerto, desconhecido) e mudanca torta recusam', () => {
  const { planejarDesfazer } = D();
  for (const tipo of ['write-grande', 'write-incerto', 'outro', '']) {
    assert.equal(planejarDesfazer('x', { tipo, partes: [{ antes: 'a', depois: 'x' }] }).codigo, 'tipo', tipo);
  }
  assert.equal(planejarDesfazer('x', null).codigo, 'tipo');
  assert.equal(planejarDesfazer('x', { tipo: 'edit', partes: [] }).codigo, 'tipo');
  assert.equal(planejarDesfazer('x', { tipo: 'edit', partes: [{ antes: 'a' }] }).codigo, 'tipo');
});

test('nucleo: caminhoLocal so aceita caminho completo deste PC (nada de relativo, rede ou dispositivo)', () => {
  const { caminhoLocal } = D();
  for (const ok of ['C:\\proj\\a.txt', 'c:/proj/a.txt', 'D:\\a']) assert.equal(caminhoLocal(ok, true), true, ok);
  for (const nao of ['proj\\a.txt', 'a.txt', 'C:a.txt', '\\proj\\a.txt', '/proj/a.txt', '\\\\servidor\\pasta\\a.txt', '//servidor/pasta/a.txt',
    '\\\\?\\C:\\a.txt', '\\\\.\\PhysicalDrive0', '', 'C:\\a\0b', null, 42]) assert.equal(caminhoLocal(nao, true), false, String(nao));
  assert.equal(caminhoLocal('/home/a.txt', false), true);
  for (const nao of ['a.txt', '//servidor/a', '']) assert.equal(caminhoLocal(nao, false), false, nao);
});

test('nucleo: os recados sao frases curtas em portugues, sem travessao; o de arquivo aberto e o do brief', () => {
  const { MOTIVOS } = D();
  assert.equal(MOTIVOS.aberto, 'O arquivo está aberto em outro programa. Feche e tente de novo.');
  for (const [k, v] of Object.entries(MOTIVOS)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.length > 10 && v.length < 140, k + ': ' + v);
    assert.doesNotMatch(v, /—/, k);
  }
});

/* =====================================================================
   2) o main.js de verdade, com arquivos reais
   ===================================================================== */
function blocoDoRegistro() {
  const ini = MAIN.indexOf('const mudancasEmitidas = ');
  assert.ok(ini >= 0, 'registro das mudancas emitidas no main.js');
  const ultimo = pegarBloco(MAIN, 'function esquecerMudancasDoPainel(');
  return MAIN.slice(ini, MAIN.indexOf(ultimo) + ultimo.length);
}
function recorteDoCanal(canal) {
  const ini = MAIN.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, 'canal ' + canal + ' no main.js');
  const fim = MAIN.indexOf('\n});', ini) + 4;
  assert.ok(fim > ini);
  return MAIN.slice(ini, fim);
}
/* fs que anota cada chamada (pra provar "recusa sem tocar no disco") e deixa
   trocar uma funcao (pra simular o arquivo preso em outro programa) */
function fsEspiao(trocas) {
  const chamadas = [];
  const t = trocas || {};
  const embrulha = (k, fn) => (...a) => { chamadas.push(k); return (t[k] || fn).apply(fs, a); };
  const espiao = new Proxy(fs, {
    get(alvo, k) {
      const v = alvo[k];
      if (typeof v !== 'function') return v;
      const f = embrulha(String(k), v);
      if (k === 'realpathSync') f.native = embrulha('realpathSync.native', v.native);
      return f;
    },
  });
  return { fs: espiao, chamadas };
}
function mainFalso(opcoes) {
  const o = opcoes || {};
  const lixeira = [];
  const ctx = {
    console, Buffer, Math, Date, path,
    fs: o.fs || fs,
    EH_WIN,
    shell: { trashItem: async (p) => { lixeira.push(p); if (o.lixeiraFalha) throw new Error('Failed to move item to trash'); fs.rmSync(p); } },
    desfazerEdicao: D(),
    remotePaneTargets: new Map(), claudeRemoto: new Map(),
    // o turno comecou ha' 5 s (revisao 1: o Write so' confia no antes de arquivo sem mexida desde o comeco do turno)
    vigiaTurno: { esta: (id) => !!(o.emTurno && o.emTurno.has(id)), inicioDoTurno: () => (o.inicio != null ? o.inicio : Date.now() - 5000) },
  };
  let desfazer = null;
  ctx.ipcMain = { handle: (canal, fn) => { if (canal === 'arquivo:desfazer') desfazer = fn; } };
  vm.createContext(ctx);
  vm.runInContext([
    MAIN.split('\n').find((l) => l.startsWith('const LIM_DIFF = ')),
    pegarBloco(MAIN, 'function mudancaDaFerramenta('),
    blocoDoRegistro(),
    recorteDoCanal('arquivo:desfazer'),
  ].join('\n'), ctx);
  assert.equal(typeof desfazer, 'function');
  return {
    ctx, lixeira,
    registro: () => vm.runInContext('mudancasEmitidas', ctx),
    emTrabalho: () => vm.runInContext('paineisEmTrabalho', ctx),
    capturar: (nome, input, paneId) => ctx.mudancaDaFerramenta(nome, input, paneId || 'p1'),
    emitir: (paneId, kind, data) => ctx.guardarMudancaEmitida(paneId, kind, data),
    desfazer: (pedido) => desfazer({}, pedido),
  };
}
/* o caminho do Claude: captura a ferramenta, o main emite o tool-start (e
   guarda), a IA grava, o tool-end chega ok; a tela pede por { paneId, id } */
function editDoClaude(m, arquivo, input, depoisNoDisco, id) {
  const mudanca = m.capturar(input.edits ? 'MultiEdit' : 'Edit', { file_path: arquivo, ...input });
  m.emitir('p1', 'tool-start', { id: id || 't1', name: input.edits ? 'MultiEdit' : 'Edit', arg: arquivo, mudanca });
  fs.writeFileSync(arquivo, depoisNoDisco);
  m.emitir('p1', 'tool-end', { id: id || 't1', output: 'The file has been updated.', error: false });
  return mudanca;
}
// passo que o main emitiu e viu terminar ok (sem passar pela captura)
function feito(m, paneId, id, mudanca) {
  m.emitir(paneId, 'tool-start', { id, name: 'Edit', arg: '', mudanca });
  m.emitir(paneId, 'tool-end', { id, output: 'ok', error: false });
}
const bytes = (f) => fs.readFileSync(f);

for (const falha of ['readFileSync', 'statSync']) {
  test('leva final: Write existente com falha em ' + falha + ' recusa sem mandar para a Lixeira', async () => {
    const arq = path.join(pastaTemp(), 'existente.txt');
    fs.writeFileSync(arq, 'antes');
    const espiao = fsEspiao({ [falha]: () => { throw Object.assign(new Error('ocupado'), { code: 'EBUSY' }); } });
    const m = mainFalso({ fs: espiao.fs });
    const mudanca = m.capturar('Write', { file_path: arq, content: 'depois' });
    assert.equal(mudanca.tipo, 'write-incerto');
    feito(m, 'p1', 'w', mudanca);
    fs.writeFileSync(arq, 'depois');
    assert.equal((await m.desfazer({ paneId: 'p1', id: 'w' })).ok, false);
    assert.deepEqual(m.lixeira, []);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'depois');
  });
}

test('leva final: Write so e novo com ausencia comprovada; diretorio e acesso incerto recusam', () => {
  const dir = pastaTemp();
  assert.equal(mainFalso().capturar('Write', { file_path: path.join(dir, 'novo.txt'), content: 'novo' }).tipo, 'write-novo');
  assert.equal(mainFalso().capturar('Write', { file_path: dir, content: 'novo' }).tipo, 'write-incerto');
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const espiao = fsEspiao({ existsSync: () => false, lstatSync: () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(mainFalso({ fs: espiao.fs }).capturar('Write', { file_path: 'C:/incerto.txt', content: 'novo' }).tipo, 'write-incerto');
  }
  assert.equal(mainFalso().capturar('Write', { content: 'novo' }).tipo, 'write-incerto');
});

test('leva final: ACP sem oldText nao prova criacao, nem com diff tardio ou arquivo ausente', async () => {
  const { traduzirUpdate } = require('../src/acp');
  const arq = path.join(pastaTemp(), 'existente.txt');
  fs.writeFileSync(arq, 'original');
  for (const tardio of [false, true]) {
    const st = {};
    const passo = { sessionUpdate: 'tool_call', toolCallId: 'w', kind: 'edit' };
    if (tardio) traduzirUpdate(st, passo);
    const eventos = traduzirUpdate(st, { ...passo, sessionUpdate: tardio ? 'tool_call_update' : 'tool_call',
      content: [{ type: 'diff', path: arq, oldText: null, newText: 'depois' }] });
    const mudanca = eventos.find(e => e.mudanca).mudanca;
    assert.equal(mudanca.tipo, 'write-incerto');
    const m = mainFalso();
    feito(m, 'p1', 'w', mudanca);
    assert.equal((await m.desfazer({ paneId: 'p1', id: 'w' })).ok, false);
    assert.deepEqual(m.lixeira, []);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'original');
  }
  const ev = traduzirUpdate({}, { sessionUpdate: 'tool_call', toolCallId: 'novo', kind: 'edit',
    content: [{ type: 'diff', path: path.join(path.dirname(arq), 'ausente.txt'), oldText: null, newText: 'novo' }] });
  assert.equal(ev[0].mudanca.tipo, 'write-incerto');
});
// arquivo que ja existia antes do turno (mtime de uma hora atras): o Write confia no "antes" lido
function envelhecer(f) { const t = new Date(Date.now() - 3600 * 1000); fs.utimesSync(f, t, t); }

test('main: Edit num arquivo LF volta o que era', async () => {
  const m = mainFalso();
  const arq = path.join(pastaTemp(), 'app.js');
  const original = 'const a = 1;\nconst pronto = false;\nconst b = 2;\n';
  fs.writeFileSync(arq, original);
  editDoClaude(m, arq, { old_string: 'const pronto = false;', new_string: 'const pronto = true;' }, original.replace('false', 'true'));
  const r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.deepEqual({ ...r }, { ok: true });
  assert.equal(fs.readFileSync(arq, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.dirname(arq)), ['app.js'], 'nenhum temporario sobrando');
});

test('main: CRLF de varias linhas desfaz e continua CRLF, byte a byte', async () => {
  const m = mainFalso();
  const arq = path.join(pastaTemp(), 'lista.txt');
  const original = Buffer.from('linha um\r\nlinha dois\r\nlinha três\r\nfim\r\n', 'utf8');
  fs.writeFileSync(arq, original);
  // o Claude manda old/new em LF e grava o arquivo de volta em CRLF
  editDoClaude(m, arq, { old_string: 'linha dois\nlinha três', new_string: 'linha 2\nlinha 3\nlinha 3,5' },
    'linha um\r\nlinha 2\r\nlinha 3\r\nlinha 3,5\r\nfim\r\n');
  const r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.ok, true, r.erro);
  assert.ok(bytes(arq).equals(original), JSON.stringify(fs.readFileSync(arq, 'utf8')));
});

test('main: arquivo que mudou depois, texto repetido e marca de corte deixam o arquivo intacto', async () => {
  const { MOTIVOS } = D();
  const pasta = pastaTemp();
  // mudou depois: voce reescreveu o trecho que a IA tinha posto (o texto dela nao existe mais)
  let m = mainFalso();
  let arq = path.join(pasta, 'mudou.txt');
  fs.writeFileSync(arq, 'a\nvelho\nb\n');
  editDoClaude(m, arq, { old_string: 'velho', new_string: 'novo' }, 'a\nnovo\nb\n');
  fs.writeFileSync(arq, 'a\nNOVO, reescrito por voce\nb\n');
  let antes = bytes(arq);
  let r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.ok, false);
  assert.equal(r.erro, MOTIVOS.mudou);
  assert.ok(bytes(arq).equals(antes));
  // repetido: o texto novo aparece duas vezes
  m = mainFalso();
  arq = path.join(pasta, 'repetido.txt');
  fs.writeFileSync(arq, 'x = 1\ny = 2\n');
  editDoClaude(m, arq, { old_string: 'x = 1', new_string: 'y = 2' }, 'y = 2\ny = 2\n');
  antes = bytes(arq);
  r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.erro, MOTIVOS.repetido);
  assert.ok(bytes(arq).equals(antes));
  // marca de corte: o texto novo passou do teto do diff e so' metade ficou guardada
  const esp = fsEspiao();
  m = mainFalso({ fs: esp.fs });
  arq = path.join(pasta, 'grande.txt');
  const enorme = 'z'.repeat(100 * 1024 + 10);
  fs.writeFileSync(arq, 'topo\npequeno\n');
  const mud = editDoClaude(m, arq, { old_string: 'pequeno', new_string: enorme }, 'topo\n' + enorme + '\n');
  assert.ok(mud.depois.endsWith(CORTE), 'a captura corta e marca');
  antes = bytes(arq);
  esp.chamadas.length = 0;
  r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.erro, MOTIVOS.cortada);
  assert.deepEqual(esp.chamadas, [], 'recusou sem tocar no disco');
  assert.ok(bytes(arq).equals(antes));
});

test('main: mexida sua do lado do trecho da IA fica (so o texto dela volta)', async () => {
  const m = mainFalso();
  const arq = path.join(pastaTemp(), 'ao-lado.txt');
  fs.writeFileSync(arq, 'a\nvelho\nb\n');
  editDoClaude(m, arq, { old_string: 'velho', new_string: 'novo' }, 'a\nnovo\nb\n');
  fs.writeFileSync(arq, 'a\nnovo e mais um pedaco seu\nb\n');
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'a\nvelho e mais um pedaco seu\nb\n');
});

test('main: MultiEdit tudo ou nada (volta tudo, ou nada muda)', async () => {
  const pasta = pastaTemp();
  const edits = [
    { old_string: 'um', new_string: 'UM' },
    { old_string: 'dois', new_string: 'DOIS' },
    { old_string: 'tres', new_string: 'TRES' },
  ];
  let m = mainFalso();
  let arq = path.join(pasta, 'tudo.txt');
  fs.writeFileSync(arq, 'um\ndois\ntres\n');
  const mud = editDoClaude(m, arq, { edits }, 'UM\nDOIS\nTRES\n');
  assert.equal(mud.tipo, 'multi');
  let r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'um\ndois\ntres\n');
  // a primeira troca foi mexida depois: as duas ultimas voltariam, mas nada pode mudar
  m = mainFalso();
  arq = path.join(pasta, 'nada.txt');
  fs.writeFileSync(arq, 'um\ndois\ntres\n');
  editDoClaude(m, arq, { edits }, 'UM\nDOIS\nTRES\n');
  fs.writeFileSync(arq, 'Um\nDOIS\nTRES\n');
  const antes = bytes(arq);
  r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.ok, false);
  assert.ok(bytes(arq).equals(antes), 'nem meio arquivo desfeito');
});

test('main: Write num arquivo que existia volta byte a byte (BOM, acento e CRLF)', async () => {
  const m = mainFalso();
  const arq = path.join(pastaTemp(), 'notas.md');
  const original = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('# Título\r\nação e razão\r\n', 'utf8')]);
  fs.writeFileSync(arq, original);
  envelhecer(arq);   // existia antes do turno
  // o main le o arquivo ANTES de o motor gravar (tool-start chega antes da execucao)
  const mudanca = m.capturar('Write', { file_path: arq, content: 'tudo novo\n' });
  assert.equal(mudanca.tipo, 'write');
  m.emitir('p1', 'tool-start', { id: 'w1', name: 'Write', arg: arq, mudanca });
  fs.writeFileSync(arq, 'tudo novo\r\n');   // o Claude pode gravar no CRLF do arquivo que existia
  m.emitir('p1', 'tool-end', { id: 'w1', output: 'ok', error: false });
  const r = await m.desfazer({ paneId: 'p1', id: 'w1' });
  assert.equal(r.ok, true, r.erro);
  assert.ok(bytes(arq).equals(original), 'volta byte a byte');
  assert.deepEqual(m.lixeira, [], 'arquivo que existia nao vai pra Lixeira');
});

test('main: Write de arquivo novo vai para a Lixeira (e nunca vira arquivo vazio)', async () => {
  const pasta = pastaTemp();
  let m = mainFalso();
  let arq = path.join(pasta, 'criado.txt');
  let mudanca = m.capturar('Write', { file_path: arq, content: 'arquivo que a IA criou\n' });
  assert.equal(mudanca.tipo, 'write-novo');
  fs.writeFileSync(arq, 'arquivo que a IA criou\n');
  feito(m, 'p1', 'w1', mudanca);
  const r = await m.desfazer({ paneId: 'p1', id: 'w1' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(m.lixeira.length, 1);
  assert.equal(path.basename(m.lixeira[0]), 'criado.txt');
  assert.equal(fs.existsSync(arq), false, 'foi pra Lixeira, nao ficou vazio');
  // mexido depois: nao vai pra Lixeira
  m = mainFalso();
  arq = path.join(pasta, 'mexido.txt');
  mudanca = m.capturar('Write', { file_path: arq, content: 'da IA\n' });
  fs.writeFileSync(arq, 'da IA\ne seu\n');
  feito(m, 'p1', 'w2', mudanca);
  const r2 = await m.desfazer({ paneId: 'p1', id: 'w2' });
  assert.equal(r2.erro, D().MOTIVOS.mudou);
  assert.deepEqual(m.lixeira, []);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'da IA\ne seu\n');
  // a Lixeira falhou: recado claro, arquivo fica
  m = mainFalso({ lixeiraFalha: true });
  arq = path.join(pasta, 'preso.txt');
  mudanca = m.capturar('Write', { file_path: arq, content: 'x\n' });
  fs.writeFileSync(arq, 'x\n');
  feito(m, 'p1', 'w3', mudanca);
  const r3 = await m.desfazer({ paneId: 'p1', id: 'w3' });
  assert.equal(r3.erro, D().MOTIVOS.lixeira);
  assert.equal(fs.existsSync(arq), true);
});

test('main: painel remoto e caminho de rede recusam sem tocar o disco', async () => {
  const { MOTIVOS } = D();
  const esp = fsEspiao();
  const m = mainFalso({ fs: esp.fs });
  const mud = (p) => ({ path: p, tipo: 'edit', antes: 'a', depois: 'b', todas: false });
  feito(m, 'p1', 'loc', mud('C:\\proj\\a.txt'));
  feito(m, 'p1', 'unc', mud('\\\\servidor\\pasta\\a.txt'));
  feito(m, 'p1', 'barras', mud('//servidor/pasta/a.txt'));
  feito(m, 'p1', 'rel', mud('pasta\\a.txt'));
  esp.chamadas.length = 0;
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'unc' })).erro, MOTIVOS.rede);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'barras' })).erro, MOTIVOS.rede);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'rel' })).erro, MOTIVOS.caminho);
  m.ctx.remotePaneTargets.set('p1', { engine: 'codex', remoto: { host: 'vps' } });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'loc' })).erro, MOTIVOS.remoto);
  m.ctx.remotePaneTargets.delete('p1');
  m.ctx.claudeRemoto.set('p1', { host: 'vps' });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'loc' })).erro, MOTIVOS.remoto);
  assert.deepEqual(esp.chamadas, [], 'nenhuma chamada ao disco');
  // o que um painel remoto emite nem entra no registro (o caminho e' do servidor)
  m.emitir('p2', 'tool-start', { id: 'r1', mudanca: mud('/srv/app/a.js'), remoto: true });
  m.ctx.remotePaneTargets.set('p3', { engine: 'gemini' });
  m.emitir('p3', 'tool-start', { id: 'r2', mudanca: mud('/srv/app/a.js') });
  m.ctx.claudeRemoto.set('p4', { host: 'vps' });
  m.emitir('p4', 'tool-start', { id: 'r3', mudanca: mud('/srv/app/a.js') });
  for (const p of ['p2', 'p3', 'p4']) assert.equal(m.registro().has(p), false, p);
});

test('main: id inventado e pedido torto recusam; antes/depois/caminho vindos da tela sao ignorados', async () => {
  const { MOTIVOS } = D();
  const m = mainFalso();
  const pasta = pastaTemp();
  const arq = path.join(pasta, 'a.txt');
  const outro = path.join(pasta, 'outro.txt');
  fs.writeFileSync(arq, 'valor antigo\n');
  fs.writeFileSync(outro, 'nao pode mexer\n');
  editDoClaude(m, arq, { old_string: 'valor antigo', new_string: 'valor novo' }, 'valor novo\n');
  for (const pedido of [{ paneId: 'p1', id: 'toolu_inventado' }, { paneId: 'p9', id: 't1' }, { paneId: 'p1' }, { id: 't1' },
    { paneId: 'p1', id: 1 }, null, 'p1:t1']) {
    const r = await m.desfazer(pedido);
    assert.equal(r.ok, false, JSON.stringify(pedido));
    assert.equal(r.erro, MOTIVOS.sumiu);
  }
  // a tela tenta mandar o que desfazer: o main usa so' o registro dele
  const r = await m.desfazer({ paneId: 'p1', id: 't1', path: outro, antes: 'MALICIA', depois: 'nao pode mexer', arquivo: outro });
  assert.equal(r.ok, true, r.erro);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'valor antigo\n');
  assert.equal(fs.readFileSync(outro, 'utf8'), 'nao pode mexer\n', 'o outro arquivo nao foi tocado');
  // desfazer de novo: ja foi
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).erro, MOTIVOS.desfeita);
});

test('main: painel trabalhando recusa (Claude pelo vigiaTurno, ACP pelo busy/turn-end)', async () => {
  const { MOTIVOS } = D();
  const emTurno = new Set(['p1']);
  const m = mainFalso({ emTurno });
  const arq = path.join(pastaTemp(), 'a.txt');
  fs.writeFileSync(arq, 'x\n');
  editDoClaude(m, arq, { old_string: 'x', new_string: 'y' }, 'y\n');
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).erro, MOTIVOS.trabalhando);
  emTurno.clear();
  m.emitir('p1', 'busy', {});
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).erro, MOTIVOS.trabalhando);
  m.emitir('p1', 'turn-end', {});
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'x\n');
  m.emitir('p1', 'busy', {});
  m.emitir('p1', 'engine-down', {});
  assert.equal(m.emTrabalho().has('p1'), false, 'motor que caiu nao esta trabalhando');
});

test('main: write-grande, write-incerto e "trocar todas" recusam sem tocar o disco', async () => {
  const { MOTIVOS } = D();
  const esp = fsEspiao();
  const m = mainFalso({ fs: esp.fs });
  const arq = path.join(pastaTemp(), 'a.txt');
  fs.writeFileSync(arq, 'y\ny\n');
  const todas = m.capturar('Edit', { file_path: arq, old_string: 'x', new_string: 'y', replace_all: true });
  assert.equal(todas.todas, true, 'a captura do Edit traz o replace_all');
  feito(m, 'p1', 'todas', todas);
  feito(m, 'p1', 'grande', { path: arq, tipo: 'write-grande', depois: 'y', bytes: 200000 });
  feito(m, 'p1', 'incerto', { path: arq, tipo: 'write-incerto', antes: '', depois: 'y\ny\n' });
  esp.chamadas.length = 0;
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'todas' })).erro, MOTIVOS.todas);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'grande' })).erro, MOTIVOS.grande);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'incerto' })).erro, MOTIVOS.incerto);
  assert.deepEqual(esp.chamadas, []);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'y\ny\n');
});

test('main: arquivo aberto em outro programa (EBUSY/EPERM) da o recado do brief e nada muda', async () => {
  const { MOTIVOS } = D();
  for (const code of ['EBUSY', 'EPERM']) {
    const trocas = { renameSync: () => { const e = new Error(code + ': resource busy or locked, rename'); e.code = code; throw e; } };
    const m = mainFalso({ fs: fsEspiao(trocas).fs });
    const pasta = pastaTemp();
    const arq = path.join(pasta, 'planilha.csv');
    fs.writeFileSync(arq, 'a;b\n1;2\n');
    editDoClaude(m, arq, { old_string: '1;2', new_string: '3;4' }, 'a;b\n3;4\n');
    const r = await m.desfazer({ paneId: 'p1', id: 't1' });
    assert.equal(r.ok, false);
    assert.equal(r.erro, MOTIVOS.aberto);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'a;b\n3;4\n', code + ': o arquivo ficou como estava');
    assert.deepEqual(fs.readdirSync(pasta), ['planilha.csv'], code + ': o temporario foi apagado');
    // fechou o programa: agora vai (o registro nao ficou preso em "desfazendo")
    delete trocas.renameSync;
    const r2 = await m.desfazer({ paneId: 'p1', id: 't1' });
    assert.equal(r2.ok, true, r2.erro);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'a;b\n1;2\n');
  }
});

// (o temporario herda o "somente leitura"; quem limpa e' o unlink do Node, que no Windows tira a marca antes de apagar)
test('main: Windows, arquivo que virou somente leitura depois da IA: recusa e nao deixa temporario', async (t) => {
  if (!EH_WIN) { t.skip('so no Windows: fora dele o rename troca arquivo somente leitura'); return; }
  const m = mainFalso();
  const pasta = pastaTemp();
  const arq = path.join(pasta, 'trancado.txt');
  fs.writeFileSync(arq, 'velho\n');
  editDoClaude(m, arq, { old_string: 'velho', new_string: 'novo' }, 'novo\n');
  fs.chmodSync(arq, 0o444);
  try {
    const r = await m.desfazer({ paneId: 'p1', id: 't1' });
    assert.equal(r.ok, false);
    assert.equal(r.erro, D().MOTIVOS.aberto);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'novo\n');
    assert.deepEqual(fs.readdirSync(pasta), ['trancado.txt'], 'o temporario foi apagado');
  } finally { fs.chmodSync(arq, 0o666); }
});

test('main: Write so desfaz se o antes foi lido antes de o motor gravar (mexido no turno, vazio ou sem turno: nao)', async () => {
  // revisao 1: sem cartao de permissao (auto, auto-edit, sem pedir permissao, regra "allow") o CLI grava sem
  // esperar o main; a leitura do tool-start pode pegar o arquivo ja' gravado, truncado ou pela metade
  const { MOTIVOS } = D();
  const pasta = pastaTemp();
  const writeDoClaude = (m, arq, content, id) => {
    const mudanca = m.capturar('Write', { file_path: arq, content });
    m.emitir('p1', 'tool-start', { id, name: 'Write', arg: arq, mudanca });
    fs.writeFileSync(arq, content);
    m.emitir('p1', 'tool-end', { id, output: 'ok', error: false });
    return mudanca;
  };
  // lido antes da gravacao (arquivo sem mexida desde antes do turno): desfaz como antes
  let m = mainFalso();
  let arq = path.join(pasta, 'antigo.txt');
  fs.writeFileSync(arq, 'de antes do turno\n');
  envelhecer(arq);
  assert.equal(writeDoClaude(m, arq, 'da IA\n', 'w1').antesInexato, undefined);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'w1' })).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'de antes do turno\n');
  // mexido dentro deste turno: o que o main leu pode ja' ser o da IA. Nao desfaz (nada de gravar o arquivo "de antes" errado)
  arq = path.join(pasta, 'no-turno.txt');
  fs.writeFileSync(arq, 'metade do que a IA escreve');   // mtime agora: depois do comeco do turno
  assert.equal(writeDoClaude(m, arq, 'metade do que a IA escreve, inteiro\n', 'w2').antesInexato, true);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'w2' })).erro, MOTIVOS.inexato);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'metade do que a IA escreve, inteiro\n');
  // arquivo que existe e le 0 bytes (o motor truncou e ainda nao escreveu): nao desfaz, nunca grava vazio
  arq = path.join(pasta, 'vazio.txt');
  fs.writeFileSync(arq, '');
  envelhecer(arq);
  assert.equal(writeDoClaude(m, arq, 'conteudo\n', 'w3').antesInexato, true);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'w3' })).erro, MOTIVOS.inexato);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'conteudo\n');
  // sem turno conhecido (nunca ligou): nao da' pra saber se a leitura veio antes
  m = mainFalso({ inicio: 0 });
  arq = path.join(pasta, 'sem-turno.txt');
  fs.writeFileSync(arq, 'x\n');
  envelhecer(arq);
  assert.equal(writeDoClaude(m, arq, 'y\n', 'w4').antesInexato, true);
});

test('quedas: inicioDoTurno guarda o comeco do turno do painel (e o do ultimo, depois do fim)', () => {
  const quedas = require('../src/quedas');
  const v = quedas.criarVigiaDeTurno({ registrar: () => {} });
  assert.equal(v.inicioDoTurno('p1'), 0, 'nunca ligou');
  const antes = Date.now();
  v.ligar('p1');
  const inicio = v.inicioDoTurno('p1');
  assert.ok(inicio >= antes && inicio <= Date.now());
  v.passar('p1', 'turn-end', {});
  assert.equal(v.esta('p1'), false);
  assert.equal(v.inicioDoTurno('p1'), inicio, 'o robo em segundo plano depois do fim compara com o ultimo turno');
  v.desligar('p1');
  assert.equal(v.inicioDoTurno('p1'), inicio);
  assert.equal(v.inicioDoTurno('p2'), 0, 'por painel');
  v.esquecer('p1');
  assert.equal(v.inicioDoTurno('p1'), 0);
});

test('main: arquivo acima de 5 MB e arquivo que nao e UTF-8 recusam e ficam intactos', async () => {
  const { MOTIVOS } = D();
  const pasta = pastaTemp();
  let m = mainFalso();
  let arq = path.join(pasta, 'grande.log');
  fs.writeFileSync(arq, 'topo novo\n' + 'x'.repeat(5 * 1024 * 1024));
  feito(m, 'p1', 'g', { path: arq, tipo: 'edit', antes: 'topo velho', depois: 'topo novo', todas: false });
  let antes = fs.statSync(arq).size;
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'g' })).erro, MOTIVOS.grandeDemais);
  assert.equal(fs.statSync(arq).size, antes);
  // Latin-1 (Windows-1252): ler como UTF-8 e gravar de volta estragaria os acentos do resto
  m = mainFalso();
  arq = path.join(pasta, 'velho.bat');
  const latin = Buffer.from([0x72, 0x65, 0x6D, 0x20, 0x61, 0xE7, 0xE3, 0x6F, 0x0D, 0x0A, 0x65, 0x63, 0x68, 0x6F, 0x20, 0x6E, 0x6F, 0x76, 0x6F, 0x0D, 0x0A]);
  fs.writeFileSync(arq, latin);
  feito(m, 'p1', 'l', { path: arq, tipo: 'edit', antes: 'echo velho', depois: 'echo novo', todas: false });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'l' })).erro, MOTIVOS.naoUtf8);
  assert.ok(bytes(arq).equals(latin));
  // Write por cima de arquivo que nao era UTF-8: o antes lido nao e' fiel, nao volta
  m = mainFalso();
  arq = path.join(pasta, 'config.ini');
  fs.writeFileSync(arq, latin);
  const mudanca = m.capturar('Write', { file_path: arq, content: 'novo\n' });
  assert.equal(mudanca.antesInexato, true);
  fs.writeFileSync(arq, 'novo\n');
  feito(m, 'p1', 'w', mudanca);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'w' })).erro, MOTIVOS.inexato);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'novo\n');
  // arquivo que sumiu
  m = mainFalso();
  feito(m, 'p1', 's', { path: path.join(pasta, 'sumiu.txt'), tipo: 'edit', antes: 'a', depois: 'b', todas: false });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 's' })).erro, MOTIVOS.naoExiste);
});

test('main: passo com erro, negado ou que nao terminou recusa sem tocar o disco; o diff tardio do ACP herda o fim', async () => {
  const { MOTIVOS } = D();
  const esp = fsEspiao();
  const m = mainFalso({ fs: esp.fs });
  const pasta = pastaTemp();
  const arq = path.join(pasta, 'a.txt');
  // o arquivo por acaso tem o texto "novo" (a IA nunca o gravou: o Edit foi negado)
  fs.writeFileSync(arq, 'texto seu com novo no meio\n');
  const mud = { path: arq, tipo: 'edit', antes: 'velho', depois: 'novo', todas: false };
  m.emitir('p1', 'tool-start', { id: 'negado', mudanca: mud });
  m.emitir('p1', 'tool-end', { id: 'negado', output: 'The user doesn\'t want to proceed with this tool use.', error: true });
  m.emitir('p1', 'tool-start', { id: 'aberto', mudanca: mud });   // o motor caiu antes do fim
  esp.chamadas.length = 0;
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'negado' })).erro, MOTIVOS.passoErro);
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'aberto' })).erro, MOTIVOS.passoAberto);
  assert.deepEqual(esp.chamadas, [], 'recusou sem tocar no disco');
  assert.equal(fs.readFileSync(arq, 'utf8'), 'texto seu com novo no meio\n');
  // um segundo tool-end nao troca o primeiro
  m.emitir('p1', 'tool-end', { id: 'negado', output: 'ok', error: false });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'negado' })).erro, MOTIVOS.passoErro);
  // ACP: o passo termina e o diff chega DEPOIS (tool-mudanca); o fim ok vale pra ele
  fs.writeFileSync(arq, 'a\nnovo\n');
  m.emitir('p2', 'tool-start', { id: 'acp1', name: 'Edit', arg: arq, mudanca: null });
  m.emitir('p2', 'tool-end', { id: 'acp1', output: '', error: false });
  m.emitir('p2', 'tool-mudanca', { id: 'acp1', mudanca: mud });
  assert.equal(m.registro().get('p2').itens.get('acp1').fim, 'ok');
  const r = await m.desfazer({ paneId: 'p2', id: 'acp1' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'a\nvelho\n');
  // ...e o que falhou tambem: diff tardio de um passo com erro nao desfaz
  m.emitir('p2', 'tool-start', { id: 'acp2', name: 'Edit', arg: arq, mudanca: null });
  m.emitir('p2', 'tool-end', { id: 'acp2', output: 'falhou', error: true });
  m.emitir('p2', 'tool-mudanca', { id: 'acp2', mudanca: { ...mud, antes: 'b', depois: 'velho' } });
  assert.equal((await m.desfazer({ paneId: 'p2', id: 'acp2' })).erro, MOTIVOS.passoErro);
});

test('main: link fisico recusa com recado proprio e nenhum dos nomes muda', async (t) => {
  // revisao 1: antes gravava no lugar (pra nao quebrar o link), mas gravar no lugar nao e' atomico:
  // disco cheio ou queda no meio deixavam o arquivo cortado. Agora recusa.
  const pasta = pastaTemp();
  const arq = path.join(pasta, 'a.txt');
  const par = path.join(pasta, 'b.txt');
  fs.writeFileSync(arq, 'velho\n');
  try { fs.linkSync(arq, par); } catch (e) { t.skip('sem link fisico aqui: ' + e.code); return; }
  const esp = fsEspiao();
  const m = mainFalso({ fs: esp.fs });
  editDoClaude(m, arq, { old_string: 'velho', new_string: 'novo' }, 'novo\n');
  assert.equal(fs.readFileSync(par, 'utf8'), 'novo\n', 'o par ve a edicao da IA');
  esp.chamadas.length = 0;
  const r = await m.desfazer({ paneId: 'p1', id: 't1' });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Este arquivo tem outro nome apontando pra ele (link físico). Desfaça pelo seu editor.');
  assert.equal(r.erro, D().MOTIVOS.linkFisico);
  assert.ok(!esp.chamadas.some((k) => /write|rename|unlink|trash/i.test(k)), 'nada gravado: ' + esp.chamadas.join(','));
  assert.equal(fs.readFileSync(arq, 'utf8'), 'novo\n');
  assert.equal(fs.readFileSync(par, 'utf8'), 'novo\n');
  assert.deepEqual(fs.readdirSync(pasta).sort(), ['a.txt', 'b.txt'], 'nenhum temporario');
});

test('main: atalho (symlink) desfaz no arquivo de verdade e o atalho continua atalho', async (t) => {
  const pasta = pastaTemp();
  const real = path.join(pasta, 'real.txt');
  const atalho = path.join(pasta, 'atalho.txt');
  fs.writeFileSync(real, 'velho\n');
  try { fs.symlinkSync(real, atalho, 'file'); } catch (e) { t.skip('sem symlink aqui: ' + e.code); return; }
  const m = mainFalso();
  editDoClaude(m, atalho, { old_string: 'velho', new_string: 'novo' }, 'novo\n');
  assert.equal((await m.desfazer({ paneId: 'p1', id: 't1' })).ok, true);
  assert.equal(fs.readFileSync(real, 'utf8'), 'velho\n');
  assert.equal(fs.lstatSync(atalho).isSymbolicLink(), true);
});

test('main: a captura do Edit/MultiEdit traz "todas" e o total; a do Write marca o antes que nao e UTF-8', () => {
  const m = mainFalso();
  const e = m.capturar('Edit', { file_path: 'C:\\p\\a.txt', old_string: 'a', new_string: 'b' });
  assert.equal(e.todas, false);
  assert.equal(e.tipo, 'edit');
  const edits = Array.from({ length: 25 }, (_, i) => ({ old_string: 'a' + i, new_string: 'b' + i }));
  const multi = m.capturar('MultiEdit', { file_path: 'C:\\p\\a.txt', edits });
  assert.equal(multi.partes.length, 20, 'a tela continua recebendo no maximo 20 partes');
  assert.equal(multi.total, 25, 'mas o desfazer sabe que a lista veio cortada');
  assert.equal(multi.todas, false);
  const comTodas = m.capturar('MultiEdit', { file_path: 'C:\\p\\a.txt', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd', replace_all: true }] });
  assert.equal(comTodas.todas, true);
  assert.equal(D().planejarDesfazer('b d', D().daMudancaEmitida(multi)).codigo, 'incompleta');
  const arq = path.join(pastaTemp(), 'utf8.txt');
  fs.writeFileSync(arq, 'ação\n');
  envelhecer(arq);   // sem mexida desde antes do turno: so' o tamanho diferente abaixo pode marcar
  assert.equal(m.capturar('Write', { file_path: arq, content: 'x' }).antesInexato, undefined, 'UTF-8 valido nao ganha a marca');
  // o arquivo mudou de tamanho entre o stat e a leitura (a IA gravando ao mesmo tempo): o antes nao e' fiel
  const correndo = mainFalso({ fs: fsEspiao({ statSync: (p, ...r) => {
    const s = fs.statSync(p, ...r);
    return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { size: s.size + 7 });
  } }).fs });
  const w = correndo.capturar('Write', { file_path: arq, content: 'x' });
  assert.equal(w.tipo, 'write');
  assert.equal(w.antesInexato, true);
});

test('main: registro com teto de 300 por painel, o primeiro aviso do passo vale e o tool-mudanca do ACP entra', () => {
  const m = mainFalso();
  for (let i = 0; i < 305; i++) m.emitir('p1', 'tool-start', { id: 't' + i, mudanca: { path: 'C:\\p\\a.txt', tipo: 'edit', antes: 'a' + i, depois: 'b' + i } });
  const itens = m.registro().get('p1').itens;
  assert.equal(itens.size, 300);
  assert.equal(itens.has('t0'), false, 'o mais velho saiu');
  assert.equal(itens.has('t304'), true);
  // passo sem mudanca nao vira registro; o diff tardio do ACP vira
  m.emitir('p2', 'tool-start', { id: 'x', name: 'Bash', arg: 'ls', mudanca: null });
  assert.equal(m.registro().get('p2').itens.has('x'), false);
  m.emitir('p2', 'tool-mudanca', { id: 'x', mudanca: { path: 'C:\\p\\c.txt', tipo: 'write-novo', antes: '', depois: 'oi' } });
  assert.equal(m.registro().get('p2').itens.get('x').tipo, 'write-novo');
  // o main guarda uma COPIA: mexer no objeto que foi pra tela nao muda o registro
  const mud = { path: 'C:\\p\\d.txt', tipo: 'edit', antes: 'a', depois: 'b' };
  m.emitir('p2', 'tool-start', { id: 'y', mudanca: mud });
  mud.depois = 'OUTRA COISA'; mud.path = 'C:\\Windows\\win.ini';
  const guardado = m.registro().get('p2').itens.get('y');
  assert.equal(guardado.path, 'C:\\p\\d.txt');
  assert.equal(guardado.mudanca.partes[0].depois, 'b');
  // os ids vistos sem mudanca (Bash, Read...) ficam so' pra achar repeticao e pro diff tardio, com o mesmo teto
  // (revisao 1: o mapa "fins" virou "vistos", que guarda tambem o tool-start sem mudanca)
  for (let i = 0; i < 400; i++) m.emitir('p3', 'tool-end', { id: 'b' + i, output: '', error: false });
  assert.ok(m.registro().get('p3').vistos.size <= 300, 'vistos: ' + m.registro().get('p3').vistos.size);
});

test('main: id repetido no mesmo painel nao desfaz nenhum dos dois passos (o registro e a tela achariam passos diferentes)', async () => {
  const { MOTIVOS } = D();
  const esp = fsEspiao();
  const m = mainFalso({ fs: esp.fs });
  const pasta = pastaTemp();
  const arq = path.join(pasta, 'a.txt');
  fs.writeFileSync(arq, 'um\ndois\n');
  const mud = (antes, depois) => ({ path: arq, tipo: 'edit', antes, depois, todas: false });
  // dois tool-start com mudanca e o mesmo id
  feito(m, 'p1', 'dup', mud('x', 'um'));
  m.emitir('p1', 'tool-start', { id: 'dup', mudanca: mud('y', 'dois') });
  m.emitir('p1', 'tool-end', { id: 'dup', output: 'ok', error: false });
  // um segundo diff (tool-mudanca) pra um passo que ja tinha mudanca
  feito(m, 'p1', 'dois-diffs', mud('x', 'um'));
  m.emitir('p1', 'tool-mudanca', { id: 'dois-diffs', mudanca: mud('y', 'dois') });
  // um tool-start novo pra um id que ja tinha passado (sem mudanca) e terminado
  m.emitir('p1', 'tool-start', { id: 'velho', name: 'Bash', arg: 'ls', mudanca: null });
  m.emitir('p1', 'tool-end', { id: 'velho', output: '', error: false });
  m.emitir('p1', 'tool-start', { id: 'velho', name: 'Edit', arg: arq, mudanca: mud('x', 'um') });
  m.emitir('p1', 'tool-end', { id: 'velho', output: 'ok', error: false });
  // ...e um tool-start novo pra um id que ainda estava em andamento, sem mudanca
  m.emitir('p1', 'tool-start', { id: 'andando', name: 'Bash', arg: 'ls', mudanca: null });
  m.emitir('p1', 'tool-start', { id: 'andando', name: 'Edit', arg: arq, mudanca: mud('x', 'um') });
  m.emitir('p1', 'tool-end', { id: 'andando', output: 'ok', error: false });
  esp.chamadas.length = 0;
  for (const id of ['dup', 'dois-diffs', 'velho', 'andando']) {
    assert.equal((await m.desfazer({ paneId: 'p1', id })).erro, MOTIVOS.idRepetido, id);
    assert.equal(m.registro().get('p1').itens.get(id).mudanca, undefined, id + ': nada guardado pra desfazer');
  }
  assert.deepEqual(esp.chamadas, [], 'recusou sem tocar no disco');
  assert.equal(fs.readFileSync(arq, 'utf8'), 'um\ndois\n');
  // repetido continua repetido (um terceiro aviso nao ressuscita)
  m.emitir('p1', 'tool-mudanca', { id: 'dup', mudanca: mud('x', 'um') });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'dup' })).erro, MOTIVOS.idRepetido);
  // o diff tardio do ACP (tool-start sem mudanca, depois tool-mudanca) NAO e' repeticao
  m.emitir('p1', 'tool-start', { id: 'tardio', name: 'Edit', arg: arq, mudanca: null });
  m.emitir('p1', 'tool-mudanca', { id: 'tardio', mudanca: mud('x', 'um') });
  m.emitir('p1', 'tool-end', { id: 'tardio', output: 'ok', error: false });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'tardio' })).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'x\ndois\n');
});

test('main: passo do ACP com varios diffs (varios arquivos) nao desfaz', async () => {
  const { MOTIVOS } = D();
  const m = mainFalso();
  const arq = path.join(pastaTemp(), 'a.txt');
  fs.writeFileSync(arq, 'b\n');
  feito(m, 'p1', 'varios', { path: arq, tipo: 'edit', antes: 'a', depois: 'b', varios: true });
  assert.equal((await m.desfazer({ paneId: 'p1', id: 'varios' })).erro, MOTIVOS.varios);
  assert.equal(D().planejarDesfazer('b', D().daMudancaEmitida({ tipo: 'edit', antes: 'a', depois: 'b', varios: true })).codigo, 'varios');
  assert.equal(fs.readFileSync(arq, 'utf8'), 'b\n');
});

test('main: registro com teto de letras por painel (Writes grandes nao seguram memoria sem fim)', () => {
  const m = mainFalso();
  const grande = 'x'.repeat(100 * 1024);
  for (let i = 0; i < 300; i++) m.emitir('p1', 'tool-start', { id: 'w' + i, mudanca: { path: 'C:\\p\\a.txt', tipo: 'write', antes: grande, depois: grande + i } });
  const doPainel = m.registro().get('p1');
  const limite = vm.runInContext('LETRAS_POR_PAINEL', m.ctx);
  assert.ok(doPainel.letras <= limite, doPainel.letras + ' <= ' + limite);
  assert.ok(doPainel.itens.size < 300 && doPainel.itens.size > 10, 'os mais novos ficam: ' + doPainel.itens.size);
  assert.equal(doPainel.itens.has('w299'), true);
});

test('main: emit guarda a mudanca que vai pra tela, nao a do debate, e nunca quebra se o registro falhar', () => {
  const enviados = [];
  const debateListeners = new Map();
  const m = mainFalso();
  Object.assign(m.ctx, {
    vigiaTurno: { passar: (_p, _k, d) => d, esta: () => false },
    debateListeners, codex: { paneTurn: new Map() },
    win: { isDestroyed: () => false, webContents: { send: (canal, ev) => enviados.push({ canal, ...ev }) } },
  });
  vm.runInContext(pegarBloco(MAIN, 'function emit('), m.ctx);
  const mudanca = { path: 'C:\\p\\a.txt', tipo: 'edit', antes: 'a', depois: 'b' };
  m.ctx.emit('p1', 'tool-start', { id: 't1', name: 'Edit', arg: 'a.txt', mudanca });
  assert.equal(m.registro().get('p1').itens.has('t1'), true);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].mudanca, mudanca, 'a tela recebe a mudanca igual');
  const doDebate = [];
  debateListeners.set('pd', (ev) => doDebate.push(ev));
  m.ctx.emit('pd', 'tool-start', { id: 't2', mudanca });
  assert.equal(doDebate.length, 1);
  assert.equal(m.registro().has('pd'), false, 'o que vai pro debate nao aparece na tela: nao se desfaz daqui');
  m.ctx.guardarMudancaEmitida = () => { throw new Error('bug no registro'); };
  m.ctx.emit('p1', 'text-final', { id: 'm1', text: 'oi' });
  assert.equal(enviados.at(-1).text, 'oi', 'o evento chega na tela mesmo com o registro quebrado');
});

/* revisao 1 (decisao do controlador, acima do "limpa no pane:stop" do brief): o pane:stop roda no fim de todo
   turno numa aba de fundo, na troca de aba e na troca de conta/pasta. Limpando em toda parada, o turno que
   acabou no fundo nunca tinha "Desfazer" quando o Hugo voltava pra aba. Agora a parada comum so' tira o
   "trabalhando"; o registro so' e' esquecido quando a tela avisa que o painel fechou ou a conversa trocou
   (esquecerMudancas: true). Este teste antes provava a limpeza em TODA parada. */
test('main: pane:stop comum mantem o que dava pra desfazer; fechar o painel ou trocar de conversa esquece (local e remoto)', async () => {
  const m = mainFalso();
  const noop = () => {};
  const remotos = [];
  Object.assign(m.ctx, {
    vigiaTurno: { desligar: noop, esta: () => false },
    remoteEngines: { stop: async (id) => { remotos.push(id); return true; } },
    acp: { parar: noop, responderPermissao: noop }, autoLiberadas: new Map(), ehCli: () => false, cliParar: noop, claudeStop: noop,
    observabilidade: { encerrarPainel: noop },
    codex: { paneToThread: new Map(), paneTurn: new Map(), paneErrors: new Map(), paneMsgId: new Map(), threadToPane: new Map() },
    codexReq: async () => ({}), codexReply: noop, proto: {}, pendingApprovals: new Map(), descartarPerguntasCodex: noop,
  });
  let parar = null;
  m.ctx.ipcMain = { handle: (canal, fn) => { if (canal === 'pane:stop') parar = fn; } };
  vm.runInContext(recorteDoCanal('pane:stop'), m.ctx);
  const mud = { path: 'C:\\p\\a.txt', tipo: 'edit', antes: 'a', depois: 'b' };
  m.emitir('p1', 'tool-start', { id: 't1', mudanca: mud });
  m.emitir('p1', 'busy', {});
  m.emitir('p2', 'tool-start', { id: 't1', mudanca: mud });
  // parada comum (fim de turno no fundo, troca de aba, conta, modelo, modo): o registro fica
  await parar({}, { paneId: 'p1', engine: 'claude' });
  assert.equal(m.registro().get('p1').itens.has('t1'), true, 'parada comum mantem o desfazer');
  assert.equal(m.emTrabalho().has('p1'), false, 'parou: nao esta mais trabalhando');
  // fechou o painel ou trocou a conversa: esquece
  await parar({}, { paneId: 'p1', engine: 'claude', esquecerMudancas: true });
  assert.equal(m.registro().has('p1'), false);
  assert.equal(m.registro().has('p2'), true, 'so o painel que parou');
  // so' o true de verdade esquece
  await parar({}, { paneId: 'p2', engine: 'claude', esquecerMudancas: 'sim' });
  assert.equal(m.registro().has('p2'), true);
  // painel remoto (o pane:stop sai cedo pro remoteEngines): o mesmo, antes de sair
  m.ctx.remotePaneTargets.set('p2', { engine: 'codex' });
  m.emitir('p2', 'busy', {});
  await parar({}, { paneId: 'p2', engine: 'codex' });
  assert.deepEqual(remotos, ['p2']);
  assert.equal(m.emTrabalho().has('p2'), false);
  await parar({}, { paneId: 'p2', engine: 'codex', esquecerMudancas: true });
  assert.equal(m.registro().has('p2'), false);
});

/* ---------- ACP: geracao no id do passo e passo com varios diffs (revisao 1) ---------- */
// processo falso do agente (molde de test/auditoria-streams.test.js)
function agenteAcpFalso() {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const p = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
  p.sent = []; p.killed = false;
  p.answer = (id, result) => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  p.stdin.write = (linha) => {
    const msg = JSON.parse(linha); p.sent.push(msg);
    if (msg.method === 'initialize') queueMicrotask(() => p.answer(msg.id, { agentCapabilities: {} }));
    if (msg.method === 'session/new') queueMicrotask(() => p.answer(msg.id, { sessionId: 'sessao-' + p.sent.length }));
    return true;
  };
  p.kill = () => { p.killed = true; };
  p.atualizar = (update) => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update } }) + '\n');
  return p;
}
test('acp: o id do passo leva a geracao do agente (o mesmo toolCallId depois de religar e outro passo)', async () => {
  // o toolCallId do ACP so' e' unico dentro da sessao: sem a geracao, o passo de depois de religar (troca de aba,
  // conta, sessao nova) teria o mesmo id do de antes, e o desfazer de um desfaria o outro
  const temp = pastaTemp();
  const processos = [], eventos = [];
  const acp = require('../src/acp').criarAcp({ HOME: temp, pastaDados: () => temp, buildEnv: () => ({}),
    spawnBin: () => { const p = agenteAcpFalso(); processos.push(p); return p; }, matarProcesso: (p) => p.kill(),
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...data }), aoPedirPermissao() {}, aoCair() {}, aoFimDoTurno() {} });
  try {
    const passo = { sessionUpdate: 'tool_call', toolCallId: 'call_1', kind: 'edit', title: 'Editar a.txt', status: 'completed',
      content: [{ type: 'diff', path: 'C:/p/a.txt', oldText: 'a', newText: 'b' }] };
    await acp.start('p', { comando: 'falso --acp', cwd: temp });
    processos[0].atualizar(passo);
    await tiques();
    await acp.start('p', { comando: 'falso --acp', cwd: temp });   // religou
    processos[1].atualizar(passo);
    await tiques();
    const ids = eventos.filter((e) => e.kind === 'tool-start').map((e) => e.id);
    assert.equal(ids.length, 2, JSON.stringify(eventos.map((e) => e.kind)));
    assert.notEqual(ids[0], ids[1], 'dois passos, dois ids: ' + ids.join(' / '));
    assert.ok(ids.every((x) => x.endsWith('call_1')), ids.join(' / '));
    // o fim de cada passo sai com o id do seu passo
    assert.deepEqual(eventos.filter((e) => e.kind === 'tool-end').map((e) => e.id), ids);
    // e o registro do main guarda os dois, cada um com o seu fim, nenhum marcado como repetido
    const m = mainFalso();
    for (const e of eventos.filter((x) => /^tool-/.test(x.kind))) m.emitir('p', e.kind, e);
    const itens = m.registro().get('p').itens;
    assert.equal(itens.size, 2);
    for (const reg of itens.values()) { assert.equal(reg.repetido, undefined); assert.equal(reg.fim, 'ok'); }
  } finally { acp.pararTodos(); }
});

test('acp: passo com varios diffs marca "varios" (no mesmo aviso ou um diff diferente depois); o mesmo diff repetido nao', () => {
  const { traduzirUpdate } = require('../src/acp');
  const diff = (n, o, t) => ({ type: 'diff', path: 'C:/p/' + n, oldText: o, newText: t });
  // dois arquivos no mesmo aviso: a tela mostra o ultimo (como antes) e o desfazer nao vale
  let st = { ferramentas: new Map() };
  let ev = traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'edit', title: 'Editar', content: [diff('a.txt', 'a', 'A'), diff('b.txt', 'b', 'B')] });
  assert.equal(ev[0].kind, 'tool-start');
  assert.equal(ev[0].mudanca.path, 'C:/p/b.txt');
  assert.equal(ev[0].mudanca.varios, true);
  // um diff so': sem a marca
  st = { ferramentas: new Map() };
  ev = traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'c2', kind: 'edit', title: 'Editar', content: [diff('a.txt', 'a', 'A')] });
  assert.equal(ev[0].mudanca.varios, undefined);
  // o mesmo diff repetido no update (comum no fim do passo): nada novo
  ev = traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'completed', content: [diff('a.txt', 'a', 'A')] });
  assert.deepEqual(ev.map((e) => e.kind), ['tool-end']);
  // um diff DIFERENTE depois (outro arquivo ou o texto mudou): o passo vira "varios" (o main e a tela recusam)
  ev = traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', content: [diff('b.txt', 'b', 'B')] });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'tool-mudanca');
  assert.equal(ev[0].mudanca.varios, true);
  assert.equal(ev[0].mudanca.path, 'C:/p/a.txt', 'a tela continua mostrando o primeiro diff');
  // so' uma vez
  assert.deepEqual(traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', content: [diff('c.txt', 'c', 'C')] }), []);
  // passo ainda em andamento: o mesmo vale
  st = { ferramentas: new Map() };
  traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'c3', kind: 'edit', title: 'Editar', content: [diff('a.txt', 'a', 'A')] });
  ev = traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'c3', status: 'in_progress', content: [diff('a.txt', 'a', 'AA')] });
  assert.equal(ev.filter((e) => e.kind === 'tool-mudanca' && e.mudanca.varios).length, 1);
  // a mudanca "varios" no registro do main: recusa
  const m = mainFalso();
  m.emitir('p', 'tool-start', { id: 'c1', mudanca: { path: 'C:/p/b.txt', tipo: 'edit', antes: 'b', depois: 'B', varios: true } });
  m.emitir('p', 'tool-end', { id: 'c1', error: false });
  assert.equal(m.registro().get('p').itens.get('c1').mudanca.varios, true);
});

test('main: o canal existe no preload e manda so { paneId, id }', async () => {
  const linha = PRELOAD.split('\n').find((l) => /^\s*desfazerEdicao:/.test(l));
  assert.ok(linha, 'desfazerEdicao no preload');
  const invocados = [];
  const ctx = vm.createContext({ ipcRenderer: { invoke: (canal, o) => { invocados.push({ canal, o }); return Promise.resolve({ ok: true }); } } });
  const api = vm.runInContext('({' + linha.trim().replace(/,$/, '') + '})', ctx);
  await api.desfazerEdicao({ paneId: 'p1', id: 't1', antes: 'x', depois: 'y', path: 'C:\\Windows\\win.ini' });
  assert.equal(invocados.length, 1);
  assert.equal(invocados[0].canal, 'arquivo:desfazer');
  assert.deepEqual(Object.keys(invocados[0].o).sort(), ['id', 'paneId']);
  assert.equal(invocados[0].o.paneId, 'p1');
  assert.equal(invocados[0].o.id, 't1');
});

/* =====================================================================
   3) a tela (molde telaPassos() do "achado 16", test/auditoria1.test.js)
   ===================================================================== */
function recorte(nome) {
  for (const ass of ['async function ' + nome + '(', 'function ' + nome + '(']) {
    const i = APP.indexOf(ass);
    if (i < 0) continue;
    const corpo = APP.indexOf(') {', i);
    let nivel = 0;
    for (let k = corpo + 2; k < APP.length; k++) {
      if (APP[k] === '{') nivel++;
      else if (APP[k] === '}' && --nivel === 0) return APP.slice(i, k + 1);
    }
    throw new Error('nao fechei ' + nome);
  }
  throw new Error('nao achei no app.js: ' + nome);
}

const documento = { activeElement: null, hidden: false };
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.filhos = []; this.pai = null; this._texto = '';
    this._classes = []; this.attrs = {}; this.dataset = {}; this.style = {};
    this.title = ''; this.disabled = false; this.eventos = {};
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => { if (!eu._classes.includes(x)) eu._classes.push(x); }),
      remove: (...c) => { eu._classes = eu._classes.filter((x) => !c.includes(x)); },
      contains: (c) => eu._classes.includes(c),
      toggle: (c, f) => { const on = f === undefined ? !eu._classes.includes(c) : !!f; if (on) eu.classList.add(c); else eu.classList.remove(c); return on; },
    };
  }
  get children() { return this.filhos; }
  get parentElement() { return this.pai; }
  get firstChild() { return this.filhos[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  get textContent() { return this._texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.filhos = []; this._texto = String(v); }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  prepend(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.unshift(c); }
  insertBefore(c, ref) { if (c.pai) c.remove(); c.pai = this; const i = ref ? this.filhos.indexOf(ref) : -1; if (i < 0) this.filhos.push(c); else this.filhos.splice(i, 0, c); return c; }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.pai) if (x._casa(sel)) return x; return null; }
  addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
  emitir(n) {
    const ev = { target: this, parou: false, preventDefault() {}, stopPropagation() { this.parou = true; } };
    for (let x = this; x && !ev.parou; x = x.pai) for (const f of (x.eventos[n] || [])) f(ev);
    return ev;
  }
  _casa(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    const cls = sel.split('.').filter(Boolean);
    return sel.startsWith('.') ? cls.every((c) => this._classes.includes(c)) : this.tagName === sel.toUpperCase();
  }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  querySelectorAll(sel) {
    const at = /^\[data-([\w-]+)="(.*)"\]$/.exec(sel);
    if (at) return this.todos().filter((e) => e.dataset[at[1]] === at[2]);
    return this.todos().filter((e) => e._casa(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
documento.createElement = (t) => new El(t);

function telaPassos(opcoes) {
  const o = opcoes || {};
  const notas = [], chamadas = [];
  const h = { notas, chamadas, resposta: o.resposta || { ok: true }, soltar: null, parada: 0 };
  const api = {
    desfazerEdicao: (pedido) => {
      chamadas.push(pedido);
      if (!o.segurar) return Promise.resolve(h.resposta);
      return new Promise((r) => { h.soltar = () => r(h.resposta); });
    },
    paradaEm: () => h.parada,
  };
  const ctx = {
    ...globaisFalsos(), console, document: documento, window: { api },
    $: (sel, r) => (r ? r.querySelector(sel) : null),
    passo: (P, frase, id) => { const d = new El('div'); d.className = 'passo'; if (id) d.dataset.id = id; P.passosEl.appendChild(d); return d; },
    fraseDoPasso: (n) => n, passoPronto: () => {}, resumoDaMudanca: () => '+1',
    // o diff de verdade e' so' desenho: aqui basta a caixa .diff com uma linha
    elDiff: () => { const b = new El('div'); b.className = 'diff'; b.appendChild(new El('div')).className = 'df-l df-mais'; return b; },
    scroll: () => {}, mostrarPrintsDoPasso: () => {},
    remotoDoPane: (P) => P.remoto || null,
    note: (P, t, e) => notas.push({ t: String(t), e: !!e }),
  };
  vm.createContext(ctx);
  vm.runInContext(['acharPasso', 'toolStart', 'anexarMudancaAoPasso', 'toolEnd', 'mudancaDesfazivel', 'desfazerCabe', 'marcarPassoRepetido',
    'pintarDesfazer', 'desfazerMudanca'].map(recorte).join('\n'), ctx);
  h.ctx = ctx;
  h.painel = (extra) => ({ id: 'p1', busy: false, passosEl: new El('div'), passosSelados: [], mudancasTurno: [], ...(extra || {}) });
  h.passo = (P, id) => P.passosEl.querySelector('[data-id="' + id + '"]');
  h.abrirDiff = (P, id) => { h.passo(P, id).querySelector('.pa-diff').emitir('click'); return h.passo(P, id).querySelector('.diff'); };
  h.botao = (P, id) => h.passo(P, id).querySelector('.ck-df-desfazer');
  return h;
}
const MUD = { path: 'C:\\proj\\app.js', tipo: 'edit', antes: 'const pronto = false;', depois: 'const pronto = true;', todas: false };

test('tela: o botao so aparece no diff do passo depois do toolEnd ok (o toolEnd reavalia o diff aberto)', () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 't1', 'Edit', 'app.js', MUD);
  const diff = h.abrirDiff(P, 't1');
  assert.ok(diff, 'o diff abriu');
  assert.equal(h.botao(P, 't1'), null, 'passo em andamento: nada foi aplicado ainda');
  h.ctx.toolEnd(P, 't1', 'ok', false);
  const bt = h.botao(P, 't1');
  assert.ok(bt, 'passo terminou ok: o botao aparece no diff que ja estava aberto');
  assert.equal(bt.tagName, 'BUTTON');
  assert.equal(bt.getAttribute('type'), 'button');
  assert.equal(bt.textContent, 'Desfazer esta mudança');
  assert.equal(bt.disabled, false);
  assert.ok(diff.contains(bt), 'dentro do diff do passo');
  // fechar e abrir de novo: continua la', um so'
  h.passo(P, 't1').querySelector('.pa-diff').emitir('click');
  h.abrirDiff(P, 't1');
  assert.equal(h.passo(P, 't1').querySelectorAll('.ck-df-desfazer').length, 1);
});

test('tela: passo com erro nao tem botao (aberto antes ou depois do fim)', () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 't1', 'Edit', 'app.js', MUD);
  h.abrirDiff(P, 't1');
  h.ctx.toolEnd(P, 't1', 'String to replace not found in file.', true);
  assert.equal(h.botao(P, 't1'), null);
  h.ctx.toolStart(P, 't2', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 't2', 'The user doesn\'t want to proceed with this tool use.', true);
  h.abrirDiff(P, 't2');
  assert.equal(h.botao(P, 't2'), null, 'negado na permissao: nada foi aplicado');
});

test('tela: painel remoto, write-grande e write-incerto nao tem botao', () => {
  const h = telaPassos();
  const R = h.painel({ remoto: { host: 'vps' } });
  h.ctx.toolStart(R, 't1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(R, 't1', 'ok', false);
  h.abrirDiff(R, 't1');
  assert.equal(h.botao(R, 't1'), null, 'remoto: o arquivo e do servidor');
  const P = h.painel();
  h.ctx.toolStart(P, 'g', 'Write', 'a.bin', { path: 'C:\\p\\a.bin', tipo: 'write-grande', depois: 'x', bytes: 300000 });
  h.ctx.toolStart(P, 'i', 'Write', 'a.txt', { path: '\\\\srv\\p\\a.txt', tipo: 'write-incerto', antes: '', depois: 'x' });
  for (const id of ['g', 'i']) {
    h.ctx.toolEnd(P, id, 'ok', false);
    h.abrirDiff(P, id);
    assert.equal(h.botao(P, id), null, id);
  }
});

test('tela: mudanca que o main recusaria nao ganha botao (igual, todas, corte, depois vazio, MultiEdit cortado, antes inexato)', () => {
  const h = telaPassos();
  const P = h.painel();
  const casos = {
    igual: { ...MUD, depois: MUD.antes },
    todas: { ...MUD, todas: true },
    corte: { ...MUD, depois: 'x'.repeat(10) + CORTE },
    corteAntes: { ...MUD, antes: 'x'.repeat(10) + CORTE },
    vazio: { ...MUD, depois: '' },
    multiCortado: { path: MUD.path, tipo: 'multi', partes: [{ antes: 'a', depois: 'b' }], total: 21, todas: false },
    multiIgual: { path: MUD.path, tipo: 'multi', partes: [{ antes: 'a', depois: 'a' }], total: 1, todas: false },
    inexato: { path: MUD.path, tipo: 'write', antes: 'x', depois: 'y', antesInexato: true },
    semTipo: { path: MUD.path, antes: 'a', depois: 'b' },
    varios: { ...MUD, varios: true },   // revisao 1: passo do ACP com mais de um diff
  };
  for (const [id, mud] of Object.entries(casos)) {
    h.ctx.toolStart(P, id, 'Edit', 'app.js', mud);
    h.ctx.toolEnd(P, id, 'ok', false);
    h.abrirDiff(P, id);
    assert.equal(h.botao(P, id), null, id);
  }
  // os que valem: MultiEdit inteiro, Write e arquivo novo
  const bons = {
    multi: { path: MUD.path, tipo: 'multi', partes: [{ antes: 'a', depois: 'b' }, { antes: 'c', depois: 'c' }], total: 2, todas: false },
    write: { path: MUD.path, tipo: 'write', antes: 'velho', depois: 'novo' },
    novo: { path: MUD.path, tipo: 'write-novo', antes: '', depois: 'novo' },
  };
  for (const [id, mud] of Object.entries(bons)) {
    h.ctx.toolStart(P, id, 'Edit', 'app.js', mud);
    h.ctx.toolEnd(P, id, 'ok', false);
    h.abrirDiff(P, id);
    assert.ok(h.botao(P, id), id);
  }
});

test('tela: o diff tardio do ACP (tool-mudanca) tambem ganha o botao', () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 'a1', 'Edit', 'app.js', null);
  h.ctx.toolEnd(P, 'a1', 'ok', false);
  h.ctx.anexarMudancaAoPasso(P, 'a1', MUD);
  h.abrirDiff(P, 'a1');
  assert.ok(h.botao(P, 'a1'));
});

test('tela: o clique chama desfazerEdicao({ paneId, id }) e mostra Desfazendo… e Desfeita', async () => {
  const h = telaPassos({ segurar: true });
  const P = h.painel();
  h.ctx.toolStart(P, 'toolu_1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 'toolu_1', 'ok', false);
  h.abrirDiff(P, 'toolu_1');
  const bt = h.botao(P, 'toolu_1');
  const ev = bt.emitir('click');
  assert.equal(ev.parou, true, 'o clique nao escorre pro passo');
  await tiques();
  assert.equal(h.chamadas.length, 1);
  assert.deepEqual(Object.keys(h.chamadas[0]).sort(), ['id', 'paneId'], 'a tela manda SO paneId e id');
  assert.equal(h.chamadas[0].paneId, 'p1');
  assert.equal(h.chamadas[0].id, 'toolu_1');
  assert.equal(bt.textContent, 'Desfazendo…');
  assert.equal(bt.disabled, true);
  bt.emitir('click');   // clique de novo enquanto desfaz: nao manda outro
  await tiques();
  assert.equal(h.chamadas.length, 1);
  h.soltar();
  await tiques();
  assert.equal(bt.textContent, 'Desfeita');
  assert.equal(bt.disabled, true);
  assert.equal(h.passo(P, 'toolu_1').dataset.desfeita, '1');
  assert.deepEqual(h.notas, []);
  // fechar e abrir o diff: continua "Desfeita"
  h.passo(P, 'toolu_1').querySelector('.pa-diff').emitir('click');
  h.abrirDiff(P, 'toolu_1');
  assert.equal(h.botao(P, 'toolu_1').textContent, 'Desfeita');
  assert.equal(h.botao(P, 'toolu_1').disabled, true);
});

test('tela: recusa do main vira nota de erro e o botao volta', async () => {
  const h = telaPassos({ resposta: { ok: false, erro: 'O arquivo mudou depois desta mudança.' } });
  const P = h.painel();
  h.ctx.toolStart(P, 't1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 't1', 'ok', false);
  h.abrirDiff(P, 't1');
  h.botao(P, 't1').emitir('click');
  await tiques();
  assert.deepEqual(h.notas, [{ t: 'O arquivo mudou depois desta mudança.', e: true }]);
  assert.equal(h.botao(P, 't1').textContent, 'Desfazer esta mudança');
  assert.equal(h.botao(P, 't1').disabled, false);
  assert.equal(h.passo(P, 't1').dataset.desfeita, undefined);
  // o canal que falha (main fora do ar) tambem vira nota
  h.ctx.window.api.desfazerEdicao = () => Promise.reject(new Error('canal fechado'));
  h.botao(P, 't1').emitir('click');
  await tiques();
  assert.equal(h.notas.length, 2);
  assert.equal(h.notas[1].e, true);
  assert.equal(h.botao(P, 't1').disabled, false);
});

test('tela: painel trabalhando nao chama o main (o botao some pelo .pane.ocupado e o clique confere)', async () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 't1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 't1', 'ok', false);
  h.abrirDiff(P, 't1');
  P.busy = true;
  h.botao(P, 't1').emitir('click');
  await tiques();
  assert.equal(h.chamadas.length, 0);
  assert.equal(h.notas.length, 1);
  assert.match(h.notas[0].t, /Espere o agente terminar/);
  assert.equal(h.botao(P, 't1').textContent, 'Desfazer esta mudança');
  // o CSS esconde o botao enquanto o painel trabalha (a marca do setDot)
  assert.match(CSS, /\.ck-app \.pane\.ocupado \.ck-df-acoes\s*\{\s*display: none;/);
});

/* revisao 1 (decisao do controlador): antes o botao sumia com QUALQUER parada do motor (window.api.paradaEm),
   porque o main esquecia tudo no pane:stop. Agora a parada comum (fim de turno numa aba de fundo, troca de aba,
   conta, modelo) mantem o botao, igual ao main; so' fechar o painel ou trocar a conversa tira
   (P.geracaoDesfazer sobe junto com o esquecerMudancas). */
test('tela: parada comum do motor mantem o botao; conversa trocada tira', () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 't1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 't1', 'ok', false);
  h.parada = Date.now() + 1000;   // o motor parou depois da mudanca (fim de turno no fundo, troca de aba...)
  h.abrirDiff(P, 't1');
  assert.ok(h.botao(P, 't1'), 'parada comum: o botao fica');
  // a conversa trocou (ou o painel fechou): o main esqueceu, a tela tira o botao
  P.geracaoDesfazer = (P.geracaoDesfazer || 0) + 1;
  h.passo(P, 't1').querySelector('.pa-diff').emitir('click');
  h.abrirDiff(P, 't1');
  assert.equal(h.botao(P, 't1'), null);
  // passo da conversa nova: tem botao
  h.ctx.toolStart(P, 't2', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 't2', 'ok', false);
  h.abrirDiff(P, 't2');
  assert.ok(h.botao(P, 't2'));
});

test('tela: id repetido no painel tira o botao dos dois passos (e uma segunda mudanca no mesmo passo tambem)', () => {
  const h = telaPassos();
  const P = h.painel();
  h.ctx.toolStart(P, 'dup', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 'dup', 'ok', false);
  const velho = h.passo(P, 'dup');
  velho.querySelector('.pa-diff').emitir('click');
  assert.ok(velho.querySelector('.ck-df-desfazer'), 'antes da repeticao tinha botao');
  h.ctx.toolStart(P, 'dup', 'Edit', 'app.js', { ...MUD, antes: 'x', depois: 'y' });
  h.ctx.toolEnd(P, 'dup', 'ok', false);
  assert.equal(velho.querySelector('.ck-df-desfazer'), null, 'o diff aberto do passo velho perdeu o botao');
  const novos = P.passosEl.querySelectorAll('[data-id="dup"]');
  assert.equal(novos.length, 2);
  const novo = novos[1];
  novo.querySelector('.pa-diff').emitir('click');
  assert.equal(novo.querySelector('.ck-df-desfazer'), null, 'nem o passo novo');
  // segunda mudanca pro mesmo passo (diff tardio depois de outro diff)
  h.ctx.toolStart(P, 'dois', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 'dois', 'ok', false);
  const contadas = P.mudancasTurno.length;
  h.ctx.anexarMudancaAoPasso(P, 'dois', { ...MUD, varios: true });
  assert.equal(P.mudancasTurno.length, contadas, 'o "ver mudanças" do turno nao conta o passo duas vezes');
  h.abrirDiff(P, 'dois');
  assert.equal(h.botao(P, 'dois'), null);
  // passo sem repeticao continua com botao
  h.ctx.toolStart(P, 'unico', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(P, 'unico', 'ok', false);
  h.abrirDiff(P, 'unico');
  assert.ok(h.botao(P, 'unico'));
  // repeticao em OUTRO turno: a caixa do turno anterior ja' saiu do alcance do acharPasso
  const Q = h.painel();
  Q.chat = new El('div');
  Q.chat.appendChild(Q.passosEl);
  h.ctx.toolStart(Q, 'x1', 'Edit', 'app.js', MUD);
  h.ctx.toolEnd(Q, 'x1', 'ok', false);
  const velhoQ = h.passo(Q, 'x1');
  Q.passosEl = new El('div');   // fim do turno: caixa nova, a velha fica so' na conversa
  Q.chat.appendChild(Q.passosEl);
  h.ctx.toolStart(Q, 'x1', 'Edit', 'app.js', { ...MUD, antes: 'p', depois: 'q' });
  h.ctx.toolEnd(Q, 'x1', 'ok', false);
  velhoQ.querySelector('.pa-diff').emitir('click');
  assert.equal(velhoQ.querySelector('.ck-df-desfazer'), null, 'o passo do turno anterior perdeu o botao');
  const novoQ = Q.passosEl.querySelector('[data-id="x1"]');
  novoQ.querySelector('.pa-diff').emitir('click');
  assert.equal(novoQ.querySelector('.ck-df-desfazer'), null, 'e o novo nem ganhou');
});

test('tela: fechar o painel, conversa nova, abrir outra e apagar a conversa esquecem o desfazer; paradas comuns nao', () => {
  // quem fecha o painel ou troca a conversa manda esquecerMudancas: true e sobe a geracao do painel
  for (const nome of ['closePane', 'apagarAbaLocal', 'novaConversa', 'openSession', 'linhaConversa']) {
    const fonte = recorte(nome);
    assert.match(fonte, /paneStop\(\{[^}]*esquecerMudancas: true/, nome + ' manda esquecerMudancas');
    assert.match(fonte, /(\w+)\.geracaoDesfazer = \(\1\.geracaoDesfazer \|\| 0\) \+ 1/, nome + ' sobe a geracao');
  }
  // paradas comuns: o desfazer continua valendo
  for (const nome of ['guardarPaineisDaAba', 'trocarPastaDoPainel', 'trocarMotor', 'trocarEsforco', 'girarModo', 'mudarModoDoPainel',
    'trocarModeloDoPainel', 'alternarFallbackClaude', 'pararPaineisDaConta', 'aplicarWorktree']) {
    assert.doesNotMatch(recorte(nome), /esquecerMudancas|geracaoDesfazer/, nome);
  }
  const fimDoTurno = APP.slice(APP.indexOf("case 'turn-end':"), APP.indexOf("case 'engine-down':"));
  assert.match(fimDoTurno, /window\.api\.paneStop\(/, 'o fim de turno no fundo ainda para o motor');
  assert.doesNotMatch(fimDoTurno, /esquecerMudancas/, '...sem esquecer o desfazer');
  // e a tela nao usa mais o paradaEm pra decidir o botao
  assert.doesNotMatch(recorte('desfazerCabe'), /paradaEm/);
});

test('tela: o diff do cartao de permissao nunca ganha o botao (la nada foi aplicado)', () => {
  for (const nome of ['elDiff', 'desenharPermissao', 'showApproval']) {
    const fonte = recorte(nome);
    assert.doesNotMatch(fonte, /pintarDesfazer|ck-df-desfazer|desfazerEdicao/, nome);
  }
  // quem desenha o botao so e' chamado pelo passo: a funcao de cima de cada chamada
  const donoDe = (idx) => {
    const k = Math.max(APP.lastIndexOf('\nfunction ', idx), APP.lastIndexOf('\nasync function ', idx));
    return (/function (\w+)\(/.exec(APP.slice(k, k + 120)) || [])[1] || '?';
  };
  const chamadores = [...APP.matchAll(/(?<!function )pintarDesfazer\(/g)].map((mm) => donoDe(mm.index));
  assert.ok(chamadores.length >= 2, 'o passo chama');
  // (revisao 1: marcarPassoRepetido tambem repinta o diff aberto de um passo, pra TIRAR o botao)
  for (const c of chamadores) assert.ok(['anexarMudancaAoPasso', 'toolEnd', 'marcarPassoRepetido'].includes(c), 'pintarDesfazer chamado por ' + c);
});

/* =====================================================================
   4) CSS e previa
   ===================================================================== */
test('CSS: botao do desfazer so com variaveis de tema, tudo em .ck-app, sem travessao, antes do bloco do fim', () => {
  const ini = CSS.indexOf('/* ===== Desfazer esta mudança');
  assert.ok(ini > 0, 'bloco do desfazer no cockpit-ui.css');
  const fim = CSS.indexOf('/* =====', ini + 10);
  const bloco = CSS.slice(ini, fim);
  assert.ok(CSS.indexOf('/* ===== Tela baixa') > ini, 'antes do bloco que precisa ficar no fim');
  assert.match(bloco, /\.ck-app \.ck-df-desfazer\s*\{/);
  assert.match(bloco, /\.ck-app \.ck-df-desfazer:focus-visible\s*\{[^}]*var\(--ring-focus\)/);
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'nada de cor fixa');
  for (const sel of bloco.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}\n][^{}]*(?=\{)/gm) || []) {
    for (const s of sel.split(',')) assert.ok(s.trim().startsWith('.ck-app '), 'regra sem .ck-app: ' + s.trim());
  }
  assert.doesNotMatch(bloco, /—/, 'sem travessao');
  assert.doesNotMatch(bloco, /interpolate-size|corner-shape/, 'Electron 32 (Chromium 128) nao tem');
});

test('previa: o mock responde desfazerEdicao e a permissao de exemplo usa o formato de verdade (path)', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  const r = await win.api.desfazerEdicao({ paneId: 'p1', id: 'qa-edit-ok' });
  assert.equal(r.ok, true);
  assert.equal(win.__qa.missing.has('desfazerEdicao'), false);
  // a permissao de exemplo: path (formato do main), nao "arquivo"
  const i = FIXTURES.indexOf("kind:'approval'");
  assert.ok(i > 0);
  const aprov = FIXTURES.slice(i, FIXTURES.indexOf('});', i));
  assert.match(aprov, /mudanca:\{path:'/);
  assert.doesNotMatch(aprov, /mudanca:\{arquivo:/);
});

test('previa: ?cenario=desfazer tem um Edit que deu certo e um com erro', () => {
  const i = FIXTURES.indexOf("qa.fixture==='desfazer'");
  assert.ok(i > 0, 'cenario desfazer nas fixtures');
  const bloco = FIXTURES.slice(i, FIXTURES.indexOf('\n      }', i));
  const inicios = [...bloco.matchAll(/kind:'tool-start',id:'([^']+)',name:'Edit'[^\n]*mudanca:\{path:'[^']+',tipo:'edit'/g)].map((x) => x[1]);
  assert.equal(inicios.length, 2, bloco);
  const fins = Object.fromEntries([...bloco.matchAll(/kind:'tool-end',id:'([^']+)'[^\n]*error:(true|false)/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(inicios.map((id) => fins[id]).sort(), ['false', 'true']);
  assert.match(bloco, /kind:'busy'/);
  assert.match(bloco, /kind:'turn-end'/);
});

// Leva final: captura que falhou nunca transforma sobrescrita em criacao.
for (const operacao of ['readFileSync', 'statSync']) {
  test('main: arquivo visto + erro em ' + operacao + ' recusa sem mandar para Lixeira', async () => {
    const arq = path.join(pastaTemp(), 'existente.txt');
    fs.writeFileSync(arq, 'conteudo anterior');
    const esp = fsEspiao({ [operacao]: () => { throw Object.assign(new Error('preso'), { code: 'EPERM' }); } });
    const m = mainFalso({ fs: esp.fs });
    const mudanca = m.capturar('Write', { file_path: arq, content: 'conteudo novo' });
    assert.equal(mudanca.tipo, 'write-incerto');
    fs.writeFileSync(arq, 'conteudo novo');
    feito(m, 'p1', 'incerto', mudanca);
    esp.chamadas.length = 0;
    assert.equal((await m.desfazer({ paneId: 'p1', id: 'incerto' })).erro, D().MOTIVOS.incerto);
    assert.deepEqual(esp.chamadas, []);
    assert.deepEqual(m.lixeira, []);
    assert.equal(fs.readFileSync(arq, 'utf8'), 'conteudo novo');
  });
}
test('main: Write so e novo com ausencia confirmada; pasta e caminho desconhecido sao incertos', () => {
  const m = mainFalso();
  const pasta = pastaTemp();
  assert.equal(m.capturar('Write', { file_path: path.join(pasta, 'novo.txt'), content: 'x' }).tipo, 'write-novo');
  assert.equal(m.capturar('Write', { file_path: pasta, content: 'x' }).tipo, 'write-incerto');
  assert.equal(m.capturar('Write', { content: 'x' }).tipo, 'write-incerto');
  const falha = mainFalso({ fs: fsEspiao({ existsSync: () => { throw new Error('indisponivel'); } }).fs });
  assert.equal(falha.capturar('Write', { file_path: 'x', content: 'x' }).tipo, 'write-incerto');
});
test('ACP: oldText null em arquivo existente no tool_call e diff tardio nunca permitem Lixeira', async () => {
  const { traduzirUpdate } = require('../src/acp');
  const arq = path.join(pastaTemp(), 'existente.txt');
  fs.writeFileSync(arq, 'anterior');
  const diff = { type: 'diff', path: arq, oldText: null, newText: 'novo' };
  const st = {};
  const ev = traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'c', kind: 'edit', content: [diff] });
  assert.equal(ev.find(e => e.kind === 'tool-start').mudanca.tipo, 'write-incerto');
  const m = mainFalso();
  fs.writeFileSync(arq, 'novo');
  feito(m, 'p2', 'c', ev.find(e => e.kind === 'tool-start').mudanca);
  assert.equal((await m.desfazer({ paneId: 'p2', id: 'c' })).erro, D().MOTIVOS.incerto);
  assert.deepEqual(m.lixeira, []);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'novo');
  traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'tardio', kind: 'edit' });
  const tardio = traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'tardio', content: [diff] });
  assert.equal(tardio.find(e => e.kind === 'tool-mudanca').mudanca.tipo, 'write-incerto');
});

test('previa: tituloCancelar e assincrono, inofensivo e nao cai no stub ausente', async () => {
  const win = {};
  vm.runInNewContext(MOCK, { window: win, location: { search: '' }, URLSearchParams,
    setTimeout, queueMicrotask, console, addEventListener() {} });
  const resultado = win.api.tituloCancelar({ chave: 'qa-nome' });
  assert.equal(typeof resultado.then, 'function');
  assert.equal((await resultado).ok, true);
  assert.equal(win.__qa.missing.has('tituloCancelar'), false);
});
