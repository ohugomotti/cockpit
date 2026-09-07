/* Olha a tela DE VERDADE.

   Sobe o Cockpit desta pasta com a porta de depuração aberta, pergunta ao
   renderer o que ele desenhou e fecha. Serve para provar coisas que teste de
   função não prova: a chave de motor apareceu com todos os motores? O rótulo
   está com o nome certo? A tela subiu sem erro no console?

   Uso:  node testes/ver-na-tela.js
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const USERDATA = path.join(RAIZ, 'userdata-teste');
const PORTA = 9333;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function pegarJson(url) {
  return new Promise((ok, erro) => {
    http.get(url, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { erro(e); } });
    }).on('error', erro);
  });
}

/* fala o protocolo do DevTools na mão, para não depender de biblioteca */
function avaliar(wsUrl, expressao) {
  return new Promise((ok, erro) => {
    let WebSocket;
    const alt = require('path').join(__dirname, '..', 'src', 'node_modules', 'ws');
    try { WebSocket = require('ws'); } catch { try { WebSocket = require(alt); } catch { return erro(new Error('falta o pacote ws — rode: npm i ws dentro de src/')); } }
    const ws = new WebSocket(wsUrl);
    const prazo = setTimeout(() => { try { ws.close(); } catch {} erro(new Error('a tela não respondeu a tempo')); }, 20000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expressao, returnByValue: true, awaitPromise: true } })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.id !== 1) return;
      clearTimeout(prazo); try { ws.close(); } catch {}
      if (m.result && m.result.exceptionDetails) return erro(new Error(m.result.exceptionDetails.text + ' ' + JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || '')));
      ok(m.result && m.result.result && m.result.result.value);
    });
    ws.on('error', erro);
  });
}

(async function () {
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON nesta pasta (npm i electron dentro de src/)'); process.exit(2); }
  fs.mkdirSync(USERDATA, { recursive: true });
  const proc = spawn(ELECTRON, ['.', '--user-data-dir=' + USERDATA, '--remote-debugging-port=' + PORTA], { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'] });
  let erroDoApp = '';
  proc.stderr.on('data', (d) => { erroDoApp += d.toString('utf8'); });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(1000);
    try {
      const abas = await pegarJson('http://127.0.0.1:' + PORTA + '/json/list');
      alvo = abas.find((a) => a.type === 'page' && /index\.html/.test(a.url || ''));
    } catch {}
  }
  if (!alvo) {
    console.log('NÃO SUBIU. stderr:\n' + erroDoApp.slice(-1500));
    try { proc.kill(); } catch {}
    process.exit(1);
  }
  await esperar(3000);   // deixa o boot terminar

  /* Sem painel na tela nao da' para conferir a chave de motor. Cria um. */
  await avaliar(alvo.webSocketDebuggerUrl, `(() => {
    const bt = document.querySelector('#btnAddPane');
    if (bt) { bt.click(); return 'clicou'; }
    if (typeof novoPainel === 'function') { novoPainel(); return 'chamou'; }
    return 'nao achei como criar painel';
  })()`).then((r) => console.log('criar painel: ' + r)).catch((e) => console.log('criar painel falhou: ' + e.message));
  await esperar(2500);

  const relatorio = await avaliar(alvo.webSocketDebuggerUrl, `(async () => {
    const r = {};
    r.motoresNaTabela = (typeof MOTS !== 'undefined' ? MOTS : []).map(m => m.id + (m.instalado ? '' : ' (fora)'));
    r.botoesDaChave = [...document.querySelectorAll('.pane .p-chave .ch-lado')].map(b => b.dataset.motor);
    r.paineis = document.querySelectorAll('.pane').length;
    r.tituloBarra = (document.querySelector('#tbTitle') || {}).textContent || '';
    r.erros = (window.__errosDeTela || []);
    return JSON.stringify(r);
  })()`);

  console.log(relatorio);
  try { proc.kill(); } catch {}
  await esperar(1500);
  process.exit(0);
})().catch((e) => { console.log('ERRO: ' + e.message); process.exit(1); });
