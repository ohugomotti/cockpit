'use strict';
/* Task 10 da leva 1 (R5-02): na Voz ao vivo, um pedido que falhava ao enviar
   ficava "gasto" para sempre e o botao Enviar travava. O Hugo tinha de falar tudo
   de novo.

   Por que: o sendDelegation marcava item.sent = true e avancava lastSentEnd ANTES
   de enviar e nao desfazia quando o envio devolvia { ok:false } (ex.: o painel tinha
   um rascunho no campo) nem quando lancava erro. O cartao so' desligava o botao e
   nunca o religava; e, mesmo religado, o controlador recusaria o pedido (item.sent
   ja' era true) e a fala sumiria da transcricao do pedido seguinte.

   Regra: so' vira "enviado" (e so' consome a fala) depois de ok:true. Com o envio no
   ar o pedido fica trancado (clique duplo nao manda duas vezes); se o envio falha,
   o trinco solta e o MESMO cartao pode reenviar.

   O controlador e o mount() sao os de verdade. So' o WebRTC e o DOM sao de mentira,
   e so' com o que eles tocam. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, mount } = require('../src/renderer/live-voice');

const session = { paneId: 'p1', threadId: 'thread-voz', engine: 'claude' };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const tique = () => new Promise((r) => setImmediate(r));

/* ---------- WebRTC de mentira ---------- */
class Canal {
  constructor() { this.ouvintes = new Map(); this.readyState = 'open'; }
  addEventListener(nome, fn) { if (!this.ouvintes.has(nome)) this.ouvintes.set(nome, new Set()); this.ouvintes.get(nome).add(fn); }
  removeEventListener(nome, fn) { this.ouvintes.get(nome)?.delete(fn); }
  fire(nome, valor = {}) { for (const fn of this.ouvintes.get(nome) || []) fn(valor); }
  send() {}
  close() { this.readyState = 'closed'; this.fire('close'); }
}

/* ---------- DOM de mentira: so' o que o mount() e o cartao usam ---------- */
class No {
  constructor(tag) {
    this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.ouvintes = {};
    this.className = ''; this.textContent = ''; this.disabled = false; this.value = ''; this.pai = null;
  }
  append(...nos) { for (const n of nos) { n.pai = this; this.children.push(n); } }
  setAttribute(nome, valor) { this.attrs[nome] = String(valor); }
  addEventListener(tipo, fn) { (this.ouvintes[tipo] = this.ouvintes[tipo] || []).push(fn); }
  get firstElementChild() { return this.children[0] || null; }
  remove() { if (this.pai) this.pai.children = this.pai.children.filter((n) => n !== this); this.pai = null; }
  // o handler do cartao e' async: quem clica espera ele terminar
  clicar() { return Promise.all((this.ouvintes.click || []).map((fn) => fn({}))); }
  achar(quando) { for (const f of this.children) { if (quando(f)) return f; const d = f.achar ? f.achar(quando) : null; if (d) return d; } return null; }
}

/* Liga um controlador (ou o mount(), se cartao) na voz de mentira, ja' em
   session.started. fala() e pedido() mandam os mesmos eventos que a API de voz manda. */
async function palco(t, { sendToPane, cartao = false }) {
  let par;
  class Par extends Canal {
    constructor() { super(); this.iceGatheringState = 'complete'; this.connectionState = 'new'; par = this; }
    addTrack() {}
    createDataChannel() { return (this.canal = new Canal()); }
    async createOffer() { return { type: 'offer', sdp }; }
    async setLocalDescription(v) { this.localDescription = v; }
    async setRemoteDescription(v) { this.remoteDescription = v; }
    close() { this.connectionState = 'closed'; this.fire('connectionstatechange'); }
  }
  const trilhas = [{ enabled: true, stop() {} }];
  const base = {
    session, sendToPane, Peer: Par,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => trilhas, getAudioTracks: () => trilhas }) },
    makeAudio: () => ({ muted: false, play: async () => {}, pause() {}, srcObject: null }), makeStream: (x) => x,
    start: async () => ({ session: { id: 'live-id', ...session }, transport: { type: 'webrtc', sdp } }),
  };
  const pedidos = [];
  let controller, container;
  if (cartao) {
    container = new No('div');
    container.ownerDocument = { createElement: (tag) => new No(tag), createTextNode: (texto) => ({ textContent: texto }) };
    const voz = mount({ container, ...base });
    controller = voz.controller; t.after(() => voz.dispose());
  } else {
    controller = createController({ ...base, onDelegation: (x) => pedidos.push(x) });
    t.after(() => controller.dispose());
  }
  const p = {
    controller, pedidos,
    ev: (dados) => par.canal.fire('message', { data: JSON.stringify(dados) }),
    async conectar() { await controller.connect(); p.ev({ type: 'session.started' }); await tique(); },
    fala: (texto, ini, fim) => p.ev({ type: 'session.input_transcript.delta', delta: texto, start_ms: ini, end_ms: fim }),
    pedido: (id, em) => p.ev({ type: 'session.delegation.created', offset_ms: em, delegation: { id, target: 'client' } }),
    // o cartao de revisao que o mount() desenhou: campo de texto, botao Enviar e linha de resultado
    cartao() {
      const [campo, enviar, resultado] = container.achar((n) => n.className === 'connector-host-action').children;
      return { campo, enviar, resultado };
    },
  };
  await p.conectar();
  return p;
}

