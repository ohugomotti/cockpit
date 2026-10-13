// Rodada 1 (caminhos vitais) da leva 5: candidato + copia do perfil. Abre, confere config x tela, grava, confere o disco.
// Rodada 2 da leva 5i: a copia nasce SEM conversas (0 paineis e' o esperado: a sonda nao espera mais um campo de escrever) e a sonda confere a trava
// da janela de teste (titulo, faixa vermelha, window.api.janelaDeTeste). Sai com 0 (tudo bate), 4 (algo nao bate), 3 (sem a trava) ou 2 (sem pagina).
const fs = require('fs'); const path = require('path');
const { conferirRodada1, CODIGO_SEM_TRAVA } = require('./conferir-rodada1.cjs');
const port = Number(process.argv[2] || 9358);
const perfil = process.argv[3];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// o que a copia do perfil diz ANTES de o candidato mexer em qualquer coisa: e' o que a tela e o disco tem que repetir
function esperadoDoPerfil() {
  const cfg = JSON.parse(fs.readFileSync(path.join(perfil, 'config.json'), 'utf8'));
  const paineis = (Array.isArray(cfg.abas) ? cfg.abas : []).reduce((n, a) => n + (a && Array.isArray(a.paineis) ? a.paineis.length : 0), 0) + (Array.isArray(cfg.panes) ? cfg.panes.length : 0);
  return { abas: Array.isArray(cfg.abas) ? cfg.abas.length : null, tema: cfg.tema ?? null, visualMac: !!cfg.visualMac, paineis };
}
(async () => {
  const t0 = Date.now();
  const esperado = esperadoDoPerfil();
  let page;
  for (let i = 0; i < 300 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1500) })).json();
      page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
    } catch {}
    if (!page) await delay(200);
  }
  if (!page) { console.log('SEM PAGINA'); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let seq = 0; const pend = new Map(); const erros = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') erros.push('EXC ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erros.push('CONSOLE ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') erros.push('LOG ' + String(m.params.entry.text).slice(0, 300));
  });
  const cmd = (method, params = {}, ms = 20000) => new Promise((res) => { const id = ++seq; const t = setTimeout(() => { pend.delete(id); res({ timeout: true }); }, ms); pend.set(id, (m) => { clearTimeout(t); res(m); }); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable'); await cmd('Log.enable');
  const ev = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.timeout) return { erro: 'timeout' };
    if (r.result?.exceptionDetails) return { erro: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  /* pronto = o config chegou a tela E ela terminou de montar: com conversa salva, o campo de escrever; sem nenhuma (a copia da janela de teste), a tela
     de abertura (#boasvindas). Esperar so' o campo de escrever travaria 30 s e seguiria sem "pronto". */
  let pronto = false;
  for (let i = 0; i < 150 && pronto !== true; i++) { pronto = await ev("typeof cfg === 'object' && !!cfg && (document.querySelectorAll('.p-input').length > 0 || !!document.getElementById('boasvindas'))"); if (pronto !== true) await delay(200); }
  const tPronto = Date.now() - t0;
  await delay(2500);
  const tela = await ev(`(() => ({
    abas: Array.isArray(cfg.abas) ? cfg.abas.length : null,
    abaAtiva: cfg.abaAtiva ?? null,
    tema: cfg.tema ?? null,
    visualMac: !!cfg.visualMac,
    htmlMac: document.documentElement.classList.contains('visual-mac'),
    torre: cfg.uiTorreAltura ?? null,
    paineis: document.querySelectorAll('.p-input').length,
    aberturaVisivel: !!document.getElementById('boasvindas'),
    grupos: document.querySelectorAll('.ck-group').length,
    iconesPasta: document.querySelectorAll('.ck-group-icon:not([hidden])').length,
    maisColunas: !!document.querySelector('.ck-mais-colunas'),
    erroSalvar: document.body.innerText.includes('Reabra o Cockpit')
  }))()`);
  console.log('TELA ' + JSON.stringify({ pronto, tPronto, tela }));
  // a trava da janela de teste: o titulo, a faixa vermelha do topo e a flag que o preload entrega
  const trava = await ev("({ api: !!(window.api && window.api.janelaDeTeste === true), titulo: document.title, faixa: !!document.getElementById('faixa-janela-teste') })");
  console.log('TRAVA ' + JSON.stringify(trava));
  const lerJson = (f) => { try { const t = fs.readFileSync(f, 'utf8'); const j = JSON.parse(t); return { bytes: t.length, abas: Array.isArray(j.abas) ? j.abas.length : null, tema: j.tema, torre: j.uiTorreAltura ?? null }; } catch (e) { return { erro: e.code || e.message }; } };
  const cfgArq = path.join(perfil, 'config.json');
  const antes = fs.readFileSync(cfgArq, 'utf8');
  const g = await ev("window.api.setConfig(cfg).then((r) => ({ ok: true, r: r ?? null }), (e) => ({ ok: false, e: String(e) }))");
  await delay(1000);
  const disco = { config: lerJson(cfgArq), bak: lerJson(cfgArq + '.bak'), outros: fs.readdirSync(perfil).filter((n) => /^config\.json\./.test(n) && n !== 'config.json.bak') };
  console.log('GRAVOU ' + JSON.stringify({ g, disco, mudouNoDisco: antes !== fs.readFileSync(cfgArq, 'utf8') }));
  console.log('ERROS ' + erros.length); for (const e of erros.slice(0, 12)) console.log('  ' + e);
  const veredito = conferirRodada1(esperado, { tela, trava, gravou: g, disco, erros });
  console.log('ESPERADO ' + JSON.stringify(esperado));
  console.log('CONFERE ' + JSON.stringify({ ok: veredito.ok, falhas: veredito.falhas }));
  process.exit(veredito.semTrava ? CODIGO_SEM_TRAVA : veredito.ok ? 0 : 4);
})().catch((e) => { console.log('ERRO', e.message); process.exit(1); });
