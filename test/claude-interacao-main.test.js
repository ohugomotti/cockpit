'use strict';
/* Tarefa 8 (26/09/2026): o lado do main da pergunta e do plano do Claude.
   O claudeMessage, o descartarPermissoes, os handlers IPC e o claudeStart
   de verdade (recortados do main.js), num vm com um emit falso e um stdin
   falso por processo (molde: test/cockpit-observability-integration.test.js
   e test/modo-claude.test.js). O que importa aqui e' seguranca:
   - pergunta e plano nunca viram "approval" nem se aprovam sozinhos;
   - cada pedido recebe UMA resposta, so' no processo que perguntou;
   - o "sem pedir permissao" so' fica disponivel no Plano que veio dele. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');
const interacao = require('../src/claude-interacao');

const MAIN = lerFonte('main.js');

/* "ipcMain.handle('x', (...) => { ... });" inteiro, a partir do fonte */
function handlerDe(nome) {
  const i = MAIN.indexOf("ipcMain.handle('" + nome + "'");
  assert.ok(i >= 0, 'handler nao encontrado: ' + nome);
  const resto = MAIN.slice(i);
  return resto.slice(0, resto.indexOf('=> {')) + pegarBloco(resto, '=> {', nome) + ');';
}

/* um processo do Claude: so' o stdin interessa (cada linha e' uma resposta) */
function processo(geracao, modo, modoAntesDoPlano) {
  const escritos = [];
  return {
    escritos, geracao, modo, modoAntesDoPlano: modoAntesDoPlano || null, comCanal: modo !== 'bypass', buf: '',
    proc: { stdin: { write: (linha) => { escritos.push(JSON.parse(linha)); return true; } } },
  };
}

function mainFalso() {
  const handlers = {}, eventos = [];
  const ctx = {
    console, JSON, String, Array, Object, Map, Set, RegExp, Math, Date, Error, Number,
    handlers, eventos, interacao, path, interactionBroker: {cancelScope(){}},
    ipcMain: { handle: (nome, fn) => { handlers[nome] = fn; } },
    claudePanes: new Map(), pedidosClaude: new Map(), pendingApprovals: new Map(), autoLiberadas: new Map(),
    perguntasCodex: new Map(), perguntasVistas: new Set(),
    remoteEngines: { questionOwns: () => false, approvalOwns: () => false },
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...(data || {}) }),
    observabilidade: { observarClaude() {} },
    claudeToolArg: () => 'arg', mudancaDaFerramenta: () => null,
    marcaSub: () => '', temSeq: () => true, somaSeq() {}, seqDoPane: () => 1, limparSeq() {},
    limparAnexosClaudeRemotos() {}, descartarPerguntasCodex() {},
    acp: { responderPermissao() {} }, codexReply() {}, proto: { buildApprovalResponse: () => ({}), buildUserInputResponse: () => ({}) },
    // a pergunta do Claude nao passa pela pasta da caixa de perguntas do MCP
    PASTA_PERGUNTAS: () => { throw new Error('a pergunta do Claude nao pode cair no caminho dos arquivos'); },
    fs: {},
  };
  vm.createContext(ctx);
  vm.runInContext(MAIN.slice(MAIN.indexOf('function claudeMessage('), MAIN.indexOf('const LIM_DIFF')), ctx);
  vm.runInContext(pegarBloco(MAIN, 'function descartarPermissoes(', 'descartarPermissoes'), ctx);
  for (const h of ['pergunta:responder', 'pane:plano', 'pane:autoLiberar']) vm.runInContext(handlerDe(h), ctx);
  return ctx;
}

