'use strict';

// Anotações locais do leitor. Nenhuma operação deste módulo lê ou altera o
// documento original; só o processo principal registra documentos já lidos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_COMMENTS = 300;
const DEFAULT_VIEW = Object.freeze({ fontSize: 16, wrap: true, mode: 'preview', scrollTop: 0, panel: '', search: '', filter: 'open' });
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const clone = v => JSON.parse(JSON.stringify(v));
const digest = v => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

function text(v, max, fallback = '') {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw fail('INVALID', 'Uma anotação excede o tamanho permitido ou contém dados inválidos.');
  return v;
}
function integer(v, min, max, fallback) {
  if (v === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(v) || v < min || v > max) throw fail('INVALID', 'Uma anotação contém dados inválidos.');
  return v;
}
function choice(v, values, fallback) {
  if (v === undefined) return fallback;
  if (!values.includes(v)) throw fail('INVALID', 'Uma preferência do leitor é inválida.');
  return v;
}
function bool(v, fallback) {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw fail('INVALID', 'Uma anotação contém dados inválidos.');
  return v;
}

function documentDescriptor(file, remoto, content) {
  if (typeof file !== 'string' || !file || file.length > 8192 || /[\0\r\n]/.test(file) || typeof content !== 'string') {
    throw fail('INVALID', 'Não foi possível identificar este documento.');
  }
  let normalized, identityPath, origin;
  if (remoto) {
    if (!plain(remoto)) throw fail('INVALID', 'Não foi possível identificar o servidor deste documento.');
    const host = text(remoto.host, 255).replace(/^\[([^\]]+)\]$/, '$1').toLowerCase();
    const user = text(remoto.usuario, 255);
    const port = integer(Number(remoto.porta || 22), 1, 65535);
    if (!host || !user || /[\s/@]/.test(host) || /[\s/]/.test(user)) throw fail('INVALID', 'Não foi possível identificar o servidor deste documento.');
    // Não inferir /home/usuario: o diretório home pode ser personalizado.
    // Caminhos ~ ficam no próprio domínio lógico; caminhos absolutos POSIX
    // preservam caixa, ao contrário dos caminhos locais do Windows.
    const remoteBase = typeof remoto.caminhoRemoto === 'string' ? remoto.caminhoRemoto : '~';
    normalized = path.posix.normalize(file.startsWith('/') || file === '~' || file.startsWith('~/') ? file : path.posix.join(remoteBase, file));
    identityPath = normalized;
    origin = { kind: 'remote', host, user, port };
  } else {
    if (/^[A-Za-z]:[\\/]/.test(file) || /^\\\\/.test(file)) {
      normalized = path.win32.normalize(file);
      identityPath = normalized.toLowerCase();
    } else {
      normalized = path.resolve(file);
      identityPath = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
    origin = { kind: 'local' };
  }
  const id = digest(JSON.stringify({ origin, path: identityPath }));
  return { id, path: normalized, origin, version: digest(content) };
}

