'use strict';
/* Leva 41 -- auditoria 2: cada achado vira um teste aqui, com a funcao de
   verdade recortada do fonte (app.js, main.js, quedas.js, debate, leitor) e
   rodada num vm, como no auditoria1.test.js. O numero do achado vai no nome. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pegarBloco, lerFonte, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');

function recorte(nome, opcional) {
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
  if (opcional) return '';
  throw new Error('nao achei no app.js: ' + nome);
}
const constBloco = (nome, ass) => pegarBloco(APP, ass || ('const ' + nome + ' = '), nome).replace(/^const /, 'var ');
function constLinha(nome, opcional) {
  const l = APP.split('\n').find((x) => x.startsWith('const ' + nome + ' '));
  if (!l) { if (opcional) return ''; throw new Error('nao achei const ' + nome); }
  return l.replace(/^const /, 'var ');
}
function constLista(nome) {
  const i = APP.indexOf('const ' + nome + ' = [');
  assert.ok(i >= 0, 'nao achei ' + nome);
  return 'var ' + APP.slice(i + 6, APP.indexOf('];', i) + 2);
}
const tick = () => new Promise((r) => setImmediate(r));
// funcao com "{" dentro de string (o recorte conta chave): do comeco ate a proxima funcao
const trecho = (ini, fim) => { const i = APP.indexOf(ini); assert.ok(i >= 0, ini); return APP.slice(i, APP.indexOf(fim, i + ini.length)); };
const restaurarMiolo = () => trecho('async function restaurarPaineisMiolo(', '/* ===================== RAMIFICAR');

/* =====================================================================
   1) frases reais de limite do Claude 2.1.270 (de dentro do claude.exe)
   ===================================================================== */
test('achado 1: as frases de limite do Claude 2.1.270 sao limite (nao queda) e a hora do "resets" vira a tarja', () => {
  const quedas = require('../src/quedas');
  const agora = new Date(2026, 8, 15, 10, 0, 0);
  const reais = [
    'You\'ve hit your session limit · resets 6:20pm',
    'You\'ve hit your weekly limit · resets Sep 16, 6:20pm',
    'You\'ve hit your Opus limit · resets 6pm',
    'You\'ve hit your Sonnet limit',
    'You\'ve hit your Fable limit · resets 6:20pm (America/Sao_Paulo)',
    'You\'ve hit your usage credit limit',
    'You’ve hit your session limit · resets 6:20pm',
    'You\'re out of usage credits · resets 6:20pm',
    'API Error: You\'ve hit your weekly limit · resets Sep 16, 6:20pm',
  ];
  for (const f of reais) {
    assert.equal(quedas.tipoDaQueda(f), 'limite', f);
    assert.ok(quedas.limiteDeUso(f, agora), f);
  }
  // as antigas continuam
  for (const f of ['5-hour limit reached ∙ resets 3pm', 'Weekly limit reached ∙ resets Oct 9, 5pm', 'Claude AI usage limit reached|1757872800',
    'You\'ve hit your usage limit.', 'You\'ve hit your limit · resets 3:30pm (America/Sao_Paulo)']) assert.equal(quedas.tipoDaQueda(f), 'limite', f);
  // sobrecarga passageira NAO e' limite
  for (const f of ['Rate limit reached', 'API Error: 429 Rate limit reached for requests', 'You\'ve hit your rate limit, slow down']) {
    assert.equal(quedas.limiteDeUso(f, agora), null, f);
    assert.equal(quedas.tipoDaQueda(f), 'queda', f);
  }
  // hora
  const a = quedas.limiteDeUso('You\'ve hit your session limit · resets 6:20pm', agora);
  assert.equal(a.hora, '18:20'); assert.equal(new Date(a.ms).getHours(), 18); assert.equal(new Date(a.ms).getMinutes(), 20);
  assert.match(a.texto, /libera às 18:20/);
  const b = quedas.limiteDeUso('You\'ve hit your Opus limit · resets 6pm', agora);
  assert.equal(b.hora, '18:00');
  const c = quedas.limiteDeUso('You\'ve hit your weekly limit · resets Sep 16, 6:20pm', agora);
  assert.equal(c.hora, '18:20'); assert.equal(c.dia, '16/09'); assert.equal(new Date(c.ms).getDate(), 16);
  assert.match(c.texto, /libera às 16\/09 às 18:20/);
  const d = quedas.limiteDeUso('You\'re out of usage credits · resets 6:20pm', agora);
  assert.equal(d.hora, '18:20');
  const e = quedas.limiteDeUso('You\'ve hit your Sonnet limit', agora);
  assert.equal(e.hora, ''); assert.match(e.texto, /Não vou retomar sozinho/);
});

test('achado 1: o limite que chega na resposta (nota ou fala) e depois o motor morre = limite, sem religar', () => {
  const quedas = require('../src/quedas');
  const v = quedas.criarVigiaDeTurno({ registrar: () => {} });
  v.registrarPainel('p', { engine: 'claude' });
  // 1) nota de erro (result is_error) com a frase, depois morre no mesmo turno
  v.ligar('p');
  const n = v.passar('p', 'note', { text: 'You\'ve hit your session limit · resets 6:20pm', error: true });
  assert.ok(n.limite, 'a nota leva o limite (tarja)');
  const d1 = v.passar('p', 'engine-down', { engine: 'claude', motivo: '' });
  assert.equal(d1.tipo, 'limite');
  assert.ok(d1.limite && d1.limite.hora === '18:20');
  assert.equal(d1.limiteJaAvisado, true, 'a tarja ja saiu pela nota: a tela nao repete');
  // 2) so' a fala de ERRO do CLI (sem result) e morre: tambem limite (conferencia final: so' com a marca erroDoCli)
  v.ligar('p');
  v.passar('p', 'text-final', { id: 'm1', text: 'You\'ve hit your weekly limit · resets Sep 16, 6:20pm', erroDoCli: true });
  const d2 = v.passar('p', 'engine-down', { engine: 'claude', motivo: '' });
  assert.equal(d2.tipo, 'limite');
  assert.ok(!d2.limiteJaAvisado);
  // 3) fala comum que CITA limite nao muda nada
  v.ligar('p');
  v.passar('p', 'text-final', { id: 'm2', text: 'O usage limit do plano Max é de 5 horas; quando você hit your limit, espera.' });
  assert.equal(v.passar('p', 'engine-down', { engine: 'claude', motivo: '' }).tipo, 'queda');
  // 4) o limite de um turno ANTERIOR nao contamina a queda do proximo
  v.ligar('p');
  v.passar('p', 'note', { text: 'You\'ve hit your session limit', error: true });
  v.passar('p', 'turn-end', {});
  v.ligar('p');
  assert.equal(v.passar('p', 'engine-down', { engine: 'claude', motivo: '' }).tipo, 'queda');
});

