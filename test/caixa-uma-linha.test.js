'use strict';
/* Leva 4, Tarefa 7 (UI 3.1): caixa de escrever no modelo do iMessage, [+] campo 🎤 <modelo> ▾ [↑].
   Medidas: controles visíveis na caixa parada (antes 13; depois 5: +, campo, microfone, chip, enviar); a 470 px, 1 linha
   e caixa vazia ≤ 64 px (na prévia, Q8).
   Leva 5c (decisão do Hugo, 07/10): a caixa passou a ter SEMPRE 2 linhas, o campo em cima e o menu embaixo (test/caixa-duas-linhas.test.js).
   A "1 linha" da leva 4 virou história: dos testes daqui só mudou a ORDEM dos filhos no template (o campo subiu para antes do +). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const HTML = lerFonte('renderer', 'index.html');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const COLAB = lerFonte('renderer', 'collaboration.js');

function barraDoModelo() {
  const i = HTML.indexOf('<div class="cmp-bar">');
  // leva 5h, passo 3: o chip é um grupo com 3 botões dentro; aqui ele conta como UM item da barra (os 3 botões têm teste próprio em chip-do-modelo)
  const bar = HTML.slice(i, HTML.indexOf('\n      </div>', i)).replace(/<div class="p-model"[\s\S]*?\n {10}<\/div>/, '<button class="p-model"></button>');
  return [...bar.matchAll(/<(button|textarea)\b[^>]*class="([^"]+)"/g)].map((m) => m[2]);
}
const nome = (cls) => cls.split(' ').find((c) => c.startsWith('p-'));
// newPane(opts = {}): o pegarBloco pararia no "{}" do parâmetro; o corpo vai até a seção das colunas (como em test/ajustes.test.js:426)
const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));

/* Leva 5c: o campo veio para ANTES do + no template. A caixa agora é campo em cima e menu embaixo, e com o campo primeiro o Tab
   segue a ordem que se vê (campo, +, microfone, chip, enviar). Eram os mesmos 5 controles visíveis da leva 4, só em outra ordem. */
/* Leva 5h (seção 4 da spec): três botões fixos a mais. O enviar arquivo e o desenhar (os mesmos dois itens do menu do +, um clique mais perto) e o
   anel do contexto, que agora está SEMPRE à vista (a pílula nascia escondida e só aparecia a partir de 70 %).
   Medida: botões fixos na barra parada, antes 4 (+, microfone, chip, enviar) e depois 7 (+, arquivo, desenho, microfone, contexto, chip,
   enviar); escondidos, antes 3 (resumo, agentes, ■) e depois 2 (agentes, ■). A barra continua achatada pelo regex (o .cmp-dir da direita é um div
   e não entra), só mudam os nomes da lista.
   Leva 5i (seção 4 da spec): mais dois botões fixos, o ⚖ Debater e o 👥 Workflow, à vista antes do chip (o 👥 nascia escondido e o debate só existia no +).
   Medida: botões fixos na barra parada, antes 7 e depois 9; escondidos, antes 2 (agentes, ■) e depois 1 (só o ■). */
test('a barra tem o campo e 9 botões fixos; o resto é contextual e nasce escondido (UI 3.1, leva 5h, 5i)', () => {
  const itens = barraDoModelo();
  assert.deepEqual(itens.filter((c) => !/\bhidden\b/.test(c)).map(nome), ['p-input', 'p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar', 'p-debate', 'p-workflow', 'p-model', 'p-send']);
  assert.deepEqual(itens.filter((c) => /\bhidden\b/.test(c)).map(nome), ['p-stop']);
  assert.doesNotMatch(HTML, /cmp-top|p-slash|p-fluxo|p-modoenvio|p-tempo-total|cmp-gap/);
  assert.match(HTML, /class="cb p-plus"[^>]*aria-haspopup="menu"/);
  assert.ok(NEWPANE.length > 1000, 'não achei o corpo do newPane');
  assert.doesNotMatch(NEWPANE, /p-slash|p-fluxo|p-modoenvio/);
});

