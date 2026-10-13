'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const breathe = () => new Promise(resolve => setImmediate(resolve));
function check(signal) { if (signal?.aborted) { const e = new Error('Consulta cancelada'); e.name = 'AbortError'; throw e; } }
function untilCancelled(promise, signal) {
  check(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { try { check(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readWindow(file, bytes, { tail = false, signal } = {}) {
  check(signal);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { text: '', size: 0, bytesRead: 0 };
    const length = Math.min(Math.max(0, bytes), stat.size), start = tail ? stat.size - length : 0;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      check(signal);
      const { bytesRead } = await handle.read(buffer, read, Math.min(65536, length - read), start + read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    check(signal);
    return { text: buffer.subarray(0, read).toString('utf8'), size: stat.size, bytesRead: read, truncated: stat.size > read };
  } finally { await handle.close(); }
}

// Não segue links: evita ciclos e varredura acidental fora da pasta escolhida.
async function* walkFiles(root, { signal, ignore = () => false, accept = () => true, maxDepth = 8,
  maxDirs = 4000, maxFiles = 20000, maxEntries = 100000, state = {} } = {}) {
  const queue = [{ dir: root, depth: 0 }]; let cursor = 0;
  Object.assign(state, { dirs: 0, files: 0, entries: 0, truncated: false });
  while (cursor < queue.length && state.dirs < maxDirs) {
    check(signal);
    const { dir, depth } = queue[cursor++]; state.dirs++;
    let handle;
    try { handle = await fs.opendir(dir); }
    catch (error) { if (cursor === 1 && error.code !== 'ENOENT') throw error; continue; }
    for await (const entry of handle) {
      check(signal);
      if (++state.entries > maxEntries) { state.truncated = true; return; }
      if (entry.isSymbolicLink() || ignore(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && queue.length < maxDirs) queue.push({ dir: file, depth: depth + 1 });
        else state.truncated = true;
      } else if (entry.isFile() && accept(entry.name, file)) {
        if (state.files >= maxFiles) { state.truncated = true; return; }
        state.files++;
        yield { file, depth };
      }
      if (state.entries % 64 === 0) await breathe();
    }
  }
  if (cursor < queue.length) state.truncated = true;
}

async function scanFiles(root, options = {}) {
  const files = [], state = {};
  for await (const entry of walkFiles(root, { ...options, state })) files.push(entry.file);
  return { ...state, files };
}

async function permittedFile(file, roots) {
  const target = path.resolve(String(file || ''));
  if (!/\.jsonl?$/i.test(target)) return false;
  const inside = (root, value) => { const relative = path.relative(root, value); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
  for (const root of roots || []) {
    const base = path.resolve(root);
    if (!inside(base, target)) continue;
    try {
      const [realBase, realTarget, stat] = await Promise.all([fs.realpath(base), fs.realpath(target), fs.stat(target)]);
      if (stat.isFile() && inside(realBase, realTarget) && /\.jsonl?$/i.test(realTarget)) return true;
    } catch {}
  }
  return false;
}

function snippet(text, term) {
  const target = normalize(term);
  for (const line of text.split('\n')) {
    if (!normalize(line).includes(target)) continue;
    let readable = '';
    try {
      const item = JSON.parse(line);
      const content = item.message?.content ?? item.payload?.content ?? item.text;
      readable = typeof content === 'string' ? content : Array.isArray(content) ? content.map(v => v?.text || v?.thinking || '').join(' ') : '';
    } catch {}
    if (!readable) readable = line.replace(/\\[nrt]/g, ' ').replace(/[{}"\[\]]/g, ' ');
    const position = normalize(readable).indexOf(target), start = Math.max(0, position - 45);
    return (start ? '…' : '') + readable.slice(start, start + 150).replace(/\s+/g, ' ').trim() + '…';
  }
  return null;
}

async function searchContents(items, term, { signal, maxFiles = 400, maxMatches = 40, maxBytes = 64 * 1024 * 1024,
  perFileBytes = 3 * 1024 * 1024, allowedRoots } = {}) {
  if (!normalize(term).trim()) return { achados: [], truncado: false };
  const achados = []; let bytes = 0, read = 0, truncated = items.length > maxFiles;
  for (const item of items.slice(0, maxFiles)) {
    check(signal);
    if (!item?.file) continue;
    if (allowedRoots && !await permittedFile(item.file, allowedRoots)) continue;
    if (bytes >= maxBytes) { truncated = true; break; }
    try {
      const window = await readWindow(item.file, Math.min(perFileBytes, maxBytes - bytes), { tail: true, signal });
      bytes += window.bytesRead; read++; truncated ||= window.truncated;
      const found = snippet(window.text, term);
      if (found) achados.push({ id: item.id, trecho: found });
      if (achados.length >= maxMatches) { truncated ||= read < items.length; break; }
    } catch (error) { if (error.name === 'AbortError') throw error; }
    await breathe();
  }
  return { achados, truncado: truncated, lidos: read };
}

module.exports = { normalize, breathe, check, untilCancelled, readWindow, walkFiles, scanFiles, permittedFile, snippet, searchContents };
