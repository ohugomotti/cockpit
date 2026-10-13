'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLive } = require('../src/cockpit-live');
const { createController, bounded } = require('../src/renderer/live-voice');
const session = { paneId: 'p1', threadId: 'thread-live', engine: 'claude' };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

test('backend autoriza custo antes da API e retorna apenas SDP/identidade, sem credencial', async () => {
  const calls = [];
  const live = createLive({ authorize: (...x) => calls.push(['authorize', ...x]), request: async (...x) => { calls.push(['request', ...x]); return { session: { id: 'opaque-live-id', private: 'SECRET' }, transport: { type: 'webrtc', sdp }, key: 'SECRET' }; } });
  const result = await live.offer({ sdp, grant: 'grant-1', session });
  assert.deepEqual(calls[0], ['authorize', 'grant-1', 'voice']);
  assert.equal(calls[1][1], '/live/sessions'); assert.equal(calls[1][2].method, 'POST');
  assert.deepEqual(calls[1][2].body.session.delegation, { type: 'client' });
  assert.equal(calls[1][2].body.session.model, 'gpt-live-1');
  assert.deepEqual(result, { session: { id: 'opaque-live-id', ...session }, transport: { type: 'webrtc', sdp } });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('sem autorização, SDP válido, sessão correta ou configuração, não faz chamada paga', async () => {
  let calls = 0; const request = async () => { calls++; };
  await assert.rejects(createLive({ request, authorize: () => { throw Error('sem aval'); } }).offer({ sdp, session }));
  await assert.rejects(createLive({ request, authorize: () => false }).offer({ sdp, session }));
  const live = createLive({ request, authorize: () => {}, resolveSession: () => ({ ...session, threadId: 'outra' }) });
  await assert.rejects(live.offer({ sdp, session }));
  for (const offer of ['v=0', sdp + 'm=video 9 UDP\r\n', 'x'.repeat(70000)]) await assert.rejects(live.offer({ sdp: offer, session }));
  await assert.rejects(createLive({ request }).offer({ sdp, session }));
  assert.equal(calls, 0);
});
test('conexão paga não repete automaticamente após erro nem em clique simultâneo', async () => {
  let resolve, calls = 0; const gate = new Promise(r => { resolve = r; });
  const live = createLive({ authorize: () => {}, request: async () => { calls++; await gate; throw Error('sem retorno'); } });
  const first = live.offer({ sdp, session }); await new Promise(r => setImmediate(r));
  await assert.rejects(live.offer({ sdp, session }), /já está/); resolve(); await assert.rejects(first);
  assert.equal(calls, 1);
});

class Events {
  constructor() { this.listeners = new Map(); this.readyState = 'open'; this.sent = []; }
  addEventListener(name, cb) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(cb); }
  removeEventListener(name, cb) { this.listeners.get(name)?.delete(cb); }
  fire(name, value = {}) { for (const cb of this.listeners.get(name) || []) cb(value); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 'closed'; this.fire('close'); }
}
function fake(t, options = {}) {
  const tracks = [{ stopped: false, enabled: true, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  let peer, audio, started = 0, submitted = [], interrupted = 0;
  const states = [], prompts = [], captions = [];
  class Peer extends Events {
    constructor() { super(); this.iceGatheringState = 'complete'; this.connectionState = 'new'; peer = this; }
    addTrack() {} createDataChannel() { return this.channel = new Events(); }
    async createOffer() { return { type: 'offer', sdp }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    close() { this.connectionState = 'closed'; this.fire('connectionstatechange'); }
  }
  const controller = createController({ session, Peer,
    mediaDevices: { getUserMedia: async constraints => { assert.deepEqual(constraints, { audio: true, video: false }); return stream; } },
    makeAudio: () => { audio = { muted: false, play: async () => {}, pause() {}, srcObject: null }; return audio; }, makeStream: x => x,
    start: async request => { started++; assert.equal(request.session.engine, 'claude'); return { session: { id: 'live-id', ...session }, transport: { type: 'webrtc', sdp } }; },
    getContext: () => 'Conferindo o plano na VPS. Nenhuma ação concluída.',
    sendToPane: async (...args) => { submitted.push(args); return { ok: true }; },
    interruptPane: async () => { interrupted++; return { ok: true }; },
    onState: x => states.push(x), onDelegation: x => prompts.push(x), onTranscript: x => captions.push(x), ...options });
  t.after(() => controller.dispose());
  return { controller, tracks, states, prompts, captions, get peer() { return peer; }, get audio() { return audio; }, get started() { return started; }, get submitted() { return submitted; }, get interrupted() { return interrupted; } };
}
function event(f, data) { f.peer.channel.fire('message', { data: JSON.stringify(data) }); }
async function connected(f) { await f.controller.connect(); event(f, { type: 'session.started', session: { id: 'live-id' } }); await Promise.resolve(); }
function delegation(f, id = 'd1') {
  event(f, { type: 'session.input_transcript.delta', delta: 'Revise ', start_ms: 0, end_ms: 200, event_id: 'part1' });
  event(f, { type: 'session.input_transcript.delta', delta: 'o plano.', start_ms: 201, end_ms: 500, event_id: 'part2' });
  event(f, { type: 'session.delegation.created', offset_ms: 510, delegation: { id, target: 'client' } });
}
test('WebRTC só liga por connect, recebe SDP e espera started; nunca usa session.start', async t => {
  const f = fake(t); assert.equal(f.started, 0); assert.equal(f.controller.getState().active, false);
  await f.controller.connect(); assert.equal(f.started, 1); assert.equal(f.controller.getState().ready, false);
  assert.equal(f.peer.remoteDescription.type, 'answer');
  event(f, { type: 'session.started' }); await Promise.resolve();
  assert.equal(f.controller.getState().ready, true);
  assert.equal(f.peer.channel.sent.some(e => e.type === 'session.start'), false);
  assert.equal(f.peer.channel.sent.some(e => e.type === 'session.thinking.append'), true);
});
test('delegação usa transcrição acumulada e exige revisão explícita na sessão escolhida', async t => {
  const f = fake(t); await connected(f); delegation(f);
  assert.equal(f.submitted.length, 0); assert.equal(f.prompts[0].text, 'Revise o plano.');
  assert.equal(f.captions.length, 2);
  const result = await f.controller.sendDelegation('d1', 'Revise o plano financeiro.');
  assert.equal(result.ok, true); assert.equal(f.submitted.length, 1);
  assert.deepEqual(f.submitted[0][0], session); assert.equal(f.submitted[0][1], 'Revise o plano financeiro.');
  assert.equal(f.submitted[0][2].transcriptReviewed, true);
  assert.equal((await f.controller.sendDelegation('d1')).ok, false);
});
test('eventos e delegações repetidos não duplicam comandos; metadado sem fala não vira tarefa', async t => {
  const f = fake(t); await connected(f);
  event(f, { type: 'session.delegation.created', offset_ms: 1, delegation: { id: 'empty', target: 'client' }, text: 'NÃO é texto real' });
  assert.equal(f.prompts.length, 0); assert.equal(f.submitted.length, 0);
  delegation(f); delegation(f); assert.equal(f.prompts.length, 1); assert.equal(f.captions.length, 2);
});
test('silenciar fala não cancela trabalho nem microfone; microfone pausado mantém cobrança explícita', async t => {
  const f = fake(t); await connected(f);
  f.controller.toggleVoice(); assert.equal(f.audio.muted, true); assert.equal(f.tracks[0].enabled, true); assert.equal(f.interrupted, 0);
  assert.equal(f.peer.channel.sent.at(-1).type, 'session.instructions.append');
  f.controller.toggleMicrophone(); assert.equal(f.tracks[0].enabled, false); assert.equal(f.peer.channel.sent.at(-1).type, 'session.input_audio.mute');
  assert.match(f.states.at(-1).message, /cobrada/);
  f.controller.toggleMicrophone(); assert.equal(f.tracks[0].enabled, true);
  await f.controller.interruptWork(); assert.equal(f.interrupted, 1); assert.equal(f.controller.getState().active, true);
});
test('encerrar espera session.closed; encerra captura e não cancela motor', async t => {
  const f = fake(t); await connected(f); const channel = f.peer.channel;
  f.controller.close(); assert.equal(channel.sent.at(-1).type, 'session.close'); assert.equal(f.tracks[0].enabled, false);
  assert.equal(f.tracks[0].stopped, false); assert.equal(f.interrupted, 0);
  event(f, { type: 'session.closed', usage: { seconds: 4 } });
  assert.equal(f.tracks[0].stopped, true); assert.equal(f.controller.getState().active, false); assert.equal(f.states.at(-1).finalized, true);
});
test('falha de rede ou descarte do popup desliga trilhas e informa uso incompleto', async t => {
  const f = fake(t); await connected(f); f.peer.connectionState = 'failed'; f.peer.fire('connectionstatechange');
  assert.equal(f.tracks[0].stopped, true); assert.equal(f.controller.getState().active, false); assert.match(f.states.at(-1).message, /não confirmado/);
  assert.equal(f.interrupted, 0);
});
test('trocar identidade da sessão impede envio e encerra voz sem atingir outro motor', async t => {
  let current = true; const f = fake(t, { isCurrent: () => current }); await connected(f); delegation(f); current = false;
  assert.equal((await f.controller.sendDelegation('d1')).ok, false); assert.equal(f.submitted.length, 0);
  event(f, { type: 'session.input_transcript.delta', delta: 'Continue' }); assert.equal(f.controller.getState().closing, true);
});
test('resposta tardia após fechar não volta a tocar áudio nem reabre microfone', async t => {
  let finish; const waiter = new Promise(resolve => { finish = resolve; });
  const f = fake(t, { sendToPane: async () => waiter }); await connected(f); delegation(f);
  const sent = f.controller.sendDelegation('d1'); const channel = f.peer.channel;
  f.controller.dispose(); const count = channel.sent.length; finish({ ok: true, text: 'Concluído' }); await sent;
  assert.equal(channel.sent.length, count); assert.equal(f.tracks[0].stopped, true);
});
test('bloqueio do microfone impede API; textos enviados à voz respeitam limite conservador', async t => {
  const f = fake(t, { mediaDevices: { getUserMedia: async () => { const e = Error(); e.name = 'NotAllowedError'; throw e; } } });
  assert.equal(await f.controller.connect(), false); assert.equal(f.started, 0); assert.match(f.states.at(-1).message, /não autorizado/);
  assert.ok(Buffer.byteLength(bounded('🤖'.repeat(1000))) <= 450);
});
