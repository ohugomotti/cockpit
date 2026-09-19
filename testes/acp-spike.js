/* Prova de viabilidade do ACP no Cockpit: fala JSON-RPC (Agent Client
   Protocol) com o `gemini --acp` DE VERDADE, ponta a ponta:
   initialize -> session/new -> session/prompt -> updates -> fim.
   Grava o trafego bruto em acp-log.jsonl como evidencia. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, 'acp-log.jsonl');
fs.writeFileSync(LOG, '');
const anota = (dir, obj) => fs.appendFileSync(LOG, JSON.stringify({ dir, t: Date.now(), obj }) + '\n');

/* o modo --acp nao le o ~/.gemini/.env sozinho (o CLI normal le): o adaptador
   precisa injetar a key no ambiente do processo */
const env = { ...process.env };
try {
  const dotenv = fs.readFileSync(path.join(process.env.USERPROFILE, '.gemini', '.env'), 'utf8');
  const m = dotenv.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
  if (m) env.GEMINI_API_KEY = m[1].trim();
} catch {}

const p = spawn('cmd.exe', ['/d', '/s', '/c', 'gemini --acp'], {
  cwd: process.env.USERPROFILE,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let id = 0;
const pend = new Map();
const updates = [];
const vistos = new Set();

const mandar = (method, params) => new Promise((res, rej) => {
  const meuId = ++id;
  const t = setTimeout(() => { pend.delete(meuId); rej(new Error('timeout em ' + method)); }, 200000);
  pend.set(meuId, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  const msg = { jsonrpc: '2.0', id: meuId, method, params };
  anota('->', msg);
  p.stdin.write(JSON.stringify(msg) + '\n');
});

p.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!linha) continue;
    let m; try { m = JSON.parse(linha); } catch { continue; }
    anota('<-', m);
    if (m.id !== undefined && m.method === undefined) {
      const q = pend.get(m.id);
      if (q) { pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
      continue;
    }
    if (m.method) {
      vistos.add(m.method);
      if (m.method === 'session/update') updates.push(m.params);
      // pedido do agente (permissao etc): responde o mais conservador
      if (m.id !== undefined) {
        anota('->', { resposta_automatica: m.method });
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }) + '\n');
      }
    }
  }
});
p.stderr.on('data', (d) => anota('stderr', d.toString('utf8').slice(0, 400)));

(async () => {
  try {
    const init = await mandar('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    console.log('INITIALIZE OK');
    console.log('  protocolVersion:', init && init.protocolVersion);
    console.log('  agentCapabilities:', JSON.stringify(init && init.agentCapabilities || {}).slice(0, 300));
    console.log('  authMethods:', JSON.stringify(init && init.authMethods || []).slice(0, 200));

    const sess = await mandar('session/new', { cwd: process.env.USERPROFILE, mcpServers: [] });
    console.log('SESSION/NEW OK  sessionId:', sess && sess.sessionId);

    const fim = await mandar('session/prompt', {
      sessionId: sess.sessionId,
      prompt: [{ type: 'text', text: 'Responda com uma única palavra: PONTE' }],
    });
    console.log('PROMPT OK  stopReason:', fim && fim.stopReason);

    const texto = updates
      .map((u) => u && u.update)
      .filter((u) => u && (u.sessionUpdate === 'agent_message_chunk'))
      .map((u) => (u.content && (u.content.text || (Array.isArray(u.content) ? u.content.map(c => c.text || '').join('') : ''))) || '')
      .join('');
    console.log('RESPOSTA DO AGENTE:', JSON.stringify(texto.trim().slice(0, 120)));
    console.log('TIPOS DE UPDATE VISTOS:', [...new Set(updates.map(u => u && u.update && u.update.sessionUpdate).filter(Boolean))].join(', ') || '(nenhum)');
    console.log('METODOS DO AGENTE VISTOS:', [...vistos].join(', '));
    console.log(texto.includes('PONTE') ? '\n=== VIABILIDADE: PROVADA ===' : '\n=== respondeu, mas sem a palavra esperada — ver acp-log.jsonl ===');
  } catch (e) {
    console.log('FALHOU:', e.message);
    console.log('metodos vistos ate aqui:', [...vistos].join(', '));
  } finally {
    try { p.kill(); } catch {}
    setTimeout(() => process.exit(0), 500);
  }
})();

