'use strict';
/* Leva 3, Tarefa 7 (R5-04 + R5-06): busca e comentários do leitor sem percorrer o documento inteiro a cada letra ou a
   cada comentário. Documento sintético: 20 mil nós de texto, "achada" em 1 de cada 13 (1539 resultados). Medidas:
   - percursos do documento (TreeWalker) ao digitar 5 letras seguidas (antes 10; depois 0, e 1 na pausa);
   - percursos ao abrir Comentários com 40 comentários (antes 40; depois 1);
   - busca de "achada" abaixo de 60 ms (antes 129-153 ms medidos nesta máquina, quase tudo para achar os nós dos 1500
     destaques; o plano previa ~170-210 ms; depois 2-9 ms);
   - ciclo de vida: o timer e o mapa da busca não sobram no Enter, nas setas, ao fechar a busca, no dispose e no redesenho.
   Auditoria 2 (M-1): resultado num nó trocado sem afterRender (antes: destaque no nó solto e o corpo subia 300 px; depois:
   o mapa é refeito uma vez e o corpo fica parado). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FONTE = fs.readFileSync(path.join(__dirname, '../src/renderer/reader-tools.js'), 'utf8');
const assentar = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function leitor({ comentarios = [], linhas = 20000 } = {}) {
  const medida = { percursos: 0 }, criados = [], timers = new Map();
  let seq = 0;
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {};
      this.style = { setProperty() {}, removeProperty() {} }; this._cls = new Set(); this.textContent = ''; this.hidden = false;
      this.title = ''; this.value = ''; this.placeholder = ''; this.disabled = false; this.scrollTop = 0; criados.push(this);
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } }; }
    set innerHTML(_) {}
    appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.children.push(n); return n; }
    append(...ns) { for (const n of ns) this.appendChild(n); }
    before(n) { const p = this.parentNode; if (n.parentNode) n.remove(); n.parentNode = p; p.children.splice(p.children.indexOf(this), 0, n); }
    after(n) { const p = this.parentNode; if (n.parentNode) n.remove(); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
    remove() { const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } }
    replaceChildren(...ns) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...ns); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener() {}
    removeEventListener() {}
    querySelector(sel) { return sel === '.visor-cx' ? this.visorCx || null : null; }
    querySelectorAll() { return []; }
    contains() { return false; }
    focus() {}
    select() {}
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    // o visor (dialog) está na página: está no documento quem tem o visor entre os ancestrais
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === dialog; }
  }
  let textos = Array.from({ length: linhas }, (_, i) => ({ data: 'linha ' + i + ' do documento ' + (i % 13 === 0 ? 'achada ' : ''), isConnected: true }));
  for (const t of textos) t.length = t.data.length;
  const texto = textos.map((t) => t.data).join('');
  const dialog = new El('div'), toolbar = new El('div'), body = new El('div');
  dialog.visorCx = new El('div');
  dialog.append(dialog.visorCx, toolbar, body);
  // o corpo do leitor ocupa 600 px da tela; um trecho no documento aparece no meio dele, e um Range num nó que saiu do
  // documento não tem posição (tudo zero), como no navegador
  body.getBoundingClientRect = () => ({ top: 100, bottom: 700, left: 0, right: 800, width: 800, height: 600 });
  const janela = { CSS: { highlights: new Map() }, Highlight: class { constructor(...r) { this.r = r; } }, innerWidth: 1200, getSelection: () => null };
  const ctx = vm.createContext({
    window: janela, CSS: janela.CSS, Highlight: janela.Highlight, NodeFilter: { SHOW_TEXT: 4 }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    document: {
      createElement: (t) => new El(t),
      createTreeWalker: () => { medida.percursos++; let i = 0; const lista = textos; return { nextNode: () => lista[i++] || null }; },
      createRange: () => {
        const r = { setStart(no) { r.no = r.startContainer = no; }, setEnd() {},
          // leva 4 (M-1): Range montado num nó que mudou de lugar nasce recolhido, como no navegador
          get collapsed() { return !!(r.no && r.no.colapsa); },
          getBoundingClientRect: () => (r.no.isConnected ? { top: 300, bottom: 320 } : { top: 0, bottom: 0 }) };
        return r;
      },
    },
    setTimeout: (fn) => { timers.set(++seq, fn); return seq; }, clearTimeout: (id) => { timers.delete(id); },
    crypto: { randomUUID: () => 'id' }, navigator: {},
  });
  vm.runInContext(FONTE, ctx);
  const estado = { revision: 0, comments: comentarios, draft: null, view: {} };
  const montado = janela.CockpitReaderTools.mount({
    dialog, body, toolbar, document: { id: 'doc', version: 'v1' }, text: texto, markdown: true, path: 'C:/doc.md',
    api: { readerCommentsGet: async () => ({ ok: true, state: estado }), readerCommentsSave: async () => ({ ok: true, state: estado }) },
    getMode: () => 'preview', setMode() {}, textForMode: () => texto, reload() {}, prepareDraft: () => true, icon: () => '', headings: () => [],
  });
  return {
    medida, zerar() { medida.percursos = 0; },
    // pelo aria-label: o title do "Buscar" é trocado para "Buscar no documento (Ctrl+F)" depois de criado
    botao: (rotulo) => criados.find((e) => e.tagName === 'BUTTON' && e.attrs['aria-label'] === rotulo),
    campo: () => criados.find((e) => e.tagName === 'INPUT' && e.placeholder === 'Buscar neste documento'),
    contador: () => criados.find((e) => e.className === 'reader-search-count'),
    rodarTimers() { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); },
    // ciclo de vida (R5-04): o retorno do mount, os timers que sobraram, a barra de busca, o desenho atual e o destaque do resultado atual
    montado, pendentes: () => timers.size, barra: () => criados.find((e) => e.className === 'reader-search'),
    // os mesmos textos em nós novos; os velhos saem do documento
    nos: () => textos, redesenhar() { textos = textos.map((n) => { n.isConnected = false; return { data: n.data, length: n.length, isConnected: true }; }); },
    destaqueAtual: () => [...janela.CSS.highlights].find(([nome]) => nome.startsWith('reader-current-'))?.[1].r[0],
    // auditoria 2 (M-1): um nó só reescrito, sem afterRender (o carregarImagensDoMd troca o texto do convite e da barra)
    corpo: body, trocarNo(i) { const velho = textos[i]; velho.isConnected = false; textos[i] = { data: velho.data, length: velho.length, isConnected: true }; },
    // leva 4 (M-1): o nó continua no documento, mas em outro lugar (o mapa velho monta um Range recolhido)
    deslocarNo(i) { const velho = textos[i]; velho.colapsa = true; textos[i] = { data: velho.data, length: velho.length, isConnected: true }; },
    // o corpo sai da página sem passar pelo dispose: ele e os nós de texto ficam fora do documento
    desligar() { body.parentNode.remove(); for (const n of textos) n.isConnected = false; },
  };
}

test('digitar 5 letras seguidas não percorre o documento; a busca roda uma vez, na pausa (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  t.zerar();
  const campo = t.campo();
  for (const parcial of ['a', 'ac', 'ach', 'acha', 'achad']) { campo.value = parcial; campo.oninput(); }
  const enquantoDigita = t.medida.percursos;
  t.rodarTimers();
  assert.equal(enquantoDigita, 0, 'percursos enquanto digita: ' + enquantoDigita);
  assert.equal(t.medida.percursos, 1, 'percursos depois da pausa: ' + t.medida.percursos);
  assert.equal(t.contador().textContent, '1 de 1539');
});

test('Enter logo depois de digitar busca na hora e vai para o próximo resultado (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  campo.onkeydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(t.contador().textContent, '2 de 1539', 'a busca pendente rodou e o Enter andou um');
});

test('busca de "achada" com 1539 resultados fica abaixo de 60 ms (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'linha 1 '; campo.oninput(); t.rodarTimers();   // aquece
  const t0 = performance.now();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  const ms = performance.now() - t0;
  assert.ok(ms < 60, 'busca de "achada" em 20 mil nós: ' + Math.round(ms) + ' ms');
  assert.equal(t.contador().textContent, '1 de 1539', 'a busca rodou de verdade (sem isso, o tempo baixo não prova nada)');
});

test('abrir Comentários com 40 comentários percorre o documento uma vez (R5-06)', async () => {
  const comentarios = Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, text: 'nota ' + i, quote: 'linha ' + (i * 13) + ' do documento', prefix: '', suffix: '', start: 0, end: 0, version: 'v0', mode: 'preview', resolved: false }));
  const t = leitor({ comentarios });
  await assentar();
  t.zerar();
  t.botao('Comentários').onclick();
  assert.equal(t.medida.percursos, 1, 'percursos para desenhar 40 comentários: ' + t.medida.percursos);
});

test('nodeAt acha o mesmo nó que a busca linear, com nós de texto vazios no meio (R5-04)', () => {
  const { nodeAt } = require('../src/renderer/reader-tools.js');
  // mulberry32 (Math.imul), como o test/linkar-arquivos-linear.test.js: o "semente * 1103515245" de antes passava de
  // 2^53, perdia os bits baixos e só dava 33 nós não vazios em 7.948
  let semente = 3;
  const sorteio = (n) => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const vistos = { vazios: 0, cheios: 0 };
  for (let k = 0; k < 2000; k++) {
    const nodes = []; let pos = 0;
    for (let i = 0, n = sorteio(12); i < n; i++) { const len = sorteio(4); nodes.push({ start: pos, end: pos + len }); pos += len; vistos[len ? 'cheios' : 'vazios']++; }
    for (let p = 0; p <= pos + 1; p++) assert.equal(nodeAt(nodes, p, false), nodes.find((n) => n.end > p));
    for (let p = 1; p <= pos + 1; p++) assert.equal(nodeAt(nodes, p, true), nodes.find((n) => n.end >= p && n.start < p));
  }
  // o sorteio tem de passar pelos dois casos: nós com texto e nós vazios no meio
  assert.ok(vistos.cheios > 5000 && vistos.vazios > 1000, 'nós sorteados: ' + JSON.stringify(vistos));
});

/* Ciclo de vida da busca adiada (R5-04): o timer e o mapa do documento não sobram em nenhuma saída. */
const enter = (campo) => campo.onkeydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

