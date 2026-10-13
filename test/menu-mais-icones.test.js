'use strict';
/* Leva 5d (decisão do Hugo, 07/10): o menu do + deixa de ser a janela grande "Anexar" (título, subtítulo e a descrição de cada item, no
   meio do painel) e vira uma janelinha PEQUENA, SÓ DE ÍCONES, colada no +, embaixo: abre para cima a partir do +, sem texto fixo, com o
   nome ao passar o mouse (title) e no leitor de tela (aria-label), em dois grupos com um traço fino entre eles (6 anexos, 5 ferramentas).
   Medidas (conta, a confirmar na prévia):
   - texto fixo na janela: antes 1 título + 1 subtítulo + 11 descrições; depois 0;
   - largura: antes min(430px, painel - 36px), no meio do painel, com véu; depois 216 px, colada no +, sem véu;
   - itens sem ícone próprio: antes 3 (o image servia a Enviar imagem, Recortar a tela e Fotografar) mais 1 que era um texto (a barra "/");
     depois 0.
   Os recortes do app.js rodam em vm com um DOM de mentira (o mesmo molde de test/menus-teclado.test.js, com o que a grade precisa a mais:
   style.setProperty, getBoundingClientRect e title).
   Leva 5i (item 4 da spec): o ⚖ Debater e o 👥 Workflow viraram botões fixos da barra e SAÍRAM deste menu. Só voltam no nível 5 do encaixe (quando a barra os
   esconde por falta de lugar). Medida: botões do menu padrão, antes 11 (6 anexos e 5 ferramentas) e depois 9 (6 e 3); no nível 5, os 11 de antes. A bancada
   ganhou o `nivel` (o data-aperto do .cmp-bar de mentira); os testes de teclado seguem com os 11 (nível 5), e o menu de 9 tem o seu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');

// elItem({ ic, … }, aoClicar): o corpo começa no "{" depois do ") {" (o pegarBloco pararia na desestruturação)
function corpo(nome) {
  const i = APP.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei ' + nome);
  let nivel = 0;
  for (let j = APP.indexOf(') {', i) + 2; j < APP.length; j++) { if (APP[j] === '{') nivel++; else if (APP[j] === '}' && --nivel === 0) return APP.slice(i, j + 1); }
  throw new Error('não fechei ' + nome);
}

// o ICONES e o ico() de verdade, com os blocos Object.assign que vêm logo depois do literal (como em test/chip-do-modelo.test.js)
const MAPA = (() => {
  const ctx = vm.createContext({});
  const ini = APP.indexOf('const ICONES = '), fim = APP.indexOf('\n', APP.indexOf('const ico = (n) =>'));
  vm.runInContext(APP.slice(ini, fim).replace('const ICONES = ', 'var ICONES = ').replace('const ico = ', 'var ico = '), ctx);
  return ctx;
})();

/* O DOM de mentira. Só entende ".classe" e [role="x"] nos seletores, e as tags div, span e button no innerHTML (cria os filhos que
   trazem class=, como o menus-teclado). getBoundingClientRect devolve o que o teste pôs em `caixa`, ou zeros. */
const casa = (e, sel) => {
  const papel = /^\[role="([^"]+)"\]$/.exec(sel);
  return papel ? e.attrs.role === papel[1] : sel.startsWith('.') && e._cls.has(sel.slice(1));
};
const ZERO = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
/* Leva 5i: o ⚖ Debater e o 👥 Workflow viraram botões fixos da barra e SAÍRAM deste menu; só voltam quando o encaixe (encaixarBarra) põe a barra no nível 5 e
   tira os dois dela. Por isso o menu padrão tem 9 botões (6 anexos, o traço e 3 ferramentas: Desenhar, Comandos, Voz/imagens/nuvem) e, no nível 5, os 11 de
   antes. `nivel` é o data-aperto do .cmp-bar do painel de mentira (0 = sem o atributo, a barra inteira); o menuMais lê dali. */
