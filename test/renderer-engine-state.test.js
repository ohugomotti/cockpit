const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function funcao(nome) {
  const inicio = source.indexOf('function ' + nome + '(');
  assert.notEqual(inicio, -1, 'helper real não encontrado: ' + nome);
  const abre = source.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < source.length; i++) {
    if (source[i] === '{') nivel++;
    if (source[i] === '}' && --nivel === 0) return source.slice(source.slice(inicio - 6, inicio) === 'async ' ? inicio - 6 : inicio, i + 1);
  }
  throw new Error('helper incompleto: ' + nome);
}

function carregar(nomes, extras = {}) {
  const ctx = vm.createContext({ ...extras });
  vm.runInContext(nomes.map(funcao).join('\n'), ctx);
  return ctx;
}

test('guardarConversaPraVoltar conserva a thread do Codex', () => {
  const ctx = carregar(['guardarEstadoDoMotor', 'guardarConversaPraVoltar']);
  const P = { engine: 'codex', sessaoId: 'thread-anterior', resumeId: null,
    model: 'gpt-6-astra', effort: 'xhigh', mode: 'auto-edit' };
  ctx.guardarConversaPraVoltar(P);
  assert.equal(P.resumeId, 'thread-anterior');
  assert.equal(P.engineStates.codex.resumeId, 'thread-anterior');
});

test('Codex → Claude → Codex restaura sessão, modelo, esforço e modo próprios', () => {
  const cfg = { defEffort: 'medium', defMode: 'manual' };
  const ctx = carregar(['guardarEstadoDoMotor', 'restaurarEstadoDoMotor'], {
    cfg, modoValido: (_engine, mode) => mode || 'manual',
  });
  const P = { engine: 'codex', model: 'gpt-6-astra', effort: 'xhigh', mode: 'auto-edit',
    sessaoId: 'thread-codex', sessaoFile: '', sessaoRemota: false, resumeId: null };
  ctx.guardarEstadoDoMotor(P);
  P.engine = 'claude';
  assert.equal(ctx.restaurarEstadoDoMotor(P, 'claude'), false);
  P.model = 'claude-opus-5'; P.effort = 'high'; P.mode = 'manual'; P.sessaoId = 'sessao-claude';
  ctx.guardarEstadoDoMotor(P);
  P.engine = 'codex';
  assert.equal(ctx.restaurarEstadoDoMotor(P, 'codex'), true);
  assert.deepEqual({ model: P.model, effort: P.effort, mode: P.mode, resumeId: P.resumeId },
    { model: 'gpt-6-astra', effort: 'xhigh', mode: 'auto-edit', resumeId: 'thread-codex' });
});

test('ramo Claude pendente sobrevive à troca de motor e ainda inicia com fork', () => {
  const cfg = { defEffort: 'medium', defMode: 'manual', sugestoes: true, fallbackClaude: false };
  const ctx = carregar(['guardarEstadoDoMotor', 'restaurarEstadoDoMotor', 'opcoesDeStart'], {
    cfg, modoValido: (_engine, mode) => mode || 'manual', esforcoDe: (P) => P.effort,
    remotoDoPane: () => null, conectoresForaDaAba: () => [],
  });
  const P = { id: 'p1', engine: 'claude', cwd: 'C:\\projeto', model: 'claude-opus-5',
    effort: 'high', mode: 'manual', resumeId: 'origem', sessaoId: null,
    sessaoFile: '', sessaoRemota: false, forkPendente: true };
  ctx.guardarEstadoDoMotor(P);
  P.engine = 'codex'; ctx.restaurarEstadoDoMotor(P, 'codex'); ctx.guardarEstadoDoMotor(P);
  P.engine = 'claude'; ctx.restaurarEstadoDoMotor(P, 'claude');
  const start = ctx.opcoesDeStart(P);
  assert.equal(start.resumeId, 'origem');
  assert.equal(start.fork, true);

  // Depois que o start efetiva o fork, o fluxo normal limpa a intenção.
  P.forkPendente = false; ctx.guardarEstadoDoMotor(P);
  assert.equal(P.engineStates.claude.forkPendente, false);
});

