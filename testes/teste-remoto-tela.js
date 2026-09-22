/* Leva 37 / Fase B: a TELA lendo dentro de um servidor -- arvore, "@" e visor.

   As funcoes sao recortadas do app.js de verdade e rodadas dentro de um vm com
   uma telinha de mentira, entao o que passa aqui e' o comportamento do codigo
   que vai pro asar, nao uma copia. O que este teste segura:
     a) a arvore NAO sai mais cedo em painel remoto -- ela lista o servidor;
     b) o 'expanded' tem namespace por alvo (o mesmo caminho em dois hosts nao
        e' a mesma pasta);
     c) o treeGen e' respeitado TAMBEM no ramo remoto (resposta lenta de SSH nao
        pinta a arvore do painel que voce ja' deixou pra tras);
     d) ANEXO continua local: a ficha passa remoto nulo de proposito;
     e) o "@" trata as DUAS formas de resposta (lista crua no local,
        { itens, error } no remoto) e mostra o erro em vez de lista vazia;
     f) o visor roteia pelo PAINEL, nunca pelo formato do caminho. */
const vm = require('vm');
const { lerFonte, globaisFalsos, pegarBloco } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
const preload = lerFonte('preload.js');
let falhas = 0;
const checa = (nome, ok, det) => {
  if (ok) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};
const NL = String.fromCharCode(10);

/* ---- telinha de mentira: o minimo que o codigo da tela toca ---- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = ''; this.style = {}; this.dataset = {};
    this.filhos = []; this.texto = ''; this._html = ''; this.eventos = {};
    this.classes = new Set(); this._achados = new Map(); this.pai = null;
  }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => eu.classes.add(x)),
      remove: (...c) => c.forEach((x) => eu.classes.delete(x)),
      contains: (c) => eu.classes.has(c),
      toggle: (c, v) => {
        const liga = v === undefined ? !eu.classes.has(c) : !!v;
        if (liga) eu.classes.add(c); else eu.classes.delete(c);
        return liga;
      },
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.filhos = []; }
  get textContent() { return this.texto || this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.filhos = []; }
  appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
  addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
  async disparar(n, ev) { for (const f of (this.eventos[n] || [])) await f(ev || {}); }
  scrollIntoView() {}
  focus(options) { this.focusOptions = options; }
  contains(node) { for (let p = node; p; p = p.pai) if (p === this) return true; return false; }
  closest(sel) { for (let p = this; p; p = p.pai) { if (sel === '.hidden,[hidden]' && (p.hidden || p.classList.contains('hidden'))) return p; } return null; }
  getClientRects() { return this.closest('.hidden,[hidden]') ? [] : [{}]; }
  // busca de mentira: cria o filho sob demanda so' pra o codigo poder escrever nele
  buscar(sel) {
    if (!this._achados.has(sel)) this._achados.set(sel, new El('span'));
    return this._achados.get(sel);
  }
  get isConnected() { return true; }
  querySelectorAll() { return []; }
}
const documentoFalso = {
  createElement: (t) => new El(t),
  createTextNode: (t) => { const e = new El('#text'); e.texto = String(t); return e; },
  createDocumentFragment: () => new El('#frag'),
};

/* =====================================================================
   1) ARVORE dentro do servidor
   ===================================================================== */
console.log('1) arvore de arquivos dentro do servidor');

const trechoArvore = app.slice(
  app.indexOf('/* ============ arvore de arquivos ============ */'),
  app.indexOf('function icon(name) {'));
if (trechoArvore.length < 200) throw new Error('nao achei o trecho da arvore no app.js');

const caixaTree = new El('div');
const nomeProjeto = new El('span');
const chamadas = [];              // o que a tela pediu ao processo principal
let respostaLista = { entries: [] };
let antesDeResponder = null;      // gancho pra mexer no estado no meio da ida e volta
const visorPedidos = [];