function bancada({ colunas = 6, pasta = 'C:\\proj', nivel = 0 } = {}) {
  const eventos = [], tarefas = [];
  const doc = { activeElement: null };
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this._cls = new Set(); this.attrs = {}; this.ouvintes = {}; this.dataset = {};
      this.tabIndex = -1; this._html = ''; this.title = ''; this.type = ''; this.vars = {}; this.caixa = null;
      const este = this;
      this.style = { setProperty(k, v) { este.vars[k] = String(v); }, getPropertyValue(k) { return este.vars[k] || ''; } };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c) }; }
    get innerHTML() { return this._html; }
    set innerHTML(h) {
      this._html = h; for (const f of this.filhos) f.pai = null; this.filhos = [];
      for (const m of String(h).matchAll(/<(div|span|button) class="([^"]+)"/g)) { const e = new El(m[1]); e.className = m[2]; this.appendChild(e); }
    }
    get textContent() { return this._texto || ''; }
    set textContent(v) { this._texto = v; }
    get parentNode() { return this.pai; }
    get isConnected() { let x = this; while (x.pai) x = x.pai; return x === doc.body; }
    appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
    contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    matches(s) { return s.split(',').some((t) => this.tagName === t.trim().toUpperCase()); }
    querySelectorAll(sel) { const r = []; const andar = (x) => { for (const f of x.filhos) { if (casa(f, sel)) r.push(f); andar(f); } }; andar(this); return r; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
    // o evento do teste anota o que o ouvinte fez com ele: preventDefault e stopPropagation
    disparar(t, extra) {
      const e = { target: this, defaultPrevented: false, parou: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, ...(extra || {}) };
      for (const f of this.ouvintes[t] || []) f(e);
      return e;
    }
    click() { this.disparar('click'); }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return this.caixa ? this.caixa() : ZERO; }
  }
  doc.body = new El('body'); doc.createElement = (t) => new El(t);
  const pane = new El('section'), modal = new El('div'), cx = new El('div'), mais = new El('button'), pop = new El('div'), global = new El('div'), barra = new El('div');
  pane.className = 'pane'; modal.className = 'modal p-modal hidden'; cx.className = 'modal-cx'; mais.className = 'cb p-plus'; pop.className = 'hidden'; global.className = 'hidden';
  barra.className = 'cmp-bar'; if (nivel) barra.dataset.aperto = String(nivel);   // nível 0: a barra inteira, sem o atributo (o encaixe marca '' ou nada)
  modal.appendChild(cx); pane.appendChild(modal); pane.appendChild(mais); pane.appendChild(barra); doc.body.appendChild(pane); doc.body.appendChild(pop); doc.body.appendChild(global);
  const P = { id: 'p1', el: pane, cwd: pasta };
  const janela = {
    api: { pickFiles: async (tipo) => { eventos.push('escolher:' + tipo); return tipo === 'folder' ? ['C:\\a', 'C:\\b'] : ['x.txt']; } },
    CockpitExperiments: { open: () => eventos.push('voz') },
    CockpitCollaboration: { open: () => eventos.push('debate'), workflow: () => eventos.push('workflow') },
  };
  const ctx = vm.createContext({
    document: doc, panes: new Map([[P.id, P]]), ICONES: MAPA.ICONES, ico: MAPA.ico, marcaDoMotor: () => '', window: janela, focusPane: P,
    $: (sel, raiz) => (sel === '#popGrupo' ? pop : sel === '#modalGrupo' ? global : raiz ? raiz.querySelector(sel) : null),
    cancelarSaidaDoModal() {}, soltarNavArquivos() {}, pararBuscaEmVoo() {}, queueMicrotask: (f) => tarefas.push(f),
    shortPath: (p) => 'curto:' + p,
    anexar: async (_P, arquivos) => { eventos.push('anexar:' + arquivos.join(',')); },
    inserirNoInput: (_P, texto) => eventos.push('inserir:' + texto),
    recortarTela: () => eventos.push('recortar'), fotografar: () => eventos.push('fotografar'), abrirQuadro: () => eventos.push('quadro'),
    menuSkills: (_P, filtro, focar) => eventos.push('comandos:' + JSON.stringify(filtro) + ':' + focar),
    fecharModalGlobal() {}, fecharVisor() {}, fecharTerminalDoPainel() {}, fecharModal() {}, interromperPainel: () => eventos.push('parou'),
  });
  vm.runInContext(['fecharPopGlobal', 'fecharMenus', 'novoMenu', 'elItem', 'elLinha', 'tituloPopup', 'subPopup', 'menuAnexo', 'menuMais', 'tratarEsc']
    .map(corpo).join('\n'), ctx);
  const rodar = () => { while (tarefas.length) tarefas.shift()(); };
  /* A grade na tela: `colunas` botões por linha; o grupo dos anexos (6) vem primeiro, o traço ocupa uma linha, o das ferramentas (5) vem
     depois. Cada botão ganha a caixa que o navegador daria (32 px, vão de 2 px). Só para a navegação por linha. */
  const pintarGrade = (menu) => {
    const botoes = menu.filhos.filter((f) => f._cls.has('mi-so-ic'));
    const linhasDosAnexos = Math.ceil(6 / colunas);
    botoes.forEach((b, k) => {
      const anexo = k < 6, dentro = anexo ? k : k - 6;
      const linha = (anexo ? 0 : linhasDosAnexos + 1) + Math.floor(dentro / colunas), col = dentro % colunas;
      b.caixa = () => ({ left: 100 + col * 34, top: 400 + linha * 34, width: 32, height: 32, right: 132 + col * 34, bottom: 432 + linha * 34 });
    });
    return botoes;
  };
  const abrir = () => { mais.focus(); const menu = ctx.menuMais(P); rodar(); return { menu, botoes: pintarGrade(menu) }; };
  return { ctx, doc, El, P, pane, modal, cx, mais, eventos, rodar, abrir, atualizar: () => new Promise((ok) => setImmediate(ok)) };
}
const nomeDe = (b) => b.getAttribute('aria-label');
const ANEXOS = [
  ['Enviar do computador', 'upload'], ['Enviar imagem', 'image'], ['Adicionar pasta', 'folder'], ['Pasta deste painel', 'map-pin'],
  ['Recortar a tela', 'crop'], ['Fotografar', 'camera'],
];
const FERRAMENTAS = [['Desenhar', 'pencil-line'], ['Comandos', 'square-slash'], ['Voz, imagens e nuvem', 'flask-conical']];
const DOS_DOIS = [['Debater com Codex e Claude', 'scale'], ['Workflow dos agentes', 'users']];
// o menu padrão (9 botões) e o do nível 5 do encaixe (os 11 de antes da leva 5i, com o ⚖ e o 👥 de volta no fim)
const EXPECTATIVA = [...ANEXOS, ...FERRAMENTAS];
const EXPECTATIVA_NIVEL_5 = [...ANEXOS, ...FERRAMENTAS, ...DOS_DOIS];
const POR_NIVEL = [[0, EXPECTATIVA], [5, EXPECTATIVA_NIVEL_5]];

