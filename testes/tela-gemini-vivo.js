/* Manda uma mensagem DE VERDADE pro Gemini pelo caminho do app.

   Tudo que veio antes provava a tela; isto prova o motor: painel Gemini nasce,
   a mensagem sai pela caixa de texto, o main sobe o processo do gemini, a
   resposta volta em bolha e o painel destrava. So roda se houver chave em
   ~/.gemini/.env (senao pula, sem fingir sucesso).

   Uso:  node testes/tela-gemini-vivo.js [caminho/do/app.asar]
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORTA = 9335;
const NL = String.fromCharCode(10);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
function checa(nome, cond, det) {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
}

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
  let id = 0;
  const esperando = new Map();
  const erros = [];
  const pronto = new Promise((ok, erro) => { ws.on('open', ok); ws.on('error', erro); });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.id && esperando.has(m.id)) { esperando.get(m.id)(m); esperando.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      erros.push('[excecao] ' + ((d && d.exception && d.exception.description) || (d && d.text) || '?'));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
      erros.push('[console] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  });
  const mandar = (method, params) => new Promise((ok, erro) => {
    const meu = ++id;
    const prazo = setTimeout(() => erro(new Error('sem resposta de ' + method)), 30000);
    esperando.set(meu, (m) => {
      clearTimeout(prazo);
      if (m.error) return erro(new Error(method + ': ' + m.error.message));
      ok(m.result);
    });
    ws.send(JSON.stringify({ id: meu, method, params: params || {} }));
  });
  const avaliar = async (expr) => {
    const r = await mandar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result && r.result.value;
  };
  return { pronto, mandar, avaliar, erros, fechar: () => { try { ws.close(); } catch {} } };
}

async function foto(cdp, nome) {
  try {
    const r = await cdp.mandar('Page.captureScreenshot', { format: 'png' });
    const destino = path.join(RAIZ, 'prints', nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(r.data, 'base64'));
    console.log('  print -> ' + destino);
  } catch (e) { console.log('  print falhou: ' + e.message); }
}

(async function () {
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON nesta pasta (npm i electron dentro de src/)'); process.exit(2); }
  const envGemini = path.join(os.homedir(), '.gemini', '.env');
  if (!fs.existsSync(envGemini) || !/GEMINI_API_KEY=/.test(fs.readFileSync(envGemini, 'utf8'))) {
    console.log('SEM CHAVE em ~/.gemini/.env - teste pulado (nao ha como falar com o Gemini).');
    process.exit(2);
  }

  const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-vivo-'));
  const APP = process.argv[2] || '.';
  console.log('rodando: ' + APP);
  const proc = spawn(ELECTRON, [APP, '--user-data-dir=' + USERDATA, '--remote-debugging-port=' + PORTA],
    { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'] });
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
    console.log('NAO SUBIU. stderr:' + NL + erroDoApp.slice(-1200));
    try { proc.kill(); } catch {}
    process.exit(1);
  }

  const cdp = abrirCdp(alvo.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.mandar('Runtime.enable');
  await cdp.mandar('Page.enable');
  await esperar(4000);

  try {
    console.log(NL + 'Painel Gemini nasce e a mensagem sai pela caixa de texto');
    const inicio = JSON.parse(await cdp.avaliar(`(async () => {
      const bt = document.querySelector('.bv-bt[data-motor="gemini"]');
      if (bt) bt.click();
      await new Promise(r => setTimeout(r, 1200));
      const P = focusPane;
      if (!P) return JSON.stringify({ ok: false, motivo: 'sem painel' });
      const inp = P.el.querySelector('.p-input');
      inp.value = 'responda apenas com a palavra PONTE';
      P.el.querySelector('.p-send').click();
      await new Promise(r => setTimeout(r, 800));
      return JSON.stringify({ ok: true, engine: P.engine, busy: P.busy });
    })()`));
    checa('o painel e do Gemini e ficou trabalhando', inicio.ok && inicio.engine === 'gemini' && inicio.busy === true, JSON.stringify(inicio));

    console.log(NL + 'A resposta volta de verdade (espera ate 120s)');
    let fim = null;
    for (let i = 0; i < 60; i++) {
      await esperar(2000);
      fim = JSON.parse(await cdp.avaliar(`(() => {
        const P = focusPane || {};
        const bolhas = P.el ? [...P.el.querySelectorAll('.msg-body')].map(e => (e.textContent || '').trim()) : [];
        const notas = P.el ? [...P.el.querySelectorAll('.note')].map(e => (e.textContent || '').trim()) : [];
        return JSON.stringify({ busy: !!P.busy, bolhas, notas: notas.slice(-2), sessaoId: P.sessaoId || '', tokens: P.tokens || 0 });
      })()`));
      if (!fim.busy && (fim.bolhas.some((b) => /PONTE/.test(b)) || fim.notas.length)) break;
    }
    await foto(cdp, 'gemini-vivo.png');
    checa('a resposta do Gemini apareceu em bolha',
      fim.bolhas.some((b) => /PONTE/.test(b) && !/responda apenas/.test(b)), JSON.stringify(fim.bolhas.slice(-3)));
    checa('o painel destravou (nao ficou "trabalhando" pra sempre)', fim.busy === false, 'busy=' + fim.busy);
    checa('a sessao ganhou endereco (da pra retomar depois)', !!fim.sessaoId, JSON.stringify(fim.sessaoId));
    checa('o contador de contexto mexeu', fim.tokens > 0, String(fim.tokens));

    console.log(NL + 'A conversa ficou gravada onde a lista le');
    const raizTmp = path.join(os.homedir(), '.gemini', 'tmp');
    let arquivos = [];
    const olhar = (dir, fundo) => {
      if (fundo > 3) return;
      let its = [];
      try { its = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const it of its) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) { olhar(p, fundo + 1); continue; }
        if (/\.jsonl$/i.test(it.name) && !/[\\/]logs[\\/]/i.test(p)) arquivos.push(p);
      }
    };
    olhar(raizTmp, 0);
    const doTeste = arquivos.filter((p) => {
      try { return fs.readFileSync(p, 'utf8').includes('PONTE'); } catch { return false; }
    });
    checa('o arquivo da conversa existe no disco', doTeste.length >= 1, arquivos.slice(-3).join(' | '));

    console.log(NL + 'Sem erro no console no caminho todo');
    checa('console limpo', cdp.erros.length === 0, cdp.erros.slice(0, 4).join(' | '));

    // limpa a conversa de teste pra nao poluir a lista do Hugo
    for (const p of doTeste) { try { fs.rmSync(p, { force: true }); } catch {} }
  } catch (e) {
    falhas++;
    console.log('  FALHA (o teste estourou) -> ' + e.message);
  }

  cdp.fechar();
  try { proc.kill(); } catch {}
  await esperar(1200);
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  console.log('');
  if (falhas) { console.log(falhas + ' FALHA(S)'); process.exit(1); }
  console.log('o Gemini respondeu pelo caminho do app');
  process.exit(0);
})().catch((e) => { console.log('ERRO: ' + e.message); process.exit(1); });
