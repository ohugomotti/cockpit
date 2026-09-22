/* ===================== MOTOR ACP (o quinto motor) =====================
   ACP = Agent Client Protocol: um JSON-RPC por stdio que varios agentes de
   codigo ja falam (Gemini CLI com "--acp", Claude Code e Codex pelos
   adaptadores do Zed, OpenCode, Qwen Code...). Em vez de uma leva de adaptacao
   por agente, o Cockpit fala o protocolo UMA vez e qualquer agente ACP entra
   pelo mesmo cano: basta o comando que sobe o processo.

   O que o protocolo entrega, e onde cada coisa encaixa na tela:
     session/update agent_message_chunk  -> a fala (text-final, com freio de 100ms)
     session/update agent_thought_chunk  -> o pensamento (think-delta)
     session/update tool_call / _update  -> os passos (tool-start / tool-end)
     session/update plan                 -> o plano vivo (plano)
     session/request_permission          -> a barra Permitir/Negar que ja existe
     fs/read_text_file, fs/write_text_file -> o Cockpit le/escreve pelo agente

   Este arquivo NAO depende do Electron de proposito: quem o usa injeta emit,
   spawnBin, buildEnv etc. Assim ele roda sozinho no node contra o agente de
   verdade (testes/acp-vivo.js) e as traducoes sao testadas puras (teste-acp.js).

   Provado rodando antes de virar motor: testes/acp-log-prova-20260906.jsonl.
   As armadilhas que so' apareceram rodando estao tratadas aqui:
     1. "gemini --acp" NAO le o ~/.gemini/.env (o CLI normal le) -> a chave e'
        injetada no ambiente do processo (lerChaveGemini).
     2. a primeira resposta pode passar de 90s -> prazos generosos.
     3. a pasta nao confiada vira so' um aviso no stderr, o turno roda.
     4. o write_file do Gemini le o arquivo PELO CLIENTE antes de escrever e
        desiste se a leitura de um arquivo inexistente volta como erro ->
        arquivo que nao existe devolve conteudo vazio (o Zed faz igual). */

const fs = require('fs');
const { StringDecoder } = require('node:string_decoder');
const path = require('path');

const COMANDO_PADRAO = 'gemini --acp';
const LIM_DIFF = 100 * 1024;
const LIM_SAIDA = 8000;
const LIM_IMG = 4 * 1024 * 1024;            // imagem que VOCE manda (bytes)
const LIM_IMG_PASSO = 3 * 1024 * 1024;      // imagem que o agente devolve (base64) - mesmo teto do Claude
const MAX_IMG_PASSO = 4;
const LIM_LEITURA = 20 * 1024 * 1024;       // fs/read_text_file: acima disto trava a janela
const MIME_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/* Quebra a linha de comando em programa + argumentos, respeitando aspas.
   "npx -y @zed-industries/claude-code-acp" -> { bin: 'npx', args: [...] } */
function comandoEmPartes(linha) {
  const partes = [];
  let atual = '', aspa = null, teve = false;
  for (const ch of String(linha || '').trim()) {
    if (aspa) { if (ch === aspa) aspa = null; else atual += ch; continue; }
    if (ch === '"' || ch === "'") { aspa = ch; teve = true; continue; }
    if (/\s/.test(ch)) { if (atual || teve) { partes.push(atual); atual = ''; teve = false; } continue; }
    atual += ch;
  }
  if (atual || teve) partes.push(atual);
  return { bin: partes[0] || '', args: partes.slice(1) };
}

/* Modo do Cockpit -> modo do agente. Cada agente batiza os seus (o Gemini tem
   default/autoEdit/yolo/plan; o adaptador do Claude tem default/acceptEdits/
   plan/bypassPermissions). Aqui vai a lista de apelidos conhecidos, e vale o
   primeiro que o agente anunciou ter. Sem correspondencia, nao mexe. */
const MODOS_EQUIVALENTES = {
  manual: ['default', 'ask', 'normal', 'interactive'],
  'auto-edit': ['autoEdit', 'auto_edit', 'acceptEdits', 'accept_edits', 'auto-edit'],
  plan: ['plan', 'planning', 'readOnly', 'read-only', 'read_only'],
  bypass: ['yolo', 'bypassPermissions', 'bypass_permissions', 'bypass', 'full-auto', 'fullAuto', 'dangerously-skip-permissions', 'auto'],
};
function modoDoAgente(approval, modos) {
  const lista = Array.isArray(modos) ? modos : [];
  const quer = MODOS_EQUIVALENTES[approval] || MODOS_EQUIVALENTES.manual;
  for (const apelido of quer) {
    const m = lista.find((x) => x && String(x.id || '').toLowerCase() === apelido.toLowerCase());
    if (m) return m.id;
  }
  return '';
}

/* ---- pedacos de conteudo do protocolo -> texto ---- */
function textoDoBloco(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (c.type === 'text') return String(c.text == null ? '' : c.text);
  if (c.type === 'resource_link') return String(c.uri || c.name || '');
  if (c.type === 'resource' && c.resource) return String(c.resource.text || c.resource.uri || '');
  if (c.type === 'image') return '[imagem]';
  if (c.type === 'audio') return '[áudio]';
  return '';
}
const corta = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) + '\n…(cortado)' : t; };

/* O conteudo de um passo pode ter texto, um diff (arquivo que muda) e imagem.
   O diff vira a mesma "mudanca" que a tela ja desenha pro Claude. Imagem tem
   o mesmo teto do Claude: e' pra ver o print, nao pra carregar um filme no IPC. */