/* ---------- estrutura ---------- */
test('o + abre uma janelinha de botões só de ícone: 6 anexos, um traço fino e 3 ferramentas (5 no nível 5 do encaixe), sem título nem subtítulo (leva 5d, 5i)', () => {
  for (const [nivel, esperado] of POR_NIVEL) {
    const ferramentas = esperado.length - 6;
    const t = bancada({ nivel });
    const { menu, botoes } = t.abrir();
    assert.ok(menu === t.cx, 'é a mesma caixa .modal-cx do painel');
    assert.ok(menu._cls.has('menu-icones'), 'a classe que o CSS usa para encolher e ancorar a caixa');
    assert.ok(t.modal._cls.has('como-menu') && !t.modal._cls.has('hidden'), 'aberta como menu');
    assert.equal(botoes.length, 6 + ferramentas, 'nível ' + nivel);
    assert.deepEqual(menu.filhos.map((f) => f.tagName + (f._cls.has('menu-linha') ? '.traco' : '')),
      [...Array(6).fill('BUTTON'), 'DIV.traco', ...Array(ferramentas).fill('BUTTON')], 'nível ' + nivel + ': 6 botões, o traço, ' + ferramentas + ' botões: nada mais');
    const traco = menu.filhos[6];
    assert.equal(traco.getAttribute('role'), 'separator', 'o traço é um separador para o leitor de tela');
    for (const c of ['mo-top', 'mo-tit', 'mo-sub', 'mi-txt', 'mi-n', 'mi-d', 'mo-x']) assert.equal(menu.querySelectorAll('.' + c).length, 0, 'sem .' + c);
    // texto que aparece na tela: nenhum (o svg não tem texto; sobram só os espaços entre os desenhos do ícone)
    const visivel = (e) => (e._texto || '') + String(e._html).replace(/<[^>]*>/g, '') + e.filhos.map(visivel).join('');
    assert.equal(visivel(menu).trim(), '', 'a janelinha não escreve nada: só ícones');
    for (const b of botoes) {
      assert.equal(b.tagName, 'BUTTON');
      assert.equal(b.type, 'button', 'botão que não envia formulário nenhum');
      assert.equal(b.getAttribute('role'), 'menuitem', 'continua sendo item do role="menu"');
      assert.equal(b.tabIndex, 0, 'entra no Tab');
      assert.ok(b._cls.has('mi') && b._cls.has('mi-so-ic'));
    }
  }
});

/* Leva 5i: o ⚖ e o 👥 são botões da barra e não estão mais no menu; só voltam no nível 5 (o teste de comportamento completo está em test/barra-debate-workflow.test.js).
   Medida: botões no menu padrão, antes 11 e depois 9; no nível 5, 11. */
test('o menu padrão não traz mais o Debater nem o Workflow; no nível 5 do encaixe (a barra os escondeu) eles voltam, no fim, nesta ordem (leva 5i)', () => {
  for (const nivel of [0, 1, 2, 3, 4]) {
    const nomes = bancada({ nivel }).abrir().botoes.map(nomeDe);
    assert.equal(nomes.length, 9, 'nível ' + nivel);
    assert.ok(!nomes.includes('Debater com Codex e Claude') && !nomes.includes('Workflow dos agentes'), 'nível ' + nivel + ': os dois estão na barra');
  }
  const nomes = bancada({ nivel: 5 }).abrir().botoes.map(nomeDe);
  assert.deepEqual(nomes.slice(-2), ['Debater com Codex e Claude', 'Workflow dos agentes']);
  assert.equal(nomes.length, 11);
  const semBarra = bancada();   // painel sem o .cmp-bar (molde antigo): o menu de sempre, sem os dois
  semBarra.pane.filhos = semBarra.pane.filhos.filter((f) => !f._cls.has('cmp-bar'));
  assert.equal(semBarra.abrir().botoes.length, 9);
});

