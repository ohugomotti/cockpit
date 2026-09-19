'use strict';
/* Leva 41 -- conferencia final (depois da auditoria 2). Cada achado vira um
   teste com a funcao de verdade recortada do fonte, rodada num vm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');

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

/* =====================================================================
   1) o vigia do limite so' acredita no ERRO do CLI, nunca na fala do modelo
   ===================================================================== */
// o claudeMessage de verdade (main.js), com o minimo em volta, soltando os eventos no vigia de verdade
function claudeComVigia() {
  const quedas = require('../src/quedas');
  const vigia = quedas.criarVigiaDeTurno({ registrar: () => {} });
  const saidas = [];
  const ctx = {
    observabilidade: { observarClaude() {} },
    marcaSub: () => '', temSeq: () => true, somaSeq() {}, seqDoPane: () => 1, limparSeq() {}, descartarPermissoes() {},
    claudeToolArg: () => '', mudancaDaFerramenta: () => null,
    emit: (paneId, kind, data) => saidas.push({ kind, ...vigia.passar(paneId, kind, data) }),
    console, JSON, String, Array, Object, Math, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(MAIN.slice(MAIN.indexOf('function claudeMessage('), MAIN.indexOf('const LIM_DIFF')), ctx);
  return { vigia, saidas, msg: (m) => ctx.claudeMessage('p', m) };
}
const falaDoModelo = (texto) => ({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: texto }] } });
// como o CLI 2.1.270 escreve o erro de API (isApiErrorMessage -> is_api_error_message; modelo "<synthetic>")
const erroDoCli = (texto) => ({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: texto }] }, is_api_error_message: true, error: 'rate_limit' });

test('conferencia 1: o modelo CITANDO a frase de limite (resposta curta) nao trava o religar da queda real que vem depois', () => {
  const c = claudeComVigia();
  c.vigia.registrarPainel('p', { engine: 'claude' });
  for (const texto of [
    'You\'ve hit your session limit · resets 6:20pm',          // "qual e' a frase que o CLI mostra?"
    'You\'ve hit your usage limit.',                              // "traduz: voce atingiu seu limite de uso"
    'Claude AI usage limit reached|1757872800',
  ]) {
    c.vigia.ligar('p');
    c.msg(falaDoModelo(texto));
    const queda = c.vigia.passar('p', 'engine-down', { engine: 'claude', motivo: '' });
    assert.equal(queda.tipo, 'queda', 'fala do modelo nao e limite: ' + texto);
    assert.ok(!queda.limite, texto);
  }
  // e mesmo depois do fim do turno (sem mensagem nova), a queda nao vira "limite"
  c.vigia.ligar('p');
  c.msg(falaDoModelo('You\'ve hit your weekly limit · resets Sep 16, 6:20pm'));
  c.vigia.passar('p', 'turn-end', {});
  assert.equal(c.vigia.passar('p', 'engine-down', { engine: 'claude', motivo: '' }).tipo, 'queda');
});

test('conferencia 1: o erro de API do proprio CLI (is_api_error_message / <synthetic>) com a frase continua sendo limite', () => {
  const c = claudeComVigia();
  c.vigia.registrarPainel('p', { engine: 'claude' });
  c.vigia.ligar('p');
  c.msg(erroDoCli('You\'ve hit your session limit · resets 6:20pm'));
  const fala = c.saidas.find((s) => s.kind === 'text-final');
  assert.equal(fala.erroDoCli, true, 'o main marca a fala que o CLI escreveu como erro');
  const queda = c.vigia.passar('p', 'engine-down', { engine: 'claude', motivo: '' });
  assert.equal(queda.tipo, 'limite');
  assert.equal(queda.limite.hora, '18:20');
  // so' o modelo "<synthetic>" (CLI mais antigo, sem o campo novo) tambem vale
  const d = claudeComVigia();
  d.vigia.ligar('p');
  d.msg({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'You\'ve hit your Opus limit · resets 6pm' }] } });
  assert.equal(d.vigia.passar('p', 'engine-down', { engine: 'claude', motivo: '' }).tipo, 'limite');
  // e a fala normal do modelo nao leva a marca
  const e = claudeComVigia();
  e.msg(falaDoModelo('Pronto, terminei.'));
  assert.ok(!e.saidas.find((s) => s.kind === 'text-final').erroDoCli);
});