test('trocar pasta invalida sessões de todos os motores e conserva preferências', () => {
  const ctx = carregar(['limparSessoesDeTodosMotores']);
  const P = { engineStates: {
    codex: { model: 'gpt-6-astra', effort: 'xhigh', sessaoId: 'thread-A', resumeId: 'thread-A', forkPendente: false },
    claude: { model: 'claude-opus-5', effort: 'high', sessaoId: null, resumeId: 'origem-A', forkPendente: true },
  } };
  ctx.limparSessoesDeTodosMotores(P);
  assert.deepEqual(JSON.parse(JSON.stringify(P.engineStates)), {
    codex: { model: 'gpt-6-astra', effort: 'xhigh', sessaoId: null, resumeId: null, forkPendente: false,
      sessaoFile: '', sessaoRemota: false, worktree: null },
    claude: { model: 'claude-opus-5', effort: 'high', sessaoId: null, resumeId: null, forkPendente: false,
      sessaoFile: '', sessaoRemota: false, worktree: null },
  });
});

test('trocarMotor real conserva a árvore isolada do Claude sem levá-la ao Codex', async () => {
  const noop = () => {};
  const cfg = { defEffort: 'medium', defMode: 'manual' };
  const ctx = carregar(['guardarEstadoDoMotor', 'restaurarEstadoDoMotor', 'trocarMotor', 'opcoesDeStart'], {
    cfg, motorDisponivel: { codex: true, claude: true },
    window: { api: { paneStop: async () => {}, setConfig: noop } },
    modoValido: (_engine, mode) => mode || 'manual', esforcoDe: P => P.effort,
    remotoDoPane: () => null, nomeDoMotor: e => e, conectoresForaDaAba: () => [],
    destravarPainel: noop, pintarTokens: noop, esquecerPassos: noop, limparPlano: noop,
    limparAuditoria: noop, zerarTurno: noop, fillModels: noop, paintEngine: noop,
    pintarModo: noop, setDot: noop, savePanes: noop, marcaTroca: noop, mostrarPastaNoPainel: noop,
  });
  const P = { id: 'p-worktree', engine: 'claude', cwd: 'C:\\projeto', model: 'claude-opus-5',
    effort: 'high', mode: 'manual', resumeId: 'origem-isolada', sessaoId: null,
    forkPendente: true, worktree: 'correcao-isolada', hist: [], blocks: new Map() };
  await ctx.trocarMotor(P, 'codex');
  assert.equal(P.worktree, null);
  assert.equal(ctx.opcoesDeStart(P).worktree, undefined);
  // A ficha JSON mantém também o estado do motor que não está visível.
  P.engineStates = JSON.parse(JSON.stringify(P.engineStates));
  await ctx.trocarMotor(P, 'claude');
  const start = ctx.opcoesDeStart(P);
  assert.equal(start.resumeId, 'origem-isolada');
  assert.equal(start.fork, true);
  assert.equal(start.worktree, 'correcao-isolada');
});

test('catálogo atrasado mostra fallback sem trocar modelo ou esforço de thread ativa', () => {
  const botao = { innerHTML: '' };
  const modelos = [{ id: 'gpt-novo', nome: 'GPT novo', efforts: ['medium'], padrao: true }];
  const ctx = carregar(['fillModels'], {
    modelosDe: () => modelos,
    esforcosDe: () => [{ id: 'medium' }],
    modeloAtual: () => modelos[0],
    ico: () => '',
    $: () => botao,
  });
  const P = { engine: 'codex', model: 'gpt-antigo', effort: 'xhigh', resumeId: 'thread-1', el: {} };
  ctx.fillModels(P);
  assert.equal(P.model, 'gpt-antigo');
  assert.equal(P.effort, 'xhigh');
  assert.match(botao.innerHTML, /gpt-antigo \(indisponível\)/);
});

