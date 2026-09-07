/* O servidor MCP do Cockpit (pergunta-mcp.js) ganhou a ferramenta "plano".
   Sobe o servidor de verdade num processo, fala MCP por stdio e confere:
   as duas ferramentas na lista, o plano valido respondendo com o resumo,
   e o plano invalido voltando como erro (sem derrubar o servidor). */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { RAIZ } = require('./raiz');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plano-mcp-'));
const p = spawn(process.execPath, [path.join(RAIZ, 'src', 'pergunta-mcp.js')], {
  env: { ...process.env, COCKPIT_PERGUNTAS: tmp, COCKPIT_PAINEL: 'p9', COCKPIT_ESPERA_MS: '2000' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const respostas = new Map();
p.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!l) continue;
    try { const m = JSON.parse(l); if (m.id !== undefined) respostas.set(m.id, m); } catch {}
  }
});
const manda = (id, method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
const espera = (id, ms) => new Promise((res, rej) => {
  const t0 = Date.now();
  const olha = setInterval(() => {
    if (respostas.has(id)) { clearInterval(olha); res(respostas.get(id)); }
    else if (Date.now() - t0 > (ms || 5000)) { clearInterval(olha); rej(new Error('sem resposta pro id ' + id)); }
  }, 20);
});

let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

(async () => {
  try {
    manda(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const ini = await espera(1);
    checa('initialize responde', !!(ini.result && ini.result.serverInfo));
    manda(2, 'tools/list', {});
    const lst = await espera(2);
    const nomes = ((lst.result && lst.result.tools) || []).map((t) => t.name);
    checa('lista traz perguntar E plano', nomes.includes('perguntar') && nomes.includes('plano'), nomes.join(','));
    const plano = (lst.result.tools || []).find((t) => t.name === 'plano');
    checa('o schema do plano exige itens com texto e estado', !!(plano && plano.inputSchema && plano.inputSchema.required.includes('itens')
      && plano.inputSchema.properties.itens.items.required.join(',') === 'texto,estado'));
    checa('a descricao diz QUANDO usar (mais de 3 passos)', /3 passos/.test(plano.description));

    manda(3, 'tools/call', { name: 'plano', arguments: { itens: [
      { texto: 'ler o codigo', estado: 'feito' }, { texto: 'mexer', estado: 'fazendo' }, { texto: 'testar', estado: 'pendente' },
    ] } });
    const ok = await espera(3);
    const txt = ok.result && ok.result.content && ok.result.content[0] && ok.result.content[0].text;
    checa('plano valido responde com o resumo 1/3', !ok.result.isError && /1\/3/.test(txt || ''), JSON.stringify(ok).slice(0, 200));

    manda(4, 'tools/call', { name: 'plano', arguments: { itens: [] } });
    const ruim = await espera(4);
    checa('plano vazio volta como erro, sem derrubar', !!(ruim.result && ruim.result.isError));

    manda(5, 'tools/call', { name: 'plano', arguments: {} });
    const ruim2 = await espera(5);
    checa('sem "itens" tambem e erro', !!(ruim2.result && ruim2.result.isError));

    // o servidor continua vivo depois dos erros
    manda(6, 'tools/list', {});
    const lst2 = await espera(6);
    checa('servidor segue de pe', !!(lst2.result && lst2.result.tools));
  } catch (e) {
    checa('sem excecao', false, String(e && e.message || e));
  } finally {
    try { p.kill(); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-plano-mcp: tudo ok');
    process.exit(falhas ? 1 : 0);
  }
})();
