/* Olha a TELA DE VERDADE com os quatro motores.

   Teste de funcao nao prova nada disto: se a coluna do Gemini existe, se o
   cartao da conta dele para de vazar pro Codex, se o Grok diz que a lista nao
   foi ligada em vez de mentir "nenhuma conversa", e se a tela sobe sem erro no
   console. Duas auditorias em cima do codigo passaram batido na leva 28 - o que
   pegou os bloqueadores foi rodar.

   Uso:  node testes/tela-quatro-motores.js
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORTA = 9334;
const NL = String.fromCharCode(10);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/* Guarda o print pra dar pra OLHAR depois: asserção diz que o elemento existe,
   nao que ele ficou bonito na tela. */
async function foto(cdp, nome) {
  try {
    const r = await cdp.mandar('Page.captureScreenshot', { format: 'png' });
    const destino = path.join(RAIZ, 'prints', nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(r.data, 'base64'));
    console.log('  print -> ' + destino);
  } catch (e) { console.log('  print falhou: ' + e.message); }
}
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

/* Um socket so' para a sessao inteira: assim da' pra LIGAR a captura de erro
   antes de recarregar a pagina e ver o que o boot reclama. */
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
    if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
      erros.push('[log] ' + m.params.entry.text);
    }
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
    esperando.set(meu, (m) => {
      clearTimeout(prazo);
      if (m.error) return erro(new Error(method + ': ' + m.error.message));
      ok(m.result);
    });
    ws.send(JSON.stringify({ id: meu, method, params: params || {} }));
  });
  const avaliar = async (expr) => {
    const r = await mandar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result && r.result.value;
  };
  return { pronto, mandar, avaliar, erros, fechar: () => { try { ws.close(); } catch {} } };
}

/* Uma conversa de Gemini DE VERDADE, na pasta que o app le' de verdade.

   Nesta maquina o Gemini nunca chegou a responder, entao nao existe conversa
   gravada pra clicar. Sem este arquivo o caminho inteiro - main lista, lateral
   pinta, clique abre o painel com o historico - ficaria so' no papel. O arquivo
   segue as regras que estao no codigo do proprio gemini-cli, e sai no fim. */
const PASTA_ISCA = path.join(os.homedir(), '.gemini', 'tmp', 'cockpit-teste-leva29');
const ARQ_ISCA = path.join(PASTA_ISCA, 'chats', 'session-2026-09-05T22-00-teste29a.jsonl');
const CONTEXTO_ISCA = { id: 'ctx-isca', timestamp: '2026-09-05T22:00:00.000Z', type: 'user', content: [{ text: '<session_context>' + NL + 'contexto que o CLI injeta' }] };
function porIsca() {
  fs.mkdirSync(path.dirname(ARQ_ISCA), { recursive: true });
  const linhas = [
    { sessionId: 'isca-leva29', projectHash: 'iscaiscaisca', startTime: '2026-09-05T22:00:00.000Z', lastUpdated: '2026-09-05T22:00:00.000Z', kind: 'main' },
    { $set: { messages: [CONTEXTO_ISCA], lastUpdated: '2026-09-05T22:00:00.000Z' } },
    { id: 'isca-u1', timestamp: '2026-09-05T22:00:10.000Z', type: 'user', content: [{ text: 'conversa de teste da leva 29' }] },
    { id: 'isca-g1', timestamp: '2026-09-05T22:00:11.000Z', type: 'gemini', content: [{ text: 'resposta guardada no arquivo' }] },
  ];
  fs.writeFileSync(ARQ_ISCA, linhas.map((l) => JSON.stringify(l)).join(NL) + NL);
}
function tirarIsca() { try { fs.rmSync(PASTA_ISCA, { recursive: true, force: true }); } catch {} }

