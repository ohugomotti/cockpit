/* Smoke test do protocolo contra o codex app-server DE VERDADE.
   Nao entra no `node --test`: precisa do Codex instalado e logado, e sobe um
   processo. Roda a mao antes de empacotar:  node tools/smoke-app-server.js
   Nao executa comando nenhum na maquina - so' abre conversa, le skills e Apps. */
const os = require('os');
const { spawnBin } = require('../src/plataforma');
const proto = require('../src/codex-protocol');

const HOME = os.homedir();
let id = 0;
const pend = new Map();
const notas = [];

const p = spawnBin('codex', ['app-server'], { cwd: HOME, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
p.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!linha) continue;
    let m; try { m = JSON.parse(linha); } catch { continue; }
    if (m.id !== undefined && m.method === undefined) {
      const d = pend.get(m.id); if (!d) continue;
      pend.delete(m.id);
      m.error ? d.rej(new Error(m.error.message || JSON.stringify(m.error))) : d.ok(m.result);
    } else if (m.method) notas.push(m.method);
  }
});

const req = (method, params, ms) => new Promise((ok, rej) => {
  const meu = ++id;
  const t = setTimeout(() => { pend.delete(meu); rej(new Error('sem resposta em ' + (ms || 20000) + 'ms')); }, ms || 20000);
  pend.set(meu, { ok: (v) => { clearTimeout(t); ok(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: meu, method, params }) + '\n');
});
const nota = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');


/* pega o id da ultima conversa gravada em ~/.codex/sessions */
function ultimaConversaDoDisco() {
  const fs = require('fs'), path = require('path');
  const raiz = path.join(HOME, '.codex', 'sessions');
  let melhor = null;
  const olhar = (dir, fundo) => {
    if (fundo > 5) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const cheio = path.join(dir, it.name);
      if (it.isDirectory()) { olhar(cheio, fundo + 1); continue; }
      const m = /^rollout-.*?-([0-9a-f-]{36})\.jsonl$/i.exec(it.name);
      if (!m) continue;
      let quando = 0;
      try { quando = fs.statSync(cheio).mtimeMs; } catch {}
      if (!melhor || quando > melhor.quando) melhor = { id: m[1], quando };
    }
  };
  olhar(raiz, 0);
  return melhor && melhor.id;
}

const passos = [];
const passo = async (nome, fn) => {
  try { const r = await fn(); passos.push(['ok', nome, r || '']); }
  catch (e) { passos.push(['falhou', nome, String((e && e.message) || e).slice(0, 200)]); }
};

(async () => {
  await passo('initialize', async () => {
    await req('initialize', { clientInfo: { name: 'cockpit-smoke', version: '1.0.0', title: 'Cockpit' }, capabilities: { experimentalApi: true } });
    nota('initialized', {});
    return 'handshake aceito';
  });

  let tid = '';
  await passo('thread/start com o modo Revisado', async () => {
    const { method, params } = proto.buildThreadOpenRequest({
      cwd: HOME, approval: 'revisado', developerInstructions: 'smoke test, nao faca nada',
    });
    if (method !== 'thread/start') throw new Error('montou o metodo errado: ' + method);
    const r = await req(method, params, 40000);
    tid = (r && (r.threadId || (r.thread && r.thread.id))) || '';
    if (!tid) throw new Error('nao devolveu threadId');
    if (r.approvalsReviewer !== 'auto_review') throw new Error('revisor nao aplicou: ' + r.approvalsReviewer);
    return tid + ' / revisor=' + r.approvalsReviewer;
  });

  await passo('thread/resume reaplicando "Sem pedir permissão"', async () => {
    /* retoma uma conversa REAL do historico: uma thread recem-criada ainda nao
       tem rollout em disco, e o app-server responde "no rollout found" - foi o
       que aconteceu na primeira versao deste teste */
    const antiga = ultimaConversaDoDisco();
    if (antiga) tid = antiga;
    if (!tid) throw new Error('sem thread pra retomar');
    const { method, params } = proto.buildThreadOpenRequest({
      resumeId: tid, cwd: HOME, approval: 'bypass', developerInstructions: 'smoke test',
    });
    if (method !== 'thread/resume') throw new Error('montou o metodo errado: ' + method);
    const r = await req(method, params, 40000);
    if (r.approvalPolicy !== 'never') throw new Error('o modo nao foi aplicado na retomada: ' + r.approvalPolicy);
    return 'approvalPolicy=' + r.approvalPolicy;
  });

  await passo('skills/list', async () => {
    const r = await req('skills/list', { cwds: [HOME] }, 25000);
    const s = proto.normalizeSkillsResponse(r, HOME);
    return s.length + ' skills (ex.: ' + s.slice(0, 3).map((x) => x.name).join(', ') + ')';
  });

  await passo('app/list + app/installed', async () => {
    const lista = await req('app/list', {}, 25000).catch((e) => ({ __erro: String(e.message) }));
    const inst = await req('app/installed', {}, 25000).catch((e) => ({ __erro: String(e.message) }));
    const apps = proto.mergeApps(lista.__erro ? null : lista, inst.__erro ? null : inst);
    if (lista.__erro && inst.__erro) return 'os dois recusaram (' + lista.__erro.slice(0, 60) + ') - a tela mostra o recado';
    return apps.length + ' apps; erro em app/list: ' + (lista.__erro || 'nenhum');
  });

  console.log('\n--- smoke do app-server ---');
  for (const [st, nome, det] of passos) console.log((st === 'ok' ? '  OK   ' : '  FALHOU ') + nome + (det ? '  ->  ' + det : ''));
  const ruins = passos.filter((x) => x[0] !== 'ok').length;
  console.log(ruins ? '\n' + ruins + ' passo(s) falharam' : '\ntudo passou');
  try { p.kill(); } catch {}
  process.exit(ruins ? 1 : 0);
})();
