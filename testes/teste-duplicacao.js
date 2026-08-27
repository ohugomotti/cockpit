/* Teste do caminho que produzia RESPOSTA EM DOBRO.
   Roda as funcoes REAIS extraidas do main.js e do renderer/app.js, com o
   minimo de DOM falso, e cobre streaming + versao final juntos - foi
   exatamente o que faltou no teste que deixou o bug passar da outra vez. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* os testes moram em testes/; o app mora em src/ */
const RAIZ_PROJETO = path.join(__dirname, '..');

const SRC = path.join(RAIZ_PROJETO, 'src');
const mainTxt = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const appTxt = fs.readFileSync(path.join(SRC, 'renderer', 'app.js'), 'utf8');

function pegar(txt, assinatura, nome) {
  const i = txt.indexOf(assinatura);
  if (i < 0) throw new Error('nao achei ' + nome);
  // acha a chave de abertura e casa ate a de fechamento
  let j = txt.indexOf('{', i);
  let nivel = 0;
  for (let k = j; k < txt.length; k++) {
    const c = txt[k];
    if (c === '{') nivel++;
    else if (c === '}') { nivel--; if (nivel === 0) return txt.slice(i, k + 1); }
  }
  throw new Error('nao fechei ' + nome);
}

/* ---------- lado do main: como o id da mensagem e' montado ---------- */
const emitido = [];
const ctxMain = {
  emit: (paneId, kind, data) => emitido.push({ paneId, kind, ...data }),
  codex: { paneMsgId: new Map(), paneTurn: new Map(), threadToPane: new Map(), paneToThread: new Map() },
  msgSeqPorPane: new Map(),
  claudeRemoto: new Map(), claudeCwd: new Map(), claudePanes: new Map(),
  pendingApprovals: new Map(), autoLiberadas: new Map(),
  path: require('path'), fs: require('fs'),
  CLAUDE_PROJ: 'X', HOME: 'H',
  encodeCwd: (x) => x,
  claudeToolArg: () => '', mudancaDaFerramenta: () => null,
  fileChangeArg: () => '', fileChangeSummary: () => '', mcpName: () => '', shortJson: () => '', decodeChunk: () => '',
  console,
};
vm.createContext(ctxMain);
// as contas de numero da mensagem vem do main.js de verdade, nao de uma copia
{
  const i = mainTxt.indexOf('const seqDoPane =');
  const j = mainTxt.indexOf('function marcaSub(');
  if (i < 0 || j < 0 || j < i) throw new Error('nao achei o bloco das contas');
  vm.runInContext(mainTxt.slice(i, j), ctxMain);
}
for (const [assinatura, nome] of [
  ['function idDoItem(', 'idDoItem'],
  ['function marcaSub(', 'marcaSub'],
  ['function paneOf(', 'paneOf'],
  ['function codexNotification(', 'codexNotification'],
  ['function claudeMessage(', 'claudeMessage'],
]) {
  vm.runInContext(pegar(mainTxt, assinatura, nome), ctxMain);
}

/* ---------- lado do renderer: como a fala e' desenhada ---------- */
function novoDom() {
  const feitos = [];
  const criar = () => {
    const el = {
      className: '', innerHTML: '', textContent: '', title: '', style: {},
      children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, querySelectorAll: () => [], insertBefore() {},
      parentElement: null,
    };
    feitos.push(el);
    return el;
  };
  return { criar, feitos };
}

function montarRenderer() {
  const dom = novoDom();
  const bolhas = [];
  const ctx = {
    console,
    document: { createElement: () => dom.criar() },
    mdSeguro: (t) => String(t),
    clearEmpty() {}, scroll() {},
    linkarArquivos() {}, marcarLinksWeb() {}, botoesDeCodigo() {},
    svgMotor: () => '', ico: () => '',
    $: (sel, raiz) => (raiz && raiz.__body) || dom.criar(),
  };
  vm.createContext(ctx);
  vm.runInContext(pegar(appTxt, 'function mesmaFala(', 'mesmaFala'), ctx);
  // botBlock de verdade depende de muito DOM: aqui basta contar quantas bolhas nascem
  ctx.botBlock = new vm.Script('(function(P, key){ return null; })').runInContext(ctx);
  vm.runInContext(`function botBlock(P, key) {
    const b = { el: { innerHTML: '' }, raw: '' };
    __bolhas.push(b);
    P.blocks.set(key, b);
    return b;
  }`, Object.assign(ctx, { __bolhas: bolhas }));
  vm.runInContext(pegar(appTxt, 'function textDelta(', 'textDelta'), ctx);
  vm.runInContext(pegar(appTxt, 'function textFinal(', 'textFinal'), ctx);
  const P = { engine: 'claude', blocks: new Map(), hist: [], chat: dom.criar(), el: dom.criar() };
  return { ctx, P, bolhas };
}