function anchor(input) {
  if (!plain(input)) throw fail('INVALID', 'O comentário é inválido.');
  const version = text(input.version, 64);
  if (!HASH.test(version)) throw fail('INVALID', 'A versão do documento é inválida. Reabra o arquivo.');
  const start = integer(input.start, 0, 2 * 1024 * 1024, 0);
  const end = integer(input.end, start, 2 * 1024 * 1024, start);
  return {
    text: text(input.text, 16000), quote: text(input.quote, 16000),
    prefix: text(input.prefix, 1000), suffix: text(input.suffix, 1000),
    section: text(input.section, 500), start, end, version,
    mode: choice(input.mode, ['preview', 'code'], 'preview'),
  };
}
function comment(input, now) {
  const result = anchor(input);
  if (!ID.test(input.id || '') || !result.text.trim()) throw fail('INVALID', 'O comentário precisa de um identificador e de um texto.');
  result.id = input.id;
  result.resolved = bool(input.resolved, false);
  result.createdAt = integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER, now);
  result.updatedAt = integer(input.updatedAt, result.createdAt, Number.MAX_SAFE_INTEGER, Math.max(now, result.createdAt));
  return result;
}
function draft(input) {
  if (input === null || input === undefined) return null;
  const result = anchor(input);
  if (input.id !== undefined) {
    if (!ID.test(input.id)) throw fail('INVALID', 'O rascunho é inválido.');
    result.id = input.id;
  }
  return result;
}
function view(input = {}) {
  if (!plain(input)) throw fail('INVALID', 'As preferências do leitor são inválidas.');
  return {
    fontSize: integer(input.fontSize, 12, 26, DEFAULT_VIEW.fontSize),
    wrap: bool(input.wrap, true), mode: choice(input.mode, ['preview', 'code'], 'preview'),
    scrollTop: integer(input.scrollTop, 0, 100000000, 0),
    panel: choice(input.panel, ['', 'toc', 'comments'], ''),
    search: text(input.search, 300), filter: choice(input.filter, ['open', 'resolved'], 'open'),
  };
}
function state(input, now = Date.now()) {
  if (!plain(input) || !Array.isArray(input.comments) || input.comments.length > MAX_COMMENTS) throw fail('INVALID', 'Há anotações demais ou dados inválidos neste documento.');
  const comments = input.comments.map(c => comment(c, now));
  if (new Set(comments.map(c => c.id)).size !== comments.length) throw fail('INVALID', 'Há comentários com identificadores repetidos.');
  return { revision: integer(input.revision, 0, Number.MAX_SAFE_INTEGER), comments, draft: draft(input.draft), view: view(input.view) };
}
const emptyState = () => ({ revision: 0, comments: [], draft: null, view: { ...DEFAULT_VIEW } });

