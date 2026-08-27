const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const plataforma = require('./plataforma');
const { EH_WIN, acharBin, spawnBin, abrirPty, matarProcesso } = plataforma;

const HOME = os.homedir();
// no Mac o Claude mora sempre no mesmo lugar; no Windows a gente procura
const CLAUDE_BIN = EH_WIN ? acharBin('claude') : path.join(HOME, '.local/bin/claude');
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

let win = null;

/* ======================= util ======================= */
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); }
  catch {
    // arquivo corrompido (queda no meio de uma gravacao antiga): usa o backup
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH() + '.bak', 'utf8')); }
    catch { return {}; }
  }
}
/* grava em arquivo temporario e so' depois troca pelo bom: se a maquina cair
   no meio, o config antigo continua inteiro (antes perdia tudo de uma vez) */
function gravarSeguro(destino, texto) {
  const tmp = destino + '.tmp';
  try {
    fs.writeFileSync(tmp, texto);
    try { if (fs.existsSync(destino)) fs.copyFileSync(destino, destino + '.bak'); } catch {}
    fs.renameSync(tmp, destino);
    return true;
  } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
}
function saveConfig(cfg) { gravarSeguro(CONFIG_PATH(), JSON.stringify(cfg, null, 2)); }

// app GUI nao herda o PATH do shell: monta um PATH completo (ver plataforma.js)
const buildEnv = plataforma.buildEnv;

function emit(paneId, kind, data) {
  if (win && !win.isDestroyed()) win.webContents.send('pane:event', { paneId, kind, ...data });
}

/* ======================= motor CODEX ======================= */
/* um unico `codex app-server` atende todos os paineis, cada painel = uma thread */
const codex = {
  proc: null, id: 0, pend: new Map(), ready: null,
  threadToPane: new Map(),   // threadId -> paneId
  paneToThread: new Map(),   // paneId -> threadId
  paneTurn: new Map(),       // paneId -> turnId em andamento
  paneMsgId: new Map(),      // paneId -> id da fala que esta chegando letra a letra
};

/* o app-server ja usou nomes diferentes pro id do item (itemId, item_id, id).
   Ler so' um deles fazia o texto que chega letra a letra ficar com id
   diferente do texto final - e a resposta aparecia DUAS vezes na tela. */
function idDoItem(o) {
  if (!o || typeof o !== 'object') return '';
  const v = o.itemId != null ? o.itemId : (o.item_id != null ? o.item_id : o.id);
  return v == null ? '' : String(v);
}

function codexStart() {
  if (codex.ready) return codex.ready;
  codex.ready = new Promise((resolve, reject) => {
    let p;
    try {
      p = spawnBin('codex', ['app-server'], { cwd: HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      p.stdin.on('error', () => {});   // escrever apos o processo morrer nao pode derrubar o app inteiro
    } catch (e) { return reject(e); }
    codex.proc = p;

    let buf = '';   // proprio deste processo: dois app-servers nao podem se misturar
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        codexIncoming(m);
      }
    });
    p.stderr.on('data', () => {});   // logs do rust, ruido
    p.on('close', () => {
      // pendencia deste processo morre com ele, seja ele o atual ou nao: senao
      // quem chamou ficava esperando ate o prazo de 30s sem motivo
      for (const [k, pend] of [...codex.pend]) {
        if (pend && pend.proc && pend.proc !== p) continue;
        codex.pend.delete(k);
        try { pend.reject(new Error('o Codex caiu')); } catch {}
      }
      // o close de um processo ja substituido nao pode zerar o estado do atual
      if (codex.proc && codex.proc !== p) return;
      codex.proc = null; codex.ready = null;
      codex.paneTurn.clear(); codex.paneMsgId.clear();
      for (const [k, a] of [...pendingApprovals]) if (a && a.rpcId) pendingApprovals.delete(k);
      for (const paneId of codex.paneToThread.keys()) emit(paneId, 'engine-down', {});
      codex.paneToThread.clear(); codex.threadToPane.clear();
    });
    p.on('error', (e) => { codex.ready = null; reject(e); });

    codexReq('initialize', { clientInfo: { name: 'cockpit', version: '1.0.0', title: 'Cockpit' }, capabilities: { experimentalApi: true } })
      .then(() => { codexNote('initialized', {}); resolve(true); })
      .catch((e) => {
        // sem zerar o 'ready', TODA chamada seguinte recebia esta mesma promessa
        // recusada: o Codex ficava fora do ar ate fechar o app
        codex.ready = null;
        try { matarProcesso(p); } catch {}
        if (codex.proc === p) codex.proc = null;
        reject(e);
      });
  });
  return codex.ready;
}