test('achado 1 (tela): limite depois do fim do turno tambem nao diz "a proxima mensagem religa"; ja avisado nao repete', () => {
  const avisos = [], notas = [];
  const ctx = { ...globaisFalsos(), console, window: { api: { paradaEm: () => 0 } },
    note: (P, t, e) => notas.push({ t, e: !!e }), mostrarAviso: (a) => avisos.push(a),
    remotoDoPane: () => null, nomeDoMotor: () => 'Claude', desligarMotor: () => {}, pararTrabalho: () => {}, limparPassos: () => {},
    esconderPermissao: () => {}, pintarAbasLocal: () => {}, pintarFila: () => {}, $: () => null, avisarLoginDoServidor: () => {}, agendarReligar: () => { throw new Error('religou'); } };
  vm.createContext(ctx);
  const tq = (n) => APP.split('\n').find((x) => x.startsWith('const ' + n + ' ')).replace(/^const /, 'var ');
  vm.runInContext([tq('RELIGA_NO_TURNO'), tq('ESPERAS_RELIGAR'), tq('JANELA_RELIGAR'), recorte('motivoPraNaoReligar'), recorte('devolverFilaAoCampo'), recorte('motorCaiu')].join('\n'), ctx);
  const P = { id: 'p', engine: 'claude', busy: false, el: {} };
  const lim = { hora: '18:20', ms: 1, texto: 'Limite de uso atingido — libera às 18:20.' };
  assert.equal(ctx.motorCaiu(P, { emTurno: false, tipo: 'limite', limite: lim }, false), 'limite');
  assert.ok(!notas.some((n) => /religa/.test(n.t)), JSON.stringify(notas));
  assert.equal(avisos.length, 1);
  assert.equal(ctx.motorCaiu(P, { emTurno: true, tipo: 'limite', limite: lim, limiteJaAvisado: true }, false), 'limite');
  assert.equal(avisos.length, 1, 'ja avisado pela nota: sem tarja repetida');
  assert.equal(notas.length, 1);
});

/* =====================================================================
   7) debate: pasta de projeto dentro de .claude le; a raiz de .claude nao
   9) nome curto 8.3 nao fura o bloqueio
   10) uma lista de segredo so', a mesma nos dois motores
   8) terminal do Codex nunca liga no debate
   ===================================================================== */
const leitor = require('../src/leitura-mcp');
function arvore(t, prefixo) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const esc = (rel, txt) => { const p = path.join(raiz, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); return p; };
  return { raiz, esc };
}

test('achado 7: pasta de projeto dentro de .claude (skills) e worktree em repo/.claude/worktrees/x: o leitor le', (t) => {
  const { raiz, esc } = arvore(t, 'aud2-claude-');
  esc('.claude/skills/minha/SKILL.md', 'SKILL-PERMITIDA\n');
  esc('.claude/skills/minha/.env', 'SEGREDO-ENV\n');
  esc('.claude/skills/minha/sub/.ssh/config', 'SEGREDO-SSH\n');
  esc('.claude/.credentials.json', 'SEGREDO-CRED\n');
  const skill = path.join(raiz, '.claude', 'skills', 'minha');
  assert.match(leitor.ler(skill, 'SKILL.md'), /SKILL-PERMITIDA/);
  assert.match(leitor.listar(skill, '.'), /SKILL\.md/);
  assert.match(leitor.buscar(skill, 'PERMITIDA'), /SKILL\.md:1/);
  // segredo DENTRO da pasta continua barrado; fora dela, nem se alcanca
  assert.throws(() => leitor.ler(skill, '.env'), /protegid/);
  assert.throws(() => leitor.ler(skill, 'sub/.ssh/config'), /protegid/);
  assert.throws(() => leitor.ler(skill, '../../.credentials.json'), /protegid|Fora do projeto/);
  assert.doesNotMatch(leitor.buscar(skill, 'SEGREDO'), /SEGREDO-/);
  // worktree
  esc('repo/.claude/worktrees/x/src/a.js', 'const WT = 1;\n');
  const wt = path.join(raiz, 'repo', '.claude', 'worktrees', 'x');
  assert.match(leitor.ler(wt, 'src/a.js'), /WT = 1/);
  assert.match(leitor.listar(wt, '.'), /src\/a\.js/);
  assert.match(leitor.buscar(wt, 'WT'), /src\/a\.js:1/);
});

test('achado 7: a raiz de ~/.claude, ~/.codex, ~/.gemini (e .ssh/.aws por dentro) e pasta ampla; a subpasta de skills le', (t) => {
  const { DebateManager } = require('../src/cockpit-debate');
  const { raiz } = arvore(t, 'aud2-home-');
  const home = path.join(raiz, 'hugom');
  for (const p of ['.claude/skills/minha', '.codex/sessions', '.gemini', '.ssh/sub', '.aws', '.config/gcloud/x', 'Projetos/nexfin', 'repo/.claude/worktrees/x']) fs.mkdirSync(path.join(home, p), { recursive: true });
  const m = new DebateManager({ directory: path.join(raiz, 'debates'), runTurn: async () => ({ text: '' }), home });
  const L = (rel) => ({ ...m.leituraDe({ cwd: path.join(home, rel) }) });
  const AMPLA = { leitura: false, semLeitura: 'ampla' }, LE = { leitura: true, semLeitura: '' };
  assert.deepEqual(L('.claude'), AMPLA);
  assert.deepEqual(L('.codex'), AMPLA);
  assert.deepEqual(L('.gemini'), AMPLA);
  assert.deepEqual(L('.ssh/sub'), AMPLA);
  assert.deepEqual(L('.aws'), AMPLA);
  assert.deepEqual(L('.config/gcloud/x'), AMPLA);
  assert.deepEqual(L('.claude/skills/minha'), LE, 'skills do Hugo: le');
  assert.deepEqual(L('repo/.claude/worktrees/x'), LE, 'worktree: le');
  assert.deepEqual(L('Projetos/nexfin'), LE);
  assert.deepEqual(L('.'), AMPLA, 'a pessoal continua ampla');
});