function aplicar(r, eventos) {
  for (const ev of eventos) {
    if (ev.kind === 'text-delta') r.ctx.textDelta(r.P, ev.id, ev.text);
    else if (ev.kind === 'text-final') r.ctx.textFinal(r.P, ev.id, ev.text);
  }
}

const NL = String.fromCharCode(10);

/* ======================= casos ======================= */
let falhas = 0;
function checa(nome, cond, detalhe) {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (detalhe ? ' -> ' + detalhe : '')); }
}

// -------- 1. Codex: id do delta ausente, id do completed presente --------
console.log('\n1) Codex - delta sem itemId, completed com id (o caso do bug)');
emitido.length = 0;
ctxMain.codex.threadToPane.set('t1', 'p1');
ctxMain.codexNotification('item/agentMessage/delta', { threadId: 't1', delta: 'Bom dia, vou olhar isso agora' });
ctxMain.codexNotification('item/completed', { threadId: 't1', item: { type: 'agentMessage', id: 'item_42', text: 'Bom dia, vou olhar isso agora e te falo.' } });
const evCodex = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
checa('delta e final saem com o MESMO id',
  evCodex.length === 2 && evCodex[0].id === evCodex[1].id,
  JSON.stringify(evCodex.map(e => e.kind + '=' + e.id)));
let r = montarRenderer();
aplicar(r, evCodex);
checa('uma bolha so na tela', r.bolhas.length === 1, r.bolhas.length + ' bolhas');
checa('uma fala so no historico', r.P.hist.length === 1, JSON.stringify(r.P.hist));

// -------- 2. Codex: nomes alternativos do campo de id --------
console.log('\n2) Codex - app-server usando item_id em vez de itemId');
emitido.length = 0;
ctxMain.codex.paneMsgId.clear();
ctxMain.codexNotification('item/agentMessage/delta', { threadId: 't1', item_id: 'x9', delta: 'Testando o campo alternativo' });
ctxMain.codexNotification('item/completed', { threadId: 't1', item: { type: 'agentMessage', id: 'x9', text: 'Testando o campo alternativo do id.' } });
const ev2 = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
checa('id lido de item_id', ev2[0] && ev2[0].id === 'x9', JSON.stringify(ev2));
r = montarRenderer();
aplicar(r, ev2);
checa('uma bolha so na tela', r.bolhas.length === 1, r.bolhas.length + ' bolhas');

