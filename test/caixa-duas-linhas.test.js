'use strict';
/* Leva 5c (decisão do Hugo, 07/10): a caixa de escrever tem SEMPRE 2 linhas, em qualquer largura de coluna.
   Em cima, só o campo (.p-input), na largura inteira. Embaixo, o menu em fila a partir da esquerda:
   + › ✨ 🎤 [resumo] [agentes] modelo, e o ■/↑ na ponta direita.
   Na leva 4 (caixa-uma-linha.test.js) o campo dividia a linha com os botões e só descia abaixo de 300 px: numa coluna estreita o ↑ e o ›
   caíam sozinhos numa 2ª linha e o campo ficava espremido. Medida (conta, a confirmar na prévia): linhas da caixa vazia, antes 1 em coluna
   larga e 2 em coluna estreita; depois 2 em toda largura (6 + 28 + 4 + 28 + 6 = 72 px). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const HTML = lerFonte('renderer', 'index.html');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_BASE = lerFonte('renderer', 'style.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
// newPane(opts = {}): o pegarBloco pararia no "{}" do parâmetro; o corpo vai até a seção das colunas (como em test/ajustes.test.js:426)
const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));

/* Os filhos do .cmp-bar no index.html, na ordem do template (a do Tab).
   Leva 5h (seção 4 da spec): a barra tem o campo e os botões da ESQUERDA direto nela, e os da DIREITA dentro da caixa .cmp-dir. Os dois grupos
   saem separados; o regex só enxerga button e textarea, então os divs não entram na lista. */
function barraDoTemplate() {
  const i = HTML.indexOf('<div class="cmp-bar">');
  const bar = HTML.slice(i, HTML.indexOf('\n      </div>', i));
  const d = bar.indexOf('<div class="cmp-dir">');
  assert.ok(d > 0, 'falta a caixa da direita (.cmp-dir) no template');
  const classes = (txt) => [...txt.matchAll(/<(button|textarea)\b[^>]*class="([^"]+)"/g)].map((m) => m[2]);
  // o chip (leva 5h, passo 3) é um grupo com 3 botões dentro; aqui ele conta como UM item da caixa da direita (os 3 botões têm teste próprio)
  const direita = bar.slice(d).replace(/<div class="p-model"[\s\S]*?\n {10}<\/div>/, '<button class="p-model"></button>');
  return { esquerda: classes(bar.slice(0, d)), direita: classes(direita) };
}
const nome = (cls) => cls.split(' ').find((c) => c.startsWith('p-'));

/* Todas as regras do CSS, sem os comentários; as de dentro de @media/@container/@supports vêm com o `contexto` da consulta
   (vazio = regra de topo, que vale em qualquer largura). */
function regras(css, contexto = '') {
  const sem = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const saida = [];
  let i = 0;
  while (i < sem.length) {
    const abre = sem.indexOf('{', i);
    if (abre < 0) break;
    let nivel = 1, k = abre + 1;
    while (k < sem.length && nivel) { nivel += sem[k] === '{' ? 1 : sem[k] === '}' ? -1 : 0; k++; }
    const prelude = sem.slice(i, abre).replace(/\s+/g, ' ').trim();
    const corpo = sem.slice(abre + 1, k - 1);
    if (/^@(container|media|supports|layer)\b/.test(prelude)) saida.push(...regras(corpo, contexto ? contexto + ' > ' + prelude : prelude));
    else if (!prelude.startsWith('@')) saida.push({ contexto, seletor: prelude, corpo });
    i = k;
  }
  return saida;
}
const deTopo = (css, seletor) => regras(css).find((r) => !r.contexto && r.seletor === seletor);
const rotulo = (r) => (r.contexto ? r.contexto + ' ' : '') + r.seletor;

