'use strict';
/* Tarefa 8 (26/09/2026): pergunta e plano do proprio Claude.
   Funcoes puras de src/claude-interacao.js, chamadas direto (molde:
   test/cockpit-approval.test.js). O que o main faz com elas esta em
   test/claude-interacao-main.test.js; a tela, em test/claude-interacao-tela.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/claude-interacao');

const ASK = {
  questions: [
    { question: 'Qual cor usar no botão?', header: 'Cor', multiSelect: false,
      options: [{ label: 'Azul', description: 'combina com o tema' }, { label: 'Verde', description: 'destaca mais' }] },
    { question: 'Quais telas mexer?', header: 'Telas', multiSelect: true,
      options: [{ label: 'Início' }, { label: 'Ajustes' }, { label: 'Torre' }] },
  ],
};

test('perguntasDoAsk vira o formato da caixa de perguntas (.pane-perg)', () => {
  const r = I.perguntasDoAsk(ASK);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), [
    { titulo: 'Cor', pergunta: 'Qual cor usar no botão?', varias: false,
      opcoes: [{ rotulo: 'Azul', detalhe: 'combina com o tema' }, { rotulo: 'Verde', detalhe: 'destaca mais' }] },
    { titulo: 'Telas', pergunta: 'Quais telas mexer?', varias: true,
      opcoes: [{ rotulo: 'Início', detalhe: '' }, { rotulo: 'Ajustes', detalhe: '' }, { rotulo: 'Torre', detalhe: '' }] },
  ]);
  // entrada torta nao quebra nem inventa pergunta
  assert.deepEqual(I.perguntasDoAsk(null), []);
  assert.deepEqual(I.perguntasDoAsk({ questions: 'x' }), []);
  assert.deepEqual(I.perguntasDoAsk({ questions: [null, { header: 'sem pergunta' }, { question: '   ' }] }), []);
  // a caixa mostra no maximo 4 perguntas (o AskUserQuestion manda de 1 a 4)
  const cinco = { questions: Array.from({ length: 5 }, (_, i) => ({ question: 'P' + i, options: [{ label: 'a' }] })) };
  assert.equal(I.perguntasDoAsk(cinco).length, 4);
});

test('respostaDoAsk indexa pelo TEXTO da pergunta e junta várias escolhas com ", "', () => {
  const r = I.respostaDoAsk(ASK, ['Verde', ['Início', 'Torre']], false);
  assert.equal(r.behavior, 'allow');
  assert.deepEqual(r.updatedInput.answers, { 'Qual cor usar no botão?': 'Verde', 'Quais telas mexer?': 'Início, Torre' });
  // o resto do input volta igual (o CLI confere as perguntas que mandou)
  assert.deepEqual(r.updatedInput.questions, ASK.questions);
  // resposta escrita a mao vale como a opcao
  const livre = I.respostaDoAsk(ASK, ['  Roxo  ', ['Ajustes', 'e a Torre também']], false);
  assert.deepEqual(livre.updatedInput.answers, { 'Qual cor usar no botão?': 'Roxo', 'Quais telas mexer?': 'Ajustes, e a Torre também' });
  // pergunta que ficou sem resposta nao entra (as outras vao)
  const meia = I.respostaDoAsk(ASK, ['Azul', []], false);
  assert.deepEqual(meia.updatedInput.answers, { 'Qual cor usar no botão?': 'Azul' });
});

test('respostaDoAsk devolve o rótulo ORIGINAL quando a caixa mostrou ele cortado', () => {
  const longo = 'L'.repeat(260);
  const input = { questions: [{ question: 'Qual?', options: [{ label: longo }, { label: 'curta' }] }] };
  const rotuloNaTela = I.perguntasDoAsk(input)[0].opcoes[0].rotulo;
  assert.ok(rotuloNaTela.length < longo.length, 'a tela corta rotulo gigante');
  assert.equal(I.respostaDoAsk(input, [rotuloNaTela], false).updatedInput.answers['Qual?'], longo);
});

test('fechar as perguntas sem responder = deny com o recado do brief', () => {
  const esperado = { behavior: 'deny', message: 'O usuário fechou as perguntas sem responder.' };
  assert.deepEqual(I.respostaDoAsk(ASK, ['Azul', ['Início']], true), esperado);
  // nada respondido tambem nao vira "allow" vazio
  assert.deepEqual(I.respostaDoAsk(ASK, [null, []], false), esperado);
  assert.deepEqual(I.respostaDoAsk(ASK, undefined, false), esperado);
});

test('respostaDoPlano: aprovar faz setMode para o modo de antes, nos 4 modos', () => {
  const input = { plan: '## Plano\n1. fazer', planFilePath: 'C:\\x\\plano.md' };
  const esperado = { manual: 'default', 'auto-edit': 'acceptEdits', auto: 'auto', bypass: 'bypassPermissions' };
  for (const [modoAntes, doCli] of Object.entries(esperado)) {
    assert.deepEqual(I.respostaDoPlano(input, { aprovar: true, modoAntes }), {
      behavior: 'allow', updatedInput: input,
      updatedPermissions: [{ type: 'setMode', mode: doCli, destination: 'session' }],
    }, modoAntes);
  }
});

test('respostaDoPlano: modo de antes desconhecido volta pro Manual (nunca libera mais)', () => {
  for (const modoAntes of [undefined, null, '', 'plan', 'revisado', 'inventado', 'bypassPermissions', 'constructor', '__proto__']) {
    const r = I.respostaDoPlano({}, { aprovar: true, modoAntes });
    assert.equal(r.updatedPermissions[0].mode, 'default', String(modoAntes));
    assert.equal(I.modoDeVolta(modoAntes), 'manual', String(modoAntes));
  }
  // so' true aprova: "true" em texto, 1 ou objeto nao
  for (const aprovar of ['true', 1, {}, undefined]) assert.equal(I.respostaDoPlano({}, { aprovar, texto: 'x' }).behavior, 'deny', String(aprovar));
});

test('respostaDoPlano: ajustar leva o texto (e nunca aprova)', () => {
  assert.deepEqual(I.respostaDoPlano({ plan: 'x' }, { aprovar: false, texto: '  troca o passo 2  ' }),
    { behavior: 'deny', message: 'O usuário quer ajustar o plano antes de executar: troca o passo 2' });
  const vazio = I.respostaDoPlano({ plan: 'x' }, { aprovar: false, texto: '   ' });
  assert.equal(vazio.behavior, 'deny');
  assert.equal(vazio.updatedPermissions, undefined);
});

test('o bypass só fica disponível no Plano vindo do "Sem pedir permissão"', () => {
  assert.equal(I.liberaBypassNoPlano('plan', 'bypass'), true);
  for (const [modo, antes] of [['plan', 'manual'], ['plan', 'auto'], ['plan', 'auto-edit'], ['plan', undefined], ['plan', 'plan'],
    ['manual', 'bypass'], ['auto', 'bypass'], ['bypass', 'bypass'], ['auto-edit', 'bypass']]) {
    assert.equal(I.liberaBypassNoPlano(modo, antes), false, modo + ' / ' + antes);
  }
});

test('pergunta e plano nunca ganham "Sempre permitir"; descarte e pedido sem tela recusam com recado', () => {
  assert.ok(I.FERRAMENTAS_DE_INTERACAO.has('AskUserQuestion'));
  assert.ok(I.FERRAMENTAS_DE_INTERACAO.has('ExitPlanMode'));
  assert.equal(I.FERRAMENTAS_DE_INTERACAO.has('Bash'), false);
  for (const tipo of ['perguntas', 'plano']) {
    const r = I.respostaDeDescarte(tipo);
    assert.equal(r.behavior, 'deny');
    assert.ok(r.message.length > 10);
  }
  const semTela = I.respostaSemTela('FerramentaNova');
  assert.equal(semTela.behavior, 'deny');
  assert.match(semTela.message, /FerramentaNova/);
});

test('chaveDoPedido leva a geração do processo e sobrevive à limpeza do pergunta:responder', () => {
  const k1 = I.chaveDoPedido('claude_q_', 3, 'a1b2-c3.d4:e5');
  const k2 = I.chaveDoPedido('claude_q_', 4, 'a1b2-c3.d4:e5');
  assert.notEqual(k1, k2, 'processo novo, chave nova, mesmo request_id');
  assert.ok(k1.startsWith('claude_q_3_'), k1);
  // a mesma limpeza que o main faz no id que volta da tela
  assert.equal(k1.replace(/[^a-zA-Z0-9_-]/g, ''), k1);
  assert.ok(I.chaveDoPedido('claude_p_', 1, 'x').startsWith('claude_p_1_'));
});
