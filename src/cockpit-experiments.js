'use strict';
// Pilotos opcionais da API. Nenhum acesso de rede acontece no boot/status.
// A chave usa a proteção do SO e nunca volta ao renderer nem ao config.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FEATURES = new Set(['images', 'voice', 'cloud']);
const IMAGE_MODELS = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
const id = value => { if (typeof value !== 'string' || !/^[\w-]{1,180}$/.test(value)) throw Error('Identificador inválido.'); return encodeURIComponent(value); };
function rasterDimensions(buf, mime) {
  try {
    if (mime === 'image/png') {
      if (buf.length < 45 || buf.readUInt32BE(8) !== 13 || buf.subarray(12,16).toString() !== 'IHDR') return null;
      let at = 8, data = false, count = 0;
      while (at + 12 <= buf.length && ++count < 100000) {
        const length = buf.readUInt32BE(at), type = buf.subarray(at+4,at+8).toString();
        if (at + 12 + length > buf.length) return null;
        if (type === 'IDAT' && length) data = true;
        if (type === 'IEND') return length === 0 && at + 12 === buf.length && data ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;
        at += length + 12;
      }
    }
    if (mime === 'image/jpeg') {
      if (buf.length < 12 || buf[2] !== 255 || buf.at(-2) !== 255 || buf.at(-1) !== 217) return null;
      let at = 2, dims;
      while (at + 3 < buf.length) {
        if (buf[at++] !== 255) return null;
        while (buf[at] === 255) at++;
        const mark = buf[at++];
        if (mark === 0xda) return dims || null;
        if (mark === 0xd9) return null;
        if (mark === 1 || (mark >= 0xd0 && mark <= 0xd7)) continue;
        const length = buf.readUInt16BE(at);
        if (length < 2 || at + length > buf.length) return null;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(mark) && length >= 7) dims = [buf.readUInt16BE(at+5),buf.readUInt16BE(at+3)];
        at += length;
      }
    }
    if (mime === 'image/webp') {
      if (buf.length < 25 || buf.readUInt32LE(4) + 8 !== buf.length) return null;
      let at = 12, dims, hasImage = false;
      while (at + 8 <= buf.length) {
        const kind = buf.subarray(at,at+4).toString(), n = buf.readUInt32LE(at+4), start = at + 8;
        if (start + n > buf.length) return null;
        if (kind === 'VP8X') { if (n < 10 || (buf[start] & 2)) return null; dims = [buf.readUIntLE(start+4,3)+1,buf.readUIntLE(start+7,3)+1]; }
        else if (kind === 'VP8 ') {
          if (n < 10 || !buf.subarray(start+3,start+6).equals(Buffer.from([157,1,42]))) return null;
          dims ||= [buf.readUInt16LE(start+6)&0x3fff,buf.readUInt16LE(start+8)&0x3fff]; hasImage = true;
        } else if (kind === 'VP8L') {
          if (n < 5 || buf[start] !== 47) return null;
          const bits = buf.readUInt32LE(start+1); dims ||= [(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1]; hasImage = true;
        } else if (kind === 'ANIM' || kind === 'ANMF') return null;
        at = start + n + (n % 2);
      }
      return at === buf.length && hasImage ? dims : null;
    }
  } catch {}
  return null;
}
function imageData(value) {
  const m = typeof value === 'string' && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m || m[2].length > 28 * 1024 * 1024 || m[2].length % 4) throw Error('Imagem inválida ou maior que 20 MB.');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 20 * 1024 * 1024 || buffer.toString('base64') !== m[2]) throw Error('Imagem inválida ou maior que 20 MB.');
  const dims = rasterDimensions(buffer, m[1]);
  const signature = m[1] === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : m[1] === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 : buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
  if (!signature || !dims || dims.some(n => !Number.isInteger(n) || n < 1 || n > 20000) || dims[0] * dims[1] > 64000000) throw Error('A imagem não corresponde ao formato informado ou excede as dimensões aceitas.');
  return { mime: m[1], buffer, data: value };
}
function createExperiments({ folder, safeStorage, fetch: fetcher = globalThis.fetch, now = Date.now, artifactTimeout = 120000, log = () => {} }) {
  // o main entrega o logMain; sem logger, ou com um que lança, nada muda
  const registrar = (contexto, erro) => { try { log(contexto, erro); } catch {} };
  const root = () => typeof folder === 'function' ? folder() : folder;
  const grants = new Map(), inflight = new Set();
  const credentialPath = () => path.join(root(), 'openai-api.encrypted');
  const sessionsPath = () => path.join(root(), 'cloud-sessions.json');
  const pendingPath = () => path.join(root(), 'cloud-pending.json');
  const creating = new Set(), approving = new Set();
  const approvalSecret = crypto.randomBytes(32);
  const approvalToken = (sessionId, action) => crypto.createHmac('sha256', approvalSecret)
    .update(JSON.stringify([accountKey(), sessionId, action.request_id, action.request])).digest('hex');
  const pending = () => { try { const a = JSON.parse(fs.readFileSync(pendingPath(), 'utf8')); if (!Array.isArray(a) || a.some(p => !p || typeof p.operation !== 'string' || typeof p.account !== 'string')) throw Error('registro inválido'); return a; } catch (e) { if (e.code === 'ENOENT') return []; throw Error('Não foi possível conferir as criações anteriores. Preserve cloud-pending.json antes de continuar.'); } };
  const clearPending = operation => write(pendingPath(), JSON.stringify(pending().filter(p => p.operation !== operation)));
  const sessions = () => { try { const a = JSON.parse(fs.readFileSync(sessionsPath(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  function write(file, value) { fs.mkdirSync(root(), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, value, { mode: 0o600 }); fs.renameSync(tmp, file); }
  function readKey() {
    if (!safeStorage?.isEncryptionAvailable()) throw Error('A proteção de credenciais do sistema não está disponível.');
    try { const value = safeStorage.decryptString(fs.readFileSync(credentialPath())); if (value) return value; } catch (e) { registrar('openai:chave', e); }
    throw Error('Configure uma chave da API OpenAI neste painel. A assinatura não substitui essa chave.');
  }
  function status() { return { configured: fs.existsSync(credentialPath()), encryptionAvailable: !!safeStorage?.isEncryptionAvailable(), features: [...FEATURES], enabledByDefault: false }; }
  function setKey(value) {
    if (typeof value !== 'string' || !/^sk-[A-Za-z0-9_-]{16,}$/.test(value.trim())) throw Error('Formato de chave inválido.');
    if (!safeStorage?.isEncryptionAvailable()) throw Error('A proteção de credenciais do sistema não está disponível.');
    write(credentialPath(), safeStorage.encryptString(value.trim())); grants.clear(); return status();
  }
  function grant(feature, costAccepted) {
    if (!FEATURES.has(feature) || costAccepted !== true) throw Error('Confirme a cobrança separada antes de iniciar.');
    readKey();
    for (const [k, g] of grants) if (g.expires < now()) grants.delete(k);
    if (grants.size >= 100) throw Error('Há muitas autorizações pendentes.');
    const token = crypto.randomUUID(); grants.set(token, { feature, expires: now() + 120000 }); return token;
  }
  function authorize(token, feature) {
    const g = grants.get(token); grants.delete(token);
    if (!g || g.feature !== feature || g.expires < now()) throw Error('Autorize este uso pago novamente.');
  }
  async function readBytes(response, maximum, signal, aborted) {
    const stated = response.headers?.get('content-length');
    const length = stated == null ? null : Number(stated);
    const encoding = response.headers?.get('content-encoding');
    if (length != null && (!Number.isSafeInteger(length) || length < 0 || length > maximum)) throw Error('A resposta excedeu o limite de leitura.');
    if (!response.body) {
      const data = Buffer.from(await Promise.race([response.text(), aborted]), 'utf8');
      if (data.length > maximum) throw Error('A resposta excedeu o limite de leitura.');
      return data;
    }
    const iterator = response.body[Symbol.asyncIterator]?.();
    if (!iterator) throw Error('A resposta não oferece um fluxo de leitura válido.');
    const chunks = []; let total = 0, complete = false;
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next.done) { complete = true; break; }
        const chunk = Buffer.from(next.value); total += chunk.length;
        if (total > maximum) throw Error('A resposta excedeu o limite de leitura.');
        chunks.push(chunk);
      }
      // fetch descomprime gzip/br, mas preserva o comprimento da versão comprimida.
      if (length != null && (!encoding || encoding === 'identity') && total !== length) throw Error('A resposta chegou incompleta. Confira antes de repetir.');
      return Buffer.concat(chunks, total);
    } finally {
      if (!complete || signal.aborted) { try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} }
    }
  }
  async function request(route, { method = 'GET', body, headers = {}, binary = false, maxBytes = 40 * 1024 * 1024, timeout = 120000 } = {}) {
    if (!/^\/(?:responses|agents\/|realtime\/|live\/)/.test(route) || route.includes('..') || /[\r\n]/.test(route)) throw Error('Rota da API inválida.');
    const key = readKey();
    const abort = new AbortController(); inflight.add(abort);
    const aborted = new Promise((_, reject) => abort.signal.addEventListener('abort', () => { const e = Error('abort'); e.name = 'AbortError'; reject(e); }, { once: true }));
    aborted.catch(() => {}); // cobre também uma falha síncrona de fetch/serialização.
    const timer = setTimeout(() => abort.abort(), timeout); timer.unref?.();
    try {
      const form = typeof FormData !== 'undefined' && body instanceof FormData;
      const response = await Promise.race([fetcher('https://api.openai.com/v1' + route, {
        method, redirect: 'error', signal: abort.signal,
        headers: { ...(!form && body !== undefined ? { 'Content-Type': typeof body === 'string' ? 'application/sdp' : 'application/json' } : {}), ...headers, Authorization: 'Bearer ' + key },
        ...(body !== undefined ? { body: form || typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      }), aborted]);
      if (!response.ok) { const e = Error('A API recusou o pedido (HTTP ' + response.status + '). Confira acesso, limite e cobrança no projeto OpenAI.'); e.status = response.status; throw e; }
      const bytes = await readBytes(response, maxBytes, abort.signal, aborted);
      if (binary) return bytes;
      // Cancelamentos/aprovações podem confirmar aceitação com HTTP 202/204 sem JSON.
      if (!bytes.length && [202,204].includes(response.status)) return { accepted: true };
      return JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      if (e.name === 'AbortError') throw Error('A conexão expirou. Confira o estado antes de repetir; o serviço pode ter recebido o pedido.');
      // Nunca mostrar uma exceção de rede que possa conter headers/chaves.
      if (/^(A API|A resposta|Configure|A proteção)/.test(e.message)) throw e;
      throw Error('Não consegui confirmar a resposta da API. Confira o estado antes de repetir.');
    } finally { clearTimeout(timer); inflight.delete(abort); if (!abort.signal.aborted) abort.abort(); }
  }
  async function generateImage(o) {
    const prompt = String(o.prompt || '').trim(); if (!prompt || prompt.length > 12000) throw Error('Descreva a imagem em até 12 mil caracteres.');
    if (!IMAGE_MODELS.has(o.model)) throw Error('Modelo de imagem inválido.');
    const content = [{ type: 'input_text', text: prompt }];
    if (o.image) content.push({ type: 'input_image', image_url: imageData(o.image).data });
    authorize(o.grant, 'images');
    const r = await request('/responses', { method: 'POST', timeout: 300000, body: {
      model: 'gpt-6-astra', store: false, input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', model: o.model, output_format: 'png', ...(o.transparent ? { background: 'transparent' } : {}) }],
      tool_choice: { type: 'image_generation' },
    } });
    const output = r.output?.find(x => x.type === 'image_generation_call' && typeof x.result === 'string');
    if (!output) throw Error('A API não devolveu uma imagem. Confira o uso antes de tentar novamente.');
    const image = imageData('data:image/png;base64,' + output.result);
    return { image: image.data, revisedPrompt: String(output.revised_prompt || '').slice(0, 12000), usage: r.usage || null };
  }
  const cloudHeaders = { 'OpenAI-Beta': 'agents=v1' };
  const accountKey = () => crypto.createHash('sha256').update(readKey()).digest('hex').slice(0, 24);
  function ownSession(sessionId) { id(sessionId); const account = accountKey(); const s = sessions().find(s => s.id === sessionId && s.account === account); if (!s) throw Error('Esta tarefa não pertence à chave configurada.'); return s; }
  async function cloudStart(o) {
    const input = String(o.input || '').trim(); if (!input || input.length > 100000) throw Error('Escreva a tarefa (até 100 mil caracteres).');
    authorize(o.grant, 'cloud');
    const account = accountKey();
    if (creating.has(account)) throw Error('Uma tarefa já está sendo criada. Aguarde a confirmação antes de repetir.');
    const previous = pending().find(p => p.account === account);
    creating.add(account);
    let record;
    try {
      if (previous) {
        // Não confia apenas no suporte a Idempotency-Key: recupera pela operação
        // gravada nos metadados. Na incerteza nunca cria outro trabalho.
        let after;
        const cursors = new Set();
        for (let page = 0; page < 10; page++) {
          const list = await request('/agents/sessions?limit=100&order=desc' + (after ? '&after=' + id(after) : ''), { headers: cloudHeaders });
          const rows = Array.isArray(list.data) ? list.data : [];
          const found = rows.find(s => s.metadata?.cockpit_operation === previous.operation);
          if (found) {
            id(found.id); const recovered = { id: found.id, title: previous.title, created: previous.created, account };
            const old = sessions(); if (!old.some(s => s.id === recovered.id && s.account === account)) write(sessionsPath(), JSON.stringify([...old, recovered]));
            clearPending(previous.operation);
            return { ...recovered, account: undefined, session: found, recovered: true };
          }
          if (!list.has_more) break;
          after = list.last_id || rows.at(-1)?.id;
          if (!after || cursors.has(after)) break; cursors.add(after);
        }
        throw Error('A criação anterior continua sem confirmação. Não criei outra tarefa. Confira o projeto OpenAI; repetir aqui apenas tenta localizar a operação anterior.');
      }
      const nonce = crypto.randomUUID();
      record = { operation: nonce, account, created: now(), title: input.slice(0,120) };
      write(pendingPath(), JSON.stringify([...pending(), record]));
      const r = await request('/agents/sessions', { method: 'POST', headers: { ...cloudHeaders, 'Idempotency-Key': nonce }, body: {
      agent: { model: o.model === 'gpt-6.1-sol' ? o.model : 'gpt-6-astra', instructions: 'Responda em português do Brasil. Salve entregáveis em /workspace/outputs. Não publique, envie mensagens ou realize compras sem confirmação do usuário.', ...(o.browser ? { tools: [{ type: 'computer_use', include_screenshots: true }] } : {}) },
      environment: { type: 'openai_hosted', ...(o.browser ? { desktop: { enabled: true }, network: { access: 'enabled' } } : {}) }, input, stream: false, metadata: { cockpit_operation: nonce },
    } });
    const sessionId = r.id || r.session_id || r.session?.id; id(sessionId);
    const saved = { id: sessionId, title: record.title, created: record.created, account };
    write(sessionsPath(), JSON.stringify([...sessions(), saved])); clearPending(nonce);
    return { ...saved, account: undefined, session: r };
    } catch (e) {
      if (record) {
        if (e.status >= 400 && e.status < 500 && ![408,409].includes(e.status)) { clearPending(record.operation); throw e; }
        throw Error('A criação na nuvem ficou sem confirmação. Não repita a tarefa em outro pedido. Tentar novamente aqui somente procura esta operação no projeto OpenAI.');
      }
      throw e;
    } finally { creating.delete(account); }
  }
  async function cloudRead(sessionId) {
    ownSession(sessionId); const base = '/agents/sessions/' + id(sessionId);
    const [session, items, artifacts] = await Promise.all([
      request(base, { headers: cloudHeaders }), request(base + '/items?order=desc&limit=100', { headers: cloudHeaders }),
      request(base + '/artifacts?limit=100', { headers: cloudHeaders }),
    ]);
    for (const action of session.required_actions || []) {
      if (action.type === 'computer_use_approval_request' && ['browser_authentication', 'browser_origin_access'].includes(action.request?.type)) action.cockpit_request_token = approvalToken(sessionId, action);
    }
    return { session, items: items.data || [], artifacts: artifacts.data || [], hasMore: !!items.has_more || !!artifacts.has_more,
      hasMoreItems: !!items.has_more, hasMoreArtifacts: !!artifacts.has_more };
  }
  async function cloudCancel(sessionId) { ownSession(sessionId); return request('/agents/sessions/' + id(sessionId) + '/events', { method: 'POST', headers: cloudHeaders, body: { events: [{ type: 'agent.session.input.cancel' }] } }); }
  async function cloudApprove({ sessionId, requestId, decision, requestToken, fields, selectedOption, originConfirmed }) {
    ownSession(sessionId);
    if (!['approve', 'deny', 'cancel', 'submit'].includes(decision)) throw Error('Decisão inválida.');
    id(requestId);
    const pendingKey = sessionId + ':' + requestId;
    if (approving.has(pendingKey)) throw Error('Este pedido já está sendo respondido. Aguarde e atualize a tarefa.');
    approving.add(pendingKey);
    try {
    const base = '/agents/sessions/' + id(sessionId);
    const current = await request(base, { headers: cloudHeaders });
    ownSession(sessionId);
    const action = current.required_actions?.find(a => a.type === 'computer_use_approval_request' && a.request_id === requestId);
    if (!action) throw Error('Este pedido não está mais pendente.');
    let response;
    if (action.request?.type === 'browser_origin_access' && decision !== 'submit') {
      if (decision === 'approve' && requestToken !== approvalToken(sessionId, action)) throw Error('O pedido de acesso mudou. Atualize a tarefa e confira o site novamente.');
      response = { type: 'browser_origin_access', decision };
    }
    else if (action.request?.type === 'browser_authentication' && decision === 'cancel') response = { type: 'browser_authentication', action: 'cancel' };
    else if (action.request?.type === 'browser_authentication' && decision === 'submit') {
      if (originConfirmed !== true || requestToken !== approvalToken(sessionId, action)) throw Error('O pedido de login mudou. Atualize a tarefa e confira o destino novamente.');
      response = authenticationResponse(action.request, fields, selectedOption);
    } else throw Error('Resposta incompatível com este pedido. Atualize a tarefa.');
    // A resposta do evento não é histórico: não devolver possíveis ecos de campos ao renderer.
    await request(base + '/events', { method: 'POST', headers: cloudHeaders, body: { events: [{ type: 'agent.session.input.computer_use_approval_request_result', request_id: requestId, response }] } });
    return { accepted: true };
    } finally { approving.delete(pendingKey); }
  }
  async function cloudArtifact(sessionId, artifactId) {
    ownSession(sessionId);
    return request('/agents/sessions/' + id(sessionId) + '/artifacts/' + id(artifactId) + '/content', { headers: cloudHeaders, binary: true, maxBytes: 50 * 1024 * 1024, timeout: artifactTimeout });
  }
  return { status, setKey, grant, authorize, request, generateImage, cloudStart, cloudRead, cloudCancel, cloudArtifact, cloudApprove,
    cloudList() { const account = accountKey(); return sessions().filter(s => s.account === account).map(({ account: _, ...s }) => s); },
    close() { for (const a of inflight) a.abort(); grants.clear(); },
  };
}
function authenticationResponse(request, fields, selectedOption) {
  let origin;
  try { origin = new URL(request.credential_origin); } catch {}
  if (!origin || origin.protocol !== 'https:' || origin.username || origin.password || origin.origin !== request.credential_origin) throw Error('O destino do login não é um endereço HTTPS verificável. Cancele o pedido.');
  const definitions = request.fields, options = request.options || [];
  if (!Array.isArray(definitions) || definitions.length > 30 || !Array.isArray(options) || options.length > 20 || !Array.isArray(fields) || fields.length > 30) throw Error('Formulário de login inválido.');
  const byId = new Map();
  for (const f of definitions) {
    if (!f || typeof f.id !== 'string' || !f.id || f.id.length > 180 || byId.has(f.id)) throw Error('Formulário de login inválido.');
    byId.set(f.id, f);
  }
  let active = definitions;
  if (options.length) {
    const option = options.find(o => o.id === selectedOption);
    if (!option || !Array.isArray(option.field_ids) || new Set(option.field_ids).size !== option.field_ids.length || option.field_ids.some(id => !byId.has(id))) throw Error('Escolha um método de login válido.');
    active = option.field_ids.map(id => byId.get(id));
  } else if (selectedOption !== undefined) throw Error('Este pedido não oferece métodos de login.');
  const allowed = new Set(active.map(f => f.id)), values = new Map();
  for (const f of fields) {
    if (!f || !allowed.has(f.field_id) || values.has(f.field_id) || typeof f.value !== 'string' || f.value.length > 8192 || f.value.includes('\0')) throw Error('Campo de login inválido.');
    values.set(f.field_id, f.value);
  }
  if ((active.length && !fields.length) || active.some(f => f.required && !values.get(f.id)?.trim())) throw Error('Preencha os campos obrigatórios do login.');
  return { type: 'browser_authentication', action: 'submit', fields: fields.map(f => ({ field_id: f.field_id, value: f.value })), ...(options.length ? { selected_option: selectedOption } : {}) };
}
module.exports = { createExperiments, imageData, authenticationResponse };
