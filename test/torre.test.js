'use strict';
/* Leva 41 (A2): Torre de controle. As pecas puras e o handler do main, extraidos
   do fonte de verdade -- o teste falha por bug, nao por andaime. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const app = lerFonte('renderer', 'app.js');
const main = lerFonte('main.js');
const css = lerFonte('renderer', 'style.css');
const collab = lerFonte('renderer', 'collaboration.js');
const obsFonte = lerFonte('cockpit-observability.js');

/* ---------- main: ipcMain.handle('agentes:claude') ---------- */
/* Roda a regiao inteira (cache, busca em voo, origem e o handler) num contexto
   proprio, com um ipcMain falso que so' guarda o handler. */
function montarHandler({ rodar, home, claudePanes }) {
  const ini = main.indexOf('let cacheAgentes');
  assert.ok(ini > 0, 'nao achei o cache das sessoes de fora');
  const sig = "ipcMain.handle('agentes:claude'";
  const h = main.indexOf(sig, ini);
  assert.ok(h > 0, 'nao achei o handler agentes:claude');
  const corpo = pegarBloco(main.slice(h), '=> {', 'handler agentes:claude');
  const fonte = main.slice(ini, h) + sig + ', async (_e, o) ' + corpo + ');';
  const handlers = {};
  const ctx = {
    fs, path, JSON, Date, Promise, Number, String, Array, Set, Map, Object, Error, setTimeout, clearTimeout,
    HOME: home || os.tmpdir(), claudeBin: () => 'claude', rodar,
    claudePanes: claudePanes || new Map(),
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
  };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return handlers['agentes:claude'];
}
const devolve = (out, err) => { const r = { n: 0 }; r.fn = () => { r.n++; return new Promise((res) => setTimeout(() => res({ err: err || null, out, errout: '' }), 5)); }; return r; };

test('main: JSON que nao e lista vira erro, nao "nenhuma"', async () => {
  const r = devolve('{"x":1}');
  const h = montarHandler({ rodar: r.fn });
  const x = await h(null, {});
  assert.equal(x.ok, false);
  assert.ok(x.erro && x.erro.length < 120, 'erro curto: ' + x.erro);
});

test('main: lista vazia e ok com hora da leitura', async () => {
  const h = montarHandler({ rodar: devolve('[]').fn });
  const x = await h(null, {});
  assert.equal(x.ok, true);
  assert.deepEqual([...x.itens], []);
  assert.ok(x.quando > 0);
});

test('main: falha do processo vira ok:false com o motivo', async () => {
  const h = montarHandler({ rodar: devolve('', new Error('saiu com código 1')).fn });
  const x = await h(null, {});
  assert.equal(x.ok, false);
  assert.match(x.erro, /código 1/);
});

test('main: duas chamadas juntas sobem UM processo', async () => {
  const r = devolve('[]');
  const h = montarHandler({ rodar: r.fn });
  const [a, b] = await Promise.all([h(null, { forcar: true }), h(null, { forcar: true })]);
  assert.equal(r.n, 1);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
});

test('main: cache vale 15 s, forcar fura o cache', async () => {
  const r = devolve('[]');
  const h = montarHandler({ rodar: r.fn });
  await h(null, {});
  await h(null, {});
  assert.equal(r.n, 1, 'segunda leitura sem forcar deveria vir do cache');
  await h(null, { forcar: true });
  assert.equal(r.n, 2, 'forcar deveria rodar de novo');
});

