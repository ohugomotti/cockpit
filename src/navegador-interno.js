/* ===================== NAVEGADOR INTERNO (leva 5i) =====================
   O link de site abre DENTRO do Cockpit, no visor do painel, em vez de ir ao navegador do Windows. A pagina nao e' DOM:
   e' um WebContentsView (o <webview> e' desaconselhado e o BrowserView saiu de linha) que este modulo poe por cima da
   janela, no retangulo que a tela manda (o corpo vazio do visor). Um por painel; fechar destroi, para soltar a memoria.

   Protecoes (a pagina e' de terceiros):
     - sessao propria, 'persist:cockpit-navegador': perfil limpo que guarda cookies, separado do app e do Chrome do Hugo;
     - sem preload, sem Node, com contextIsolation e sandbox: a pagina nao alcanca o window.api. O IPC do app ainda recusa
       outro webContents (cockpit-ipc-security.js); aqui so' a pagina e' travada;
     - so' http e https navegam (will-navigate e will-redirect). mailto: vai ao programa de e-mail; file:, javascript:, data:
       e protocolos proprios ficam de fora. localhost vale (previa de servidor local);
     - permissoes (camera, microfone, notificacao, localizacao...) negadas; so' o "copiar" por clique passa;
     - janela nova: popup de login (window.open com tamanho) vira janela filha na MESMA sessao, sem Node; o _blank comum
       navega na propria pagina;
     - download vai para a pasta Downloads, com nome seguro e unico, e avisa a tela quando termina.

   Este arquivo NAO depende do Electron de proposito: quem o usa injeta WebContentsView, session, shell etc. (como o acp.js).
   Assim os testes rodam sem Electron, com um falso (test/navegador-interno.test.js). */

'use strict';

const fsPadrao = require('fs');
const pathPadrao = require('path');

const PARTITION = 'persist:cockpit-navegador';
const MAX_URL = 8192;
// o que a pagina pode ser: nada de Node, nada de preload, nada de webview
const PREFERENCIAS_SEGURAS = Object.freeze({
  sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false, webviewTag: false,
  spellcheck: false,    // o corretor baixaria dicionario da rede sem ninguem pedir
  safeDialogs: true,    // alert() em lista nao prende a janela
});
// a unica permissao que passa: "copiar" por clique (botao de copiar codigo, cupom...). O resto da lista (camera, microfone, ...) e' negado.
const PERMISSOES_LIBERADAS = new Set(['clipboard-sanitized-write']);
// leva 5i, popup de login: 1 janela (2 com o 2FA). O Electron nao tem o bloqueador de popup do Chrome (a pagina pede janela sem gesto nenhum),
// entao o teto fica aqui: acima disso e' pagina enchendo a tela de janelas, e o pedido e' negado.
const MAX_FILHAS = 4;

/* Endereco que o navegador aceita: so' http/https, com host. Devolve a URL normalizada, ou '' se nao serve. */
function urlWeb(valor) {
  const s = typeof valor === 'string' ? valor.trim() : '';
  if (!s || s.length > MAX_URL || /[\u0000-\u001f\u007f]/.test(s)) return '';
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return u.hostname ? u.href : '';
}
const ehMailto = (s) => typeof s === 'string' && s.length <= 2000 && /^mailto:/i.test(s) && !/[\u0000-\u001f\u007f\s]/.test(s);

// o id do painel vem da tela: so' letras, numeros e . _ : - (o que o id real usa), no maximo 100
function chaveDoPainel(paneId) {
  const s = typeof paneId === 'number' && Number.isFinite(paneId) ? String(paneId) : typeof paneId === 'string' ? paneId : '';
  return /^[\w.:-]{1,100}$/.test(s) ? s : '';
}

/* O retangulo do corpo do visor, em px do CSS da tela. null se nao serve (numero que nao e' numero, tamanho negativo...) */
function retanguloValido(r) {
  if (!r || typeof r !== 'object') return null;
  const { x, y, width, height } = r;
  for (const n of [x, y, width, height]) if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100000) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