/* O painel da sessao de mentira: cada envio consome o proximo passo do roteiro. */
function painelFalso(...passos) {
  const chamadas = [];
  return { chamadas, sendToPane: (...args) => { chamadas.push(args); return passos.shift()(); } };
}
const ENVIADO = async () => ({ ok: true });
// os dois jeitos de o envio falhar: [como falha, o que o usuario precisa ler]
const FALHAS = [
  ['devolve ok:false (o painel tinha rascunho)', async () => ({ ok: false, error: 'Conclua o rascunho' }), /Conclua o rascunho/],
  ['lanca erro (a rede caiu)', async () => { throw new Error('rede caiu'); }, /Confira a conversa/],
];

/* =====================================================================
   controlador: o pedido que falhou nao esta gasto
   ===================================================================== */
for (const [quando, falha, mensagem] of FALHAS) {
  test('envio que ' + quando + ': o MESMO pedido pode ser reenviado e so depois conta como enviado (R5-02)', async (t) => {
    const painel = painelFalso(falha, ENVIADO);
    const p = await palco(t, { sendToPane: painel.sendToPane });
    p.fala('Revise o plano.', 0, 500); p.pedido('d1', 510);
    const r1 = await p.controller.sendDelegation('d1', 'Revise o plano.');
    assert.equal(r1.ok, false); assert.match(r1.error, mensagem);
    assert.equal(painel.chamadas.length, 1);
    const r2 = await p.controller.sendDelegation('d1', 'Revise o plano.');
    assert.equal(r2.ok, true, 'o pedido que falhou nao esta gasto');
    assert.equal(painel.chamadas.length, 2);
    assert.deepEqual(painel.chamadas[1][0], session); assert.equal(painel.chamadas[1][1], 'Revise o plano.');
    // deu certo: agora sim esta enviado, e nao reenvia
    assert.equal((await p.controller.sendDelegation('d1')).ok, false);
    assert.equal(painel.chamadas.length, 2);
  });
}

test('a fala de um envio que falhou volta no pedido seguinte; a de um envio que deu certo nao volta (R5-02)', async (t) => {
  const painel = painelFalso(async () => ({ ok: false, error: 'Conclua o rascunho' }), ENVIADO);
  const p = await palco(t, { sendToPane: painel.sendToPane });
  p.fala('Revise o plano.', 0, 500); p.pedido('d1', 510);
  assert.equal((await p.controller.sendDelegation('d1')).ok, false);
  // ele falou mais um pouco: a fala que falhou nao foi gasta, vem junto
  p.fala(' E mande o resumo.', 600, 800); p.pedido('d2', 810);
  assert.equal(p.pedidos[1].text, 'Revise o plano. E mande o resumo.');
  assert.equal((await p.controller.sendDelegation('d2')).ok, true);
  // o d2 cobre o d1 (o texto dele esta dentro): o pedido velho nao pode ir de novo
  assert.equal((await p.controller.sendDelegation('d1')).ok, false);
  assert.equal(painel.chamadas.length, 2);
  // e a fala que ja foi enviada nao volta no pedido seguinte
  p.fala(' Depois feche.', 900, 1000); p.pedido('d3', 1010);
  assert.equal(p.pedidos[2].text, 'Depois feche.');
});

/* =====================================================================
   o trinco: so' vale enquanto o envio esta no ar
   ===================================================================== */
/* timeout: sem o trinco (item.sending) o 2o clique entra no envio e fica esperando um sendToPane que ninguem solta
   mais, e o teste TRAVAVA a suite inteira em vez de falhar. Com o prazo, ele falha em 3 s. */
test('clique duplo com o envio no ar manda uma vez so; se o envio falha, o trinco solta (R5-02)', { timeout: 3000 }, async (t) => {
  const soltar = [], chamadas = [];
  const p = await palco(t, { sendToPane: (...args) => { chamadas.push(args); return new Promise((ok) => soltar.push(ok)); } });
  p.fala('Revise o plano.', 0, 500); p.pedido('d1', 510);
  const primeiro = p.controller.sendDelegation('d1');
  assert.equal((await p.controller.sendDelegation('d1')).ok, false, 'o 2o clique, com o 1o ainda no ar, e recusado');
  assert.equal(chamadas.length, 1);
  soltar[0]({ ok: false, error: 'Conclua o rascunho' });
  assert.equal((await primeiro).ok, false);
  const terceiro = p.controller.sendDelegation('d1'); // o trinco soltou: tenta de novo
  assert.equal(chamadas.length, 2);
  soltar[1]({ ok: true });
  assert.equal((await terceiro).ok, true);
  assert.equal((await p.controller.sendDelegation('d1')).ok, false);
  assert.equal(chamadas.length, 2);
});

