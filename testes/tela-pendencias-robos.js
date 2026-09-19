/* Olha a TELA DE VERDADE: a aba Pendencias e o chip de robo em segundo plano.

   Teste de funcao nao prova que a tela subiu sem erro, que o botao aparece na
   barra, que o card desenha e que o badge conta. Isto sobe o Electron de
   verdade (dados proprios, nao encosta no Cockpit em uso), mexe no estado
   como o app mexeria e tira print.

   Uso:  node testes/tela-pendencias-robos.js [caminho/do/app.asar]
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORTA = 9336;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const checa = (nome, ok, det) => {
  if (ok) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

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
    if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') erros.push('[log] ' + m.params.entry.text);
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
    const prazo = setTimeout(() => erro(new Error('sem resposta de ' + method)), 25000);
    esperando.set(meu, (m) => { clearTimeout(prazo); if (m.error) return erro(new Error(method + ': ' + m.error.message)); ok(m.result); });
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
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON (npm i electron dentro de src/)'); process.exit(2); }
  const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-pend-'));
  const APP = process.argv[2] || '.';
  console.log('rodando: ' + APP + '  (dados em ' + USERDATA + ')');
  const proc = spawn(ELECTRON, [APP, '--user-data-dir=' + USERDATA, '--remote-debugging-port=' + PORTA], { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (!alvo) { console.log('a janela nao abriu. stderr:\n' + erroDoApp.slice(0, 2000)); proc.kill(); process.exit(1); }

  const cdp = abrirCdp(alvo.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.mandar('Log.enable');
  await cdp.mandar('Runtime.enable');
  await cdp.mandar('Page.enable');   // sem isto o captureScreenshot nao responde
  await esperar(3500);   // deixa o app.js montar a tela

  console.log('\n1) a aba Pendencias existe na barra');
  checa('o botao esta na barra de icones', await cdp.avaliar(`!!document.querySelector('.act[data-view="pendencias"]')`));
  checa('o badge nasce escondido (sem pendencia, sem numero)', await cdp.avaliar(`(() => { const b = document.querySelector('.act[data-view="pendencias"] .act-badge'); return !!b && b.classList.contains('hidden'); })()`));
  checa('a view existe na lateral', await cdp.avaliar(`!!document.querySelector('.side-view[data-view="pendencias"] .pendencias-lista')`));

  console.log('\n2) clicar no botao abre a lista');
  await cdp.avaliar(`document.querySelector('.act[data-view="pendencias"]').click()`);
  await esperar(600);
  checa('a view fica visivel', await cdp.avaliar(`!document.querySelector('.side-view[data-view="pendencias"]').classList.contains('hidden')`));
  checa('sem pendencia, explica em vez de ficar em branco', await cdp.avaliar(`(document.querySelector('.pendencias-lista')||{}).textContent || ''`).then((t) => /Nenhuma pendência agora/.test(t)));
  await foto(cdp, 'pendencias-vazia.png');

  console.log('\n3) com pendencia de verdade: uma local e uma da VPS');
  await cdp.avaliar('if (!panes.size) newPane();');
  await esperar(1500);
  const comPendencia = await cdp.avaliar(`(() => {
    const P = [...panes.values()][0];
    if (!P) return 'sem painel';
    // painel da aba atual esperando permissao
    P.pedindoPerm = true;
    P.filaPerm = [{ key: 'k1', title: 'Rodar comando', detail: 'npm test', tool: 'Bash' }];
    // um segundo painel, numa aba REMOTA, esperando pergunta - vai pro fundo
    const Q = { id: 'falso-vps', abaId: 'vps-teste', el: P.el, engine: 'claude', titulo: 'Deploy na VPS',
                perguntaAberta: { id: 'q1', bloqueante: true, perguntas: [{ pergunta: 'Posso reiniciar?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] }] },
                filaPerg: [{ id: 'q1', bloqueante: true, perguntas: [{ pergunta: 'Posso reiniciar?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] }] }], hist: [] };
    panesFundo.set(Q.id, Q);
    if (!cfg.abas.find((a) => a.id === 'vps-teste')) cfg.abas.push({ id: 'vps-teste', nome: 'VPS', tipo: 'ssh', cor: '#5aa469', paineis: [] });
    sincronizarPendencias();
    return 'ok';
  })()`);
  checa('consegui montar o cenario', comPendencia === 'ok', String(comPendencia));
  await esperar(500);
  checa('o badge do icone mostra 2', await cdp.avaliar(`(document.querySelector('.act[data-view="pendencias"] .act-badge')||{}).textContent`) === '2');
  checa('o badge saiu do escondido', await cdp.avaliar(`!document.querySelector('.act[data-view="pendencias"] .act-badge').classList.contains('hidden')`));
  checa('a lista desenhou 2 cards', await cdp.avaliar(`document.querySelectorAll('.pendencias-card').length`) === 2);
  checa('o card diz de que aba e (inclusive a VPS)', await cdp.avaliar(`[...document.querySelectorAll('.pend-aba')].map((e)=>e.textContent).join('|')`).then((t) => /VPS/.test(t)));
  checa('o card diz o que esta esperando', await cdp.avaliar(`[...document.querySelectorAll('.pend-tipo')].map((e)=>e.textContent).join('|')`).then((t) => /esperando você autorizar/.test(t) && /esperando sua resposta/.test(t)));
  await foto(cdp, 'pendencias-com-dois.png');

  console.log('\n4) abrir o card mostra o formulario de resposta DENTRO da lista');
  await cdp.avaliar(`document.querySelector('.pendencias-card .pendencias-card-header').click()`);
  await esperar(500);
  const corpo = await cdp.avaliar(`(document.querySelector('.pendencias-card.expandido .pendencias-card-body')||{}).innerHTML || ''`);
  checa('o card abriu', await cdp.avaliar(`!!document.querySelector('.pendencias-card.expandido')`));
  checa('os botoes de permitir/negar vieram junto', /pp-yes/.test(corpo) && /pp-no/.test(corpo), corpo.slice(0, 120));
  await foto(cdp, 'pendencias-card-aberto.png');

  console.log('\n5) o chip de robo em segundo plano');
  await cdp.avaliar(`(() => {
    const P = [...panes.values()][0];
    roboDoPainel(P, { tarefas: [{ id: 'b1', tipo: 'agente', desc: 'Revisar a Task 5' }, { id: 'b2', tipo: 'comando', desc: 'npm test' }] });
  })()`);
  await esperar(400);
  checa('o chip apareceu no painel', await cdp.avaliar(`!!document.querySelector('.p-robos')`));
  checa('conta os dois robos', await cdp.avaliar(`(document.querySelector('.p-robos .robo-txt')||{}).textContent`) === '2 robôs trabalhando');
  checa('mostra ha quanto tempo', await cdp.avaliar(`(document.querySelector('.p-robos .robo-tempo')||{}).textContent || ''`).then((t) => /^há /.test(t)));
  await foto(cdp, 'robo-chip.png');

  await cdp.avaliar(`roboDoPainel([...panes.values()][0], { tarefas: [{ id: 'b2', tipo: 'comando', desc: 'npm test' }] })`);
  await esperar(300);
  checa('quando um termina, sobra um', await cdp.avaliar(`(document.querySelector('.p-robos .robo-txt')||{}).textContent`) === 'um robô trabalhando');
  await cdp.avaliar(`roboDoPainel([...panes.values()][0], { tarefas: [] })`);
  await esperar(300);
  checa('quando todos terminam, o chip some', await cdp.avaliar(`!document.querySelector('.p-robos')`));

  console.log('\n6) o console nao reclamou');
  const ruins = cdp.erros.filter((e) => !/favicon|DevTools|Autofill/i.test(e));
  checa('sem erro de console/excecao', ruins.length === 0, ruins.slice(0, 3).join(' | '));

  cdp.fechar();
  proc.kill();
  await esperar(500);
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntela-pendencias-robos: tudo ok');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('quebrou: ' + (e && e.stack || e)); process.exit(1); });