/* Nome de arquivo que a pagina sugere -> nome que pode ir para o disco: sem pasta, sem caractere proibido no Windows, sem nome
   reservado (CON, NUL...), sem ponto ou espaco no fim, de tamanho razoavel. Nunca vazio. */
function nomeSeguro(nome, path = pathPadrao) {
  let s = path.basename(String(nome == null ? '' : nome).replace(/\\/g, '/'));
  s = s.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/[. ]+$/, '');
  if (/^\.*$/.test(s)) s = 'download';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(s)) s = '_' + s;
  if (s.length > 150) { const ext = path.extname(s).slice(0, 20); s = s.slice(0, 150 - ext.length) + ext; }
  return s;
}

// popup de login = window.open com caracteristicas de janela (tamanho). Aba comum (target=_blank, window.open(url)) nao e' popup.
const ehPopup = (d) => !!d && (d.disposition === 'new-window' || /(?:^|[,\s])(?:width|height|popup)\b/i.test(String(d.features || '')));
// o loadURL rejeita quando a navegacao e' trocada no meio (ERR_ABORTED) ou falha (a propria pagina de erro do Chromium ja mostra o motivo)
const ehErroDeCarga = (e) => !!e && (typeof e.code === 'string' && e.code.startsWith('ERR_') || typeof e.errno === 'number');

