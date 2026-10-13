(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CockpitLiveVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let mounted = null, sequence = 0;
  function bounded(value, bytes = 450) {
    const source = typeof value === 'string' ? value : String(value?.text || value?.message || '');
    let result = '', length = 0;
    for (const character of source.replace(/\s+/g, ' ').trim()) {
      const n = new TextEncoder().encode(character).length;
      if (length + n > bytes) break; result += character; length += n;
    }
    return result;
  }
  function createController({ session, start, sendToPane, getContext = () => '', interruptPane,
    isCurrent = () => true, onState = () => {}, onTranscript = () => {}, onDelegation = () => {},
    mediaDevices = globalThis.navigator?.mediaDevices, Peer = globalThis.RTCPeerConnection,
    makeAudio = () => new Audio(), makeStream = tracks => new MediaStream(tracks),
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const target = Object.freeze({ paneId: String(session?.paneId ?? ''), threadId: String(session?.threadId || ''), engine: String(session?.engine || '') });
    let peer, events, microphone, audio, ready = false, active = false, closing = false, epoch = 0, closeTimer, connectTimer, muted = false, micMuted = false;
    let lastInputEnd = -1, lastSentEnd = -1;
    const transcripts = [], seenEvents = new Set(), delegations = new Map();
    function state(value) { onState({ active, ready, closing, muted, micMuted, capturing: !!microphone && !micMuted, session: target, ...value }); }
    function current() { return isCurrent(target) !== false; }
    function send(value) { if (!ready || !events || events.readyState !== 'open') return false; events.send(JSON.stringify({ ...value, event_id: 'cockpit_live_' + (++sequence) })); return true; }
    function append(content, delegationId, aloud = false) {
      const text = bounded(content); if (!text) return false;
      return send({ type: aloud ? 'session.commentary.append' : 'session.thinking.append', delegation_id: delegationId ?? null, content: text });
    }
    function cleanup(message, finalized = false) {
      ++epoch; active = false; ready = false; closing = false;
      clearTimer(closeTimer); clearTimer(connectTimer);
      const oldEvents = events, oldPeer = peer; events = null; peer = null;
      microphone?.getTracks().forEach(track => track.stop()); microphone = null;
      try { oldEvents?.close(); } catch {} try { oldPeer?.close(); } catch {}
      if (audio) { audio.pause?.(); audio.srcObject = null; audio = null; }
      for (const d of delegations.values()) d.cancelled = true;
      delegations.clear(); state({ message, finalized });
    }
    function handleEvent(event) {
      if (!active || !event || typeof event.type !== 'string') return;
      if (!current() && event.type !== 'session.closed') { close(); return; }
      if (event.event_id) { if (seenEvents.has(event.event_id)) return; seenEvents.add(event.event_id); if (seenEvents.size > 1000) seenEvents.delete(seenEvents.values().next().value); }
      if (event.type === 'session.closed') { cleanup('Voz encerrada. O trabalho da sessão continua.', true); return; }
      if (event.type === 'session.started') {
        ready = true; clearTimer(connectTimer); state({ message: 'Microfone ligado · conversa por voz ativa' });
        Promise.resolve(getContext(target)).then(context => { if (active && current()) append(context, null); }).catch(() => {}); return;
      }
      if (event.type === 'error' || event.type === 'session.error') { state({ message: 'A voz informou uma falha. Confira a conexão antes de repetir.', error: true }); return; }
      if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
        if (typeof event.delta !== 'string' || !event.delta) return;
        const item = { role: event.type.includes('input_') ? 'user' : 'assistant', text: event.delta.slice(0, 4000), start: Number(event.start_ms) || 0, end: Number(event.end_ms) || 0 };
        transcripts.push(item); while (transcripts.length > 100 || transcripts.reduce((sum, x) => sum + x.text.length, 0) > 24000) transcripts.shift();
        if (item.role === 'user') lastInputEnd = Math.max(lastInputEnd, item.end);
        onTranscript({ ...item }); return;
      }
      if (event.type === 'session.delegation.created') {
        const id = event.delegation?.id;
        if (event.delegation?.target !== 'client' || typeof id !== 'string' || !id || id.length > 512 || delegations.has(id)) return;
        if (closing || !current()) { append('A sessão mudou ou a voz está encerrando. Nenhuma nova orientação foi enviada.', id, true); return; }
        const end = Number.isFinite(event.offset_ms) ? event.offset_ms : lastInputEnd;
        const input = transcripts.filter(x => x.role === 'user' && x.end > lastSentEnd && x.start <= end);
        if (!input.length) { append('A fala ainda não chegou completa. Peça para repetir a orientação; não suponha o pedido.', id, true); return; }
        const text = input.map(x => x.text).join('').trim().slice(0, 12000);
        const item = { id, text, end: Math.max(...input.map(x => x.end)), sent: false, sending: false, cancelled: false };
        delegations.set(id, item);
        while (delegations.size > 50) delegations.delete(delegations.keys().next().value);
        onDelegation({ id, text, session: target });
        append('A orientação transcrita está na tela para revisão. Aguarde o usuário confirmar antes de dizer que foi enviada.', id, true);
      }
    }
    async function connect() {
      if (active) return false;
      if (!target.paneId || !target.threadId || !current()) throw Error('Escolha uma sessão ativa.');
      if (!mediaDevices?.getUserMedia || !Peer || typeof start !== 'function') throw Error('Áudio ao vivo indisponível neste ambiente.');
      active = true; ready = false; closing = false; muted = false; micMuted = false; transcripts.length = 0; seenEvents.clear(); delegations.clear(); lastSentEnd = -1;
      const generation = ++epoch;
      state({ message: 'Preparando microfone e conexão…' });
      try {
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active || epoch !== generation || !current()) { stream.getTracks().forEach(track => track.stop()); if (active && epoch === generation) cleanup('A sessão mudou. Microfone desligado.'); return false; }
        microphone = stream; peer = new Peer(); const connection = peer;
        state({ message: 'Microfone ligado. Preparando a conexão de voz…' });
        audio = makeAudio(); audio.autoplay = true;
        connection.addEventListener('track', event => {
          if (!active || epoch !== generation || !audio) return;
          audio.srcObject = makeStream([event.track]); audio.muted = muted;
          Promise.resolve(audio.play()).catch(() => state({ message: 'Clique no alto-falante para ouvir a voz.' }));
        });
        for (const track of stream.getAudioTracks()) { connection.addTrack(track, stream); track.addEventListener?.('ended', () => { if (active && epoch === generation) close(); }); }
        events = connection.createDataChannel('oai-events'); const channel = events;
        channel.addEventListener('message', event => { if (channel !== events) return; try { const data = typeof event.data === 'string' && event.data.length < 100000 ? JSON.parse(event.data) : null; handleEvent(data); } catch {} });
        channel.addEventListener('close', () => { if (channel === events && active) cleanup('Conexão encerrada; uso final não confirmado. O trabalho da sessão continua.'); });
        connection.addEventListener('connectionstatechange', () => { if (connection === peer && ['failed', 'closed', 'disconnected'].includes(connection.connectionState)) cleanup('A conexão de voz caiu. Microfone desligado; uso final não confirmado.'); });
        connectTimer = setTimer(() => { if (!ready) cleanup('A voz não conectou a tempo. Microfone desligado; confira o uso antes de repetir.'); }, 45000);
        await connection.setLocalDescription(await connection.createOffer());
        if (connection.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
          const timeout = setTimer(() => { connection.removeEventListener('icegatheringstatechange', change); reject(Error('A conexão de áudio demorou demais.')); }, 10000);
          function change() { if (connection.iceGatheringState !== 'complete') return; clearTimer(timeout); connection.removeEventListener('icegatheringstatechange', change); resolve(); }
          connection.addEventListener('icegatheringstatechange', change); change();
        });
        if (!active || epoch !== generation || !current()) { if (active && epoch === generation) cleanup('A sessão mudou. Conexão de voz cancelada.'); return false; }
        const result = await start({ sdp: connection.localDescription?.sdp, session: target });
        if (!active || epoch !== generation) return false;
        if (result?.ok === false || result?.error) throw Error(result.error || 'A voz não conectou.');
        if (!result?.transport?.sdp || result?.session?.paneId !== target.paneId || result?.session?.threadId !== target.threadId) throw Error('A resposta de voz não corresponde à sessão escolhida.');
        await connection.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
        // O POST já criou a sessão. session.start NÃO faz parte deste fluxo.
        return true;
      } catch (error) {
        if (epoch === generation) cleanup(error?.name === 'NotAllowedError' ? 'Microfone não autorizado. Nenhuma conexão de voz foi criada.' : 'Não foi possível ligar a voz. Confira o microfone, a autorização de custo e a conexão.');
        return false;
      }
    }
    async function sendDelegation(id, editedText) {
      const item = delegations.get(id);
      if (!active || !ready || closing || !current() || !item || item.sent || item.sending || item.cancelled || item.end <= lastSentEnd) return { ok: false, error: 'Este pedido de voz não está mais disponível.' };
      const content = typeof editedText === 'string' ? editedText.trim() : item.text;
      if (!content || content.length > 12000 || typeof sendToPane !== 'function') return { ok: false, error: 'Revise a transcrição antes de enviar.' };
      // R5-02: `sending` só segura o clique duplo enquanto o envio está no ar. `sent` e `lastSentEnd` só mudam depois de ok:true, para um pedido que falhou poder ser reenviado.
      item.sending = true;
      try {
        const result = await sendToPane(target, content, { delegationId: id, source: 'voice', transcriptReviewed: true });
        if (result?.ok === false) { append('A orientação não foi enviada. ' + bounded(result.error), id, true); return result; }
        if (!item.cancelled) { item.sent = true; lastSentEnd = Math.max(lastSentEnd, item.end); }
        if (active && !item.cancelled && current()) append(result?.text || 'Orientação enviada à sessão. O trabalho ainda não está confirmado como concluído.', id, true);
        return { ok: true };
      } catch { if (active && !item.cancelled) append('Não consegui confirmar o envio. Confira a conversa antes de repetir para evitar duplicação.', id, true); return { ok: false, error: 'Confira a conversa antes de repetir: o envio não foi confirmado.' }; } finally { item.sending = false; }
    }
    function close() {
      if (!active || closing) return;
      closing = true; microphone?.getAudioTracks().forEach(track => { track.enabled = false; }); micMuted = true;
      state({ message: 'Microfone pausado. Encerrando voz… O trabalho continua.' });
      if (send({ type: 'session.close' })) closeTimer = setTimer(() => cleanup('Voz desconectada; o serviço não confirmou o uso final. O trabalho continua.'), 15000);
      else cleanup('Voz desligada. O trabalho da sessão continua.');
    }
    return { connect, close, sendDelegation, handleEvent,
      update(content, delegationId = null, aloud = false) { if (!current()) return false; return append(content, delegationId, aloud); },
      toggleVoice() {
        if (!audio || !active) return; muted = !muted; audio.muted = muted;
        if (muted) send({ type: 'session.instructions.append', delegation_id: null, content: 'Pare de falar. Aguarde nova fala do usuário; o trabalho em andamento continua.' });
        else Promise.resolve(audio.play()).catch(() => {});
        state({ message: muted ? 'Voz silenciada. Microfone e trabalho seguem ativos.' : 'Voz habilitada.' });
      },
      toggleMicrophone() { if (!active || closing) return; micMuted = !micMuted; microphone?.getAudioTracks().forEach(track => { track.enabled = !micMuted; }); send({ type: micMuted ? 'session.input_audio.mute' : 'session.input_audio.unmute' }); state({ message: micMuted ? 'Microfone pausado. A conexão de voz continua sendo cobrada.' : 'Microfone ligado.' }); },
      async interruptWork() { if (!current() || typeof interruptPane !== 'function') return { ok: false }; return interruptPane(target); },
      dispose() { if (active) { try { send({ type: 'session.close' }); } catch {} cleanup('Voz desligada. O trabalho da sessão continua.'); } },
      getState() { return { active, ready, closing, muted, micMuted, session: target }; },
    };
  }
  function mount({ container, P, session, start, sendToPane, getContext, interruptPane, isCurrent, ...injected }) {
    mounted?.dispose();
    const doc = container.ownerDocument;
    const target = session || { paneId: String(P?.id ?? ''), threadId: String(P?.sessionId || P?.threadId || ''), engine: P?.engine || '' };
    const root = doc.createElement('section'); root.className = 'live-voice'; root.style.cssText = 'display:grid;gap:12px;min-width:0;width:100%;box-sizing:border-box';
    const label = doc.createElement('strong'); label.textContent = 'Voz · ' + (P?.nome || P?.title || target.engine || 'Sessão') + ' · ' + target.threadId;
    label.style.overflowWrap = 'anywhere';
    const cost = doc.createElement('p'); cost.style.cssText = 'margin:0;font-size:12px;line-height:1.5;opacity:.8';
    cost.textContent = 'API separada: US$ 0,05/min conectado, além do motor da sessão. A abertura WebRTC cobra 15 segundos, creditados na duração se conectar. O ditado local continua disponível.';
    const consent = doc.createElement('label'); consent.style.cssText = 'display:flex;gap:8px;align-items:flex-start;font-size:12px';
    const accepted = doc.createElement('input'); accepted.type = 'checkbox';
    consent.append(accepted, doc.createTextNode('Autorizo a cobrança e o envio à OpenAI do áudio, dos pedidos revisados e das respostas desta sessão selecionada. Vou revisar cada pedido antes de enviá-lo ao motor.'));
    const toolbar = doc.createElement('div'); toolbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    function btn(title, glyph, fn) { const b = doc.createElement('button'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.className = 'connector-icon'; b.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</svg>'; b.addEventListener('click', fn); toolbar.append(b); return b; }
    const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.style.cssText = 'margin:0;font-size:12px';
    status.textContent = 'Microfone desligado. Nada é cobrado enquanto você não conectar.';
    const indicator = doc.createElement('span'); indicator.className = 'live-microphone-state'; indicator.style.cssText = 'font-size:12px;font-weight:600'; indicator.textContent = 'Microfone desligado';
    const captions = doc.createElement('div'); captions.setAttribute('aria-label', 'Transcrição da conversa por voz'); captions.style.cssText = 'max-height:180px;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere';
    const requests = doc.createElement('div'); requests.style.cssText = 'display:grid;gap:10px';
    let controller;
    const begin = btn('Conectar voz', '<path d="M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>', () => { if (!accepted.checked) { status.textContent = 'Marque a autorização de cobrança para conectar.'; return; } void controller.connect(); });
    const stop = btn('Encerrar conexão de voz', '<rect x="5" y="5" width="14" height="14" rx="3"/>', () => controller.close());
    const speak = btn('Silenciar voz sem parar trabalho', '<path d="M11 5 6 9H3v6h3l5 4zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>', () => controller.toggleVoice());
    const mic = btn('Pausar microfone', '<path d="M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M3 3l18 18"/>', () => controller.toggleMicrophone());
    if (typeof interruptPane === 'function') btn('Interromper o trabalho da sessão', '<path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M10 4v10h10M10 14 21 3"/>', async () => { await controller.interruptWork(); status.textContent = 'Pedido de interrupção enviado à sessão. A voz continua.'; });
    for (const b of [stop, speak, mic]) b.disabled = true;
    controller = createController({ ...injected, session: target, start: args => start({ ...args, costAccepted: accepted.checked }), sendToPane, getContext, interruptPane, isCurrent,
      onState(value) { status.textContent = value.message || status.textContent; root.dataset.microphone = value.capturing ? 'on' : 'off'; indicator.textContent = value.active ? value.micMuted ? 'Microfone pausado · conexão ativa' : value.capturing ? '● Microfone ligado · conexão ativa' : 'Aguardando microfone' : 'Microfone desligado'; begin.disabled = value.active; accepted.disabled = value.active; stop.disabled = !value.active || value.closing; speak.disabled = !value.ready; mic.disabled = !value.ready || value.closing; speak.setAttribute('aria-pressed', String(value.muted)); mic.setAttribute('aria-pressed', String(value.micMuted)); if (!value.active) accepted.checked = false; },
      onTranscript(item) { const line = doc.createElement('span'); line.textContent = (item.role === 'user' ? 'Você: ' : 'Voz: ') + item.text + '\n'; captions.append(line); while (captions.children.length > 80) captions.firstElementChild.remove(); captions.scrollTop = captions.scrollHeight; },
      onDelegation(item) {
        const card = doc.createElement('div'); card.className = 'connector-host-action';
        const field = doc.createElement('textarea'); field.value = item.text; field.rows = 3; field.maxLength = 12000; field.setAttribute('aria-label', 'Revisar pedido de voz antes de enviar'); field.className = 'connector-input';
        const send = doc.createElement('button'); send.type = 'button'; send.title = 'Enviar transcrição revisada para esta sessão'; send.setAttribute('aria-label', send.title); send.className = 'connector-icon'; send.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m4 12 16-8-5 16-3-6zM12 14l8-10"/></svg>';
        const result = doc.createElement('span'); result.setAttribute('role', 'status'); result.style.fontSize = '12px';
        send.addEventListener('click', async () => { send.disabled = true; const r = await controller.sendDelegation(item.id, field.value); result.textContent = r.ok ? 'Enviado à sessão.' : r.error || 'Não foi possível enviar.'; field.disabled = r.ok; send.disabled = r.ok; });
        card.append(field, send, result); requests.append(card); while (requests.children.length > 10) requests.firstElementChild.remove();
      },
    });
    root.append(label, cost, consent, toolbar, indicator, status, captions, requests); container.append(root);
    const removed = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { if (!root.isConnected) handle.dispose(); }) : null;
    const onUnload = () => handle.dispose(); doc.defaultView?.addEventListener('beforeunload', onUnload);
    let disposed = false;
    const handle = { controller, element: root, update: (...args) => controller.update(...args), dispose() { if (disposed) return; disposed = true; removed?.disconnect(); doc.defaultView?.removeEventListener('beforeunload', onUnload); controller.dispose(); root.remove(); if (mounted === handle) mounted = null; } };
    removed?.observe(doc.documentElement, { childList: true, subtree: true }); mounted = handle;
    return handle;
  }
  return { createController, mount, bounded };
});