/* Leva 5d (decisão do Hugo, 07/10): o menu do + virou uma janelinha só de ícones (test/menu-mais-icones.test.js tem a estrutura, o teclado e o
   CSS). O que mudou AQUI, e por quê:
   - o menu não tem mais título "Anexar" nem subtítulo, e os itens chegam ao elItem com soIcone: true (botão só com o ícone);
   - o "Comandos" trocou o ícone "/" (um texto, que num menu só de ícones não diz nada) pelo square-slash;
   - o novoMenu de mentira agora tem classList e style (o menu ganha a classe menu-icones e as medidas do +) e o traço entre os grupos
     recebe role="separator" (setAttribute). O resto, os 5 itens de baixo, a ordem e as ações, é o de antes.
   Leva 5i (item 4 da spec): o ⚖ Debater e o 👥 Workflow viraram botões fixos da barra e SAÍRAM do menu padrão, que ficou com 3 ferramentas (Desenhar, Comandos e Voz,
   imagens e nuvem). Eles só voltam quando a barra está no nível 5 do encaixe (data-aperto="5" no .cmp-bar): aí são os 5 itens de antes. Medida: itens no menu padrão,
   antes 11 e depois 9; no nível 5, 11. O bench é o de antes, com `aperto` para o .cmp-bar de mentira (sem ele, o painel não tem barra e o menu é o padrão). */
