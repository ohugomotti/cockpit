'use strict';
const { check, untilCancelled } = require('./cockpit-search');
async function collectPages(readPage, getRows, motor, { onPage, signal } = {}) {
  const found = new Map(), cursors = new Set();
  let cursor;
  do {
    check(signal);
    const page = await untilCancelled(readPage(cursor), signal);
    check(signal);
    if (page?.error) throw new Error(page.error.message || page.error);
    const rows = getRows(page);
    if (!Array.isArray(rows)) throw new Error('O ' + motor + ' devolveu uma lista de conversas inválida.');
    onPage?.({ count: rows.length });
    for (const row of rows) if (row?.id && (!found.has(row.id) || (Number(row.when) || 0) >= (Number(found.get(row.id).when) || 0))) found.set(row.id, row);
    cursor = page.nextCursor || null;
    if (cursor && typeof cursor !== 'string') throw new Error('O ' + motor + ' devolveu um cursor inválido.');
    if (cursor && cursors.has(cursor)) throw new Error('O ' + motor + ' repetiu a página do histórico. A lista completa não foi confirmada.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...found.values()];
}
function listAll(request, { limit = 100, onPage, signal } = {}) {
  return collectPages(cursor => request('thread/list', { limit, sortKey: 'updated_at', ...(cursor ? { cursor } : {}) }), page => page?.data || page?.threads, 'Codex', { onPage, signal });
}
function listClaudeAll(request, { pageSize = 100, onPage, signal } = {}) {
  return collectPages(cursor => request({ pageSize, ...(cursor ? { cursor } : {}) }), page => page?.itens, 'Claude', { onPage, signal });
}
module.exports = { listAll, listClaudeAll };
