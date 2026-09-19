/* Olha o SELETOR DE MOTOR na tela de verdade (leva 39).

   Ate a leva 38 o topo do painel tinha duas telas pra mesma acao: um
   interruptor de dois lados (Claude|Codex) e, so' nos outros motores, um botao
   com o nome do motor. Alem de inconsistente, a tela mentia -- sentado num
   painel Claude nao havia caminho nenhum ate o Gemini, o Grok ou o ACP.

   Agora e' UM botao em todo painel. O que este teste prova:
     - a chave de dois lados sumiu do molde E da tela montada;
     - o botao aparece em painel de QUALQUER motor, com nome e logo proprios;
     - o texto tem contraste WCAG AA nos 15 pares tema x motor;
     - o clique abre a lista dos CINCO, e escolher da lista troca de verdade;
     - a tecla do menu faz o vaivem, e o rotulo do botao promete a MESMA tecla
       que o main.js registra;
     - dentro do terminal embutido a tecla nao passa;
     - em aba de servidor a lista diz quem nao roda la';
     - em painel estreito o nome some e o X de fechar continua dentro.

   Uso:  node testes/tela-botao-motor.js

   Duas licoes da auditoria da propria leva 39, pra ninguem repetir:
     1. `color-mix` NAO volta como "rgb(0-255)" no getComputedStyle, e sim como
        "color(srgb 0-1)". A primeira versao deste teste dividia tudo por 255 e
        media o botao como preto puro: dava 21:1 e passava sempre, cego
        justamente nos 10 pares que a leva consertou. Por isso a cor passa por
        um canvas -- que normaliza qualquer forma, alpha inclusive -- e por isso
        o medidor se auto-testa antes de valer.
     2. Bloco que roda antes de existir painel conta zero de tudo e passa por
        engano (o perfil e' limpo, entao a tela de abertura fica no ar e nenhum
        .pane e' instanciado). Aqui o painel vem primeiro.
*/
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
const USERDATA = path.join(RAIZ, 'userdata-teste-motor');
const PORTA = 9336;
const NL = String.fromCharCode(10);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let falhas = 0, pulados = 0;
function checa(nome, cond, det) {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
}
function pula(nome, porque) { pulados++; console.log('  PULADO ' + nome + ' (' + porque + ')'); }

/* Um try por bloco: com um try so' pra tudo, a primeira excecao abortava os
   blocos seguintes e o relatorio inteiro virava uma linha. */
async function bloco(titulo, fn) {
  console.log(NL + titulo);
  try { await fn(); }
  catch (e) { falhas++; console.log('  FALHA (o bloco estourou) -> ' + e.message); }
}

function pegarJson(url) {
  return new Promise((ok, erro) => {
    http.get(url, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { erro(e); } });
    }).on('error', erro);
  });
}

/* Um socket so' pra sessao inteira, com a captura de erro ligada ANTES de
   recarregar a pagina -- e' o padrao do tela-quatro-motores.js: erro de boot e'
   o que mais interessa, e um window.onerror instalado depois do carregamento ja'
   perdeu tudo o que importava. */
