'use strict';

// Dados de terceiros permanecem dados. Nada aqui abre URL, executa ferramenta
// ou transforma catálogo/autenticação em prova de uma chamada bem-sucedida.
const LIMITES = Object.freeze({ texto: 65536, imagens: 4, imagemBase64: 3 * 1024 * 1024,
  totalBase64: 8 * 1024 * 1024, pixels: 40000000, recursos: 20, blocos: 160, profundidade: 6, agentes: 400, chamadas: 1000 });
const texto = (v, n = 500) => typeof v === 'string' ? v.slice(0, n) : '';
const idTexto = (v) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 200) : '';
const chave = (...v) => JSON.stringify(v);
const FINAL = new Set(['completed', 'failed', 'errored', 'shutdown', 'interrupted', 'notFound']);

function dimensoesRaster(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length >= 24) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (mime === 'image/gif' && buf.length >= 10) return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    if (mime === 'image/webp') {
      const tipo = buf.subarray(12, 16).toString();
      if (tipo === 'VP8X' && buf.length >= 30) return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
      if (tipo === 'VP8 ' && buf.length >= 30) return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
      if (tipo === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
        const bits = buf.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      }
    }
    if (mime === 'image/jpeg') {
      let pos = 2;
      while (pos + 3 < buf.length) {
        if (buf[pos++] !== 0xff) return null;
        while (buf[pos] === 0xff) pos++;
        const mark = buf[pos++];
        if (mark === 0xda || mark === 0xd9) break;
        if (mark === 1 || (mark >= 0xd0 && mark <= 0xd7)) continue;
        const n = buf.readUInt16BE(pos);
        if (n < 2 || pos + n > buf.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(mark) && n >= 7)
          return [buf.readUInt16BE(pos + 5), buf.readUInt16BE(pos + 3)];
        pos += n;
      }
    }
  } catch {}
  return null;
}

