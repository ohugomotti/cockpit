const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildThreadOpenRequest,
  buildApprovalResponse,
  normalizeUserInputRequest,
  buildUserInputResponse,
  normalizeSkillsResponse,
  mergeApps,
} = require('../src/codex-protocol');

test('retomar conversa reaplica o modo Sem pedir permissão e as demais escolhas', () => {
  const got = buildThreadOpenRequest({
    resumeId: 'thr_123',
    cwd: 'C:\\projeto',
    model: 'gpt-5.6-sol',
    approval: 'bypass',
    developerInstructions: 'responda em português',
  });

  assert.deepEqual(got, {
    method: 'thread/resume',
    params: {
      threadId: 'thr_123',
      cwd: 'C:\\projeto',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      developerInstructions: 'responda em português',
      model: 'gpt-5.6-sol',
    },
  });
});

test('nova conversa no modo Revisado ativa o revisor automático', () => {
  const got = buildThreadOpenRequest({
    cwd: 'C:\\projeto',
    approval: 'revisado',
    developerInstructions: 'regras',
  });

  assert.deepEqual(got, {
    method: 'thread/start',
    params: {
      cwd: 'C:\\projeto',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      developerInstructions: 'regras',
    },
  });
});

test('negar comando usa a decisão decline aceita pelo protocolo v2', () => {
  assert.deepEqual(buildApprovalResponse('cmd', false, {}), { decision: 'decline' });
  assert.deepEqual(buildApprovalResponse('file', true, {}), { decision: 'acceptForSession' });
});

test('aprovação de permissões devolve somente o conjunto solicitado', () => {
  const permissions = {
    network: { enabled: true },
    fileSystem: { entries: [{ access: 'read', path: { type: 'special', value: { kind: 'root' } } }] },
  };

  assert.deepEqual(buildApprovalResponse('perm', true, { permissions }), {
    permissions,
    scope: 'session',
  });
  assert.deepEqual(buildApprovalResponse('perm', false, { permissions }), {
    permissions: {},
    scope: 'turn',
  });
});

test('pergunta nativa do Codex vira o cartão de perguntas do Cockpit', () => {
  const got = normalizeUserInputRequest(91, {
    questions: [{
      id: 'destino',
      header: 'Destino',
      question: 'Onde devo salvar?',
      isSecret: true,
      options: [
        { label: 'Projeto', description: 'Salva junto do código.' },
        { label: 'Drive', description: 'Salva na pasta compartilhada.' },
      ],
    }],
  });

  const esperado = [{
    id: 'destino',
    titulo: 'Destino',
    pergunta: 'Onde devo salvar?',
    segredo: true,
    varias: false,
    opcoes: [
      { rotulo: 'Projeto', detalhe: 'Salva junto do código.' },
      { rotulo: 'Drive', detalhe: 'Salva na pasta compartilhada.' },
    ],
  }];
  assert.equal(got.id, 'codex_q_91');
  assert.equal(got.bloqueante, true);
  assert.deepEqual(got.perguntas, esperado);
  assert.deepEqual(got.todas, esperado);
});

test('mais de 4 perguntas: a tela mostra 4, mas todas recebem resposta', () => {
  /* o Codex nao promete um teto de perguntas. O cartao desenha 4; se as outras
     ficassem de fora da resposta, a ferramenta ficaria esperando pra sempre. */
  const questions = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'q' + n, header: 'H', question: 'p' + n }));
  const got = normalizeUserInputRequest(3, { questions });
  assert.equal(got.perguntas.length, 4);
  assert.equal(got.todas.length, 6);
  const r = buildUserInputResponse(got.todas, ['a', 'b', 'c', 'd'], false);
  assert.deepEqual(Object.keys(r.answers), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  assert.deepEqual(r.answers.q5, { answers: [] });
});

test('id do pedido com caractere estranho vira chave que a tela consegue devolver', () => {
  // a tela limpa o id com [^a-zA-Z0-9_-]; o id tem que nascer ja' limpo
  const got = normalizeUserInputRequest('req:12.4', { questions: [{ id: 'a', header: 'H', question: 'p' }] });
  assert.equal(got.id, 'codex_q_req124');
  assert.equal(got.id.replace(/[^a-zA-Z0-9_-]/g, ''), got.id);
});

test('métodos antigos de aprovação falam ReviewDecision, não decline', () => {
  /* execCommandApproval e applyPatchApproval continuam vivos no 0.147.0 e usam
     approved/denied; mandar "decline" deixa o turno pendurado */
  assert.deepEqual(buildApprovalResponse('cmdLegado', true), { decision: 'approved_for_session' });
  // o "nao" e' objeto com o motivo dentro, nao a palavra "denied"
  assert.deepEqual(buildApprovalResponse('cmdLegado', false), { decision: { denied: { rejection: 'Negado por você' } } });
  assert.deepEqual(buildApprovalResponse('fileLegado', false), { decision: { denied: { rejection: 'Negado por você' } } });
});

test('respostas do cartão voltam indexadas pelos ids originais', () => {
  const questions = [{ id: 'destino' }, { id: 'formatos' }];
  assert.deepEqual(buildUserInputResponse(questions, ['Projeto', ['PNG', 'PPTX']], false), {
    answers: {
      destino: { answers: ['Projeto'] },
      formatos: { answers: ['PNG', 'PPTX'] },
    },
  });
  assert.deepEqual(buildUserInputResponse(questions, [], true), {
    answers: {
      destino: { answers: [] },
      formatos: { answers: [] },
    },
  });
});