// -------- 3. Claude: streaming + versao final da MESMA mensagem --------
console.log('\n3) Claude - streaming e versao final juntos');
emitido.length = 0;
ctxMain.msgSeqPorPane.clear();
ctxMain.claudeMessage('p2', { type: 'stream_event', event: { type: 'message_start' } });
ctxMain.claudeMessage('p2', { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Vou ler o arquivo' } } });
ctxMain.claudeMessage('p2', { type: 'assistant', message: { content: [{ type: 'text', text: 'Vou ler o arquivo e volto.' }] } });
const ev3 = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
checa('delta e final com o mesmo id', ev3.length === 2 && ev3[0].id === ev3[1].id, JSON.stringify(ev3.map(e => e.kind + '=' + e.id)));
r = montarRenderer();
aplicar(r, ev3);
checa('uma bolha so na tela', r.bolhas.length === 1, r.bolhas.length + ' bolhas');

// -------- 4. Claude: duas falas no mesmo turno (fala, usa ferramenta, fala) --------
console.log('\n4) Claude - fala, usa ferramenta, fala de novo: tem que dar DUAS bolhas');
emitido.length = 0;
ctxMain.msgSeqPorPane.clear();
ctxMain.claudeMessage('p3', { type: 'stream_event', event: { type: 'message_start' } });
ctxMain.claudeMessage('p3', { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Primeiro vou conferir a pasta' } } });
ctxMain.claudeMessage('p3', { type: 'assistant', message: { content: [{ type: 'text', text: 'Primeiro vou conferir a pasta.' }] } });
ctxMain.claudeMessage('p3', { type: 'stream_event', event: { type: 'message_start' } });
ctxMain.claudeMessage('p3', { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Achei o problema na linha 40' } } });
ctxMain.claudeMessage('p3', { type: 'assistant', message: { content: [{ type: 'text', text: 'Achei o problema na linha 40.' }] } });
const ev4 = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
r = montarRenderer();
aplicar(r, ev4);
checa('duas bolhas (falas diferentes nao podem virar uma)', r.bolhas.length === 2, r.bolhas.length + ' bolhas');
checa('duas falas no historico', r.P.hist.length === 2, JSON.stringify(r.P.hist.map(h => h.texto)));

// -------- 5. rede de seguranca: id trocado no meio, mesmo texto --------
console.log('\n5) Rede de seguranca - id muda entre streaming e final');
r = montarRenderer();
aplicar(r, [
  { kind: 'text-delta', id: 'A', text: 'Consegui reproduzir aqui e o erro' },
  { kind: 'text-final', id: 'B', text: 'Consegui reproduzir aqui e o erro vem do cache.' },
]);
checa('nao duplicou mesmo com id diferente', r.bolhas.length === 1, r.bolhas.length + ' bolhas');
checa('historico com uma entrada', r.P.hist.length === 1, JSON.stringify(r.P.hist));

// -------- 6. a rede de seguranca nao pode grudar falas diferentes --------
console.log('\n6) Rede de seguranca - textos diferentes continuam separados');
r = montarRenderer();
aplicar(r, [
  { kind: 'text-delta', id: 'A', text: 'Vou começar pelo banco de dados' },
  { kind: 'text-final', id: 'A', text: 'Vou começar pelo banco de dados.' },
  { kind: 'text-final', id: 'C', text: 'Pronto, terminei a migração toda.' },
]);
checa('duas bolhas', r.bolhas.length === 2, r.bolhas.length + ' bolhas');
checa('duas falas no historico', r.P.hist.length === 2, JSON.stringify(r.P.hist.map(h => h.texto)));

// -------- 7. sub-agente falando pelo mesmo painel --------
console.log('\n7) Claude - sub-agente (Task) falando no mesmo painel');
emitido.length = 0;
ctxMain.msgSeqPorPane.clear();
ctxMain.claudeMessage('p4', { type: 'stream_event', event: { type: 'message_start' } });
ctxMain.claudeMessage('p4', { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Vou chamar um ajudante' } } });
ctxMain.claudeMessage('p4', { type: 'assistant', message: { content: [{ type: 'text', text: 'Vou chamar um ajudante.' }] } });
ctxMain.claudeMessage('p4', { type: 'stream_event', parent_tool_use_id: 'toolu_abc12345', event: { type: 'message_start' } });
ctxMain.claudeMessage('p4', { type: 'stream_event', parent_tool_use_id: 'toolu_abc12345', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Aqui e o ajudante falando' } } });
ctxMain.claudeMessage('p4', { type: 'assistant', parent_tool_use_id: 'toolu_abc12345', message: { content: [{ type: 'text', text: 'Aqui e o ajudante falando.' }] } });
const ev7 = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
const paresOk = ev7[0].id === ev7[1].id && ev7[2].id === ev7[3].id && ev7[0].id !== ev7[2].id;
checa('cada um com o seu id, casado entre streaming e final', paresOk, JSON.stringify(ev7.map(e => e.kind + '=' + e.id)));
r = montarRenderer();
aplicar(r, ev7);
checa('duas bolhas', r.bolhas.length === 2, r.bolhas.length + ' bolhas');

// -------- 7b. duas falas comecando IGUAL nao podem virar uma so --------
console.log('\n7b) duas falas do modelo que comecam com a mesma frase');
r = montarRenderer();
aplicar(r, [
  { kind: 'text-delta', id: 'k1', text: 'Vou conferir o arquivo de configuracao' },
  { kind: 'text-final', id: 'k1', text: 'Vou conferir o arquivo de configuracao agora.' },
  { kind: 'text-delta', id: 'k2', text: 'Vou conferir o arquivo de configuracao' },
  { kind: 'text-final', id: 'k2', text: 'Vou conferir o arquivo de configuracao de novo, achei outra coisa.' },
]);
checa('duas bolhas', r.bolhas.length === 2, r.bolhas.length + ' bolhas');
checa('DUAS falas no historico (o historico e o que viaja na troca de motor)',
  r.P.hist.length === 2, JSON.stringify(r.P.hist.map(h => h.texto)));

// -------- 7c. DOIS sub-agentes falando ao mesmo tempo no mesmo painel --------
console.log(NL + '7c) dois sub-agentes em paralelo, com as mensagens embaralhadas');
emitido.length = 0;
ctxMain.msgSeqPorPane.clear();
const A = 'toolu_aaaaaaaa', B = 'toolu_bbbbbbbb';
// o A comeca, o B comeca no meio, e as versoes finais chegam fora de ordem
ctxMain.claudeMessage('p5', { type: 'stream_event', parent_tool_use_id: A, event: { type: 'message_start' } });
ctxMain.claudeMessage('p5', { type: 'stream_event', parent_tool_use_id: A, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ajudante A analisando o banco' } } });
ctxMain.claudeMessage('p5', { type: 'stream_event', parent_tool_use_id: B, event: { type: 'message_start' } });
ctxMain.claudeMessage('p5', { type: 'stream_event', parent_tool_use_id: B, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ajudante B olhando o front' } } });
ctxMain.claudeMessage('p5', { type: 'assistant', parent_tool_use_id: A, message: { content: [{ type: 'text', text: 'Ajudante A analisando o banco: achei 3 tabelas.' }] } });
ctxMain.claudeMessage('p5', { type: 'assistant', parent_tool_use_id: B, message: { content: [{ type: 'text', text: 'Ajudante B olhando o front: achei 2 telas.' }] } });
const ev7c = emitido.filter(e => e.kind === 'text-delta' || e.kind === 'text-final');
const idA = ev7c.filter(e => e.text.indexOf('A ') >= 0).map(e => e.id);
const idB = ev7c.filter(e => e.text.indexOf('B ') >= 0).map(e => e.id);
checa('o ajudante A manteve o mesmo id do comeco ao fim', idA.length === 2 && idA[0] === idA[1], JSON.stringify(idA));
checa('o ajudante B manteve o mesmo id do comeco ao fim', idB.length === 2 && idB[0] === idB[1], JSON.stringify(idB));
checa('os dois nao se misturaram', idA[0] !== idB[0], idA[0] + ' vs ' + idB[0]);
r = montarRenderer();
aplicar(r, ev7c);
checa('duas bolhas, uma pra cada ajudante', r.bolhas.length === 2, r.bolhas.length + ' bolhas');

// -------- 7d. duas falas CURTAS identicas nao podem virar uma so --------
console.log(NL + '7d) duas falas curtas identicas ("Pronto.") de falantes diferentes');
r = montarRenderer();
aplicar(r, [
  { kind: 'text-delta', id: 'z1', text: 'Pronto.' },
  { kind: 'text-final', id: 'z1', text: 'Pronto.' },
  { kind: 'text-final', id: 'z2', text: 'Pronto.' },
]);
checa('duas bolhas (nao fundiu pelo texto curto)', r.bolhas.length === 2, r.bolhas.length + ' bolhas');

// -------- 8. aprovacao do Codex sem painel dono nao pode ficar pendurada --------
console.log('\n8) Codex - notificacao com conversationId (protocolo antigo)');
ctxMain.codex.threadToPane.set('conv-9', 'p9');
checa('paneOf entende conversationId', ctxMain.paneOf({ conversationId: 'conv-9' }) === 'p9');

console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'todos os casos passaram'));
process.exit(falhas ? 1 : 0);