function createStore({ directory, io = fs, now = Date.now } = {}) {
  if (typeof directory !== 'string' && typeof directory !== 'function') throw new TypeError('directory obrigatório');
  // Somente registros entregues por arquivo:ver podem acessar anotações.
  const registered = new Map();
  const root = () => path.resolve(typeof directory === 'function' ? directory() : directory);
  const filename = id => path.join(root(), id + '.json');
  function registerDocument(file, remoto, content) {
    const descriptor = documentDescriptor(file, remoto, content);
    registered.set(descriptor.id, descriptor);
    return clone(descriptor);
  }
  function known(document) {
    if (!plain(document) || !HASH.test(document.id || '') || !registered.has(document.id)) throw fail('UNKNOWN_DOCUMENT', 'Reabra o documento para acessar suas anotações.');
    return registered.get(document.id);
  }
  function load(descriptor) {
    const target = filename(descriptor.id);
    let raw;
    try {
      const stat = io.statSync(target);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw fail('CORRUPT', 'O registro de anotações está danificado. Ele foi preservado para recuperação.');
      raw = io.readFileSync(target, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    }
    try {
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error();
      const record = JSON.parse(raw);
      if (!plain(record) || record.schema !== 1 || record.documentId !== descriptor.id) throw new Error();
      return state(record.state, now());
    } catch {
      throw fail('CORRUPT', 'O registro de anotações está danificado. Ele foi preservado para recuperação.');
    }
  }
  function errorResult(error) {
    const safe = ['INVALID', 'UNKNOWN_DOCUMENT', 'CORRUPT', 'TOO_LARGE', 'BUSY'];
    return { ok: false, code: safe.includes(error.code) ? error.code : 'STORAGE', error: safe.includes(error.code) ? error.message : 'Não consegui guardar ou ler as anotações. Seu texto não foi substituído. Tente novamente.' };
  }
  function get(document) {
    try { return { ok: true, state: clone(load(known(document))) }; }
    catch (error) { return errorResult(error); }
  }
  function acquireLock(target) {
    const lock = target + '.lock';
    let fd;
    try { fd = io.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Uma instância encerrada abruptamente pode deixar o lock. Só removemos
      // quando sabemos que o processo morreu (ou o lock vazio envelheceu).
      let stale = false;
      try {
        const age = now() - io.statSync(lock).mtimeMs;
        const owner = JSON.parse(io.readFileSync(lock, 'utf8'));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (e) { stale = e.code === 'ESRCH'; }
        } else stale = age > 60000;
      } catch { try { stale = now() - io.statSync(lock).mtimeMs > 60000; } catch {} }
      if (!stale) throw fail('BUSY', 'As anotações estão sendo salvas em outra janela. Tente novamente; seu texto foi mantido.');
      // Não remover lock que outra instância substituiu nesse intervalo.
      const marker = io.statSync(lock);
      try {
        const owner = JSON.parse(io.readFileSync(lock, 'utf8'));
        if (owner.pid) {
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
          if (!dead) throw fail('BUSY', 'As anotações estão sendo salvas em outra janela. Tente novamente.');
        }
      } catch (e) { if (e.code === 'BUSY') throw e; }
      const again = io.statSync(lock);
      if (again.ino !== marker.ino || again.mtimeMs !== marker.mtimeMs) throw fail('BUSY', 'As anotações estão sendo salvas em outra janela. Tente novamente.');
      io.unlinkSync(lock);
      try { fd = io.openSync(lock, 'wx', 0o600); }
      catch { throw fail('BUSY', 'As anotações estão sendo salvas em outra janela. Tente novamente.'); }
    }
    try { io.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now() }), 'utf8'); }
    catch (error) { try { io.closeSync(fd); } catch {} try { io.unlinkSync(lock); } catch {} throw error; }
    return () => { try { io.closeSync(fd); } catch {} try { io.unlinkSync(lock); } catch {} };
  }
  function save(input) {
    let release, temporary;
    try {
      if (!plain(input)) throw fail('INVALID', 'O pedido para salvar anotações é inválido.');
      const descriptor = known(input.document);
      const expected = integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
      if (input.view !== undefined && !plain(input.view)) throw fail('INVALID', 'As preferências do leitor são inválidas.');
      io.mkdirSync(root(), { recursive: true });
      const target = filename(descriptor.id);
      release = acquireLock(target);
      const previous = load(descriptor);
      if (expected !== previous.revision) return { ok: false, code: 'CONFLICT', error: 'As anotações mudaram em outra janela. Seu texto foi mantido; recarregue as anotações antes de tentar novamente.', state: clone(previous) };
      if (previous.revision === Number.MAX_SAFE_INTEGER) throw fail('INVALID', 'O registro atingiu seu limite de revisões.');
      const next = state({
        revision: previous.revision + 1,
        comments: input.comments === undefined ? previous.comments : input.comments,
        draft: input.draft === undefined ? previous.draft : input.draft,
        view: input.view === undefined ? previous.view : { ...previous.view, ...input.view },
      }, now());
      const serialized = JSON.stringify({ schema: 1, documentId: descriptor.id, state: next });
      if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw fail('TOO_LARGE', 'As anotações deste documento excedem 2 MB. Reduza o texto antes de salvar.');
      temporary = target + '.' + crypto.randomUUID() + '.tmp';
      const fd = io.openSync(temporary, 'wx', 0o600);
      try { io.writeFileSync(fd, serialized, 'utf8'); io.fsyncSync(fd); }
      finally { io.closeSync(fd); }
      // Mesmo diretório/volume: rename substitui atomicamente. Se o Windows
      // recusar (arquivo travado, antivírus), preservamos o original; não há
      // fallback de apagar primeiro nem gravação direta sobre o arquivo atual.
      io.renameSync(temporary, target);
      temporary = null;
      return { ok: true, state: clone(next) };
    } catch (error) { return errorResult(error); }
    finally {
      if (temporary) { try { io.unlinkSync(temporary); } catch {} }
      if (release) release();
    }
  }
  return { registerDocument, get, save };
}

module.exports = { createStore, documentDescriptor, MAX_BYTES, MAX_COMMENTS, DEFAULT_VIEW };
