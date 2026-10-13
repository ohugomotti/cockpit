'use strict';
const proto = require('./codex-protocol');

function fromItem(entry) {
  const item = entry?.item || entry;
  if (!item || typeof item !== 'object') return null;
  const common = { id: String(item.id || ''), turnId: String(entry.turnId || '') };
  if (item.type === 'agentMessage') return { ...common, role: 'bot', ...proto.normalizeAgentMessage(item) };
  if (item.type === 'userMessage') return { ...common, role: 'user', text: (item.content || []).map(c => c.text || '').join('\n') };
  if (item.type === 'commandExecution') return { ...common, role: 'tool', name: 'Terminal', arg: item.command || '', text: item.aggregatedOutput || '' };
  return null;
}
function pageParams({ threadId, cursor, turnId, itemId, direction = 'asc', limit = 100 }) {
  if (typeof threadId !== 'string' || !threadId) throw new Error('Conversa ausente.');
  if (itemId && !turnId) throw new Error('Para saltar para um item, informe o turno.');
  if (cursor != null && typeof cursor !== 'string') throw new Error('Cursor inválido.');
  return { threadId, limit: Math.max(1, Math.min(200, Number(limit) || 100)), sortDirection: direction === 'desc' ? 'desc' : 'asc',
    ...(turnId ? { turnId } : {}), ...(itemId ? { cursor: { type: 'item', itemId } } : cursor ? { cursor } : {}) };
}
async function readPage(request, options) {
  const r = await request('thread/items/list', pageParams(options));
  if (!Array.isArray(r?.data)) throw new Error('O servidor não devolveu uma página de histórico válida.');
  return { items: r.data.map(fromItem).filter(Boolean), nextCursor: r.nextCursor || null,
    backwardsCursor: r.backwardsCursor || null, count: r.data.length };
}
async function readAll(request, threadId, fallback) {
  const out = [], seen = new Set(), ids = new Set();
  let cursor;
  try {
    for (let n = 0; n < 10000; n++) {
      const page = await readPage(request, { threadId, cursor });
      for (const item of page.items) {
        const key = item.id && JSON.stringify([item.turnId, item.id]);
        if (key && ids.has(key)) continue;
        if (key) ids.add(key);
        out.push(item);
      }
      if (!page.nextCursor) return out;
      if (seen.has(page.nextCursor)) throw new Error('O servidor repetiu uma página do histórico.');
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new Error('Histórico excede o limite de páginas.');
  } catch (e) {
    // Nunca misturar uma carga parcial com outra origem/versão da conversa.
    // A leitura compatível é completa e substitui a tentativa, desde o início.
    if (!fallback) throw e;
    return fallback();
  }
}
module.exports = { fromItem, pageParams, readPage, readAll };