function conteudoDaFerramenta(itens, completo = false) {
  let texto = '';
  let mudanca = null;
  const imagens = [];
  for (const it of (Array.isArray(itens) ? itens : [])) {
    if (!it) continue;
    if (it.type === 'content') {
      const b = it.content;
      if (b && b.type === 'image' && b.data) {
        const dados = String(b.data);
        if (dados.length <= LIM_IMG_PASSO && imagens.length < MAX_IMG_PASSO) imagens.push({ mime: b.mimeType || 'image/png', dados });
      } else { const t = textoDoBloco(b); if (t) texto += (texto ? '\n' : '') + t; }
    } else if (it.type === 'diff') {
      mudanca = {
        path: String(it.path || ''),
        antes: it.oldText == null ? '' : completo ? String(it.oldText) : corta(it.oldText, LIM_DIFF),
        depois: completo ? String(it.newText == null ? '' : it.newText) : corta(it.newText, LIM_DIFF),
        tipo: it.oldText == null ? 'write-novo' : 'edit',
      };
    } else if (it.type === 'terminal') {
      texto += (texto ? '\n' : '') + '[terminal ' + (it.terminalId || '') + ']';
    }
  }
  return { texto, mudanca, imagens };
}

/* O "kind" do passo e' a categoria padronizada do protocolo; o nome que vai pra
   tela e' o mesmo que o Claude usa, pra fraseDoPasso() traduzir igual. */
const NOME_POR_KIND = {
  read: 'Read', edit: 'Edit', delete: 'Excluindo', move: 'Movendo', search: 'Grep',
  execute: 'Bash', think: 'Pensando', fetch: 'WebFetch', switch_mode: 'Trocando o modo',
};
function passoDaFerramenta(tc, completo = false) {
  const t = tc || {};
  const kind = String(t.kind || 'other');
  const loc = Array.isArray(t.locations) && t.locations[0] && t.locations[0].path;
  const raw = (t.rawInput && typeof t.rawInput === 'object') ? t.rawInput : {};
  const doInput = raw.command || raw.cmd || raw.file_path || raw.path || raw.absolute_path || raw.pattern || raw.query || raw.url;
  const titulo = String(t.title || '').replace(/\s+/g, ' ').trim();
  const name = NOME_POR_KIND[kind] || titulo || 'Ferramenta';
  let arg = String((kind === 'execute' ? doInput || loc : loc || doInput) || (completo ? t.title : titulo) || '');
  if (!completo) arg = arg.slice(0, 300);
  if (arg === name) arg = '';   // senao a linha do passo repetia o mesmo texto duas vezes
  return { name, arg, kind, titulo };
}
/* do tool_call, so' o que o cartao de permissao pode precisar depois: guardar
   o update inteiro segurava imagem base64/rawOutput de cada passo ate' o
   fim do turno (agente de navegador = centenas de MB). Diffs ficam inteiros
   porque podem ser a única fonte de um pedido posterior de aprovação. */
const enxuto = (u) => {
  const out = {};
  for (const key of ['title', 'kind', 'locations', 'rawInput']) if (u && u[key] !== undefined) out[key] = u[key];
  // Guarda só os diffs para um pedido posterior por ID, nunca imagens/rawOutput.
  const diffs = u && Array.isArray(u.content) ? u.content.filter(it => it && it.type === 'diff') : [];
  if (diffs.length) out.content = diffs;
  return out;
};
function dadosDaPermissao(tc, anterior = {}) {
  const merged = { ...(anterior.bruto || {}), ...enxuto(tc) };
  const passo = passoDaFerramenta(merged, true);
  const diffs = (merged.content || []).filter(it => it.type === 'diff');
  const mudanca = conteudoDaFerramenta(diffs, true).mudanca || anterior.mudanca || null;
  let detail = passo.arg;
  // O comparador visual limita 400 linhas. O texto integral continua acessível.
  const diffEmTexto = diffs.length > 1 || diffs.some(it => String(it.oldText ?? '').split('\n').length > 400 || String(it.newText ?? '').split('\n').length > 400);
  if (diffEmTexto) detail += '\n\n' + diffs.map(it => String(it.path || '') + '\nAntes:\n' + String(it.oldText ?? '') + '\nDepois:\n' + String(it.newText ?? '')).join('\n\n');
  return { passo, detail, mudanca, action: passo.kind, target: mudanca?.path || merged.locations?.[0]?.path || '' };
}

/* A chave do "sempre permitir". O kind do protocolo tem 9 valores e "other"
   cobre MCP, web, memoria... liberar "other" inteiro liberaria tudo isso de
   uma vez - entao "other" e' por titulo. */
function chaveDePermissao(passo) {
  return passo.kind === 'other' ? 'other:' + (passo.titulo || passo.name) : passo.kind;
}
const rotuloDoPasso = (passo) => NOME_POR_KIND[passo.kind] || passo.titulo || passo.name || 'ferramenta';

const seguroJson = (v) => { try { return JSON.stringify(v).slice(0, LIM_SAIDA); } catch { return ''; } };

/* Traduz UM session/update nos eventos que a tela ja entende. Funcao pura
   (so' mexe no "st" que recebe e devolve a lista) - e' o que o teste prova. */
