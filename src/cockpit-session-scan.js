'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const search = require('./cockpit-search');

function createScanner({ cacheLimit = 20000 } = {}) {
  const cache = new Map();
  async function scan({ root, engine, parse, decorate = item => item, signal, onProgress = () => {},
    limit = 5000, batchSize = 32, ...bounds }) {
    const state = {}, items = [], seen = new Set(); let batch = [], inspected = 0, first = true, lastPublished = 0;
    function publish(force = false) {
      if (!batch.length) return;
      if (!force && !first && Date.now() - lastPublished < 80 && batch.length < 256) return;
      search.check(signal);
      onProgress({ items: batch, scanned: inspected, dirs: state.dirs, complete: false });
      batch = []; first = false; lastPublished = Date.now();
    }
    for await (const { file } of search.walkFiles(root, { ...bounds, signal, state, maxDepth: 5,
      ignore: name => name === 'subagents' || name === 'workflows', accept: name => name.endsWith('.jsonl') })) {
      search.check(signal);
      let stat;
      try { stat = await fs.stat(file); } catch { continue; }
      if (stat.size <= 300) continue;
      inspected++;
      const key = engine + '|' + file, cached = cache.get(key);
      let metadata;
      if (cached?.mtime === stat.mtimeMs && cached?.size === stat.size) metadata = cached.value;
      else {
        try {
          const head = await search.readWindow(file, engine === 'codex' ? 512 * 1024 : 64 * 1024, { signal });
          const tail = engine === 'claude' ? await search.readWindow(file, 96 * 1024, { signal, tail: true }) : { text: '' };
          metadata = await parse(head.text, tail.text, { file, when: stat.mtimeMs, size: stat.size, signal });
        } catch (error) { if (error.name === 'AbortError') throw error; continue; }
        cache.set(key, { mtime: stat.mtimeMs, size: stat.size, value: metadata });
        if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
      }
      search.check(signal);
      const item = decorate({ engine, id: path.basename(file, '.jsonl'), file, when: stat.mtimeMs, ...metadata });
      if (item && !seen.has(item.id)) {
        seen.add(item.id); items.push(item); batch.push(item);
        if (first || batch.length >= batchSize) publish();
      }
      if (inspected % 16 === 0) { publish(); await search.breathe(); }
    }
    publish(true);
    items.sort((a, b) => b.when - a.when || String(a.id).localeCompare(String(b.id)));
    return { items: items.slice(0, limit), scanned: inspected, complete: true, truncated: state.truncated || items.length > limit };
  }
  return { scan, cache };
}

// Cada janela só pode cancelar suas próprias consultas. Escopos separados
// permitem que a lateral e a paleta carreguem sem cancelar uma à outra.
function createBroker(run) {
  const owners = new Map();
  function ownerJobs(sender) {
    if (!owners.has(sender)) {
      const jobs = new Map(); owners.set(sender, jobs);
      sender.once?.('destroyed', () => { for (const job of jobs.values()) job.controller.abort(); owners.delete(sender); });
    }
    return owners.get(sender);
  }
  async function start(sender, request) {
    const id = String(request?.requestId || ''), scope = String(request?.scope || request?.engine || '');
    if (!/^[\w:.-]{1,120}$/.test(id) || scope.length > 120) return { error: 'Identificador de consulta inválido.' };
    const jobs = ownerJobs(sender);
    for (const [key, job] of jobs) if (job.scope === scope || key === id) { job.controller.abort(); jobs.delete(key); }
    if (jobs.size >= 12) return { error: 'Há consultas demais em andamento.' };
    const job = { scope, controller: new AbortController() }; jobs.set(id, job);
    const current = () => jobs.get(id) === job && !job.controller.signal.aborted && !sender.isDestroyed?.();
    try {
      const answer = await run(request, { signal: job.controller.signal, onProgress: progress => {
        if (current()) sender.send('sessions:progress', { ...progress, requestId: id, engine: request.engine });
      } });
      return current() ? { ...answer, requestId: id } : { cancelled: true, requestId: id };
    } catch (error) {
      return error.name === 'AbortError' ? { cancelled: true, requestId: id } : { error: String(error.message || error), requestId: id };
    } finally { if (jobs.get(id) === job) jobs.delete(id); }
  }
  function cancel(sender, id) {
    const jobs = owners.get(sender), job = jobs?.get(String(id));
    if (!job) return false;
    job.controller.abort(); jobs.delete(String(id)); return true;
  }
  return { start, cancel };
}

function parseCodex(text, _tail, { when }, { technical = () => false, clean = value => value } = {}) {
  let id = '', cwd = '', entrada = '', title = '', fallback = '';
  for (const line of text.split('\n')) {
    let item; try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};
    if (item.type === 'session_meta') { id = payload.id || payload.session_id || ''; cwd = payload.cwd || ''; entrada = payload.originator || payload.source || ''; }
    if (item.type === 'response_item' && payload.type === 'message') {
      const value = Array.isArray(payload.content) ? payload.content.map(v => v.text || '').join(' ').trim() : '';
      if (!title && payload.role === 'user' && value && !technical(value)) title = clean(value).slice(0, 90);
      else if (!fallback && payload.role === 'assistant' && value) fallback = value.slice(0, 90);
    }
    if (id && title) break;
  }
  return { ...(id ? { id } : {}), cwd, entrada, _needsMore: !title,
    title: title || fallback || 'Conversa de ' + new Date(when).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) };
}

// O contexto inicial do Codex pode ocupar mais que a cabeça do arquivo.
// Segue em blocos até encontrar o primeiro pedido, sem carregar o JSONL inteiro.
async function parseCodexFile(head, tail, meta, rules) {
  let parsed = parseCodex(head, tail, meta, rules);
  if (!parsed._needsMore || meta.size <= 512 * 1024) { delete parsed._needsMore; return parsed; }
  const handle = await fs.open(meta.file, 'r');
  let position = 0, carry = '', skipLine = false, decoder;
  const limit = Math.min(meta.size, 16 * 1024 * 1024);
  try {
    while (position < limit && parsed._needsMore) {
      search.check(meta.signal);
      const buffer = Buffer.alloc(Math.min(65536, limit - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      // StringDecoder mantém caracteres UTF-8 que cruzam blocos.
      decoder ||= new (require('node:string_decoder').StringDecoder)('utf8');
      carry += decoder.write(buffer.subarray(0, bytesRead));
      let index;
      while ((index = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, index); carry = carry.slice(index + 1);
        if (skipLine) { skipLine = false; continue; }
        const current = parseCodex(line, '', meta, rules);
        if (current.id) parsed.id = current.id;
        if (current.cwd) parsed.cwd = current.cwd;
        if (current.entrada) parsed.entrada = current.entrada;
        if (!current._needsMore) { parsed.title = current.title; parsed._needsMore = false; break; }
      }
      if (carry.length > 2 * 1024 * 1024) { carry = ''; skipLine = true; }
      await search.breathe();
    }
    if (position >= meta.size && carry && !skipLine && parsed._needsMore) {
      const current = parseCodex(carry, '', meta, rules);
      if (!current._needsMore) { parsed.title = current.title; parsed._needsMore = false; }
    }
  } finally { await handle.close(); }
  if (position < meta.size && parsed._needsMore) parsed.titleTruncated = true;
  delete parsed._needsMore; return parsed;
}

module.exports = { createScanner, createBroker, parseCodex, parseCodexFile };