/* Leva 5h (seção 4 da spec, prints do Hugo de 08/10): a linha de baixo foi reordenada. Antes (leva 5c): campo, +, microfone, resumo, agentes,
   modelo, ■, ↑, tudo em fila a partir da esquerda e só o ■/↑ na ponta. Agora:
   - ESQUERDA: +, enviar arquivo, desenhar, microfone e o contexto (o anel, sempre à vista);
   - DIREITA, numa caixa só (.cmp-dir): agentes, o chip do modelo, ■ e ↑ (e, quando aparecem, a sugestão ✨ e o Continuar › logo antes do ■/↑).
   Medida: botões à esquerda do chip, antes 4 (+, microfone, resumo, agentes) e depois 5 (+, arquivo, desenho, microfone, contexto); caminhos
   para enviar arquivo ou desenhar sem abrir menu, antes 0 e depois 1 clique cada. O Tab acompanha a ordem do template. */
/* Leva 5i (seção 4 da spec): o ⚖ Debater (.p-debate) entrou na caixa da direita, antes do 👥 Workflow (.p-workflow), e os dois ficam SEMPRE à vista (o 👥
   nascia escondido e só aparecia com o 1º agente). Medida: botões fixos à vista antes do chip, antes 0 (o 👥 nascia escondido) e depois 2 (⚖ e 👥);
   botões escondidos no nascimento da barra, antes 2 (agentes e ■) e depois 1 (só o ■). */
test('a ordem dos filhos do template é a ordem que se vê: campo, +, arquivo, desenho, microfone, contexto; e na caixa da direita debater, agentes, modelo, ■, ↑ (o Tab acompanha) (leva 5h, 5i)', () => {
  const { esquerda, direita } = barraDoTemplate();
  assert.deepEqual(esquerda.map(nome), ['p-input', 'p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar']);
  assert.deepEqual(direita.map(nome), ['p-debate', 'p-workflow', 'p-model', 'p-stop', 'p-send']);
  // o contexto (o anel, ver test/pilula-contexto.test.js) nasce à vista; só o ■ nasce escondido, porque depende do que está acontecendo (leva 5i: o 👥 e o ⚖ ficam sempre à vista)
  const escondidos = [...esquerda, ...direita].filter((c) => /\bhidden\b/.test(c)).map(nome);
  assert.deepEqual(escondidos, ['p-stop']);
});

test('enviar arquivo e desenhar são botões da barra, com o nome no hover e no leitor de tela, e o ícone vem do ico() na criação do painel (leva 5h)', () => {
  for (const [cls, titulo] of [['p-envarq', 'Enviar arquivos do computador'], ['p-desenhar', 'Desenhar']]) {
    const m = new RegExp('<button class="cb ' + cls + '"([^>]*)>').exec(HTML);
    assert.ok(m, 'falta o botão ' + cls + ' no template');
    assert.match(m[1], new RegExp('title="' + titulo + '"'), cls + ': o hover');
    assert.match(m[1], new RegExp('aria-label="' + titulo + '"'), cls + ': o leitor de tela');
  }
  assert.match(pegarBloco(APP, 'function ligarBotoesDaBarra(', 'ligarBotoesDaBarra'), /ico\('upload'\)[\s\S]*ico\('pencil-line'\)/, 'upload e pencil-line, os mesmos ícones do menu do +');
  assert.match(NEWPANE, /ligarBotoesDaBarra\(P, el\)/, 'o newPane liga os dois botões');
});

test('o campo ocupa a linha inteira em TODA largura de coluna, não só abaixo de 300 px (leva 5c)', () => {
  const campo = deTopo(CSS_UI, '.ck-app .p-input');
  assert.ok(campo, 'falta a regra de topo do .p-input');
  assert.match(campo.corpo, /flex:\s*1 1 100%\s*;/, 'flex-basis 100%: nada cabe ao lado dele, então o resto desce para a linha de baixo');
  assert.doesNotMatch(campo.corpo, /flex:\s*1 1 120px/, 'o campo dividia a linha com os botões');
  const soNoEstreito = regras(CSS_UI).filter((r) => r.contexto && /\.p-input\b/.test(r.seletor) && /\b(order|flex|flex-basis|width)\s*:/.test(r.corpo));
  assert.deepEqual(soNoEstreito.map(rotulo), [], 'nenhuma consulta de largura refaz o campo: o @container de 300 px saiu');
});