function traduzirUpdate(st, upd) {
  const out = [];
  if (!upd || typeof upd !== 'object') return out;
  if (!st.ferramentas) st.ferramentas = new Map();
  const tipo = upd.sessionUpdate;

  if (tipo === 'agent_message_chunk') {
    if (st.carregando) return out;   // replay do session/load: a tela ja tem o historico
    const t = textoDoBloco(upd.content);
    if (!t) return out;
    if (!st.msgId) { st.seq = (st.seq || 0) + 1; st.msgId = 'acp' + st.seq; st.acc = ''; }
    st.acc += t;
    out.push({ kind: 'text-final', id: st.msgId, text: st.acc, parcial: true });
    return out;
  }
  if (tipo === 'agent_thought_chunk') {
    if (st.carregando) return out;
    const t = textoDoBloco(upd.content);
    if (t) out.push({ kind: 'think-delta', text: t });
    return out;
  }
  if (tipo === 'user_message_chunk') return out;   // a sua fala a tela desenhou ao enviar

  if (tipo === 'tool_call') {
    if (st.carregando) return out;
    fecharFala(st, out);
    const id = String(upd.toolCallId || ('t' + Date.now()));
    const p = passoDaFerramenta(upd);
    const c = conteudoDaFerramenta(upd.content);
    // guarda o pedido cru: o request_permission pode vir so' com o id
    st.ferramentas.set(id, { name: p.name, arg: p.arg, kind: p.kind, temMudanca: !!c.mudanca, mudanca: c.mudanca, bruto: enxuto(upd), fim: false });
    out.push({ kind: 'tool-start', id, name: p.name, arg: p.arg, mudanca: c.mudanca || null });
    if (upd.status === 'completed' || upd.status === 'failed') {
      out.push({ kind: 'tool-end', id, output: corta(c.texto, LIM_SAIDA), error: upd.status === 'failed', imagens: c.imagens });
      st.ferramentas.get(id).fim = true;
    }
    return out;
  }
  if (tipo === 'tool_call_update') {
    if (st.carregando) return out;
    const id = String(upd.toolCallId || '');
    if (!id) return out;
    const c = conteudoDaFerramenta(upd.content);
    let f = st.ferramentas.get(id);
    if (f && f.fim) {
      // passo ja terminado: so' um diff tardio interessa; o resto e' repeticao
      // (renascer como passo novo dava passo e fim em dobro na linha do tempo)
      if (c.mudanca && !f.temMudanca) { f.temMudanca = true; f.mudanca = c.mudanca; out.push({ kind: 'tool-mudanca', id, mudanca: c.mudanca }); }
      return out;
    }
    if (!f) {
      // update de um passo que nunca teve o tool_call (alguns agentes mandam
      // so' o update): o passo nasce agora, em vez de sumir
      fecharFala(st, out);
      const p = passoDaFerramenta(upd);
      f = { name: p.name, arg: p.arg, kind: p.kind, temMudanca: !!c.mudanca, mudanca: c.mudanca, bruto: enxuto(upd), fim: false };
      st.ferramentas.set(id, f);
      out.push({ kind: 'tool-start', id, name: p.name, arg: p.arg, mudanca: c.mudanca || null });
    } else if (c.mudanca && !f.temMudanca) {
      f.temMudanca = true; f.mudanca = c.mudanca;
      out.push({ kind: 'tool-mudanca', id, mudanca: c.mudanca });
    }
    f.bruto = { ...(f.bruto || {}), ...enxuto(upd) };
    const status = upd.status;
    if (status === 'completed' || status === 'failed') {
      let saida = c.texto;
      if (!saida && upd.rawOutput != null) saida = typeof upd.rawOutput === 'string' ? upd.rawOutput : seguroJson(upd.rawOutput);
      out.push({ kind: 'tool-end', id, output: corta(saida, LIM_SAIDA), error: status === 'failed', imagens: c.imagens });
      f.fim = true;
    } else if (c.texto) {
      out.push({ kind: 'tool-output', id, text: c.texto });
    }
    return out;
  }
  if (tipo === 'plan') {
    const itens = (Array.isArray(upd.entries) ? upd.entries : []).slice(0, 30).map((e) => ({
      txt: String((e && e.content) || '').slice(0, 200),
      estado: e && e.status === 'completed' ? 'feito' : (e && e.status === 'in_progress' ? 'fazendo' : 'pendente'),
    })).filter((x) => x.txt);
    out.push({ kind: 'plano', itens });
    return out;
  }
  if (tipo === 'available_commands_update') {
    st.comandos = (Array.isArray(upd.availableCommands) ? upd.availableCommands : [])
      .map((c) => ({ name: String((c && c.name) || '').trim(), desc: String((c && c.description) || '').slice(0, 140) }))
      .filter((c) => c.name);
    out.push({ kind: 'acp-comandos', itens: st.comandos });
    return out;
  }
  if (tipo === 'current_mode_update') {
    if (upd.currentModeId) { st.modoAtual = String(upd.currentModeId); out.push({ kind: 'acp-modo', modo: st.modoAtual }); }
    return out;
  }
  return out;
}
/* uma fala que estava chegando fecha antes de um passo: o que ele disser
   depois da ferramenta e' outra fala (igual ao Gemini/Grok por turno) */
function fecharFala(st, out) {
  if (!st.msgId) return;
  out.push({ kind: 'text-final', id: st.msgId, text: st.acc, fecha: true });
  st.msgId = null; st.acc = '';
}

/* Qual opcao responder num pedido de permissao. O protocolo padroniza os tipos
   (allow_once/allow_always/reject_once/reject_always); se um agente inventar
   outro nome, cai no texto. */
function escolherOpcao(options, allow, sempre) {
  const ops = Array.isArray(options) ? options.filter(Boolean) : [];
  const porKind = (k) => ops.find((o) => o.kind === k);
  if (allow) {
    return (sempre && porKind('allow_always')) || porKind('allow_once') || porKind('allow_always')
      || ops.find((o) => /allow|permit|accept|yes|sim/i.test(String(o.kind || '') + ' ' + String(o.name || ''))) || null;
  }
  return porKind('reject_once') || porKind('reject_always')
    || ops.find((o) => /reject|deny|no|n[aã]o/i.test(String(o.kind || '') + ' ' + String(o.name || ''))) || null;
}

