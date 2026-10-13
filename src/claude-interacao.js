'use strict';
/* Tarefa 8 (26/09/2026): pergunta e plano do proprio Claude, em funcoes puras.

   Porte do Cockpit do Homero (main.js, pane:perguntas / pane:plano), adaptado
   as pecas que este Cockpit ja tem:
   - a pergunta do AskUserQuestion vai pra MESMA caixa de perguntas que o
     mcp__cockpit__perguntar usa (.pane-perg, formato do pergunta-mcp.js), e a
     resposta volta por control_response indexada pelo TEXTO da pergunta;
   - o plano do ExitPlanMode vira o cartao "Plano pronto": Executar volta pro
     modo de ANTES do Plano (setMode na mesma sessao), Ajustar devolve o texto.

   Sem Electron e sem estado: o main chama, o teste chama direto
   (test/claude-interacao.test.js). */

/* Ferramentas do Claude que precisam de voce TODA vez: nunca entram no
   "Sempre permitir" (pane:autoLiberar) nem no Permitir de um clique. */
const FERRAMENTAS_DE_INTERACAO = new Set(['AskUserQuestion', 'ExitPlanMode']);

/* O modo do Cockpit -> o modo do CLI que o Executar pede (updatedPermissions).
   So' os quatro modos de EXECUTAR: 'plan' nao esta aqui de proposito. */
const MODO_DO_CLI = Object.freeze({ manual: 'default', 'auto-edit': 'acceptEdits', auto: 'auto', bypass: 'bypassPermissions' });

const tem = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);

/* O modo pra onde o Executar volta. Qualquer coisa que nao seja um dos quatro
   (vazio, 'plan', ficha antiga, lixo) vira Manual: o mais cuidadoso. Nunca
   libera mais do que o modo que a pessoa tinha escolhido. */
function modoDeVolta(modoAntes) {
  return tem(MODO_DO_CLI, modoAntes) ? modoAntes : 'manual';
}

/* O "Sem pedir permissao" so' fica DISPONIVEL (--allow-dangerously-skip-permissions,
   sem ligar) quando o painel sobe no Plano e o modo de antes era ele: e' o que
   deixa o Executar voltar pra ele sem religar o motor. Em nenhum outro caso. */
function liberaBypassNoPlano(modo, modoAntesDoPlano) {
  return modo === 'plan' && modoAntesDoPlano === 'bypass';
}

/* A tela mostra no maximo 4 perguntas e 5 opcoes (desenharPergunta); o texto
   vem do modelo, entao tem teto. O que volta pro Claude e' sempre o ORIGINAL. */