test('cada botão tem aria-label = nome e title = "Nome — descrição"; os nomes e a ordem são os de antes (leva 5d, 5i)', () => {
  for (const [nivel, esperado] of POR_NIVEL) {
    const t = bancada({ pasta: 'C:\\Users\\hugom\\proj', nivel });
    const { botoes } = t.abrir();
    assert.deepEqual(botoes.map(nomeDe), esperado.map((e) => e[0]), 'nível ' + nivel);
    for (const b of botoes) {
      const nome = nomeDe(b);
      assert.ok(b.title.startsWith(nome + ' \u2014 '), 'title começa por "' + nome + ' — ": ' + b.title);
      assert.ok(b.title.length > nome.length + 3, 'e traz a descrição: ' + b.title);
    }
    assert.equal(botoes[0].title, 'Enviar do computador \u2014 escolher arquivos');
    assert.equal(botoes[3].title, 'Pasta deste painel \u2014 curto:C:\\Users\\hugom\\proj', 'a descrição da pasta é o caminho curto do painel');
    assert.match(botoes[4].title, /^Recortar a tela \u2014 .*Ctrl\+Alt\+R/, 'o atalho do recorte continua à mão, no title');
    assert.match(botoes[7].title, /^Comandos \u2014 .*digite \//, 'e o / digitado no campo, também');
  }
});

test('os ícones são DIFERENTES e todos têm desenho: o image não serve mais a três itens e a barra "/" virou um ícone de verdade (leva 5d, 5i)', () => {
  for (const [nivel, esperado] of POR_NIVEL) {
    const t = bancada({ nivel });
    const { botoes } = t.abrir();
    const desenho = (b) => b.filhos.map((f) => f._html).join('');
    assert.deepEqual(botoes.map(desenho), esperado.map(([, ic]) => MAPA.ico(ic)), 'nível ' + nivel + ': cada item desenha o ícone combinado');
    assert.equal(new Set(botoes.map(desenho)).size, esperado.length, 'nenhum par de botões com o mesmo desenho');
    assert.equal(new Set(esperado.map((e) => e[1])).size, esperado.length, 'nem com o mesmo nome de ícone');
    for (const [nome, ic] of esperado) {
      assert.ok(MAPA.ICONES[ic], nome + ': falta o ícone ' + ic + ' no ICONES');
      assert.ok(MAPA.ICONES[ic].length > 20, nome + ': o ' + ic + ' está vazio');
    }
  }
  // os 3 novos, no estilo de traço dos outros (Lucide): só path, circle e rect fechados
  for (const ic of ['crop', 'camera', 'square-slash']) assert.match(MAPA.ICONES[ic], /^(<(path|circle|rect) [^>]*\/>)+$/, ic + ': só path/circle/rect fechados');
  // só o menu do +: o "/" de texto segue valendo nas linhas de skills do menu / (menuSkills), que não mudou
  assert.ok(!/ic: '\/'/.test(pegarBloco(APP, 'function menuMais(', 'menuMais')), 'a barra de texto saiu dos itens do +');
});

test('as ações são as de antes e cada clique fecha a janelinha (leva 5d, 5i)', async () => {
  const quando = [
    ['escolher:file', 'anexar:x.txt'], ['escolher:image', 'anexar:x.txt'], ['escolher:folder', 'inserir:C:\\a C:\\b'], ['inserir:C:\\proj'],
    ['recortar'], ['fotografar'],
    ['quadro'], ['comandos:"":true'], ['voz'], ['debate'], ['workflow'],
  ];
  for (const [nivel, esperado] of POR_NIVEL) {
    for (let k = 0; k < esperado.length; k++) {
      const t = bancada({ nivel });
      const { botoes } = t.abrir();
      botoes[k].click();
      await t.atualizar();
      assert.deepEqual(t.eventos, quando[k], 'nível ' + nivel + ': ' + esperado[k][0]);
      assert.ok(t.modal._cls.has('hidden') && !t.modal._cls.has('como-menu'), esperado[k][0] + ': fechou a janelinha');
      assert.ok(t.doc.activeElement === t.mais, esperado[k][0] + ': e o foco voltou ao +');
    }
  }
});

test('o "Anexar arquivo…" do menu / segue abrindo a janela de antes, com título, subtítulo e descrições (leva 5d)', () => {
  assert.match(pegarBloco(APP, 'async function menuSkills(', 'menuSkills'), /nome: 'Anexar arquivo…', act: \(\) => menuAnexo\(P\) \}/);
  const t = bancada();
  t.mais.focus();
  const m = t.ctx.menuAnexo(t.P);
  t.rodar();
  assert.ok(!m._cls.has('menu-icones'), 'sem o modo compacto');
  assert.equal(m.querySelector('.mo-tit').textContent, 'Anexar');
  assert.equal(m.querySelector('.mo-sub').textContent, 'Manda o caminho do arquivo junto com a sua mensagem.');
  const itens = m.querySelectorAll('.mi');
  assert.equal(itens.length, 6);
  assert.ok(itens.every((i) => i.tagName === 'DIV' && i.querySelector('.mi-n') && i.querySelector('.mi-d')), 'linhas com nome e descrição, como sempre');
  assert.equal(itens[0].querySelector('.mi-n').textContent, 'Enviar do computador');
  assert.equal(m.querySelectorAll('.menu-linha').length, 0, 'e nada de ferramentas: só os 6 anexos');
});

/* ---------- posição: colada no + ---------- */
test('a janelinha mede o + ao abrir e grava onde ele está, dentro do painel: --mi-esq e --mi-base (leva 5d)', () => {
  const t = bancada();
  t.pane.clientLeft = 1;   // a borda esquerda do painel (border-left: 1px)
  t.pane.caixa = () => ({ left: 200, top: 0, right: 600, bottom: 800, width: 400, height: 800 });
  t.mais.caixa = () => ({ left: 215, top: 757, right: 243, bottom: 785, width: 28, height: 28 });   // margem 8 + borda 1 + respiro 6 = 15 px do pé
  const { menu } = t.abrir();
  assert.equal(menu.style.getPropertyValue('--mi-esq'), '14px', 'da borda de dentro do painel até a esquerda do + (215 - 200 - 1)');
  assert.equal(menu.style.getPropertyValue('--mi-base'), '43px', 'do pé do painel até o TOPO do + (800 - 757): a janelinha sobe dali');
});