/* ---- a chave do Gemini, que o modo --acp nao le sozinho ---- */
function lerChaveGemini(HOME) {
  try {
    const txt = fs.readFileSync(path.join(HOME, '.gemini', '.env'), 'utf8');
    const m = txt.match(/^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/* ---- a conversa gravada pelo proprio Cockpit ----
   O agente guarda a dele onde quiser (cada um num formato); a tela precisa
   reabrir a conversa depois, entao o Cockpit anota o que passou por aqui, num
   JSONL simples por sessao. Cabecalho na 1a linha; depois uma linha por fala. */
function pastaAcp(pastaDados) { return path.join(pastaDados(), 'acp'); }
function arquivoDaSessao(pastaDados, id) {
  return path.join(pastaAcp(pastaDados), String(id || '').replace(/[^\w.-]/g, '_') + '.jsonl');
}
function anotar(arquivo, obj) {
  if (!arquivo) return;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.appendFileSync(arquivo, JSON.stringify({ t: Date.now(), ...obj }) + '\n', 'utf8');
  } catch {}
}
function linhasDoTranscrito(bruto) {
  const meta = {};
  const msgs = [];
  for (const linha of String(bruto || '').split('\n')) {
    if (linha.charCodeAt(0) !== 123) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (d.cabecalho) { Object.assign(meta, d); continue; }
    if (d.role) msgs.push(d);
  }
  return { meta, msgs };
}
function lerTranscrito(arquivo) {
  try { return linhasDoTranscrito(fs.readFileSync(arquivo, 'utf8')); }
  catch { return { meta: {}, msgs: [] }; }
}
/* pra lista basta o comeco do arquivo (cabecalho + primeira fala sua): ler
   tudo a cada abertura da lateral custaria o tamanho somado das conversas */
const CABECA_LISTA = 64 * 1024;
function lerCabeca(arquivo) {
  let fd = null;
  try {
    fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(CABECA_LISTA);
    const n = fs.readSync(fd, buf, 0, CABECA_LISTA, 0);
    return buf.slice(0, n).toString('utf8');
  } catch { return ''; } finally { if (fd != null) { try { fs.closeSync(fd); } catch {} } }
}
const cacheLista = new Map();   // arquivo -> { mtime, item }
function listarSessoes(pastaDados) {
  const dir = pastaAcp(pastaDados);
  let nomes = [];
  try { nomes = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of nomes) {
    if (!/\.jsonl$/i.test(n)) continue;
    const f = path.join(dir, n);
    let when = 0;
    try { when = fs.statSync(f).mtimeMs; } catch { continue; }
    const guardado = cacheLista.get(f);
    if (guardado && guardado.mtime === when) { if (guardado.item) out.push(guardado.item); continue; }
    let { meta, msgs } = linhasDoTranscrito(lerCabeca(f));
    let primeira = msgs.find((m) => m.role === 'user' && String(m.text || '').trim());
    // 1a fala sua maior que a cabeca (um log colado): le o arquivo inteiro UMA vez
    let tamanho = 0;
    try { tamanho = fs.statSync(f).size; } catch {}
    if (!primeira && tamanho > CABECA_LISTA) { ({ meta, msgs } = lerTranscrito(f)); primeira = msgs.find((m) => m.role === 'user' && String(m.text || '').trim()); }
    const id = meta.id || n.replace(/\.jsonl$/i, '');
    // sessao que nunca recebeu uma fala sua (nas primeiras linhas) nao e' conversa
    const item = primeira ? {
      engine: 'acp', id, file: f, when, entrada: 'cockpit',
      cwd: meta.cwd || '', comando: meta.comando || COMANDO_PADRAO, agente: meta.agente || '',
      title: String(primeira.text).replace(/\s+/g, ' ').trim().slice(0, 120),
    } : null;
    cacheLista.set(f, { mtime: when, item });
    if (item) out.push(item);
  }
  if (cacheLista.size > 2000) cacheLista.clear();
  out.sort((a, b) => b.when - a.when);
  return out.slice(0, 300);
}
function historicoDaSessao(arquivo, maxMsgs) {
  const { msgs } = lerTranscrito(arquivo);
  const out = [];
  for (const m of msgs) {
    if (m.role === 'user') { if (String(m.text || '').trim()) out.push({ role: 'user', text: String(m.text) }); }
    else if (m.role === 'bot') { if (String(m.text || '').trim()) out.push({ role: 'bot', text: String(m.text) }); }
    else if (m.role === 'tool') out.push({ role: 'tool', name: m.name || 'Ferramenta', arg: String(m.arg || '').slice(0, 120) });
  }
  return out.slice(-(maxMsgs || 60));
}

/* ======================= o motor de verdade ======================= */
function criarAcp(dep) {
  const { emit, spawnBin, buildEnv, matarProcesso, HOME, pastaDados, aoPedirPermissao, aoCair, aoFimDoTurno } = dep;
  const autoLiberada = dep.autoLiberada || (() => false);
  const paineis = new Map();     // paneId -> st
  const iniciando = new Map();   // paneId -> { comando, promessa }: dois Enter durante o "Ligando…" viram UM start

  const escrever = (st, obj) => {
    if (!st.proc || !st.proc.stdin) return false;
    try { st.proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  };
  function mandar(st, method, params, msTimeout) {
    return new Promise((res, rej) => {
      const id = ++st.rpcId;
      let timer = 0;
      if (msTimeout) {
        timer = setTimeout(() => {
          st.pend.delete(id);
          rej(new Error('o agente não respondeu a "' + method + '" em ' + Math.round(msTimeout / 1000) + 's'));
        }, msTimeout);
      }
      st.pend.set(id, {
        res: (v) => { if (timer) clearTimeout(timer); res(v); },
        rej: (e) => { if (timer) clearTimeout(timer); rej(e); },
      });
      if (!escrever(st, { jsonrpc: '2.0', id, method, params: params || {} })) {
        st.pend.delete(id); if (timer) clearTimeout(timer);
        rej(new Error('o processo do agente não está de pé'));
      }
    });
  }
  const notificar = (st, method, params) => escrever(st, { jsonrpc: '2.0', method, params: params || {} });
  const responder = (st, id, result) => escrever(st, { jsonrpc: '2.0', id, result });
  const responderErro = (st, id, code, message) => escrever(st, { jsonrpc: '2.0', id, error: { code, message } });
  const pararFala = (st) => { if (st.timerFala) { clearTimeout(st.timerFala); st.timerFala = null; } st.ultimaFala = null; };

  /* fala com freio: no maximo 10 desenhos por segundo, e o fecho sai na hora */
  function despachar(st, ev) {
    const { kind, ...data } = ev;
    if (kind === 'text-final') {
      if (ev.fecha) {
        pararFala(st);
        emit(st.paneId, 'text-final', { id: ev.id, text: ev.text });
        anotar(st.arquivo, { role: 'bot', text: ev.text });
        return;
      }
      st.ultimaFala = { id: ev.id, text: ev.text };
      if (st.timerFala) return;
      st.timerFala = setTimeout(() => {
        st.timerFala = null;
        if (st.ultimaFala) emit(st.paneId, 'text-final', st.ultimaFala);
      }, 100);
      return;
    }
    if (kind === 'tool-start') anotar(st.arquivo, { role: 'tool', name: data.name, arg: data.arg });
    emit(st.paneId, kind, data);
  }

  function tratarPermissao(st, m) {
    if (st.cancelando) return responder(st, m.id, { outcome: { outcome: 'cancelled' } });   // spec: cancelou, tudo pendente e' cancelled
    const p = m.params || {};
    const tc = p.toolCall || {};
    const opcoes = Array.isArray(p.options) ? p.options : [];
    // o pedido pode vir so' com o toolCallId: o resto ja veio no tool_call
    const antes = st.ferramentas.get(String(tc.toolCallId || '')) || {};
    const { passo, detail, mudanca, action, target } = dadosDaPermissao(tc, antes);
    const chave = chaveDePermissao(passo);
    const rotulo = rotuloDoPasso(passo);
    const porBypass = st.approval === 'bypass';
    if (porBypass || autoLiberada(st.paneId, chave)) {
      // no bypass, allow_always poupa idas e vindas; liberado por "sempre
      // permitir", allow_once - cada chamada volta aqui e deixa rastro na auditoria
      const op = escolherOpcao(opcoes, true, porBypass);
      if (op) {
        responder(st, m.id, { outcome: { outcome: 'selected', optionId: op.optionId } });
        if (!porBypass) emit(st.paneId, 'auto-liberado', { tool: rotulo, arg: passo.arg });
        return;
      }
    }
    st.pedidos.set(m.id, { opcoes });
    aoPedirPermissao(st.paneId, m.id, {
      title: (st.info.title || st.info.name || 'O agente') + ' quer: ' + (passo.titulo || rotulo),
      detail, tool: chave, rotulo, mudanca, action, target,
    });
  }

  function pedidoDoAgente(st, m) {
    const p = m.params || {};
    if (p.sessionId && st.sessionId && String(p.sessionId) !== st.sessionId) {
      return responderErro(st, m.id, -32602, 'sessão desconhecida');
    }
    if (m.method === 'session/request_permission') return tratarPermissao(st, m);
    // caminho relativo resolve na pasta do PAINEL, nunca na do Electron
    const caminho = (s) => { const t = String(s || ''); return path.isAbsolute(t) ? t : path.resolve(st.cwd, t); };
    if (m.method === 'fs/read_text_file') {
      const alvo = caminho(p.path);
      fs.promises.stat(alvo)
        .then((s) => {
          if (s.size > LIM_LEITURA) throw Object.assign(new Error('arquivo acima de 20 MB'), { code: 'EFBIG' });
          return fs.promises.readFile(alvo, 'utf8');
        })
        .then((txt) => {
          if (p.line != null || p.limit != null) {
            const linhas = txt.split('\n');
            const de = Math.max(0, (Number(p.line) || 1) - 1);
            const ate = p.limit != null ? de + Number(p.limit) : linhas.length;
            txt = linhas.slice(de, ate).join('\n');
          }
          responder(st, m.id, { content: txt });
        })
        .catch((e) => {
          // arquivo que nao existe = conteudo vazio (armadilha 4 do cabecalho)
          if (e && e.code === 'ENOENT') return responder(st, m.id, { content: '' });
          responderErro(st, m.id, -32603, 'não consegui ler: ' + (e && e.message || e));
        });
      return;
    }
    if (m.method === 'fs/write_text_file') {
      const alvo = caminho(p.path);
      fs.promises.mkdir(path.dirname(alvo), { recursive: true })
        .then(() => fs.promises.writeFile(alvo, String(p.content == null ? '' : p.content), 'utf8'))
        .then(() => responder(st, m.id, {}))
        .catch((e) => responderErro(st, m.id, -32603, 'não consegui escrever: ' + (e && e.message || e)));
      return;
    }
    // terminal/* e o que mais vier: o Cockpit nao anunciou, o agente usa o dele
    return responderErro(st, m.id, -32601, 'método não suportado pelo Cockpit: ' + m.method);
  }

  function tratarLinha(st, linha) {
    let m; try { m = JSON.parse(linha); } catch { return; }   // banner/aviso fora do protocolo
    if (!m || typeof m !== 'object') return;
    if (m.id !== undefined && m.method === undefined) {
      const q = st.pend.get(m.id);
      if (!q) return;
      st.pend.delete(m.id);
      if (m.error) q.rej(new Error(String((m.error && m.error.message) || 'erro do agente') + (m.error && m.error.code != null ? ' (' + m.error.code + ')' : '')));
      else q.res(m.result);
      return;
    }
    if (!m.method) return;
    if (m.id !== undefined) return pedidoDoAgente(st, m);
    if (m.method === 'session/update') {
      const p = m.params || {};
      if (st.sessionId && p.sessionId && String(p.sessionId) !== st.sessionId) return;
      for (const ev of traduzirUpdate(st, p.update)) despachar(st, ev);
    }
  }

  function cancelarPedidos(st) {
    for (const [id] of [...st.pedidos]) { responder(st, id, { outcome: { outcome: 'cancelled' } }); st.pedidos.delete(id); }
  }

  /* o modo do agente e' aplicado sem segurar a sessao: agente que nao responde
     ao set_mode nao pode atrasar o painel em 30s (o current_mode_update
     corrige o modoAtual depois, se vier) */
  function aplicarModo(st) {
    if (!st.modos.length || !st.sessionId) return;
    const alvo = modoDoAgente(st.approval, st.modos);
    if (!alvo || alvo === st.modoAtual) return;
    mandar(st, 'session/set_mode', { sessionId: st.sessionId, modeId: alvo }, 15000)
      .then(() => { if (paineis.get(st.paneId) !== st) return; st.modoAtual = alvo; emit(st.paneId, 'acp-modo', { modo: alvo }); })
      .catch(() => {});
  }

  function motivoDaQueda(st, codigo) {
    const s = String(st.erro || '').replace(/\x1b\[[0-9;]*m/g, '');
    const linha = s.split('\n').map((l) => l.trim())
      .filter((l) => l && !/^\s*at /.test(l) && !/Skipping project agents/i.test(l) && !/YOLO mode/i.test(l))
      .slice(-2).join(' · ');
    return linha ? linha.slice(0, 240) : ('o agente saiu (código ' + codigo + ')');
  }

  /* derruba ESTE st, nunca o que veio depois dele no mesmo painel */
  function pararSt(st) {
    if (paineis.get(st.paneId) !== st) return;
    parar(st.paneId);
  }

  function start(paneId, opts) {
    const o = opts || {};
    const comando = String(o.comando || COMANDO_PADRAO).trim();
    /* dois Enter durante o "Ligando o ACP…" (10-90s) chegavam como dois starts:
       o catch do primeiro matava o processo do segundo. Agora um start IGUAL
       em curso e' reaproveitado. Igual = mesmo comando, pasta, modo e retomada;
       mudou qualquer um, e' outro start de verdade (e derruba o em curso). */
    const chave = JSON.stringify([comando, o.cwd || '', o.approval || '', o.resumeId || '']);
    const emCurso = iniciando.get(paneId);
    if (emCurso && emCurso.chave === chave) return emCurso.promessa;
    const promessa = startDeVerdade(paneId, comando, o);
    iniciando.set(paneId, { chave, promessa });
    // so' solta a entrada se ainda for ESTA promessa: a rejeicao de um start
    // velho (morto pelo novo) chega depois e apagava a entrada do novo
    const solta = () => { const g = iniciando.get(paneId); if (g && g.promessa === promessa) iniciando.delete(paneId); };
    promessa.then(solta, solta);
    return promessa;
  }

  async function startDeVerdade(paneId, comando, opts) {
    const { bin, args } = comandoEmPartes(comando);
    if (!bin) throw new Error('O comando do agente ACP está vazio. Escolha um no menu do modelo.');
    parar(paneId);
    const st = {
      paneId, comando, cwd: opts.cwd || HOME, approval: opts.approval || 'manual',
      proc: null, buf: '', erro: '', rpcId: 0, pend: new Map(), pedidos: new Map(),
      sessionId: '', nova: false, caps: {}, info: {}, modos: [], modoAtual: '', modelos: [], modeloAtual: '', comandos: [],
      ferramentas: new Map(), msgId: null, acc: '', seq: 0, carregando: false, ocupado: false, cancelando: false,
      arquivo: '', timerFala: null, ultimaFala: null, parandoDeProposito: false, contextoAntigo: null,
    };
    paineis.set(paneId, st);
    try {
      await subir(st, bin, args, opts);
      return true;
    } catch (e) {
      pararSt(st);   // por identidade: se outro start ja assumiu o painel, ele fica
      throw e;
    }
  }

  async function subir(st, bin, args, opts) {
    const paneId = st.paneId;
    const env = buildEnv();
    // a chave vale pro comando INTEIRO ("npx @google/gemini-cli --acp" tambem e' gemini)
    if (/gemini/i.test(st.comando) && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
      const chave = lerChaveGemini(HOME);
      if (chave) env.GEMINI_API_KEY = chave;
    }
    let proc;
    try { proc = spawnBin(bin, args, { cwd: st.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { throw new Error('Não consegui rodar "' + st.comando + '": ' + (e && e.message || e)); }
    st.proc = proc;
    const decoder = new StringDecoder('utf8');
    let saidaFechada = false, quedaTratada = false;
    const lerSaida = (texto, final = false) => {
      if (paineis.get(paneId) !== st) return;
      st.buf += texto;
      let i;
      while ((i = st.buf.indexOf('\n')) >= 0) {
        const linha = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
        if (!linha) continue;
        // formato inesperado de um agente novo nao pode derrubar o app inteiro
        try { tratarLinha(st, linha); } catch (e) { st.erro = (st.erro + ' ' + (e && e.message || e)).slice(-1500); }
      }
      if (final && st.buf.trim()) {
        const linha = st.buf.trim(); st.buf = '';
        try { tratarLinha(st, linha); } catch (e) { st.erro = (st.erro + ' ' + (e && e.message || e)).slice(-1500); }
      }
    };
    const fecharSaida = () => { if (!saidaFechada) { saidaFechada = true; lerSaida(decoder.end(), true); } };
    proc.stdout.on('data', (chunk) => { if (!saidaFechada) lerSaida(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))); });
    proc.stdout.on('end', fecharSaida);
    proc.stderr.on('data', (d) => { st.erro = (st.erro + d.toString('utf8')).slice(-1500); });
    const caiu = (codigo) => {
      if (quedaTratada) return;
      quedaTratada = true;
      fecharSaida();
      const motivo = motivoDaQueda(st, codigo);
      // escrever num stdin morto nao lanca: sem isto um mandar() novo esperava o
      // prazo inteiro (ate' 240s) em silencio, em vez de falhar com o motivo
      st.proc = null;
      for (const [, q] of [...st.pend]) q.rej(new Error(motivo));   // o start lanca com o stderr de verdade
      st.pend.clear();
      pararFala(st);
      if (paineis.get(paneId) !== st) return;
      paineis.delete(paneId);
      // sem sessao ainda, nao e' queda de motor: e' falha de start, e quem
      // avisa e' o proprio start (senao saiam tres avisos, um deles mentindo
      // "a proxima mensagem religa")
      if (st.parandoDeProposito || !st.sessionId) return;
      st.pedidos.clear();
      try { aoCair && aoCair(paneId); } catch {}
      emit(paneId, 'engine-down', { motivo, codigo });
    };
    proc.stdin.on('error', (e) => {
      st.erro = (st.erro + ' ' + (e && e.message || e)).slice(-1500);
      caiu(-1);
      try { matarProcesso(proc); } catch {}
    });
    proc.on('close', caiu);
    proc.on('error', (e) => { st.erro += ' ' + (e && e.message || e); caiu(-1); });

    // handshake
    const init = await mandar(st, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'cockpit', title: 'Cockpit', version: '1.0' },
    }, 120000);
    st.caps = (init && init.agentCapabilities) || {};
    st.info = (init && init.agentInfo) || {};
    const metodosAuth = (init && Array.isArray(init.authMethods)) ? init.authMethods : [];
    const queria = opts.resumeId ? String(opts.resumeId) : '';

    const abrirSessao = async () => {
      let r = null;
      let motivoLoad = '';
      if (queria && st.caps.loadSession) {
        st.carregando = true;
        try {
          r = await mandar(st, 'session/load', { sessionId: queria, cwd: st.cwd, mcpServers: [] }, 300000);
          st.sessionId = queria;
        } catch (e) {
          if (!st.proc) throw e;   // o agente MORREU no load: nao adianta tentar sessao nova nele
          r = null; motivoLoad = String(e && e.message || e);
        }
        finally { st.carregando = false; st.msgId = null; st.acc = ''; }
      }
      if (!st.sessionId) {
        r = await mandar(st, 'session/new', { cwd: st.cwd, mcpServers: [] }, 240000);
        st.sessionId = String((r && r.sessionId) || '');
        if (!st.sessionId) throw new Error('o agente não devolveu o id da sessão');
        st.nova = true;
      }
      return { r: r || {}, motivoLoad };
    };
    let aberta;
    try { aberta = await abrirSessao(); }
    catch (e) {
      const msg = String(e && e.message || e);
      // sem login: tenta o metodo por chave se houver chave no ambiente; senao explica
      const porChave = metodosAuth.find((a) => /api[-_]?key/i.test(String(a.id || '')));
      if (/auth/i.test(msg) && porChave && (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY)) {
        await mandar(st, 'authenticate', { methodId: porChave.id }, 60000);
        aberta = await abrirSessao();
      } else if (/auth/i.test(msg)) {
        const como = metodosAuth.map((a) => a.name || a.id).filter(Boolean).join(' / ');
        throw new Error('O agente pede login' + (como ? ' (' + como + ')' : '') + '. Rode "' + bin + '" uma vez pelo terminal, entre na conta e volte aqui.');
      } else throw e;
    }
    const r = aberta.r;
    const modos = r.modes && Array.isArray(r.modes.availableModes) ? r.modes.availableModes : [];
    st.modos = modos.map((m) => ({ id: String(m.id || ''), nome: String(m.name || m.id || ''), desc: String(m.description || '') })).filter((m) => m.id);
    st.modoAtual = (r.modes && r.modes.currentModeId) ? String(r.modes.currentModeId) : '';
    const modelos = r.models && Array.isArray(r.models.availableModels) ? r.models.availableModels : [];
    st.modelos = modelos.map((m) => ({ id: String(m.modelId || m.id || ''), nome: String(m.name || m.modelId || ''), desc: String(m.description || '') })).filter((m) => m.id);
    st.modeloAtual = (r.models && r.models.currentModelId) ? String(r.models.currentModelId) : '';

    st.arquivo = arquivoDaSessao(pastaDados, st.sessionId);
    // cabecalho: sessao nova, ou retomada cujo arquivo sumiu (sem ele a lista
    // mostraria comando errado e pasta vazia)
    if (st.nova || !fs.existsSync(st.arquivo)) {
      anotar(st.arquivo, { cabecalho: 1, id: st.sessionId, comando: st.comando, cwd: st.cwd, criado: Date.now(), agente: st.info.title || st.info.name || bin });
    }
    const retomou = !!(queria && st.sessionId === queria);
    if (queria && !retomou) {
      /* a tela ja desenhou o historico da conversa antiga, mas o agente nao
         tem contexto nenhum dela: avisa, e leva as ultimas falas junto na
         primeira mensagem (mesma ideia do passarContexto da troca de motor) */
      st.contextoAntigo = historicoDaSessao(arquivoDaSessao(pastaDados, queria), 20);
      if (!st.contextoAntigo.length) st.contextoAntigo = null;
      const porque = !st.caps.loadSession ? 'este agente não retoma conversa antiga' : ('o agente não achou a conversa' + (aberta.motivoLoad ? ' (' + aberta.motivoLoad.slice(0, 120) + ')' : ''));
      emit(paneId, 'note', { text: 'Comecei uma conversa nova: ' + porque + '. ' + (st.contextoAntigo
        ? 'O que está acima é só o registro — mando um resumo dele junto com a sua próxima mensagem.'
        : 'Não achei o registro da conversa antiga neste computador; ele começa sem contexto.'), error: true });
    }
    emit(paneId, 'sessao', { id: st.sessionId, file: st.arquivo });
    const pc = st.caps.promptCapabilities || {};
    emit(paneId, 'acp-info', {
      agente: st.info.title || st.info.name || bin, versao: st.info.version || '',
      modos: st.modos, modoAtual: st.modoAtual, modelos: st.modelos, modeloAtual: st.modeloAtual,
      comandos: st.comandos, retomou, imagem: !!pc.image,
    });
    aplicarModo(st);
  }

  function fimDoTurno(st, motivo) {
    const out = [];
    fecharFala(st, out);
    for (const ev of out) despachar(st, ev);
    st.ocupado = false;
    st.cancelando = false;
    st.ferramentas.clear();
    cancelarPedidos(st);
    // pedido de permissao que sobrou nao vale mais: o main tira o cartao da tela
    try { aoFimDoTurno && aoFimDoTurno(st.paneId); } catch {}
    if (motivo === 'refusal') emit(st.paneId, 'note', { text: 'O agente recusou continuar este pedido.', error: true });
    else if (motivo === 'max_turn_requests') emit(st.paneId, 'note', { text: 'O agente parou no teto de passos do turno. Mande "continue" pra seguir.' });
    else if (motivo === 'max_tokens') emit(st.paneId, 'note', { text: 'A resposta bateu no teto de tamanho. Mande "continue" pra seguir.' });
    emit(st.paneId, 'turn-end', {});
    // mensagem que chegou com o turno rodando: sai agora, na ordem
    const prox = st.fila && st.fila.shift();
    if (prox) setTimeout(() => { if (paineis.get(st.paneId) === st && !st.ocupado) enviar(st.paneId, prox.texto, prox.anexos); }, 50);
  }

  function textoDoContextoAntigo(msgs) {
    const linhas = [];
    for (const m of (msgs || [])) {
      if (m.role === 'user') linhas.push('### Você:\n' + m.text);
      else if (m.role === 'bot') linhas.push('### Assistente:\n' + m.text);
    }
    if (!linhas.length) return '';
    return 'Estou continuando uma conversa anterior que você não tem mais na memória. Abaixo estão as últimas falas dela; '
      + 'assuma o trabalho daqui em diante, sem recomeçar do zero.\n\n--- conversa até aqui ---\n'
      + linhas.join('\n\n').slice(0, 14000) + '\n--- fim da conversa anterior ---\n\nAgora, o novo pedido:\n';
  }

  function enviar(paneId, texto, anexos) {
    const st = paineis.get(paneId);
    if (!st || !st.proc || !st.sessionId) return false;
    if (st.ocupado) {
      // ocupado NAO e' morto: a tela traduzia o false como "conexao caiu" e
      // religava por cima do turno. Vai pra fila e sai no fim do turno.
      (st.fila = st.fila || []).push({ texto, anexos: (anexos || []).slice() });
      return true;
    }
    const pc = st.caps.promptCapabilities || {};
    const prompt = [];
    let t = String(texto == null ? '' : texto);
    const sobraram = [];
    for (const f of (anexos || [])) {
      const mime = MIME_IMG[path.extname(String(f)).slice(1).toLowerCase()];
      if (!mime || !pc.image) { sobraram.push(f); continue; }
      try {
        if (fs.statSync(f).size > LIM_IMG) { sobraram.push(f); continue; }
        prompt.push({ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: mime });
      } catch { sobraram.push(f); }
    }
    if (sobraram.length && !t.includes('Arquivos que anexei')) {
      t += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + sobraram.map((f) => '- ' + f).join('\n');
    }
    // grava o que VOCE escreveu; o prefixo de contexto vai so' pro agente
    // (gravado, virava o titulo da conversa e um balao seu de 14 KB ao reabrir)
    anotar(st.arquivo, { role: 'user', text: t, ...(st.contextoAntigo ? { comContexto: true } : {}) });
    if (st.contextoAntigo) { t = textoDoContextoAntigo(st.contextoAntigo) + t; st.contextoAntigo = null; }
    prompt.push({ type: 'text', text: t });
    st.ocupado = true; st.cancelando = false; st.ferramentas.clear(); st.msgId = null; st.acc = '';
    emit(paneId, 'busy', {});
    // sem prazo: um turno de agente pode levar meia hora, e quem encerra e' o
    // proprio agente (ou o botao de parar, via session/cancel)
    mandar(st, 'session/prompt', { sessionId: st.sessionId, prompt }, 0)
      .then((r) => { if (paineis.get(paneId) === st) fimDoTurno(st, r && r.stopReason); })
      .catch((e) => {
        if (paineis.get(paneId) !== st) return;
        if (!st.parandoDeProposito) emit(paneId, 'note', { text: 'O agente falhou neste turno: ' + String(e && e.message || e).slice(0, 240), error: true });
        fimDoTurno(st, 'erro');
      });
    return true;
  }

  function interromper(paneId) {
    const st = paineis.get(paneId);
    if (!st || !st.sessionId) return false;
    // spec: ao cancelar, o cliente responde 'cancelled' a TODO pedido de
    // permissao pendente - agora, nao quando o prompt voltar (agente que espera
    // a resposta pra devolver o prompt travaria pra sempre)
    st.cancelando = true;
    cancelarPedidos(st);   // primeiro destrava quem esta' esperando a permissao...
    notificar(st, 'session/cancel', { sessionId: st.sessionId });   // ...depois avisa que o turno acabou
    try { aoFimDoTurno && aoFimDoTurno(paneId); } catch {}
    return true;
  }

  function parar(paneId) {
    const st = paineis.get(paneId);
    if (!st) return;
    st.parandoDeProposito = true;
    pararFala(st);
    cancelarPedidos(st);
    for (const [, q] of [...st.pend]) q.rej(new Error('painel parado'));
    st.pend.clear();
    if (st.proc) { try { st.proc.stdout.removeAllListeners('data'); } catch {} matarProcesso(st.proc); st.proc = null; }
    paineis.delete(paneId);
  }

  function pararTodos() {
    for (const paneId of [...paineis.keys()]) parar(paneId);
  }

  function responderPermissao(paneId, rpcId, allow) {
    const st = paineis.get(paneId);
    if (!st) return false;
    const pedido = st.pedidos.get(rpcId);
    if (!pedido) return false;
    st.pedidos.delete(rpcId);
    if (allow == null) return responder(st, rpcId, { outcome: { outcome: 'cancelled' } });
    const op = escolherOpcao(pedido.opcoes, !!allow, false);
    if (!op) return responder(st, rpcId, { outcome: { outcome: 'cancelled' } });
    return responder(st, rpcId, { outcome: { outcome: 'selected', optionId: op.optionId } });
  }

  async function setModelo(paneId, modelId) {
    const st = paineis.get(paneId);
    if (!st || !st.sessionId) return { error: 'o agente não está ligado' };
    try {
      await mandar(st, 'session/set_model', { sessionId: st.sessionId, modelId: String(modelId) }, 30000);
      st.modeloAtual = String(modelId);
      return { ok: true };
    } catch (e) { return { error: 'este agente não deixa trocar o modelo por aqui (' + String(e && e.message || e).slice(0, 120) + ')' }; }
  }

  /* comandos que o agente DESTE painel anunciou (available_commands_update) */
  function comandos(paneId) {
    const st = paneId ? paineis.get(paneId) : null;
    return st ? (st.comandos || []).slice() : [];
  }

  return {
    start, enviar, interromper, parar, pararTodos, responderPermissao, setModelo, comandos,
    sessoes: () => listarSessoes(pastaDados),
    historico: (id, file, max) => historicoDaSessao(file && fs.existsSync(file) ? file : arquivoDaSessao(pastaDados, id), max || 60),
    arquivoDe: (id) => arquivoDaSessao(pastaDados, id),
  };
}

module.exports = {
  criarAcp, traduzirUpdate, comandoEmPartes, modoDoAgente, escolherOpcao, passoDaFerramenta, chaveDePermissao,
  conteudoDaFerramenta, dadosDaPermissao, lerChaveGemini, listarSessoes, historicoDaSessao, arquivoDaSessao, anotar,
  COMANDO_PADRAO, MODOS_EQUIVALENTES,
};