function codexReq(method, params, msTimeout) {
  return new Promise((resolve, reject) => {
    if (!codex.proc) return reject(new Error('codex fora do ar'));
    const id = ++codex.id;
    // sem prazo, um app-server que nao responde deixava a tela carregando pra sempre
    const t = setTimeout(() => {
      if (codex.pend.delete(id)) reject(new Error('o Codex não respondeu a tempo'));
    }, msTimeout || 30000);
    codex.pend.set(id, {
      proc: codex.proc,   // pra saber de QUEM era a pendencia quando um processo cai
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function codexNote(method, params) {
  if (codex.proc) codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
function codexReply(id, result) {
  if (codex.proc) codex.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

const pendingApprovals = new Map();  // approvalKey -> {rpcId, type}
const autoLiberadas = new Map();     // paneId -> Set de ferramentas liberadas "sempre" NESTE painel

function codexIncoming(m) {
  // resposta a uma chamada nossa
  if (m.id !== undefined && m.method === undefined) {
    const p = codex.pend.get(m.id);
    if (p) { codex.pend.delete(m.id); m.error ? p.reject(new Error(m.error.message || 'erro')) : p.resolve(m.result); }
    return;
  }
  // servidor pedindo algo (aprovacao)
  if (m.id !== undefined && m.method) { codexServerRequest(m); return; }
  // notificacao
  if (m.method) codexNotification(m.method, m.params || {});
}

function paneOf(params) {
  // os metodos antigos (execCommandApproval, applyPatchApproval) mandam
  // 'conversationId'. Lendo so' threadId, ninguem respondia e o turno do Codex
  // ficava pendurado pra sempre esperando a resposta.
  const tid = params.threadId || (params.thread && params.thread.id) || params.conversationId;
  return tid ? codex.threadToPane.get(tid) : undefined;
}

function codexServerRequest(m) {
  const pane = paneOf(m.params || {});
  const meth = m.method;
  const key = 'ap_' + m.id;
  // pedido de APROVACAO sem painel dono nao aparece pra ninguem: recusa na hora
  // em vez de deixar o Codex esperando pra sempre. Vale so' pra aprovacao - o
  // 'currentTime/read' e os outros pedidos nao tem thread e seguem o fluxo normal.
  const ehAprovacao = /requestApproval$|^execCommandApproval$|^applyPatchApproval$/.test(meth);
  if (ehAprovacao && pane === undefined) { try { codexReply(m.id, { decision: 'reject' }); } catch {} return; }

  if (meth === 'item/commandExecution/requestApproval' || meth === 'execCommandApproval') {
    pendingApprovals.set(key, { rpcId: m.id, kind: 'cmd', paneId: pane });
    emit(pane, 'approval', {
      key, title: 'Rodar comando no seu computador',
      detail: (m.params.command || '') + (m.params.cwd ? '\nem ' + m.params.cwd : ''),
      reason: m.params.reason || '',
    });
    return;
  }
  if (meth === 'item/fileChange/requestApproval' || meth === 'applyPatchApproval') {
    pendingApprovals.set(key, { rpcId: m.id, kind: 'file', paneId: pane });
    emit(pane, 'approval', {
      key, title: 'Alterar arquivos',
      detail: m.params.grantRoot ? 'em ' + m.params.grantRoot : '',
      reason: m.params.reason || '',
    });
    return;
  }
  if (meth === 'item/permissions/requestApproval') {
    pendingApprovals.set(key, { rpcId: m.id, kind: 'perm', paneId: pane });
    emit(pane, 'approval', {
      key, title: 'Pedir mais acesso ao computador',
      detail: m.params.reason || JSON.stringify(m.params.permissions || {}).slice(0, 300),
      reason: '',
    });
    return;
  }
  if (meth === 'currentTime/read') { codexReply(m.id, { currentTimeAt: new Date().toISOString() }); return; }
  // qualquer outro pedido: responde vazio pra nao travar
  codexReply(m.id, {});
}

function codexNotification(method, params) {
  if (method === 'thread/started') {
    return; // o paneamento e feito no thread/start
  }
  const pane = paneOf(params);
  if (pane === undefined) return;

  switch (method) {
    case 'turn/started':
      codex.paneTurn.set(pane, params.turnId || (params.turn && params.turn.id));
      emit(pane, 'busy', {});
      break;

    case 'item/agentMessage/delta': {
      // guarda o id desta fala pra devolver o MESMO no 'completed'
      const idDelta = idDoItem(params) || 'msg';
      codex.paneMsgId.set(pane, idDelta);
      emit(pane, 'text-delta', { id: idDelta, text: params.delta || '' });
      break;
    }

    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      emit(pane, 'think-delta', { text: params.delta || '' });
      break;

    case 'item/started': {
      const it = params.item || {};
      if (it.type === 'commandExecution') emit(pane, 'tool-start', { id: it.id, name: 'Terminal', arg: it.command || '' });
      else if (it.type === 'fileChange') emit(pane, 'tool-start', { id: it.id, name: 'Editando arquivo', arg: fileChangeArg(it) });
      else if (it.type === 'mcpToolCall') emit(pane, 'tool-start', { id: it.id, name: mcpName(it), arg: shortJson(it.arguments) });
      else if (it.type === 'webSearch') emit(pane, 'tool-start', { id: it.id, name: 'Pesquisando na web', arg: it.query || '' });
      break;
    }

    case 'item/commandExecution/outputDelta':
    case 'command/exec/outputDelta': {
      const txt = decodeChunk(params.chunk ?? params.delta ?? params.data);
      if (txt) emit(pane, 'tool-output', { id: params.itemId || params.callId, text: txt });
      break;
    }

    case 'item/completed': {
      const it = params.item || {};
      if (it.type === 'agentMessage') {
        // o id do streaming manda: e' com ele que o painel ja desenhou a fala
        const idFim = codex.paneMsgId.get(pane) || idDoItem(it) || 'msg';
        codex.paneMsgId.delete(pane);
        emit(pane, 'text-final', { id: idFim, text: it.text || '', phase: it.phase || '' });
      } else if (it.type === 'commandExecution') {
        emit(pane, 'tool-end', {
          id: it.id,
          output: it.aggregatedOutput || it.output || '',
          error: (it.exitCode != null && it.exitCode !== 0) || it.status === 'failed',
        });
      } else if (it.type === 'fileChange') {
        emit(pane, 'tool-end', { id: it.id, output: fileChangeSummary(it), error: it.status === 'failed' });
      } else if (it.type === 'mcpToolCall') {
        emit(pane, 'tool-end', { id: it.id, output: shortJson(it.result ?? it.output), error: it.status === 'failed' });
      } else if (it.type === 'webSearch') {
        emit(pane, 'tool-end', { id: it.id, output: it.query || '', error: false });
      } else if (it.type === 'error') {
        emit(pane, 'note', { text: it.message || 'erro', error: true });
      }
      break;
    }

    case 'turn/completed': {
      descartarPermissoes(pane);
      codex.paneTurn.delete(pane);
      emit(pane, 'turn-end', {});
      break;
    }

    case 'turn/failed':
    case 'error':
      // sem isto o cartao "Permitir/Negar" ficava na tela pra sempre depois de
      // um turno que falhou, e o clique respondia a um pedido ja morto
      descartarPermissoes(pane);
      codex.paneTurn.delete(pane);
      emit(pane, 'note', { text: params.message || params.error || 'erro no Codex', error: true });
      emit(pane, 'turn-end', {});
      break;

    case 'thread/tokenUsage/updated': {
      const tu = params.tokenUsage || {};
      // "last" e o tamanho da conversa agora; "total" seria o gasto acumulado
      const atual = (tu.last && tu.last.totalTokens) || (tu.total && tu.total.totalTokens) || 0;
      emit(pane, 'tokens', { total: atual, janela: tu.modelContextWindow || undefined });
      break;
    }

    case 'thread/compacted':
      emit(pane, 'compactou', {});
      break;

    case 'thread/status/changed':
      if (params.status && params.status.type === 'idle') emit(pane, 'turn-end', {});
      break;
  }
}

function decodeChunk(c) {
  if (!c) return '';
  if (typeof c === 'string') { try { return Buffer.from(c, 'base64').toString('utf8'); } catch { return c; } }
  if (Array.isArray(c)) { try { return Buffer.from(c).toString('utf8'); } catch { return ''; } }
  return '';
}
function mcpName(it) { return (it.server ? it.server + ' · ' : '') + (it.tool || 'MCP'); }
function shortJson(v) { if (v == null) return ''; try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } }
function fileChangeArg(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => c.path || c.file || '').filter(Boolean).join(', ');
  return it.path || '';
}
function fileChangeSummary(it) {
  const ch = it.changes || it.fileChanges || [];
  if (Array.isArray(ch) && ch.length) return ch.map(c => (c.kind || c.type || 'alterado') + '  ' + (c.path || c.file || '')).join('\n');
  return shortJson(it);
}

/* O app-server nao aplica sozinho o ~/.codex/AGENTS.md, entao mandamos as regras da casa
   junto com cada conversa nova. Se o arquivo existir, ele manda; senao, vai o basico. */
function instrucoesCasa() {
  const base = 'Responda SEMPRE em português do Brasil, nunca em inglês.\n'
    + 'Fale em palavras simples, com exemplos do contexto de quem está perguntando.\n'
    + 'Resposta curta e direta: comece pelo resultado.';
  // as regras sao as de quem usa ESTE computador, nao as de quem escreveu o app
  for (const f of [path.join(HOME, '.codex/AGENTS.md'), path.join(HOME, '.claude/CLAUDE.md')]) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      if (txt.trim()) return base + '\n\n--- regras da casa (' + f + ') ---\n' + txt.slice(0, 12000);
    } catch {}
  }
  return base;
}

const CODEX_MODE = {
  manual:      { policy: 'untrusted',  sandbox: 'workspace-write' },
  'auto-edit': { policy: 'on-request', sandbox: 'workspace-write' },
  auto:        { policy: 'on-request', sandbox: 'workspace-write' },
  bypass:      { policy: 'never',      sandbox: 'danger-full-access' },
};
const CLAUDE_MODE = { manual: 'manual', 'auto-edit': 'acceptEdits', plan: 'plan', auto: 'auto', bypass: 'bypassPermissions' };

/* O settings.json do usuario tem defaultMode: bypassPermissions, que atropela qualquer
   --permission-mode. Para Manual e Auto funcionarem, escrevemos uma copia sem essa linha
   e carregamos ela por --settings, tirando o global do --setting-sources.            */
function claudeSettingsSemBypass(paneId) {
  try {
    const src = path.join(HOME, '.claude/settings.json');
    const d = JSON.parse(fs.readFileSync(src, 'utf8'));
    delete d.defaultMode;                       // existe tambem na raiz
    if (d.permissions) {
      delete d.permissions.defaultMode;
      delete d.permissions.additionalDirectories;  // isso liberava a home inteira sem perguntar
    }
    // a copia nao precisa de segredo: o processo filho ja herda o env por buildEnv()
    delete d.env; delete d.apiKeyHelper; delete d.awsAuthRefresh; delete d.awsCredentialExport;
    // um arquivo por painel: dois paineis subindo ao mesmo tempo liam o arquivo
    // pela metade (writeFileSync trunca antes de escrever)
    const marca = String(paneId || 'geral').replace(/[^\w-]/g, '_');
    const out = path.join(app.getPath('userData'), 'claude-settings-sem-bypass-' + marca + '.json');
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
    fs.renameSync(tmp, out);
    return out;
  } catch { return null; }
}

/* ======================= motor CLAUDE ======================= */
/* um processo `claude` por painel, protocolo stream-json */
const claudePanes = new Map();  // paneId -> {proc, buf, blocks}
const zumbis = new Set();      // processos que ja saíram do mapa mas talvez ainda vivam

const claudeCwd = new Map();
const claudeRemoto = new Map();   // paineis que rodam num servidor, nao aqui
// o Claude Code troca / . : e \ por - no nome da pasta do projeto
function encodeCwd(dir) { return String(dir).replace(/[\\/.:]/g, '-'); }

/* host/usuario que comecam com '-' seriam lidos como OPCAO pelo ssh
   (ex: -oProxyCommand=... roda comando na maquina local) */
function ssgValido(r) {
  return !!r && /^[\w.-]{1,253}$/.test(String(r.host || '')) && /^[\w.-]{1,32}$/.test(String(r.usuario || ''));
}

/* "cd '~/x'" nao funciona: entre aspas o til vira texto, o cd falha e o
   comando acaba rodando na home sem avisar. Testado na VPS. */
function cdRemoto(p) {
  const s = String(p || '~').trim() || '~';
  if (s === '~') return 'cd ~';
  if (s.startsWith('~/')) return 'cd ~/' + qLinux(s.slice(2));
  return 'cd ' + qLinux(s);
}

// aspas de shell POSIX, pro comando que vai dentro do SSH (o servidor remoto e' Linux)
function qLinux(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/* contador por painel: o mesmo numero precisa valer pro texto que chega
   letra a letra E pra versao final da mesma mensagem, senao a resposta
   aparece duas vezes na tela */
/* a conta e' por painel E por quem fala: dois sub-agentes rodando junto, cada
   um com o seu 'message_start', embaralhavam um contador unico e a fala de um
   saia com o numero do outro */
const msgSeqPorPane = new Map();
const seqDoPane = (paneId, marca) => msgSeqPorPane.get(paneId + '|' + (marca || '')) || 0;
const somaSeq = (paneId, marca) => msgSeqPorPane.set(paneId + '|' + (marca || ''), seqDoPane(paneId, marca) + 1);
const temSeq = (paneId, marca) => msgSeqPorPane.has(paneId + '|' + (marca || ''));
const limparSeq = (paneId) => {
  for (const k of [...msgSeqPorPane.keys()]) if (k.startsWith(paneId + '|')) msgSeqPorPane.delete(k);
};
/* sub-agente (ferramenta Task) fala pelo MESMO painel. Sem separar, a fala
   dele e a do principal disputam o mesmo lugar na tela e uma apaga a outra.
   Streaming e versao final usam esta mesma funcao, de proposito. */
function marcaSub(m) {
  const pid = m && (m.parent_tool_use_id || m.parentToolUseId);
  return pid ? 's' + String(pid).slice(-8) : '';
}
function claudeStart(paneId, opts) {
  claudeStop(paneId);
  claudeCwd.set(paneId, opts.cwd || HOME);
  const remoto = opts.remoto || null;
  if (remoto) claudeRemoto.set(paneId, remoto); else claudeRemoto.delete(paneId);
  // remoto: sempre sem pedir permissao - o canal de aprovacao (stdio + arquivo
  // de settings local) nao atravessa o SSH nesta versao
  const modo = remoto ? 'bypass' : (opts.approval || 'bypass');
  const args = [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages',
    '--permission-mode', CLAUDE_MODE[modo] || 'bypassPermissions',
  ];
  if (modo === 'bypass') {
    args.push('--dangerously-skip-permissions');
  } else {
    // canal para ele perguntar antes de agir
    args.push('--permission-prompt-tool', 'stdio');
    const sf = claudeSettingsSemBypass(paneId);
    if (sf) { args.push('--setting-sources', 'project,local'); args.push('--settings', sf); }
  }
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.model) args.push('--model', opts.model);
  if (opts.resumeId) args.push('--resume', opts.resumeId);
  // acesso amplo de saida so no modo que nao pergunta; nos outros ele pede na hora
  if (!remoto && modo === 'bypass' && opts.cwd && opts.cwd !== HOME) args.push('--add-dir', HOME);

  let proc;
  if (remoto) {
    if (!ssgValido(remoto)) { emit(paneId, 'note', { text: 'Servidor com endereço ou usuário inválido. Edite a aba.', error: true }); return false; }
    // '|| exit 1': se a pasta nao existir, o painel avisa em vez de rodar no lugar errado
    const comando = cdRemoto(remoto.caminhoRemoto) + ' || exit 1; claude ' + args.map(qLinux).join(' ');
    proc = spawnBin('ssh', [
      '-i', remoto.chave, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      remoto.usuario + '@' + remoto.host, '--', comando,
    ], { env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    proc = spawnBin(CLAUDE_BIN, args, { cwd: opts.cwd || HOME, env: buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  }
  proc.stdin.on('error', () => {});   // escrever apos o processo morrer nao pode derrubar o app inteiro
  const st = { proc, buf: '' };
  claudePanes.set(paneId, st);

  proc.stdout.on('data', (chunk) => {
    // este processo ja foi substituido: o rabo da resposta velha nao pode cair
    // dentro da conversa nova (e o 'result' dela apagaria o "trabalhando")
    if (claudePanes.get(paneId) !== st) return;
    st.buf += chunk.toString('utf8');
    let i;
    while ((i = st.buf.indexOf('\n')) >= 0) {
      const line = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      claudeMessage(paneId, m);
    }
  });
  proc.stderr.on('data', () => {});
  // handshake que liga o canal de permissao (e devolve a lista de skills)
  try { proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-' + paneId, request: { subtype: 'initialize', hooks: {} } }) + '\n'); } catch {}
  proc.on('close', () => {
    // usa o "st" deste processo, nao o que estiver no mapa agora: se o
    // usuario trocou de processo rapido, o mapa ja pode apontar para o novo
    if (claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    if (!st.parandoDeProposito) emit(paneId, 'engine-down', {});
  });
  proc.on('error', (e) => {
    if (claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    if (!st.parandoDeProposito) emit(paneId, 'note', { text: 'Erro: ' + e.message, error: true });
  });
  return true;
}

/* pedido de permissao que nao vale mais: responde ao motor (senao a thread do
   Codex fica esperando pra sempre) e manda a tela tirar o cartao */
function descartarPermissoes(paneId) {
  let tinha = false;
  for (const [k, a] of [...pendingApprovals]) {
    if (!a || a.paneId !== paneId) continue;
    pendingApprovals.delete(k); tinha = true;
    if (a.rpcId) { try { codexReply(a.rpcId, { decision: 'reject' }); } catch {} }
  }
  if (tinha) emit(paneId, 'permissao-cancelada', {});
}

function claudeStop(paneId) {
  limparSeq(paneId);
  claudeRemoto.delete(paneId);
  claudeCwd.delete(paneId);
  autoLiberadas.delete(paneId);   // liberacao vale so' enquanto o painel viver
  // pedido de permissao deste painel morre com o processo: sem isso o cartao
  // continuava na tela e o clique respondia ao processo ERRADO (o novo)
  descartarPermissoes(paneId);
  const st = claudePanes.get(paneId);
  if (st) {
    st.parandoDeProposito = true;
    // solta o ouvinte antes de matar: entre o SIGTERM e a morte de verdade ele
    // ainda despejaria texto do processo velho
    try { st.proc.stdout.removeAllListeners('data'); } catch {}
    if (claudePanes.get(paneId) === st) claudePanes.delete(paneId);
    // ele sai do mapa (pra 'pane:send' nao escrever num morto), mas alguem
    // precisa guardar a alca: se o SIGTERM nao pegar, o processo ficaria orfao
    zumbis.add(st.proc);
    // 'exit' e' o que sempre vem: 'close' espera TODOS os canos fecharem, e um
    // neto do claude (servidor MCP, bash de ferramenta) pode segurar o stdout
    st.proc.once('exit', () => zumbis.delete(st.proc));
    st.proc.once('close', () => zumbis.delete(st.proc));
    try { st.proc.kill('SIGTERM'); } catch {}
  }
}

function claudeMessage(paneId, m) {
  if (m.type === 'control_response') return;
  if (m.type === 'control_request' && m.request && m.request.subtype === 'can_use_tool') {
    // ferramenta que voce liberou "sempre" neste painel: responde sozinho
    const liberadas = autoLiberadas.get(paneId);
    if (liberadas && liberadas.has(m.request.tool_name)) {
      const st0 = claudePanes.get(paneId);
      if (st0) {
        try {
          st0.proc.stdin.write(JSON.stringify({
            type: 'control_response',
            response: { request_id: m.request_id, subtype: 'success',
              response: { behavior: 'allow', updatedInput: m.request.input } },
          }) + '\n');
        } catch {}
        // deixa rastro: sem isso a acao acontecia sem nada na tela
        emit(paneId, 'auto-liberado', { tool: m.request.tool_name || 'ferramenta',
          arg: claudeToolArg(m.request.tool_name, m.request.input) });
        return;
      }
    }
    const key = 'cl_' + paneId + '_' + m.request_id;
    pendingApprovals.set(key, { kind: 'claude', paneId, reqId: m.request_id, input: m.request.input });
    emit(paneId, 'approval', {
      key, title: 'Claude quer usar: ' + (m.request.tool_name || 'ferramenta'),
      detail: claudeToolArg(m.request.tool_name, m.request.input), reason: '',
      tool: m.request.tool_name || '',
      mudanca: mudancaDaFerramenta(m.request.tool_name, m.request.input, paneId),
    });
    return;
  }
  if (m.type === 'stream_event' && m.event) {
    const ev = m.event;
    const marca = marcaSub(m);
    // mensagem nova comecando: numero novo (aqui, nao no fim)
    if (ev.type === 'message_start') somaSeq(paneId, marca);
    if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') emit(paneId, 'text-delta', { id: 'm' + seqDoPane(paneId, marca) + marca + 'b' + ev.index, text: d.text || '' });
      else if (d.type === 'thinking_delta') emit(paneId, 'think-delta', { text: d.thinking || '' });
    }
    return;
  }
  if (m.type === 'assistant' && m.message) {
    const marca = marcaSub(m);
    // sem streaming (nao veio message_start) o numero ainda nao existe: cria agora
    if (!temSeq(paneId, marca)) somaSeq(paneId, marca);
    (m.message.content || []).forEach((c, i) => {
      if (c.type === 'text') emit(paneId, 'text-final', { id: 'm' + seqDoPane(paneId, marca) + marca + 'b' + i, text: c.text || '' });
      else if (c.type === 'tool_use') emit(paneId, 'tool-start', { id: c.id, name: c.name, arg: claudeToolArg(c.name, c.input), mudanca: mudancaDaFerramenta(c.name, c.input, paneId) });
    });
    return;
  }
  if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
    for (const c of m.message.content) {
      if (c.type === 'tool_result') {
        let txt = '';
        if (typeof c.content === 'string') txt = c.content;
        else if (Array.isArray(c.content)) txt = c.content.map(x => x && x.type === 'text' ? x.text : '').join('\n');
        emit(paneId, 'tool-end', { id: c.tool_use_id, output: txt, error: !!c.is_error });
      }
    }
    return;
  }
  if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
    // conversa que roda no servidor nao tem arquivo aqui: mandar um caminho
    // local inventado fazia o app procurar no PC e voltar vazio ao reabrir a aba
    const remotoDaqui = claudeRemoto.get(paneId);
    emit(paneId, 'sessao', {
      id: m.session_id,
      file: remotoDaqui ? '' : path.join(CLAUDE_PROJ, encodeCwd(claudeCwd.get(paneId) || HOME), m.session_id + '.jsonl'),
      remoto: !!remotoDaqui,
    });
    return;
  }
  if (m.type === 'result') {
    // turno acabou: pedido de permissao que sobrou nao vale mais
    descartarPermissoes(paneId);
    // e a conta de mensagem de cada sub-agente tambem morre aqui, senao o mapa
    // ganhava uma chave por Task e nunca soltava
    limparSeq(paneId);
    const u = m.usage || {};
    let janela = 0;
    try { const mu = m.modelUsage || {}; const k = Object.keys(mu)[0]; if (k) janela = mu[k].contextWindow || 0; } catch {}
    emit(paneId, 'tokens', {
      total: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0),
      janela: janela || undefined,
    });
    if (m.is_error) emit(paneId, 'note', { text: String(m.result || m.subtype), error: true });
    emit(paneId, 'turn-end', {});
  }
}

/* o que a ferramenta vai mudar no arquivo, pra desenhar o diff na tela.
   O dado ja vinha no input da ferramenta - era so' parar de jogar fora. */
const LIM_DIFF = 100 * 1024;
function mudancaDaFerramenta(name, inp, paneId) {
  if (!inp || typeof inp !== 'object') return null;
  // painel que roda no servidor: o arquivo nao esta neste disco
  const ehRemoto = paneId ? claudeRemoto.has(paneId) : false;
  const corta = (s) => { const t = String(s == null ? '' : s); return t.length > LIM_DIFF ? t.slice(0, LIM_DIFF) + '\n…(cortado)' : t; };
  const caminho = inp.file_path || inp.notebook_path || inp.path || '';
  if (name === 'Edit' && (inp.old_string !== undefined || inp.new_string !== undefined)) {
    return { path: caminho, antes: corta(inp.old_string), depois: corta(inp.new_string), tipo: 'edit' };
  }
  if (name === 'MultiEdit' && Array.isArray(inp.edits)) {
    return {
      path: caminho, tipo: 'multi',
      partes: inp.edits.slice(0, 20).map((e) => ({ antes: corta(e.old_string), depois: corta(e.new_string) })),
    };
  }
  if (name === 'Write' && inp.content !== undefined) {
    // arquivo que ja existe: le o conteudo atual pra mostrar o que SAI.
    // Sem isso, sobrescrever 2000 linhas aparecia como "+50, nada removido".
    let antes = '';
    let existia = false;
    // caminho de rede (\\servidor\...) pode demorar muito: nao vale travar o app
    const ehRede = /^\\\\/.test(String(caminho || ''));
    if (!ehRemoto && !ehRede) {
      try {
        if (caminho && fs.existsSync(caminho)) {
          const st = fs.statSync(caminho);
          if (st.isFile() && st.size <= LIM_DIFF) { antes = fs.readFileSync(caminho, 'utf8'); existia = true; }
          else if (st.isFile()) return { path: caminho, tipo: 'write-grande', depois: corta(inp.content), bytes: st.size };
        }
      } catch {}
    }
    // sem poder olhar o arquivo, nao afirma que e' novo
    const tipo = (ehRemoto || ehRede) ? 'write-incerto' : (existia ? 'write' : 'write-novo');
    return { path: caminho, antes: corta(antes), depois: corta(inp.content), tipo };
  }
  return null;
}

function claudeToolArg(name, inp) {
  if (!inp) return '';
  const v = inp.command || inp.file_path || inp.pattern || inp.query || inp.url || inp.description || inp.skill || inp.notebook_path;
  if (v) return String(v);
  try { return JSON.stringify(inp).slice(0, 160); } catch { return ''; }
}

/* ======================= arvore de arquivos ======================= */
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.cache', 'Library']);
function listDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return { error: e.message }; }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && !['.claude', '.codex', '.env.example'].includes(e.name)) continue;
    if (IGNORE.has(e.name)) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { continue; } }
    out.push({ name: e.name, dir: isDir, path: path.join(dir, e.name) });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries: out.slice(0, 800) };
}

/* ======================= conversas recentes ======================= */
const CLAUDE_PROJ = path.join(HOME, '.claude/projects');
const NOMES_PATH = () => path.join(app.getPath('userData'), 'nomes.json');
function lerNomes() { try { return JSON.parse(fs.readFileSync(NOMES_PATH(), 'utf8')); } catch { return {}; } }
function salvarNomes(o) { gravarSeguro(NOMES_PATH(), JSON.stringify(o)); }

ipcMain.handle('sessao:renomear', async (_e, { engine, id, nome }) => {
  const todos = lerNomes();
  if (nome && nome.trim()) todos[id] = nome.trim(); else delete todos[id];
  salvarNomes(todos);
  if (engine === 'codex' && id) {
    try { await codexStart(); await codexReq('thread/name/set', { threadId: id, name: nome || null }); } catch {}
  }
  return true;
});

/* procura um pedaço de texto dentro da conversa e devolve o trecho achado */
function acharNaConversa(file, alvo, engine) {
  try {
    const st = fs.statSync(file);
    const dados = st.size > 3 * 1024 * 1024 ? tailRead(file, 3 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
    const baixo = dados.toLowerCase();
    const i = baixo.indexOf(alvo);
    if (i < 0) return null;
    // acha a linha inteira e tenta extrair um texto legivel
    const ini = dados.lastIndexOf('\n', i) + 1;
    const fim = dados.indexOf('\n', i);
    const linha = dados.slice(ini, fim < 0 ? dados.length : fim);
    let trecho = '';
    try {
      const d = JSON.parse(linha);
      const pega = (c) => typeof c === 'string' ? c
        : Array.isArray(c) ? c.map(x => x && (x.text || x.thinking || '')).join(' ') : '';
      trecho = pega(d.message && d.message.content) || pega(d.payload && d.payload.content) || '';
    } catch {}
    if (!trecho) trecho = linha.replace(/\\[nrt]/g, ' ').replace(/[{}"\[\]]/g, ' ');
    const j = trecho.toLowerCase().indexOf(alvo);
    const de = Math.max(0, (j < 0 ? 0 : j) - 45);
    return (de > 0 ? '…' : '') + trecho.slice(de, de + 150).replace(/\s+/g, ' ').trim() + '…';
  } catch { return null; }
}

const respira = () => new Promise((r) => setImmediate(r));
ipcMain.handle('sessions:buscar', async (_e, { engine, termo, itens }) => {
  const alvo = String(termo || '').toLowerCase().trim();
  if (!alvo) return { achados: [], truncado: false };
  const achados = [];
  let truncado = false;
  let lidos = 0;
  // so as 400 mais recentes: passar de 5000 arquivos travava a lateral
  for (const it of (itens || []).slice(0, 400)) {
    if (!it.file) continue;
    // devolve o controle ao app a cada 10 arquivos: sem isso a janela inteira
    // congelava enquanto a busca lia centenas de megabytes
    if (++lidos % 10 === 0) await respira();
    try { if (fs.statSync(it.file).size > 3 * 1024 * 1024) truncado = true; } catch {}
    const t = acharNaConversa(it.file, alvo, engine);
    if (t) achados.push({ id: it.id, trecho: t });
    if (achados.length >= 40) break;
  }
  return { achados, truncado };
});

function tailRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
function headRead(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch { return ''; }
}

const ENTRADAS_DE_GENTE = ['claude-vscode', 'cockpit', 'cli', 'claude-code'];

const INDICE_PATH = () => path.join(app.getPath('userData'), 'indice-conversas.json');
let indice = null;
function lerIndice() { if (indice) return indice; try { indice = JSON.parse(fs.readFileSync(INDICE_PATH(), 'utf8')); } catch { indice = {}; } return indice; }
function gravarIndice() {
  try {
    // tira do indice o que aponta pra arquivo que nao existe mais, senao ele
    // cresce pra sempre com conversa apagada
    const ind = indice || {};
    for (const k of Object.keys(ind)) {
      try { if (!fs.existsSync(k)) delete ind[k]; } catch {}
    }
    gravarSeguro(INDICE_PATH(), JSON.stringify(ind));
  } catch {}
}

const PULAR_PASTA = new Set(['subagents', 'workflows']);

function varrerConversas(dir, achados, nivel) {
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of itens) {
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (PULAR_PASTA.has(e.name) || nivel > 4) continue;   // agentes internos nao sao conversa sua
      varrerConversas(p2, achados, nivel + 1);
    } else if (e.name.endsWith('.jsonl')) {
      try { const st = fs.statSync(p2); if (st.size > 300) achados.push({ f: p2, mtime: st.mtimeMs, size: st.size, id: e.name.replace('.jsonl', '') }); } catch {}
    }
  }
}

/* le titulo/pasta/entrada de um arquivo, guardando em indice para nao reler toda vez */
// so' a parte de texto (sem tocar em disco) - usada tanto pro arquivo local
// quanto pro conteudo que vem da VPS via SSH
function analisarCabecaCauda(head, tail) {
  const em = head.match(/"entrypoint":"([^"]*)"/);
  const entrada = em ? em[1] : '';

  let title = '';
  const tm = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
  if (tm.length) { try { title = JSON.parse('"' + tm[tm.length - 1][1] + '"'); } catch { title = tm[tm.length - 1][1]; } }

  let cwd = '';
  const cm = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  if (cm) { try { cwd = JSON.parse('"' + cm[1] + '"'); } catch { cwd = cm[1]; } }

  if (!title) {
    for (const linha of head.split('\n')) {
      if (!linha.includes('"type":"user"')) continue;
      try {
        const d = JSON.parse(linha);
        const c = d.message && d.message.content;
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x && x.text || '').join(' ') : '';
        if (t.trim() && !ehTecnico(t)) { title = limparTitulo(t.trim()).slice(0, 90); break; }
      } catch {}
    }
  }
  return { title, cwd, entrada };
}