function menuDoMais(aperto) {
  const itens = [];
  const ctx = vm.createContext({ $: (sel) => (sel === '.cmp-bar' && aperto !== undefined ? { dataset: { aperto } } : null), shortPath: (p) => p, elLinha: () => ({ linha: true, setAttribute() {} }),
    tituloPopup: (t) => ({ titulo: t }), subPopup: () => ({}),
    novoMenu: () => ({ appendChild: (x) => itens.push(x), classList: { add() {} }, style: { setProperty() {} } }), elItem: (o, f) => ({ nome: o.nome, ic: o.ic, soIcone: o.soIcone, f }),
    abrirQuadro: () => itens.push('quadro'), menuSkills: (P, filtro, focar) => itens.push('comandos:' + focar),
    window: { CockpitExperiments: { open: () => itens.push('voz') }, CockpitCollaboration: { open: () => itens.push('debate'), workflow: () => itens.push('workflow') } } });
  vm.runInContext(['menuAnexo', 'menuMais'].map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  ctx.menuMais({ id: 'reaberta', cwd: 'C:\\proj', el: {}, agentesTrabalho: new Map() });
  return itens;
}
test('o + abre os anexos e, embaixo, Desenhar, Comandos e Voz/imagens/nuvem; o Debate e o Workflow estão na barra e só voltam no nível 5 (UI 3.1, leva 5i)', () => {
  const itens = menuDoMais();
  const nomes = itens.filter((x) => x && x.nome).map((x) => x.nome);
  const ULTIMOS = ['Desenhar', 'Comandos', 'Voz, imagens e nuvem'];
  assert.deepEqual(nomes.slice(-3), ULTIMOS);
  assert.equal(nomes.length, 9, '6 anexos e 3 ferramentas');
  assert.ok(!nomes.includes('Debater com Codex e Claude') && !nomes.includes('Workflow dos agentes'), 'o ⚖ e o 👥 são botões da barra, e não itens do +');
  assert.ok(nomes.includes('Enviar do computador') && nomes.includes('Recortar a tela'), 'os anexos de sempre continuam');
  assert.equal(nomes.filter((n) => /Desenhar/.test(n)).length, 1, 'Desenhar aparece uma vez só');
  const item = (n) => itens.find((x) => x.nome === n);
  assert.deepEqual(ULTIMOS.map((n) => item(n).ic), ['pencil-line', 'square-slash', 'flask-conical']);
  assert.equal(itens.filter((x) => x && x.titulo).length, 0, 'sem o título "Anexar" (leva 5d)');
  assert.ok(itens.filter((x) => x && x.nome).every((x) => x.soIcone === true), 'os 9 itens são botões só de ícone (leva 5d)');
  for (const n of ULTIMOS) item(n).f();
  assert.deepEqual(itens.filter((x) => typeof x === 'string'), ['quadro', 'comandos:true', 'voz']);
  // só o nível 5 traz os dois de volta, no fim, na ordem de antes; os níveis de 0 a 4 não
  for (const aperto of ['', '0', '1', '2', '3', '4']) assert.equal(menuDoMais(aperto).filter((x) => x && x.nome).length, 9, 'nível "' + aperto + '": os dois seguem na barra');
  const no5 = menuDoMais('5');
  const nomes5 = no5.filter((x) => x && x.nome).map((x) => x.nome);
  assert.deepEqual(nomes5.slice(-5), [...ULTIMOS, 'Debater com Codex e Claude', 'Workflow dos agentes']);
  assert.deepEqual(['Debater com Codex e Claude', 'Workflow dos agentes'].map((n) => no5.find((x) => x.nome === n).ic), ['scale', 'users']);
  for (const n of ['Debater com Codex e Claude', 'Workflow dos agentes']) no5.find((x) => x.nome === n).f();
  assert.deepEqual(no5.filter((x) => typeof x === 'string'), ['debate', 'workflow']);
});

/* Leva 4, onda 3 (revisão da T7): o botão dos agentes só aparece com P.agentesTrabalho.size, e isso só enche com o evento ao vivo.
   Conversa reaberta que já teve agentes ficava sem entrada para o workflow. O + ganhou "Workflow dos agentes", sempre presente.
   Medida: caminhos até o workflow numa conversa reaberta com agentes (antes 0; depois 1, pelo +).
   Leva 5i: o 👥 virou botão fixo e fica sempre à vista, então a conversa reaberta tem o caminho direto, sem o +; o + só ganha o item de volta no nível 5. O clique
   dele é ligado no ligarBotoesDaBarra (e não mais no newPane). */
test('conversa reaberta, sem agente ao vivo: o botão 👥 da barra abre o workflow, e o + só tem o mesmo item no nível 5 (UI 3.1, leva 5i)', () => {
  const itens = menuDoMais('5');   // a barra no nível 5: o + é o caminho
  const item = itens.find((x) => x && x.nome === 'Workflow dos agentes');
  assert.ok(item, 'no nível 5 o + tem o Workflow dos agentes mesmo com P.agentesTrabalho vazio');
  assert.equal(item.ic, 'users');
  item.f();
  assert.deepEqual(itens.filter((x) => typeof x === 'string'), ['workflow'], 'abre o workflow da conversa (CockpitCollaboration.workflow)');
  assert.ok(!menuDoMais().some((x) => x && x.nome === 'Workflow dos agentes'), 'com a barra à vista o + não repete o botão');
  assert.match(pegarBloco(APP, 'function ligarBotoesDaBarra(', 'ligarBotoesDaBarra'), /workflow\.addEventListener\('click'[^\n]*CockpitCollaboration\?\.workflow\(P\)/, 'o botão da barra abre o mesmo workflow');
  assert.doesNotMatch(NEWPANE, /workflow\.addEventListener/, 'e o newPane já não liga o clique do 👥 (leva 5i)');
});

test('Enviar: clique direito ou segurar abre "Enviar agora / Pôr na fila", só com ele trabalhando (UI 3.1)', () => {
  const itens = [], envios = [];
  const ctx = vm.createContext({ novoMenu: () => ({ appendChild: (x) => itens.push(x) }), tituloPopup: (t) => ({ titulo: t }),
    elItem: (o, f) => ({ nome: o.nome, ic: o.ic, f }), send: (P, o) => envios.push(o) });
  vm.runInContext(pegarBloco(APP, 'function menuEnviar(', 'menuEnviar'), ctx);
  assert.equal(ctx.menuEnviar({ busy: false }), false, 'parado: nada a escolher');
  assert.equal(itens.length, 0);
  assert.equal(ctx.menuEnviar({ busy: true }), true);
  const [agora, fila] = itens.filter((x) => x.nome);
  assert.deepEqual([agora.nome, agora.ic, fila.nome, fila.ic], ['Enviar agora', 'corner-down-right', 'Pôr na fila', 'list-end']);
  agora.f(); fila.f();
  assert.deepEqual(envios.map((o) => o.envio), ['entra', 'fila']);   // objeto do vm tem outro protótipo: compara o campo
  assert.match(pegarBloco(APP, 'async function send(', 'send'), /const modoEnvio = \(opcoes && opcoes\.envio\) \|\| P\.envio;\s*\n\s*if \(modoEnvio === 'entra' && !P\.ligando\)/);
  assert.match(NEWPANE, /btEnviar\.addEventListener\('contextmenu'/);
  assert.match(NEWPANE, /btEnviar\.addEventListener\('pointerdown'/);
});

test('↑ vira ■ com ele trabalhando e o campo vazio; com texto, volta o ↑ (UI 3.1)', () => {
  assert.match(CSS_UI, /\.ck-app \.pane\.ocupado \.cmp-bar:has\(\.p-input:placeholder-shown\) \.p-send \{\s*display: none;/);
  assert.match(CSS_UI, /\.ck-app \.pane\.ocupado \.cmp-bar:has\(\.p-input:not\(:placeholder-shown\)\) \.p-stop \{\s*display: none;/);
});

/* Leva 5i (seção 4 da spec): o 👥 é o botão FIXO do Workflow, sempre à vista (antes nascia escondido e só aparecia com o 1º agente), e o número é só dos
   agentes ATIVOS (antes contava todos, até os que já acabaram). Os detalhes (cada estado, o destaque, o hover) estão em test/barra-debate-workflow.test.js. */
test('agentes: o botão fica sempre à vista; com agente ativo leva o número, sem ativo só o ícone (UI 3.1, leva 5i)', () => {
  const cls = new Set(['p-workflow']);
  const bt = { dataset: {}, innerHTML: '', title: '', setAttribute() {}, classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } } };
  const ctx = vm.createContext({ $: (sel) => (sel === '.p-workflow' ? bt : null), ico: (n) => '<svg data-ic="' + n + '"></svg>' });
  vm.runInContext(pegarBloco(APP, 'function pintarAgentes(', 'pintarAgentes'), ctx);
  const P = { el: {}, agentesTrabalho: new Map() };
  ctx.pintarAgentes(P);
  assert.equal(cls.has('hidden'), false, 'sem agentes o botão continua à vista');
  assert.equal(bt.innerHTML, '<svg data-ic="users"></svg>', 'e leva só o ícone, sem número');
  P.agentesTrabalho.set('a1', { state: 'running' }); P.agentesTrabalho.set('a2', { state: 'pending' }); P.agentesTrabalho.set('a3', { state: 'completed' });
  ctx.pintarAgentes(P);
  assert.equal(cls.has('hidden'), false);
  assert.equal(bt.innerHTML, '<svg data-ic="users"></svg><span>2</span>', 'o concluído não conta');
  assert.match(pegarBloco(APP, 'function sincronizarTempoTrabalho(', 'sincronizarTempoTrabalho'), /if \(typeof pintarAgentes === 'function'\) pintarAgentes\(P\);/);
});

test('o Debater e o frasco saíram da barra; o robô entra antes da barra (UI 3.1)', () => {
  assert.doesNotMatch(pegarBloco(COLAB, 'function attach(', 'attach'), /p-debate|p-experiments/);
  assert.match(pegarBloco(APP, 'function pintarRobos(', 'pintarRobos'), /cmp\.insertBefore\(box, \$\('\.cmp-bar', P\.el\)\)/);
});

/* O menu do "segurar" cobre o botão (as janelinhas do painel ocupam o painel inteiro): o clique de quem solta o dedo cai fora do
   botão, fecharia o menu recém-aberto (o document escuta o clique) e não pode mandar a mensagem. O bloco do Enviar é recortado
   do newPane e roda com timers e janela de mentira; passa(ms) dispara só os timers daquele tempo. */
function bancadaDoEnviar(busy) {
  const ini = NEWPANE.indexOf("const btEnviar = $('.p-send', el);");
  const bloco = NEWPANE.slice(ini, NEWPANE.indexOf("$('.p-stop', el)", ini));
  assert.ok(ini > 0 && bloco.length > 200, 'não achei o bloco do Enviar no newPane');
  const botao = { ouvintes: {}, addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); } };
  const janela = { ouvintes: {}, addEventListener(t, f, captura) { (this.ouvintes[t] ||= []).push({ f, captura }); },
    removeEventListener(t, f) { this.ouvintes[t] = (this.ouvintes[t] || []).filter((x) => x.f !== f); } };
  const timers = [], reg = { menus: 0, envios: 0 };
  const ctx = vm.createContext({ $: () => botao, el: {}, P: { busy }, window: janela,
    send: () => { reg.envios++; }, menuEnviar: (P) => { reg.menus++; return !!P.busy; },
    setTimeout: (f, ms) => timers.push({ f, ms, vivo: true }), clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].vivo = false; } });
  vm.runInContext(bloco, ctx);
  const evento = (extra) => ({ button: 0, preventDefault() { this.prevenido = true; }, stopPropagation() { this.parado = true; }, ...extra });
  return {
    reg, evento, janela,
    vivos: () => timers.filter((t) => t.vivo).length,
    noBotao: (tipo, extra) => { const ev = evento(extra); for (const f of botao.ouvintes[tipo] || []) f(ev); return ev; },
    naJanela: (tipo, ev = evento()) => { for (const x of [...(janela.ouvintes[tipo] || [])]) x.f(ev); return ev; },
    passa: (ms) => { for (const t of timers) if (t.vivo && t.ms === ms) { t.vivo = false; t.f(); } },
    escutando: (tipo) => (janela.ouvintes[tipo] || []).length,
  };
}