test('main: origem vem do registro da sessao por pid; pid do Cockpit marca daqui', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'torre-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'sessions', '4242.json'), JSON.stringify({ pid: 4242, entrypoint: 'cockpit' }));
  fs.writeFileSync(path.join(home, '.claude', 'sessions', '777.json'), JSON.stringify({ pid: 777, entrypoint: 'claude-vscode' }));
  const lista = JSON.stringify([
    { pid: 4242, cwd: 'C:\\x', kind: 'interactive', startedAt: 1, sessionId: 'aaa', name: 'a', status: 'busy' },
    { pid: 777, cwd: 'C:\\y', kind: 'interactive', startedAt: 1, sessionId: 'bbb', name: 'b', status: 'idle' },
    { pid: 99, cwd: 'C:\\z', kind: 'interactive', startedAt: 1, sessionId: 'ccc', name: 'c' },
  ]);
  const claudePanes = new Map([['p1', { proc: { pid: 4242 } }]]);
  const h = montarHandler({ rodar: devolve(lista).fn, home, claudePanes });
  const x = await h(null, {});
  assert.equal(x.ok, true);
  const por = Object.fromEntries(x.itens.map((i) => [i.sessionId, i]));
  assert.equal(por.aaa.origem, 'cockpit');
  assert.equal(por.bbb.origem, 'claude-vscode');
  assert.equal(por.ccc.origem, '', 'sem registro: nao inventa');
  assert.equal(por.aaa.daqui, true);
  assert.equal(por.bbb.daqui, false);
  assert.equal(por.aaa.status, 'busy');
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});

test('preload leva o forcar ate o main', () => {
  const preload = lerFonte('preload.js');
  assert.match(preload, /agentesClaude: \(o\) => ipcRenderer\.invoke\('agentes:claude', o\)/);
});

/* ---------- renderer: pecas puras ---------- */
/* pegarBloco para na primeira { -- que, em parametro desestruturado, e' a do
   parametro. Aqui o corpo comeca na { depois do ')' da assinatura. */
function funcao(txt, assinatura) {
  const i = txt.indexOf(assinatura);
  if (i < 0) throw new Error('nao achei ' + assinatura);
  let nivel = 0, k = i + assinatura.length - 1;
  for (; k < txt.length; k++) {   // fecha os parenteses dos parametros
    if (txt[k] === '(') nivel++;
    else if (txt[k] === ')') { nivel--; if (nivel === 0) break; }
  }
  return txt.slice(i, k + 1) + pegarBloco(txt.slice(k + 1), '{');
}
function ctxRenderer(extra) {
  const ctx = { Date, Math, String, Number, Array, Set, Map, Object, JSON, ...(extra || {}) };
  vm.createContext(ctx);
  return ctx;
}

test('rotuloDasSessoesDeFora: lendo / nenhuma / erro / lista', () => {
  const ctx = ctxRenderer();
  vm.runInContext(funcao(app, 'function rotuloDasSessoesDeFora('), ctx);
  const f = ctx.rotuloDasSessoesDeFora;
  const t = new Date(2026, 8, 14, 9, 5).getTime();
  assert.equal(f({ quando: 0, erro: '', n: 0 }), 'lendo…');
  assert.match(f({ quando: t, erro: '', n: 0 }), /^nenhuma · conferido às 09:05$/);
  assert.match(f({ quando: 0, erro: 'saiu com código 1', n: 0 }), /^não consegui listar: saiu com código 1$/);
  assert.match(f({ quando: t, erro: 'tempo esgotado', n: 2 }), /^não consegui listar: tempo esgotado · mostrando a lista das 09:05$/);
  assert.match(f({ quando: t, erro: '', n: 1 }), /^1 sessão · conferido às 09:05$/);
  assert.match(f({ quando: t, erro: '', n: 3 }), /^3 sessões · conferido às 09:05$/);
});

test('separarSessoesDeFora: painel vivo sai; so guardada fica com a aba anotada', () => {
  const ctx = ctxRenderer();
  vm.runInContext(pegarBloco(app, 'function separarSessoesDeFora(', 'separarSessoesDeFora'), ctx);
  const externas = [
    { sessionId: 'viva' }, { sessionId: 'guardada' }, { sessionId: 'solta' },
    { sessionId: 'solta' },                 // sub-processo: o mesmo id duas vezes
    { sessionId: 'pid-daqui', daqui: true }, // processo que este Cockpit abriu
    { sessionId: '' }, null,
  ];
  const fora = ctx.separarSessoesDeFora(externas, new Set(['viva']), new Map([['guardada', 'Clientes']]));
  assert.deepEqual([...fora.map((a) => a.sessionId)], ['guardada', 'solta']);
  assert.equal(fora[0].guardadaEm, 'Clientes');
  assert.equal(fora[1].guardadaEm, undefined);
});