const pedir = (c, paneId, requestId, tool_name, input, extra) => c.claudeMessage(paneId, {
  type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name, input, ...(extra || {}) },
});
const ASK = { questions: [
  { question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul' }, { label: 'Verde' }] },
  { question: 'Quais telas?', header: 'Telas', multiSelect: true, options: [{ label: 'Início' }, { label: 'Torre' }] },
] };
const PLANO = { plan: '## Plano\n1. Ler o app.js', planFilePath: 'C:\\Users\\qa\\.claude\\plans\\plano.md' };
const de = (c, kind) => c.eventos.filter((e) => e.kind === kind);

test('AskUserQuestion vira a caixa de perguntas e ExitPlanMode vira o plano pronto: nenhum vira approval', () => {
  const c = mainFalso();
  const st = processo(1, 'plan', 'bypass');
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'req-1', 'AskUserQuestion', ASK);
  pedir(c, 'p1', 'req-2', 'ExitPlanMode', PLANO);
  assert.equal(de(c, 'approval').length, 0);
  const [perg] = de(c, 'pergunta');
  assert.match(perg.id, /^claude_q_1_/);
  assert.equal(perg.paneId, 'p1');
  assert.equal(perg.bloqueante, true);
  assert.deepEqual(JSON.parse(JSON.stringify(perg.perguntas)), JSON.parse(JSON.stringify(interacao.perguntasDoAsk(ASK))));
  const [plano] = de(c, 'plano-pronto');
  assert.match(plano.chave, /^claude_p_1_/);
  assert.equal(plano.plano, PLANO.plan);
  assert.equal(plano.arquivoDoPlano, PLANO.planFilePath);
  assert.equal(st.escritos.length, 0, 'ninguem respondeu sozinho');
});

test('liberado "sempre" no painel nao aprova plano nem pergunta; pane:autoLiberar recusa os dois', () => {
  const c = mainFalso();
  const st = processo(1, 'plan', 'bypass');
  c.claudePanes.set('p1', st);
  // como se o "Sempre permitir ExitPlanMode" tivesse sido clicado antes desta versao
  c.autoLiberadas.set('p1', new Set(['ExitPlanMode', 'AskUserQuestion']));
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  pedir(c, 'p1', 'r2', 'AskUserQuestion', ASK);
  assert.equal(st.escritos.length, 0, 'ExitPlanMode guardado no auto-liberar nao se aprova sozinho');
  assert.equal(de(c, 'auto-liberado').length, 0);
  assert.equal(de(c, 'plano-pronto').length, 1);
  assert.equal(de(c, 'pergunta').length, 1);
  // o IPC do "Sempre permitir" recusa as duas; outra ferramenta continua liberavel
  const c2 = mainFalso();
  assert.equal(c2.handlers['pane:autoLiberar'](null, { paneId: 'p1', tool: 'ExitPlanMode' }), false);
  assert.equal(c2.handlers['pane:autoLiberar'](null, { paneId: 'p1', tool: 'AskUserQuestion' }), false);
  assert.equal(c2.autoLiberadas.has('p1'), false);
  assert.equal(c2.handlers['pane:autoLiberar'](null, { paneId: 'p1', tool: 'Bash' }), true);
  assert.ok(c2.autoLiberadas.get('p1').has('Bash'));
});

test('Executar: uma resposta so, no stdin do processo que perguntou, com setMode do modo de antes', async () => {
  const esperado = { manual: 'default', 'auto-edit': 'acceptEdits', auto: 'auto', bypass: 'bypassPermissions' };
  for (const [antes, doCli] of Object.entries(esperado)) {
    const c = mainFalso();
    const st = processo(7, 'plan', antes);
    c.claudePanes.set('p1', st);
    pedir(c, 'p1', 'req-9', 'ExitPlanMode', PLANO);
    const { chave } = de(c, 'plano-pronto')[0];
    const r = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: true, texto: '' });
    assert.deepEqual({ ...r }, { ok: true, modo: antes });
    // dois cliques: o segundo nao acha mais o pedido
    const r2 = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: true, texto: '' });
    assert.ok(r2.error, 'o segundo envio e recusado');
    assert.equal(st.escritos.length, 1, antes + ': uma control_response por pedido');
    assert.deepEqual(JSON.parse(JSON.stringify(st.escritos[0])), {
      type: 'control_response',
      response: { request_id: 'req-9', subtype: 'success', response: {
        behavior: 'allow', updatedInput: PLANO, updatedPermissions: [{ type: 'setMode', mode: doCli, destination: 'session' }] } },
    });
  }
});

test('Executar sem saber o modo de antes volta pro Manual; o painel errado nao responde', async () => {
  const c = mainFalso();
  const st = processo(3, 'plan', null);   // Plano restaurado de ficha antiga: sem o modo de antes
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  const { chave } = de(c, 'plano-pronto')[0];
  const errado = await c.handlers['pane:plano'](null, { paneId: 'p2', chave, aprovar: true });
  assert.ok(errado.error);
  assert.equal(st.escritos.length, 0);
  const r = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: true });
  assert.equal(r.modo, 'manual');
  assert.equal(st.escritos[0].response.response.updatedPermissions[0].mode, 'default');
});