test('achado 7 (tela): o dialogo pergunta ao main (debateLeitura) e a copia local tambem recusa a raiz de .claude', () => {
  const COLAB = lerFonte('renderer', 'collaboration.js');
  const ctx = vm.createContext({ HOME: 'C:\\Users\\hugom' });
  vm.runInContext(pegarBloco(COLAB, 'function pastaAmpla(', 'pastaAmpla'), ctx);
  for (const p of ['C:\\Users\\hugom\\.claude', 'C:\\Users\\hugom\\.codex\\', 'C:\\Users\\hugom\\.gemini', 'C:\\Users\\hugom\\.ssh\\x', 'C:\\Users\\hugom', 'D:\\']) assert.equal(ctx.pastaAmpla(p), true, p);
  for (const p of ['C:\\Users\\hugom\\.claude\\skills\\minha', 'C:\\repo\\.claude\\worktrees\\x', 'C:\\Projetos\\prev-ia']) assert.equal(ctx.pastaAmpla(p), false, p);
  const i = COLAB.indexOf('async function open(');
  const abrir = COLAB.slice(i, COLAB.indexOf('const d = dialog(', i));
  assert.match(abrir, /await window\.api\.debateLeitura\(/);
  assert.match(MAIN, /ipcMain\.handle\('debate:leitura'/);
  assert.match(lerFonte('preload.js'), /debateLeitura: \(o\) => ipcRenderer\.invoke\('debate:leitura', o\)/);
});

test('achado 9: nome curto 8.3 do Windows (ENV~1, CREDEN~1.JSO) nao abre o segredo', (t) => {
  const { raiz, esc } = arvore(t, 'aud2-83-');
  esc('.env', 'SEGREDO-ENV\n'); esc('.credentials.json', 'SEGREDO-CRED\n'); esc('ok.txt', 'OK\n');
  const curtos = ['ENV~1', 'CREDEN~1.JSO'].filter((n) => fs.existsSync(path.join(raiz, n)));
  if (process.platform !== 'win32' || !curtos.length) { t.diagnostic('sem nomes 8.3 neste disco'); return; }
  for (const n of curtos) assert.throws(() => leitor.ler(raiz, n), /protegid/, n);
  assert.match(leitor.ler(raiz, 'ok.txt'), /OK/);
});

test('achado 10: o deny do Claude no debate e o leitor do Codex usam a MESMA lista (id_dsa, id_ecdsa, id_ed25519 inclusos)', () => {
  const { claudeArgs } = require('../src/cockpit-debate-adapters');
  const args = claudeArgs('claude-sonnet-5', 'high', { leitura: true });
  const deny = JSON.parse(args[args.indexOf('--settings') + 1]).permissions.deny;
  for (const p of ['**/id_dsa*', '**/id_ecdsa*', '**/id_ed25519*', '**/id_rsa*']) for (const f of ['Read', 'Grep', 'Glob']) assert.ok(deny.includes(f + '(' + p + ')'), f + p);
  assert.ok(Array.isArray(leitor.GLOBS_SEGREDO) && leitor.GLOBS_SEGREDO.length >= 18);
  assert.deepEqual(deny.filter((d) => d.startsWith('Read(')).map((d) => d.slice(5, -1)), [...leitor.GLOBS_SEGREDO]);
  // cada glob da lista barra de verdade no leitor (arquivo com esse nome)
  for (const g of leitor.GLOBS_SEGREDO) {
    const nome = g.replace(/^\*\*\//, '').replace(/\/\*\*$/, '/x').replace(/\*/g, 'abc');
    assert.equal(leitor.sensivel(nome), true, g + ' -> ' + nome);
  }
  assert.equal(leitor.sensivel('src/app.js'), false);
});

test('achado 8: o terminal do Codex nunca liga no debate, e o main nem pergunta mais pelo sandbox', async (t) => {
  const { createDebateRunner } = require('../src/cockpit-debate-adapters');
  const chamadas = [];
  const runTurn = createDebateRunner({
    codexReady: async () => {},
    codexRequest: async (m, p) => { chamadas.push({ m, p }); return m === 'config/read' ? { config: {} } : m === 'thread/start' ? { thread: { id: 'thr' } } : m === 'turn/start' ? { turn: { id: 'turn' } } : {}; },
    bindThread() {}, unbindThread() {}, subscribe: () => () => {}, workspace: () => os.tmpdir(),
    leitor: (cwd) => ({ command: 'node', args: ['x'], env: { COCKPIT_RAIZ: cwd } }), sandboxReady: async () => true,
    spawnClaude: () => { throw new Error('x'); }, stopProcess() {},
  });
  const ctrl = new AbortController();
  const pr = runTurn({ engine: 'codex', model: 'gpt-6-astra', effort: 'high', prompt: 'x', cwd: os.tmpdir(), leitura: true, signal: ctrl.signal, onText() {} });
  await tick(); await tick(); await tick();
  ctrl.abort(); await pr.catch(() => {});
  const cfg = chamadas.find((c) => c.m === 'thread/start').p.config;
  assert.equal(cfg['features.shell_tool'], false);
  assert.equal(cfg['features.unified_exec'], false);
  assert.ok(cfg['mcp_servers.cockpit_leitura'], 'o leitor do Cockpit continua');
  const bloco = MAIN.slice(MAIN.indexOf('const debateRunner = createDebateRunner({'), MAIN.indexOf('const debates = new DebateManager('));
  assert.doesNotMatch(bloco, /sandboxReady|windowsSandbox/);
});

/* =====================================================================
   andaime da tela: funcoes de verdade do app.js num vm, DOM minimo
   ===================================================================== */
function campoFalso(v) { return { value: v || '', style: {}, scrollHeight: 0, focus() {} }; }
function ctxTela(nomes, extra) {
  const notas = [], avisos = [], chamadas = [];
  const ctx = {
    ...globaisFalsos(), console, notas, avisos, chamadas,
    cfg: { defMode: 'manual', abaAtiva: 'pc', abas: [] },
    panes: new Map(), panesFundo: new Map(), fichasPendentes: new Map(), histCache: {},
    $: (sel, el) => (el && el[sel] !== undefined ? el[sel] : (sel === '.p-input' && el ? el.campo : null)),
    note: (P, t, e) => notas.push({ id: P && P.id, t, e: !!e }),
    mostrarAviso: (a) => avisos.push(a),
    setDot() {}, pararTrabalho() {}, limparPassos() {}, esconderPermissao() {}, pintarAbasLocal() {}, pintarFila() {},
    pintarNome(P) { P._pintouNome = (P._pintouNome || 0) + 1; }, pintarModo() {}, pintarAnexos() {}, fillModels() {},
    savePanes() { chamadas.push('savePanes'); }, guardarEstadoDoMotor() {}, remotoDoPane: () => null,
    abasLocais: () => ctx.cfg.abas, nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex' })[e] || e,
    window: { api: { paneStop: async () => true, setConfig() {}, renomear: async (o) => { chamadas.push({ renomear: o }); return true; } } },
    ...(extra || {}),
  };
  vm.createContext(ctx);
  vm.runInContext(nomes.map((n) => (n.startsWith('const ') ? constLinha(n.slice(6)) : recorte(n))).join('\n'), ctx);
  return ctx;
}

/* =====================================================================
   2) renomear pela LISTA chega no painel aberto e na ficha (savePanes)
   ===================================================================== */
test('achado 2: renomear pela lista muda o painel aberto (e o do fundo), a ficha de outra aba e grava; o ramo pendente da origem nao muda', () => {
  const c = ctxTela(['renomearPaineisDaConversa', 'painelDaConversa', 'esquecerTituloAuto']);
  const A = { id: 'a', engine: 'claude', sessaoId: 'S', titulo: 'Velho', el: {} };
  const F = { id: 'f', engine: 'claude', resumeAnterior: 'S', titulo: 'Velho', el: {} };
  const R = { id: 'r', engine: 'claude', forkPendente: true, resumeId: 'S', titulo: '(ramo) Velho', el: {} };
  c.panes.set('a', A); c.panes.set('r', R); c.panesFundo.set('f', F);
  const ficha = { sessaoId: 'S', engine: 'claude', titulo: 'Velho' };
  const fichaRamo = { sessaoId: 'S', engine: 'claude', titulo: '(ramo) Velho', fork: true };
  c.cfg.abas = [{ id: 'outra', paineis: [ficha, fichaRamo] }];
  c.fichasPendentes.set('pc', [{ sessaoId: 'S', engine: 'claude', titulo: 'Velho' }]);
  assert.equal(c.renomearPaineisDaConversa({ id: 'S', engine: 'claude' }, 'Nome Novo'), 2);
  for (const P of [A, F]) { assert.equal(P.titulo, 'Nome Novo'); assert.equal(P.nomeManual, true); assert.equal(P.tituloAuto, false); assert.equal(P._nomeGravadoEm, 'S|Nome Novo'); }
  assert.equal(R.titulo, '(ramo) Velho', 'o ramo que ainda nao nasceu e outra conversa');
  assert.deepEqual([ficha.titulo, ficha.nomeManual], ['Nome Novo', true]);
  assert.equal(fichaRamo.titulo, '(ramo) Velho');
  assert.equal(c.fichasPendentes.get('pc')[0].titulo, 'Nome Novo');
  assert.ok(c.chamadas.includes('savePanes'), 'a ficha e gravada: reabrir o app traz o nome novo');
  // a lista usa isto no fim da edicao
  const lc = recorte('linhaConversa');
  assert.match(lc, /renomearPaineisDaConversa\(s, novo\)/);
});

/* =====================================================================
   3) conversa nova nao herda o nome da anterior
   ===================================================================== */
test('achado 3: trocar a pasta do painel zera o nome (e o seu nao vai pro id novo); apagar e ficha recusada tambem', async () => {
  const c = ctxTela(['trocarPastaDoPainel', 'zerarNomeDaConversa', 'esquecerTituloAuto', 'antesDaTroca', 'avisarTroca'], {
    destravarPainel() {}, limparSessoesDeTodosMotores() {}, limparPlano() {}, limparAuditoria() {}, mostrarPastaNoPainel() {},
    nomePasta: (p) => p, shortPath: (p) => p, atualizarGit() {}, loadTree() {}, focusPane: null,
  });
  const P = { id: 'p', engine: 'claude', cwd: 'C:\\velha', sessaoId: 'S', titulo: 'Meu Nome', nomeManual: true, tituloAuto: false, _nomeGravadoEm: 'S|Meu Nome', el: {} };
  await c.trocarPastaDoPainel(P, 'C:\\nova');
  assert.equal(P.cwd, 'C:\\nova');
  assert.deepEqual([P.titulo, P.nomeManual, P.tituloAuto, P._nomeGravadoEm, P.sessaoId], ['', false, false, null, null]);
  // o 3-palavras tambem sai
  const Q = { id: 'q', engine: 'codex', cwd: 'C:\\x', titulo: 'Tres Palavras Aqui', tituloAuto: true, _tituloAutoChave: 'k', el: {} };
  await c.trocarPastaDoPainel(Q, 'C:\\y');
  assert.deepEqual([Q.titulo, Q.tituloAuto, Q._tituloAutoChave], ['', false, null]);
  // apagar conversa pela lista e ficha de motor recusado passam pelo mesmo zerar
  assert.match(recorte('linhaConversa'), /Q\.forkPendente = false; zerarNomeDaConversa\(Q\)/);
  assert.match(restaurarMiolo(), /if \(!mesmoMotor\) zerarNomeDaConversa\(P\)/);
  // e o newPane nao tem mais a copia antiga (sem zerar) da troca de pasta
  assert.match(recorte('newPane'), /const trocarCwdDoPainel = \(p\) => trocarPastaDoPainel\(P, p\)/);
});

/* =====================================================================
   4) religar pendente cancelado por troca: recado certo, so' o que voce digitou
   13) trocar esforco com ele trabalhando avisa
   ===================================================================== */
test('achado 4: trocar modo/modelo/pasta no "Religo em N s" diz que cancelou a religacao (nao "resposta interrompida") e o chip Continuar volta', async () => {
  const c2 = ctxTela(['destravarPainel', 'cancelarReligar', 'devolverFilaAoCampo', 'devolverAoCampo', 'antesDaTroca', 'avisarTroca',
    'guardarConversaPraVoltar', 'trocarModeloDoPainel', 'trocarEsforco', 'trocarPastaDoPainel', 'zerarNomeDaConversa', 'esquecerTituloAuto'], {
    esforcosDe: () => [{ id: 'low' }, { id: 'medium' }, { id: 'high' }], mostrarContinuar: (P) => { P._chip = true; },
    limparSessoesDeTodosMotores() {}, limparPlano() {}, limparAuditoria() {}, mostrarPastaNoPainel() {},
    nomePasta: (p) => p, shortPath: (p) => p, atualizarGit() {}, loadTree() {}, focusPane: null,
  });
  const religando = (id) => ({ id, engine: 'claude', busy: true, started: false, sessaoId: 'S', effort: 'high', model: 'claude-sonnet-5',
    _religar: { n: 1, timer: 0 }, el: { campo: campoFalso() }, hist: [{ quem: 'Você', texto: 'x' }] });
  const A = religando('a');
  await c2.trocarModeloDoPainel(A, { id: 'claude-opus-5', padraoEffort: 'high' });
  const deA = c2.notas.filter((n) => n.id === 'a').map((n) => n.t);
  assert.ok(deA.some((t) => /Cancelei a religação automática \(você trocou o modelo\)\. Mande "continue" pra retomar\./.test(t)), deA.join(' | '));
  assert.ok(!deA.some((t) => /interrompida/.test(t)), 'nao havia resposta rodando');
  assert.equal(A._religar, null); assert.equal(A._chip, true, 'o chip Continuar volta');
  // resposta de verdade rodando: continua o recado de sempre
  const B = { id: 'b', engine: 'claude', busy: true, started: true, sessaoId: 'S', effort: 'high', el: { campo: campoFalso() }, hist: [] };
  await c2.trocarModeloDoPainel(B, { id: 'claude-opus-5', padraoEffort: 'high' });
  assert.ok(c2.notas.some((n) => n.id === 'b' && /interrompida para trocar o modelo/.test(n.t)));
  // pasta: pasta nova e' conversa nova -- nada de "mande continue"
  const C = religando('c');
  await c2.trocarPastaDoPainel(C, 'C:\\nova');
  const deC = c2.notas.filter((n) => n.id === 'c').map((n) => n.t).join(' | ');
  assert.match(deC, /Cancelei a religação automática \(você trocou a pasta\)\. Pasta nova começa conversa nova\./);
  // as outras trocas usam o mesmo aviso (modo, reserva, motor, conta)
  for (const f of ['girarModo', 'menuModos', 'menuModelos']) assert.match(recorte(f), /avisarTroca\(P, antes/, f);
  assert.match(recorte('trocarMotor'), /Cancelei a religação automática \(você trocou o motor\)/);
  assert.match(recorte('pararPaineisDaConta'), /avisarTroca\(Q, antes, 'a conta'/);
});

test('achado 4: o religar cancelado devolve SO o que voce digitou (sem o contexto montado), junto do texto que ja estava no campo', () => {
  const c = ctxTela(['cancelarReligar', 'devolverFilaAoCampo', 'devolverAoCampo'], { mostrarContinuar: (P) => { P._chip = true; } });
  const P = { id: 'p', engine: 'codex', busy: true, el: { campo: campoFalso('rascunho que eu estava escrevendo') }, anexos: [],
    _religar: { n: 1, timer: 0, texto: 'CONTEXTO DA TROCA...\nrefatora o modulo\n\nArquivos que anexei:\n- C:\\a.png', digitado: 'refatora o modulo', anexos: [{ path: 'C:\\a.png' }], contexto: 'CONTEXTO DA TROCA...\n' } };
  assert.equal(c.cancelarReligar(P), true);
  const v = P.el.campo.value;
  assert.match(v, /refatora o modulo/);
  assert.match(v, /rascunho que eu estava escrevendo/, 'o que estava no campo nao some');
  assert.doesNotMatch(v, /CONTEXTO|Arquivos que anexei/);
  assert.deepEqual(P.anexos.map((a) => a.path), ['C:\\a.png'], 'o anexo volta pro lugar dele');
  assert.equal(P.passarContexto, 'CONTEXTO DA TROCA...\n', 'o contexto volta pra ir na proxima');
  assert.ok(!P._chip, 'mensagem de volta no campo: sem chip "continue"');
  // e o send guarda o digitado separado do envio
  assert.match(recorte('send'), /P\._religar\.texto = envio; Object\.assign\(P\._religar, \{ digitado: text, anexos, contexto: contextoUsado \|\| null \}\)/);
});

test('achado 13: trocar o esforco com ele trabalhando avisa que a resposta foi cortada', async () => {
  const c = ctxTela(['trocarEsforco', 'destravarPainel', 'cancelarReligar', 'devolverFilaAoCampo', 'devolverAoCampo', 'antesDaTroca', 'avisarTroca']);
  const P = { id: 'p', engine: 'claude', busy: true, started: true, sessaoId: 'S', effort: 'high', el: { campo: campoFalso() } };
  await c.trocarEsforco(P, 'low');
  assert.ok(c.notas.some((n) => n.e && /interrompida para trocar o esforço/.test(n.t)), JSON.stringify(c.notas));
  assert.equal(P.resumeId, 'S');
  const Q = { id: 'q', engine: 'claude', busy: false, started: true, sessaoId: 'S', effort: 'high', el: { campo: campoFalso() } };
  const antes = c.notas.length;
  await c.trocarEsforco(Q, 'low');
  assert.equal(c.notas.length, antes, 'parado: sem aviso');
});

/* =====================================================================
   5) ramo pela Torre nasce no modelo da sessao de fora; reserva nao decide
   ===================================================================== */
test('achado 5: "continuar aqui (ramo)" da Torre nasce no modelo da sessao de fora (senao no padrao)', async () => {
  const criados = [];
  const c = ctxTela(['continuarSessaoDeFora'], {
    abaAtual: () => ({ id: 'pc', tipo: 'local' }), baseNome: (p) => p, faixaDeRamo() {}, torreVisivel: () => false,
    newPane: (o) => { const P = { id: 'n' + criados.length, ...o, el: {} }; criados.push(P); return P; },
    modeloDaOrigem: async (s) => { c.pedido = s; return { model: 'claude-opus-5[1m]', effort: '' }; },
  });
  await c.continuarSessaoDeFora({ sessionId: 'S1', cwd: 'C:\\proj', name: 'Cofre' });
  assert.equal(criados[0].model, 'claude-opus-5[1m]');
  assert.deepEqual([c.pedido.engine, c.pedido.id, c.pedido.remoto], ['claude', 'S1', false]);
  assert.equal(criados[0].forkPendente, true);
  c.modeloDaOrigem = async () => ({ model: '' });
  await c.continuarSessaoDeFora({ sessionId: 'S2', cwd: 'C:\\proj' });
  assert.equal(criados[1].model, undefined, 'sem modelo conhecido: o padrao do newPane');
});

test('achado 5: com a reserva ligada, a ultima resposta do Sonnet reserva nao decide o modelo da conversa reaberta', () => {
  const ctx = vm.createContext({ cfg: { fallbackClaude: true } });
  vm.runInContext([constLista('MODELOS_CLAUDE'), constLinha('APELIDO_CLAUDE'), constLinha('COM_1M'), constLinha('RESERVA_CLAUDE'), recorte('modeloDoHistorico')].join('\n'), ctx);
  const m = (model) => ({ role: 'bot', text: 'x', model });
  assert.equal(ctx.modeloDoHistorico([m('claude-fable-5-1'), m('claude-sonnet-5')]), 'claude-fable-5-1');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5'), m('claude-sonnet-5'), m('<synthetic>')]), 'claude-opus-5[1m]');
  assert.equal(ctx.modeloDoHistorico([m('claude-sonnet-5')]), 'claude-sonnet-5', 'so Sonnet: e Sonnet');
  ctx.cfg.fallbackClaude = false;
  assert.equal(ctx.modeloDoHistorico([m('claude-fable-5-1'), m('claude-sonnet-5')]), 'claude-sonnet-5', 'sem reserva ligada, o Sonnet foi escolha sua');
});

/* =====================================================================
   6) Esc no menu "@" com a IA trabalhando so fecha o menu
   ===================================================================== */
test('achado 6: Esc no navegador do menu "@" segura o ouvinte do campo (stopImmediatePropagation)', () => {
  const i = APP.indexOf('const nav = (ev) => {');
  assert.ok(i > 0);
  const nav = APP.slice(i, APP.indexOf('P._navArq = nav;', i));
  const esc = nav.slice(nav.indexOf("ev.key === 'Escape'"));
  assert.match(esc, /ev\.stopImmediatePropagation\(\); ev\.preventDefault\(\);[\s\S]*fecharMenus\(\)/);
  // o ouvinte do menu e' de captura no MESMO campo: roda antes do ouvinte que para a IA
  assert.match(APP, /inp\.addEventListener\('keydown', nav, true\);/);
  // simulacao: dois ouvintes no mesmo alvo, captura primeiro
  const ouvintes = [];
  const alvo = { add: (fn) => ouvintes.push(fn) };
  let parouIA = 0, fechou = 0;
  const ev = { key: 'Escape', imediato: false, stopImmediatePropagation() { this.imediato = true; }, preventDefault() {}, stopPropagation() {} };
  alvo.add((e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); fechou++; } });
  alvo.add(() => { parouIA++; });
  for (const fn of ouvintes) { fn(ev); if (ev.imediato) break; }
  assert.deepEqual([fechou, parouIA], [1, 0]);
});

/* =====================================================================
   11) modo real nao sobra de uma conversa pra outra
   ===================================================================== */
test('achado 11: abrir conversa pela lista e "conversa nova" zeram o modo real da sessao anterior', () => {
  for (const f of ['openSession', 'novaConversa']) assert.match(recorte(f), /P\.modoReal = null; P\._avisouModo = false;/, f);
});

/* =====================================================================
   12) ramo que cai antes do init: a mensagem volta; origem apagada nao promete
   ===================================================================== */
function ctxRamo() {
  const tq = (n) => constLinha(n);
  const c = ctxTela([], { agendarReligar: () => { throw new Error('religou'); }, avisarLoginDoServidor() {}, desligarMotor() {}, window: { api: { paradaEm: () => 0 } } });
  vm.runInContext([tq('RELIGA_NO_TURNO'), tq('ESPERAS_RELIGAR'), tq('JANELA_RELIGAR'), ...['motivoPraNaoReligar', 'devolverFilaAoCampo', 'devolverAoCampo', 'motorCaiu', 'zerarNomeDaConversa', 'esquecerTituloAuto'].map((n) => recorte(n))].join('\n'), c);
  return c;
}
test('achado 12: o ramo cai antes de nascer -> a mensagem volta pro campo (junto do rascunho) e o balao sai', () => {
  const c = ctxRamo();
  const balao = { removido: 0, remove() { this.removido++; } };
  const entrada = { quem: 'Você', texto: 'faz o relatorio' };
  const R = { id: 'r', engine: 'claude', busy: true, forkPendente: true, resumeId: 'ORIG', hist: [entrada], anexos: [], el: { campo: campoFalso('rascunho') },
    _envioAtual: { digitado: 'faz o relatorio', anexos: [], contexto: null, escrito: { balao, entrada } } };
  assert.equal(c.motorCaiu(R, { emTurno: true, tipo: 'queda', motivo: '' }, false), 'ramo');
  assert.match(R.el.campo.value, /faz o relatorio/); assert.match(R.el.campo.value, /rascunho/);
  assert.equal(balao.removido, 1); assert.equal(R.hist.length, 0);
  assert.equal(R.forkPendente, true, 'queda comum: o ramo segue pendente');
  assert.ok(c.notas.some((n) => /cria o ramo de novo/.test(n.t) && /voltou pro campo/.test(n.t)));
});
test('achado 12: origem apagada ("No conversation found"): diz que a original sumiu, desliga o ramo e nao promete criar', () => {
  const c = ctxRamo();
  const R = { id: 'r', engine: 'claude', busy: true, forkPendente: true, resumeId: 'ORIG', resumeAnterior: 'ORIG', titulo: '(ramo) Cofre', tituloAuto: true, hist: [], anexos: [], el: { campo: campoFalso() },
    _envioAtual: { digitado: 'continua daqui', anexos: [], contexto: null, escrito: null } };
  c.motorCaiu(R, { emTurno: true, tipo: 'ausente', motivo: 'No conversation found with session ID: ORIG' }, false);
  assert.equal(R.forkPendente, false);
  assert.equal(R.resumeId, null);
  assert.equal(R.titulo, '', 'o "(ramo) …" era de uma conversa que nao existe');
  assert.match(R.el.campo.value, /continua daqui/);
  const t = c.notas.map((n) => n.t).join(' | ');
  assert.match(t, /não existe mais/);
  assert.doesNotMatch(t, /cria o ramo/);
});

/* =====================================================================
   14) nome de 3 palavras: (a) pela sessao que pediu, (b) depois de "continue", (c) interruptor
   ===================================================================== */
function ctxTitulo(resposta) {
  let solta;
  const c = ctxTela(['tituloCurto', 'soComandoOuContinue', 'tituloCurto3', 'podeGerarTituloAuto', 'iniciarTituloAuto', 'esquecerTituloAuto', 'aoNascerSessao', 'gravarNomeDoPainel',
    'const MIN_PRA_APARAR', 'const PALAVRAS_DO_NOME'], { loadHist() {} });
  const i = APP.indexOf('const PALAVRA_VAZIA');
  vm.runInContext(APP.slice(i, APP.indexOf(']);', i) + 3).replace(/^const /, 'var '), c);
  c.window.api.tituloAuto = () => new Promise((r) => { solta = () => r({ titulo: resposta }); });
  c.soltar = () => solta();
  return c;
}
test('achado 14a: painel fechado com o nome voando -> o nome vai pra conversa que pediu (auto), nao se perde', async () => {
  const c = ctxTitulo('Relatorio Vendas Agosto');
  const P = { id: 'p', engine: 'claude', sessaoId: null, titulo: '', hist: [], el: {} };
  const pr = c.iniciarTituloAuto(P, 'monta o relatorio de vendas de agosto');
  c.aoNascerSessao(P, { id: 'S-NOVA', file: 'x.jsonl' });   // o endereco chega depois do pedido
  P.morto = true;                                            // fechou o painel
  c.soltar(); await pr;
  const r = c.chamadas.find((x) => x.renomear && x.renomear.id === 'S-NOVA');
  assert.ok(r, JSON.stringify(c.chamadas));
  assert.deepEqual([r.renomear.engine, r.renomear.nome, r.renomear.auto], ['claude', 'Relatorio Vendas Agosto', true]);
});
test('achado 14a: motor trocado (ou outra conversa) com o nome voando -> grava na conversa que pediu e nao aplica no painel', async () => {
  const c = ctxTitulo('Relatorio Vendas Agosto');
  const P = { id: 'p', engine: 'claude', sessaoId: 'S-CLAUDE', titulo: '', hist: [], el: {} };
  const pr = c.iniciarTituloAuto(P, 'monta o relatorio de vendas de agosto');
  const provisorio = P.titulo;
  P.engine = 'codex'; P.sessaoId = 'THR-CODEX';               // trocou pro Codex
  c.soltar(); await pr;
  assert.equal(P.titulo, provisorio, 'o painel (agora Codex) nao ganha o nome');
  assert.ok(!P.tituloAuto);
  const r = c.chamadas.find((x) => x.renomear);
  assert.deepEqual([r.renomear.engine, r.renomear.id, r.renomear.auto], ['claude', 'S-CLAUDE', true]);
  assert.equal(P._tituloAutoEmVoo, false, 'nada fica esperando pra sempre');
  // outra conversa (openSession/novaConversa chamam esquecerTituloAuto)
  const d = ctxTitulo('Nome Da Anterior');
  const Q = { id: 'q', engine: 'claude', sessaoId: 'S1', titulo: '', hist: [], el: {} };
  const pq = d.iniciarTituloAuto(Q, 'faz a planilha de custos');
  d.esquecerTituloAuto(Q); Q.sessaoId = 'S2'; Q.titulo = 'Conversa Da Lista';
  d.soltar(); await pq;
  assert.equal(Q.titulo, 'Conversa Da Lista');
  assert.equal(d.chamadas.find((x) => x.renomear).renomear.id, 'S1');
});
test('achado 14b: 1a mensagem "continue"//comando e o aiTitle deu nome: a demanda de verdade ainda ganha o de 3 palavras', () => {
  const c = ctxTitulo('x');
  const P = { id: 'p', engine: 'claude', sessaoId: 'S', titulo: 'Titulo Do Claude', _tituloDe: 'ai', hist: [{ quem: 'Você', texto: '/model' }], el: {} };
  assert.equal(c.podeGerarTituloAuto(P, 'monta o relatorio de vendas'), true);
  P._tituloDe = 'curto';
  assert.equal(c.podeGerarTituloAuto(P, 'monta o relatorio de vendas'), true);
  // nome seu, da lista, da ficha ou do ramo continua barrando
  for (const extra of [{ nomeManual: true }, { _tituloDe: null }, { tituloAuto: true }, { titulo: '(ramo) Cofre', _tituloDe: null }]) {
    assert.equal(c.podeGerarTituloAuto({ ...P, ...extra }, 'monta o relatorio'), false, JSON.stringify(extra));
  }
  // o aiTitle marca a origem dele (e o ramo nao)
  const bn = recorte('buscarNome');
  assert.match(bn, /P\._tituloDe = ehRamo \? null : 'ai'/);
  assert.match(recorte('send'), /P\.titulo = tituloCurto\(text\); P\._tituloDe = 'curto';/);
});
test('achado 14c: interruptor "Dar nome automático às conversas novas" nos Ajustes (Painéis e conversas) -> cfg.tituloAuto, ligado por padrao', () => {
  const html = lerFonte('renderer', 'index.html');
  const g = html.indexOf('<h3 class="aj-titulo">Painéis e conversas</h3>');
  const fim = html.indexOf('</section>', g);
  const grupo = html.slice(g, fim);
  assert.match(grupo, /<label class="chave"><input type="checkbox" id="chkTituloAuto"><span><span class="aj-nome">Dar nome automático às conversas novas<\/span><span class="aj-desc">Usa o Haiku do Claude pra resumir a 1ª mensagem em 3 palavras — vale pra todos os motores\.<\/span><\/span><\/label>/);
  // boot: le com padrao ligado e grava a troca
  const i = APP.indexOf("const chkTit = $('#chkTituloAuto');");
  assert.ok(i > 0);
  const boot = APP.slice(i, APP.indexOf("const chkSug = $('#chkSugestoes');", i));
  assert.match(boot, /chkTit\.checked = cfg\.tituloAuto !== false;/);
  assert.match(boot, /cfg\.tituloAuto = !!e\.target\.checked;\s*await window\.api\.setConfig\(cfg\);/);
  // desligado: nao pede nome
  const c = ctxTitulo('x');
  c.cfg.tituloAuto = false;
  assert.equal(c.podeGerarTituloAuto({ id: 'p', titulo: '', hist: [] }, 'monta o relatorio'), false);
  c.cfg.tituloAuto = undefined;
  assert.equal(c.podeGerarTituloAuto({ id: 'p', titulo: '', hist: [] }, 'monta o relatorio'), true);
});

/* =====================================================================
   15) padrao novo nos Ajustes alcanca o painel vazio
   ===================================================================== */
test('achado 15: mudar o modelo padrao alcanca painel vazio com o padrao; painel com conversa, mensagem ou modelo seu fica', () => {
  const c = ctxTela(['aplicarPadraoNosPaineisVazios', 'catalogoClaude'], {});
  vm.runInContext([constLista('MODELOS_CLAUDE'), 'var catClaudeCache = { chave: "", lista: MODELOS_CLAUDE };',
    APP.split('\n').find((l) => l.startsWith('const idModeloPadraoClaude')).replace(/^const /, 'var ')].join('\n'), c);
  const base = { engine: 'claude', model: 'claude-sonnet-5', modeloDoPadrao: true, hist: [], el: {} };
  const vazio = { id: 'v', ...base };
  const comConversa = { id: 'c', ...base, sessaoId: 'S' };
  const comMsg = { id: 'm', ...base, hist: [{ quem: 'Você', texto: 'oi' }] };
  const seu = { id: 's', ...base, modeloDoPadrao: false };
  const codex = { id: 'x', ...base, engine: 'codex', model: 'gpt-6-astra' };
  for (const P of [vazio, comConversa, comMsg, seu, codex]) c.panes.set(P.id, P);
  c.cfg.defModelClaude = 'claude-opus-5[1m]';
  assert.equal(c.aplicarPadraoNosPaineisVazios(), 1);
  assert.equal(vazio.model, 'claude-opus-5[1m]');
  assert.deepEqual([comConversa.model, comMsg.model, seu.model, codex.model], ['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5', 'gpt-6-astra']);
  // quem marca: o fillModels quando poe o padrao; a escolha no menu desmarca
  assert.match(recorte('fillModels'), /P\.modeloDoPadrao = true/);
  assert.match(recorte('trocarModeloDoPainel'), /P\.modeloDoPadrao = false/);
  assert.match(recorte('ligarSeletorModeloClaude'), /aplicarPadraoNosPaineisVazios\(\)/);
});

/* =====================================================================
   16) trocar a conta com debate rodando para o debate tambem
   ===================================================================== */
test('achado 16: trocar a conta do PC com debate rodando avisa, pede ok e para o debate (servidor nao mexe)', async () => {
  const perguntas = [], parados = [];
  const c = ctxTela(['pararPaineisDaConta', 'antesDaTroca', 'avisarTroca', 'const MOTOR_DO_DEBATE'], {
    paineisDaConta: () => [], destravarPainel() {},
    confirm: (t) => { perguntas.push(t); return true; },
  });
  c.window.api.debateList = async () => [{ id: 'd1', status: 'running' }, { id: 'd0', status: 'completed' }];
  c.window.api.debateStop = async (id) => { parados.push(id); return {}; };
  assert.equal(await c.pararPaineisDaConta('claude', { remoto: null, chave: 'pc' }), 0);
  assert.equal(perguntas.length, 1); assert.match(perguntas[0], /1 debate em andamento usa esta conta e vai parar agora/);
  assert.deepEqual(parados, ['d1']);
  // desistiu: nada para
  c.confirm = () => false;
  assert.equal(await c.pararPaineisDaConta('codex', { remoto: null, chave: 'pc' }), null);
  assert.deepEqual(parados, ['d1']);
  // conta do servidor: o debate roda aqui, nao e' dela
  let perguntou = 0; c.confirm = () => { perguntou++; return true; };
  await c.pararPaineisDaConta('claude', { remoto: { host: 'h' }, chave: 'hugo@h' });
  assert.equal(perguntou, 0); assert.deepEqual(parados, ['d1']);
});

/* =====================================================================
   17) .excalidraw.md do Obsidian no visor
   ===================================================================== */
test('achado 17: .excalidraw.md com cena em json abre no quadro; comprimido avisa; sem cena e texto', () => {
  const c = ctxTela(['cenaDoExcalidrawMd']);
  const cena = '{"type":"excalidraw","version":2,"elements":[{"id":"a","type":"rectangle"}],"appState":{}}';
  const md = '---\nexcalidraw-plugin: parsed\n---\n# Text Elements\nOla\n\n%%\n# Drawing\n```json\n' + cena + '\n```\n%%\n';
  assert.equal(c.cenaDoExcalidrawMd(md).json, cena);
  assert.equal(c.cenaDoExcalidrawMd(md.replace(/\n/g, '\r\n')).json, cena.replace(/\n/g, '\r\n'));
  assert.deepEqual({ ...c.cenaDoExcalidrawMd('%%\n# Drawing\n```compressed-json\nN4KAkARALgngDgUwgLgAQQQDwMYEMA2AlgCYBOuA7hADTgQBuCpAzoQPYB2KqAXrNrwBuhQ\n```\n%%') }, { comprimida: true });
  assert.equal(c.cenaDoExcalidrawMd('# nota comum\n```json\n{"a":1}\n```'), null, 'json que nao e cena');
  assert.equal(c.cenaDoExcalidrawMd('# so texto'), null);
  const va = recorte('verArquivo');
  assert.match(va, /\/\\\.excalidraw\\\.md\$\/i\.test\(caminho\) && a\.tipo === 'texto'/);
  assert.match(va, /abrirQuadro\(P, cena\.json\)/);
  assert.match(va, /Desenho comprimido do Obsidian/);
});

/* =====================================================================
   18) historico reaberto/restaurado com caminho clicavel
   ===================================================================== */
test('achado 18: conversa reaberta pela lista e painel restaurado passam o texto pelo linkarArquivos, como a fala ao vivo', () => {
  for (const [f, corpo] of [['openSession', recorte('openSession')], ['restaurarPaineisMiolo', restaurarMiolo()]]) assert.match(corpo, /desenharBlocosExcalidraw\(P, b\.el\);\s*linkarArquivos\(P, b\.el\); marcarLinksWeb\(b\.el\); botoesDeCodigo\(b\.el\);/, f);
});