(async function () {
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON nesta pasta (npm i electron dentro de src/)'); process.exit(2); }
  porIsca();
  process.on('exit', tirarIsca);

  /* pasta de dados NOVA a cada rodada: com config salva o app pula a tela de
     abertura, que e' justamente uma das coisas que se quer olhar */
  const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-tela-'));
  /* Da pra apontar pra um app.asar ja empacotado:
       node testes/tela-quatro-motores.js caminho/do/app.asar
     Rodar a PASTA de fonte prova o codigo; rodar o ASAR prova o que vai
     mesmo ser instalado (caminho relativo quebrado, arquivo que ficou de fora
     do pacote - nada disso aparece rodando do src). */
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
    console.log('NAO SUBIU. stderr:' + NL + erroDoApp.slice(-1500));
    try { proc.kill(); } catch {}
    process.exit(1);
  }

  const cdp = abrirCdp(alvo.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.mandar('Runtime.enable');
  await cdp.mandar('Log.enable');
  await cdp.mandar('Page.enable');
  // recarrega COM a captura ligada: erro de boot e o que mais interessa
  await cdp.mandar('Page.reload');
  await esperar(5000);

  try {
    console.log(NL + 'A tela subiu');
    checa('sem erro no console durante o boot', cdp.erros.length === 0, cdp.erros.slice(0, 4).join(' | '));

    console.log(NL + 'Tela de abertura');
    const abertura = JSON.parse(await cdp.avaliar(`JSON.stringify({
      botoes: [...document.querySelectorAll('.bv-bt[data-motor]')].map(b => b.dataset.motor),
      fora: [...document.querySelectorAll('.bv-bt[data-motor].fora')].map(b => b.dataset.motor),
      comLogo: [...document.querySelectorAll('.bv-bt[data-motor] .bv-ico')].filter(e => e.querySelector('svg')).length,
      aviso: !!document.querySelector('#bvAviso'),
    })`));
    checa('os quatro motores aparecem na abertura',
      abertura.botoes.join(',') === 'claude,codex,gemini,grok,acp', JSON.stringify(abertura.botoes));
    checa('cada um com o seu logo desenhado', abertura.comLogo === 5, String(abertura.comLogo));
    checa('o Grok aparece marcado como nao instalado',
      abertura.fora.includes('grok'), JSON.stringify(abertura.fora));
    checa('o Gemini NAO aparece como nao instalado (ele esta aqui)',
      !abertura.fora.includes('gemini'), JSON.stringify(abertura.fora));
    checa('tem onde escrever o aviso', abertura.aviso);

    console.log(NL + 'Barra lateral');
    const barra = JSON.parse(await cdp.avaliar(`JSON.stringify({
      icones: [...document.querySelectorAll('.act[data-view]')].map(b => b.dataset.view),
      colunas: [...document.querySelectorAll('.side-view[data-view]')].map(v => v.dataset.view),
      iconesFora: [...document.querySelectorAll('.act.fora')].map(b => b.dataset.view),
      iconesDesenhados: ['Claude','Codex','Gemini','Grok'].filter(n => {
        const s = document.getElementById('svg' + n);
        const p = s && s.querySelector('path');
        return !!(p && (p.getAttribute('d') || '').length > 10);
      }),
      caixas: ['claude','codex','gemini','grok'].map(e => [
        (caixaDoMotor('hist', e) || {}).id, (caixaDoMotor('conta', e) || {}).id,
        (caixaDoMotor('uso', e) || {}).id, (caixaDoMotor('abas', e) || {}).id ].join('/')),
    })`));
    checa('tem um icone de conversa por motor',
      ['hclaude', 'hcodex', 'hgemini', 'hgrok'].every((v) => barra.icones.includes(v)), JSON.stringify(barra.icones));
    checa('tem uma coluna por motor',
      ['hclaude', 'hcodex', 'hgemini', 'hgrok'].every((v) => barra.colunas.includes(v)), JSON.stringify(barra.colunas));
    checa('o icone do Grok fica apagado', barra.iconesFora.includes('hgrok'), JSON.stringify(barra.iconesFora));
    // o <svg> da barra nasce vazio no HTML: sem preencher, viram botoes invisiveis
    checa('os quatro icones tem desenho dentro',
      barra.iconesDesenhados.join(',') === 'Claude,Codex,Gemini,Grok', JSON.stringify(barra.iconesDesenhados));
    checa('cada motor aponta pras SUAS caixas, nao pras do Codex',
      barra.caixas[2] === 'histGemini/contaGemini/usoGemini/abasGemini'
      && barra.caixas[3] === 'histGrok/contaGrok/usoGrok/abasGrok', JSON.stringify(barra.caixas));

    console.log(NL + 'O cartao da conta parou de vazar');
    const conta = JSON.parse(await cdp.avaliar(`(async () => {
      document.querySelector('#contaCodex').innerHTML = 'MARCA-CODEX';
      await pintarCartaoConta('gemini');
      return JSON.stringify({
        gemini: (document.querySelector('#contaGemini').textContent || '').trim(),
        codex: (document.querySelector('#contaCodex').textContent || '').trim(),
      });
    })()`));
    checa('a conta do Gemini escreve na coluna do Gemini',
      /Gemini/i.test(conta.gemini), JSON.stringify(conta.gemini));
    checa('e NAO escreve na coluna do Codex',
      conta.codex === 'MARCA-CODEX', JSON.stringify(conta.codex));

    console.log(NL + 'A lista de conversas de cada motor');
    const listas = JSON.parse(await cdp.avaliar(`(async () => {
      await loadHist('gemini', true);
      await loadHist('grok', true);
      return JSON.stringify({
        gemini: (document.querySelector('#histGemini').textContent || '').trim().slice(0, 120),
        grok: (document.querySelector('#histGrok').textContent || '').trim().slice(0, 160),
        cacheTemOsQuatro: Object.keys(histCache).join(','),
        genNaoEhNaN: [histGen.gemini, histGen.grok, pintaGen.gemini].every(n => typeof n === 'number' && !isNaN(n)),
      });
    })()`));
    checa('os contadores por motor nao viram NaN', listas.cacheTemOsQuatro === 'claude,codex,gemini,grok' && listas.genNaoEhNaN,
      listas.cacheTemOsQuatro + ' / ' + listas.genNaoEhNaN);
    checa('o Grok diz que a lista nao foi ligada, em vez de "nenhuma conversa"',
      /não foi ligada/i.test(listas.grok), JSON.stringify(listas.grok));
    checa('a coluna do Gemini respondeu alguma coisa', listas.gemini.length > 0, JSON.stringify(listas.gemini));
    checa('a conversa gravada do Gemini aparece na lista',
      /conversa de teste da leva 29/i.test(listas.gemini), JSON.stringify(listas.gemini));

    console.log(NL + 'As colunas do dia a dia continuam de pe');
    // o risco da leva 29 nao e o Gemini: e ter quebrado Claude e Codex ao
    // trocar os cinco seletores por uma caixa so.
    const dia = JSON.parse(await cdp.avaliar(`(async () => {
      await loadHist('claude', true);
      await loadHist('codex', true);
      return JSON.stringify({
        claude: (document.querySelector('#histClaude').textContent || '').trim().slice(0, 90),
        codex: (document.querySelector('#histCodex').textContent || '').trim().slice(0, 90),
        nClaude: (histCache.claude || []).length,
        nCodex: (histCache.codex || []).length,
      });
    })()`));
    checa('a lista do Claude carregou de verdade', dia.nClaude > 0, JSON.stringify(dia.claude));
    checa('a lista do Codex carregou de verdade', dia.nCodex > 0, JSON.stringify(dia.codex));

    console.log(NL + 'Clicar num motor que nao esta instalado');
    const semGrok = JSON.parse(await cdp.avaliar(`(() => {
      const antes = document.querySelectorAll('.pane').length;
      // volta pra abertura nao da; entao chama direto o mesmo caminho do botao
      document.querySelector('.bv-bt[data-motor="grok"]') && document.querySelector('.bv-bt[data-motor="grok"]').click();
      const av = document.querySelector('#bvAviso');
      return JSON.stringify({
        antes, depois: document.querySelectorAll('.pane').length,
        aviso: av ? (av.classList.contains('hidden') ? '' : (av.textContent || '').trim()) : 'sem elemento',
      });
    })()`));
    checa('clicar no Grok nao abre painel novo', semGrok.antes === semGrok.depois, JSON.stringify(semGrok));
    checa('e explica por que, em vez de nao acontecer nada',
      /não está instalado/i.test(semGrok.aviso || ''), JSON.stringify(semGrok.aviso));
    await foto(cdp, 'tela-abertura.png');

    const novaGrok = JSON.parse(await cdp.avaliar(`(async () => {
      const antes = document.querySelectorAll('.pane').length;
      await novaConversa('grok');
      return JSON.stringify({ antes, depois: document.querySelectorAll('.pane').length });
    })()`));
    checa('"Nova conversa" na coluna do Grok tambem nao abre painel',
      novaGrok.antes === novaGrok.depois, JSON.stringify(novaGrok));

    console.log(NL + 'Abrir um painel do Gemini pela tela de abertura');
    await cdp.avaliar(`document.querySelector('.bv-bt[data-motor="gemini"]').click()`);
    await esperar(1500);
    const painel = JSON.parse(await cdp.avaliar(`JSON.stringify({
      paineis: document.querySelectorAll('.pane').length,
      classes: [...(document.querySelector('.pane') || {classList:[]}).classList],
      botaoMotor: ((document.querySelector('.pane .p-motor-outro') || {}).textContent || '').trim(),
      chaveEscondida: !!(document.querySelector('.pane .p-chave') || {}).classList.contains('hidden'),
      corDoAcento: getComputedStyle(document.querySelector('.pane') || document.body).getPropertyValue('--accent').trim(),
    })`));
    checa('o painel nasceu', painel.paineis === 1, String(painel.paineis));
    checa('o painel e do Gemini', painel.classes.includes('eng-gemini'), JSON.stringify(painel.classes));
    checa('o botao do motor diz Gemini', painel.botaoMotor === 'Gemini', JSON.stringify(painel.botaoMotor));
    checa('o interruptor Claude/Codex some num painel Gemini', painel.chaveEscondida, String(painel.chaveEscondida));
    checa('o Gemini tem cor propria (nao o roxo generico #8b7fd4)',
      painel.corDoAcento && painel.corDoAcento.toLowerCase() !== '#8b7fd4', JSON.stringify(painel.corDoAcento));

    console.log(NL + 'Trocar de modelo sem perder a conversa');
    const guarda = JSON.parse(await cdp.avaliar(`(() => {
      const P = focusPane;
      P.sessaoId = 'sessao-de-teste-1234'; P.resumeId = null; P.started = true;
      guardarConversaPraVoltar(P);
      const doGemini = P.resumeId;
      const Q = { engine: 'codex', sessaoId: 'thread-do-codex', resumeId: null };
      guardarConversaPraVoltar(Q);
      return JSON.stringify({ motor: P.engine, doGemini, doCodex: Q.resumeId });
    })()`));
    checa('o painel do teste e do Gemini', guarda.motor === 'gemini', JSON.stringify(guarda.motor));
    checa('o Gemini guarda o endereco da conversa antes de religar',
      guarda.doGemini === 'sessao-de-teste-1234', JSON.stringify(guarda.doGemini));
    checa('o Codex continua de fora (ele guarda a thread do lado dele)',
      guarda.doCodex === null, JSON.stringify(guarda.doCodex));

    console.log(NL + 'Buscar conversa (Ctrl+F) num painel do Gemini');
    const busca = await cdp.avaliar(`(() => {
      abrirBuscaDeConversa();
      const aberta = [...document.querySelectorAll('.side-view')].find(v => !v.classList.contains('hidden'));
      return aberta ? aberta.dataset.view : 'nenhuma';
    })()`);
    checa('abre a lista do Gemini, nao a do Claude', busca === 'hgemini', JSON.stringify(busca));

    /* abre a coluna pra fotografar. Clicar no icone que JA esta aceso fecha a
       lateral (e' o atalho de esconder) - por isso o abrir() confere antes. */
    const abrir = async (eng) => {
      const estado = await cdp.avaliar(`(() => {
        const bt = document.querySelector('.act[data-view="h${eng}"]');
        if (!bt.classList.contains('active')) bt.click();
        document.querySelector('#sidebar').classList.remove('hidden');
        document.querySelector('#dragbar').classList.remove('hidden');
        const aberta = [...document.querySelectorAll('.side-view')].find(v => !v.classList.contains('hidden'));
        return (aberta ? aberta.dataset.view : 'nenhuma') + '/' + (document.querySelector('#sidebar').classList.contains('hidden') ? 'fechada' : 'aberta');
      })()`);
      await esperar(900);
      return estado;
    };
    const vGem = await abrir('gemini');
    checa('a coluna do Gemini abre de verdade', vGem === 'hgemini/aberta', JSON.stringify(vGem));
    await foto(cdp, 'lateral-gemini.png');
    const vGrok = await abrir('grok');
    checa('a coluna do Grok abre de verdade', vGrok === 'hgrok/aberta', JSON.stringify(vGrok));
    await foto(cdp, 'lateral-grok.png');

    console.log(NL + 'O botao "Entrar no ..." da coluna');
    const entrar = JSON.parse(await cdp.avaliar(`(async () => {
      await pintarCartaoConta('grok');
      const bt = document.querySelector('#contaGrok .ct-entrar');
      const rotulo = bt ? bt.textContent.trim() : 'sem botao';
      // o painel em foco e do GEMINI: o clique nao pode logar no motor errado
      const motorEmFoco = focusPane && focusPane.engine;
      if (bt) bt.click();
      await new Promise(r => setTimeout(r, 400));
      const notas = [...document.querySelectorAll('.pane .note')].map(n => n.textContent.trim());
      return JSON.stringify({ rotulo, motorEmFoco, ultima: notas[notas.length - 1] || '' });
    })()`));
    checa('o botao e da coluna do Grok', entrar.rotulo === 'Entrar no Grok', JSON.stringify(entrar.rotulo));
    checa('o painel em foco e do Gemini (e a armadilha)', entrar.motorEmFoco === 'gemini', JSON.stringify(entrar.motorEmFoco));
    checa('clicar em "Entrar no Grok" NAO faz login do Gemini',
      /Abra um painel do Grok/i.test(entrar.ultima), JSON.stringify(entrar.ultima));

    console.log(NL + 'Clicar numa conversa do Gemini abre o painel com o historico');
    const reabrir = JSON.parse(await cdp.avaliar(`(async () => {
      const bt = document.querySelector('.act[data-view="hgemini"]');
      if (!bt.classList.contains('active')) bt.click();
      await loadHist('gemini', true);
      const itens = [...document.querySelectorAll('#histGemini .hist-item')];
      const alvo = itens.find(i => /leva 29/i.test(i.textContent || ''));
      if (!alvo) return JSON.stringify({ achou: false, itens: itens.length });
      alvo.click();
      await new Promise(r => setTimeout(r, 2500));
      const P = focusPane || {};
      const bolhas = P.el ? [...P.el.querySelectorAll('.msg-body, .bot-body, .msg, .bolha')].map(e => (e.textContent || '').trim()) : [];
      return JSON.stringify({
        achou: true,
        motorDoPainel: P.engine,
        titulo: P.titulo || '',
        resume: P.resumeId || P.sessaoId || '',
        texto: (P.el ? P.el.textContent : '').replace(/\\s+/g, ' ').slice(0, 400),
        bolhas: bolhas.length,
      });
    })()`));
    checa('a conversa gravada aparece como item clicavel', reabrir.achou === true, JSON.stringify(reabrir));
    if (reabrir.achou) {
      checa('o painel que abriu e do Gemini', reabrir.motorDoPainel === 'gemini', JSON.stringify(reabrir.motorDoPainel));
      checa('ele vai retomar a MESMA conversa', reabrir.resume === 'isca-leva29', JSON.stringify(reabrir.resume));
      checa('a sua fala antiga voltou pra tela',
        /conversa de teste da leva 29/i.test(reabrir.texto), JSON.stringify(reabrir.texto.slice(0, 160)));
      checa('a resposta antiga do Gemini tambem voltou',
        /resposta guardada no arquivo/i.test(reabrir.texto), JSON.stringify(reabrir.texto.slice(0, 160)));
      checa('o <session_context> NAO voltou pra tela',
        !/session_context/i.test(reabrir.texto), JSON.stringify(reabrir.texto.slice(0, 160)));
    }
    await foto(cdp, 'conversa-gemini-reaberta.png');

    console.log(NL + 'Depois de mexer em tudo');
    checa('continua sem erro no console', cdp.erros.length === 0, cdp.erros.slice(0, 5).join(' | '));
  } catch (e) {
    falhas++;
    console.log('  FALHA (o teste estourou) -> ' + e.message);
    if (cdp.erros.length) console.log('  erros da tela: ' + cdp.erros.slice(0, 5).join(' | '));
  }

  cdp.fechar();
  try { proc.kill(); } catch {}
  await esperar(1200);
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  console.log('');
  if (falhas) { console.log(falhas + ' FALHA(S)'); process.exit(1); }
  console.log('a tela passou em tudo');
  process.exit(0);
})().catch((e) => { console.log('ERRO: ' + e.message); process.exit(1); });