function resultadoFerramenta(valor) {
  const imagens = [], recursos = [], avisos = new Set(), saida = [];
  const vistos = new WeakSet();
  let restante = LIMITES.texto, bytes64 = 0, blocos = 0;
  function aviso(s) { avisos.add(s); }
  function escrever(v) {
    if (typeof v !== 'string' || !v) return '';
    if (restante <= 0) { aviso('Texto cortado no limite de 65 mil caracteres.'); return ''; }
    const trecho = v.slice(0, restante); restante -= trecho.length;
    if (trecho.length !== v.length) aviso('Texto cortado no limite de 65 mil caracteres.');
    saida.push(trecho); return trecho;
  }
  function imagem(mime, dados) {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) || typeof dados !== 'string') {
      aviso('Imagem omitida: formato não suportado.'); return;
    }
    if (imagens.length >= LIMITES.imagens || dados.length > LIMITES.imagemBase64 || bytes64 + dados.length > LIMITES.totalBase64) {
      aviso('Imagem omitida pelo limite de tamanho ou quantidade.'); return;
    }
    if (!dados || dados.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dados)) {
      aviso('Imagem omitida: base64 inválido.'); return;
    }
    const buf = Buffer.from(dados, 'base64');
    const valido = mime === 'image/png' ? buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg' ? buf[0] === 255 && buf[1] === 216 && buf[2] === 255
      : mime === 'image/gif' ? /^GIF8[79]a$/.test(buf.subarray(0, 6).toString())
      : buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    if (!valido) { aviso('Imagem omitida: conteúdo não corresponde ao formato.'); return; }
    const dimensoes = dimensoesRaster(buf, mime);
    if (!dimensoes || dimensoes.some(n => !n || n > 20000) || dimensoes[0] * dimensoes[1] > LIMITES.pixels) {
      aviso('Imagem omitida: dimensões inválidas ou acima do limite.'); return;
    }
    imagens.push({ mime, dados }); bytes64 += dados.length;
  }
  function recurso(r, tipo) {
    if (!r || typeof r !== 'object') return;
    if (recursos.length >= LIMITES.recursos) { aviso('Recursos adicionais omitidos.'); return; }
    const uri = texto(r.uri || r.url, 2048);
    let abrivel = false;
    try { const u = new URL(uri); abrivel = /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch {}
    const item = { tipo, nome: texto(r.title || r.name, 200) || 'Recurso', uri,
      mime: texto(r.mimeType || r.mime_type, 100), abrivel };
    if (typeof r.text === 'string') item.texto = escrever(r.text);
    recursos.push(item);
    if (r.blob) {
      if (item.mime.startsWith('image/')) imagem(item.mime, r.blob);
      else aviso('Recurso binário recebido; prévia não suportada.');
    }
  }
  function visitar(v, nivel = 0) {
    if (++blocos > LIMITES.blocos || nivel > LIMITES.profundidade) { aviso('Conteúdo adicional omitido pelo limite de blocos.'); return; }
    if (typeof v === 'string') { escrever(v); return; }
    if (v == null) return;
    if (typeof v !== 'object') { escrever(String(v)); return; }
    if (vistos.has(v)) return;
    vistos.add(v);
    if (Array.isArray(v)) {
      for (const x of v.slice(0, LIMITES.blocos)) { if (blocos >= LIMITES.blocos) break; visitar(x, nivel + 1); }
      if (v.length > LIMITES.blocos || blocos >= LIMITES.blocos) aviso('Conteúdo adicional omitido pelo limite de blocos.');
      return;
    }
    if (v.type === 'text' || v.type === 'inputText') { escrever(v.text); return; }
    if (v.type === 'image') {
      if (v.source && v.source.type !== 'base64') { aviso('Imagem remota não carregada automaticamente.'); return; }
      imagem(v.mimeType || v.mime_type || v.source?.media_type, v.data || v.source?.data); return;
    }
    if (v.type === 'resource') { recurso(v.resource, 'resource'); return; }
    if (v.type === 'resource_link' || v.type === 'link') { recurso(v, 'link'); return; }
    if (v.type === 'audio') { aviso('Resultado de áudio recebido; prévia não suportada.'); return; }
    if (Object.hasOwn(v, 'content')) visitar(v.content, nivel + 1);
    if (v.structuredContent != null) visitar(v.structuredContent, nivel + 1);
    if (Object.hasOwn(v, 'content') || v.structuredContent != null) return;
    // Prévia limitada antes da serialização: nunca stringify do resultado
    // inteiro (ele pode conter megabytes de base64 ou referências cíclicas).
    let entradas = 0;
    for (const k in v) {
      if (!Object.hasOwn(v, k)) continue;
      if (++entradas > 30) { aviso('Prévia estruturada cortada.'); break; }
      if (blocos >= LIMITES.blocos || restante <= 0) { aviso('Prévia estruturada cortada.'); break; }
      if (/^(data|blob|base64)$/i.test(k)) { aviso('Campo binário omitido da prévia textual.'); continue; }
      escrever(texto(k, 100) + ': '); visitar(v[k], nivel + 1);
    }
  }
  visitar(valor);
  // Separadores também entram no teto efetivo do payload textual.
  return { output: saida.join('\n').slice(0, LIMITES.texto), imagens, recursos, avisos: [...avisos] };
}

function estadoAgente(v) {
  return ({ pendingInit: 'pending', running: 'running', interrupted: 'interrupted', completed: 'completed',
    errored: 'failed', failed: 'failed', shutdown: 'shutdown', notFound: 'notFound', stopped: 'interrupted',
    pending: 'pending', inProgress: 'running', idle: 'idle' })[v] || 'unknown';
}