function abrirCdp(wsUrl) {
  let WebSocket;
  try { WebSocket = require('ws'); } catch { WebSocket = require(path.join(SRC, 'node_modules', 'ws')); }
  const ws = new WebSocket(wsUrl);
  let seq = 100;
  const esperando = new Map();
  const erros = [];
  const pronto = new Promise((ok, erro) => { ws.on('open', ok); ws.on('error', erro); });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') erros.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      erros.push(String(d.text || '') + ' ' + String((d.exception || {}).description || ''));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      erros.push((m.params.args || []).map((a) => String(a.value || a.description || '')).join(' '));
    }
    const p = esperando.get(m.id);
    if (p) { esperando.delete(m.id); p(m); }
  });
  const mandar = (method, params) => new Promise((ok, erro) => {
    const id = ++seq;
    const prazo = setTimeout(() => { esperando.delete(id); erro(new Error('sem resposta de ' + method)); }, 25000);
    esperando.set(id, (m) => {
      clearTimeout(prazo);
      if (m.error) return erro(new Error(method + ': ' + JSON.stringify(m.error)));
      ok(m.result);
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const avaliar = async (expr) => {
    const r = await mandar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r && r.result && r.result.value;
  };
  return { pronto, mandar, avaliar, erros, fechar: () => { try { ws.close(); } catch {} } };
}

/* Um surface proprio: sem isto o captureScreenshot fica esperando pra sempre um
   quadro que a janela atras de outra nunca compoe. */
async function foto(cdp, nome) {
  try {
    await cdp.mandar('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    const r = await cdp.mandar('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await cdp.mandar('Emulation.clearDeviceMetricsOverride');
    const destino = path.join(RAIZ, 'prints', nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(r.data, 'base64'));
    console.log('  print -> ' + destino);
  } catch (e) { console.log('  (print nao saiu: ' + e.message + ')'); }
}

/* O medidor de contraste, injetado uma vez. O canvas normaliza rgb(), rgba() e
   color(srgb ...) de uma vez -- e resolve o alpha compondo sobre um fundo,
   coisa que regex nenhum faz. */
const MEDIDOR = "window.__contraste = (() => {"
  + "  const cv = document.createElement('canvas'); cv.width = cv.height = 1;"
  + "  const cx = cv.getContext('2d', { willReadFrequently: true });"
  + "  const rgb = (css, atras) => {"
  + "    cx.clearRect(0, 0, 1, 1);"
  + "    cx.fillStyle = atras || '#ffffff'; cx.fillRect(0, 0, 1, 1);"
  + "    cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);"
  + "    const d = cx.getImageData(0, 0, 1, 1).data;"
  + "    return [d[0], d[1], d[2]];"
  + "  };"
  + "  const luz = (css, atras) => {"
  + "    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };"
  + "    const p = rgb(css, atras);"
  + "    return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);"
  + "  };"
  + "  const razao = (a, b, atras) => {"
  + "    const x = luz(a, atras), y = luz(b, atras);"
  + "    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);"
  + "  };"
  + "  return { rgb, razao };"
  + "})();";

(async function () {
  if (!fs.existsSync(ELECTRON)) { console.log('SEM ELECTRON nesta pasta (npm i electron dentro de src/)'); process.exit(2); }
  fs.rmSync(USERDATA, { recursive: true, force: true });
  fs.mkdirSync(USERDATA, { recursive: true });

  const proc = spawn(ELECTRON, ['.', '--user-data-dir=' + USERDATA, '--remote-debugging-port=' + PORTA],
    { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'] });
  let erroDoApp = '';
  proc.stderr.on('data', (d) => { erroDoApp += d.toString('utf8'); });

  const encerrar = (codigo) => {
    try { proc.kill(); } catch {}
    try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}
    process.exit(codigo);
  };

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(1000);
    try {
      const abas = await pegarJson('http://127.0.0.1:' + PORTA + '/json/list');
      alvo = abas.find((a) => a.type === 'page' && /index\.html/.test(a.url || ''));
    } catch {}
  }
  if (!alvo) { console.log('NAO SUBIU. stderr:' + NL + erroDoApp.slice(-1500)); return encerrar(1); }

  const cdp = abrirCdp(alvo.webSocketDebuggerUrl);
  await cdp.pronto;
  await cdp.mandar('Runtime.enable');
  await cdp.mandar('Log.enable');
  await cdp.mandar('Page.enable');
  await cdp.mandar('Page.reload');          // recarrega COM a captura ligada
  await esperar(5000);
  await cdp.avaliar(MEDIDOR);

  await bloco('Um painel na tela, pra ter o que medir', async () => {
    const n = await cdp.avaliar(`(async () => {
      if (!panes.size) newPane();
      await new Promise(r => setTimeout(r, 500));
      return panes.size;
    })()`);
    checa('o painel existe', n >= 1, String(n));
  });

  await bloco('A chave de dois lados sumiu — do molde E da tela montada', async () => {
    const r = JSON.parse(await cdp.avaliar(`JSON.stringify({
      paineis: document.querySelectorAll('.pane').length,
      chaves: document.querySelectorAll('.p-chave').length,
      lados: document.querySelectorAll('.ch-lado').length,
      botoes: document.querySelectorAll('.pane .pane-hd .p-motor').length,
      noMolde: /p-chave|ch-lado|p-motor-outro/.test(document.querySelector('#tplPane').innerHTML),
      antigoNoJs: typeof ajustarChaveDeMotor !== 'undefined' || typeof posicionarChave !== 'undefined',
    })`));
    checa('ha painel montado (senao as contagens abaixo nao valem nada)', r.paineis >= 1, String(r.paineis));
    checa('nenhum .p-chave na tela', r.chaves === 0, String(r.chaves));
    checa('nenhum .ch-lado na tela', r.lados === 0, String(r.lados));
    checa('um .p-motor por painel', r.botoes === r.paineis, r.botoes + ' botoes / ' + r.paineis + ' paineis');
    checa('o molde nao tem mais nem a chave nem o botao antigo', r.noMolde === false, String(r.noMolde));
    checa('as funcoes do interruptor sumiram do js', r.antigoNoJs === false, String(r.antigoNoJs));
  });

  await bloco('O botao do motor em painel de cada motor', async () => {
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      const out = {};
      for (const eng of ['claude','codex','gemini','grok','acp']) {
        P.engine = eng; paintEngine(P);
        await new Promise(r => setTimeout(r, 60));
        const bt = P.el.querySelector('.p-motor');
        const logo = bt && bt.querySelector('.logo-motor path');
        out[eng] = {
          existe: !!bt,
          nome: bt ? (bt.querySelector('.pm-nome').textContent || '').trim() : '',
          logo: logo ? logo.getAttribute('d') : '',
          temSeta: !!(bt && bt.querySelector('.pm-seta svg')),
          fundo: bt ? getComputedStyle(bt).backgroundColor : '',
        };
      }
      return JSON.stringify(out);
    })()`));
    const esperado = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' };
    for (const eng of Object.keys(esperado)) {
      checa(eng + ': o botao existe, com nome e seta',
        r[eng].existe && r[eng].nome === esperado[eng] && r[eng].temSeta, JSON.stringify(r[eng]));
    }
    /* svgMotor cai no logo do Claude quando o motor nao tem um (LOGO[eng] ||
       LOGO.claude): sem esta conferencia, motor novo exibiria o desenho errado
       e o teste passava verde. */
    const logos = Object.values(r).map((x) => x.logo);
    checa('os cinco logos sao desenhos diferentes', new Set(logos).size === 5 && !logos.includes(''),
      new Set(logos).size + ' distintos');
    const fundos = Object.values(r).map((x) => x.fundo);
    checa('os cinco fundos sao cores diferentes', new Set(fundos).size === 5, JSON.stringify(fundos));
  });

  await bloco('O medidor de contraste funciona (auto-teste antes de valer)', async () => {
    const r = JSON.parse(await cdp.avaliar(`JSON.stringify({
      extremos: window.__contraste.razao('#000', '#fff'),
      antesDaCorrecao: window.__contraste.razao('#fdf6e3', '#2aa198'),
      srgb: window.__contraste.rgb('color(srgb 0.684706 0.289412 0.109412)').join(','),
    })`));
    checa('preto contra branco da 21:1', Math.abs(r.extremos - 21) < 0.1, String(r.extremos));
    /* o par que a leva 39 consertou (ACP no tema jornal). Se o medidor voltar a
       quebrar, ele passa a "achar" que este par tem 21:1 e esta linha acusa. */
    checa('reprova o par que a leva 39 consertou (ACP/jornal ~2,9:1)',
      r.antesDaCorrecao > 2.8 && r.antesDaCorrecao < 3.1, String(r.antesDaCorrecao));
    checa('entende color(srgb 0-1), que e como o color-mix volta',
      r.srgb === '175,74,28', r.srgb);
  });

  await bloco('Contraste do texto do botao: 15 pares tema x motor', async () => {
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      const antes = document.documentElement.getAttribute('data-tema');
      const fora = [], todos = {};
      try {
        for (const tema of ['escuro','claro','jornal']) {
          document.documentElement.setAttribute('data-tema', tema);
          for (const eng of ['claude','codex','gemini','grok','acp']) {
            P.engine = eng; paintEngine(P);
            await new Promise(r => setTimeout(r, 40));
            const cs = getComputedStyle(P.el.querySelector('.p-motor'));
            const v = window.__contraste.razao(cs.backgroundColor, cs.color);
            todos[tema + '/' + eng] = Number(v.toFixed(2));
            if (v < 4.5) fora.push(tema + '/' + eng + ' ' + v.toFixed(2));
          }
        }
      } finally {
        // restaura mesmo se estourar no meio, senao os blocos seguintes rodam
        // no tema errado e falham por motivo que nao e' deles
        document.documentElement.setAttribute('data-tema', antes || 'escuro');
        P.engine = 'claude'; paintEngine(P);
      }
      return JSON.stringify({ fora, todos });
    })()`));
    checa('os 15 pares passam em 4,5:1 (WCAG AA para texto pequeno)',
      r.fora.length === 0, r.fora.join(' · '));
    const vals = Object.values(r.todos);
    checa('e nenhum passou por medicao quebrada (nada perto de 21:1)',
      vals.length === 15 && Math.max(...vals) < 12,
      'pior ' + Math.min(...vals) + ' / melhor ' + Math.max(...vals));
  });

  await bloco('O clique abre a lista dos CINCO, e a lista troca de verdade', async () => {
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      P.abaId = cfg.abaAtiva; P.engine = 'claude'; P.hist = []; paintEngine(P);
      P.el.querySelector('.p-motor').click();
      await new Promise(r => setTimeout(r, 400));
      return JSON.stringify({
        aberto: !P.el.querySelector('.p-modal').classList.contains('hidden'),
        itens: [...P.el.querySelectorAll('.p-modal .mi .mi-n')].map(e => e.textContent.trim()),
        marcado: [...P.el.querySelectorAll('.p-modal .mi.on .mi-n')].map(e => e.textContent.trim()),
      });
    })()`));
    checa('o menu abriu num painel Claude (antes nao havia caminho)', r.aberto === true);
    checa('lista os cinco motores', r.itens.length === 5, JSON.stringify(r.itens));
    checa('Gemini, Grok e ACP estao la', ['Gemini','Grok','ACP'].every(n => r.itens.includes(n)), JSON.stringify(r.itens));
    checa('o motor de agora aparece marcado', r.marcado.join() === 'Claude', JSON.stringify(r.marcado));
    await foto(cdp, 'leva39-menu-motores.png');

    // escolher um item da lista tem que TROCAR, nao so' fechar o menu
    const escolha = await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      const alvo = [...P.el.querySelectorAll('.p-modal .mi')].find(d => d.querySelector('.mi-n').textContent.trim() === 'Gemini');
      if (!alvo) return 'nao achei o item';
      alvo.click();
      await new Promise(r => setTimeout(r, 1200));
      return P.engine;
    })()`);
    checa('escolher Gemini na lista troca o motor do painel', escolha === 'gemini', String(escolha));
    await cdp.avaliar(`fecharMenus()`);
  });

  await bloco('O rotulo promete a MESMA tecla que o menu registra', async () => {
    /* Sem isto o teste passava inteiro mesmo se o acelerador tivesse ficado no
       Ctrl+Alt+M -- que dispara sozinho no teclado ABNT2, porque ali o AltGr E'
       Ctrl+Alt. O rotulo do botao e o menu do main.js sao dois arquivos
       diferentes e nada os amarrava. */
    const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
    const m = main.match(/label:\s*'Trocar de motor',\s*accelerator:\s*'([^']+)'/);
    checa('o main.js registra um acelerador pra "Trocar de motor"', !!m, m ? m[1] : 'nao achei');
    if (!m) return;
    checa('e ele nao e um Ctrl+Alt (o AltGr do ABNT2 dispara isso sozinho)', !/Alt/i.test(m[1]), m[1]);
    const tecla = m[1].replace(/CmdOrCtrl|Control|Ctrl/i, '⌘').replace(/Shift/i, '⇧').replace(/\+/g, '');
    const titulo = String(await cdp.avaliar(`[...panes.values()][0].el.querySelector('.p-motor').title`));
    const noTitulo = titulo.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/\s/g, '');
    checa('o titulo do botao anuncia essa mesma tecla', noTitulo.includes(tecla),
      JSON.stringify(titulo) + ' nao contem ' + tecla);
  });

  await bloco('A tecla passa pela fiacao do menu, nao so pela funcao', async () => {
    const temOsDois = await cdp.avaliar(`motorDisponivel.codex !== false && motorDisponivel.claude !== false`);
    if (!temOsDois) { pula('o vaivem Claude<->Codex', 'um dos dois CLIs nao esta instalado nesta maquina'); return; }
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      P.abaId = cfg.abaAtiva; P.engine = 'claude'; P.hist = []; paintEngine(P); setFocus(P);
      document.body.focus();
      acaoDeMenu('trocarMotor');                       // <- a fiacao inteira, nao a funcao
      await new Promise(r => setTimeout(r, 1400));
      const ida = P.engine;
      acaoDeMenu('trocarMotor');
      await new Promise(r => setTimeout(r, 1400));
      return JSON.stringify({ ida, volta: P.engine, rotulo: P.el.querySelector('.p-motor .pm-nome').textContent.trim() });
    })()`));
    checa('de Claude vai pro Codex', r.ida === 'codex', JSON.stringify(r.ida));
    checa('e do Codex volta pro Claude', r.volta === 'claude', JSON.stringify(r.volta));
    checa('o botao acompanhou a troca', r.rotulo === 'Claude', JSON.stringify(r.rotulo));
  });

  await bloco('Dentro do terminal embutido a tecla NAO passa', async () => {
    /* Trocar de motor mata o turno e joga fora o id da sessao. O Ctrl+K, que so'
       limpa a tela, ja' era barrado ali dentro; este com mais razao. */
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      P.abaId = cfg.abaAtiva; P.engine = 'claude'; paintEngine(P); setFocus(P);
      /* O .term-wrap tem que ficar num lugar VISIVEL. Na primeira versao ele foi
         parar dentro do .p-modal, que nasce .hidden -- e elemento em display:none
         nao recebe foco: o activeElement continuava no body, a guarda nem era
         consultada e o teste acusava o codigo por culpa dele mesmo. */
      const falso = document.createElement('div');
      falso.className = 'term-wrap';
      falso.innerHTML = '<input class="isca">';
      P.el.querySelector('.pane-chat').appendChild(falso);
      falso.querySelector('.isca').focus();
      // a premissa do teste, medida em vez de suposta
      const focoNoTerminal = !!(document.activeElement && document.activeElement.closest
        && document.activeElement.closest('.term-wrap'));
      acaoDeMenu('trocarMotor');
      await new Promise(r => setTimeout(r, 900));
      const dentro = P.engine;
      falso.remove(); document.body.focus();
      // e a prova de que a tecla funcionaria se o foco estivesse fora
      acaoDeMenu('trocarMotor');
      await new Promise(r => setTimeout(r, 1400));
      return JSON.stringify({ focoNoTerminal, dentro, fora: P.engine });
    })()`));
    checa('o foco caiu mesmo dentro do .term-wrap (a premissa do teste)',
      r.focoNoTerminal === true, String(r.focoNoTerminal));
    checa('com o foco no terminal a tecla nao troca o motor', r.dentro === 'claude', String(r.dentro));
    checa('e com o foco fora ela troca (prova que a guarda e que segurou)',
      r.fora === 'codex', String(r.fora));
  });

  await bloco('Aba de servidor: a lista diz quem nao roda la', async () => {
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      const abaAntes = P.abaId;
      P.abaId = 'vps';                                  // a aba ssh que ja vem no app
      P.engine = 'claude'; paintEngine(P); setFocus(P);
      document.body.focus();
      const eRemoto = !!remotoDoPane(P);
      acaoDeMenu('trocarMotor');                        // em remoto isso abre a lista
      await new Promise(r => setTimeout(r, 600));
      const linhas = [...P.el.querySelectorAll('.p-modal .mi')].map(d => ({
        nome: ((d.querySelector('.mi-n') || {}).textContent || '').trim(),
        desc: ((d.querySelector('.mi-d') || {}).textContent || '').trim(),
      }));
      const motorDepois = P.engine;
      fecharMenus();
      P.abaId = abaAntes;
      return JSON.stringify({ eRemoto, linhas, motorDepois });
    })()`));
    checa('a aba vps e mesmo remota', r.eRemoto === true, String(r.eRemoto));
    checa('em aba remota a tecla abre a lista em vez de trocar', r.motorDepois === 'claude', String(r.motorDepois));
    const semServidor = r.linhas.filter(l => /n[aã]o roda em servidor/i.test(l.desc)).map(l => l.nome);
    checa('os quatro que so rodam local estao marcados na lista',
      ['Codex','Gemini','Grok','ACP'].every(n => semServidor.includes(n)), JSON.stringify(semServidor));
    checa('e o Claude nao esta marcado assim', !semServidor.includes('Claude'), JSON.stringify(semServidor));
  });

  await bloco('Painel estreito: o nome some, o X de fechar continua dentro', async () => {
    const r = JSON.parse(await cdp.avaliar(`(async () => {
      const P = [...panes.values()][0];
      P.engine = 'claude'; paintEngine(P);
      const medir = () => {
        const hd = P.el.querySelector('.pane-hd').getBoundingClientRect();
        /* o X de fechar e' o ULTIMO da fila e era ELE que saia da borda quando o
           interruptor de 141px empurrava tudo. Medir o botao do motor, que e' o
           primeiro, nunca poderia falhar. */
        const x = P.el.querySelector('.p-close').getBoundingClientRect();
        return {
          nomeVisivel: getComputedStyle(P.el.querySelector('.pm-nome')).display !== 'none',
          larguraBotao: Math.round(P.el.querySelector('.p-motor').getBoundingClientRect().width),
          xDentro: x.right <= hd.right + 0.5 && x.left >= hd.left - 0.5,
        };
      };
      const guardado = P.el.style.width;
      await new Promise(r => setTimeout(r, 150));
      const largo = medir();
      P.el.style.width = '300px';
      await new Promise(r => setTimeout(r, 350));
      const estreito = medir();
      P.el.style.width = '240px';
      await new Promise(r => setTimeout(r, 350));
      const minimo = medir();
      P.el.style.width = guardado;
      await new Promise(r => setTimeout(r, 250));
      return JSON.stringify({ largo, estreito, minimo });
    })()`));
    // sem medir o estado LARGO, um "display:none" incondicional passaria batido
    checa('com o painel largo o nome APARECE', r.largo.nomeVisivel === true, JSON.stringify(r.largo));
    checa('a 300px o nome some', r.estreito.nomeVisivel === false, JSON.stringify(r.estreito));
    checa('e o botao encolhe de verdade', r.estreito.larguraBotao < r.largo.larguraBotao,
      r.largo.larguraBotao + 'px -> ' + r.estreito.larguraBotao + 'px');
    checa('o X de fechar fica dentro do cabecalho a 240px (o aperto maximo)',
      r.minimo.xDentro === true, JSON.stringify(r.minimo));
  });

  await bloco('Depois de mexer em tudo', async () => {
    checa('continua sem erro no console', cdp.erros.length === 0, cdp.erros.slice(0, 4).join(' | '));
    await foto(cdp, 'leva39-botao-motor.png');
  });

  cdp.fechar();
  console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'tudo passou') + (pulados ? '  ·  ' + pulados + ' pulado(s)' : ''));
  encerrar(falhas ? 1 : 0);
})().catch((e) => {
  console.log(NL + 'ESTOUROU FORA DOS BLOCOS: ' + (e && e.message));
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