const ctxA = {
  ...globaisFalsos(), console,
  document: documentoFalso,
  $: (sel, raiz) => {
    if (raiz && raiz.buscar) return raiz.buscar(sel);
    if (sel === '#tree') return caixaTree;
    if (sel === '#projName') return nomeProjeto;
    return new El('div');
  },
  ico: (n) => '<i>' + n + '</i>',
  icon: (n) => '<i>' + n + '</i>',
  note: () => {},
  HOME: 'C:\\Users\\hugom',
  ESTE_PC: 'PC',
  baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
  focusPane: { id: 'p1', el: new El('div'), abaId: 'vps' },
  remotoDoPane: () => ({ usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' }),
  faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
  AVISO_ABA_EM_BRANCO: 'Esta aba ainda não tem servidor configurado — preencha usuário, host e chave em Editar aba.',
  verArquivo: (P, caminho, remoto) => { visorPedidos.push({ caminho, remoto }); },
  window: {
    api: {
      listDir: async (dir, remoto) => {
        chamadas.push({ dir, remoto, htmlNaHora: caixaTree.innerHTML });
        // await de proposito: alguns testes precisam MEXER na tela no meio da
        // ida e volta (trocar de painel, fechar a pasta) antes da resposta
        if (antesDeResponder) await antesDeResponder(dir);
        // funcao quando o teste precisa de conteudo diferente por pasta
        return typeof respostaLista === 'function' ? respostaLista(dir) : respostaLista;
      },
      openPath: async () => ({}),
    },
  },
};
vm.createContext(ctxA);
vm.runInContext(trechoArvore, ctxA);
// 'let treeGen' e 'const expanded' sao lexicais: leem-se por expressao no proprio contexto
const leia = (expr) => vm.runInContext(expr, ctxA);

const nosPintados = (caixa) => caixa.filhos.filter((f) => String(f.className).startsWith('node'))
  .map((f) => f.buscar('.nm').texto);

async function arvore() {
  /* --- a) nao sai mais cedo: em painel remoto ele LISTA --- */
  chamadas.length = 0;
  respostaLista = { entries: [
    { name: 'app', dir: true, path: '/home/hugo/app' },
    { name: 'leia.md', dir: false, path: '/home/hugo/leia.md' },
  ] };
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1', chave: 'k' });

  checa('a) a arvore chama o listDir com o remoto do painel (nao sai mais cedo)',
    chamadas.length === 1 && chamadas[0].dir === '/home/hugo' && chamadas[0].remoto && chamadas[0].remoto.host === 'vps1',
    JSON.stringify(chamadas));
  checa('a) e pinta as pastas e arquivos do servidor',
    nosPintados(caixaTree).join(',') === 'app,leia.md', nosPintados(caixaTree).join(','));
  checa('a) mostra "carregando" ENQUANTO o SSH nao volta (lento nao pode parecer quebrado)',
    /tree-carregando/.test(chamadas[0].htmlNaHora), chamadas[0].htmlNaHora);
  checa('a) e o "carregando" sai quando a lista chega', !/tree-carregando/.test(caixaTree.innerHTML));
  checa('a) o nome do projeto vira o alvo do servidor', nomeProjeto.texto === '🖧 hugo@vps1', nomeProjeto.texto);

  /* --- o ramo LOCAL segue identico: sem 'remoto' e sem "carregando" --- */
  chamadas.length = 0;
  await ctxA.loadTree('C:\\Users\\hugom', undefined);
  checa('local: o listDir vai SEM remoto, byte por byte como antes',
    chamadas.length === 1 && chamadas[0].remoto === undefined, JSON.stringify(chamadas[0]));
  checa('local: nao aparece "lendo o servidor" no meio do caminho',
    !/tree-carregando/.test(chamadas[0].htmlNaHora), chamadas[0].htmlNaHora);
  checa('local: o nome do projeto continua a pasta, nao o 🖧',
    nomeProjeto.texto === 'Pasta: PC inteiro', nomeProjeto.texto);

  /* --- erro do servidor aparece como ERRO, nunca como pasta vazia --- */
  respostaLista = { error: 'O servidor (vps1) recusou a chave. Confira o arquivo da chave e o usuário em Editar aba.' };
  await ctxA.loadTree('~', { usuario: 'hugo', host: 'vps1' });
  const aviso = caixaTree.filhos.find((f) => f.className === 'hint');
  checa('erro de rede vira frase em portugues na arvore, nao lista vazia',
    !!aviso && /recusou a chave/.test(aviso.texto), aviso ? aviso.texto : '(nada)');
  checa('e o motivo entra como TEXTO, nao como marcacao', !!aviso && aviso.texto.length > 0 && aviso.filhos.length === 0);

  /* --- aba de servidor em branco (a que o Cockpit ja' vem com ela) --- */
  chamadas.length = 0;
  respostaLista = { entries: [{ name: 'nao-devia-aparecer', dir: false, path: 'x' }] };
  await ctxA.loadTree('~', { usuario: '', host: '', chave: '', caminhoRemoto: '~' });
  const emBranco = caixaTree.filhos.find((f) => f.className === 'hint');
  checa('aba de servidor em branco: nao pede nada (senao o main leria o disco DESTE PC calado)',
    chamadas.length === 0, JSON.stringify(chamadas));
  checa('aba de servidor em branco: diz o que falta preencher',
    !!emBranco && /não tem servidor configurado/.test(emBranco.texto), emBranco ? emBranco.texto : '(nada)');

  /* --- b) namespace do 'expanded' --- */
  console.log(NL + '2) o "expanded" tem namespace por alvo');
  const k1 = leia("chaveAberta({ usuario: 'hugo', host: 'vps1' }, '/home/hugo/x')");
  const k2 = leia("chaveAberta({ usuario: 'hugo', host: 'vps2' }, '/home/hugo/x')");
  const kp = leia("chaveAberta({ usuario: 'hugo', host: 'vps1', porta: 2222 }, '/home/hugo/x')");
  const kc = leia("chaveAberta({ usuario: 'hugo', host: 'vps1', chave: 'outra-chave' }, '/home/hugo/x')");
  const kl = leia("chaveAberta(null, '/home/hugo/x')");
  checa('b) o mesmo caminho em dois servidores nao e a mesma chave', k1 !== k2, k1 + ' vs ' + k2);
  checa('b) e nenhum dos dois e o deste PC', k1 !== kl && kl.startsWith('local|'), kl);
  checa('b) a chave leva usuario@host, porta padrao, chave SSH e caminho', k1 === 'hugo@vps1:22||/home/hugo/x', k1);
  checa('b) o mesmo host em outra porta e outro destino', kp === 'hugo@vps1:2222||/home/hugo/x' && kp !== k1, kp);
  checa('b) outra chave SSH tambem isola a expansao', kc === 'hugo@vps1:22|outra-chave|/home/hugo/x' && kc !== k1, kc);
  checa('b) porta 22 explicita e implicita identificam o mesmo destino',
    leia("chaveAberta({ usuario: 'hugo', host: 'vps1', porta: 22 }, '/home/hugo/x')") === k1);

  // prova de verdade: pasta aberta no vps1 nao pode nascer aberta no vps2
  leia('expanded.clear()');
  leia("expanded.add(chaveAberta({ usuario: 'hugo', host: 'vps1' }, '/home/hugo/app'))");
  // conteudo diferente por pasta, senao a pasta aberta se conteria e nao pararia nunca
  respostaLista = (dir) => (dir === '/home/hugo'
    ? { entries: [{ name: 'app', dir: true, path: '/home/hugo/app' }] }
    : { entries: [{ name: 'main.js', dir: false, path: '/home/hugo/app/main.js' }] });

  chamadas.length = 0;
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps2' });
  checa('b) no OUTRO servidor a pasta nasce fechada (uma chamada so: a raiz)',
    chamadas.length === 1, chamadas.length + ' chamadas');

  chamadas.length = 0;
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1' });
  checa('b) no servidor certo ela nasce aberta (raiz + a pasta lembrada)',
    chamadas.length === 2 && chamadas[1].dir === '/home/hugo/app', chamadas.length + ' chamadas');

  chamadas.length = 0;
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1', porta: 2222 });
  checa('b) mesmo servidor em outra porta nao herda a pasta aberta',
    chamadas.length === 1 && chamadas[0].remoto.porta === 2222, JSON.stringify(chamadas));

  chamadas.length = 0;
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1', chave: 'outra-chave' });
  checa('b) outra chave SSH nao herda a pasta aberta',
    chamadas.length === 1 && chamadas[0].remoto.chave === 'outra-chave', JSON.stringify(chamadas));

  chamadas.length = 0;
  await ctxA.loadTree('/home/hugo', null);
  checa('b) e neste PC o mesmo caminho tambem nasce fechado',
    chamadas.length === 1, chamadas.length + ' chamadas');
  leia('expanded.clear()');

  /* --- c) treeGen no ramo remoto --- */
  console.log(NL + '3) o treeGen segura a resposta lenta do SSH');
  respostaLista = { entries: [{ name: 'do-painel-velho.txt', dir: false, path: '/home/hugo/velho.txt' }] };
  // simula: enquanto o SSH nao volta, o usuario troca de painel (setFocus -> loadTree -> ++treeGen)
  antesDeResponder = () => leia('treeGen++');
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1' });
  antesDeResponder = null;
  checa('c) resposta que chegou tarde NAO pinta a arvore do painel novo',
    nosPintados(caixaTree).length === 0, nosPintados(caixaTree).join(','));
  checa('c) e o loadTree incrementa o treeGen (e o que cancela o carregamento anterior)',
    /const gen = \+\+treeGen;/.test(trechoArvore));
  checa('c) o gen atravessa TAMBEM o ramo remoto (level leva gen e remoto juntos)',
    /await level\(dir, box, 0, gen, remoto\)/.test(trechoArvore)
    && /await level\(e\.path, kids, depth \+ 1, gen, remoto\)/.test(trechoArvore));

  /* --- duplo clique no remoto abre no VISOR, nao no shell do Windows --- */
  console.log(NL + '4) duplo clique no arquivo');
  respostaLista = { entries: [{ name: 'app.js', dir: false, path: '/home/hugo/app.js' }] };
  visorPedidos.length = 0;
  await ctxA.loadTree('/home/hugo', { usuario: 'hugo', host: 'vps1' });
  await caixaTree.filhos.find((f) => f.className === 'node f').disparar('dblclick');
  checa('no servidor o duplo clique abre no visor remoto (nao tenta abrir no Windows)',
    visorPedidos.length === 1 && visorPedidos[0].caminho === '/home/hugo/app.js'
    && !!visorPedidos[0].remoto, JSON.stringify(visorPedidos));

  let abriuNoPc = 0;
  ctxA.window.api.openPath = async () => { abriuNoPc++; return {}; };
  visorPedidos.length = 0;
  respostaLista = { entries: [{ name: 'a.txt', dir: false, path: 'C:\\Users\\hugom\\a.txt' }] };
  await ctxA.loadTree('C:\\Users\\hugom', undefined);
  await caixaTree.filhos.find((f) => f.className === 'node f').disparar('dblclick');
  checa('local: o duplo clique continua abrindo no PC, como sempre',
    abriuNoPc === 1 && visorPedidos.length === 0);

  /* =====================================================================
     ACHADO 3 da auditoria: a arvore do painel VELHO despejava itens na
     arvore do painel NOVO.
     O 'for' do level nao reconferia o gen DEPOIS do await de uma subpasta.
     Prova de campo: trocando de painel no meio, a lista final ficava
     ['SO-DO-B.md', 'A-DEPOIS-1.md', 'A-DEPOIS-2.md'] -- o primeiro item do
     servidor B com dois do servidor A grudados embaixo. Clicar num intruso
     colava caminho do servidor A na mensagem do painel B.
     ===================================================================== */
  console.log(NL + '4b) achado 3: item do servidor A nao entra na arvore do servidor B');
  leia('expanded.clear()');
  const alvoA = { usuario: 'hugo', host: 'vpsA', chave: 'k' };
  const alvoB = { usuario: 'hugo', host: 'vpsB', chave: 'k' };
  leia("expanded.add(chaveAberta({ usuario: 'hugo', host: 'vpsA', chave: 'k' }, '/A/sub'))");   // a subpasta ja' estava aberta no A
  respostaLista = (dir) => {
    if (dir === '/A') return { entries: [
      { name: 'sub', dir: true, path: '/A/sub' },
      { name: 'A-DEPOIS-1.md', dir: false, path: '/A/A-DEPOIS-1.md' },
      { name: 'A-DEPOIS-2.md', dir: false, path: '/A/A-DEPOIS-2.md' },
    ] };
    if (dir === '/B') return { entries: [{ name: 'SO-DO-B.md', dir: false, path: '/B/SO-DO-B.md' }] };
    return { entries: [] };
  };
  let trocou = false;
  antesDeResponder = async (dir) => {
    if (dir !== '/A/sub' || trocou) return;
    trocou = true;
    const guarda = antesDeResponder; antesDeResponder = null;
    await ctxA.loadTree('/B', alvoB);        // voce trocou de painel no meio da espera
    antesDeResponder = guarda;
  };
  await ctxA.loadTree('/A', alvoA);
  antesDeResponder = null;
  checa('(3) a troca de servidor ocorreu durante a leitura da subpasta', trocou);
  checa('(3) a arvore fica SO com o que e do servidor em foco',
    nosPintados(caixaTree).join(',') === 'SO-DO-B.md', nosPintados(caixaTree).join(','));
  checa('(3) o laco do level reconfere o gen a cada volta, nao so na entrada',
    /for \(const e of \(r\.entries \|\| \[\]\)\) \{\s*(\/\*[\s\S]*?\*\/\s*)?if \(gen !== undefined && gen !== treeGen\) return;/.test(trechoArvore));

  /* =====================================================================
     ACHADO 4: duplo clique numa pasta remota pintava os filhos debaixo de
     uma pasta JA' FECHADA. 1o clique abre e dispara o SSH; 2o fecha; a
     resposta chega depois e pinta assim mesmo -- ficava chevron-right com
     expanded=false e filhos a' vista.
     ===================================================================== */
  console.log(NL + '4c) achado 4: pasta fechada no meio da espera nao ganha filhos');
  leia('expanded.clear()');
  respostaLista = (dir) => (dir === '/A'
    ? { entries: [{ name: 'sub', dir: true, path: '/A/sub' }] }
    : { entries: [{ name: 'filho.md', dir: false, path: '/A/sub/filho.md' }] });
  await ctxA.loadTree('/A', alvoA);
  const noPasta = caixaTree.filhos.find((f) => String(f.className).startsWith('node d'));
  const kids = caixaTree.filhos[caixaTree.filhos.indexOf(noPasta) + 1];
  let soltarSsh;
  const esperaSsh = new Promise((ok) => { soltarSsh = ok; });
  antesDeResponder = async (dir) => { if (dir === '/A/sub') await esperaSsh; };
  const primeiroClique = noPasta.disparar('click');   // abre: dispara o SSH e fica esperando
  await noPasta.disparar('click');                    // 2o clique: fecha antes da resposta
  soltarSsh();                                        // agora o servidor responde
  await primeiroClique;
  antesDeResponder = null;
  checa('(4) resposta atrasada nao pinta filho debaixo de pasta fechada',
    kids.filhos.length === 0 && kids.innerHTML === '', kids.filhos.length + ' filhos / html=' + JSON.stringify(kids.innerHTML));
  checa('(4) e a seta fica coerente com o estado (fechada)',
    /chevron-right/.test(noPasta.buscar('.chev').innerHTML) && !leia("expanded.has(chaveAberta({ usuario: 'hugo', host: 'vpsA', chave: 'k' }, '/A/sub'))"),
    noPasta.buscar('.chev').innerHTML);
}

/* =====================================================================
   ACHADO 1: trocar pra aba VPS abria 13 conexoes SSH e jogava 12 fora.
   O 'restaurarPaineisMiolo' chama newPane por conversa salva, cada newPane
   termina em setFocus, e no remoto o setFocus carregava a arvore -- uma ida
   ao servidor POR PAINEL. O treeGen descartava as 12 primeiras respostas,
   mas a conexao ja' tinha aberto e o find ja' tinha rodado.
   Aqui o setFocus de verdade e o comMontagemAdiada de verdade sao recortados
   do app.js e postos pra rodar exatamente como a restauracao faz.
   ===================================================================== */
async function umaArvorePorLote() {
  console.log(NL + '4d) achado 1: uma aba de 13 paineis carrega a arvore UMA vez');

  const idas = [];                  // cada loadTree remoto = uma ida ao servidor
  let gitsPedidos = 0;
  /* a barra da esquerda e a view de arquivos de mentira: e' o que diz se a
     arvore esta' NA TELA (achado 4). Nascem visiveis, como estavam antes. */
  const barraLateral = new El('div');
  const viewArquivos = new El('div');
  barraLateral.appendChild(viewArquivos);
  const nomeProj = new El('span');
  const tituloBarra = new El('span');
  const porSeletorF = {
    '#sidebar': barraLateral,
    '.side-view[data-view="explorer"]': viewArquivos,
    '#projName': nomeProj,
    '#tbTitle': tituloBarra,
  };
  const ctxF = {
    ...globaisFalsos(), console,
    window: {},   // a camada nova e opcional; a janela do renderer sempre existe
    document: documentoFalso,
    $: (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : (porSeletorF[sel] || new El('div'))),
    loadTree: (dir, remoto) => { idas.push({ dir, remoto: remoto || null }); },
    atualizarGit: () => { gitsPedidos++; },
    montarColunas: () => {},
    remotoDoPane: (P) => P.remoto || null,
    shortPath: (p) => String(p),
    baseNome: (p) => String(p),
    HOME: 'C:\\Users\\hugom', ESTE_PC: 'PC',
  };
  vm.createContext(ctxF);
  /* tudo numa runInContext so': 'let' e 'const' dentro do vm sao do SCRIPT, e
     em chamadas separadas uma funcao nao enxergaria a variavel da outra. */
  vm.runInContext(
    'let focusPane = null;\nconst panes = new Map();\n'
    + pegarBloco(app, 'function irAtePainel(', 'irAtePainel') + '\n'
    + app.slice(app.indexOf('let montagemAdiada = 0;'), app.indexOf('function montarColunas() {'))
    + app.slice(app.indexOf('/* A barra da esquerda (arvore + titulo do projeto)'), app.indexOf('function soltarTerminaisMortos('))
    + '\nthis.setFocus = setFocus; this.comMontagemAdiada = comMontagemAdiada; this.panes = panes;'
    + '\nthis.barraDaEsquerdaApareceu = barraDaEsquerdaApareceu;'
    + '\nthis.quemTemFoco = () => focusPane; this.arvoreFicouPendente = () => arvorePendente;', ctxF);

  // o mesmo desenho do restaurarPaineisMiolo: newPane -> setFocus por painel,
  // com await no meio (o historico da conversa), e setFocus(primeiro) no fim
  const restaurar = async (quantos, remoto) => {
    idas.length = 0; gitsPedidos = 0; ctxF.panes.clear();
    await ctxF.comMontagemAdiada(async () => {
      for (let i = 0; i < quantos; i++) {
        const P = { id: 'p' + i, el: new El('div'), cwd: remoto ? '~' : 'C:\\proj', engine: 'claude', remoto };
        ctxF.panes.set(P.id, P);
        ctxF.setFocus(P);                              // e' o que o newPane faz no fim
        await Promise.resolve();                       // o miolo tem await (historico)
      }
      const primeiro = [...ctxF.panes.values()][0];
      if (primeiro) ctxF.setFocus(primeiro);
    });
    return idas;
  };

  const remotoVps = { usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' };
  const treze = await restaurar(13, remotoVps);
  checa('(1) aba de 13 paineis remotos: UMA ida ao servidor, nao 13',
    treze.length === 1, treze.length + ' idas');
  checa('(1) e a arvore carregada e a do painel que ficou com o foco',
    treze.length === 1 && ctxF.quemTemFoco().id === 'p0' && treze[0].remoto === remotoVps);
  checa('(1) nada fica pendente depois que o lote acaba', ctxF.arvoreFicouPendente() === false);

  const umSo = await restaurar(1, remotoVps);
  checa('(1) com UM painel so a arvore continua carregando (o caso que quebra facil)',
    umSo.length === 1, umSo.length + ' idas');

  const local = await restaurar(13, null);
  checa('(1) local: mesma economia, e sem remoto na chamada',
    local.length === 1 && local[0].remoto === null, JSON.stringify(local));
  checa('(1) local: o chip do git continua sendo pedido pro painel em foco', gitsPedidos === 1, String(gitsPedidos));

  // FORA de lote nada muda: trocar de painel na mao carrega na hora, como sempre
  idas.length = 0;
  const A = { id: 'a', el: new El('div'), cwd: '~', engine: 'claude', remoto: remotoVps };
  const B = { id: 'b', el: new El('div'), cwd: '~', engine: 'claude', remoto: remotoVps };
  ctxF.panes.clear(); ctxF.panes.set('a', A); ctxF.panes.set('b', B);
  ctxF.setFocus(A); ctxF.setFocus(B);
  checa('(1) fora de lote, trocar de painel carrega a arvore na hora (uma por troca)',
    idas.length === 2, idas.length + ' idas');
  idas.length = 0;
  ctxF.setFocus(B);
  checa('(1) e clicar de novo no MESMO painel nao pede nada', idas.length === 0);

  // e o contrato do fonte: a restauracao roda mesmo dentro do lote
  checa('(1) a restauracao da aba roda dentro do comMontagemAdiada',
    /return await comMontagemAdiada\(\(\) => restaurarPaineisMiolo\(salvos, abaId, gen\)\);/.test(app));
  checa('(1) o setFocus consulta o lote antes de mexer na barra da esquerda',
    /if \(montagemAdiada\) \{ arvorePendente = true; return; \}/.test(app));

  /* =====================================================================
     ACHADO 4: a arvore era carregada com a barra da esquerda FECHADA.
     Ela nasce escondida (o boot faz $('#sidebar').classList.add('hidden')) e
     nada conferia isso: cada clique num painel de aba remota abria um ssh --
     mais um por pasta lembrada no 'expanded' -- pra pintar uma arvore que
     ninguem estava vendo. Com 3 pastas abertas, um clique = 4 conexoes.
     ===================================================================== */
  console.log(NL + '4e) achado 4: a arvore so carrega quando da pra ver');
  barraLateral.classList.add('hidden');        // e' o que o app faz no boot
  idas.length = 0; nomeProj.texto = ''; tituloBarra.texto = '';
  ctxF.setFocus(A); ctxF.setFocus(B);
  checa('(4) barra fechada: trocar de painel NAO abre conexao pra pintar arvore escondida',
    idas.length === 0, idas.length + ' idas');
  checa('(4) mas o titulo e o nome do projeto continuam sendo atualizados',
    /hugo@vps1:/.test(tituloBarra.texto) && /hugo@vps1/.test(nomeProj.texto),
    tituloBarra.texto + ' | ' + nomeProj.texto);

  barraLateral.classList.remove('hidden');
  ctxF.barraDaEsquerdaApareceu();
  checa('(4) quando a barra abre, a arvore que ficou esperando carrega UMA vez',
    idas.length === 1 && idas[0].remoto === remotoVps, idas.length + ' idas');
  idas.length = 0;
  ctxF.barraDaEsquerdaApareceu();
  checa('(4) e abrir de novo sem nada pendente nao pede nada', idas.length === 0, idas.length + ' idas');

  // barra aberta, mas na view Torre: a arvore tambem esta fora da tela
  viewArquivos.classList.add('hidden');
  idas.length = 0;
  ctxF.setFocus(A);
  checa('(4) na view Torre a arvore tambem fica de fora', idas.length === 0, idas.length + ' idas');
  viewArquivos.classList.remove('hidden');
  ctxF.barraDaEsquerdaApareceu();
  checa('(4) e voltando pra view de arquivos ela carrega, pro painel em foco',
    idas.length === 1 && ctxF.quemTemFoco().id === 'a', idas.length + ' idas');

  // com a barra a vista, tudo continua exatamente como era
  idas.length = 0;
  ctxF.setFocus(B);
  checa('(4) com a barra aberta, trocar de painel carrega na hora, como sempre',
    idas.length === 1, idas.length + ' idas');
  checa('(4) o fonte so pede a arvore quando ela esta na tela',
    /if \(podeVer\) loadTree\(P\.cwd \|\| remoto\.caminhoRemoto, remoto\);/.test(app)
    && /if \(podeVer\) loadTree\(P\.cwd\);/.test(app)
    && /function arvoreNaTela\(\) \{/.test(app));
  checa('(4) e a barra que abre (icone ou Ctrl+B) chama quem carrega a arvore adiada',
    /function toggleSidebar\(\) \{[^\n]*barraDaEsquerdaApareceu\(\);/.test(app)
    && /if \(v === 'rotinas'\) pintarRotinas\(true\);\n  barraDaEsquerdaApareceu\(\);/.test(app));

  /* =====================================================================
     ACHADO 8: se o montarColunas estourar, o 'arvorePendente' ficava preso em
     true PRA SEMPRE -- e a guarda do setFocus (focusPane === P &&
     !arvorePendente) parava de proteger: todo mousedown no painel ja' em foco
     recarregava a arvore, uma conexao SSH por clique em aba remota.
     ===================================================================== */
  console.log(NL + '4f) achado 8: o arvorePendente nao pode ficar preso em true');
  ctxF.montarColunas = () => { throw new Error('montarColunas estourou'); };
  let estourou = false;
  try {
    await ctxF.comMontagemAdiada(async () => {
      const Z = { id: 'z', el: new El('div'), cwd: '~', engine: 'claude', remoto: remotoVps };
      ctxF.panes.set('z', Z);
      ctxF.setFocus(Z);                                  // dentro do lote: deixa a arvore pendente
      vm.runInContext('montagemPedida = true;', ctxF);   // e' o que o montarColunas do lote faz
      await Promise.resolve();
    });
  } catch { estourou = true; }
  ctxF.montarColunas = () => {};
  checa('(8) o montarColunas estourou de verdade (o erro nao foi engolido)', estourou);
  checa('(8) e mesmo assim o arvorePendente voltou pra false',
    ctxF.arvoreFicouPendente() === false, String(ctxF.arvoreFicouPendente()));
  idas.length = 0;
  ctxF.setFocus(ctxF.quemTemFoco());
  checa('(8) por isso clicar no painel JA em foco continua nao pedindo nada',
    idas.length === 0, idas.length + ' idas');
  checa('(8) e o fonte poe o montarColunas num try, com o arvorePendente no finally',
    /try \{ if \(!montagemAdiada && montagemPedida\) \{ montagemPedida = false; montarColunas\(\); \} \}\n    finally \{/.test(app));
}

/* =====================================================================
   ACHADO 2 da auditoria: a busca do "@" remoto ressuscitava e apagava a
   janelinha do painel.
   O pararBuscaDeArquivos so' era chamado em 2 lugares (o send e o 'else' do
   ouvinte de 'input'). O fecharMenus -- que e' quem roda no clique global e no
   Esc -- nao cancelava nada. Caminho real: painel VPS -> "@app" ->
   "Procurando..." -> clique fora -> Conta -> "Entrar na conta" -> o
   janelaTerminal monta o login no .p-modal -> a busca volta do servidor e faz
   cx.className='modal-cx'; cx.innerHTML='' -> o terminal perde o DOM e o pty
   fica vivo e orfao. Vale igual pra Conectores, Conta e diff do git: todos
   dividem a MESMA janelinha.
   Aqui rodam juntos o fecharMenus DE VERDADE e o bloco do "@" DE VERDADE.
   ===================================================================== */
async function janelinhaDoPainel() {
  console.log(NL + '5b) achado 2: fechar o menu mata a busca do "@" que ainda vinha do servidor');
  let tarefaD = null, menuD = null, soltarBusca = null;
  const painelD = { id: 'pD', el: new El('div'), cwd: '~/app' };
  const modalD = painelD.el.buscar('.p-modal');
  const cxD = modalD.buscar('.modal-cx');
  modalD.classList.add('hidden');            // como no HTML: nasce escondida

  const ctxD = {
    ...globaisFalsos(), console,
    document: documentoFalso,
    setTimeout: (fn) => { tarefaD = fn(); return 1; },
    clearTimeout: () => {},
    $: (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : new El('div')),
    ico: (n) => '<i>' + n + '</i>',
    shortPath: (p) => String(p),
    panes: new Map([[painelD.id, painelD]]),
    fecharPopGlobal: () => {},
    tituloPopup: (t) => { const d = new El('div'); d.className = 'mo-top'; d.textContent = t; return d; },
    subPopup: (t) => { const d = new El('div'); d.className = 'mo-sub'; d.textContent = t; return d; },
    elItem: (o) => { const d = new El('div'); d.className = 'mi'; d.texto = o.nome; return d; },
    remotoDoPane: () => ({ usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' }),
    faltaConfigurarServidor: () => false,
    AVISO_ABA_EM_BRANCO: 'x',
    window: { api: { buscarArquivos: () => new Promise((ok) => { soltarBusca = ok; }) } },
  };
  /* copia fiel do novoMenu no que importa aqui: ele ABRE a janelinha e a marca
     como 'como-menu' -- e' essa marca que diz de quem ela e' naquele momento. */
  ctxD.novoMenu = (P) => {
    const m = P.el.buscar('.p-modal');
    m.classList.remove('hidden'); m.classList.add('como-menu');
    const cx = m.buscar('.modal-cx');
    cx.className = 'modal-cx'; cx.innerHTML = '';
    menuD = new El('div');
    return menuD;
  };
  vm.createContext(ctxD);
  vm.runInContext(trechoArroba, ctxD);                                                              // o "@" de verdade
  vm.runInContext(pegarBloco(app, 'function fecharMenus(cancelarBusca) {', 'fecharMenus'), ctxD);    // e o fecharMenus de verdade

  /* --- clique fora / Esc: o fecharMenus mata a busca que ainda vinha --- */
  const p1 = ctxD.menuArquivos(painelD, 'app', 0);
  const t1 = tarefaD;
  checa('(2) enquanto o SSH nao volta, a janelinha e o menu de arquivos',
    !modalD.classList.contains('hidden') && modalD.classList.contains('como-menu'),
    [...modalD.classes].join(','));
  menuD = null;
  ctxD.fecharMenus();                         // e' o que o clique global e o Esc chamam
  checa('(2) fechar o menu esconde a janelinha', modalD.classList.contains('hidden'));
  soltarBusca({ itens: [{ path: '~/app/x.js', nome: 'x.js' }] });
  await p1; await t1;
  checa('(2) e a busca que voltou DEPOIS do fecharMenus nao reabre o menu sozinha',
    menuD === null, menuD ? 'reabriu' : 'ok');

  /* --- a janelinha virou TERMINAL no meio da espera: ninguem escreve nela --- */
  const p2 = ctxD.menuArquivos(painelD, 'app', 0);
  const t2 = tarefaD;
  // e' o que o janelaTerminal faz: ocupa a MESMA .p-modal, aberta e sem 'como-menu'
  modalD.classList.remove('hidden'); modalD.classList.remove('como-menu');
  cxD.className = 'modal-cx cx-term';
  cxD.innerHTML = '<div class="term-wrap"><div class="term-tela"></div></div>';
  menuD = null;
  soltarBusca({ itens: [{ path: '~/app/x.js', nome: 'x.js' }] });
  await p2; await t2;
  checa('(2) resposta atrasada NAO escreve no .modal-cx ocupado pelo terminal de login',
    menuD === null && cxD.className === 'modal-cx cx-term'
    && cxD.innerHTML === '<div class="term-wrap"><div class="term-tela"></div></div>',
    cxD.className + ' / ' + cxD.innerHTML);

  /* --- e com a janelinha livre de novo, o "@" volta a funcionar --- */
  modalD.classList.add('hidden');
  cxD.className = 'modal-cx'; cxD.innerHTML = '';
  const p3 = ctxD.menuArquivos(painelD, 'app', 0);
  const t3 = tarefaD;
  menuD = null;
  soltarBusca({ itens: [{ path: '~/app/x.js', nome: 'x.js' }] });
  await p3; await t3;
  checa('(2) com a janelinha livre o menu de arquivos abre normalmente', menuD !== null);

  /* --- contratos do fonte --- */
  checa('(2) o fecharMenus mata a busca do "@" em voo (era o buraco: so o send e o input cancelavam)',
    /if \(cancelarBusca !== false\) pararBuscaEmVoo\(\);/.test(pegarBloco(app, 'function fecharMenus(cancelarBusca) {', 'fecharMenus')));
  checa('(2) e o UNICO que fecha sem cancelar e o novoMenu (senao a busca se mataria sozinha)',
    /function novoMenu\(P\) \{\n  fecharMenus\(false\);/.test(app)
    && (app.match(/fecharMenus\(false\)/g) || []).length === 1);
  checa('(2) a guarda da janelinha existe e vale nos DOIS pontos de escrita',
    /function janelinhaOcupada\(P\) \{/.test(app)
    && (app.match(/if \(janelinhaOcupada\(P\)\) return;/g) || []).length === 2);
}

/* =====================================================================
   ACHADO 1: a tela de abertura criava o painel com cwd EXPLICITO
   (cfg.defCwd || HOME), entao o 'opts.cwd || cwdPadraoDaAba(aba)' do newPane
   nunca via o '~' da aba. Numa aba de servidor o painel nascia com
   P.cwd = 'C:\Users\hugom' e a arvore e o "@" mandavam cd 'C:\Users\hugom'
   pro Ubuntu. A mesma armadilha ja' tinha sido corrigida no trocarMotor.
   Aqui roda a LINHA de verdade da tela de abertura.
   ===================================================================== */
function abertura() {
  console.log(NL + '8) achado 1: painel da tela de abertura nasce na pasta da ABA');
  // o laco ja' foi 'of quais' e hoje e' 'of [...quais].reverse()' (sessao nova na
  // esquerda). O que importa aqui e' o cwd, entao o regex nao prende a forma do laco.
  const linha = (app.match(/for \(const m of .*?quais.*?\) newPane\([^\n]*\);/) || [''])[0];
  checa('(1a) a linha do newPane da tela de abertura existe', /newPane\(/.test(linha), linha);

  const rodar = (abaAtiva) => {
    const ctxG = {
      ...globaisFalsos(), console,
      HOME: 'C:\\Users\\hugom',
      cfg: {
        defCwd: 'C:\\Users\\hugom', abaAtiva,
        abas: [
          { id: 'pc', nome: 'PC inteiro', tipo: 'local', caminho: null, paineis: [] },
          { id: 'vps', nome: 'VPS', tipo: 'ssh', host: 'vps1', usuario: 'hugo', chave: 'k', caminhoRemoto: '/home/hugo/app', paineis: [] },
        ],
      },
      quais: ['claude'],
      nascidos: [],
    };
    ctxG.newPane = (o) => ctxG.nascidos.push(o);
    vm.createContext(ctxG);
    // as funcoes de verdade que a linha usa (abaAtual, pastasDaAba, cwdPadraoDaAba...)
    vm.runInContext(app.slice(app.indexOf('function abasLocais()'), app.indexOf('function nomeCurtoDaAba(')), ctxG);
    vm.runInContext(linha, ctxG);
    return ctxG.nascidos[0];
  };

  const noServidor = rodar('vps');
  checa('(1a) numa aba de SERVIDOR o painel nasce na pasta do servidor, nao no C:\\ do Windows',
    noServidor && noServidor.cwd === '/home/hugo/app', JSON.stringify(noServidor));
  const noPc = rodar('pc');
  checa('(1a) e numa aba local nada muda: continua o cfg.defCwd de sempre',
    noPc && noPc.cwd === 'C:\\Users\\hugom', JSON.stringify(noPc));
  checa('(1a) o cfg.defCwd cru saiu da chamada (era ele que virava cd C:\\... no Ubuntu)',
    !/newPane\(\{ engine: m, cwd: cfg\.defCwd \|\| HOME/.test(app));
}

/* =====================================================================
   2) O "@" dentro do servidor
   ===================================================================== */
const trechoArroba = app.slice(
  app.indexOf('/* ---- completar caminho de arquivo com "@" ---- */'),
  app.indexOf("/* ---- buscar dentro da conversa aberta (Ctrl+F) ---- */"));
if (trechoArroba.length < 200) throw new Error('nao achei o trecho do "@" no app.js');

let tarefaDoTimer = null;
let respostaBusca = [];
const pedidosBusca = [];
let menuAtual = null;
let fechou = 0;
let ehRemoto = null;

const ctxB = {
  ...globaisFalsos(), console,
  document: documentoFalso,
  setTimeout: (fn) => { tarefaDoTimer = fn(); return 1; },
  clearTimeout: () => {},
  $: (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : new El('div')),
  ico: (n) => '<i>' + n + '</i>',
  shortPath: (p) => String(p),
  fecharMenus: () => { fechou++; menuAtual = null; },
  novoMenu: () => { menuAtual = new El('div'); return menuAtual; },
  tituloPopup: (t) => { const d = new El('div'); d.className = 'mo-top'; d.textContent = t; return d; },
  subPopup: (t) => { const d = new El('div'); d.className = 'mo-sub'; d.textContent = t; return d; },
  elItem: (o) => { const d = new El('div'); d.className = 'mi'; d.texto = o.nome; return d; },
  remotoDoPane: () => ehRemoto,
  faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
  AVISO_ABA_EM_BRANCO: 'Esta aba ainda não tem servidor configurado — preencha usuário, host e chave em Editar aba.',
  window: {
    api: {
      buscarArquivos: async (o) => { pedidosBusca.push(o); return respostaBusca; },
    },
  },
};
vm.createContext(ctxB);
vm.runInContext(trechoArroba, ctxB);

const textoDoMenu = () => (menuAtual ? menuAtual.filhos.map((f) => f.textContent).join(' | ') : '(sem menu)');
const itensDoMenu = () => {
  if (!menuAtual) return [];
  const corpo = menuAtual.filhos.find((f) => f.filhos.some((x) => x.className === 'mi'));
  return corpo ? corpo.filhos.filter((x) => x.className === 'mi').map((x) => x.texto) : [];
};
const painelFalso = { id: 'p1', el: new El('div'), cwd: '~/app' };
// como no HTML de verdade: a janelinha do painel (.p-modal) nasce escondida
painelFalso.el.buscar('.p-modal').classList.add('hidden');

async function arroba() {
  console.log(NL + '5) o "@" dentro do servidor');

  /* --- local: a resposta e' a LISTA CRUA, exatamente como sempre --- */
  ehRemoto = null;
  pedidosBusca.length = 0; menuAtual = null; fechou = 0;
  respostaBusca = [{ path: 'C:\\a\\main.js', nome: 'main.js' }];
  await ctxB.menuArquivos(painelFalso, 'main', 0);
  await tarefaDoTimer;
  checa('local: nao manda remoto e monta a lista da resposta crua (array)',
    pedidosBusca.length === 1 && pedidosBusca[0].remoto === undefined && itensDoMenu().join(',') === 'main.js',
    JSON.stringify(pedidosBusca[0]) + ' -> ' + itensDoMenu().join(','));
  checa('local: a espera continua de 140 ms', /\}, remoto \? 450 : 140\);/.test(trechoArroba));

  /* --- remoto: a resposta e' { itens, error } --- */
  ehRemoto = { usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' };
  pedidosBusca.length = 0; menuAtual = null;
  respostaBusca = { itens: [{ path: '~/app/src/main.js', nome: 'main.js' }] };
  await ctxB.menuArquivos(painelFalso, 'main', 0);
  await tarefaDoTimer;
  checa('e) remoto: le o .itens de { itens, error } e monta a lista',
    itensDoMenu().join(',') === 'main.js', itensDoMenu().join(','));
  checa('e) remoto: o pedido leva o alvo do painel',
    pedidosBusca[0].remoto && pedidosBusca[0].remoto.host === 'vps1', JSON.stringify(pedidosBusca[0]));

  /* --- remoto com falha de rede: ERRO na tela, nunca lista vazia --- */
  menuAtual = null; fechou = 0;
  respostaBusca = { itens: [], error: 'Não alcancei o servidor (vps1). Ele está no ar e liberado para o seu IP?' };
  await ctxB.menuArquivos(painelFalso, 'main', 0);
  await tarefaDoTimer;
  checa('e) falha de rede aparece com o motivo, em vez de fechar o menu calado',
    !!menuAtual && /Não alcancei o servidor/.test(textoDoMenu()), textoDoMenu());
  checa('e) e o recado vem marcado como erro (cor propria nos 3 temas)',
    !!menuAtual && menuAtual.filhos.some((f) => f.classes.has('erro')), textoDoMenu());

  /* --- remoto: nada encontrado continua fechando o menu (nao e' erro) --- */
  menuAtual = null; fechou = 0;
  respostaBusca = { itens: [] };
  await ctxB.menuArquivos(painelFalso, 'zzz', 0);
  await tarefaDoTimer;
  checa('e) lista vazia de verdade fecha o menu (sem erro nenhum)', fechou > 0 && !menuAtual);

  /* --- aba de servidor em branco: nao vai pra rede nem pro disco daqui --- */
  ehRemoto = { usuario: '', host: '', chave: '', caminhoRemoto: '~' };
  pedidosBusca.length = 0; menuAtual = null;
  await ctxB.menuArquivos(painelFalso, 'main', 0);
  await tarefaDoTimer;
  checa('"@" em aba de servidor em branco: nao busca nada e diz o que falta',
    pedidosBusca.length === 0 && /não tem servidor configurado/.test(textoDoMenu()), textoDoMenu());
  ehRemoto = { usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' };

  /* --- remoto: enquanto procura, avisa --- */
  let htmlEnquanto = '';
  ctxB.window.api.buscarArquivos = async (o) => {
    pedidosBusca.push(o);
    htmlEnquanto = textoDoMenu();
    return { itens: [{ path: '~/a.js', nome: 'a.js' }] };
  };
  menuAtual = null;
  await ctxB.menuArquivos(painelFalso, 'a', 0);
  await tarefaDoTimer;
  checa('e) remoto: enquanto o SSH nao volta, a tela diz que esta procurando',
    /Procurando em hugo@vps1/.test(htmlEnquanto), htmlEnquanto);

  /* --- resposta velha nao pinta por cima da nova --- */
  const espera = [];
  ctxB.window.api.buscarArquivos = (o) => new Promise((ok) => espera.push(() => ok({ itens: [{ path: '~/' + o.termo, nome: o.termo }] })));
  menuAtual = null;
  const p1 = ctxB.menuArquivos(painelFalso, 'velho', 0); const t1 = tarefaDoTimer;
  const p2 = ctxB.menuArquivos(painelFalso, 'novo', 0); const t2 = tarefaDoTimer;
  espera[1](); espera[0]();                 // a nova responde primeiro, a velha depois
  await p1; await p2; await t1; await t2;
  checa('e) resposta lenta da tecla ANTERIOR nao pinta por cima da nova',
    itensDoMenu().join(',') === 'novo', itensDoMenu().join(','));

  /* --- apagou o "@": a busca remota em voo e' cancelada --- */
  ctxB.window.api.buscarArquivos = async (o) => { pedidosBusca.push(o); return { itens: [{ path: '~/x', nome: 'x' }] }; };
  menuAtual = null;
  const pv = ctxB.menuArquivos(painelFalso, 'x', 0); const tv = tarefaDoTimer;
  ctxB.cancelarBuscaArquivos(painelFalso);
  await pv; await tv;
  checa('apagou o "@": a busca que ainda vinha do servidor nao abre o menu depois',
    !menuAtual, textoDoMenu());
  ehRemoto = null;
  const antes = pedidosBusca.length;
  ctxB.cancelarBuscaArquivos(painelFalso);
  checa('e no local o cancelamento nao mexe em nada', pedidosBusca.length === antes);

  /* --- ACHADO 5: mandar a mensagem tem que matar a busca do "@" ---
     O send() limpa o campo NA MAO (inp.value = ''), e limpar por codigo nao
     dispara o evento 'input' -- que era o unico lugar de onde o cancelamento
     saia. No servidor o temporizador de 450 ms acordava DEPOIS do envio e
     abria o menu de arquivos por cima da resposta que estava chegando. */
  ehRemoto = { usuario: 'hugo', host: 'vps1', chave: 'k', caminhoRemoto: '~' };
  ctxB.window.api.buscarArquivos = async (o) => { pedidosBusca.push(o); return { itens: [{ path: '~/x', nome: 'x' }] }; };
  menuAtual = null;
  const pEnv = ctxB.menuArquivos(painelFalso, 'x', 0); const tEnv = tarefaDoTimer;
  ctxB.pararBuscaDeArquivos(painelFalso);        // e' o que o send() passou a chamar
  await pEnv; await tEnv;
  checa('(5) enviar mata a busca em voo: o menu nao abre depois da mensagem', !menuAtual, textoDoMenu());

  ehRemoto = null;                                // e no disco tambem, onde a espera e de 140 ms
  menuAtual = null;
  const pLoc = ctxB.menuArquivos(painelFalso, 'y', 0); const tLoc = tarefaDoTimer;
  ctxB.pararBuscaDeArquivos(painelFalso);
  await pLoc; await tLoc;
  checa('(5) e vale no disco tambem (os 140 ms tambem acordam depois do envio)', !menuAtual, textoDoMenu());
}

/* =====================================================================
   3) VISOR: rota pelo PAINEL, e anexo continua neste PC
   ===================================================================== */
const trechoVisor = app.slice(
  app.indexOf('/* ============ visualizador de arquivo ============ */'),
  app.indexOf('/* ============ conversas recentes ============ */'));
if (trechoVisor.length < 200) throw new Error('nao achei o trecho do visor no app.js');

const pedidosVisor = [];
let respostaVisor = { tipo: 'texto', nome: 'x.txt', bytes: 3, dados: 'oi' };
const ctxC = {
  ...globaisFalsos(), console,
  document: documentoFalso,
  $: (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : new El('div')),
  $$: () => [],
  ico: (n) => '<i>' + n + '</i>',
  note: () => {},
  abrirQuadro: () => {},
  ESTE_PC: 'PC',
  baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
  tamanhoBonito: (b) => b + ' B',
  faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
  AVISO_ABA_EM_BRANCO: 'Esta aba ainda não tem servidor configurado — preencha usuário, host e chave em Editar aba.',
  window: {
    api: {
      verArquivo: async (f, remoto) => { pedidosVisor.push({ f, remoto }); return respostaVisor; },
      openPath: async () => ({}),
      textoLer: async () => ({ content: '{}' }),
    },
  },
};
vm.createContext(ctxC);
vm.runInContext(trechoVisor, ctxC);

async function visor() {
  console.log(NL + '6) visor: quem manda e o PAINEL, e anexo continua neste PC');
  const P = { id: 'p1', el: new El('div') };
  const v = P.el.buscar('.p-visor');
  const corpo = v.buscar('.visor-corpo');
  const btAbrir = v.buscar('.visor-abrir');

  /* --- d) ANEXO: remoto NULO de proposito, mesmo com o painel na VPS --- */
  pedidosVisor.length = 0;
  await ctxC.verArquivo(P, 'C:\\Users\\hugom\\AppData\\colados\\colado-1.png', null);
  checa('d) anexo passa remoto nulo -> o IPC vai sem remoto (le userData deste PC)',
    pedidosVisor.length === 1 && pedidosVisor[0].remoto === undefined, JSON.stringify(pedidosVisor[0]));
  checa('d) e o botao "Abrir no PC" continua a vista no anexo', !btAbrir.classes.has('hidden'));

  const fichaAnx = app.slice(app.indexOf('function fichaAnexo('), app.indexOf('function fichaAnexo(') + 900);
  checa('d) a ficha de anexo escreve o null EXPLICITO (nunca o remoto do painel)',
    /verArquivo\(P, a\.path, null\)/.test(fichaAnx) && !/verArquivo\(P, a\.path, remoto/.test(app));
  checa('d) e o preload transforma remoto falsy na forma antiga (string), como sempre',
    /verArquivo: \(f, remoto\) => ipcRenderer\.invoke\('arquivo:ver', remoto \? \{ file: f, remoto \} : f\)/.test(preload));

  /* --- f) painel remoto: o IPC leva o alvo, e "Abrir no PC" some --- */
  pedidosVisor.length = 0;
  const alvo = { usuario: 'hugo', host: 'vps1', chave: 'k' };
  await ctxC.verArquivo(P, '/home/hugo/app.js', alvo);
  checa('f) painel remoto: o pedido leva o alvo do painel',
    pedidosVisor.length === 1 && pedidosVisor[0].remoto === alvo, JSON.stringify(pedidosVisor[0]));
  checa('f) "Abrir no PC" some no servidor (o arquivo nao esta aqui)', btAbrir.classes.has('hidden'));

  /* --- aba de servidor em branco: o visor nao le o disco daqui por engano --- */
  pedidosVisor.length = 0;
  await ctxC.verArquivo(P, '/home/hugo/app.js', { usuario: '', host: '', chave: '' });
  checa('visor em aba de servidor em branco: nao pede nada e diz o que falta',
    pedidosVisor.length === 0 && /não tem servidor configurado/.test(corpo.textContent), corpo.textContent);

  /* --- erro do servidor chega inteiro na tela --- */
  respostaVisor = { erro: 'Não achei este arquivo no servidor.' };
  await ctxC.verArquivo(P, '/home/hugo/sumiu.txt', alvo);
  checa('erro do servidor aparece com o motivo, nao em branco',
    /Não achei este arquivo no servidor/.test(corpo.textContent), corpo.textContent);

  /* --- Excalidraw: no servidor nao oferece o quadro (ele le/grava neste PC) --- */
  respostaVisor = { tipo: 'texto', nome: 'cena.excalidraw', bytes: 10, dados: '{}' };
  await ctxC.verArquivo(P, '/home/hugo/cena.excalidraw', alvo);
  const temBotao = (c) => c.filhos.some((f) => f.tagName === 'BUTTON');
  checa('excalidraw no servidor: explica em vez de oferecer o quadro',
    !temBotao(corpo) && /O quadro só abre desenho deste PC/.test(corpo.textContent), corpo.textContent);
  await ctxC.verArquivo(P, 'C:\\cena.excalidraw', null);
  checa('excalidraw local: o botao "Abrir no quadro" continua la',
    temBotao(corpo) && corpo.filhos.some((f) => f.texto === 'Abrir no quadro'));

  /* --- clique tardio nao pinta por cima do arquivo novo --- */
  const fila = [];
  ctxC.window.api.verArquivo = (f) => new Promise((ok) => fila.push(() => ok({ tipo: 'texto', nome: f, bytes: 1, dados: 'conteudo de ' + f })));
  const a1 = ctxC.verArquivo(P, '/home/hugo/velho.txt', alvo);
  const a2 = ctxC.verArquivo(P, '/home/hugo/novo.txt', alvo);
  fila[1](); fila[0]();
  await a1; await a2;
  checa('dois cliques seguidos: o visor fica com o ULTIMO pedido',
    /conteudo de \/home\/hugo\/novo\.txt/.test(String(corpo.buscar('pre').texto)), String(corpo.buscar('pre').texto));
}

/* =====================================================================
   4) contratos que so' o fonte mostra
   ===================================================================== */
function contratos() {
  console.log(NL + '7) contratos do fonte');
  /* o miolo da barra da esquerda saiu do setFocus e virou funcao propria
     (achado 1 da auditoria de caminhos vitais): carregar a arvore a cada painel
     que nascia abria 13 conexoes SSH ao restaurar a aba da VPS. */
  const setFoco = app.slice(app.indexOf('function atualizarBarraDaEsquerda(P) {'), app.indexOf('function soltarTerminaisMortos('));
  checa('a) o setFocus nao escreve mais "ainda nao funciona em servidor remoto"',
    !/ainda não funciona em servidor remoto/.test(app));
  checa('a) e o ramo remoto da barra da esquerda carrega a arvore do servidor',
    /loadTree\(P\.cwd \|\| remoto\.caminhoRemoto, remoto\)/.test(setFoco), setFoco.slice(0, 200));
  checa('a) o "@" nao tem mais o "if (remoto) return"',
    !/painel remoto: a busca teria que ir por SSH/.test(app)
    && !/const remoto = remotoDoPane\(P\);\s*\n\s*if \(remoto\) return;/.test(app));

  const links = app.slice(app.indexOf('function linkarArquivos('), app.indexOf('function mesmaFala('));
  checa('bug antigo: /home/... no texto do modelo agora abre pelo PAINEL, nao no disco do Windows',
    /verArquivo\(P, caminho, remotoDoPane\(P\)\)/.test(links));
  checa('a regex de caminho POSIX continua casando /home/... (o link tem que existir pra funcionar)',
    links.includes('(?:Users|tmp|private|Volumes|home)'));

  checa('o visor recebe o remoto de QUEM CHAMA (assinatura de 3 pecas)',
    /async function verArquivo\(P, caminho, remoto\) \{/.test(app));
  checa('e o IPC do visor manda undefined quando nao e remoto (forma antiga no preload)',
    /window\.api\.verArquivo\(caminho, remoto \|\| undefined\)/.test(app));
  checa('a arvore idem: listDir sem remoto e' + String.fromCharCode(39) + ' a chamada de sempre',
    /window\.api\.listDir\(dir, remoto \|\| undefined\)/.test(app));
  checa('ninguem adivinha remoto pelo formato do caminho (nada de "parece POSIX")',
    !/remoto = \/\^\\\//.test(app) && !/startsWith\('\/'\) \? remoto/.test(app));
  checa('o "@" manda o remoto no objeto do pedido',
    /buscarArquivos\(\{ cwd: P\.cwd, termo, remoto: remoto \|\| undefined \}\)/.test(app));
  checa('a folha de estilo tem o "carregando" da arvore e o erro do menu',
    /\.tree-carregando\{/.test(lerFonte('renderer', 'style.css'))
    && /\.mo-sub\.erro\{/.test(lerFonte('renderer', 'style.css')));

  /* =====================================================================
     ACHADO 5: editar a aba de servidor deixava arvore, titulo e P.cwd
     apontando pro servidor ANTIGO. Depois do Object.assign ninguem recarregava
     a barra da esquerda, e o setFocus sai cedo (focusPane === P &&
     !arvorePendente). Clicar num no' colava caminho do servidor A na mensagem
     que ia pro B; o duplo clique era pior (o 'remoto' do closure e' A, mas o
     remotoDoPane ja' devolve B). O bloco de verdade e' recortado do "Salvar" da
     caixa de aba e rodado aqui.
     ===================================================================== */
  const okAba = pegarBloco(app, "$('#abOk', cx).onclick = () => {", 'abOk');
  checa('(5) o Salvar refaz o cwd dos paineis da aba de servidor',
    /if \(editando && existente && existente\.tipo === 'ssh'\) \{/.test(okAba) && /Q\.cwd = casa;/.test(okAba));
  checa('(5) e recarrega a barra da esquerda na mao (o setFocus sai cedo no painel ja em foco)',
    /if \(editando && existente && existente\.tipo === 'ssh' && focusPane && focusPane\.abaId === existente\.id\) atualizarBarraDaEsquerda\(focusPane\);/.test(okAba));
  checa('(5) e o recarregamento vem DEPOIS do Object.assign, nao antes',
    okAba.indexOf('Object.assign(existente, dado)') < okAba.indexOf('atualizarBarraDaEsquerda(focusPane)'));

  const blocoCwd = (okAba.match(/if \(editando && existente && existente\.tipo === 'ssh'\) \{[\s\S]*?\n    \}/) || [''])[0];
  const ctxE = {
    ...globaisFalsos(), console,
    editando: true,
    existente: { id: 'vps', tipo: 'ssh', host: 'vpsB', usuario: 'hugo', chave: 'k', caminhoRemoto: '/srv/b' },
    cwdPadraoDaAba: (aba) => aba.caminhoRemoto || '~',
    savePanes: () => {},
    panes: new Map(), panesFundo: new Map(),
  };
  const pNaTela = { id: 'p1', abaId: 'vps', cwd: '/srv/a' };              // estava no servidor A
  const pNoFundo = { id: 'p2', abaId: 'vps', cwd: 'C:\\Users\\hugom' };  // e este nasceu com o C:\ da abertura
  const pLocal = { id: 'p3', abaId: 'pc', cwd: 'C:\\proj' };              // painel de aba LOCAL: nao se toca
  ctxE.panes.set('p1', pNaTela); ctxE.panes.set('p3', pLocal);
  ctxE.panesFundo.set('p2', pNoFundo);                                   // guardado ao sair da aba
  vm.createContext(ctxE);
  vm.runInContext(blocoCwd, ctxE);
  checa('(5) o painel na tela sai do caminho do servidor VELHO', pNaTela.cwd === '/srv/b', pNaTela.cwd);
  checa('(5) o painel guardado em segundo plano tambem (ele volta na proxima troca de aba)',
    pNoFundo.cwd === '/srv/b', pNoFundo.cwd);
  checa('(5) e o painel de aba LOCAL nao e tocado', pLocal.cwd === 'C:\\proj', pLocal.cwd);

  /* ACHADO 5, no fonte: o cancelamento tem que sair de DENTRO do send, antes
     da limpeza do campo -- nao adianta depender do evento 'input'. */
  const corpoSend = pegarBloco(app, 'async function send(P) {', 'send');
  checa('(5) o send cancela a busca do "@" antes de limpar o campo na mao',
    corpoSend.includes('pararBuscaDeArquivos(P);')
    && corpoSend.indexOf('pararBuscaDeArquivos(P);') < corpoSend.indexOf("inp.value = '';"),
    'cancela em ' + corpoSend.indexOf('pararBuscaDeArquivos(P);') + ', limpa em ' + corpoSend.indexOf("inp.value = '';"));
  checa('(5) e solta o atalho de setas junto (sem menu na tela, sem dono)',
    corpoSend.includes('soltarNavArquivos(P);'));
  checa('(5) o cancelamento pelo evento "input" continua sem efeito no local (comportamento de sempre)',
    /function cancelarBuscaArquivos\(P\) \{\n  if \(!P \|\| !remotoDoPane\(P\)\) return;\n  pararBuscaDeArquivos\(P\);\n\}/.test(app));
}

(async () => {
  await arvore();
  await umaArvorePorLote();
  await arroba();
  await janelinhaDoPainel();
  await visor();
  contratos();
  abertura();
  console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'a tela remota (arvore, "@" e visor) esta de pe'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA geral: ' + (e && e.stack || e)); process.exit(1); });