function criarObservabilidade(enviar = () => {}, agora = Date.now) {
  const agentes = new Map(), chamadas = new Map(), conectores = new Map(), sessoes = new Map(), aliases = new Map();
  function limitado(map, limite) { while (map.size > limite) map.delete(map.keys().next().value); }
  function publicar(reg) { enviar(reg.paneId, 'agent-state', { agent: { ...reg } }); }
  function agente(engine, paneId, id, dados) {
    if (!id || paneId == null) return;
    const k = chave(engine, paneId, id), antes = agentes.get(k);
    const reg = { id, engine, paneId, threadId: '', parentId: '', task: 'Subagente', state: 'unknown',
      model: '', source: '', controlSupported: false, ...antes, ...dados, updatedAt: agora() };
    agentes.set(k, reg); limitado(agentes, LIMITES.agentes); publicar(reg); return reg;
  }
  function resetar(engine, paneId, sessionId) {
    const k = chave(engine, paneId);
    if (sessoes.get(k) === sessionId) return;
    for (const [key, v] of agentes) if (v.engine === engine && v.paneId === paneId) agentes.delete(key);
    for (const map of [conectores, chamadas]) for (const [key, v] of map) if (v.engine === engine && v.paneId === paneId) map.delete(key);
    for (const key of aliases.keys()) if (key.startsWith(chave(engine, paneId).slice(0, -1) + ',')) aliases.delete(key);
    sessoes.set(k, sessionId);
    limitado(sessoes, LIMITES.agentes);
  }
  function conector(engine, paneId, nome, dados) {
    if (!nome) return;
    const k = chave(engine, paneId, nome);
    const item = { engine, paneId, nome, carregado: null, estado: 'desconhecido', ultimaChamada: null,
      ...conectores.get(k), ...dados };
    conectores.set(k, item); limitado(conectores, LIMITES.chamadas); return item;
  }
  function chamada(engine, paneId, id, servidor, ferramenta) {
    if (!servidor || !id) return;
    chamadas.set(chave(engine, paneId, id), { engine, paneId, servidor, ferramenta });
    limitado(chamadas, LIMITES.chamadas);
    conector(engine, paneId, servidor, { ultimaChamada: { estado: 'em_andamento', ferramenta, quando: agora() } });
  }
  function fimChamada(engine, paneId, id, erro) {
    const k = chave(engine, paneId, id), item = chamadas.get(k);
    if (!item) return;
    chamadas.delete(k);
    conector(engine, paneId, item.servidor, { ultimaChamada: { estado: erro ? 'falhou' : 'sucesso',
      ferramenta: item.ferramenta, quando: agora(), ...(erro ? { erro: 'A ferramenta devolveu falha.' } : {}) } });
  }
  function observarCodex(method, params, paneId) {
    const tid = idTexto(params.threadId || params.thread?.id), it = params.item || {};
    const conhecido = [...agentes.values()].find(a => a.engine === 'codex' && a.threadId === tid);
    const dono = paneId ?? conhecido?.paneId;
    if (dono == null) return;
    if (paneId != null && tid) resetar('codex', paneId, tid);
    if (it.type === 'collabAgentToolCall' && (method === 'item/started' || method === 'item/completed')) {
      const estados = it.agentsStates || {};
      const ids = new Set([...(Array.isArray(it.receiverThreadIds) ? it.receiverThreadIds : []), ...Object.keys(estados)]);
      for (const raw of [...ids].slice(0, 100)) {
        const id = idTexto(raw); if (!id) continue;
        const atual = agentes.get(chave('codex', dono, id));
        const st = estados[id];
        const dados = { threadId: id, parentId: idTexto(it.senderThreadId || tid), source: 'codex.collabAgentToolCall' };
        if (!atual || it.tool === 'spawnAgent') dados.task = texto(it.prompt, 1000) || 'Subagente Codex';
        if (it.model) dados.model = texto(it.model, 100);
        if (st?.status) dados.state = estadoAgente(st.status);
        else if (!atual) dados.state = 'unknown'; // término da chamada NÃO é término do agente
        if (st?.message) dados.message = texto(st.message, 2000);
        agente('codex', dono, id, dados);
      }
    }
    if (conhecido) {
      if (method === 'turn/started') agente('codex', dono, conhecido.id, { state: 'running' });
      if (method === 'turn/completed') agente('codex', dono, conhecido.id, {
        state: params.turn?.status === 'failed' || params.turn?.error ? 'failed'
          : params.turn?.status === 'interrupted' ? 'interrupted' : params.turn?.status === 'completed' ? 'idle' : 'unknown' });
      if ((method === 'turn/failed' || method === 'error') && !params.willRetry) agente('codex', dono, conhecido.id, { state: 'failed' });
      if (method === 'item/completed' && it.type === 'agentMessage') agente('codex', dono, conhecido.id, { message: texto(it.text, 2000) });
    }
    if (it.type === 'mcpToolCall') {
      if (method === 'item/started') chamada('codex', dono, it.id, texto(it.server, 200), texto(it.tool, 200));
      if (method === 'item/completed') fimChamada('codex', dono, it.id, !!it.error || it.status === 'failed' || !!it.result?.isError);
    }
  }
  function observarClaude(paneId, m) {
    if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
      resetar('claude', paneId, idTexto(m.session_id));
      for (const s of (Array.isArray(m.mcp_servers) ? m.mcp_servers : []).slice(0, 500)) {
        if (!s || typeof s !== 'object') continue;
        conector('claude', paneId, texto(s?.name, 200), { carregado: s.status === 'connected' ? true
          : ['failed', 'disabled', 'pending', 'needs-auth'].includes(s.status) ? false : null,
        estado: texto(s.status, 100) || 'desconhecido', fonte: 'session-init' });
      }
    }
    const pai = idTexto(m.parent_tool_use_id || m.parentToolUseId);
    const partes = Array.isArray(m.message?.content) ? m.message.content : [];
    if (m.type === 'assistant') for (const c of partes.slice(0, 160)) {
      if (!c || typeof c !== 'object') continue;
      if (c.type !== 'tool_use') continue;
      if (c.name === 'Task' || c.name === 'Agent') {
        const id = idTexto(c.id);
        agente('claude', paneId, id, { parentId: pai || idTexto(m.session_id),
          task: texto(c.input?.description || c.input?.prompt, 1000) || 'Subagente Claude',
          model: texto(c.input?.model, 100), state: 'running', background: c.input?.run_in_background === true,
          source: 'claude.tool_use' });
      }
      if (typeof c.name === 'string' && c.name.startsWith('mcp__')) {
        const conhecidos = [...conectores.values()].filter(v => v.engine === 'claude' && v.paneId === paneId)
          .map(v => v.nome).sort((a, b) => b.length - a.length);
        const nome = conhecidos.find(v => c.name.startsWith('mcp__' + v + '__')) || c.name.split('__')[1];
        chamada('claude', paneId, c.id, texto(nome, 200), texto(c.name.slice(('mcp__' + nome + '__').length), 200));
      }
    }
    if (m.type === 'user') for (const c of partes.slice(0, 160)) {
      if (!c || typeof c !== 'object') continue;
      if (c.type !== 'tool_result') continue;
      fimChamada('claude', paneId, c.tool_use_id, !!c.is_error);
      const reg = agentes.get(chave('claude', paneId, idTexto(c.tool_use_id)));
      if (reg) agente('claude', paneId, reg.id, { state: c.is_error ? 'failed' : reg.background ? reg.state : 'completed',
        message: resultadoFerramenta(c.content).output.slice(0, 2000) });
    }
    if (m.type === 'system' && ['task_started', 'task_progress', 'task_notification'].includes(m.subtype)) {
      const task = idTexto(m.task_id), tool = idTexto(m.tool_use_id);
      const k = chave('claude', paneId, task);
      const id = tool || aliases.get(k) || task;
      if (task && tool) {
        aliases.set(k, tool); limitado(aliases, LIMITES.chamadas);
        const antigo = agentes.get(chave('claude', paneId, task));
        if (task !== tool && antigo) {
          agentes.delete(chave('claude', paneId, task));
          if (!agentes.has(chave('claude', paneId, tool))) agente('claude', paneId, tool, { ...antigo, id: tool });
        }
      }
      if (id) agente('claude', paneId, id, {
        ...(task ? { threadId: task } : {}),
        ...(m.description ? { task: texto(m.description, 1000) } : {}),
        ...(m.summary ? { message: texto(m.summary, 2000) } : {}),
        state: m.subtype === 'task_notification' ? estadoAgente(m.status) : 'running', source: 'claude.' + m.subtype });
    }
  }
  function encerrarPainel(paneId, engine, motivo = 'Sessão encerrada; acompanhamento interrompido.') {
    for (const reg of [...agentes.values()]) if (reg.paneId === paneId && reg.engine === engine && !FINAL.has(reg.state))
      agente(engine, paneId, reg.id, { state: 'interrupted', message: texto(motivo, 300) });
    for (const item of [...conectores.values()]) if (item.paneId === paneId && item.engine === engine)
      conector(engine, paneId, item.nome, { carregado: null, estado: 'sessao_encerrada' });
    for (const [k, item] of chamadas) if (item.paneId === paneId && item.engine === engine) {
      conector(engine, paneId, item.servidor, { ultimaChamada: { estado: 'interrompida', ferramenta: item.ferramenta, quando: agora() } });
      chamadas.delete(k);
    }
  }
  return { observarCodex, observarClaude, encerrarPainel,
    encerrarMotor(engine, motivo) {
      const paineis = new Set([...agentes.values(), ...conectores.values()].filter(v => v.engine === engine).map(v => v.paneId));
      for (const p of paineis) encerrarPainel(p, engine, motivo);
    },
    /* paineisVivos (opcional): os paineis que a tela ainda tem. Agente que ja'
       terminou e cujo painel dono sumiu nao tem mais onde ser visto -- sai da
       resposta em vez de ficar na Torre pra sempre (o registro tem teto
       proprio). Quem ainda roda fica, mesmo orfao: e' trabalho acontecendo. */
    agentesSessao({ paneId, engine, paineisVivos } = {}) {
      const vivos = Array.isArray(paineisVivos) ? new Set(paineisVivos.map(String)) : null;
      return { itens: [...agentes.values()].filter(a => (paneId == null || a.paneId === paneId) && (!engine || a.engine === engine)
        && !(vivos && FINAL.has(a.state) && !vivos.has(String(a.paneId)))).map(a => ({ ...a })) };
    },
    diagnostico(engine, paneId, configurados = [], runtime = []) {
      const dados = new Map(configurados.map(c => [c.nome, { nome: c.nome, configurado: true, ligado: c.ligado !== false,
        carregado: null, estado: 'desconhecido', auth: c.auth || '', ferramentas: null, ultimaChamada: null }]));
      for (const item of conectores.values()) if (item.engine === engine && item.paneId === paneId) {
        dados.set(item.nome, { configurado: null, ligado: null, auth: '', ferramentas: null, ...dados.get(item.nome), ...item });
      }
      for (const r of runtime.slice(0, 500)) {
        if (typeof r?.name !== 'string') continue;
        dados.set(r.name, { configurado: null, ligado: null, ultimaChamada: null, ...dados.get(r.name),
          nome: texto(r.name, 200), carregado: r.runtimeStatus === 'connected' ? true
            : ['notStarted', 'starting', 'authenticationRequired', 'failed', 'cancelled', 'disabled'].includes(r.runtimeStatus) ? false : null,
          estado: r.runtimeStatus || 'desconhecido', auth: r.authStatus || '',
          ferramentas: r.tools && typeof r.tools === 'object' ? Object.keys(r.tools).length : null, fonte: 'codex-runtime' });
      }
      return { engine, itens: [...dados.values()], avisos: [] };
    },
  };
}

async function listarRuntimeCodex(requisitar, threadId) {
  const itens = [], vistos = new Set();
  let cursor;
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await requisitar('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly', limit: 50,
      ...(cursor ? { cursor } : {}) }, 30000);
    if (!r || !Array.isArray(r.data)) throw new Error('O Codex devolveu um inventário MCP inválido.');
    itens.push(...r.data.slice(0, 50));
    if (!r.nextCursor) return { itens, parcial: r.data.length > 50 };
    if (vistos.has(r.nextCursor)) throw new Error('O Codex repetiu a página do inventário MCP.');
    vistos.add(r.nextCursor); cursor = r.nextCursor;
  }
  return { itens, parcial: true };
}

module.exports = { LIMITES, resultadoFerramenta, criarObservabilidade, estadoAgente, listarRuntimeCodex };
