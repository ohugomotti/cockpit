'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'função real: ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, i + 1);
  }
  throw new Error('função incompleta: ' + name);
}

function context(api = {}) {
  const noop = () => {};
  const messages = [];
  const ctx = vm.createContext({
    cfg: { defEffort: 'medium', defMode: 'manual', sugestoes: true }, focusPane: null,
    window: { api }, note: (_p, message, error) => messages.push({ message, error }),
    modoValido: (_engine, value) => value, esforcoDe: p => p.effort,
    remotoDoPane: () => null, conectoresForaDaAba: () => [],
    destravarPainel: noop, esquecerPassos: noop, pintarAnexos: noop, pintarTokens: noop,
    pintarNome: noop, esconderPermissao: noop, limparPlano: noop, limparAuditoria: noop,
    zerarTurno: noop, mostrarPastaNoPainel: noop, atualizarGit: noop, setDot: noop,
    savePanes: noop, shortPath: value => value,
  });
  vm.runInContext(['cwdGitDoPainel', 'guardarEstadoDoMotor', 'limparSessoesDeTodosMotores',
    'restaurarEstadoDoMotor', 'opcoesDeStart', 'opcoesDoPainelSalvo', 'aplicarWorktree'].map(functionSource).join('\n'), ctx);
  return { ctx, messages };
}

function pane(engine = 'codex') {
  return {
    id: 'p1', engine, cwd: 'C:\\repo', model: engine === 'codex' ? 'gpt-6-astra' : 'claude-opus-5',
    effort: 'xhigh', mode: 'manual', sessaoId: 'antiga', resumeId: 'antiga', hist: ['conversa antiga'],
    sessaoFile: 'antiga.jsonl', worktree: null, managedWorktree: null,
    blocks: new Map(), tools: new Map(), chat: { innerHTML: 'antiga' },
    engineStates: {
      codex: { model: 'gpt-6-astra', mode: 'manual', effort: 'xhigh', resumeId: 'codex-antigo' },
      claude: { model: 'claude-opus-5', mode: 'auto-edit', effort: 'high', resumeId: 'claude-antigo', forkPendente: true },
    },
  };
}

test('entrar em pasta isolada limpa sessões de ambas as árvores e conserva escolhas dos motores', async () => {
  const target = { root: 'C:\\repo', path: 'C:\\isoladas\\uma', branch: 'cockpit/uma', isMain: false };
  const stops = [];
  const { ctx } = context({ gitWorktreesOpen: async () => target, paneStop: async value => stops.push(value) });
  const P = pane();
  await ctx.aplicarWorktree(P, target);
  assert.equal(stops.length, 1);
  assert.equal(P.cwd, target.path);
  assert.equal(P.managedWorktree.branch, target.branch);
  assert.equal(P.worktree, null);
  assert.equal(P.sessaoId, null);
  assert.equal(P.hist.length, 0);
  assert.equal(P.engineStates.claude.resumeId, null);
  assert.equal(P.engineStates.claude.forkPendente, false);
  assert.equal(P.model, 'gpt-6-astra');
  P.engine = 'claude'; ctx.restaurarEstadoDoMotor(P, 'claude');
  const claudeStart = ctx.opcoesDeStart(P);
  assert.equal(claudeStart.cwd, target.path);
  assert.equal(claudeStart.worktree, undefined, 'a flag Claude não cria outra worktree aninhada');
  assert.equal(P.model, 'claude-opus-5');
  assert.equal(P.effort, 'high');
  assert.equal(P.mode, 'auto-edit');
  ctx.guardarEstadoDoMotor(P);
  P.engine = 'codex'; ctx.restaurarEstadoDoMotor(P, 'codex');
  assert.equal(ctx.opcoesDeStart(P).cwd, target.path);
  assert.equal(P.model, 'gpt-6-astra');
  assert.equal(P.effort, 'xhigh');
  assert.equal(P.mode, 'manual');
});

test('voltar à principal troca cwd sem usar remoção ou merge', async () => {
  const calls = [];
  const { ctx } = context({ gitWorktreesOpen: async request => {
    calls.push(request); return { root: 'C:\\repo', path: 'C:\\repo', branch: 'main', isMain: true };
  }, paneStop: async () => {} });
  const P = pane('claude'); P.cwd = 'C:\\isoladas\\uma';
  P.managedWorktree = { root: 'C:\\repo', path: P.cwd, branch: 'cockpit/uma' };
  await ctx.aplicarWorktree(P, null);
  assert.equal(calls[0].path, 'C:\\repo');
  assert.equal(calls[0].cwd, 'C:\\repo');
  assert.equal(P.cwd, 'C:\\repo');
  assert.equal(P.managedWorktree, null);
  assert.equal(P.model, 'claude-opus-5');
});

test('restauração conserva descritor gerenciado e caminho Git respeita worktree legado', () => {
  const { ctx } = context();
  const managedWorktree = { root: 'C:\\repo', path: 'C:\\isoladas\\uma', branch: 'cockpit/uma' };
  const opts = ctx.opcoesDoPainelSalvo({ engine: 'codex', cwd: managedWorktree.path, managedWorktree }, 'aba');
  assert.equal(opts.managedWorktree, managedWorktree);
  assert.equal(ctx.cwdGitDoPainel(opts), managedWorktree.path);
  assert.equal(ctx.cwdGitDoPainel({ cwd: 'C:\\repo', worktree: 'legado' }), 'C:\\repo/.claude/worktrees/legado');
});

test('destino inválido não fecha o motor nem perde a conversa', async () => {
  let stopped = false;
  const { ctx, messages } = context({ gitWorktreesOpen: async () => ({ error: 'pasta inválida' }), paneStop: async () => { stopped = true; } });
  const P = pane();
  await ctx.aplicarWorktree(P, { path: 'C:\\outro' });
  assert.equal(stopped, false);
  assert.equal(P.sessaoId, 'antiga');
  assert.equal(P.cwd, 'C:\\repo');
  assert.equal(messages[0].error, true);
});

test('resposta atrasada não aplica pasta nem libera o lock de troca pertencente a outra ação', async () => {
  let resolveOpen;
  const { ctx } = context({ gitWorktreesOpen: () => new Promise(resolve => { resolveOpen = resolve; }), paneStop: async () => assert.fail('não deve parar') });
  const P = pane();
  const result = ctx.aplicarWorktree(P, { path: 'C:\\isolada' });
  P._trocando = true;
  resolveOpen({ root: 'C:\\repo', path: 'C:\\isolada', branch: 'cockpit/x', isMain: false });
  await result;
  assert.equal(P._trocando, true);
  assert.equal(P.cwd, 'C:\\repo');
  assert.equal(P._worktreeBusy, false);
});

test('painel iniciando um turno não inicia a troca de worktree', async () => {
  const { ctx } = context({ gitWorktreesOpen: async () => assert.fail('não deve consultar') });
  const P = pane(); P.ligando = true;
  await ctx.aplicarWorktree(P, { path: 'C:\\isolada' });
  assert.equal(P.sessaoId, 'antiga');
});