test('configuração antiga sem engineStates continua ganhando fallback válido', () => {
  const botao = { innerHTML: '' };
  const modelos = [{ id: 'padrao', nome: 'Padrão', efforts: ['medium'], padrao: true, padraoEffort: 'medium' }];
  const ctx = carregar(['fillModels'], {
    modelosDe: () => modelos,
    esforcosDe: () => [{ id: 'medium' }],
    modeloAtual: (P) => modelos.find((m) => m.id === P.model) || modelos[0],
    ico: () => '', $: () => botao,
  });
  const P = { engine: 'codex', model: '', effort: 'valor-antigo', resumeId: null, sessaoId: null, el: {} };
  ctx.fillModels(P);
  assert.equal(P.model, 'padrao');
  assert.equal(P.effort, 'medium');
});

test('restauração entrega resumeId ao newPane antes do primeiro fillModels', () => {
  const ctx = carregar(['opcoesDoPainelSalvo']);
  const ficha = { engine: 'codex', model: 'gpt-6-astra', effort: 'xhigh', mode: 'auto-edit',
    sessaoId: 'thread-salva', cwd: 'C:\\projeto', titulo: 'Astra' };
  const opts = ctx.opcoesDoPainelSalvo(ficha, 'aba-1');
  assert.equal(opts.resumeId, 'thread-salva');

  // É este estado que newPane possui quando chama o helper real fillModels.
  const botao = { innerHTML: '' };
  const modelos = [{ id: '', nome: 'padrão do Codex', efforts: ['medium'], padrao: true }];
  const fill = carregar(['fillModels'], {
    modelosDe: () => modelos, esforcosDe: () => [{ id: 'medium' }],
    modeloAtual: () => modelos[0], ico: () => '', $: () => botao,
  });
  const P = { ...opts, sessaoId: null, started: false, resumeAnterior: null, el: {} };
  fill.fillModels(P);
  assert.equal(P.model, 'gpt-6-astra');
  assert.equal(P.effort, 'xhigh');
});

test('metadados assíncronos da mensagem não são descartados', () => {
  const ctx = carregar(['metadadosDaMensagem']);
  const questions = [{ question: 'Qual caminho?' }];
  const memoryCitation = { fontes: ['MEMORY.md'] };
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.metadadosDaMensagem({ delivery: 'async', questions, memoryCitation, interno: 1 }))),
    { delivery: 'async', questions, memoryCitation },
  );
});

test('catálogo vazio nunca quebra o painel e mantém modelo atual',()=>{
 const ctx=carregar(['modelosDe','modeloAtual','esforcosDe'],{MODELOS_CODEX:[],EF_DESC_PT:{},remotoDoPane:()=>null});
 const p={engine:'codex',model:'modelo-em-uso',effort:'high'};
 assert.equal(ctx.modeloAtual(p).id,'modelo-em-uso');assert.equal(ctx.esforcosDe(p)[0].id,'medium');
 assert.equal(p.model,'modelo-em-uso');
});
test('catálogo remoto pertence ao painel e destino, sem herdar modelos locais',()=>{
 let remote={usuario:'qa',host:'vps-a',porta:22,chave:'key'};
 const ctx=carregar(['modelosDe','modeloAtual'],{MODELOS_CODEX:[{id:'local',efforts:['high']}],remotoDoPane:()=>remote});
 const p={engine:'codex',model:'servidor',uiCodexModels:[{id:'servidor',efforts:['low']}],uiCodexModelsScope:JSON.stringify(['qa','vps-a',22,'key'])};
 assert.equal(ctx.modeloAtual(p).id,'servidor');assert.equal(ctx.modeloAtual(p).efforts[0],'low');
 remote={...remote,host:'vps-b'};assert.equal(ctx.modeloAtual(p).efforts.length,0);
 remote=null;assert.equal(ctx.modeloAtual(p).id,'local');
});