test('com a barra quebrada em 3 linhas o + fica mais alto, e a janelinha sobe junto: a conta vem do + de verdade, não de uma constante (leva 5d)', () => {
  const t = bancada();
  t.pane.caixa = () => ({ left: 0, top: 0, right: 300, bottom: 700, width: 300, height: 700 });
  t.mais.caixa = () => ({ left: 14, top: 627, right: 42, bottom: 655, width: 28, height: 28 });   // 43 + 30 (uma linha a mais embaixo)
  const { menu } = t.abrir();
  assert.equal(menu.style.getPropertyValue('--mi-base'), '73px');
  assert.equal(menu.style.getPropertyValue('--mi-esq'), '14px');
});

test('sem medida (painel ou + sem caixa, ou sem o +) nada é gravado e nada quebra: o CSS tem os valores de reserva (leva 5d)', () => {
  const t = bancada();
  const { menu } = t.abrir();   // as caixas são zeros
  assert.equal(menu.style.getPropertyValue('--mi-esq'), '');
  assert.equal(menu.style.getPropertyValue('--mi-base'), '');
  assert.equal(menu.filhos.filter((f) => f._cls.has('mi-so-ic')).length, 9, 'o menu padrão: 6 anexos e 3 ferramentas (leva 5i: o ⚖ e o 👥 saíram dele)');
  const sem = bancada();
  sem.pane.filhos = sem.pane.filhos.filter((f) => f !== sem.mais);   // painel sem o botão +
  assert.doesNotThrow(() => sem.abrir());
});