test('segurar o Enviar com ele trabalhando abre o menu; o clique de quem solta não fecha o menu nem manda (UI 3.1)', () => {
  const b = bancadaDoEnviar(true);
  b.noBotao('pointerdown');
  assert.equal(b.vivos(), 1, 'armou o segurar');
  b.passa(500);
  assert.equal(b.reg.menus, 1, 'abriu aos 0,5 s, com o botão ainda apertado');
  assert.equal(b.escutando('click'), 1, 'engole o clique do soltar, na captura');
  assert.equal(b.janela.ouvintes.click[0].captura, true);
  b.naJanela('pointerup');                                   // soltou
  const soltar = b.naJanela('click');
  assert.equal(soltar.parado, true, 'o clique do soltar não chega ao painel (o menu fica) nem ao botão');
  assert.equal(b.reg.envios, 0, 'e não manda');
  b.passa(0);                                                // depois do clique, a captura sai
  assert.equal(b.escutando('click') + b.escutando('pointerup') + b.escutando('pointercancel'), 0, 'não sobra ouvinte na janela');
  assert.equal(b.naJanela('click').parado, undefined, 'o clique seguinte volta ao normal');
  b.noBotao('click');
  assert.equal(b.reg.envios, 1, 'e o próximo clique no ↑ manda');
});

