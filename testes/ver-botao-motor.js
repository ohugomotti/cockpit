/* Abre o Cockpit numa janela SEPARADA (dados próprios, não encosta no que você
   está usando) já com os cinco motores na tela, pra você OLHAR o botão novo da
   leva 39. De quebra, guarda um print de cada tema em prints/.

   A janela fica aberta: feche no X quando terminar.

   Uso:  node testes/ver-botao-motor.js
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const USERDATA = path.join(RAIZ, 'userdata-ver-motor');   // propria: o teste usa a dele
const PORTA = 9337;
const NL = String.fromCharCode(10);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function pegarJson(url) {
  return new Promise((ok, erro) => {
    http.get(url, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { erro(e); } });
    }).on('error', erro);
  });
}

function abrirCdp(wsUrl) {
  let WebSocket;
  try { WebSocket = require('ws'); } catch { WebSocket = require(path.join(SRC, 'node_modules', 'ws')); }
  const ws = new WebSocket(wsUrl);
  let seq = 100;
  const esperando = new Map();
  const pronto = new Promise((ok, erro) => { ws.on('open', ok); ws.on('error', erro); });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = esperando.get(m.id);
    if (p) { esperando.delete(m.id); p(m); }
  });
  const mandar = (method, params) => new Promise((ok, erro) => {
    const id = ++seq;
    const prazo = setTimeout(() => { esperando.delete(id); erro(new Error('sem resposta de ' + method)); }, 30000);
    esperando.set(id, (m) => {
      clearTimeout(prazo);
      if (m.error) return erro(new Error(method + ': ' + JSON.stringify(m.error)));
      ok(m.result);
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const avaliar = async (expr) => {
    const r = await mandar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r && r.result && r.result.value;
  };
  return { mandar, avaliar, pronto };
}

/* O captureScreenshot nao respondia nunca com a janela atras de outra: sem
   surface visivel o Chromium fica esperando um quadro que nao vem. Ligar o
   setDeviceMetricsOverride antes obriga ele a compor num surface proprio, fora
   da tela, e ai a captura volta na hora. (E capturar a TELA do Windows nao
   serve: pega o que estiver por cima, que e' o trabalho de quem esta usando.) */
async function foto(cdp, nome) {
  try {
    await cdp.mandar('Emulation.setDeviceMetricsOverride',
      { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    const r = await cdp.mandar('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await cdp.mandar('Emulation.clearDeviceMetricsOverride');
    const destino = path.join(RAIZ, 'prints', nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(r.data, 'base64'));
    console.log('  print -> ' + destino);
    return true;
  } catch (e) { console.log('  print falhou: ' + e.message); return false; }
}

(async function () {
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON (npm i electron dentro de src/)'); process.exit(2); }
  fs.rmSync(USERDATA, { recursive: true, force: true });
  fs.mkdirSync(USERDATA, { recursive: true });

  const proc = spawn(ELECTRON, ['.', '--user-data-dir=' + USERDATA, '--remote-debugging-port=' + PORTA],
    { cwd: SRC, detached: true, stdio: 'ignore' });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(1000);
    try {
      const abas = await pegarJson('http://127.0.0.1:' + PORTA + '/json/list');
      alvo = abas.find((a) => a.type === 'page' && /index\.html/.test(a.url || ''));
    } catch {}
  }
  if (!alvo) { console.log('NAO SUBIU'); process.exit(1); }

  const cdp = abrirCdp(alvo.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.mandar('Page.enable');
  await esperar(3500);

  console.log('Montando um painel de cada motor…');
  await cdp.avaliar(`(async () => {
    for (const eng of ['claude', 'codex', 'gemini', 'grok', 'acp']) {
      if ([...panes.values()].length >= 5) break;
      const P = newPane({ engine: eng });
      P.engine = eng; paintEngine(P);
    }
    // o primeiro painel nasce antes do laço: garante que ele também tem motor
    const todos = [...panes.values()];
    ['claude','codex','gemini','grok','acp'].forEach((eng, i) => {
      if (todos[i]) { todos[i].engine = eng; paintEngine(todos[i]); }
    });
    montarColunas();
    await new Promise(r => setTimeout(r, 600));
    return todos.length;
  })()`);

  for (const tema of ['escuro', 'claro', 'jornal']) {
    await cdp.avaliar(`document.documentElement.setAttribute('data-tema', '${tema}')`);
    await esperar(700);
    console.log(NL + 'tema ' + tema);
    await foto(cdp, 'leva39-tema-' + tema + '.png');
  }

  // volta pro escuro e abre a lista, que é o ponto da leva
  await cdp.avaliar(`document.documentElement.setAttribute('data-tema', 'escuro')`);
  await esperar(500);
  await cdp.avaliar(`(() => { const P = [...panes.values()][0]; P.el.querySelector('.p-motor').click(); })()`);
  await esperar(600);
  console.log(NL + 'menu aberto num painel Claude');
  await foto(cdp, 'leva39-menu-aberto.png');

  console.log(NL + 'A janela ficou ABERTA pra você olhar. Feche no X quando terminar.');
  proc.unref();
  process.exit(0);
})();