test('Enter com busca pendente a roda uma vez e não deixa timer sobrando (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  assert.equal(t.pendentes(), 1, 'a busca espera a pausa');
  t.zerar();
  enter(campo);
  assert.equal(t.pendentes(), 0, 'o Enter consumiu o timer: não sobra busca para voltar ao 1º resultado');
  assert.equal(t.medida.percursos, 1, 'um percurso: a busca feita na hora; o andar do Enter usa o mapa dela');
  enter(campo);
  assert.equal(t.medida.percursos, 1, 'o segundo Enter só anda: não repete a busca');
  assert.equal(t.contador().textContent, '3 de 1539');
});

test('as setas também rodam a busca pendente antes de andar (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  t.botao('Próximo resultado').onclick();
  assert.equal(t.contador().textContent, '2 de 1539', 'a seta buscou na hora e andou um');
  assert.equal(t.pendentes(), 0, 'sem timer sobrando');
  campo.value = 'achada'; campo.oninput();
  t.botao('Resultado anterior').onclick();
  assert.equal(t.contador().textContent, '1539 de 1539', 'buscou de novo (volta ao 1º) e a seta para trás foi ao último');
  assert.equal(t.pendentes(), 0, 'sem timer sobrando');
});

test('fechar a busca cancela a busca pendente e solta o mapa do documento (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  assert.equal(t.pendentes(), 1, 'a busca espera a pausa');
  t.botao('Fechar busca').onclick();
  assert.equal(t.pendentes(), 0, 'closeSearch cancelou o timer');
  t.zerar(); t.rodarTimers();
  assert.equal(t.medida.percursos, 0, 'a busca cancelada não roda depois de fechada');
  assert.equal(t.contador().textContent, '0 resultados');
  // com resultados na tela, fechar solta o mapa guardado: o que ainda andar cai num índice novo (um percurso), não no velho
  t.botao('Buscar').onclick();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  t.zerar();
  t.botao('Fechar busca').onclick();
  enter(campo);
  assert.equal(t.medida.percursos, 1, 'sem mapa guardado, o resultado seguinte lê o documento de novo');
});