test('Ajustar leva o texto; ajuste vazio nao responde e o plano continua esperando', async () => {
  const c = mainFalso();
  const st = processo(1, 'plan', 'bypass');
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  const { chave } = de(c, 'plano-pronto')[0];
  const vazio = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: false, texto: '   ' });
  assert.ok(vazio.error);
  assert.equal(st.escritos.length, 0);
  const r = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: false, texto: 'troca o passo 2' });
  assert.deepEqual({ ...r }, { ok: true });
  assert.equal(st.escritos.length, 1);
  assert.deepEqual({ ...st.escritos[0].response.response },
    { behavior: 'deny', message: 'O usuário quer ajustar o plano antes de executar: troca o passo 2' });
  // "aprovar" que nao e' true (texto, numero) nunca aprova
  pedir(c, 'p1', 'r2', 'ExitPlanMode', PLANO);
  const k2 = de(c, 'plano-pronto')[1].chave;
  await c.handlers['pane:plano'](null, { paneId: 'p1', chave: k2, aprovar: 'true', texto: 'x' });
  assert.equal(st.escritos[1].response.response.behavior, 'deny');
});

test('pergunta: a resposta vai por control_response indexada pelo texto da pergunta, uma vez so', async () => {
  const c = mainFalso();
  const st = processo(2, 'manual');
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'r-perg', 'AskUserQuestion', ASK);
  const { id } = de(c, 'pergunta')[0];
  const r = await c.handlers['pergunta:responder'](null, { id, respostas: ['Verde', ['Início', 'Torre']] });
  assert.deepEqual({ ...r }, { ok: true });
  const r2 = await c.handlers['pergunta:responder'](null, { id, respostas: ['Azul', ['Torre']] });
  assert.ok(r2.error, 'a segunda resposta e recusada (e nao cai na pasta de arquivos)');
  assert.equal(st.escritos.length, 1);
  const resp = st.escritos[0].response;
  assert.equal(resp.request_id, 'r-perg');
  assert.equal(resp.response.behavior, 'allow');
  assert.deepEqual({ ...resp.response.updatedInput.answers }, { 'Qual cor?': 'Verde', 'Quais telas?': 'Início, Torre' });
  // fechar sem responder = deny
  pedir(c, 'p1', 'r-2', 'AskUserQuestion', ASK);
  const id2 = de(c, 'pergunta')[1].id;
  await c.handlers['pergunta:responder'](null, { id: id2, cancelado: true });
  assert.deepEqual({ ...st.escritos[1].response.response }, { behavior: 'deny', message: 'O usuário fechou as perguntas sem responder.' });
});

test('processo trocado: a resposta velha nao cai no processo novo nem no antigo', async () => {
  const c = mainFalso();
  const velho = processo(1, 'plan', 'bypass');
  c.claudePanes.set('p1', velho);
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  pedir(c, 'p1', 'r2', 'AskUserQuestion', ASK);
  const { chave } = de(c, 'plano-pronto')[0];
  const { id } = de(c, 'pergunta')[0];
  const novo = processo(2, 'plan', 'bypass');
  c.claudePanes.set('p1', novo);   // religou (queda) sem passar pelo descarte
  const r = await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: true });
  assert.ok(r.error);
  assert.equal(r.encerrado, true);
  const rp = await c.handlers['pergunta:responder'](null, { id, respostas: ['Azul', ['Torre']] });
  assert.ok(rp.error);
  assert.equal(velho.escritos.length + novo.escritos.length, 0, 'nada escrito em processo nenhum');
  assert.equal(de(c, 'plano-cancelado').length, 1, 'a tela tira o cartao');
  assert.equal(de(c, 'pergunta-cancelada').length, 1, 'a tela tira a caixa');
  // processo parando de proposito tambem nao recebe
  const c2 = mainFalso();
  const parando = processo(5, 'plan', 'bypass');
  c2.claudePanes.set('p1', parando);
  pedir(c2, 'p1', 'r1', 'ExitPlanMode', PLANO);
  parando.parandoDeProposito = true;
  await c2.handlers['pane:plano'](null, { paneId: 'p1', chave: de(c2, 'plano-pronto')[0].chave, aprovar: true });
  assert.equal(parando.escritos.length, 0);
});