test('skills nativas preservam nome de invocação e descrição útil', () => {
  const got = normalizeSkillsResponse({
    data: [{
      cwd: 'C:\\projeto',
      skills: [
        { name: 'ativa', description: 'Descrição longa', enabled: true, path: 'C:\\ativa\\SKILL.md', scope: 'user', interface: { displayName: 'Ativa', shortDescription: 'Descrição curta' } },
        { name: 'desligada', description: 'Não deve aparecer', enabled: false, path: 'C:\\off\\SKILL.md', scope: 'user' },
      ],
      errors: [],
    }],
  }, 'C:\\projeto');

  assert.deepEqual(got, [{
    name: 'ativa',
    desc: 'Descrição curta',
    displayName: 'Ativa',
    path: 'C:\\ativa\\SKILL.md',
    scope: 'user',
    source: 'native',
  }]);
});

test('Apps disponíveis e instalados recebem um estado simples para a tela', () => {
  const got = mergeApps({
    data: [
      { id: 'drive', name: 'Google Drive', description: 'Arquivos', isAccessible: true, isEnabled: true, installUrl: 'https://chatgpt.com/apps/drive' },
      { id: 'crm', name: 'CRM', description: null, isAccessible: false, isEnabled: true, installUrl: null },
    ],
  }, {
    apps: [{ id: 'drive', runtimeName: 'Drive', enabled: true, callable: true }],
  });

  assert.deepEqual(got, [
    {
      id: 'drive', nome: 'Google Drive', desc: 'Arquivos', acessivel: true,
      habilitado: true, instalado: true, chamavel: true,
      status: 'Pronto para usar', installUrl: 'https://chatgpt.com/apps/drive', logo: '',
    },
    {
      id: 'crm', nome: 'CRM', desc: '', acessivel: false,
      habilitado: true, instalado: false, chamavel: false,
      status: 'Indisponível nesta conta', installUrl: '', logo: '',
    },
  ]);
});


/* ---- casos de borda que a integracao no main.js criou ---- */

test('recusar alteração de arquivo também usa decline, não o "reject" antigo', () => {
  assert.deepEqual(buildApprovalResponse('file', false), { decision: 'decline' });
  assert.deepEqual(buildApprovalResponse('cmd', false), { decision: 'decline' });
});

test('permissão negada devolve conjunto vazio com escopo do turno', () => {
  const r = buildApprovalResponse('perm', false, { permissions: { network: { enabled: true } } });
  assert.deepEqual(r, { permissions: {}, scope: 'turn' });
});

test('pergunta cancelada devolve todos os ids com lista vazia', () => {
  // o Codex fica esperando a resposta: cancelar precisa devolver algo valido
  const perguntas = [{ id: 'q1' }, { id: 'q2' }];
  assert.deepEqual(buildUserInputResponse(perguntas, null, true), {
    answers: { q1: { answers: [] }, q2: { answers: [] } },
  });
});

test('pergunta sem id no meio não desalinha as respostas', () => {
  /* o normalize joga fora a pergunta sem id; o main guarda a lista JA filtrada,
     entao a resposta da tela (por posicao) tem que casar com o id certo */
  const cartao = normalizeUserInputRequest(7, {
    questions: [
      { id: '', header: 'sem id', question: 'nao deveria aparecer' },
      { id: 'b', header: 'B', question: 'segunda?' },
    ],
  });
  assert.equal(cartao.id, 'codex_q_7');
  assert.deepEqual(cartao.perguntas.map((q) => q.id), ['b']);
  assert.deepEqual(buildUserInputResponse(cartao.perguntas, ['sim'], false), {
    answers: { b: { answers: ['sim'] } },
  });
});

test('pergunta marcada como secreta chega marcada no cartão', () => {
  const cartao = normalizeUserInputRequest(1, {
    questions: [{ id: 'tok', header: 'Token', question: 'cole a chave', isSecret: true }],
  });
  assert.equal(cartao.perguntas[0].segredo, true);
});

test('Apps fora do ar não derrubam a tela: lista vazia em vez de erro', () => {
  // codex:apps chama mergeApps(null, null) quando as duas chamadas falham
  assert.deepEqual(mergeApps(null, null), []);
  assert.deepEqual(mergeApps(undefined, { apps: [] }), []);
});

test('só o app instalado aparece quando o catálogo da conta não responde', () => {
  const r = mergeApps(null, { apps: [{ id: 'linear', enabled: true, callable: true, runtimeName: 'Linear' }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].nome, 'Linear');
  assert.equal(r[0].status, 'Pronto para usar');
});

test('skills de outra pasta não vazam para o painel', () => {
  const r = normalizeSkillsResponse({
    data: [
      { cwd: 'C:\outro', skills: [{ name: 'nao-e-minha' }] },
      { cwd: 'C:\projeto', skills: [{ name: 'minha', scope: 'project' }] },
    ],
  }, 'C:\projeto');
  assert.deepEqual(r.map((s) => s.name), ['minha']);
  assert.equal(r[0].scope, 'project');
  assert.equal(r[0].source, 'native');
});


test('normaliza erro textual, TurnError, Error e objetos circulares sem expor campos arbitrários', () => {
  const { normalizeError } = require('../src/codex-protocol');
  assert.equal(normalizeError('Falhou'), 'Falhou');
  assert.equal(normalizeError(new Error('Indisponível')), 'Indisponível');
  assert.equal(normalizeError({ error: { message: 'Conexão interrompida', additionalDetails: 'HTTP 503' } }), 'Conexão interrompida\nHTTP 503');
  assert.equal(normalizeError({ error: 'Falha legada' }), 'Falha legada');
  const circular = { token: 'nao-exibir' }; circular.error = circular;
  assert.equal(normalizeError(circular, 'Falha segura'), 'Falha segura');
  assert.equal(normalizeError({ message: {}, arbitrary: 'nao-exibir' }, 'Falha segura'), 'Falha segura');
  assert.equal(normalizeError('[object Object]', 'Falha segura'), 'Falha segura');
});