test('dispose cancela a busca pendente (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  assert.equal(t.pendentes(), 1, 'a busca espera a pausa');
  t.montado.dispose();
  assert.equal(t.pendentes(), 0, 'dispose cancelou o timer');
  t.zerar(); t.rodarTimers();
  assert.equal(t.medida.percursos, 0, 'nenhuma busca depois que o leitor fecha');
});

test('depois de redesenhar o documento a busca refaz o mapa e as setas andam nos nós novos (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  t.botao('Próximo resultado').onclick();
  const antigo = t.destaqueAtual().no;
  assert.ok(t.nos().includes(antigo), 'antes: o resultado está num nó do desenho atual');
  t.redesenhar();
  t.zerar();
  t.montado.afterRender();
  assert.equal(t.medida.percursos, 1, 'afterRender refez a busca com um percurso do documento novo');
  t.botao('Próximo resultado').onclick();
  assert.equal(t.medida.percursos, 1, 'a seta reaproveita o mapa novo');
  const novo = t.destaqueAtual().no;
  assert.ok(novo !== antigo && t.nos().includes(novo), 'o resultado atual está num nó do desenho novo');
});

test('afterRender solta o mapa, mesmo com a barra escondida sem passar pelo closeSearch (R5-04)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  t.barra().hidden = true;   // à mão: o closeSearch também solta o mapa e esconderia a linha que este teste cobre
  t.redesenhar();
  t.zerar();
  t.montado.afterRender();
  assert.equal(t.medida.percursos, 0, 'barra escondida: o redesenho não busca');
  enter(campo);
  assert.equal(t.medida.percursos, 1, 'sem mapa guardado, o resultado seguinte lê o documento novo');
  assert.ok(t.nos().includes(t.destaqueAtual().no), 'o resultado atual está num nó do desenho novo');
});