/* lastSentEnd = Math.max(lastSentEnd, item.end): o trinco e' por pedido, entao dois pedidos DIFERENTES podem estar
   no ar ao mesmo tempo. O d2 (fala ate' 800 ms) carrega a fala do d1 (ate' 500 ms) dentro; se o d2 termina
   primeiro e o d1 depois, o fim do d1 nao pode fazer o relogio recuar de 800 para 500: a fala do d2 voltaria,
   repetida, no pedido seguinte. */
test('dois envios no ar que terminam fora de ordem: a fala do 2o nao volta no 3o pedido (R5-02)', { timeout: 3000 }, async (t) => {
  const soltar = [], chamadas = [];
  const p = await palco(t, { sendToPane: (...args) => { chamadas.push(args); return new Promise((ok) => soltar.push(ok)); } });
  p.fala('Revise o plano.', 0, 500); p.pedido('d1', 510);
  p.fala(' E mande o resumo.', 600, 800); p.pedido('d2', 810);
  assert.equal(p.pedidos[1].text, 'Revise o plano. E mande o resumo.', 'o d2 carrega a fala do d1 dentro');
  const envio1 = p.controller.sendDelegation('d1'), envio2 = p.controller.sendDelegation('d2');
  assert.equal(chamadas.length, 2, 'os dois estao no ar ao mesmo tempo (o trinco e por pedido, nao da voz inteira)');
  soltar[1]({ ok: true }); // o 2o termina primeiro: o relogio vai a 800...
  assert.equal((await envio2).ok, true);
  soltar[0]({ ok: true }); // ...e o 1o termina depois: o fim dele (500) nao pode puxar o relogio de volta
  assert.equal((await envio1).ok, true);
  p.fala(' Depois feche.', 900, 1000); p.pedido('d3', 1010);
  assert.equal(p.pedidos[2].text, 'Depois feche.', 'a fala do d2 (600 a 800 ms) ja foi enviada e nao volta no 3o pedido');
  // e nenhum dos dois pedidos velhos pode ser enviado de novo
  assert.equal((await p.controller.sendDelegation('d1')).ok, false);
  assert.equal((await p.controller.sendDelegation('d2')).ok, false);
  assert.equal(chamadas.length, 2);
});

test('envio que termina depois da voz ser religada nao consome a fala da conexao nova (R5-02)', async (t) => {
  let soltar;
  const p = await palco(t, { sendToPane: () => new Promise((ok) => { soltar = ok; }) });
  p.fala('Revise o plano.', 0, 5000); p.pedido('d1', 5010);
  const preso = p.controller.sendDelegation('d1');
  p.controller.dispose(); // a voz cai com o envio ainda no ar...
  await p.conectar(); // ...e e' religada: o relogio da transcricao recomeca do zero
  soltar({ ok: true }); await preso; // o envio velho so' termina agora
  p.fala('Nova fala.', 0, 300); p.pedido('d9', 310);
  assert.equal(p.pedidos.length, 2, 'a fala da conexao nova nao foi tratada como ja enviada');
  assert.equal(p.pedidos[1].text, 'Nova fala.');
});

/* =====================================================================
   cartao: o botao volta, o erro aparece, o mesmo cartao reenvia
   ===================================================================== */
for (const [quando, falha, mensagem] of FALHAS) {
  test('cartao: envio que ' + quando + ' religa o Enviar, mostra o erro e deixa reenviar (R5-02)', async (t) => {
    const painel = painelFalso(falha, ENVIADO);
    const p = await palco(t, { sendToPane: painel.sendToPane, cartao: true });
    p.fala('Revise o plano.', 0, 500); p.pedido('d1', 510);
    const { campo, enviar, resultado } = p.cartao();
    assert.equal(campo.value, 'Revise o plano.');
    campo.value = 'Revise somente os titulos.'; // ele corrige o texto antes de enviar
    await enviar.clicar();
    assert.equal(painel.chamadas.length, 1);
    assert.equal(enviar.disabled, false, 'o botao volta, para ele tentar de novo');
    assert.match(resultado.textContent, mensagem, 'o erro fica visivel no cartao');
    assert.equal(campo.disabled, false);
    assert.equal(campo.value, 'Revise somente os titulos.', 'o texto que ele escreveu continua la');
    await enviar.clicar();
    assert.equal(painel.chamadas.length, 2); assert.equal(painel.chamadas[1][1], 'Revise somente os titulos.');
    assert.equal(resultado.textContent, 'Enviado à sessão.');
    assert.equal(enviar.disabled, true, 'enviado: nao tem o que reenviar'); assert.equal(campo.disabled, true);
  });
}
