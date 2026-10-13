'use strict';
/* Rodada 2 da leva 5i, achado 8: o Grok nativo nao funciona com o CLI oficial 1.0.50 (o "streaming-json" dele e' ACP, nao os eventos que o motor
   nativo entende), e o logo/menu/"Nova conversa" ja abriam o ACP com "grok agent stdio". Mas um painel NOVO ainda nascia no Grok nativo quando
   o config antigo dizia lastEngine 'grok' (o newPane() sem motor usa o ultimo), quando a ficha salva era de um painel Grok antigo e quando se
   abria "outro painel ao lado" de um. O newPane agora passa o pedido pelo painelSemGrokNativo.

   As funcoes sao recortadas do app.js de verdade e rodadas num vm. A corrida do newPane inteiro, com a funcao de verdade, esta em
   test/auditoria1.test.js (o "achado 8", que ja tem o DOM pequeno do newPane). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const IAS = require('../src/renderer/acp-presets');

const APP = lerFonte('renderer', 'app.js');
const copia = (v) => JSON.parse(JSON.stringify(v));   // o que nasce no vm tem outro Object.prototype
const GROK = 'grok agent stdio';

function ctxDe({ cfg = {}, comModulo = true } = {}) {
  const ctx = vm.createContext({ cfg, MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], window: comModulo ? { CockpitAcpPresets: IAS } : {} });
  vm.runInContext(['function comandoDoGrokNoAcp(', 'function opcoesDoMotor(', 'function painelSemGrokNativo('].map((n) => pegarBloco(APP, n, n)).join('\n'), ctx);
  return ctx;
}

test('o comando do Grok no ACP e o do registro oficial', () => {
  assert.equal(IAS.GROK_COMANDO, GROK);
  assert.equal(ctxDe().comandoDoGrokNoAcp(), GROK);
  assert.equal(ctxDe({ comModulo: false }).comandoDoGrokNoAcp(), '', 'sem o modulo das IAs: vazio');
});

test('painel novo sem motor, com lastEngine "grok" de um config antigo: nasce no ACP rodando "grok agent stdio"', () => {
  const ctx = ctxDe({ cfg: { lastEngine: 'grok' } });
  assert.deepEqual(copia(ctx.painelSemGrokNativo({})), { engine: 'acp', model: GROK });
  assert.deepEqual(copia(ctx.painelSemGrokNativo({ abaId: 'pc', cwd: 'C:\\proj' })), { engine: 'acp', model: GROK, abaId: 'pc', cwd: 'C:\\proj' });
  assert.deepEqual(copia(ctx.painelSemGrokNativo(undefined)), { engine: 'acp', model: GROK }, 'newPane() sem argumento nenhum');
});

test('ficha de um painel Grok antigo (e "abrir outro painel ao lado" de um): vira o ACP; a conversa nativa nao segue, o resto da ficha sim', () => {
  const ctx = ctxDe();
  const ficha = { engine: 'grok', cwd: 'C:\\pedro', model: '', mode: 'auto-edit', effort: 'high', engineStates: { grok: { sessaoId: 'g1' } }, managedWorktree: null,
    resumeId: 'sessao-nativa-do-grok', titulo: 'Pesquisa', abaId: 'pc', coluna: 2, tempoTrabalho: { total: 5 }, fork: true };
  const novo = copia(ctx.painelSemGrokNativo(ficha));
  assert.equal(novo.engine, 'acp');
  assert.equal(novo.model, GROK, 'o comando vira o "modelo" do painel ACP (o do Grok nativo, vazio, nao sobrescreve)');
  assert.equal(Object.hasOwn(novo, 'resumeId'), false, 'a sessao nativa do Grok nao abre no ACP');
  assert.equal(Object.hasOwn(novo, 'fork'), false, 'e o ramo pendente era dela');
  for (const campo of ['cwd', 'mode', 'effort', 'titulo', 'abaId', 'coluna', 'managedWorktree']) assert.deepEqual(novo[campo], copia(ficha[campo]), campo + ' segue');
  assert.deepEqual(novo.engineStates, { grok: { sessaoId: 'g1' } }, 'o estado guardado de cada motor segue (so o ACP e o motor de agora)');
  assert.deepEqual(copia(ctx.painelSemGrokNativo({ engine: 'grok', cwd: 'C:\\x', model: 'qualquer-coisa-antiga' })), { engine: 'acp', model: GROK, cwd: 'C:\\x' }, 'nem o modelo antigo sobrescreve o comando');
  // o objeto de quem chamou nao e alterado
  assert.equal(ficha.engine, 'grok');
  assert.equal(ficha.resumeId, 'sessao-nativa-do-grok');
});

test('os outros motores (e o ACP de outra IA) nao mudam: o mesmo objeto volta, com ou sem lastEngine "grok"', () => {
  for (const cfg of [{}, { lastEngine: 'grok' }, { lastEngine: 'claude' }, { lastEngine: 'inventado' }]) {
    const ctx = ctxDe({ cfg });
    for (const pedido of [{ engine: 'claude', model: 'claude-sonnet-5-5' }, { engine: 'codex', resumeId: 'thr' }, { engine: 'gemini' },
      { engine: 'acp', model: 'opencode acp' }, { engine: 'acp', model: GROK, resumeId: 'sessao-acp' }]) {
      assert.ok(ctx.painelSemGrokNativo(pedido) === pedido, JSON.stringify(cfg) + ' ' + JSON.stringify(pedido));
    }
  }
  // sem motor pedido e com ultimo motor que nao e o Grok (ou invalido): nada muda
  for (const cfg of [{}, { lastEngine: 'codex' }, { lastEngine: 'inventado' }, { lastEngine: 'acp' }]) {
    const pedido = { cwd: 'C:\\p' };
    assert.ok(ctxDe({ cfg }).painelSemGrokNativo(pedido) === pedido, JSON.stringify(cfg));
  }
});

test('sem o modulo das IAs (nao deveria acontecer) o Grok segue nativo, com a ficha intacta', () => {
  const ctx = ctxDe({ cfg: { lastEngine: 'grok' }, comModulo: false });
  const ficha = { engine: 'grok', resumeId: 'g1', fork: true, model: '' };
  assert.ok(ctx.painelSemGrokNativo(ficha) === ficha);
  const semMotor = { cwd: 'C:\\p' };
  assert.ok(ctx.painelSemGrokNativo(semMotor) === semMotor);
});

test('o newPane passa o pedido pelo painelSemGrokNativo antes de escolher o motor, e a tela de abertura segue pelo mesmo opcoesDoMotor', () => {
  const np = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));
  assert.ok(np.length > 1000, 'nao achei o corpo do newPane');
  const antes = np.indexOf('opts = painelSemGrokNativo(opts);');
  assert.ok(antes > 0, 'o newPane precisa reescrever o pedido (opts) pelo painelSemGrokNativo');
  assert.ok(antes < np.indexOf('motorDoPainelNovo(opts.engine'), 'e antes de escolher o motor');
  assert.ok(antes < np.indexOf("const id = 'p' + bootId"), 'e antes de o painel nascer');
  // o conserto reaproveita o opcoesDoMotor (nao uma segunda copia da regra)
  assert.match(pegarBloco(APP, 'function painelSemGrokNativo(', 'painelSemGrokNativo'), /return opcoesDoMotor\('grok', resto\);/);
  // o mock de testes/raiz.js tem o falso (os testes que rodam o newPane com os globais falsos nao quebram)
  const { globaisFalsos } = require('../testes/raiz');
  const falsos = globaisFalsos();
  assert.equal(typeof falsos.painelSemGrokNativo, 'function');
  const pedido = { engine: 'grok' };
  assert.ok(falsos.painelSemGrokNativo(pedido) === pedido, 'o falso devolve o pedido como veio');
});
