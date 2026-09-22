'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { codexApprovalDetails } = require('../src/cockpit-approval');
const acp = require('../src/acp');
const command = 'echo ' + 'ação '.repeat(700) + 'FIM_DO_COMANDO';

test('Codex mostra comando completo, destino e justificativa sem confundir PC e servidor', () => {
  for (const remote of [false, true]) {
    const card = codexApprovalDetails('cmdLegado', { command: ['bash', '-lc', command], cwd: '/srv/projeto', reason: 'Teste autorizado' }, remote);
    assert.equal(card.detail, 'bash -lc ' + command + '\nem /srv/projeto');
    assert.equal(card.reason, 'Teste autorizado');
    assert.match(card.title, remote ? /servidor/ : /computador/);
    assert.equal(card.tool, undefined, 'Não inventa liberação permanente');
  }
});

test('Codex preserva todos os arquivos, conteúdo de criar/excluir e diff integral de alterar/mover', () => {
  const diff = '@@ -1,2 +1,2 @@\n-antigo\n+novo\n' + ' contexto\n'.repeat(500) + '+FIM_DO_DIFF';
  const changes = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ['arquivo-' + i + '.txt', { type: 'add', content: 'arquivo-' + i + '-completo' }]));
  changes['alterar.txt'] = { type: 'update', unified_diff: diff, move_path: 'renomeado.txt' };
  changes['excluir.txt'] = { type: 'delete', content: 'conteúdo excluído\nFIM_EXCLUSAO' };
  const card = codexApprovalDetails('fileLegado', { fileChanges: changes, grantRoot: '/srv/projeto', reason: 'Ajuste' });
  for (const file of Object.keys(changes)) assert.ok(card.detail.includes(file));
  assert.ok(card.detail.includes(diff));
  assert.ok(card.detail.includes('arquivo-14-completo'));
  assert.ok(card.detail.includes('conteúdo excluído\nFIM_EXCLUSAO'));
  assert.ok(card.detail.includes('renomeado.txt'));
  assert.ok(card.detail.includes('/srv/projeto'));
  assert.equal(card.reason, 'Ajuste');
});

test('Codex v2 sem diff informa ausência e não inventa alteração', () => {
  const card = codexApprovalDetails('file', { itemId: 'item', threadId: 'thread', grantRoot: '/srv', reason: 'Permissão necessária' });
  assert.match(card.detail, /não forneceu o diff/);
  assert.ok(card.detail.includes('/srv'));
  assert.equal(card.mudanca, undefined);
});

test('pedido de acesso mostra permissões inteiras mesmo quando existe justificativa', () => {
  const permissions = { fileSystem: { write: Array.from({ length: 100 }, (_, i) => '/projetos/' + i) }, network: { enabled: true } };
  const card = codexApprovalDetails('perm', { permissions, reason: 'Preciso ler o resultado' });
  assert.deepEqual(JSON.parse(card.detail), permissions);
  assert.equal(card.reason, 'Preciso ler o resultado');
});

test('ACP conserva comando completo para decisão e resumo curto para atividade', () => {
  const tc = { kind: 'execute', title: 'Executar', rawInput: { command }, locations: [{ path: '/srv/projeto' }] };
  assert.equal(acp.passoDaFerramenta(tc).arg.length, 300);
  const card = acp.dadosDaPermissao(tc);
  assert.equal(card.detail, command, 'O caminho não substitui o comando');
  assert.equal(card.action, 'execute');
});

test('ACP pedido mínimo por ID herda o comando atualizado sem guardar imagens', () => {
  const st = { ferramentas: new Map() };
  acp.traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'call', kind: 'execute', title: 'Rodar', rawInput: { command: 'antigo' } });
  acp.traduzirUpdate(st, { sessionUpdate: 'tool_call_update', toolCallId: 'call', rawInput: { command }, content: [{ type: 'content', content: { type: 'image', data: 'imagem' } }] });
  const before = st.ferramentas.get('call');
  assert.equal(acp.dadosDaPermissao({ toolCallId: 'call' }, before).detail, command);
  assert.equal(before.bruto.content, undefined);
});

test('ACP preserva diff acima do limite de resumo para a decisão por ID', () => {
  const oldText = 'antes'.repeat(24000) + 'FIM_ANTES';
  const newText = 'depois'.repeat(24000) + 'FIM_DEPOIS';
  const st = { ferramentas: new Map() };
  const events = acp.traduzirUpdate(st, { sessionUpdate: 'tool_call', toolCallId: 'edit', kind: 'edit', title: 'Editar', content: [{ type: 'diff', path: '/srv/a.txt', oldText, newText }] });
  assert.ok(events[0].mudanca.depois.length < newText.length, 'Resumo da atividade continua limitado');
  const card = acp.dadosDaPermissao({ toolCallId: 'edit' }, st.ferramentas.get('edit'));
  assert.equal(card.mudanca.antes, oldText);
  assert.equal(card.mudanca.depois, newText);
});

test('ACP com vários diffs inclui todos os conteúdos, não somente o último', () => {
  const content = ['a', 'b'].map(n => ({ type: 'diff', path: '/srv/' + n, oldText: 'antes-' + n, newText: 'depois-' + n }));
  const card = acp.dadosDaPermissao({ kind: 'edit', content });
  for (const entry of content) for (const value of [entry.path, entry.oldText, entry.newText]) assert.ok(card.detail.includes(value));
});


test('ACP diff maior que 400 linhas permanece legível mesmo com resumo visual', () => {
  const oldText = 'antes\n'.repeat(450) + 'FIM_ANTES';
  const newText = 'depois\n'.repeat(450) + 'FIM_DEPOIS';
  const card = acp.dadosDaPermissao({ kind: 'edit', content: [{ type: 'diff', path: '/srv/grande.txt', oldText, newText }] });
  assert.ok(card.detail.includes(oldText));
  assert.ok(card.detail.includes(newText));
});