function fichaConversa(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;
  const head = headRead(it.f, 64 * 1024);
  const tail = tailRead(it.f, 96 * 1024);
  const { title, cwd, entrada } = analisarCabecaCauda(head, tail);
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada };
  ind[it.f] = ficha;
  return ficha;
}

/* ---------- conversas do Claude que rodaram dentro de um servidor remoto ----------
   Elas gravam o .jsonl LA' dentro, nao aqui - por isso a lista da VPS precisa ir
   buscar por SSH, nao da pra so' olhar o disco local. Um comando so' traz tudo
   (path + data + conteudo em base64 de cada sessao recente), pra nao abrir uma
   conexao SSH por arquivo. */
function claudeSessionsRemoto(remoto) {
  return new Promise((resolve) => {
    if (!remoto || !remoto.host || !remoto.chave || !ssgValido(remoto)) return resolve([]);
    const script = "cd ~/.claude/projects 2>/dev/null && find . -name '*.jsonl' "
      + "-not -path '*/subagents/*' -not -path '*/workflows/*' -printf '%T@ %s %p\\n' 2>/dev/null "
      + "| sort -rn | head -80 | while IFS=' ' read -r mtime size path; do "
      + "tb=$(tail -c 65536 \"$path\" 2>/dev/null | base64 -w0); "
      + "hb=$(head -c 65536 \"$path\" 2>/dev/null | base64 -w0); "
      + "printf '%s|~|%s|~|%s|~|%s|~|%s\\n' \"$path\" \"$mtime\" \"$size\" \"$tb\" \"$hb\"; done";
    let proc;
    try {
      proc = spawnBin('ssh', ['-i', remoto.chave, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10', remoto.usuario + '@' + remoto.host, '--', script],
        { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve([]); }
    let out = '';
    const limite = setTimeout(() => { try { proc.kill(); } catch {} resolve([]); }, 25000);
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.stderr.on('data', () => {});
    proc.on('error', () => { clearTimeout(limite); resolve([]); });
    proc.on('close', () => {
      clearTimeout(limite);
      const nomesMeus = lerNomes();
      const out2 = [];
      for (const linha of out.split('\n')) {
        if (!linha) continue;
        const partes = linha.split('|~|');
        if (partes.length < 5) continue;
        const [pathRel, mtimeStr, sizeStr, tailB64, headB64] = partes;
        if ((Number(sizeStr) || 0) < 300) continue;
        let tail = '', head = '';
        try { tail = Buffer.from(tailB64, 'base64').toString('utf8'); } catch {}
        try { head = Buffer.from(headB64, 'base64').toString('utf8'); } catch {}
        const { title: tituloBruto, entrada } = analisarCabecaCauda(head, tail);
        if (entrada && !ENTRADAS_DE_GENTE.includes(entrada)) continue;
        const nomeArq = pathRel.split('/').pop() || pathRel;
        const id = nomeArq.replace(/\.jsonl$/, '');
        const title = nomesMeus[id] || tituloBruto;
        if (!title) continue;
        const mtimeMs = Math.round((parseFloat(mtimeStr) || 0) * 1000);
        out2.push({ engine: 'claude', id, title, cwd: remoto.caminhoRemoto || '~', when: mtimeMs,
          file: '', entrada, remoto: true });
      }
      out2.sort((a, b) => b.when - a.when);
      resolve(out2);
    });
  });
}

ipcMain.handle('sessions:claudeRemoto', async (_e, { remoto }) => {
  try { return await claudeSessionsRemoto(remoto); }
  catch (e) { return { error: String(e && e.message || e) }; }
});

function claudeSessions(limit, incluirRobos) {
  const achados = [];
  varrerConversas(CLAUDE_PROJ, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);

  const nomesMeus = lerNomes();
  const alvo = limit || 5000;
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    if (out.length >= alvo) break;
    const fi = fichaConversa(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ENTRADAS_DE_GENTE.includes(fi.entrada)) continue;
    let title = nomesMeus[it.id] || fi.title;
    if (!title) continue;
    out.push({ engine: 'claude', id: it.id, title, cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada });
  }
  if (lidos) gravarIndice();
  return out;
}

function claudeHistory(file, maxMsgs) {
  let data = '';
  try {
    const st = fs.statSync(file);
    // arquivos gigantes: le so o final
    data = st.size > 6 * 1024 * 1024 ? tailRead(file, 6 * 1024 * 1024) : fs.readFileSync(file, 'utf8');
  } catch { return []; }
  return mensagensDoJsonl(data, maxMsgs);
}

/* o mesmo parse serve pro arquivo local e pro conteudo que veio do servidor */
function mensagensDoJsonl(data, maxMsgs) {
  const msgs = [];
  for (const line of String(data || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
      t = (t || '').trim();
      if (t && !ehTecnico(t)) msgs.push({ role: 'user', text: semContexto(t) || t });
    } else if (d.type === 'assistant' && d.message) {
      const c = d.message.content || [];
      for (const x of c) {
        if (x.type === 'text' && x.text && x.text.trim()) msgs.push({ role: 'bot', text: x.text });
        else if (x.type === 'tool_use') msgs.push({ role: 'tool', name: x.name, arg: claudeToolArg(x.name, x.input) });
      }
    }
  }
  return msgs.slice(-(maxMsgs || 60));
}

function codexHistory(file, maxMsgs) {
  const msgs = [];
  let data = '';
  try { data = fs.readFileSync(file, 'utf8'); } catch { return msgs; }
  for (const line of data.split('\n')) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'response_item') continue;
    const p = d.payload || {};
    if (p.type === 'message') {
      if (p.role === 'developer' || p.role === 'system') continue;
      const t = (p.content || []).map(c => c.text || '').join('\n').trim();
      if (!t) continue;
      // pula o contexto tecnico que o Codex injeta como se fosse fala do usuario
      if (ehTecnico(t) || t.includes('<workspace_roots>')) continue;
      msgs.push({ role: p.role === 'user' ? 'user' : 'bot', text: p.role === 'user' ? (semContexto(t) || t) : t });
    } else if (p.type === 'function_call' || p.type === 'local_shell_call') {
      let arg = '';
      try { const a = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.action || p.arguments || {}); arg = a.command ? (Array.isArray(a.command) ? a.command.join(' ') : a.command) : JSON.stringify(a).slice(0, 120); } catch { arg = String(p.arguments || '').slice(0, 120); }
      msgs.push({ role: 'tool', name: p.name === 'shell' || p.type === 'local_shell_call' ? 'Terminal' : (p.name || 'Ferramenta'), arg });
    }
  }
  return msgs.slice(-(maxMsgs || 60));
}