test('comandoParaRetomar: PowerShell literal, aspa dobrada, fork na sessao viva', () => {
  const ctx = ctxRenderer();
  vm.runInContext(funcao(app, 'function comandoParaRetomar('), ctx);
  const f = ctx.comandoParaRetomar;
  assert.equal(f({ cwd: 'C:\\a b\\[x]$y', sessionId: 'abc-1', viva: false }), "Set-Location -LiteralPath 'C:\\a b\\[x]$y'; claude --resume abc-1");
  assert.equal(f({ cwd: "C:\\it's", sessionId: 'abc-1', viva: false }), "Set-Location -LiteralPath 'C:\\it''s'; claude --resume abc-1");
  assert.equal(f({ cwd: 'C:\\x', sessionId: 'abc-1', viva: true }), "Set-Location -LiteralPath 'C:\\x'; claude --resume abc-1 --fork-session");
  assert.equal(f({ cwd: 'C:\\x', sessionId: 'abc; rm -rf', viva: false }), '', 'id estranho nao vira comando');
});

test('duracaoCurta: segundos, minutos, horas e dias', () => {
  const ctx = ctxRenderer();
  vm.runInContext(pegarBloco(app, 'function duracaoCurta(', 'duracaoCurta'), ctx);
  const f = ctx.duracaoCurta;
  assert.equal(f(45 * 1000), '45s');
  assert.equal(f(3 * 60 * 1000 + 5000), '3m05s');
  assert.equal(f(90 * 60 * 1000), '1h30');
  assert.equal(f(48 * 3600 * 1000), '48h');
  assert.equal(f(3 * 86400 * 1000), '3 dias');
});

test('estadoDoPainel: ramo recem-aberto nao conta como painel vazio', () => {
  const ctx = ctxRenderer({ $: () => null, duracaoCurta: () => '1s' });
  vm.runInContext(pegarBloco(app, 'function estadoDoPainel(', 'estadoDoPainel'), ctx);
  assert.equal(ctx.estadoDoPainel({ hist: [] }).cls, 'vazio');
  const ramo = ctx.estadoDoPainel({ hist: [], resumeId: 'x', forkPendente: true });
  assert.equal(ramo.cls, 'parado');
  assert.match(ramo.txt, /ramo pronto/);
});

test('titulo da linha: titulo, senao a primeira mensagem, senao "nova conversa"', () => {
  const ctx = ctxRenderer();
  vm.runInContext(pegarBloco(app, 'function tituloNaTorre(', 'tituloNaTorre'), ctx);
  const f = ctx.tituloNaTorre;
  assert.equal(f({ titulo: 'Relatório', hist: [] }), 'Relatório');
  assert.equal(f({ titulo: '', hist: [{ quem: 'Codex', texto: 'oi' }, { quem: 'Você', texto: '  monta   a página\nde captura do produto novo com três blocos e depoimento  ' }] }).slice(0, 26), 'monta a página de captura ');
  assert.ok(f({ titulo: '', hist: [{ quem: 'Você', texto: 'x'.repeat(200) }] }).length <= 61);
  assert.equal(f({ titulo: '', hist: [] }), 'nova conversa');
});

/* ---------- visual e contratos ---------- */
const regra = (sel) => { const m = css.match(new RegExp('(^|\\n)' + sel.replace('.', '\\.') + '\\{([^}]*)\\}')); return m ? m[2] : ''; };