const LIM = { pergunta: 1000, titulo: 60, rotulo: 200, detalhe: 400 };
const corta = (v, n) => {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* As perguntas que valem, na MESMA ordem para a caixa e para a resposta: a
   caixa responde por posicao, e a posicao so' bate se as duas filtram igual. */
function perguntasValidas(input) {
  const lista = input && Array.isArray(input.questions) ? input.questions : [];
  return lista.filter((q) => q && typeof q === 'object' && typeof q.question === 'string' && q.question.trim()).slice(0, 4);
}

/* AskUserQuestion -> o formato da caixa de perguntas (o mesmo do pergunta-mcp.js):
   [{ titulo, pergunta, varias, opcoes: [{ rotulo, detalhe }] }] */
function perguntasDoAsk(input) {
  return perguntasValidas(input).map((q) => ({
    titulo: corta(q.header, LIM.titulo),
    pergunta: corta(q.question, LIM.pergunta),
    varias: q.multiSelect === true,
    opcoes: (Array.isArray(q.options) ? q.options : [])
      .map((o) => ({ rotulo: corta(o && o.label, LIM.rotulo), detalhe: corta(o && o.description, LIM.detalhe) }))
      .filter((o) => o.rotulo)
      .slice(0, 5),
  }));
}

const RECUSA_DAS_PERGUNTAS = Object.freeze({ behavior: 'deny', message: 'O usuário fechou as perguntas sem responder.' });

/* A resposta da caixa -> o control_response do AskUserQuestion.
   respostas vem por posicao: texto (uma escolha ou o que ele escreveu) ou
   lista (varias escolhas, juntas com ", " como o terminal do Claude faz).
   answers e' indexado pelo TEXTO da pergunta. Pergunta sem resposta fica de
   fora; nada respondido (ou cancelado) = deny com o recado. */
function respostaDoAsk(input, respostas, cancelado) {
  if (cancelado) return { ...RECUSA_DAS_PERGUNTAS };
  const lista = Array.isArray(respostas) ? respostas : [];
  const answers = {};
  perguntasValidas(input).forEach((q, i) => {
    // a caixa mostrou o rotulo cortado: volta o rotulo inteiro
    const originais = new Map((Array.isArray(q.options) ? q.options : [])
      .map((o) => [corta(o && o.label, LIM.rotulo), String((o && o.label) || '')]));
    const bruto = lista[i];
    const partes = (Array.isArray(bruto) ? bruto : [bruto])
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .map((v) => originais.get(v) || v);
    if (partes.length) answers[q.question] = partes.join(', ');
  });
  if (!Object.keys(answers).length) return { ...RECUSA_DAS_PERGUNTAS };
  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

/* A resposta do cartao "Plano pronto" -> o control_response do ExitPlanMode.
   Aprovar (so' com true de verdade) = allow + setMode pro modo de antes, na
   mesma sessao. Qualquer outra coisa = deny com o texto do ajuste. */
function respostaDoPlano(input, { aprovar, modoAntes, texto } = {}) {
  if (aprovar === true) {
    return {
      behavior: 'allow',
      updatedInput: input,
      updatedPermissions: [{ type: 'setMode', mode: MODO_DO_CLI[modoDeVolta(modoAntes)], destination: 'session' }],
    };
  }
  const t = String(texto == null ? '' : texto).trim();
  return {
    behavior: 'deny',
    message: t ? 'O usuário quer ajustar o plano antes de executar: ' + t
      : 'O usuário ainda não aprovou o plano. Continue planejando e mostre o plano de novo.',
  };
}

/* Pedido que ficou sem resposta (fim do turno, parar, fechar o painel): o
   Claude recebe um "nao" claro em vez de ficar esperando. */
function respostaDeDescarte(tipo) {
  if (tipo === 'plano') return { behavior: 'deny', message: 'O plano ficou sem resposta: o turno acabou ou o painel parou. Não execute nada dele.' };
  return { ...RECUSA_DAS_PERGUNTAS };
}

/* Pedido que o CLI marca como "precisa do usuario" e que o Cockpit nao sabe
   mostrar: recusa com recado (um Permitir de um clique pularia a interacao). */
function respostaSemTela(ferramenta) {
  return {
    behavior: 'deny',
    message: 'O Cockpit não consegue mostrar este pedido (' + String(ferramenta || 'ferramenta').slice(0, 80)
      + ') ao usuário. Siga sem ele ou pergunte de outro jeito.',
  };
}

/* A chave do pedido leva a GERACAO do processo: um request_id repetido por um
   processo novo nunca casa com o pedido do velho. So' letras, numeros, _ e -:
   o pergunta:responder limpa o id que volta da tela com essa mesma regra. */
function chaveDoPedido(prefixo, geracao, requestId) {
  const id = String(requestId == null ? '' : requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return String(prefixo) + (Number(geracao) || 0) + '_' + id;
}

module.exports = {
  FERRAMENTAS_DE_INTERACAO, MODO_DO_CLI, modoDeVolta, liberaBypassNoPlano,
  perguntasDoAsk, respostaDoAsk, respostaDoPlano, respostaDeDescarte, respostaSemTela, chaveDoPedido,
};