ipcMain.handle('sessions:claude', (_e, incluirRobos) => claudeSessions(5000, incluirRobos));
const CODEX_SESS = path.join(HOME, '.codex/sessions');
const ORIGENS_DE_GENTE = ['cockpit', 'codex-tui', 'codex_tui', 'codex_vscode', 'codex-vscode', 'codex_app', 'codex-app', 'vscode'];

const TECNICO = /<recommended_plugins>|<environment_context>|<user_instructions>|<system-reminder>|<available_tools>|<plugins>|^Caveat:|^<[a-z_]+>/i;
const ehTecnico = (t) => !t || TECNICO.test(t.trim().slice(0, 400));

function semContexto(t) {
  if (!t) return t;
  const i = t.indexOf('Agora, o novo pedido:');
  if (i >= 0) return t.slice(i + 'Agora, o novo pedido:'.length).trim();
  const j = t.indexOf('Arquivos que anexei');
  if (j > 0) return t.slice(0, j).trim();
  return t;
}
const limparTitulo = (t) => (semContexto(t) || '').slice(0, 90);

function fichaCodex(it) {
  const ind = lerIndice();
  const salvo = ind[it.f];
  if (salvo && salvo.mtime === it.mtime && salvo.size === it.size) return salvo;

  let head = headRead(it.f, 96 * 1024);
  let id = '', cwd = '', origem = '', title = '', doAssistente = '';
  const varrer = (texto) => {
  for (const linha of texto.split('\n')) {
    if (!linha.startsWith('{')) continue;
    let d; try { d = JSON.parse(linha); } catch { continue; }
    if (d.type === 'session_meta') {
      const p2 = d.payload || {};
      id = p2.id || p2.session_id || '';
      cwd = p2.cwd || '';
      origem = p2.originator || p2.source || '';
      continue;
    }
    if (!title && d.type === 'response_item') {
      const p2 = d.payload || {};
      if (p2.type === 'message') {
        const t = (p2.content || []).map(c => c.text || '').join(' ').trim();
        if (p2.role === 'user' && t && !ehTecnico(t)) title = limparTitulo(t).slice(0, 90);
        else if (p2.role === 'assistant' && t && !doAssistente) doAssistente = t.slice(0, 90);
      }
    }
    if (title && id) return true;
  }
  return false;
  };
  if (!varrer(head) && it.size > 96 * 1024) varrer(fs.readFileSync(it.f, 'utf8'));   // arquivo grande: le tudo
  if (!title) title = doAssistente;                       // ao menos a primeira resposta
  if (!title) title = 'Conversa de ' + new Date(it.mtime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ficha = { mtime: it.mtime, size: it.size, title, cwd, entrada: origem, sid: id };
  ind[it.f] = ficha;
  return ficha;
}

function codexSessions(incluirRobos, nomesDoApp) {
  const achados = [];
  varrerConversas(CODEX_SESS, achados, 0);
  achados.sort((a, b) => b.mtime - a.mtime);
  const meus = lerNomes();
  const out = [];
  let lidos = 0;
  for (const it of achados) {
    const fi = fichaCodex(it);
    lidos++;
    if (!incluirRobos && fi.entrada && !ORIGENS_DE_GENTE.includes(fi.entrada)) continue;
    const id = fi.sid || it.id;
    const title = meus[id] || (nomesDoApp && nomesDoApp[id]) || fi.title;
    if (!title) continue;
    out.push({ engine: 'codex', id, title: title.slice(0, 120), cwd: fi.cwd || HOME, when: it.mtime, file: it.f, entrada: fi.entrada });
  }
  if (lidos) gravarIndice();
  return out;
}

ipcMain.handle('sessions:codex', async (_e, incluirRobos) => {
  // nomes que o proprio Codex guarda (renomeadas por lá)
  const nomesDoApp = {};
  try {
    await codexStart();
    const r = await codexReq('thread/list', { pageSize: 500 });
    for (const t of ((r && (r.data || r.threads)) || [])) if (t.name) nomesDoApp[t.id] = t.name;
  } catch {}
  try { return codexSessions(incluirRobos, nomesDoApp); }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle('sessions:titulo', (_e, { engine, file, id }) => {
  try {
    if (engine !== 'claude') return '';
    let f = file;
    if ((!f || !fs.existsSync(f)) && id) {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find(a => a.id === id);
      if (it) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return '';
    const tail = tailRead(f, 96 * 1024);
    const m = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
    if (!m.length) return '';
    try { return JSON.parse('"' + m[m.length - 1][1] + '"'); } catch { return m[m.length - 1][1]; }
  } catch { return ''; }
});

/* le o .jsonl de uma conversa que rodou no servidor. Procura pelo id em
   ~/.claude/projects e traz o conteudo em base64 (uma conexao so'). */
function claudeHistoryRemoto(remoto, id, maxMsgs) {
  return new Promise((resolve) => {
    if (!remoto || !id || !ssgValido(remoto)) return resolve([]);
    const idSeguro = String(id).replace(/[^\w-]/g, '');
    if (!idSeguro) return resolve([]);
    const script = "f=$(find ~/.claude/projects -name " + qLinux(idSeguro + '.jsonl')
      + " -print -quit 2>/dev/null); [ -n \"$f\" ] && tail -c 6000000 \"$f\" | base64 -w0";
    let proc;
    try {
      proc = spawnBin('ssh', ['-i', remoto.chave, '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        remoto.usuario + '@' + remoto.host, '--', script],
        { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return resolve([]); }
    let out = '';
    const limite = setTimeout(() => { try { proc.kill(); } catch {} resolve([]); }, 25000);
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.stderr.on('data', () => {});
    proc.on('error', () => { clearTimeout(limite); resolve([]); });
    proc.on('close', () => {
      clearTimeout(limite);
      const b64 = out.trim();
      if (!b64) return resolve([]);
      let texto = '';
      try { texto = Buffer.from(b64, 'base64').toString('utf8'); } catch { return resolve([]); }
      resolve(mensagensDoJsonl(texto, maxMsgs || 60));
    });
  });
}

ipcMain.handle('sessions:historyRemoto', async (_e, { remoto, id }) => {
  try { return await claudeHistoryRemoto(remoto, id, 60); }
  catch { return []; }
});

ipcMain.handle('sessions:history', (_e, { engine, file, id }) => {
  let f = file;
  // caminho salvo errado ou de outra maquina: procura pelo id da conversa
  if (engine === 'claude' && id && (!f || !fs.existsSync(f))) {
    const achados = [];
    varrerConversas(CLAUDE_PROJ, achados, 0);
    const it = achados.find(a => a.id === id);
    if (it) f = it.f;
  }
  if (!f || !fs.existsSync(f)) return [];
  return engine === 'claude' ? claudeHistory(f, 60) : codexHistory(f, 60);
});

/* ======================= comandos e skills ======================= */
function readSkillDirs(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (e.isDirectory()) {
        const f = path.join(d, e.name, 'SKILL.md');
        if (fs.existsSync(f)) out.push({ name: e.name, desc: skillDesc(f) });
      } else if (e.name.endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/, ''), desc: skillDesc(path.join(d, e.name)) });
      }
    }
  }
  return out;
}
function skillDesc(file) {
  const head = headRead(file, 1600);
  const m = head.match(/^description:\s*(.+)$/m);
  if (m) return m[1].replace(/^["']|["']$/g, '').slice(0, 140);
  const t = head.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('name:'));
  return (t || '').replace(/^#+\s*/, '').slice(0, 140);
}

let skillCache = { claude: null, codex: null };
let skillQuando = { claude: 0, codex: 0 };
const SKILL_VALE = 60 * 1000;   // um minuto: skill nova aparece sem reabrir o app
ipcMain.handle('skills:list', (_e, engine) => {
  if (skillCache[engine] && (Date.now() - skillQuando[engine]) < SKILL_VALE) return skillCache[engine];
  let dirs;
  if (engine === 'claude') {
    dirs = [path.join(HOME, '.claude/skills'), path.join(HOME, '.claude/commands')];
    // skills que vem de plugins
    const pc = path.join(HOME, '.claude/plugins/cache');
    try {
      for (const owner of fs.readdirSync(pc)) {
        const od = path.join(pc, owner);
        for (const plug of fs.readdirSync(od)) {
          const pd = path.join(od, plug);
          for (const ver of fs.readdirSync(pd)) {
            const sd = path.join(pd, ver, 'skills');
            if (fs.existsSync(sd)) dirs.push(sd);
          }
        }
      }
    } catch {}
  } else {
    dirs = [path.join(HOME, '.codex/skills'), path.join(HOME, '.codex/prompts'), path.join(HOME, '.agents/skills')];
  }
  const seen = new Set(); const out = [];
  for (const s of readSkillDirs(dirs)) { if (seen.has(s.name)) continue; seen.add(s.name); out.push(s); }
  out.sort((a, b) => a.name.localeCompare(b.name));
  skillCache[engine] = out; skillQuando[engine] = Date.now();
  return out;
});

/* ---------- conectores (MCP) ---------- */
function rodar(bin, args, timeout) {
  // spawnBin em vez de execFile porque no Windows o binario pode ser um .cmd,
  // que o Node se recusa a chamar direto desde a correcao de seguranca do Node 20
  return new Promise((res) => {
    let out = '', errout = '', acabou = false;
    const p = spawnBin(bin, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, timeout || 60000);
    const fim = (err) => { if (acabou) return; acabou = true; clearTimeout(t); res({ err, out, errout }); };
    p.stdout.on('data', (d) => { if (out.length < 4 * 1024 * 1024) out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { if (errout.length < 4 * 1024 * 1024) errout += d.toString('utf8'); });
    p.on('error', (e) => fim(e));
    p.on('close', (code) => fim(code === 0 ? null : new Error('saiu com código ' + code)));
  });
}
/* ---------- terminal embutido: roda no app, sem abrir o Terminal do sistema ----------
   Dá um terminal de verdade (pty) ao comando, assim as telinhas interativas
   (login, colar codigo) funcionam dentro do Cockpit. No Mac quem faz isso é o
   ptybridge.py; no Windows é o ConPTY. Quem escolhe é o plataforma.js.        */
const terms = new Map();
const PTY_BRIDGE = app.isPackaged
  ? path.join(process.resourcesPath, 'ptybridge.py')
  : path.join(__dirname, 'ptybridge.py');

function termEnviar(id, kind, data) {
  if (win && !win.isDestroyed()) win.webContents.send('term:event', { id, kind, ...data });
}

function termRodar({ id, linha, cols, rows }) {
  if (!id || !linha) return { error: 'faltou o comando' };
  termMatar(id);
  const c = Math.max(40, Math.min(400, Number(cols) || 100));
  const r = Math.max(10, Math.min(200, Number(rows) || 30));
  let p;
  try {
    p = abrirPty({
      linha, cols: c, rows: r, cwd: HOME, ptyBridge: PTY_BRIDGE,
      env: { ...buildEnv(), TERM: 'xterm-256color', COLUMNS: String(c), LINES: String(r) },
    });
  } catch (e) { return { error: e.message }; }
  terms.set(id, p);
  p.onData((d) => termEnviar(id, 'data', { data: d }));
  p.onErro((e) => termEnviar(id, 'data', { data: '\r\n[erro: ' + e.message + ']\r\n' }));
  // so' apaga se a entrada ainda for DESTE pty: o velho morrendo depois apagava
  // o terminal novo que ja tinha ocupado o mesmo id
  p.onFim((code) => { if (terms.get(id) === p) { terms.delete(id); termEnviar(id, 'exit', { code }); } });
  return { ok: true };
}

function termMatar(id) {
  const p = terms.get(id);
  if (!p) return { ok: true };
  terms.delete(id);
  p.matar();
  return { ok: true };
}

ipcMain.handle('term:run', (_e, o) => termRodar(o || {}));
ipcMain.handle('term:input', (_e, { id, data }) => {
  const p = terms.get(id);
  if (!p) return { error: 'esse terminal já fechou' };
  try { p.escrever(data); } catch (e) { return { error: e.message }; }
  return { ok: true };
});
ipcMain.handle('term:resize', (_e, { id, cols, rows }) => {
  const p = terms.get(id);
  if (!p) return { ok: true };
  p.redimensionar(Math.round(cols), Math.round(rows));
  return { ok: true };
});
ipcMain.handle('term:kill', (_e, { id }) => termMatar(id));

app.on('before-quit', () => { for (const id of [...terms.keys()]) termMatar(id); });

function alvoDoTransporte(t) {
  if (!t) return '';
  if (t.url) return t.url;
  const c = t.command;
  if (Array.isArray(c)) return c.join(' ');
  if (typeof c === 'string') return c + (Array.isArray(t.args) ? ' ' + t.args.join(' ') : '');
  return t.type || '';
}

ipcMain.handle('mcp:list', async (_e, engine) => {
  if (engine === 'codex') {
    const r = await rodar('codex', ['mcp', 'list', '--json'], 45000);
    try {
      const arr = JSON.parse(r.out);
      return arr.map(m => ({
        nome: m.name,
        alvo: alvoDoTransporte(m.transport),
        ligado: m.enabled !== false,
        precisaEntrar: m.auth_status === 'not_logged_in' && (m.transport || {}).type !== 'stdio',
        status: m.auth_status === 'logged_in' ? 'conectado'
          : m.auth_status === 'not_logged_in' ? 'precisa entrar' : (m.disabled_reason || 'ok'),
      }));
    } catch (e) { return { error: 'não consegui ler a lista do Codex: ' + String(e.message).slice(0, 160) }; }
  }
  const r = await rodar(CLAUDE_BIN, ['mcp', 'list'], 90000);
  const linhas = (r.out + '\n' + r.errout).split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of linhas) {
    const m = l.match(/^(.+?):\s+(\S+)\s+-\s+(.+)$/);
    if (!m) continue;
    const st = m[3];
    out.push({
      nome: m[1], alvo: m[2],
      ligado: true,
      precisaEntrar: /authentication|auth/i.test(st),
      status: /Connected/i.test(st) ? 'conectado' : /authentication/i.test(st) ? 'precisa entrar' : st.replace(/[✔✗!⏸]/g, '').trim(),
    });
  }
  return out;
});

ipcMain.handle('mcp:acao', async (_e, { engine, acao, nome, url, comando }) => {
  const bin = engine === 'claude' ? CLAUDE_BIN : 'codex';
  const cru = engine === 'claude' ? CLAUDE_BIN : acharBin('codex');
  const nomeBin = /[ ()]/.test(cru) ? '"' + cru + '"' : cru;
  if (acao === 'login' || acao === 'logout') {
    // roda no terminal embutido do Cockpit, sem abrir o Terminal do Mac
    // nome de conector e' texto de terceiro: so' aceita o que e' inofensivo em shell
    if (!/^[\w.@:-]{1,64}$/.test(String(nome || ''))) {
      return { error: 'Nome de conector com caractere não permitido: ' + String(nome).slice(0, 40) };
    }
    return { terminal: nomeBin + ' mcp ' + acao + ' ' + (EH_WIN ? '"' + nome + '"' : qLinux(nome)),
             titulo: (acao === 'login' ? 'Entrar no conector ' : 'Sair do conector ') + nome };
  }
  if (acao === 'remove') {
    const r = await rodar(bin, ['mcp', 'remove', nome], 30000);
    return r.err ? { error: (r.errout || r.err.message).slice(0, 300) } : { ok: true };
  }
  if (acao === 'add') {
    if (!nome) return { error: 'falta o nome' };
    let args;
    if (url) {
      args = engine === 'claude' ? ['mcp', 'add', '--transport', 'http', nome, url] : ['mcp', 'add', nome, '--url', url];
    } else if (comando) {
      const partes = comando.split(/\s+/).filter(Boolean);
      args = engine === 'claude' ? ['mcp', 'add', nome, '--', ...partes] : ['mcp', 'add', nome, '--', ...partes];
    } else return { error: 'informe o endereço ou o comando' };
    const r = await rodar(bin, args, 45000);
    return r.err ? { error: (r.errout || r.out || r.err.message).slice(0, 300) } : { ok: true };
  }
  return { error: 'ação desconhecida' };
});

/* ---------- audio virando texto, tudo aqui no PC ----------
   O navegador grava em webm; o ffmpeg converte pra wav 16k (o que o modelo
   espera) e o faster-whisper transcreve offline. Nada sai da maquina. */
const PY_TRANSCRICAO = path.join(HOME, 'venv-transcricao', 'Scripts', EH_WIN ? 'python.exe' : 'python');
const PASTA_AUDIO = () => path.join(app.getPath('userData'), 'audio');

function temTranscricao() {
  try { return fs.existsSync(PY_TRANSCRICAO); } catch { return false; }
}

ipcMain.handle('audio:disponivel', () => ({ ok: temTranscricao() }));

/* O modelo pesa ~460 MB e demora ~10s pra carregar. Carregar a cada ditado
   deixaria tudo lento, entao um processo fica vivo esperando: manda o caminho
   do wav numa linha, recebe o texto de volta na outra. */
const OUVINTE = [
  'import sys, json',
  'from faster_whisper import WhisperModel',
  'modelo = WhisperModel("small", device="cpu", compute_type="int8")',
  'print(json.dumps({"pronto": True}), flush=True)',
  'for linha in sys.stdin:',
  '    linha = linha.strip()',
  '    if not linha: continue',
  '    try:',
  '        pedido = json.loads(linha)',
  '    except Exception:',
  '        continue',
  '    ident = pedido.get("id")',
  '    try:',
  '        segs, _ = modelo.transcribe(pedido.get("wav"), language="pt", vad_filter=True)',
  '        texto = " ".join(s.text.strip() for s in segs).strip()',
  '        print(json.dumps({"id": ident, "texto": texto}), flush=True)',
  '    except Exception as e:',
  '        print(json.dumps({"id": ident, "erro": str(e)}), flush=True)',
].join('\n');

// cada pedido tem id proprio: casar por ordem quebrava quando um saia por timeout
const ouvinte = { proc: null, buf: '', pedidos: new Map(), seq: 0, pronto: false };

function ligarOuvinte() {
  if (ouvinte.proc || !temTranscricao()) return;
  try {
    // UTF-8 na marra: sem isso um caminho com acento derruba o Python, que
    // volta a subir e cai de novo, em loop
    ouvinte.proc = spawnBin(PY_TRANSCRICAO, ['-u', '-c', OUVINTE],
      { env: { ...buildEnv(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { ouvinte.proc = null; return; }
  ouvinte.proc.stdin.on('error', () => {});
  ouvinte.proc.stdout.on('data', (chunk) => {
    ouvinte.buf += chunk.toString('utf8');
    let i;
    while ((i = ouvinte.buf.indexOf('\n')) >= 0) {
      const linha = ouvinte.buf.slice(0, i).trim();
      ouvinte.buf = ouvinte.buf.slice(i + 1);
      if (!linha) continue;
      let o; try { o = JSON.parse(linha); } catch { continue; }
      if (o.pronto) { ouvinte.pronto = true; continue; }
      const espera = ouvinte.pedidos.get(o.id);
      if (espera) { ouvinte.pedidos.delete(o.id); espera(o); }
      // resposta de um pedido que ja desistiu: descarta, sem bagunçar os outros
    }
  });
  ouvinte.proc.stderr.on('data', () => {});
  const caiu = () => {
    ouvinte.proc = null; ouvinte.pronto = false; ouvinte.buf = '';
    for (const [, espera] of ouvinte.pedidos) espera({ erro: 'a transcrição parou' });
    ouvinte.pedidos.clear();
  };
  ouvinte.proc.on('close', caiu);
  ouvinte.proc.on('error', caiu);
}

function transcreverArquivo(wav) {
  return new Promise((resolve) => {
    ligarOuvinte();
    if (!ouvinte.proc) return resolve({ erro: 'não consegui iniciar a transcrição' });
    const id = 'a' + (++ouvinte.seq);
    const limite = setTimeout(() => {
      ouvinte.pedidos.delete(id);
      resolve({ erro: 'a transcrição demorou demais' });
    }, 300000);
    ouvinte.pedidos.set(id, (o) => { clearTimeout(limite); resolve(o); });
    try { ouvinte.proc.stdin.write(JSON.stringify({ id, wav }) + '\n'); }
    catch { clearTimeout(limite); ouvinte.pedidos.delete(id); resolve({ erro: 'não consegui falar com a transcrição' }); }
  });
}

ipcMain.handle('audio:aquecer', () => { ligarOuvinte(); return { ok: !!ouvinte.proc, pronto: ouvinte.pronto }; });

ipcMain.handle('audio:transcrever', async (_e, { bytes, mime }) => {
  if (!temTranscricao()) return { error: 'A transcrição ainda não está instalada nesta máquina.' };
  const dir = PASTA_AUDIO();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const marca = Date.now().toString(36);
  const bruto = path.join(dir, 'gravacao-' + marca + (String(mime || '').includes('ogg') ? '.ogg' : '.webm'));
  const wav = path.join(dir, 'gravacao-' + marca + '.wav');
  try {
    fs.writeFileSync(bruto, Buffer.from(bytes));
    // ffmpeg: mono 16 kHz, que e' o formato que o modelo espera
    const conv = await rodar('ffmpeg', ['-y', '-i', bruto, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], 120000);
    if (conv.err && !fs.existsSync(wav)) {
      return { error: 'Não consegui converter o áudio (ffmpeg): ' + String(conv.errout || '').slice(-200) };
    }
    const r = await transcreverArquivo(wav);
    if (r.erro) return { error: r.erro };
    const texto = String(r.texto || '').trim();
    if (!texto) return { error: 'Não entendi nada no áudio. Tente falar mais perto do microfone.' };
    return { texto };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally {
    // nao deixa audio acumulando no disco
    setTimeout(() => { try { fs.unlinkSync(bruto); } catch {} try { fs.unlinkSync(wav); } catch {} }, 2000);
  }
});

/* ---------- contas guardadas: trocar sem refazer login ----------
   Cada engine guarda a credencial num arquivo. Guardando uma copia por apelido,
   da' pra alternar entre contas ja logadas trocando o arquivo de volta. */
/* o Claude pode guardar a credencial em dois lugares no Windows; no Mac ela
   vive no Chaveiro e nao da' pra copiar como arquivo */
const CAMINHOS_CRED = {
  claude: [path.join(HOME, '.claude', '.credentials.json'), path.join(HOME, '.config', 'claude', '.credentials.json')],
  codex: [path.join(HOME, '.codex', 'auth.json')],
};
function arqCred(engine) {
  const lista = CAMINHOS_CRED[engine] || [];
  for (const p of lista) { try { if (fs.existsSync(p)) return p; } catch {} }
  return lista[0];
}
function trocaDeContaDisponivel(engine) {
  // no Mac a credencial do Claude fica no Chaveiro, nao em arquivo
  if (!EH_WIN && engine === 'claude') return false;
  try { return fs.existsSync(arqCred(engine)); } catch { return false; }
}
const ARQ_CRED = {
  claude: () => arqCred('claude'),
  codex: () => arqCred('codex'),
};
const PASTA_CONTAS = () => path.join(app.getPath('userData'), 'contas');

function lerCredencial(engine) {
  try { return fs.readFileSync(ARQ_CRED[engine](), 'utf8'); } catch { return null; }
}
function credencialValida(texto) {
  try { const o = JSON.parse(texto); return !!o && typeof o === 'object' && Object.keys(o).length > 0; }
  catch { return false; }
}

ipcMain.handle('contas:disponivel', (_e, engine) => ({ ok: trocaDeContaDisponivel(engine) }));

ipcMain.handle('contas:listar', (_e, engine) => {
  const dir = PASTA_CONTAS();
  const out = [];
  let atualTxt = lerCredencial(engine);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(engine + '__') || !f.endsWith('.json')) continue;
      const apelido = decodeURIComponent(f.slice((engine + '__').length, -5));
      let igualAtual = false;
      try { igualAtual = atualTxt !== null && fs.readFileSync(path.join(dir, f), 'utf8') === atualTxt; } catch {}
      out.push({ apelido, atual: igualAtual });
    }
  } catch {}
  return out;
});

/* o Codex mantem UM processo pra todos os paineis, com a credencial ja lida.
   Sem derrubar esse processo, trocar de conta nao muda nada.
   So' mata: quem limpa o estado e' o 'close' la de cima, que ja faz isso certo. */
ipcMain.handle('codex:reiniciar', async () => {
  const p = codex.proc;
  if (!p) { codex.ready = null; return { ok: true }; }
  const caiu = new Promise((r) => {
    const pronto = setTimeout(r, 4000);          // nao trava a interface se ele emperrar
    const fim = () => { clearTimeout(pronto); r(); };
    p.once('close', fim);
    // se o prazo vencer, o ouvinte tem que sair junto, senao vaza
    setTimeout(() => p.removeListener('close', fim), 4000);
  });
  matarProcesso(p);
  await caiu;
  if (codex.proc === p) codex.proc = null;
  codex.ready = null;
  // pelo prazo pode ter escapado sem passar pelo 'close': solta o ouvinte do
  // processo velho pra ele nao continuar despejando resposta na nossa fila
  try { p.stdout.removeAllListeners('data'); } catch {}
  codex.paneToThread.clear(); codex.threadToPane.clear(); codex.paneTurn.clear(); codex.paneMsgId.clear();
  return { ok: true };
});

ipcMain.handle('contas:salvar', (_e, { engine, apelido }) => {
  const txt = lerCredencial(engine);
  if (!txt || !credencialValida(txt)) return { error: 'Não achei uma conta logada para guardar.' };
  const nome = String(apelido || '').trim().slice(0, 40);
  if (!nome) return { error: 'Dê um apelido para esta conta.' };
  try {
    const dir = PASTA_CONTAS();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, engine + '__' + encodeURIComponent(nome) + '.json'), txt, { mode: 0o600 });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('contas:trocar', (_e, { engine, apelido }) => {
  const alvo = path.join(PASTA_CONTAS(), engine + '__' + encodeURIComponent(String(apelido || '')) + '.json');
  try {
    if (!fs.existsSync(alvo)) return { error: 'Essa conta não está mais guardada.' };
    const txt = fs.readFileSync(alvo, 'utf8');
    if (!credencialValida(txt)) return { error: 'O arquivo desta conta está corrompido — não vou trocar.' };
    const destino = ARQ_CRED[engine]();
    // guarda a de agora antes de trocar: se der errado, da' pra voltar
    const atual = lerCredencial(engine);
    let criouBackup = false;
    if (atual) { try { fs.writeFileSync(destino + '.antes-da-troca', atual, { mode: 0o600 }); criouBackup = true; } catch {} }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // grava em temporario e troca de uma vez: escrever direto podia pegar o
    // Claude no meio de uma renovacao de token e deixar o arquivo pela metade
    const tmp = destino + '.tmp';
    fs.writeFileSync(tmp, txt, { mode: 0o600 });
    try {
      fs.renameSync(tmp, destino);
      // deu certo: a copia com o token da OUTRA conta nao pode ficar no disco
      // (o backup de verdade e' a copia guardada em PASTA_CONTAS)
      if (criouBackup) { try { fs.unlinkSync(destino + '.antes-da-troca'); } catch {} }
    }
    catch (e) {
      // nao deixa arquivo com token perdido no disco: nem o temporario, nem o backup
      try { fs.unlinkSync(tmp); } catch {}
      if (criouBackup) { try { fs.unlinkSync(destino + '.antes-da-troca'); } catch {} }
      const cod = String(e && (e.code || e.message) || e);
      const porque = cod === 'EBUSY' || cod === 'EPERM' || cod === 'EACCES'
        ? 'o arquivo está em uso' : cod;
      return { error: 'Não consegui trocar a credencial agora (' + porque + '). Tente de novo.' };
    }
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('contas:esquecer', (_e, { engine, apelido }) => {
  try {
    fs.unlinkSync(path.join(PASTA_CONTAS(), engine + '__' + encodeURIComponent(String(apelido || '')) + '.json'));
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* ---------- conta e limite de uso ---------- */
// Mac: Chaveiro. Windows: arquivo de credenciais. Detalhe em plataforma.js
const tokenDoClaude = plataforma.tokenClaude;

async function usoDoClaude() {
  const t = tokenDoClaude();
  if (!t) return null;
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + t, 'anthropic-beta': 'oauth-2025-04-20' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

ipcMain.handle('conta:ler', async (_e, engine) => {
  if (engine === 'claude') {
    let conta = {};
    try { conta = JSON.parse((await rodar(CLAUDE_BIN, ['auth', 'status'], 25000)).out || '{}'); } catch {}
    const u = await usoDoClaude();
    const janela = (x) => x ? { pct: Math.round(x.utilization || 0), reseta: x.resets_at ? Date.parse(x.resets_at) : 0 } : null;
    return {
      entrou: !!conta.loggedIn,
      email: conta.email || '',
      nome: (conta.orgName || '').replace(/'s Organization$/, '') || conta.email || '',
      plano: conta.subscriptionType || '',
      via: conta.authMethod || '',
      sessao: u ? janela(u.five_hour) : null,
      semana: u ? janela(u.seven_day) : null,
      extra: u && u.extra_usage ? {
        ligado: !!u.extra_usage.is_enabled,
        usado: u.extra_usage.used_credits || 0,
        teto: u.extra_usage.monthly_limit || 0,
        moeda: u.extra_usage.currency || '',
      } : null,
    };
  }

  await codexStart();
  let conta = {}, lim = {};
  try { conta = await codexReq('account/read', {}); } catch {}
  try { lim = await codexReq('account/rateLimits/read', {}); } catch {}
  const rl = (lim && lim.rateLimits) || {};
  const jan = (x) => x ? { pct: Math.round(x.usedPercent || 0), reseta: (x.resetsAt || 0) * 1000, mins: x.windowDurationMins || 0 } : null;
  const a = jan(rl.primary), b = jan(rl.secondary);
  const curta = [a, b].find(x => x && x.mins && x.mins <= 1440) || null;
  const longa = [a, b].find(x => x && x.mins && x.mins > 1440) || null;
  const c = (conta && conta.account) || {};
  return {
    entrou: !!c.email,
    email: c.email || '',
    nome: c.email || '',
    plano: c.planType || rl.planType || '',
    via: c.type || '',
    sessao: curta,
    semana: longa,
    extra: rl.credits ? {
      ligado: !!rl.credits.hasCredits,
      usado: 0,
      teto: rl.credits.unlimited ? -1 : Number(rl.credits.balance || 0),
      moeda: 'créditos',
    } : null,
  };
});

ipcMain.handle('auth:acao', async (_e, { engine, acao }) => {
  const bin = engine === 'claude' ? CLAUDE_BIN : 'codex';
  const cmd = engine === 'claude'
    ? { login: 'auth login', logout: 'auth logout', status: 'auth status' }[acao]
    : { login: 'login', logout: 'logout', status: 'login status' }[acao];
  if (!cmd) return { error: 'ação desconhecida' };

  if (acao === 'status') {
    const r = await rodar(bin, cmd.split(' '), 25000);
    return { texto: String(r.out || r.errout || (r.err && r.err.message) || '').trim().slice(0, 800) };
  }
  // login e logout sao interativos: rodam no terminal embutido, dentro do Cockpit
  const alvo = engine === 'claude' ? CLAUDE_BIN : acharBin('codex');
  const linha = (/[ ()]/.test(alvo) ? '"' + alvo + '"' : alvo) + ' ' + cmd;
  return { terminal: linha,
           titulo: (acao === 'login' ? 'Entrar na conta do ' : 'Sair da conta do ') + (engine === 'claude' ? 'Claude' : 'Codex') };
});

ipcMain.handle('user:pickPhoto', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath: HOME,
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const f = r.filePaths[0];
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const b = fs.readFileSync(f);
    if (b.length > 3 * 1024 * 1024) return { error: 'Imagem muito pesada. Use uma menor que 3 MB.' };
    return { dataUrl: 'data:image/' + mime + ';base64,' + b.toString('base64') };
  } catch (e) { return { error: e.message }; }
});

const EXT_IMG = ['png','jpg','jpeg','gif','webp','bmp','heic','svg'];
/* o que estiver na area de transferencia: arquivos copiados no Finder ou imagem/print */
function arquivosColados() {
  const achados = [];
  try {
    const buf = clipboard.readBuffer('NSFilenamesPboardType');
    if (buf && buf.length) {
      const txt = buf.toString('utf8');
      for (const m of txt.matchAll(/<string>([^<]+)<\/string>/g)) achados.push(m[1]);
    }
  } catch {}
  // Explorer do Windows: o caminho vem em UTF-16, no formato FileNameW
  if (!achados.length && process.platform === 'win32') {
    for (const fmt of ['FileNameW', 'FileName']) {
      try {
        const b = clipboard.readBuffer(fmt);
        if (b && b.length) {
          const s = (fmt === 'FileNameW' ? b.toString('ucs2') : b.toString('utf8')).replace(/\0+$/, '').trim();
          if (s) { achados.push(s); break; }
        }
      } catch {}
    }
  }
  if (!achados.length) {
    for (const fmt of ['public.file-url', 'text/uri-list']) {
      try {
        const u = clipboard.read(fmt);
        if (u) for (const linha of String(u).split(/\r?\n/)) {
          const l = linha.trim();
          if (l.startsWith('file://')) achados.push(decodeURIComponent(l.replace(/^file:\/\//, '')));
        }
      } catch {}
    }
  }
  return [...new Set(achados)].filter(f => { try { return fs.existsSync(f); } catch { return false; } });
}

const EXT_VIS_IMG = ['png','jpg','jpeg','gif','webp','bmp','svg'];
ipcMain.handle('arquivo:ver', (_e, file) => {
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    if (EXT_VIS_IMG.includes(ext) && st.size <= 25 * 1024 * 1024) {
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      base.tipo = 'imagem';
      base.dados = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    } else if (st.size <= 600 * 1024 && /^(txt|md|json|js|ts|py|html|css|csv|log|sh|yml|yaml|toml|xml)$/.test(ext)) {
      base.tipo = 'texto';
      base.dados = fs.readFileSync(file, 'utf8');
    } else {
      base.tipo = 'outro';
    }
    return base;
  } catch (e) { return { erro: e.message, path: file, nome: path.basename(file) }; }
});

ipcMain.handle('clipboard:anexos', () => {
  const arquivos = arquivosColados();
  if (arquivos.length) return { arquivos };
  try {
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const dir = path.join(app.getPath('userData'), 'colados');
      fs.mkdirSync(dir, { recursive: true });
      const nome = 'colado-' + Date.now() + '.png';
      const destino = path.join(dir, nome);
      fs.writeFileSync(destino, img.toPNG());
      return { arquivos: [destino] };
    }
  } catch {}
  return { arquivos: [] };
});

ipcMain.handle('anexo:ler', (_e, file) => {
  try {
    const st = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const base = { path: file, nome: path.basename(file), ext, bytes: st.size };
    if (EXT_IMG.includes(ext) && st.size <= 8 * 1024 * 1024) {
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      base.mini = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    }
    return base;
  } catch (e) { return { path: file, nome: path.basename(file), erro: e.message }; }
});

ipcMain.handle('dialog:pickFiles', async (_e, kind) => {
  const opt = { properties: ['multiSelections'], defaultPath: HOME };
  if (kind === 'folder') opt.properties = ['openDirectory'];
  else opt.properties.push('openFile');
  if (kind === 'image') opt.filters = [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'] }];
  const r = await dialog.showOpenDialog(win, opt);
  return r.canceled ? [] : r.filePaths;
});

/* ======================= janela ======================= */
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  // recarregar a tela (Ctrl+R) recomeca os ids dos paineis; sem isso os
  // processos e terminais da sessao anterior ficavam orfaos rodando
  win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    // isInPlace = pulo de ancora (#secao) dentro da propria pagina: NAO e' recarga.
    // Sem esta checagem, clicar num "[ir pro topo](#x)" que o modelo escreveu
    // derrubava todos os paineis de uma vez.
    if (isMainFrame && !isInPlace) shutdown();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // clicar num link NUNCA troca a tela do app - nem pra arquivo local.
  // (navegar pra um html local reinjetaria o preload nele, dando acesso
  //  ao window.api inteiro, que sabe rodar comando)
  const barraNavegacao = (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', barraNavegacao);
  win.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame) e.preventDefault(); });
  win.on('closed', () => { win = null; shutdown(); });
}

function shutdown() {
  if (ouvinte.proc) { try { ouvinte.proc.kill(); } catch {} ouvinte.proc = null; }
  for (const id of [...terms.keys()]) termMatar(id);   // sem isso, cada recarga deixava um pty vivo
  for (const id of [...claudePanes.keys()]) claudeStop(id);
  // quem nao morreu com o SIGTERM vai no grito: sem isso ficava processo orfao
  for (const p of [...zumbis]) { try { p.kill('SIGKILL'); } catch {} }
  zumbis.clear();
  if (codex.proc) { matarProcesso(codex.proc); codex.proc = null; codex.ready = null; }
}

/* ======================= IPC ======================= */
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, c) => { saveConfig(c); return true; });
ipcMain.handle('sys:home', () => HOME);

ipcMain.handle('dialog:pickFolder', async (_e, start) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: start || HOME, title: 'Pasta de trabalho deste painel' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('fs:list', (_e, d) => listDir(d));

/* lista de arquivos da pasta do painel, pra completar o caminho quando voce
   digita "@" no campo. Guarda em memoria por 30s pra nao varrer o disco a
   cada tecla. */
const cacheArquivos = new Map();   // cwd -> { quando, lista }
function varrerArquivos(raiz, limite) {
  const achados = [];
  const fila = [raiz];
  let visitadas = 0;
  while (fila.length && achados.length < limite && visitadas < 4000) {
    const dir = fila.shift();
    visitadas++;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of itens) {
      if (e.name.startsWith('.') && !['.claude', '.codex', '.env.example'].includes(e.name)) continue;
      if (IGNORE.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (fila.length < 2000) fila.push(p); }
      else { achados.push(p); if (achados.length >= limite) break; }
    }
  }
  return achados;
}
ipcMain.handle('fs:buscarArquivos', (_e, { cwd, termo }) => {
  const raiz = cwd || HOME;
  const agora = Date.now();
  let c = cacheArquivos.get(raiz);
  if (!c || (agora - c.quando) > 30000) {
    c = { quando: agora, lista: varrerArquivos(raiz, 20000) };
    cacheArquivos.set(raiz, c);
    if (cacheArquivos.size > 8) cacheArquivos.delete(cacheArquivos.keys().next().value);
  }
  const alvo = String(termo || '').toLowerCase();
  if (!alvo) return c.lista.slice(0, 40).map((p) => ({ path: p, nome: path.basename(p) }));
  const pontua = (p) => {
    const nome = path.basename(p).toLowerCase();
    if (nome === alvo) return 0;
    if (nome.startsWith(alvo)) return 1;
    if (nome.includes(alvo)) return 2;
    if (p.toLowerCase().includes(alvo)) return 3;
    return 99;
  };
  return c.lista.map((p) => ({ p, s: pontua(p) })).filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.p.length - b.p.length).slice(0, 40)
    .map((x) => ({ path: x.p, nome: path.basename(x.p) }));
});

/* branch e arquivos mexidos da pasta do painel */
ipcMain.handle('git:status', async (_e, { cwd }) => {
  if (!cwd) return null;
  try { if (!fs.existsSync(path.join(cwd, '.git'))) return null; } catch { return null; }
  const r = await rodar('git', ['-C', cwd, '-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-b'], 8000);
  if (r.err) return null;
  const linhas = String(r.out || '').split('\n').filter(Boolean);
  let branch = '';
  const arquivos = [];
  for (const l of linhas) {
    if (l.startsWith('## ')) { branch = l.slice(3).split('...')[0].split(' ')[0]; continue; }
    const estado = l.slice(0, 2).trim();
    let nome = l.slice(3).trim();
    // rename vem como "antigo -> novo": interessa o novo
    const seta = nome.indexOf(' -> ');
    if (seta > 0) nome = nome.slice(seta + 4);
    if (nome) arquivos.push({ estado, nome });
  }
  return { branch, arquivos };
});

ipcMain.handle('git:diff', async (_e, { cwd, arquivo }) => {
  if (!cwd || !arquivo) return '';
  const r = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--', arquivo], 10000);
  if (r.err) {
    const r2 = await rodar('git', ['-C', cwd, 'diff', '--no-color', '--cached', '--', arquivo], 10000);
    return r2.err ? '' : String(r2.out || '').slice(0, 120000);
  }
  return String(r.out || '').slice(0, 120000);
});

/* apagar manda pra Lixeira (da' pra voltar atras) e limpa os registros */
ipcMain.handle('sessao:apagar', async (_e, { id, file }) => {
  try {
    let f = file;
    if (!f || !fs.existsSync(f)) {
      const achados = [];
      varrerConversas(CLAUDE_PROJ, achados, 0);
      const it = achados.find((a) => a.id === id);
      if (it) f = it.f;
    }
    if (!f || !fs.existsSync(f)) return { error: 'Não achei o arquivo desta conversa.' };
    await shell.trashItem(f);
    const ind = lerIndice(); delete ind[f]; gravarIndice();
    const nomes = lerNomes(); delete nomes[id]; salvarNomes(nomes);
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

/* exporta a conversa como .md legivel */
ipcMain.handle('sessao:exportar', async (_e, { engine, id, file, titulo, msgs }) => {
  try {
    let linhas = Array.isArray(msgs) ? msgs : null;
    let cortou = false;
    if (!linhas) {
      let f = file;
      if (!f || !fs.existsSync(f)) {
        const achados = [];
        varrerConversas(engine === 'codex' ? CODEX_SESS : CLAUDE_PROJ, achados, 0);
        const it = achados.find((a) => a.id === id);
        if (it) f = it.f;
      }
      if (!f || !fs.existsSync(f)) return { error: 'Não achei o arquivo desta conversa.' };
      linhas = engine === 'claude' ? claudeHistory(f, 5000) : codexHistory(f, 5000);
      try {
        const tamanho = fs.statSync(f).size;
        // o corte por bytes so' existe no Claude (tailRead); o Codex le tudo
        if (linhas.length >= 5000 || (engine === 'claude' && tamanho > 6 * 1024 * 1024)) cortou = true;
      } catch {}
    }
    const quem = engine === 'codex' ? 'Codex' : 'Claude';
    let md = '# ' + (titulo || 'Conversa') + '\n\n_exportado do Cockpit em ' + new Date().toLocaleString('pt-BR') + '_\n\n';
    if (cortou) md += '> ⚠️ Conversa longa: este arquivo tem só a parte final dela.\n\n';
    for (const x of linhas) {
      if (x.role === 'user') md += '\n## Você\n\n' + x.text + '\n';
      else if (x.role === 'bot') md += '\n## ' + quem + '\n\n' + x.text + '\n';
      else if (x.role === 'tool') md += '\n> `' + (x.name || 'ferramenta') + '` ' + (x.arg || '') + '\n';
    }
    const limpo = String(titulo || 'conversa').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('downloads'), limpo + '.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return { cancelado: true };
    fs.writeFileSync(r.filePath, md, 'utf8');
    return { ok: true, caminho: r.filePath };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
ipcMain.handle('fs:read', (_e, f) => {
  try {
    if (fs.statSync(f).size > 500 * 1024) return { error: 'Arquivo grande demais para ver aqui.' };
    return { content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('shell:open', (_e, p) => {
  const s = String(p || '');
  if (EXT_PERIGO_DIRETO.test(s)) return { error: 'Por segurança, o Cockpit não abre esse tipo de arquivo direto. Use o terminal se for mesmo isso.' };
  return shell.openPath(s);
});
// caminho vindo do texto do modelo: barra tudo que possa executar
const EXT_EXECUTAVEL = /\.(exe|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msc|cpl|reg|jar|app|command|sh|zsh)$/i;
// caminho que o usuario escolheu clicando na arvore: so' o que executa direto
const EXT_PERIGO_DIRETO = /\.(exe|bat|cmd|com|scr|vbs|vbe|wsf|wsh|msi|msc|cpl|reg|jar)$/i;
ipcMain.handle('shell:link', (_e, url) => {
  const s = String(url || '');
  if (/^https?:\/\//i.test(s)) return shell.openExternal(s);
  // nao e' link web: so' abre se for arquivo/pasta que existe E nao for executavel
  if (EXT_EXECUTAVEL.test(s)) return { error: 'Por segurança, o Cockpit não abre executável direto. Use o terminal se for mesmo isso que você quer.' };
  try { if (!fs.existsSync(s)) return { error: 'Caminho não encontrado.' }; } catch { return { error: 'Caminho inválido.' }; }
  return shell.openPath(s);
});
ipcMain.handle('shell:openUrl', (_e, u) => {
  if (!/^https?:\/\//i.test(String(u || ''))) return { error: 'link inválido' };
  shell.openExternal(u); return { ok: true };
});

ipcMain.handle('pane:start', async (_e, { paneId, engine, cwd, model, approval, resumeId, effort, remoto }) => {
  if (engine === 'claude') return claudeStart(paneId, { cwd, model, approval, resumeId, effort, remoto });
  await codexStart();
  // painel que ja tinha thread: sem apagar o vinculo velho, DUAS threads
  // ficavam apontando pro mesmo painel e a antiga nunca era interrompida
  const threadVelha = codex.paneToThread.get(paneId);
  if (threadVelha) codex.threadToPane.delete(threadVelha);
  if (resumeId) {
    const r = await codexReq('thread/resume', { threadId: resumeId });
    const rid = (r && (r.threadId || (r.thread && r.thread.id))) || resumeId;
    codex.threadToPane.set(rid, paneId);
    codex.paneToThread.set(paneId, rid);
    emit(paneId, 'sessao', { id: rid, file: (r && r.thread && r.thread.path) || '' });
    return true;
  }
  const pol = CODEX_MODE[approval] || CODEX_MODE.bypass;
  const res = await codexReq('thread/start', {
    cwd: cwd || HOME,
    sandbox: pol.sandbox,
    approvalPolicy: pol.policy,
    developerInstructions: instrucoesCasa(),
    ...(model ? { model } : {}),
  });
  const tid = res && (res.threadId || (res.thread && res.thread.id));
  if (!tid) throw new Error('Codex não devolveu a conversa');
  codex.threadToPane.set(tid, paneId);
  codex.paneToThread.set(paneId, tid);
  emit(paneId, 'sessao', { id: tid, file: (res.thread && res.thread.path) || '' });
  return true;
});

/* imagens vao dentro da mensagem; o resto continua indo como caminho no texto */
const MIME_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function blocosDeImagem(anexos) {
  const blocos = [], sobraram = [];
  for (const f of (anexos || [])) {
    const mime = MIME_IMG[path.extname(f).slice(1).toLowerCase()];
    if (!mime) { sobraram.push(f); continue; }
    try {
      if (fs.statSync(f).size > 4 * 1024 * 1024) { sobraram.push(f); continue; }  // pesada: vai o caminho
      blocos.push({ type: 'image', source: { type: 'base64', media_type: mime, data: fs.readFileSync(f).toString('base64') } });
    } catch { sobraram.push(f); }
  }
  return { blocos, sobraram };
}

ipcMain.handle('pane:send', async (_e, { paneId, engine, text, effort, anexos }) => {
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    if (!st) return false;
    const { blocos, sobraram } = blocosDeImagem(anexos);
    let t = text;
    // so' lista o que o renderer NAO listou (ele ja cola os nao-imagem no texto);
    // aqui entra apenas imagem que nao coube como imagem (>4MB)
    const jaNoTexto = t.includes('Arquivos que anexei');
    if (sobraram.length && !jaNoTexto) t += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + sobraram.map(f => '- ' + f).join('\n');
    else if (sobraram.length) t += '\n' + sobraram.map(f => '- ' + f).join('\n');
    const content = [...blocos, { type: 'text', text: t }];
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    return true;
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return false;
  // prazo longo: se o app-server so' responde quando o turno acaba, o padrao de
  // 30s dizia "falhou" com o trabalho ainda rodando na tela
  await codexReq('turn/start', { threadId: tid, input: [{ type: 'text', text }], ...(effort ? { effort } : {}) }, 15 * 60 * 1000);
  return true;
});

ipcMain.handle('pane:compactar', async (_e, { paneId, engine }) => {
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    if (!st) return { error: 'sessão fora do ar' };
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '/compact' }] } }) + '\n');
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  if (!tid) return { error: 'nenhuma conversa aberta' };
  // compactar chama o modelo: 30s nao da
  try { await codexReq('thread/compact/start', { threadId: tid }, 10 * 60 * 1000); return { ok: true }; }
  catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('pane:steer', async (_e, { paneId, engine, text }) => {
  if (engine === 'claude') {
    // o CLI aceita uma fala nova no meio do turno pelo mesmo canal
    const st = claudePanes.get(paneId);
    if (!st) return { error: 'sessão fora do ar' };
    st.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
    return { ok: true };
  }
  const tid = codex.paneToThread.get(paneId);
  const turno = codex.paneTurn.get(paneId);
  if (!tid || !turno) return { error: 'nenhum trabalho em andamento' };
  try {
    await codexReq('turn/steer', { threadId: tid, expectedTurnId: turno, input: [{ type: 'text', text }] });
    return { ok: true };
  } catch (e) { return { error: String(e && e.message || e) }; }
});

ipcMain.handle('pane:interrupt', async (_e, { paneId, engine }) => {
  if (engine === 'claude') {
    const st = claudePanes.get(paneId);
    if (st) st.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'i' + Date.now(), request: { subtype: 'interrupt' } }) + '\n');
    return true;
  }
  const tid = codex.paneToThread.get(paneId);
  const turn = codex.paneTurn.get(paneId);
  if (tid && turn) { try { await codexReq('turn/interrupt', { threadId: tid, turnId: turn }); } catch {} }
  return true;
});

ipcMain.handle('pane:stop', (_e, { paneId, engine }) => {
  if (engine === 'claude') claudeStop(paneId);
  else {
    const tid = codex.paneToThread.get(paneId);
    const turno = codex.paneTurn.get(paneId);
    // interrompe de verdade: sem isso o turno seguia rodando sem tela nenhuma
    if (tid && turno) { try { codexReq('turn/interrupt', { threadId: tid, turnId: turno }).catch(() => {}); } catch {} }
    codex.paneTurn.delete(paneId); codex.paneMsgId.delete(paneId);
    if (tid) { codex.threadToPane.delete(tid); codex.paneToThread.delete(paneId); }
  }
  // aprovacao que ficou pendurada NESTE painel: responde nao, senao a thread
  // do Codex fica esperando resposta pra sempre
  for (const [k, a] of [...pendingApprovals]) {
    if (!a || a.paneId !== paneId) continue;
    if (a.rpcId) { try { codexReply(a.rpcId, { decision: 'reject' }); } catch {} }
    pendingApprovals.delete(k);
  }
  return true;
});

ipcMain.handle('pane:autoLiberar', (_e, { paneId, tool }) => {
  if (!paneId || !tool) return false;
  if (!autoLiberadas.has(paneId)) autoLiberadas.set(paneId, new Set());
  autoLiberadas.get(paneId).add(tool);
  return true;
});

ipcMain.handle('pane:liberacoes', (_e, { paneId, limpar }) => {
  if (limpar) { autoLiberadas.delete(paneId); return []; }
  return [...(autoLiberadas.get(paneId) || [])];
});

ipcMain.handle('pane:approve', (_e, { key, allow }) => {
  const a = pendingApprovals.get(key);
  if (!a) return false;
  pendingApprovals.delete(key);
  if (a.kind === 'claude') {
    const st = claudePanes.get(a.paneId);
    if (st) st.proc.stdin.write(JSON.stringify({
      type: 'control_response',
      response: { request_id: a.reqId, subtype: 'success',
        response: allow ? { behavior: 'allow', updatedInput: a.input } : { behavior: 'deny', message: 'Negado por você' } },
    }) + '\n');
    return true;
  }
  codexReply(a.rpcId, { decision: allow ? 'acceptForSession' : 'reject' });
  return true;
});

ipcMain.handle('codex:models', async () => {
  try {
    await codexStart();
    const r = await codexReq('model/list', {});
    const arr = (r && (r.data || r.models || r)) || [];
    return arr.filter(m => !m.hidden).map(m => ({
      id: m.id || m.model,
      nome: m.displayName || m.id,
      desc: m.description || '',
      efforts: (m.supportedReasoningEfforts || []).map(e => ({ id: e.reasoningEffort, desc: e.description || '' })),
      padraoEffort: m.defaultReasoningEffort || 'medium',
      padrao: !!m.isDefault,
    }));
  } catch { return []; }
});

/* ======================= menu ======================= */
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Painel', submenu: [
      { label: 'Novo painel ao lado', accelerator: 'CmdOrCtrl+T', click: () => win && win.webContents.send('menu', 'newPane') },
      { label: 'Fechar painel', accelerator: 'CmdOrCtrl+W', click: () => win && win.webContents.send('menu', 'closePane') },
      { type: 'separator' },
      { label: 'Nova conversa', accelerator: 'CmdOrCtrl+N', click: () => win && win.webContents.send('menu', 'novaConversa') },
      { label: 'Buscar conversa…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.send('menu', 'buscarConversa') },
      { label: 'Escrever no painel', accelerator: 'CmdOrCtrl+L', click: () => win && win.webContents.send('menu', 'focarInput') },
      { type: 'separator' },
      { label: 'Painel seguinte', accelerator: 'Control+Tab', click: () => win && win.webContents.send('menu', 'painelProximo') },
      { label: 'Painel anterior', accelerator: 'Control+Shift+Tab', click: () => win && win.webContents.send('menu', 'painelAnterior') },
      { type: 'separator' },
      { label: 'Trocar pasta do painel…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('menu', 'pickFolder') },
      { label: 'Limpar conversa', accelerator: 'CmdOrCtrl+K', click: () => win && win.webContents.send('menu', 'clearPane') },
      { label: 'Parar o que está rodando (Esc)', click: () => win && win.webContents.send('menu', 'parar') },
    ]},
    { role: 'editMenu', label: 'Editar' },
    { label: 'Ver', submenu: [
      { label: 'Mostrar/ocultar arquivos', accelerator: 'CmdOrCtrl+B', click: () => win && win.webContents.send('menu', 'toggleSidebar') },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { role: 'reload', label: 'Recarregar' },
    ]},
    { role: 'windowMenu', label: 'Janela' },
  ]));
}

/* print colado vira arquivo em disco e nada nunca apagava */
function limparColadosAntigos() {
  try {
    const dir = path.join(app.getPath('userData'), 'colados');
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

/* a copia do settings virou UMA POR PAINEL (dois paineis subindo juntos liam o
   arquivo pela metade). Como o id do painel muda a cada abertura do app, as
   copias velhas se acumulariam pra sempre no userData. */
function limparSettingsAntigos() {
  try {
    const dir = app.getPath('userData');
    for (const f of fs.readdirSync(dir)) {
      if (!/^claude-settings-sem-bypass/.test(f)) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  } catch {}
}

if (EH_WIN) { try { app.setAppUserModelId('com.homeromotti.cockpit'); } catch {} }
app.whenReady().then(() => { menu(); createWindow(); limparColadosAntigos(); limparSettingsAntigos(); setTimeout(() => codexStart().catch(() => {}), 1500); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { shutdown(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', shutdown);