test('conferencia 1: fala do Codex (sem marca) citando o limite tambem nao vira limite', () => {
  const quedas = require('../src/quedas');
  const v = quedas.criarVigiaDeTurno({ registrar: () => {} });
  v.registrarPainel('c', { engine: 'codex' });
  v.ligar('c');
  v.passar('c', 'text-final', { id: 'x', text: 'You\'ve hit your usage limit. Try again in 2 hours 5 minutes.' });
  assert.equal(v.passar('c', 'engine-down', { engine: 'codex', motivo: '' }).tipo, 'queda');
});

/* =====================================================================
   2) conversa nova (apagou / trocou a pasta) ganha o nome de 3 palavras
   ===================================================================== */
function ctxTitulo(extra) {
  const chamadas = [];
  const ctx = {
    ...globaisFalsos(), console, chamadas,
    cfg: {}, panes: new Map(), panesFundo: new Map(), histCache: {},
    $: (sel, el) => (el && el[sel] !== undefined ? el[sel] : null),
    note() {}, setDot() {}, pintarNome() {}, savePanes() { chamadas.push('savePanes'); },
    destravarPainel() {}, limparSessoesDeTodosMotores() {}, limparPlano() {}, limparAuditoria() {}, mostrarPastaNoPainel() {},
    nomePasta: (p) => p, shortPath: (p) => p, atualizarGit() {}, loadTree() {}, focusPane: null, remotoDoPane: () => null,
    window: { api: { paneStop: async () => true } },
    ...(extra || {}),
  };
  vm.createContext(ctx);
  const i = APP.indexOf('const PALAVRA_VAZIA');
  vm.runInContext(APP.slice(i, APP.indexOf(']);', i) + 3).replace(/^const /, 'var '), ctx);
  vm.runInContext(['soComandoOuContinue', 'podeGerarTituloAuto', 'zerarNomeDaConversa', 'esquecerTituloAuto',
    'antesDaTroca', 'avisarTroca', 'trocarPastaDoPainel'].map(recorte).join('\n'), ctx);
  return ctx;
}
const velha = () => [{ quem: 'Você', texto: 'monta o relatorio de vendas de agosto' }, { quem: 'Claude', texto: 'Feito.' }];

test('conferencia 2: trocar a pasta -> a 1a mensagem da conversa nova ganha o nome de 3 palavras (o hist antigo fica, pra troca de motor)', async () => {
  const c = ctxTitulo();
  const P = { id: 'p', engine: 'claude', cwd: 'C:\\velha', sessaoId: 'S', titulo: 'Relatorio Vendas Agosto', tituloAuto: true, _tituloAutoChave: 'k', hist: velha(), el: {} };
  await c.trocarPastaDoPainel(P, 'C:\\nova');
  assert.equal(P.hist.length, 2, 'o historico continua (leva contexto na troca de motor)');
  assert.equal(c.podeGerarTituloAuto(P, 'arruma o rodape do site'), true, 'conversa nova: 1a mensagem ganha nome');
  // depois que a 1a mensagem de verdade entra nesta conversa, a proxima nao gera de novo
  P.hist.push({ quem: 'Você', texto: 'arruma o rodape do site' });
  assert.equal(c.podeGerarTituloAuto(P, 'agora o cabecalho'), false);
  // "continue" ou /comando como 1a desta conversa nao conta
  const Q = { id: 'q', engine: 'claude', cwd: 'C:\\a', titulo: 'X', hist: velha(), el: {} };
  await c.trocarPastaDoPainel(Q, 'C:\\b');
  Q.hist.push({ quem: 'Você', texto: '/model sonnet' });
  assert.equal(c.podeGerarTituloAuto(Q, 'faz a planilha de custos'), true);
});