test('descartarPermissoes (fim de turno, parar, fechar) fecha cartao e caixa e responde cada pedido uma vez', async () => {
  const c = mainFalso();
  const st = processo(4, 'plan', 'bypass');
  c.claudePanes.set('p1', st);
  const outro = processo(5, 'manual');
  c.claudePanes.set('p2', outro);
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  pedir(c, 'p1', 'r2', 'AskUserQuestion', ASK);
  pedir(c, 'p2', 'r3', 'AskUserQuestion', ASK);
  const { chave } = de(c, 'plano-pronto')[0];
  const [{ id }] = de(c, 'pergunta');
  c.descartarPermissoes('p1');
  assert.deepEqual(de(c, 'plano-cancelado').map((e) => [e.paneId, e.chave]), [['p1', chave]]);
  assert.deepEqual(de(c, 'pergunta-cancelada').map((e) => [e.paneId, e.id]), [['p1', id]]);
  assert.equal(st.escritos.length, 2, 'cada pedido pendurado recebe um "nao" (o motor nao fica esperando)');
  assert.ok(st.escritos.every((l) => l.response.response.behavior === 'deny'));
  assert.equal(outro.escritos.length, 0, 'o outro painel nao e tocado');
  // clique atrasado depois do descarte: nada mais sai
  assert.ok((await c.handlers['pane:plano'](null, { paneId: 'p1', chave, aprovar: true })).error);
  assert.ok((await c.handlers['pergunta:responder'](null, { id, respostas: ['Azul', ['Torre']] })).error);
  assert.equal(st.escritos.length, 2);
  // o fim do turno (result) passa pelo mesmo descarte
  pedir(c, 'p1', 'r4', 'ExitPlanMode', PLANO);
  c.claudeMessage('p1', { type: 'result', subtype: 'success', result: 'ok' });
  assert.equal(de(c, 'plano-cancelado').length, 2);
  assert.equal(st.escritos.length, 3);
  assert.equal(de(c, 'turn-end').length, 1);
});

test('pedido desconhecido que precisa do usuario e recusado com recado, nunca vira Permitir de um clique', () => {
  const c = mainFalso();
  const st = processo(1, 'manual');
  c.claudePanes.set('p1', st);
  c.autoLiberadas.set('p1', new Set(['FerramentaNova']));
  pedir(c, 'p1', 'r1', 'FerramentaNova', { x: 1 }, { requires_user_interaction: true });
  assert.equal(de(c, 'approval').length, 0);
  assert.equal(de(c, 'auto-liberado').length, 0);
  assert.equal(st.escritos.length, 1);
  assert.equal(st.escritos[0].response.response.behavior, 'deny');
  assert.match(st.escritos[0].response.response.message, /FerramentaNova/);
  assert.equal(de(c, 'note').length, 1, 'o recado aparece na conversa');
  // o resto continua como era: Bash pede permissao, o do Cockpit se libera sozinho
  pedir(c, 'p1', 'r2', 'Bash', { command: 'ls' });
  assert.equal(de(c, 'approval').length, 1);
  pedir(c, 'p1', 'r3', 'mcp__cockpit__plano', { itens: [] });
  assert.equal(st.escritos.length, 2);
  assert.equal(st.escritos[1].response.response.behavior, 'allow');
});

test('um plano por painel: o pedido novo substitui o velho, que recebe um "nao" (nenhum pedido fica sem cartao)', async () => {
  const c = mainFalso();
  const st = processo(1, 'plan', 'bypass');
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'r1', 'ExitPlanMode', PLANO);
  pedir(c, 'p1', 'r2', 'ExitPlanMode', { plan: '## Outro' });
  const [velho, novo] = de(c, 'plano-pronto');
  assert.deepEqual(de(c, 'plano-cancelado').map((e) => e.chave), [velho.chave]);
  assert.equal(st.escritos.length, 1);
  assert.equal(st.escritos[0].response.request_id, 'r1');
  assert.equal(st.escritos[0].response.response.behavior, 'deny');
  const r = await c.handlers['pane:plano'](null, { paneId: 'p1', chave: novo.chave, aprovar: true });
  assert.equal(r.ok, true);
  assert.equal(st.escritos.length, 2);
  assert.equal(st.escritos[1].response.request_id, 'r2');
  assert.ok((await c.handlers['pane:plano'](null, { paneId: 'p1', chave: velho.chave, aprovar: true })).error);
  assert.equal(st.escritos.length, 2, 'o velho nunca recebe um segundo envio');
});