test('Enviar: parado o segurar não abre nada, soltar antes de 0,5 s é um clique, o direito abre o menu e o toque cancelado libera (UI 3.1)', () => {
  const parado = bancadaDoEnviar(false);
  parado.noBotao('pointerdown'); parado.passa(500);
  assert.equal(parado.reg.menus, 1, 'tentou abrir, mas parado não há o que escolher');
  assert.equal(parado.escutando('click'), 0, 'sem menu, nada a engolir');
  parado.noBotao('click');
  assert.equal(parado.reg.envios, 1, 'o clique manda');

  const b = bancadaDoEnviar(true);
  b.noBotao('pointerdown'); b.noBotao('pointerup'); b.passa(500);
  assert.equal(b.reg.menus, 0, 'soltou antes de 0,5 s: era um clique');
  b.noBotao('pointerdown', { button: 2 });
  assert.equal(b.vivos(), 0, 'o botão direito não arma o segurar');
  const direito = b.noBotao('contextmenu');
  assert.deepEqual([direito.prevenido, direito.parado, b.reg.menus], [true, true, 1], 'o direito abre o menu e some com o do navegador');

  const toque = bancadaDoEnviar(true);
  toque.noBotao('pointerdown'); toque.passa(500);
  toque.naJanela('pointercancel'); toque.passa(0);           // toque cancelado (o navegador abriu o contextmenu): não há clique
  assert.equal(toque.escutando('click') + toque.escutando('pointerup') + toque.escutando('pointercancel'), 0);
});

/* Leva 4, rodada final, item 5 (revisão final a7ed9b2c1aa8b7f86): o botão dos agentes agora leva o ícone mais o número (users + 2), mas
   a regra dele tinha width: 28px fixo e o número saía do botão; o raio de 50 % também entortava um botão mais largo que alto.
   Medida: largura do botão com o número (antes fixa em 28 px, sem lugar para o número; depois automática, no mínimo 28 px). */
test('botão dos agentes: largura automática (mínimo 28 px), 2 px entre o ícone e o número e raio de 14 px no visual Mac (UI 3.1)', () => {
  const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
  const regraDe = (seletor) => {
    const i = CSS_MAC.indexOf('\n' + seletor + ' {');
    assert.ok(i >= 0, 'não achei a regra ' + seletor);
    return CSS_MAC.slice(i, CSS_MAC.indexOf('}', i));
  };
  const barra = regraDe('.ck-app .cmp-bar :is(.p-workflow, .p-debate)');
  assert.match(barra, /[;{\s]width:\s*auto\s*;/, 'largura automática: ' + barra);
  assert.match(barra, /[;{\s]min-width:\s*28px\s*;/, 'no mínimo 28 px');
  assert.match(barra, /[;{\s]gap:\s*2px\s*;/, '2 px entre o ícone e o número');
  assert.doesNotMatch(barra, /[;{\s]width:\s*28px/, 'sobrou a largura fixa de 28 px');
  const mac = regraDe('html.visual-mac .ck-app .cmp-bar :is(.p-workflow, .p-debate)');
  assert.match(mac, /border-radius:\s*14px\s*;/, 'raio de 14 px (metade da altura de 28 px: a pílula não entorta)');
  assert.doesNotMatch(mac, /border-radius:\s*50%/, 'sobrou o raio de 50 %');
});
