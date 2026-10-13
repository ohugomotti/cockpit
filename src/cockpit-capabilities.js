'use strict';

// Catálogo vivo do servidor de cada destino. Não há cache de credenciais nem
// escolha automática de modelo: a interface conserva a escolha do painel.
const clean = (v, n = 1000) => typeof v === 'string' ? v.slice(0, n) : '';
function normalizeModel(m) {
  if (!m || typeof m !== 'object' || !clean(m.model || m.id)) return null;
  return {
    id: clean(m.model || m.id, 200), catalogId: clean(m.id, 200),
    nome: clean(m.displayName || m.model || m.id, 200), desc: clean(m.description),
    hidden: m.hidden === true, padrao: m.isDefault === true,
    padraoEffort: clean(m.defaultReasoningEffort, 40) || 'medium',
    efforts: (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
      .filter(e => e && typeof e.reasoningEffort === 'string')
      .map(e => ({ id: clean(e.reasoningEffort, 40), desc: clean(e.description) })),
    inputModalities: Array.isArray(m.inputModalities) ? [...new Set(m.inputModalities.filter(v => typeof v === 'string').map(v => clean(v, 40)))] : ['text', 'image'],
    modalitiesConfirmed: Array.isArray(m.inputModalities), supportsPersonality: m.supportsPersonality === true,
    upgrade: clean(m.upgrade, 200),
    upgradeInfo: m.upgradeInfo && typeof m.upgradeInfo === 'object' ? {
      model: clean(m.upgradeInfo.model || m.upgradeInfo.modelId, 200),
      migrationMarkdown: clean(m.upgradeInfo.migrationMarkdown, 3000),
    } : null,
    contextWindow: Number.isFinite(m.contextWindow) && m.contextWindow > 0 ? m.contextWindow : null,
  };
}
async function listModels(request, { maxPages = 100 } = {}) {
  const models = new Map(), seen = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const r = await request('model/list', { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) });
    const data = Array.isArray(r) ? r : r?.data || r?.models;
    if (!Array.isArray(data)) throw new Error('O catálogo de modelos veio em formato inválido.');
    for (const raw of data) { const m = normalizeModel(raw); if (m) models.set(m.id, m); }
    if (!r.nextCursor) return [...models.values()];
    if (typeof r.nextCursor !== 'string' || seen.has(r.nextCursor)) throw new Error('O servidor repetiu uma página do catálogo.');
    seen.add(r.nextCursor); cursor = r.nextCursor;
  }
  throw new Error('O catálogo ultrapassou o limite de páginas; tente atualizar.');
}
function serverInfo(value) {
  return { userAgent: clean(value?.userAgent, 160), platform: clean(value?.platformOs, 40) };
}

// A resposta de initialize é o mesmo catálogo do /model. Não envia mensagem
// ao modelo, não grava conversa e não executa ferramentas ou customizações.
const CLAUDE_CATALOG_ARGS = Object.freeze([
  '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
  '--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--tools', '',
]);
function normalizeClaudeModels(values) {
  const models = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw?.value, 200), resolved = clean(raw?.resolvedModel, 200);
    if (!value) continue;
    // Resolver aliases fixa a versão exibida; o sufixo de contexto continua
    // fazendo parte da escolha, inclusive quando o resolvedModel o omite.
    const id = (resolved || value).replace(/\[1m\]$/i, '') + (/\[1m\]$/i.test(value) ? '[1m]' : '');
    if (id === 'default') continue; // sem resolução, não inventar um modelo
    const levels = raw.supportsEffort === true && Array.isArray(raw.supportedEffortLevels)
      ? [...new Set(raw.supportedEffortLevels.filter(e => ['low','medium','high','xhigh','max'].includes(e)))] : [];
    const old = models.get(id);
    models.set(id, {
      id, nome: clean(raw.displayName, 200) || id, desc: clean(raw.description),
      aliases: [...new Set([...(old?.aliases || []), value])],
      padrao: value === 'default' || old?.padrao === true,
      efforts: levels, padraoEffort: clean(raw.defaultEffort, 40) || (/claude-(opus|sonnet)-5-5(?:\[|$)/.test(id) ? 'medium' : levels.includes('high') ? 'high' : levels[0] || ''),
      catalogConfirmed: true,
    });
  }
  return [...models.values()];
}
function listClaudeModels(createProcess, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc, buffer = '', done = false;
    const timer = setTimeout(() => finish(new Error('A consulta dos modelos do Claude demorou demais.')), timeoutMs);
    function finish(error, result) {
      if (done) return;
      done = true; clearTimeout(timer);
      try { proc?.stdin.end(); proc?.kill(); } catch {}
      error ? reject(error) : resolve(result);
    }
    try { proc = createProcess([...CLAUDE_CATALOG_ARGS]); }
    catch (error) { finish(error); return; }
    proc.once('error', () => finish(new Error('Não foi possível abrir o catálogo do Claude.')));
    proc.once('close', () => finish(new Error('O Claude encerrou a consulta do catálogo.')));
    proc.stdin.on('error', () => finish(new Error('O canal de consulta do Claude foi encerrado.')));
    proc.stderr?.resume();
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) { finish(new Error('Resposta do catálogo muito grande.')); return; }
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message?.type !== 'control_response' || message.response?.request_id !== 'cockpit-model-catalog') continue;
        const models = normalizeClaudeModels(message.response.response?.models);
        if (message.response.subtype !== 'success' || !models.length) finish(new Error('O Claude não informou os modelos disponíveis.'));
        else finish(null, models);
      }
    });
    try { proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'cockpit-model-catalog', request: { subtype: 'initialize', hooks: {} } }) + '\n'); }
    catch (error) { finish(error); }
  });
}
module.exports = { normalizeModel, listModels, serverInfo, normalizeClaudeModels, listClaudeModels };