test('a barra quebra em duas linhas em toda largura: sem regra de quebra por largura nem por .p-stop/.p-cont/.p-sugs (leva 5c)', () => {
  const barra = deTopo(CSS_UI, '.ck-app .cmp-bar');
  assert.ok(barra, 'falta a regra de topo do .cmp-bar');
  assert.match(barra.corpo, /flex-wrap:\s*wrap\s*;/, 'quebra sempre; numa coluna estreitíssima a linha de baixo também pode quebrar');
  assert.match(barra.corpo, /[;\s]gap:\s*4px 2px\s*;/, '4 px entre as duas linhas e 2 px entre os botões, igual em toda largura');
  const poLargura = regras(CSS_UI).filter((r) => r.contexto && /\.cmp-bar\b/.test(r.seletor));
  assert.deepEqual(poLargura.map(rotulo), [], 'o que mexia na barra por largura (wrap, row-gap, :has do ■, do › e do ✨) já não faz falta');
  assert.doesNotMatch(CSS_UI, /\.cmp-bar:has\(\.p-(stop|cont|sugs)/);
});

/* Pendência da leva 4 (T9, pendencias-leva5.test.js): com a barra quebrada em duas linhas o ■/↑ ficava à esquerda da 2ª. Na leva 5c a barra
   passou a ter SEMPRE duas linhas, e o margin-left: auto do ■/↑ (regra de topo, vale em qualquer largura) os punha na ponta direita.
   Leva 5h (seção 4 da spec): quem vai para a ponta agora é o GRUPO da direita inteiro (agentes, chip, ›, ■/↑), e não só o ■/↑.
   Por que uma caixa (.cmp-dir) em vez de um margin-left: auto no primeiro item dela:
   - o primeiro item (agentes, .p-workflow) nascia ESCONDIDO e um item com display: none não empurra nada; o auto-margin teria de pular para o
     chip, e de volta, conforme os agentes aparecem (leva 5i: o ⚖ e o 👥 agora nascem à vista, mas o ■ ainda nasce escondido: o motivo da caixa
     segue de pé);
   - com os itens soltos numa coluna estreita (até ~330 px a barra quebra em 3 linhas), o chip podia ficar na 2ª linha e o ›/↑ sozinhos na 3ª,
     encostados na ESQUERDA (só quem tem o auto-margin vai para a ponta). A caixa quebra de linha inteira e a ponta é dela.
   Dois auto-margins na mesma linha (um no grupo, outro no ■/↑) dividiriam o vão e deixariam o ↑ solto no meio: por isso o ■/↑ perderam o deles. */
test('a direita da linha de baixo vai junta para a ponta: margin-left: auto no .cmp-dir, e o ■/↑ já não puxam sozinhos (leva 5h)', () => {
  const dir = deTopo(CSS_UI, '.ck-app .cmp-dir');
  assert.ok(dir, 'falta a regra de topo do .cmp-dir');
  assert.match(dir.corpo, /margin-left:\s*auto\s*;/);
  assert.match(dir.corpo, /display:\s*flex\s*;/);
  assert.match(dir.corpo, /flex-wrap:\s*wrap\s*;/, 'numa coluna estreitíssima o grupo quebra por dentro, sem sair da borda');
  assert.match(dir.corpo, /justify-content:\s*flex-end\s*;/, 'e o que sobra para a linha de baixo continua na ponta');
  assert.match(dir.corpo, /min-width:\s*0\s*;/, 'e pode encolher abaixo do conteúdo');
  const botao = deTopo(CSS_UI, '.ck-app .p-send, .ck-app .p-stop');
  assert.ok(botao, 'falta a regra de topo do Enviar/Parar');
  assert.doesNotMatch(botao.corpo, /margin-left/, 'a ponta é do grupo; com dois auto-margins o ↑ ficaria solto no meio');
  assert.deepEqual(regras(CSS_UI).filter((r) => r.contexto && /\.(p-(send|stop)|cmp-dir)\b/.test(r.seletor) && /margin/.test(r.corpo)).map(rotulo), []);
});

/* Fachada mínima do DOM: só o que o mostrarContinuar e o mostrarSugestoes usam. O insertBefore é fiel ao navegador: referência que
   não é filha do pai dá erro (NotFoundError), como no app de verdade. Leva 5h: a fachada ganhou o parentNode, porque a referência agora
   mora dentro da caixa .cmp-dir e quem insere precisa achar o pai pela própria referência. */
class El {
  constructor(tag) { this.tag = tag; this.className = ''; this.filhos = []; this.pai = null; this.title = ''; this.innerHTML = ''; this.ouvintes = {}; }
  get classes() { return this.className.split(/\s+/).filter(Boolean); }
  get parentNode() { return this.pai; }
  remove() { if (this.pai) { this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; } }
  appendChild(n) { n.remove(); n.pai = this; this.filhos.push(n); return n; }
  insertBefore(n, ref) {
    if (ref && ref.pai !== this) throw new Error('NotFoundError: a referência não é filha deste pai');
    n.remove(); n.pai = this;
    if (ref) this.filhos.splice(this.filhos.indexOf(ref), 0, n); else this.filhos.push(n);
    return n;
  }
  addEventListener(tipo, f) { (this.ouvintes[tipo] ||= []).push(f); }
  querySelector(sel) {
    const alvo = sel.slice(1);   // só ".classe"; seletor composto não acha nada, como um painel sem menu aberto
    for (const f of this.filhos) { if (f.classes.includes(alvo)) return f; const d = f.querySelector(sel); if (d) return d; }
    return null;
  }
}
function bancada() {
  const raiz = new El('section');
  const bar = raiz.appendChild(new El('div'));
  bar.className = 'cmp-bar';
  const { esquerda, direita } = barraDoTemplate();   // a barra do template de verdade
  for (const cls of esquerda) bar.appendChild(new El('button')).className = cls;
  const dir = bar.appendChild(new El('div'));
  dir.className = 'cmp-dir';
  for (const cls of direita) dir.appendChild(new El('button')).className = cls;
  const ctx = vm.createContext({
    $: (sel, no) => no.querySelector(sel), document: { createElement: (t) => new El(t) },
    ico: (n) => '<svg data-ic="' + n + '"></svg>', cfg: {}, podeContinuar: () => true, fecharMenus: () => {},
  });
  vm.runInContext(['mostrarSugestoes', 'limparSugestoes', 'mostrarContinuar', 'limparContinuar']
    .map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  return { ctx, P: { el: raiz }, ordem: () => dir.filhos.map((f) => nome(f.className)), esquerda: () => bar.filhos.filter((f) => f !== dir).map((f) => nome(f.className)) };
}

/* Leva 5h: o Continuar (›) saiu da esquerda e fica colado antes do ■/↑ (spec, seção 4). A Sugestão (✨) NÃO está na spec; fica ao lado dele, antes,
   porque as duas são o mesmo gesto (o que dizer a seguir): ✨ › ↑. Na esquerda continuariam empurrando o contexto para a direita toda vez
   que a sugestão chega. Venha qual vier primeiro, a ordem é a mesma. */
test('a Sugestão (✨) e o Continuar (›) entram na caixa da direita, antes do ■/↑, nesta ordem, venha qual vier primeiro (leva 5h)', () => {
  const FILA = ['p-debate', 'p-workflow', 'p-model', 'p-sugs', 'p-cont', 'p-stop', 'p-send'];
  const a = bancada();
  a.ctx.mostrarSugestoes(a.P, ['faça isso']);
  a.ctx.mostrarContinuar(a.P);
  assert.deepEqual(a.ordem(), FILA, 'a sugestão chegou primeiro');
  const b = bancada();
  b.ctx.mostrarContinuar(b.P);
  b.ctx.mostrarSugestoes(b.P, ['faça isso']);
  assert.deepEqual(b.ordem(), FILA, 'o continuar chegou primeiro');
  b.ctx.mostrarContinuar(b.P);   // chega de novo: troca o chip, não duplica nem muda de lugar
  assert.deepEqual(b.ordem(), FILA);
  b.ctx.limparContinuar(b.P);
  b.ctx.limparSugestoes(b.P);
  assert.deepEqual(b.ordem(), barraDoTemplate().direita.map(nome), 'sem os chips, volta a caixa do template');
  assert.deepEqual(b.esquerda(), ['p-input', 'p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar'], 'e a esquerda nunca é tocada');
});

test('o Continuar sozinho e a Sugestão sozinha também ficam colados antes do ■/↑, e a esquerda não se mexe (leva 5h)', () => {
  const c = bancada();
  c.ctx.mostrarContinuar(c.P);
  assert.deepEqual(c.ordem(), ['p-debate', 'p-workflow', 'p-model', 'p-cont', 'p-stop', 'p-send']);
  assert.deepEqual(c.esquerda(), ['p-input', 'p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar']);
  const s = bancada();
  s.ctx.mostrarSugestoes(s.P, ['uma', 'duas', 'três']);
  assert.deepEqual(s.ordem(), ['p-debate', 'p-workflow', 'p-model', 'p-sugs', 'p-stop', 'p-send']);
  assert.deepEqual(s.esquerda(), ['p-input', 'p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar']);
});

test('sem o ■ no painel (DOM incompleto) os dois chips não quebram e ficam antes do ↑; sem a caixa nem o ↑, entram no fim da barra (leva 5h)', () => {
  const t = bancada();
  const dir = t.P.el.querySelector('.cmp-dir');
  dir.filhos = dir.filhos.filter((f) => !f.classes.includes('p-stop'));
  t.ctx.mostrarContinuar(t.P);
  t.ctx.mostrarSugestoes(t.P, ['x']);
  assert.deepEqual(t.ordem(), ['p-debate', 'p-workflow', 'p-model', 'p-sugs', 'p-cont', 'p-send']);
  const nu = bancada();
  const barra = nu.P.el.querySelector('.cmp-bar');
  barra.filhos = barra.filhos.filter((f) => !f.classes.includes('cmp-dir'));   // sem a caixa da direita: nada de referência
  assert.doesNotThrow(() => { nu.ctx.mostrarContinuar(nu.P); nu.ctx.mostrarSugestoes(nu.P, ['x']); });
  assert.deepEqual(barra.filhos.slice(-2).map((f) => nome(f.className)), ['p-sugs', 'p-cont'], 'a sugestão continua antes do continuar');
});

/* Leva 5h: enviar arquivo (ícone upload) e desenhar (pencil-line) são os MESMOS gestos de "Enviar do computador" e "Desenhar" do menu do +, um
   clique mais perto (os dois itens continuam no menu). A prova é de comportamento: o item do menu e o botão da barra, na mesma bancada, fazem
   as mesmas chamadas. O botão só acrescenta o que o elItem já fazia antes de agir: fechar o menu que estiver aberto. */
function eventosDoItemDoMenu(nomeDoItem) {
  const eventos = [], itens = [];
  const ctx = vm.createContext({
    $: () => null, shortPath: (p) => p, elLinha: () => ({ setAttribute() {} }), tituloPopup: () => ({}), subPopup: () => ({}),
    novoMenu: () => ({ appendChild: (x) => itens.push(x), classList: { add() {} }, style: { setProperty() {} } }),
    elItem: (o, f) => ({ nome: o.nome, f }),
    abrirQuadro: () => eventos.push('quadro'), anexar: async (_P, arquivos) => { eventos.push('anexar:' + arquivos.join(',')); },
    window: { api: { pickFiles: async (tipo) => { eventos.push('escolher:' + tipo); return ['x.txt']; } } },
  });
  vm.runInContext(['menuAnexo', 'menuMais'].map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  ctx.menuMais({ cwd: 'C:\\proj' });
  itens.find((x) => x.nome === nomeDoItem).f();
  return eventos;
}
function bancadaDosAtalhos(arquivosEscolhidos = ['x.txt']) {
  const eventos = [];
  const el = new El('section');
  const novo = (cls) => { const b = el.appendChild(new El('button')); b.className = cls; b.html = ''; return b; };
  const envarq = novo('cb p-envarq'), desenhar = novo('cb p-desenhar');
  const ctx = vm.createContext({
    $: (sel, no) => no.querySelector(sel), ico: (n) => '<svg data-ic="' + n + '"></svg>', fecharMenus: () => eventos.push('fechou'),
    anexar: async (_P, arquivos) => { eventos.push('anexar:' + arquivos.join(',')); }, abrirQuadro: () => eventos.push('quadro'),
    window: { api: { pickFiles: async (tipo) => { eventos.push('escolher:' + tipo); return arquivosEscolhidos; } } },
  });
  vm.runInContext(['async function enviarArquivoDoPc(', 'function ligarBotoesDaBarra(']
    .map((a) => pegarBloco(APP, a, a)).join('\n'), ctx);
  const P = { id: 'p1', el };
  ctx.ligarBotoesDaBarra(P, el);
  const clicar = (b) => { const e = { parou: false, stopPropagation() { this.parou = true; } }; for (const f of b.ouvintes.click || []) f(e); return e; };
  return { ctx, P, el, envarq, desenhar, eventos, clicar, tique: () => new Promise((ok) => setImmediate(ok)) };
}

test('enviar arquivo faz o mesmo que "Enviar do computador" do menu do +: escolhe arquivos do computador e anexa (leva 5h)', async () => {
  const doMenu = eventosDoItemDoMenu('Enviar do computador');
  const t = bancadaDosAtalhos();
  assert.equal(t.envarq.innerHTML, '<svg data-ic="upload"></svg>', 'o ícone é o upload do menu');
  const e = t.clicar(t.envarq);
  await t.tique();
  assert.equal(e.parou, true, 'o clique não vaza para o fechamento global');
  assert.deepEqual(t.eventos, ['fechou', ...doMenu], 'fecha o menu aberto e faz exatamente as chamadas do item do menu');
  assert.deepEqual(doMenu, ['escolher:file', 'anexar:x.txt']);
});

test('enviar arquivo sem escolher nada (cancelou o seletor) não anexa nada (leva 5h)', async () => {
  const t = bancadaDosAtalhos([]);
  t.clicar(t.envarq);
  await t.tique();
  assert.deepEqual(t.eventos, ['fechou', 'escolher:file']);
});

test('desenhar faz o mesmo que "Desenhar" do menu do +: abre o quadro (leva 5h)', () => {
  const doMenu = eventosDoItemDoMenu('Desenhar');
  const t = bancadaDosAtalhos();
  assert.equal(t.desenhar.innerHTML, '<svg data-ic="pencil-line"></svg>', 'o ícone é o pencil-line do menu');
  const e = t.clicar(t.desenhar);
  assert.equal(e.parou, true);
  assert.deepEqual(doMenu, ['quadro']);
  assert.deepEqual(t.eventos, ['fechou', ...doMenu]);
});

test('painel sem os dois botões (molde antigo) não quebra ao ligar os atalhos (leva 5h)', () => {
  const t = bancadaDosAtalhos();
  const vazio = new El('section');
  assert.doesNotThrow(() => t.ctx.ligarBotoesDaBarra({ id: 'p2', el: vazio }, vazio));
});

test('visual Mac: a pele da barra e do campo não mexe na quebra, no tamanho nem na ordem (leva 5c)', () => {
  const daPele = regras(CSS_MAC).filter((r) => r.seletor.split(',').some((s) => /(^|\s)\.(cmp-bar|p-input)$/.test(s.trim())));
  assert.ok(daPele.length >= 2, 'achei a pele da barra e a do campo: ' + daPele.map(rotulo));
  for (const r of daPele) assert.doesNotMatch(r.corpo, /\b(display|flex|flex-wrap|flex-basis|order|gap|width|min-width|margin|padding)\s*:/, rotulo(r));
});

test('o campo cresce com o texto até 190 px e depois rola: o teto é o de antes, com o campo na largura inteira (leva 5c)', () => {
  assert.match(CSS_BASE, /\.p-input\{[^}]*max-height:190px/, 'teto no CSS');
  assert.match(APP, /const grow = \(\) => \{ inp\.style\.height = 'auto'; const h = inp\.scrollHeight; if \(h\) inp\.style\.height = Math\.min\(h, 190\) \+ 'px'; \};/, 'teto no auto-crescimento');
  const outroTeto = regras(CSS_UI + CSS_MAC).filter((r) => /\.p-input$/.test(r.seletor) && /max-height/.test(r.corpo));
  assert.deepEqual(outroTeto.map(rotulo), [], 'ninguém mais mexe no teto do campo');
});
