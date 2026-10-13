'use strict';
// Só lê a tabela pública. Nenhum prompt, conta, cota ou arquivo do usuário sai do PC.
const fs = require('node:fs');
const path = require('node:path');
const SOURCE = 'https://artificialanalysis.ai/leaderboards/models';
const INTERVAL = 60 * 60 * 1000;
const LIMIT = 6 * 1024 * 1024;
const SNAPSHOT = {
  checkedAt: '2026-09-29T22:54:12.224Z', source: SOURCE,
  models: [
    ['claude-opus-5-5','claude',58,'max with fallback'],
    ['claude-sonnet-5-5','claude',56,'max with fallback'],
    ['claude-fable-5-1','claude',53,'max with fallback'],
    ['gpt-6-astra','codex',53,'max'], ['gpt-6.1-sol','codex',52,'max'],
    ['gpt-6-sol','codex',48,'max'], ['gpt-5.6-terra','codex',42,'max'],
    ['gpt-6-luna','codex',37,'max'], ['gpt-5.3-codex','codex',33,'xhigh',true],
    ['claude-haiku-4-5','claude',17,''],
  ].map(([id,engine,score,variant,preliminary=false]) => ({id,engine,score,variant,preliminary})),
};
function text(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|nbsp|#160);/g, ' ')
    .replace(/&(?:quot|#34);/g, '"').replace(/\s+/g, ' ').trim();
}
function identity(name) {
  let m = name.match(/^GPT[- ](\d+(?:\.\d+)?)[- ](Astra|Sol|Luna|Terra|Codex)(?: \(([^)]+)\))?$/i);
  if (m) return {id:'gpt-'+m[1]+'-'+m[2].toLowerCase(),engine:'codex',variant:m[3] || ''};
  m = name.match(/^Claude (Opus|Sonnet|Fable|Haiku) (\d+)\.(\d+)(?: \(([^)]+)\))?$/i);
  if (m) return {id:'claude-'+m[1].toLowerCase()+'-'+m[2]+'-'+m[3],engine:'claude',variant:m[4] || ''};
  m = name.match(/^Claude (\d+)\.(\d+) (Opus|Sonnet|Fable|Haiku)(?: \(([^)]+)\))?$/i);
  if (m) return {id:'claude-'+m[3].toLowerCase()+'-'+m[1]+'-'+m[2],engine:'claude',variant:m[4] || ''};
  return null;
}
function parseLeaderboard(html) {
  if (typeof html !== 'string' || html.length > LIMIT) throw Error('Tabela inválida.');
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    const header = rows.map(row => [...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1])))
      .find(c => c.includes('Model') && c.includes('Artificial Analysis Intelligence Index'));
    if (!header) continue;
    const nameAt = header.indexOf('Model'), scoreAt = header.indexOf('Artificial Analysis Intelligence Index');
    const models = new Map();
    for (const row of rows) {
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
      if (cells.length !== header.length) continue;
      const model = identity(cells[nameAt]), match = cells[scoreAt].match(/^(\d+(?:\.\d+)?)\s*(\*)?$/);
      if (!model || !match || Number(match[1]) > 100) continue;
      const score = Number(match[1]), previous = models.get(model.id);
      if (!previous || score > previous.score)
        models.set(model.id, {...model,score,preliminary:!!match[2]});
    }
    // Uma tabela parcial/alterada nunca substitui a última leitura válida.
    if (models.size >= 3 && [...models.values()].some(m => m.engine === 'claude') && [...models.values()].some(m => m.engine === 'codex'))
      return [...models.values()];
  }
  throw Error('Formato do ranking não reconhecido.');
}
function validCache(value, now) {
  return value?.source === SOURCE && Number.isFinite(Date.parse(value.checkedAt))
    && Date.parse(value.checkedAt) <= now + 60000 && Array.isArray(value.models) && value.models.length >= 3
    && value.models.every(m => typeof m.id === 'string' && /^(gpt-|claude-)/.test(m.id)
      && ['claude','codex'].includes(m.engine) && Number.isFinite(m.score) && m.score >= 0 && m.score <= 100
      && typeof m.variant === 'string');
}
async function boundedBody(response) {
  if (!response.ok) throw Error('Ranking indisponível.');
  if (!/text\/html/i.test(response.headers.get('content-type') || '')) throw Error('Formato inválido.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMIT) throw Error('Ranking grande demais.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}
function createModelBenchmarks({directory, fetchPage = (...args) => fetch(...args), now = Date.now} = {}) {
  let cached, loaded = false, inFlight = null, lastAttempt = -Infinity;
  const file = () => directory ? path.join(directory(), 'model-benchmarks.json') : null;
  function current(status) {
    const value = cached || SNAPSHOT;
    return {...value,status:status || (cached ? 'cached' : 'snapshot'),stale:now()-Date.parse(value.checkedAt)>INTERVAL};
  }
  async function get({refresh=false} = {}) {
    if (!loaded) {
      loaded = true;
      try { const value=JSON.parse(fs.readFileSync(file(),'utf8')); if (validCache(value,now())) cached=value; } catch {}
    }
    if (inFlight) return inFlight;
    if ((!refresh && cached && now()-Date.parse(cached.checkedAt)<INTERVAL) || now()-lastAttempt<60000) return current();
    lastAttempt = now();
    inFlight = Promise.resolve().then(async () => {
      try {
        const response = await fetchPage(SOURCE,{signal:AbortSignal.timeout(8000),redirect:'error',credentials:'omit'});
        const models = parseLeaderboard(await boundedBody(response));
        cached = {source:SOURCE,checkedAt:new Date(now()).toISOString(),models};
        try {
          if (file()) { fs.mkdirSync(path.dirname(file()),{recursive:true}); fs.writeFileSync(file()+'.tmp',JSON.stringify(cached)); fs.renameSync(file()+'.tmp',file()); }
        } catch {} // Uma falha de disco não impede a leitura nem a escolha do modelo.
        return current('live');
      } catch { return current(); }
    }).finally(() => { inFlight=null; });
    return inFlight;
  }
  return {get};
}
module.exports = {createModelBenchmarks,parseLeaderboard,SOURCE,SNAPSHOT,validCache};