test('perguntas vazias ou tortas sao recusadas na hora (o motor nao fica esperando uma caixa que nao abre)', () => {
  const c = mainFalso();
  const st = processo(1, 'manual');
  c.claudePanes.set('p1', st);
  pedir(c, 'p1', 'r1', 'AskUserQuestion', { questions: [] });
  assert.equal(de(c, 'pergunta').length, 0);
  assert.equal(st.escritos.length, 1);
  assert.equal(st.escritos[0].response.response.behavior, 'deny');
});

test('com o canal de permissao, pergunta e plano nao viram passo; sem ele (Sem pedir permissao) segue como era', () => {
  const fala = (nome) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-' + nome, name: nome, input: {} }] } });
  const c = mainFalso();
  c.claudePanes.set('p1', processo(1, 'plan', 'bypass'));
  c.claudeMessage('p1', fala('AskUserQuestion'));
  c.claudeMessage('p1', fala('ExitPlanMode'));
  c.claudeMessage('p1', fala('Bash'));
  assert.deepEqual(de(c, 'tool-start').map((e) => e.name), ['Bash']);
  const d = mainFalso();
  d.claudePanes.set('p1', processo(1, 'bypass'));
  d.claudeMessage('p1', fala('AskUserQuestion'));
  assert.deepEqual(de(d, 'tool-start').map((e) => e.name), ['AskUserQuestion']);
});

/* ---------------- claudeStart: as flags ---------------- */
function procFalso() {
  const nada = () => {};
  return { stdin: { on: nada, write: nada }, stdout: { setEncoding: nada, on: nada }, stderr: { setEncoding: nada, on: nada }, on: nada };
}
function iniciar(paneId, opts) {
  const chamadas = [], argumentosRemotos = [];
  const ctx = {
    console, JSON, String, Array, Object, Map, Set, RegExp, Math, Date, Error, Number,
    interacao, path, chamadas, hostCapabilities: new Map(), interactionBroker: {cancelScope(){}, callTool(){}},
    createRemoteHostBridge(options) {
      const bridge = require('../src/cockpit-remote-host').createRemoteHostBridge(options);
      const command = bridge.command;
      bridge.command = args => { argumentosRemotos.push([...args]); return command(args); };
      return bridge;
    },
    claudeScope: () => ({ paneId, generation: 1, engine: 'claude', threadId: 'ficticio', cwd: '/srv', origin: { kind: 'remote', host: 'vps', user: 'hugo', port: 22 } }),
    HOME: 'C:\\Users\\qa', CLAUDE_PROJ: 'C:\\Users\\qa\\.claude\\projects', claudeGeracao: 0,
    claudePanes: new Map(), claudeCwd: new Map(), claudeRemoto: new Map(),
    claudeStop() {}, claudeTravaDoModo: (id, modo) => 'C:\\dados\\claude-modo-' + id + '-' + modo + '.json',
    configMcpDoPainel: () => '', ligarVigiaPerguntas() {}, INSTRUCOES_COCKPIT: 'x',
    sessaoLocalExiste: () => false, crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    dentroDeGit: () => true, nomeDeServidorMcp: (n) => n, emit() {},
    ssgValido: () => true, cdRemoto: () => 'cd ~', qLinux: (a) => "'" + a + "'",
    buildEnv: () => ({}), claudeBin: () => 'claude', encodeCwd: (d) => String(d).replace(/[\\/.:]/g, '-'),
    observabilidade: { encerrarPainel() {} },
    spawnBin: (bin, args) => { chamadas.push({ bin, args }); return procFalso(); },
  };
  vm.createContext(ctx);
  vm.runInContext(MAIN.slice(MAIN.indexOf('const CLAUDE_MODE'), MAIN.indexOf(';', MAIN.indexOf('const CLAUDE_MODE')) + 1).replace('const ', 'var '), ctx);
  vm.runInContext(pegarBloco(MAIN, 'function claudeStart(', 'claudeStart'), ctx);
  assert.equal(ctx.claudeStart(paneId, opts), true);
  return { argv: chamadas[0].args, bin: chamadas[0].bin, st: ctx.claudePanes.get(paneId), argumentosRemotos, ctx };
}