/* Auditoria 2 (M-1): o texto muda sem afterRender (o carregarImagensDoMd reescreve o convite e a barra das imagens) e o
   mapa guardado fica com um nó que saiu do documento. O Range nele não tem posição, e o scrollRange subia o corpo. */
test('nó do resultado trocado sem afterRender: o mapa é refeito e o corpo não pula (M-1)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  t.corpo.scrollTop = 5000;
  t.trocarNo(13);   // o nó do 2º resultado
  t.zerar();
  t.botao('Próximo resultado').onclick();
  assert.equal(t.medida.percursos, 1, 'o mapa foi refeito uma vez');
  assert.equal(t.destaqueAtual().no, t.nos()[13], 'o destaque está no nó que está no documento');
  assert.equal(t.contador().textContent, '2 de 1539', 'continua no 2º resultado');
  assert.equal(t.corpo.scrollTop, 5000, 'o corpo não pulou');
  t.botao('Próximo resultado').onclick();
  assert.equal(t.medida.percursos, 1, 'o resultado seguinte já usa o mapa novo');
});

test('corpo fora do documento: a busca não refaz o mapa em laço (M-1)', async () => {
  const t = leitor({ linhas: 26 });
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput();
  t.desligar();   // antes da pausa da busca
  t.zerar();
  t.rodarTimers();
  assert.equal(t.medida.percursos, 1, 'uma busca e nenhum mapa refeito: com o corpo fora, mapa nenhum serve');
  assert.equal(t.contador().textContent, '1 de 2');
});

/* Leva 4, T1 (pendência da leva 3, M-1): o nó do resultado continua no documento, mas mudou de lugar. O Range montado
   com o mapa velho nasce recolhido e o destaque sumia. Medida: mapas refeitos (antes 0; depois 1). */
test('nó do resultado que mudou de lugar: o Range recolhido também refaz o mapa (M-1, leva 4)', async () => {
  const t = leitor();
  await assentar();
  t.botao('Buscar').onclick();
  const campo = t.campo();
  campo.value = 'achada'; campo.oninput(); t.rodarTimers();
  t.deslocarNo(13);   // o nó do 2º resultado
  t.zerar();
  t.botao('Próximo resultado').onclick();
  assert.equal(t.medida.percursos, 1, 'mapas refeitos: ' + t.medida.percursos);
  assert.equal(t.destaqueAtual().no, t.nos()[13], 'o destaque está no nó do lugar novo');
  assert.equal(t.contador().textContent, '2 de 1539');
});