test('conferencia 2: apagar a conversa pela lista (zerarNomeDaConversa) libera o nome da proxima; painel restaurado com fala continua barrando', () => {
  const c = ctxTitulo();
  const P = { id: 'p', engine: 'codex', titulo: 'Nome Velho', nomeManual: true, hist: velha(), el: {} };
  // o que o "Apagar conversa" faz com o painel aberto
  P.sessaoId = null; P.resumeId = null; P.resumeAnterior = null; P.forkPendente = false;
  c.zerarNomeDaConversa(P);
  assert.equal(c.podeGerarTituloAuto(P, 'cria a campanha de remarketing'), true);
  // painel restaurado/reaberto (a conversa e' a mesma do historico): nao gera
  const R = { id: 'r', engine: 'claude', titulo: '', hist: velha(), el: {} };
  assert.equal(c.podeGerarTituloAuto(R, 'mais uma coisa'), false, 'fala sua nesta conversa barra');
  // o historico todo trocado (openSession/novaConversa zeram o hist) nao herda marca velha
  c.zerarNomeDaConversa(R);
  R.hist = [{ quem: 'Você', texto: 'outra conversa aberta pela lista' }];
  assert.equal(c.podeGerarTituloAuto(R, 'mais uma coisa'), false);
  // e o "Apagar conversa" de verdade passa pelo zerar
  assert.match(recorte('linhaConversa'), /zerarNomeDaConversa\(Q\)/);
});

/* coordenador: dentro de ~/.claude, ~/.codex e ~/.gemini so' skills/agents/
   commands/worktrees... contam como projeto. ~/.claude/projects guarda TODAS as
   conversas do Hugo -- debate aberto ali mandaria o historico inteiro pra fora. */
test('debate: ~/.claude/projects e ~/.codex/sessions sao pasta ampla; skills e worktree continuam lendo', (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { DebateManager } = require('../src/cockpit-debate');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'conf-projects-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const home = path.join(raiz, 'hugom');
  for (const p of ['.claude/projects/C--Users-hugom', '.codex/sessions/2026', '.gemini/tmp/x', '.claude/skills/minha', 'repo/.claude/worktrees/x'])
    fs.mkdirSync(path.join(home, p), { recursive: true });
  const m = new DebateManager({ directory: path.join(raiz, 'debates'), runTurn: async () => ({ text: '' }), home });
  const L = (rel) => ({ ...m.leituraDe({ cwd: path.join(home, rel) }) });
  const AMPLA = { leitura: false, semLeitura: 'ampla' }, LE = { leitura: true, semLeitura: '' };
  assert.deepEqual(L('.claude/projects/C--Users-hugom'), AMPLA);
  assert.deepEqual(L('.claude/projects'), AMPLA);
  assert.deepEqual(L('.codex/sessions/2026'), AMPLA);
  assert.deepEqual(L('.gemini/tmp/x'), AMPLA);
  assert.deepEqual(L('.claude/skills/minha'), LE);
  assert.deepEqual(L('repo/.claude/worktrees/x'), LE);

  const COLAB = lerFonte('renderer', 'collaboration.js');
  const i = COLAB.indexOf('function pastaAmpla(');
  let nivel = 0, fim = -1;
  for (let k = COLAB.indexOf('{', i); k < COLAB.length; k++) {
    if (COLAB[k] === '{') nivel++;
    else if (COLAB[k] === '}' && --nivel === 0) { fim = k + 1; break; }
  }
  const ctx = vm.createContext({ HOME: 'C:\\Users\\hugom' });
  vm.runInContext(COLAB.slice(i, fim), ctx);
  assert.equal(ctx.pastaAmpla('C:\\Users\\hugom\\.claude\\projects\\C--Users-hugom'), true);
  assert.equal(ctx.pastaAmpla('C:\\Users\\hugom\\.codex\\sessions'), true);
  assert.equal(ctx.pastaAmpla('C:\\Users\\hugom\\.claude\\skills\\minha'), false);
  assert.equal(ctx.pastaAmpla('C:\\repo\\.claude\\worktrees\\x'), false);
});