/* ---------- teclado ---------- */
const tecla = (botao, key, extra) => botao.disparar('keydown', { key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

test('ao abrir o foco vai para o 1º ícone, e Esc fecha e devolve o foco ao + (leva 5d)', () => {
  const t = bancada();
  const { botoes } = t.abrir();
  assert.ok(t.doc.activeElement === botoes[0], 'o foco entra no 1º ícone (Enviar do computador)');
  const esc = tecla(botoes[3], 'Escape');
  assert.deepEqual([esc.defaultPrevented, esc.parou], [false, false], 'o botão deixa o Esc passar: quem fecha é o Esc global (tratarEsc)');
  botoes[3].focus();
  assert.equal(t.ctx.tratarEsc(t.P, true), 'fechou', 'é o que o Esc global chama');
  assert.ok(t.modal._cls.has('hidden'));
  assert.ok(t.doc.activeElement === t.mais, 'o foco volta ao +');
});

test('clique fora fecha: no resto do painel (a .p-modal transparente) ou em qualquer outro lugar da tela; clique na própria janelinha não fecha (leva 5d)', () => {
  const t = bancada();
  const { menu } = t.abrir();
  let parou = 0;
  menu.onclick({ stopPropagation() { parou++; } });
  assert.equal(parou, 1, 'o clique dentro da caixa não sobe ao document, que fecharia os menus');
  t.modal.onclick({ target: menu });
  assert.ok(!t.modal._cls.has('hidden'), 'clicar na caixa (ou no respiro dela) não fecha');
  t.modal.onclick({ target: t.modal });
  assert.ok(t.modal._cls.has('hidden') && !t.modal._cls.has('como-menu'), 'clicar no resto do painel fecha');
  assert.ok(t.doc.activeElement === t.mais, 'e o foco volta ao +');
  assert.ok(/document\.addEventListener\('click', fecharMenus\);/.test(APP), 'e o clique fora do painel fecha pelo document, como sempre');
});

/* Leva 5i: o teclado da grade não depende de quantos botões ela tem. Estes testes seguem com os 11 de antes (a barra no nível 5, com o ⚖ e o 👥 de volta no fim);
   o menu padrão, de 9, tem o seu teste logo depois. Os nós do DOM de mentira ficam FORA dos assert (compara-se o índice ou um booleano). */
test('setas esquerda e direita andam na ordem dos ícones, de um grupo ao outro, e dão a volta nas pontas; Home e End vão às pontas (leva 5d)', () => {
  const t = bancada({ nivel: 5 });
  const { botoes } = t.abrir();
  const ir = (de, key) => { botoes[de].focus(); const e = tecla(botoes[de], key); return { e, onde: botoes.indexOf(t.doc.activeElement) }; };
  assert.equal(ir(0, 'ArrowRight').onde, 1);
  const salto = ir(5, 'ArrowRight');
  assert.equal(salto.onde, 6, 'do Fotografar (último anexo) ao Desenhar (1ª ferramenta)');
  assert.deepEqual([salto.e.defaultPrevented, salto.e.parou], [true, true], 'a seta é do menu: não rola nem vaza');
  assert.equal(ir(10, 'ArrowRight').onde, 0, 'no último, a direita dá a volta');
  assert.equal(ir(0, 'ArrowLeft').onde, 10, 'no primeiro, a esquerda dá a volta');
  assert.equal(ir(7, 'ArrowLeft').onde, 6);
  assert.equal(ir(4, 'Home').onde, 0);
  assert.equal(ir(4, 'End').onde, 10);
});

test('setas para cima e para baixo trocam de linha pela posição na tela: 6 colunas, a coluna mais próxima, e dão a volta (leva 5d)', () => {
  const t = bancada({ colunas: 6, nivel: 5 });
  const { botoes } = t.abrir();
  const ir = (de, key) => { botoes[de].focus(); tecla(botoes[de], key); return botoes.indexOf(t.doc.activeElement); };
  assert.equal(ir(2, 'ArrowDown'), 8, 'a 3ª coluna dos anexos desce para a 3ª das ferramentas');
  assert.equal(ir(0, 'ArrowDown'), 6);
  assert.equal(ir(5, 'ArrowDown'), 10, 'a 6ª coluna não existe nas ferramentas (são 5): vai à mais próxima, a 5ª');
  assert.equal(ir(8, 'ArrowUp'), 2, 'e de volta');
  assert.equal(ir(10, 'ArrowUp'), 4);
  assert.equal(ir(8, 'ArrowDown'), 2, 'na última linha, a seta para baixo volta à primeira');
  assert.equal(ir(2, 'ArrowUp'), 8, 'e na primeira, a seta para cima vai à última');
});

test('numa coluna estreita a grade quebra em mais linhas e as setas verticais seguem as linhas que se veem (leva 5d)', () => {
  const t = bancada({ colunas: 4, nivel: 5 });   // anexos: 4 + 2; ferramentas: 4 + 1
  const { botoes } = t.abrir();
  const ir = (de, key) => { botoes[de].focus(); tecla(botoes[de], key); return botoes.indexOf(t.doc.activeElement); };
  assert.equal(ir(1, 'ArrowDown'), 5, '1ª linha para a 2ª, mesma coluna');
  assert.equal(ir(3, 'ArrowDown'), 5, 'a 4ª coluna não existe na 2ª linha (só 2): a mais próxima');
  assert.equal(ir(5, 'ArrowDown'), 7, 'da 2ª linha dos anexos à 1ª das ferramentas (o traço não é parada)');
  assert.equal(ir(9, 'ArrowDown'), 10, 'a última linha só tem o Workflow');
  assert.equal(ir(10, 'ArrowDown'), 0, 'e abaixo dela a volta ao início (coluna 1)');
  assert.equal(ir(6, 'ArrowUp'), 4, 'das ferramentas de volta aos anexos');
});

test('o menu padrão, de 9 botões, anda do mesmo jeito: as setas dão a volta nas pontas, descem para a coluna mais próxima das 3 ferramentas e o Tab fecha o ciclo no último (leva 5i)', () => {
  const t = bancada({ colunas: 6 });
  const { botoes } = t.abrir();
  assert.equal(botoes.length, 9);
  const ir = (de, key, extra) => { botoes[de].focus(); const e = tecla(botoes[de], key, extra); return { e, onde: botoes.indexOf(t.doc.activeElement) }; };
  assert.equal(ir(8, 'ArrowRight').onde, 0, 'no último (Voz, imagens e nuvem) a direita dá a volta');
  assert.equal(ir(0, 'ArrowLeft').onde, 8, 'no primeiro, a esquerda dá a volta');
  assert.equal(ir(4, 'End').onde, 8);
  assert.equal(ir(5, 'ArrowRight').onde, 6, 'do Fotografar ao Desenhar');
  assert.equal(ir(2, 'ArrowDown').onde, 8, 'a 3ª coluna dos anexos desce para a 3ª das 3 ferramentas');
  assert.equal(ir(5, 'ArrowDown').onde, 8, 'a 6ª coluna não existe nas ferramentas (são 3): vai à mais próxima, a 3ª');
  assert.equal(ir(8, 'ArrowDown').onde, 2, 'na última linha a seta para baixo volta à primeira');
  assert.equal(ir(8, 'Tab').onde, 0, 'Tab no último volta ao 1º');
  assert.equal(ir(0, 'Tab', { shiftKey: true }).onde, 8, 'Shift+Tab no 1º vai ao último');
});

test('Tab dá a volta dentro da janelinha: no último vai ao 1º, Shift+Tab no 1º vai ao último; no meio e com Ctrl o Tab passa (leva 5d)', () => {
  const t = bancada({ nivel: 5 });
  const { botoes } = t.abrir();
  const e1 = tecla(botoes[10], 'Tab');
  assert.ok(t.doc.activeElement === botoes[0], 'Tab no último volta ao 1º');
  assert.equal(e1.defaultPrevented, true, 'e segura o Tab do navegador, que sairia do menu');
  const e2 = tecla(botoes[0], 'Tab', { shiftKey: true });
  assert.ok(t.doc.activeElement === botoes[10], 'Shift+Tab no 1º vai ao último');
  assert.equal(e2.defaultPrevented, true);
  botoes[4].focus();
  const meio = tecla(botoes[4], 'Tab');
  assert.deepEqual([meio.defaultPrevented, t.doc.activeElement === botoes[4]], [false, true], 'no meio o navegador anda sozinho (todos têm tabIndex 0)');
  botoes[10].focus();
  const ctrl = tecla(botoes[10], 'Tab', { ctrlKey: true });
  assert.deepEqual([ctrl.defaultPrevented, t.doc.activeElement === botoes[10]], [false, true], 'Ctrl+Tab é atalho do app (troca de pasta), não do menu');
});

test('Enter e Espaço ativam o ícone focado, uma vez só (Enter segurado não repete) e o foco volta ao + (leva 5d)', async () => {
  const t = bancada();
  const { botoes } = t.abrir();
  botoes[6].focus();
  const rep = tecla(botoes[6], 'Enter', { repeat: true });
  assert.deepEqual([rep.defaultPrevented, rep.parou, t.eventos], [true, true, []], 'a repetição da tecla segurada não clica, mas é consumida');
  assert.ok(!t.modal._cls.has('hidden'), 'e a janelinha segue aberta');
  const enter = tecla(botoes[6], 'Enter');
  assert.deepEqual([enter.defaultPrevented, t.eventos], [true, ['quadro']], 'Enter ativa o Desenhar');
  assert.ok(t.doc.activeElement === t.mais, 'e o foco volta ao +');
  const outra = bancada({ nivel: 5 });   // leva 5i: o Debater só está no menu no nível 5
  const g = outra.abrir();
  g.botoes[9].focus();
  tecla(g.botoes[9], ' ');
  await outra.atualizar();
  assert.deepEqual(outra.eventos, ['debate'], 'o Espaço ativa o Debater');
});

test('letras e atalhos com Ctrl, Alt ou Cmd passam pelo ícone sem ser engolidos; só as teclas da grade são do menu (leva 5d)', () => {
  const t = bancada();
  const { botoes } = t.abrir();
  botoes[3].focus();
  for (const [key, extra] of [['a', {}], ['PageDown', {}], ['F2', {}], ['ArrowRight', { ctrlKey: true }], ['ArrowLeft', { altKey: true }], ['Home', { metaKey: true }]]) {
    const e = tecla(botoes[3], key, extra);
    assert.deepEqual([key, e.defaultPrevented, e.parou], [key, false, false]);
    assert.ok(t.doc.activeElement === botoes[3], key + ': o foco não saiu do ícone');
  }
});

test('o teclado da grade é só dos ícones: as linhas do menu de antes (Anexar do /) seguem sem setas próprias (leva 5d)', () => {
  const t = bancada();
  t.mais.focus();
  const m = t.ctx.menuAnexo(t.P);
  t.rodar();
  const itens = m.querySelectorAll('.mi');
  const e = tecla(itens[1], 'ArrowDown');
  assert.deepEqual([e.defaultPrevented, e.parou], [false, false]);
  assert.ok(t.doc.activeElement === itens[0], 'o foco continua onde estava: no 1º item');
});

/* ---------- CSS ---------- */
/* Todas as regras do CSS, sem os comentários (o mesmo leitor de test/caixa-duas-linhas.test.js, sem as consultas de largura). */
function regras(css) {
  const sem = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const saida = [];
  let i = 0;
  while (i < sem.length) {
    const abre = sem.indexOf('{', i);
    if (abre < 0) break;
    let nivel = 1, k = abre + 1;
    while (k < sem.length && nivel) { nivel += sem[k] === '{' ? 1 : sem[k] === '}' ? -1 : 0; k++; }
    const prelude = sem.slice(i, abre).replace(/\s+/g, ' ').trim();
    const dentro = sem.slice(abre + 1, k - 1);
    if (/^@(container|media|supports|layer)\b/.test(prelude)) saida.push(...regras(dentro).map((r) => ({ ...r, contexto: prelude })));
    else if (!prelude.startsWith('@')) saida.push({ contexto: '', seletor: prelude, corpo: dentro });
    i = k;
  }
  return saida;
}
const JANELA = '.ck-app .p-modal.como-menu > .modal-cx.menu-icones';
const deTopo = (css, seletor) => regras(css).find((r) => !r.contexto && r.seletor === seletor);
// calc(6 * var(--mi-lado) + 5 * 2px) com --mi-lado: 32 → 202 (a conta de verdade, sem o calc e sem o px)
const px = (expr, vars = {}) => Function('return ' + String(expr).replace(/var\((--[\w-]+)\)/g, (_, v) => vars[v]).replace(/calc\(/g, '(').replace(/(\d)px/g, '$1'))();

test('CSS: a janelinha é pequena e fica ancorada embaixo, à esquerda, saindo do + para cima (leva 5d)', () => {
  const r = deTopo(CSS_UI, JANELA);
  assert.ok(r, 'falta a regra ' + JANELA);
  assert.match(r.corpo, /position:\s*absolute\s*;/, 'solta do centro do painel');
  assert.match(r.corpo, /[;\s]left:\s*var\(--mi-esq\)\s*;/, 'a esquerda é a do + (medida pelo app.js)');
  assert.match(r.corpo, /[;\s]bottom:\s*calc\(var\(--mi-base\) \+ 4px\)\s*;/, 'a base fica 4 px acima do topo do +: abre para cima');
  assert.match(r.corpo, /--mi-esq:\s*14px\s*;/, 'valor de reserva da esquerda (margem 8 + borda 1 + respiro 6, menos a borda do painel)');
  assert.match(r.corpo, /--mi-base:\s*43px\s*;/, 'valor de reserva da altura: 15 px do pé até a linha de baixo + 28 do botão');
  assert.doesNotMatch(r.corpo, /[;\s](top|right):/, 'nunca ancorada no topo nem na direita');
  assert.match(r.corpo, /place-self:\s*end start\s*;/, 'a .modal é uma grade com place-items: center; sem isto o alinhamento herdado a poria no meio do que sobra entre os recuos');
  assert.match(r.corpo, /display:\s*flex\s*;/);
  assert.match(r.corpo, /flex-wrap:\s*wrap\s*;/, 'quebra em mais linhas quando falta largura');
  assert.match(r.corpo, /overflow:\s*auto\s*;/, 'e, no pior caso, rola em vez de sair do painel');
  assert.match(r.corpo, /background:\s*var\(--raised\)\s*;/);
  assert.match(r.corpo, /border:\s*1px solid var\(--line-strong\)\s*;/);
  assert.match(r.corpo, /box-shadow:\s*var\(--shadow-float\)\s*;/);
  assert.match(r.corpo, /transform-origin:\s*left bottom\s*;/, 'a entrada (cockpit-anim.css) nasce do canto do +');
});

test('CSS: 6 botões de 32 px por linha dão 216 px; cabem numa coluna de 260 px (e na de 240) e, mais estreita, quebram em vez de sair do painel (leva 5d)', () => {
  const r = deTopo(CSS_UI, JANELA);
  const vars = { '--mi-lado': '32', '--mi-esq': '14' };
  const lado = /--mi-lado:\s*(\d+)px\s*;/.exec(r.corpo);
  assert.ok(lado && lado[1] === '32', 'botões de 32 px');
  const largura = /[;\s]width:\s*(calc\([^;]+\))\s*;/.exec(r.corpo);
  assert.ok(largura, 'largura própria, em cima do lado do botão');
  assert.equal(px(largura[1], vars), 216, '6 x 32 + 5 x 2 de vão + 2 x 6 de respiro + 2 de borda');
  const max = /max-width:\s*(calc\([^;]+\))\s*;/.exec(r.corpo);
  assert.ok(max, 'e um teto que a deixa dentro do painel');
  assert.match(max[1], /100%/, 'o teto é uma fatia do painel');
  assert.match(max[1], /var\(--mi-esq\)/, 'descontada a esquerda onde ela nasce');
  for (const painel of [260, 240]) assert.ok(px(max[1].replace('100%', String(painel - 1)), vars) >= 216, 'em ' + painel + ' px o teto não força a quebra');
  assert.ok(px(max[1].replace('100%', '200'), vars) < 216, 'num painel de 200 px o teto é menor que a grade: ela quebra');
  assert.match(r.corpo, /max-height:\s*calc\(100% - var\(--mi-base\)[^;]*\)\s*;/, 'e uma altura máxima que não passa do topo do painel');
});

test('CSS: sem véu nem borrão atrás, o botão tem 32 px, o traço ocupa a linha inteira e o foco usa o anel --focus (leva 5d)', () => {
  const veu = deTopo(CSS_UI, '.ck-app .p-modal.como-menu:has(> .modal-cx.menu-icones)');
  assert.ok(veu, 'falta a regra que tira o véu');
  assert.match(veu.corpo, /background:\s*transparent\s*;/);
  assert.match(veu.corpo, /backdrop-filter:\s*none\s*;/);
  const botao = deTopo(CSS_UI, JANELA + ' .mi');
  assert.ok(botao, 'falta a regra do botão');
  assert.match(botao.corpo, /width:\s*var\(--mi-lado\)\s*;/);
  assert.match(botao.corpo, /height:\s*var\(--mi-lado\)\s*;/);
  assert.match(botao.corpo, /padding:\s*0\s*;/);
  assert.match(botao.corpo, /margin:\s*0\s*;/, 'tira a margem negativa do .p-modal .mi (style.css)');
  assert.match(botao.corpo, /flex:\s*none\s*;/);
  const traco = deTopo(CSS_UI, JANELA + ' .menu-linha');
  assert.ok(traco, 'falta a regra do traço');
  assert.match(traco.corpo, /flex:\s*0 0 100%\s*;/, 'o traço pega a linha toda: o 1º grupo termina e o 2º começa na linha de baixo');
  assert.match(traco.corpo, /height:\s*1px\s*;/, 'fino');
  const foco = deTopo(CSS_UI, JANELA + ' .mi:focus-visible');
  assert.ok(foco, 'falta o foco do botão');
  assert.match(foco.corpo, /outline-offset:\s*-2px\s*;/, 'o anel (2 px, --focus, do .ck-app :focus-visible) fica por dentro, sem bater no vizinho nem ser cortado');
  assert.doesNotMatch(foco.corpo, /outline:\s*none|outline:\s*0/, 'o anel nunca some');
  assert.match(CSS_UI, /\.ck-app :focus-visible \{\s*outline: 2px solid var\(--focus\);/, 'e quem o desenha é o de sempre');
});

test('CSS: tudo da janelinha vale só com a caixa aberta como menu; a mesma caixa vira terminal, contas e diff depois (leva 5d)', () => {
  const da = regras(CSS_UI + '\n' + CSS_MAC).filter((r) => /menu-icones/.test(r.seletor));
  assert.ok(da.length >= 6, 'achei as regras da janelinha: ' + da.length);
  for (const r of da) assert.match(r.seletor, /\.como-menu/, 'sem .como-menu o estilo vazaria para a janela seguinte: ' + r.seletor);
  assert.match(deTopo(CSS_UI, '.ck-app .p-modal.como-menu').corpo, /z-index:\s*550/, 'o z-index do menu segue onde estava');
  assert.match(CSS_UI, /\.ck-app \.modal\.p-modal:not\(\.como-menu\) \{[^}]*inset: 0;[^}]*padding: max\(20px, 5vh\) max\(20px, 5vw\);/, 'a janela grande de verdade não mudou');
});

test('CSS: no visual Mac os botões da janelinha são redondos, como os da barra da caixa (leva 5d)', () => {
  const r = deTopo(CSS_MAC, 'html.visual-mac ' + JANELA + ' .mi');
  assert.ok(r, 'falta a regra do visual Mac');
  assert.match(r.corpo, /border-radius:\s*50%\s*;/);
  assert.match(CSS_MAC, /html\.visual-mac \.ck-app \.cmp-bar \.cb \{[^}]*border-radius: 50%;/, 'a barra da caixa é redonda desde antes: é com ela que combina');
});