test('claudeStart: --allow-dangerously-skip-permissions so no Plano que veio do "Sem pedir permissao"', () => {
  const plano = iniciar('p1', { approval: 'plan', modoAntesDoPlano: 'bypass', cwd: 'C:\\proj' });
  assert.ok(plano.argv.includes('--allow-dangerously-skip-permissions'));
  assert.ok(!plano.argv.includes('--dangerously-skip-permissions'), 'disponivel, nao ligado');
  assert.deepEqual([...plano.argv.slice(plano.argv.indexOf('--permission-mode'), plano.argv.indexOf('--permission-mode') + 2)], ['--permission-mode', 'plan']);
  assert.ok(plano.argv.includes('--permission-prompt-tool'));
  assert.equal(plano.st.modo, 'plan');
  assert.equal(plano.st.modoAntesDoPlano, 'bypass');
  assert.equal(plano.st.comCanal, true);
  assert.ok(plano.st.geracao > 0);
  for (const antes of ['manual', 'auto-edit', 'auto', undefined, 'plan', 'inventado']) {
    const r = iniciar('p1', { approval: 'plan', modoAntesDoPlano: antes, cwd: 'C:\\proj' });
    assert.ok(!r.argv.includes('--allow-dangerously-skip-permissions'), 'Plano vindo de ' + antes);
    assert.ok(!r.argv.includes('--dangerously-skip-permissions'));
  }
  // modo de antes que nao e' de executar nao fica guardado no processo
  assert.equal(iniciar('p1', { approval: 'plan', modoAntesDoPlano: 'inventado', cwd: 'C:\\proj' }).st.modoAntesDoPlano, null);
  // fora do Plano o "de antes" nao vale nada
  for (const modo of ['manual', 'auto-edit', 'auto']) {
    const r = iniciar('p1', { approval: modo, modoAntesDoPlano: 'bypass', cwd: 'C:\\proj' });
    assert.ok(!r.argv.includes('--allow-dangerously-skip-permissions'), modo);
    assert.equal(r.st.modoAntesDoPlano, null, modo);
  }
  // Sem pedir permissao: como sempre (sem canal)
  const bypass = iniciar('p1', { approval: 'bypass', modoAntesDoPlano: 'bypass', cwd: 'C:\\proj' });
  assert.ok(bypass.argv.includes('--dangerously-skip-permissions'));
  assert.ok(!bypass.argv.includes('--allow-dangerously-skip-permissions'));
  assert.ok(!bypass.argv.includes('--permission-prompt-tool'));
  assert.equal(bypass.st.comCanal, false);
});

test('claudeStart: painel remoto continua sem canal e sem a flag nova, mesmo pedindo Plano', () => {
  const r = iniciar('p1', { approval: 'plan', modoAntesDoPlano: 'bypass', cwd: '/srv',
    remoto: { host: 'vps', usuario: 'hugo', chave: 'C:\\k', caminhoRemoto: '~/app' } });
  assert.equal(r.bin, 'ssh');
  const comando = r.argv[r.argv.length - 1];
  assert.ok(comando.includes('if command -v node'), 'o comando SSH usa a ponte temporária com fallback');
  assert.equal(r.argumentosRemotos.length, 1);
  assert.ok(r.argumentosRemotos[0].includes('--dangerously-skip-permissions'));
  assert.ok(!r.argumentosRemotos[0].includes('--allow-dangerously-skip-permissions'));
  assert.ok(!r.argumentosRemotos[0].includes('--permission-prompt-tool'));
  assert.equal(typeof r.st.remoteHost.route, 'function');
  r.st.remoteHost.dispose();
  assert.equal(r.st.comCanal, false);
});

test('claudeStart: cada processo ganha uma geracao nova (a chave dos pedidos muda junto)', () => {
  const r = iniciar('p1', { approval: 'plan', modoAntesDoPlano: 'bypass', cwd: 'C:\\proj' });
  const g1 = r.st.geracao;
  r.ctx.claudeStart('p1', { approval: 'plan', modoAntesDoPlano: 'bypass', cwd: 'C:\\proj' });
  assert.ok(r.ctx.claudePanes.get('p1').geracao > g1);
});

test('pane:start passa o modo de antes do Plano para o claudeStart', () => {
  const i = MAIN.indexOf("ipcMain.handle('pane:start'");
  const corpo = pegarBloco(MAIN.slice(i), '=> {', 'pane:start');
  assert.match(MAIN.slice(i, i + 400), /modoAntesDoPlano/, 'pane:start recebe o campo');
  assert.match(corpo, /claudeStart\(paneId, \{[^}]*modoAntesDoPlano[^}]*\}\)/);
});