function criarNavegadorInterno(dep) {
  const {
    WebContentsView, session, shell, getWindow,
    pastaDownloads = () => '', emit = () => {}, log = () => {},
    fs = fsPadrao, path = pathPadrao,
  } = dep || {};
  const registros = new Map();     // id do painel -> { paneId, view, wc, filhas, rect, visivel, urlPedida, ultimoEstado }
  const donos = new Map();         // id do webContents (da pagina e das janelas filhas) -> id do painel (o download precisa)
  const reservados = new Set();    // caminhos de download em andamento (dois "relatorio.pdf" ao mesmo tempo nao se pisam)
  let sessao = null;

  const anotar = (contexto, erro) => { try { log(contexto, erro); } catch { /* o registro nao pode derrubar quem registra */ } };
  // quem avisa a tela roda dentro de evento do Electron: um erro aqui (janela que fechou no meio) viraria excecao do processo principal
  const avisar = (canal, dados) => { try { emit(canal, dados); } catch (e) { anotar('navegador:avisar', e); } };
  const janela = () => { const w = getWindow && getWindow(); return w && !w.isDestroyed() ? w : null; };
  const doPainel = (paneId) => { const k = chaveDoPainel(paneId); return k ? registros.get(k) || null : null; };

  /* ---------- a sessao: configurada uma vez, no primeiro uso (o Electron so' entrega a sessao depois do 'ready') ---------- */
  function sessaoDoNavegador() {
    if (sessao) return sessao;
    const s = session.fromPartition(PARTITION);
    const liberada = (permissao) => PERMISSOES_LIBERADAS.has(permissao);
    s.setPermissionRequestHandler((_wc, permissao, responder) => responder(liberada(permissao)));
    s.setPermissionCheckHandler((_wc, permissao) => liberada(permissao));
    if (typeof s.setDevicePermissionHandler === 'function') s.setDevicePermissionHandler(() => false);
    if (typeof s.setDisplayMediaRequestHandler === 'function') s.setDisplayMediaRequestHandler((_pedido, responder) => responder({}));
    s.on('will-download', aoBaixar);
    sessao = s;
    return s;
  }

  function aoBaixar(evento, item, wc) {
    const paneId = wc && donos.get(wc.id);
    if (!paneId) return;   // nao e' de uma pagina do navegador (so' ele usa esta sessao)
    try {
      const pasta = pastaDownloads();
      const caminho = caminhoLivre(pasta, nomeSeguro(item.getFilename(), path));
      item.setSavePath(caminho);   // com o caminho dado na hora, o Windows nao abre o "Salvar como"
      item.once('done', (_e, estado) => {
        reservados.delete(caminho.toLowerCase());
        if (estado === 'completed') avisar('navegador:download', { paneId, nome: path.basename(caminho), caminho });
      });
    } catch (e) {
      anotar('navegador:download', e);
      try { evento.preventDefault(); } catch (e2) { anotar('navegador:download-cancelar', e2); }
    }
  }
  // "nome.ext" livre na pasta; se ja' existe, "nome (1).ext", "nome (2).ext"...
  function caminhoLivre(pasta, nome) {
    const ext = path.extname(nome), base = nome.slice(0, nome.length - ext.length);
    for (let n = 0; n < 1000; n++) {
      const caminho = path.join(pasta, n === 0 ? nome : base + ' (' + n + ')' + ext);
      const chave = caminho.toLowerCase();
      if (!reservados.has(chave) && !fs.existsSync(caminho)) { reservados.add(chave); return caminho; }
    }
    const caminho = path.join(pasta, Date.now() + '-' + nome);
    reservados.add(caminho.toLowerCase());
    return caminho;
  }

  /* ---------- a pagina ---------- */
  function abrirNoSistema(url) {
    try {
      const feito = shell.openExternal(url);
      if (feito && typeof feito.catch === 'function') feito.catch((e) => anotar('navegador:externo', e));
    } catch (e) { anotar('navegador:externo', e); }
  }
  function navegar(wc, url) {
    try {
      const feito = wc.loadURL(url);
      if (feito && typeof feito.catch === 'function') feito.catch((e) => { if (!ehErroDeCarga(e)) anotar('navegador:carregar', e); });
    } catch (e) { anotar('navegador:carregar', e); }
  }

  // so' http/https navegam; mailto: vai ao sistema; o resto (file:, javascript:, data:, protocolos proprios) nem comeca
  function travarNavegacao(wc) {
    const barrar = (e, urlAntiga) => {
      const url = String((e && e.url) || urlAntiga || '');   // o Electron novo manda a URL no evento; o antigo, como 2o argumento
      if (urlWeb(url)) return;
      e.preventDefault();
      if (ehMailto(url)) abrirNoSistema(url);
    };
    wc.on('will-navigate', barrar);
    wc.on('will-redirect', barrar);
    wc.on('will-attach-webview', (e) => e.preventDefault());
  }

  /* Janela nova pedida pela pagina. Popup de login (window.open com tamanho) abre como janela filha, na mesma sessao e sem Node
     (o OAuth precisa do window.opener para devolver o resultado). O resto (target=_blank, window.open(url)) NAO abre janela:
     a propria pagina navega. 'dono' e' o webContents que pediu: a pagina ou uma filha dela. */
  function politicaDeJanela(rec, dono) {
    return (detalhes) => {
      const url = String((detalhes && detalhes.url) || '');
      if (ehPopup(detalhes)) {
        // o OAuth costuma abrir about:blank e navegar depois: a navegacao seguinte passa pelo mesmo filtro
        if (!urlWeb(url) && url !== '' && !/^about:blank$/i.test(url)) return { action: 'deny' };
        if (rec.filhas.size >= MAX_FILHAS) return { action: 'deny' };   // a cota e' do painel inteiro (a neta tambem conta); fechar uma janela libera a vaga
        return { action: 'allow', overrideBrowserWindowOptions: opcoesDaFilha() };
      }
      if (ehMailto(url)) abrirNoSistema(url);
      else { const alvo = urlWeb(url); if (alvo) navegar(dono, alvo); }
      return { action: 'deny' };
    };
  }
  function opcoesDaFilha() {
    const w = janela();
    return {
      ...(w ? { parent: w } : {}), autoHideMenuBar: true, show: true,
      // sem preload; a partition e' a da pagina que abriu (o Electron ja' a herda, aqui so' fica dito)
      webPreferences: { ...PREFERENCIAS_SEGURAS, partition: PARTITION },
    };
  }
  function protegerFilha(rec, filha) {
    try {
      const wc = filha.webContents, id = wc.id;
      rec.filhas.add(filha);
      donos.set(id, rec.paneId);
      wc.setWindowOpenHandler(politicaDeJanela(rec, wc));
      wc.on('did-create-window', (neta) => protegerFilha(rec, neta));   // popup dentro de popup: a mesma trava
      travarNavegacao(wc);
      // o menu do app tem atalhos que agem na conversa (Ctrl+W fecha o painel): a janela de login nao os leva
      if (typeof filha.removeMenu === 'function') filha.removeMenu();
      filha.once('closed', () => { rec.filhas.delete(filha); donos.delete(id); });
    } catch (e) { anotar('navegador:filha', e); }
  }

  /* ---------- o que a tela pode ver ---------- */
  function estadoDe(rec) {
    const wc = rec.wc, historico = wc.navigationHistory;
    return {
      paneId: rec.paneId,
      url: wc.getURL() || rec.urlPedida || '',
      titulo: wc.getTitle() || '',
      podeVoltar: !!(historico && historico.canGoBack()),
      podeAvancar: !!(historico && historico.canGoForward()),
      carregando: !!wc.isLoading(),
    };
  }
  function emitirEstado(rec) {
    if (registros.get(rec.paneId) !== rec || rec.wc.isDestroyed()) return;
    let estado;
    try { estado = estadoDe(rec); } catch (e) { anotar('navegador:estado', e); return; }
    const chave = JSON.stringify(estado);
    if (chave === rec.ultimoEstado) return;   // nada mudou: a tela nao precisa saber de novo
    rec.ultimoEstado = chave;
    avisar('navegador:estado', estado);
  }

  /* Teclas que, com o foco na pagina, passariam para o menu do app: Ctrl+R/F5 recarregariam o COCKPIT (e derrubariam os motores).
     Aqui viram "recarregar a pagina", como em qualquer navegador; Alt+setas voltam e avancam.
     Rodada 2 da leva 5i: Ctrl+W, Esc e Ctrl+L tambem ficam aqui. Antes o Ctrl+W passava para o menu do app, onde o "Fechar" da janela
     (role windowMenu) ganhava do "Fechar painel" e fechava o COCKPIT INTEIRO. Agora a tecla nem sai da pagina: o main avisa a tela
     (navegador:tecla) e quem fecha e' a tela, pelo mesmo caminho do ✕ (fecharVisor, que solta a pagina deste painel e so' ela).
     Ctrl+L leva o foco para a barra de endereco. Sem Shift e sem Alt (Ctrl+Alt e' o AltGr do teclado ABNT2); tecla segurada
     (isAutoRepeat) e composicao de texto (IME) nao agem de novo: so' o 1o toque vale. */
  function ligarTeclado(rec) {
    rec.wc.on('before-input-event', (evento, entrada) => {
      if (!entrada || entrada.type !== 'keyDown') return;
      const tecla = String(entrada.key || '').toLowerCase();
      const comando = !!(entrada.control || entrada.meta);
      const semModificador = !entrada.shift && !entrada.alt;
      /* conferencia da rodada 2 da leva 5i (achado B): o Esc fica com a PAGINA (fecha o dialogo dela, cancela um campo); antes ele
         fechava o navegador inteiro e jogava fora o que estava digitado. Fechar e' pelo Ctrl+W ou pelo ✕. */
      const daTela = comando && semModificador && (tecla === 'w' || tecla === 'l');
      if (daTela) {
        evento.preventDefault();
        if (entrada.isAutoRepeat || entrada.isComposing) return;
        if (tecla === 'l') devolverFocoSeEraDaPagina(rec);   // o campo de endereco e' da tela: o teclado vai junto
        avisar('navegador:tecla', { paneId: rec.paneId, tecla: tecla === 'l' ? 'endereco' : 'fechar' });
        return;
      }
      if ((comando && tecla === 'r') || tecla === 'f5') {
        evento.preventDefault();
        if (entrada.shift || comando && tecla === 'f5') rec.wc.reloadIgnoringCache(); else rec.wc.reload();
      } else if (entrada.alt && !comando && (tecla === 'arrowleft' || tecla === 'arrowright')) {
        evento.preventDefault();
        const h = rec.wc.navigationHistory;
        if (h && tecla === 'arrowleft' && h.canGoBack()) h.goBack();
        else if (h && tecla === 'arrowright' && h.canGoForward()) h.goForward();
      }
    });
  }

  function ligarEventos(rec) {
    const wc = rec.wc;
    travarNavegacao(wc);
    wc.setWindowOpenHandler(politicaDeJanela(rec, wc));
    wc.on('did-create-window', (filha) => protegerFilha(rec, filha));
    for (const evento of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-fail-load']) {
      wc.on(evento, () => emitirEstado(rec));
    }
    wc.on('render-process-gone', (_e, detalhes) => {
      anotar('navegador:pagina-caiu', new Error('A pagina do navegador interno caiu: ' + String((detalhes && detalhes.reason) || '?')));
      emitirEstado(rec);
    });
    ligarTeclado(rec);
  }

  /* ---------- posicao: o retangulo vem em px do CSS da tela; o setBounds quer DIP, que e' px x zoom da janela ---------- */
  function zoomDaJanela() {
    try {
      const w = janela();
      const z = w && w.webContents && typeof w.webContents.getZoomFactor === 'function' ? w.webContents.getZoomFactor() : 1;
      return Number.isFinite(z) && z > 0 ? z : 1;
    } catch (e) { anotar('navegador:zoom', e); return 1; }
  }
  function aplicarPosicao(rec) {
    if (!rec.rect) return;
    const z = zoomDaJanela(), r = rec.rect;
    rec.view.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) });
  }
  // a pagina nativa fica ACIMA de qualquer HTML: ao esconder, o foco volta para a tela (senao o teclado ficaria preso numa pagina invisivel)
  function devolverFocoSeEraDaPagina(rec) {
    try {
      const w = janela();
      if (w && rec.wc.isFocused && rec.wc.isFocused() && typeof w.webContents.focus === 'function') w.webContents.focus();
    } catch (e) { anotar('navegador:foco', e); }
  }

  /* ---------- a API ---------- */
  function abrir(paneId, url, rect) {
    const chave = chaveDoPainel(paneId);
    if (!chave) return { ok: false, erro: 'Painel inválido.' };
    const alvo = urlWeb(url);
    if (!alvo) return { ok: false, erro: 'Só abro endereços http e https.' };
    const w = janela();
    if (!w) return { ok: false, erro: 'A janela do Cockpit não está pronta.' };
    let rec = registros.get(chave);
    if (rec && rec.wc.isDestroyed()) { descartar(rec); rec = null; }
    if (rec) {   // ja' tem pagina neste painel: reaproveita, so' navega
      rec.urlPedida = alvo;
      const r = retanguloValido(rect);
      if (r) { rec.rect = r; aplicarPosicao(rec); }
      navegar(rec.wc, alvo);
      return { ok: true };
    }
    let view = null;
    try {
      sessaoDoNavegador();
      view = new WebContentsView({ webPreferences: { ...PREFERENCIAS_SEGURAS, partition: PARTITION } });
      rec = { paneId: chave, view, wc: view.webContents, idWc: view.webContents.id, filhas: new Set(), rect: null, visivel: true, urlPedida: alvo, ultimoEstado: '' };
      registros.set(chave, rec);
      donos.set(rec.idWc, chave);
      ligarEventos(rec);
      w.contentView.addChildView(view);
      const r = retanguloValido(rect);
      if (r) { rec.rect = r; aplicarPosicao(rec); }
      navegar(rec.wc, alvo);
      emitirEstado(rec);
      return { ok: true };
    } catch (e) {
      anotar('navegador:abrir', e);
      if (rec) descartar(rec);
      else if (view) { try { view.webContents.close(); } catch (e2) { anotar('navegador:abrir-limpar', e2); } }
      return { ok: false, erro: 'Não consegui abrir o navegador.' };
    }
  }

  function posicionar(paneId, rect) {
    const rec = doPainel(paneId), r = retanguloValido(rect);
    if (!rec || !r) return { ok: false };
    rec.rect = r;
    aplicarPosicao(rec);
    return { ok: true };
  }

  function visivel(paneId, mostrar) {
    const rec = doPainel(paneId);
    if (!rec) return { ok: false };
    rec.visivel = !!mostrar;
    try {
      if (typeof rec.view.setVisible === 'function') rec.view.setVisible(rec.visivel);
      else { const w = janela(); if (w) { if (rec.visivel) w.contentView.addChildView(rec.view); else w.contentView.removeChildView(rec.view); } }
    } catch (e) { anotar('navegador:visivel', e); return { ok: false }; }
    if (rec.visivel) aplicarPosicao(rec); else devolverFocoSeEraDaPagina(rec);
    return { ok: true };
  }

  const historico = (paneId, sentido) => {
    const rec = doPainel(paneId);
    if (!rec) return { ok: false };
    const h = rec.wc.navigationHistory;
    if (sentido < 0 && h && h.canGoBack()) h.goBack();
    else if (sentido > 0 && h && h.canGoForward()) h.goForward();
    return { ok: true };
  };
  const voltar = (paneId) => historico(paneId, -1);
  const avancar = (paneId) => historico(paneId, 1);

  function recarregar(paneId, semCache) {
    const rec = doPainel(paneId);
    if (!rec) return { ok: false };
    if (semCache) rec.wc.reloadIgnoringCache(); else rec.wc.reload();
    return { ok: true };
  }
  function parar(paneId) {
    const rec = doPainel(paneId);
    if (!rec) return { ok: false };
    rec.wc.stop();
    return { ok: true };
  }
  function irPara(paneId, url) {
    const rec = doPainel(paneId), alvo = urlWeb(url);
    if (!rec) return { ok: false };
    if (!alvo) return { ok: false, erro: 'Só abro endereços http e https.' };
    rec.urlPedida = alvo;
    navegar(rec.wc, alvo);
    return { ok: true };
  }
  // a pagina que esta' na tela vai para o navegador do Windows (so' http/https: a URL vem da propria pagina). Antes da pagina
  // confirmar o endereco (getURL vazio) vale o que foi pedido.
  function externo(paneId) {
    const rec = doPainel(paneId);
    if (!rec) return { ok: false };
    const url = urlWeb(rec.wc.getURL() || rec.urlPedida);
    if (!url) return { ok: false, erro: 'Esta página não tem um endereço para abrir fora.' };
    abrirNoSistema(url);
    return { ok: true };
  }

  // tira da janela e DESTROI (webContents.close): o WebContentsView nao se solta sozinho, e cada pagina e' um processo
  function descartar(rec) {
    registros.delete(rec.paneId);
    for (const [id, dono] of [...donos]) if (dono === rec.paneId) donos.delete(id);
    for (const filha of [...rec.filhas]) { try { if (!filha.isDestroyed()) filha.destroy(); } catch (e) { anotar('navegador:fechar-filha', e); } }
    rec.filhas.clear();
    devolverFocoSeEraDaPagina(rec);
    try { const w = janela(); if (w) w.contentView.removeChildView(rec.view); } catch (e) { anotar('navegador:remover', e); }
    try { if (!rec.wc.isDestroyed()) rec.wc.close(); } catch (e) { anotar('navegador:fechar', e); }
  }
  function fechar(paneId) {
    const rec = doPainel(paneId);
    if (rec) descartar(rec);
    return { ok: true };
  }
  function fecharTodos() {
    for (const rec of [...registros.values()]) descartar(rec);
  }

  return Object.freeze({
    abrir, posicionar, visivel, voltar, avancar, recarregar, parar, irPara, externo, fechar, fecharTodos,
    abertos: () => [...registros.keys()],
  });
}

module.exports = { criarNavegadorInterno, PARTITION, PREFERENCIAS_SEGURAS, urlWeb, nomeSeguro, retanguloValido, chaveDoPainel };