test('CSS: .torre e .rot rolam dentro da barra', () => {
  for (const sel of ['.torre', '.rot']) {
    const r = regra(sel);
    assert.match(r, /overflow:auto/, sel + ' sem overflow:auto');
    assert.match(r, /min-height:0/, sel + ' sem min-height:0');
    assert.match(r, /flex:1/, sel + ' sem flex:1');
  }
});

test('linhas da Torre usam o logo do motor com selo de estado', () => {
  const bloco = funcao(app, 'function linhaDaTorre(');
  assert.match(bloco, /marcaDoMotor\([^)]*'ti-logo'\)/);
  assert.ok(!bloco.includes('ti-pt'), 'ainda usa a bolinha antiga');
  assert.match(css, /\.ti-logo::after\{/);
});

test('pintarTorre: agrupa vazios, agentes num conteiner fixo no fim, relogio anda no hover', () => {
  const bloco = pegarBloco(app, 'function pintarTorre(', 'pintarTorre');
  assert.match(bloco, /painéis vazios/);
  assert.match(bloco, /pintarAgentesDaTorre\(\);\s*\n[^\n]*buscarSessoesDeFora[^\n]*\n\}$/, 'pintarTorre tem que terminar pintando os agentes');
  assert.match(pegarBloco(app, 'function pintarAgentesDaTorre(', 'pintarAgentesDaTorre'), /\$\('#torre \.torre-agentes'\)[\s\S]*paintAgents\(a\)/, 'agentes fora do conteiner fixo');
  assert.match(app, /case 'agent-state': if \(torreVisivel\(\)\) pintarAgentesDaTorre\(\);/, 'agent-state ainda pinta solto no #torre');
  assert.ok(!/:hover'\)\)\s*\{\s*pintarTorre/.test(app), 'hover ainda congela a torre inteira');
  assert.match(app, /document\.hidden/);
  // o clique no guardado cai pro id da sessao quando o painel volta com id novo
  assert.match(bloco, /\(q\.sessaoId \|\| q\.resumeId\) === f\.sessaoId/);
});

test('sessao de fora: continuar aqui (ramo) abre painel com fork', () => {
  const bloco = pegarBloco(app, 'function continuarSessaoDeFora(', 'continuarSessaoDeFora');
  assert.match(bloco, /forkPendente = true/);
  assert.match(bloco, /resumeId = a\.sessionId/);
  assert.match(bloco, /'\(ramo\) '/);
});

test('agentes: cabecalho no estilo da Torre, sem h3, sem dica fixa, sem ternario de motor', () => {
  const bloco = pegarBloco(collab, 'async function paintAgents(', 'paintAgents');
  assert.ok(!bloco.includes("el('h3'"), 'ainda tem o h3 proprio');
  assert.match(bloco, /torre-aba/);
  assert.ok(!/=== 'codex' \? 'Codex' : 'Claude'/.test(bloco), 'ternario de dois motores');
  assert.match(bloco, /paineisVivos/);
});

test('observabilidade: agente finalizado de painel que nao existe mais sai da resposta', () => {
  const { criarObservabilidade } = require('../src/cockpit-observability');
  const obs = criarObservabilidade(() => {});
  obs.observarClaude('p-vivo', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { description: 'A' } }] } });
  obs.observarClaude('p-morto', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Task', input: { description: 'B' } }] } });
  obs.observarClaude('p-morto2', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Task', input: { description: 'C' } }] } });
  obs.encerrarPainel('p-morto', 'claude');
  obs.encerrarPainel('p-vivo', 'claude');
  const todos = obs.agentesSessao({}).itens.map((a) => a.task).sort();
  assert.deepEqual(todos, ['A', 'B', 'C'], 'sem a lista de paineis, nada muda');
  const filtrados = obs.agentesSessao({ paineisVivos: ['p-vivo'] }).itens.map((a) => a.task).sort();
  // B: interrompido e o painel sumiu -> sai. C: ainda rodando -> fica. A: painel vivo -> fica.
  assert.deepEqual(filtrados, ['A', 'C']);
  assert.ok(obsFonte.includes('paineisVivos'));
});
