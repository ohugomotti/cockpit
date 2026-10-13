'use strict';
/* Camada de movimento (cockpit-anim.css / .js) — 22/09/2026.

   A camada foi acrescentada pra dar UX ao plano vivo: o segmento em andamento
   respira, o que concluiu da um pop, o contador e o texto do passo avisam que
   mudaram. Ela e um arquivo a parte, carregado no fim do index.html, e some
   inteira se o <link> sair.

   Este arquivo cobra tres contratos. Os dois primeiros sao os mesmos do
   test/animacoes-estado.test.js, porque a regua vale pro app inteiro:

     1) todo quadro anima SO transform e opacity — nada que repinte;
     2) toda animacao infinita tem guarda de prefers-reduced-motion;

   e o terceiro e proprio desta camada, e o motivo dela existir:

     3) em seletor que JA e do app (.ck-plan*, .p-send, .pl-*), a camada so
        pode declarar movimento (animation/transition/transform). Se um dia
        alguem puser cor, tamanho, fonte ou espacamento aqui, o teste quebra —
        porque ai nao e mais "camada de movimento", e redesenho escondido.

   Mais dois contratos de desempenho, no JS:

     4) nada de MutationObserver: o plano e recriado a cada atualizacao, mas
        durante o streaming o DOM muda a cada quadro, e um observer no
        documento cobraria esse preco o turno inteiro. A camada envelopa
        CockpitUI.plan e compara o antes com o depois;
     5) o envelope nunca pode derrubar o render — o que ele faz depois de
        desenhar mora dentro de try/catch.

   E um sexto, do destaque da pasta ativa que viaja entre as abas:

     6) o envelope de trocarAbaLocal chama a original com os mesmos
        argumentos e devolve a MESMA Promise; nada dele derruba a troca; nao
        anima na mesma aba, com troca em andamento, com movimento reduzido nem
        com aba cortada; e no fim nao sobra fantasma nem estilo inline. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const leia = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8').replace(/\r\n/g, '\n');
const cssBruto = leia('cockpit-anim.css');
const js = leia('cockpit-anim.js');
const html = leia('index.html');

/* ---------- o mesmo leitor de CSS dos testes vizinhos ---------- */
const css = cssBruto.replace(/\/\*[\s\S]*?\*\//g, ' ');
const limpo = (s) => s.replace(/\s+/g, ' ').trim();
function separarSeletores(cabeca) {
  const out = [];
  let nivel = 0, atual = '';
  for (const c of cabeca) {
    if (c === '(') nivel++;
    else if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { out.push(atual); atual = ''; continue; }
    atual += c;
  }
  out.push(atual);
  return out.map(limpo).filter(Boolean);
}
function lerCss(fonte) {
  const regras = [], quadros = [];
  (function varrer(texto, dentroDe) {
    let i = 0, inicio = 0, nivel = 0, cabeca = '';
    while (i < texto.length) {
      const c = texto[i];
      if (c === '{') {
        if (nivel === 0) { cabeca = limpo(texto.slice(inicio, i)); inicio = i + 1; }
        nivel++;
      } else if (c === '}') {
        nivel--;
        if (nivel === 0) {
          const corpo = texto.slice(inicio, i);
          if (/^@keyframes/.test(cabeca)) quadros.push({ nome: cabeca.replace(/^@keyframes\s+/, ''), corpo });
          else if (/^@(media|supports|container)/.test(cabeca)) varrer(corpo, dentroDe.concat(cabeca));
          else for (const sel of separarSeletores(cabeca)) regras.push({ sel, corpo, dentroDe });
          inicio = i + 1;
        }
      }
      i++;
    }
  })(fonte, []);
  return { regras, quadros };
}
const { regras, quadros } = lerCss(css);
const animacaoDe = (regra) => {
  const m = regra.corpo.match(/(?:^|[;{\s])animation:\s*([^;]+)/);
  if (!m || /^none\b/.test(limpo(m[1]))) return null;
  return limpo(m[1]);
};
const emMovimentoReduzido = (r) => r.dentroDe.some((a) => /prefers-reduced-motion:\s*reduce/.test(a));
const animadas = regras.filter((r) => animacaoDe(r) && !emMovimentoReduzido(r));

/* ---------- 1) os quadros so mexem no compositor ---------- */

test('camada: todo @keyframes anima apenas transform e opacity', () => {
  assert.ok(quadros.length >= 8, 'a camada deveria ter os quadros do plano vivo');
  for (const k of quadros) {
    const props = [...new Set(Array.from(k.corpo.matchAll(/([a-z-]+)\s*:/g), (m) => m[1]))];
    for (const p of props)
      assert.ok(
        p === 'transform' || p === 'opacity',
        '@keyframes ' + k.nome + ' anima "' + p + '", que repinta; so transform e opacity',
      );
  }
});

/* ---------- 2) todo loop tem freio ---------- */

test('camada: toda animacao infinita aparece na guarda de movimento reduzido', () => {
  const guarda = new Set(
    regras.filter((r) => emMovimentoReduzido(r) && /animation:\s*none/.test(r.corpo)).map((r) => r.sel),
  );
  const infinitas = animadas.filter((r) => /\binfinite\b/.test(animacaoDe(r)));
  assert.ok(infinitas.length > 0, 'a respiracao do passo atual tem que estar aqui');
  for (const r of infinitas)
    assert.ok(guarda.has(r.sel), 'loop sem freio em reduce: ' + r.sel);
});

test('camada: as animacoes de uma vez so tambem param em movimento reduzido', () => {
  const guarda = new Set(
    regras.filter((r) => emMovimentoReduzido(r) && /animation:\s*none/.test(r.corpo)).map((r) => r.sel),
  );
  for (const r of animadas)
    assert.ok(guarda.has(r.sel), 'animacao fora da guarda de reduce: ' + r.sel);
});

/* ---------- 3) movimento sim, redesenho nao ---------- */

test('camada: em seletor do app, so pode declarar movimento', () => {
  /* .mv-* sao classes desta camada, que nao existem no Cockpit: nelas pode
     haver tamanho e cor, porque elas nascem aqui. O que nao pode e mexer na
     aparencia de quem ja estava na tela. */
  const daCamada = (sel) => /(^|[\s>+~])\.mv-[a-z-]+/.test(sel) && !/\.(ck-|pl-|p-send|pp-)/.test(sel);
  const permitidas = new Set(['animation', 'animation-delay', 'transition', 'transform', 'transform-origin']);
  for (const r of regras) {
    if (daCamada(r.sel)) continue;
    const props = [...new Set(Array.from(r.corpo.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g), (m) => m[1]))];
    for (const p of props)
      assert.ok(
        permitidas.has(p),
        'a camada mexeria em "' + p + '" de "' + r.sel + '": isso e redesenho, nao movimento',
      );
  }
});

/* ---------- 4 e 5) o contrato de desempenho do JS ---------- */

test('camada: o JS envelopa CockpitUI.plan e nao observa o documento', () => {
  assert.doesNotMatch(js, /new MutationObserver/, 'observer no documento custa caro durante o streaming');
  assert.doesNotMatch(js, /requestAnimationFrame/, 'nao ha por que entrar no laco de quadro');
  assert.match(js, /CockpitUI\.plan\s*=\s*function/, 'falta o envelope de CockpitUI.plan');
  assert.match(js, /estado\.originais\.plan\.apply/, 'o envelope tem que chamar o render original');
});

test('camada: o que roda depois do render esta protegido por try/catch', () => {
  const envelope = js.slice(js.indexOf('function envelopar()'));
  const corpo = envelope.slice(0, envelope.indexOf('function desligar()'));
  const chamadas = corpo.match(/try\s*\{\s*aplicar(Plano|Legado)/g) || [];
  assert.equal(chamadas.length, 2, 'aplicarPlano e aplicarLegado precisam estar dentro de try');
});

test('camada: so anima o que mudou de estado, nunca a lista inteira', () => {
  /* o mapa de quem ja estava feito e o que separa "concluiu agora" de "ja
     estava concluido" — sem ele a barra piscaria inteira a cada passo */
  assert.match(js, /mapa:\s*l\.map\(eFeito\)/, 'falta o mapa de estado anterior');
  assert.match(js, /if \(depois\.mapa\[i\] && !eraFeito\)/, 'falta a comparacao antes/depois');
});

/* ---------- a ligacao no index.html ---------- */

test('camada: index.html carrega o CSS e carrega o JS depois do cockpit-ui.js', () => {
  assert.match(html, /<link rel="stylesheet" href="cockpit-anim\.css">/);
  const iUi = html.indexOf('<script src="cockpit-ui.js">');
  const iAnim = html.indexOf('<script src="cockpit-anim.js">');
  assert.ok(iUi !== -1 && iAnim !== -1, 'os dois scripts precisam estar no index');
  assert.ok(iAnim > iUi, 'o envelope so existe depois que o CockpitUI foi publicado');
});

/* ---------- 6) o destaque da pasta ativa viaja (envelope de trocarAbaLocal) ---------- */

test('camada: o envelope de trocarAbaLocal segue as regras da camada', () => {
  assert.match(js, /estado\.originais\.trocarAbaLocal\s*=\s*raiz\.trocarAbaLocal/, 'a original tem que ficar guardada');
  assert.match(js, /raiz\.trocarAbaLocal\s*=\s*function/, 'falta o envelope de trocarAbaLocal');
  assert.match(js, /return estado\.originais\.trocarAbaLocal\.apply\(this, arguments\)/, 'o envelope devolve o que a original devolve');
  assert.match(js, /try\s*\{\s*prepararViagem\(novoId\);\s*\}\s*catch/, 'a viagem mora dentro de try: nunca derruba a troca');
  assert.match(js, /raiz\.trocarAbaLocal\s*=\s*estado\.originais\.trocarAbaLocal/, 'desligar() devolve a original');
  assert.doesNotMatch(js, /requestAnimationFrame|new MutationObserver/, 'a viagem nao entra no laco de quadro nem observa o documento');
  const fantasma = regras.find((r) => r.sel === '.mv-aba-fantasma');
  assert.ok(fantasma, 'falta o .mv-aba-fantasma no cockpit-anim.css');
  assert.match(fantasma.corpo, /position:\s*fixed/);
  assert.match(fantasma.corpo, /pointer-events:\s*none/, 'o fantasma nao pode roubar o clique das abas');
  assert.doesNotMatch(fantasma.corpo, /animation|transition/, 'quem anima o fantasma e o JS (Web Animations), fora do alcance do CSS de estado');
});

/* DOM de mentira, so' com o que o envelope le e escreve. A faixa mostra de
   x=224 ate' 224+larguraVisivel; tres abas: a (ativa) em 232, b em 313 e c
   em 444. A original imita a do app: troca cfg.abaAtiva (a repintura, quem
   faz e' o teste, com repintar()). */
function montarFaixa({ reduzir = false, larguraVisivel = 1696, desiste = false, quebrarAnimate = false } = {}) {
  const caixa = (left, width) => ({ left, top: 2, width, height: 28, right: left + width, bottom: 30 });
  const timers = new Map();
  let seq = 0;
  const animacoes = [];
  function elemento(rect) {
    const props = new Map();
    const el = {
      atrib: new Map(), comStyle: false, filhos: [], parentElement: null, isConnected: true, dataset: {},
      getAttribute(n) {
        if (n !== 'style') return el.atrib.has(n) ? el.atrib.get(n) : null;
        return el.comStyle ? [...props].map(([p, [v, pr]]) => p + ': ' + v + (pr ? ' !' + pr : '') + ';').join(' ') : null;
      },
      setAttribute(n, v) { el.atrib.set(n, String(v)); },
      hasAttribute(n) { return n === 'style' ? el.comStyle : el.atrib.has(n); },
      removeAttribute(n) { if (n === 'style') { el.comStyle = false; props.clear(); } else el.atrib.delete(n); },
      getBoundingClientRect: () => ({ ...rect }),
      appendChild(f) { el.filhos.push(f); f.parentElement = el; f.isConnected = true; return f; },
      remove() {
        if (el.parentElement) el.parentElement.filhos.splice(el.parentElement.filhos.indexOf(el), 1);
        el.parentElement = null; el.isConnected = false;
      },
    };
    el.style = {
      getPropertyValue: (p) => (props.get(p) || [''])[0],
      getPropertyPriority: (p) => (props.get(p) || ['', ''])[1],
      setProperty(p, v, pr) { props.set(p, [String(v), pr || '']); el.comStyle = true; },
      removeProperty(p) { props.delete(p); },
    };
    return el;
  }
  const bar = Object.assign(elemento(caixa(224, larguraVisivel)), { clientLeft: 0, clientWidth: larguraVisivel });
  const cab = {};
  for (const [id, left, width] of [['a', 232, 77], ['b', 313, 127], ['c', 444, 128]]) {
    const secao = elemento(caixa(left, width));
    secao.setAttribute('data-current', String(id === 'a'));
    cab[id] = elemento(caixa(left, width));
    cab[id].dataset.placeId = id;
    cab[id].parentElement = secao;
  }
  const documento = {
    querySelector: (sel) => (sel === '.ck-place-bar' ? bar : null),
    createElement() {
      const g = elemento(null);
      g.getBoundingClientRect = () => caixa(parseFloat(g.style.left), parseFloat(g.style.width));
      g.animate = (quadros, opcoes) => {
        if (quebrarAnimate) throw new Error('sem Web Animations');
        const a = { quadros, opcoes, onfinish: null, oncancel: null, cancelada: false, cancel() { a.cancelada = true; } };
        animacoes.push(a);
        return a;
      };
      return g;
    },
  };
  bar.querySelectorAll = (sel) => (sel === '.ck-place-only > .ck-group-head' ? [cab.a, cab.b, cab.c] : []);
  const chamadas = [];
  const resultado = Promise.resolve('trocou');
  const ctx = vm.createContext({
    document: documento,
    matchMedia: (q) => ({ matches: reduzir && /prefers-reduced-motion:\s*reduce/.test(q) }),
    getComputedStyle(el) {
      const ativa = !!el.parentElement && el.parentElement.getAttribute('data-current') === 'true';
      return {
        backgroundColor: el.style.getPropertyValue('background-color') || (ativa ? 'rgb(32, 32, 36)' : 'rgba(0, 0, 0, 0)'),
        boxShadow: el.style.getPropertyValue('box-shadow') || (ativa ? 'rgb(138, 162, 255) 0px -2px 0px 0px inset' : 'none'),
        borderRadius: '4px',
      };
    },
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    __chamadas: chamadas, __resultado: resultado, __desiste: desiste,
  });
  vm.runInContext(`
    let trocandoAba = false;
    let cfg = { abaAtiva: 'a' };
    function trocarAbaLocal(novoId) {
      __chamadas.push({ este: this, args: Array.from(arguments) });
      if (novoId !== cfg.abaAtiva && !__desiste) cfg.abaAtiva = novoId;
      return __resultado;
    }`, ctx);
  const original = ctx.trocarAbaLocal;
  vm.runInContext(js, ctx);
  return {
    ctx, bar, cab, documento, chamadas, resultado, original, animacoes,
    fantasmas: () => bar.filhos.filter((x) => x.className === 'mv-aba-fantasma'),
    estilos: () => [cab.a, cab.b, cab.c, bar].map((x) => x.getAttribute('style')),
    repintar(id) { for (const k of Object.keys(cab)) cab[k].parentElement.setAttribute('data-current', String(k === id)); },
    disparar(ms) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
  };
}
const SEM_ESTILO = [null, null, null, null];

test('camada: trocar de pasta chama a original com os mesmos argumentos e devolve a MESMA Promise', () => {
  const f = montarFaixa();
  assert.equal(f.ctx.CockpitAnim.status().aba, true, 'o envelope tem que se ligar sozinho');
  const r = f.ctx.trocarAbaLocal('b', 'extra');
  assert.equal(f.chamadas.length, 1, 'a original roda uma vez');
  assert.deepEqual([...f.chamadas[0].args], ['b', 'extra']);
  assert.equal(f.chamadas[0].este, f.ctx, 'o this chega intacto');
  assert.equal(r, f.resultado, 'o envelope devolve exatamente o que a original devolveu');
});

test('camada: o fantasma copia o destaque computado, anda so em transform e no fim nao deixa nada', () => {
  const f = montarFaixa();
  f.ctx.trocarAbaLocal('b');
  const [g] = f.fantasmas();
  assert.ok(g, 'o fantasma nasce ANTES da repintura, no clique');
  assert.equal(g.getAttribute('aria-hidden'), 'true');
  assert.equal(g.style.backgroundColor, 'rgb(32, 32, 36)', 'fundo lido do estilo computado da aba ativa');
  assert.equal(g.style.boxShadow, 'rgb(138, 162, 255) 0px -2px 0px 0px inset', 'sublinhado idem');
  assert.equal(g.style.borderRadius, '4px');
  assert.deepEqual([g.style.left, g.style.width], ['232px', '77px'], 'sai do retangulo da aba antiga');
  const [a] = f.animacoes;
  const props = [...new Set(a.quadros.flatMap((q) => Object.keys(q)))];
  assert.deepEqual(props, ['transform'], 'o fantasma so anima transform');
  assert.equal(a.opcoes.duration, 220);
  assert.equal(a.opcoes.easing, 'cubic-bezier(.2,.8,.2,1)');
  assert.match(a.quadros[1].transform, /^translate\(81px, 0px\) scale\(1\.649/, 'chega no retangulo da aba nova');
  // um destaque por vez: o real das duas abas fica apagado durante a viagem
  for (const c of [f.cab.a, f.cab.b]) {
    assert.match(c.getAttribute('style'), /background-color: transparent !important/);
    assert.match(c.getAttribute('style'), /box-shadow: none !important/);
    assert.match(c.getAttribute('style'), /transition: none !important/);
  }
  assert.equal(f.cab.c.getAttribute('style'), null, 'aba que nao participa nao e tocada');
  assert.match(f.bar.getAttribute('style'), /isolation: isolate/, 'a faixa isola so durante a viagem');
  f.repintar('b');
  a.onfinish();
  assert.equal(f.fantasmas().length, 0, 'o fantasma sai no fim');
  assert.equal(a.cancelada, true);
  assert.deepEqual(f.estilos(), SEM_ESTILO, 'nenhum estilo inline sobra, nem o atributo vazio');
});

test('camada: se a viagem acaba antes da repintura o fantasma espera; no teto, some', () => {
  const f = montarFaixa();
  f.ctx.trocarAbaLocal('b');
  f.animacoes[0].onfinish();
  assert.equal(f.fantasmas().length, 1, 'repintura ainda nao chegou: o fantasma estaciona na aba nova');
  f.disparar(40);
  assert.equal(f.fantasmas().length, 1);
  f.repintar('b');
  f.disparar(40);
  assert.equal(f.fantasmas().length, 0);
  assert.deepEqual(f.estilos(), SEM_ESTILO);

  const teto = montarFaixa();
  teto.ctx.trocarAbaLocal('b');
  teto.disparar(2000);
  assert.equal(teto.fantasmas().length, 0, 'o teto de seguranca limpa tudo');
  assert.deepEqual(teto.estilos(), SEM_ESTILO);

  const desistiu = montarFaixa({ desiste: true });
  desistiu.ctx.trocarAbaLocal('b');
  desistiu.animacoes[0].onfinish();
  assert.equal(desistiu.fantasmas().length, 0, 'o app ficou na aba antiga: o fantasma nao fica esperando');
  assert.deepEqual(desistiu.estilos(), SEM_ESTILO);
});

test('camada: nao anima na mesma aba, com troca em andamento, com movimento reduzido nem com aba cortada', () => {
  const casos = {
    'mesma aba': [montarFaixa(), 'a'],
    'troca em andamento': [montarFaixa(), 'b', 'trocandoAba = true'],
    'repintura anterior pendente': [montarFaixa(), 'c', "cfg.abaAtiva = 'b'"],
    'movimento reduzido': [montarFaixa({ reduzir: true }), 'b'],
    'aba cortada pela rolagem': [montarFaixa({ larguraVisivel: 300 }), 'c'],
  };
  for (const [nome, [f, id, antes]] of Object.entries(casos)) {
    if (antes) vm.runInContext(antes, f.ctx);
    const r = f.ctx.trocarAbaLocal(id);
    assert.equal(f.chamadas.length, 1, nome + ': a troca acontece do mesmo jeito');
    assert.equal(r, f.resultado, nome);
    assert.equal(f.animacoes.length, 0, nome + ': nao pode animar');
    assert.equal(f.fantasmas().length, 0, nome);
    assert.deepEqual(f.estilos(), SEM_ESTILO, nome + ': nada de estilo inline');
  }
});

/* Leva 1, final 2: apagarAbaLocal liga apagandoAba (app.js, Task 6b) e o trocarAbaLocal recusa qualquer clique ate' ela
   acabar. O envelope so' olhava trocandoAba: clicar numa aba durante a exclusao fazia o fantasma do destaque viajar para
   uma troca que nunca acontece, e voltar. apagandoAba e' 'let' de topo do app.js: o sandbox base nao a declara (typeof). */
test('camada: com a exclusao de uma aba em curso (apagandoAba) o destaque nao viaja; sem a variavel ou desligada, anima como sempre', () => {
  const sem = montarFaixa();                                          // sandbox sem a variavel
  sem.ctx.trocarAbaLocal('b');
  assert.equal(sem.animacoes.length, 1, 'sem apagandoAba declarada: anima');
  const desligada = montarFaixa();
  vm.runInContext('let apagandoAba = false;', desligada.ctx);
  desligada.ctx.trocarAbaLocal('b');
  assert.equal(desligada.animacoes.length, 1, 'apagandoAba false: anima');
  const ligada = montarFaixa({ desiste: true });                      // o app recusa a troca: cfg.abaAtiva continua em 'a'
  vm.runInContext('let apagandoAba = true;', ligada.ctx);
  const r = ligada.ctx.trocarAbaLocal('b');
  assert.equal(ligada.chamadas.length, 1, 'o envelope chama a original do mesmo jeito (quem recusa a troca e o app)');
  assert.equal(r, ligada.resultado);
  assert.equal(ligada.animacoes.length, 0, 'apagandoAba true: o fantasma nao viaja');
  assert.equal(ligada.fantasmas().length, 0);
  assert.deepEqual(ligada.estilos(), SEM_ESTILO, 'nem estilo inline');
  vm.runInContext('apagandoAba = false;', ligada.ctx);                // a exclusao acabou
  ligada.ctx.trocarAbaLocal('c');
  assert.equal(ligada.animacoes.length, 1, 'terminou a exclusao: o destaque volta a viajar');
});

test('camada: erro na viagem nunca derruba a troca e nao deixa estilo preso', () => {
  const f = montarFaixa();
  f.documento.querySelector = () => { throw new Error('DOM quebrado'); };
  let r;
  assert.doesNotThrow(() => { r = f.ctx.trocarAbaLocal('b'); });
  assert.equal(f.chamadas.length, 1);
  assert.equal(r, f.resultado);

  const meio = montarFaixa({ quebrarAnimate: true });   // quebra DEPOIS de apagar o destaque real
  assert.doesNotThrow(() => { r = meio.ctx.trocarAbaLocal('b'); });
  assert.equal(meio.chamadas.length, 1);
  assert.equal(r, meio.resultado);
  assert.equal(meio.fantasmas().length, 0);
  assert.deepEqual(meio.estilos(), SEM_ESTILO, 'o catch devolve os estilos na hora');
});

test('camada: uma viagem por vez, e desligar() devolve a original', () => {
  const f = montarFaixa();
  f.ctx.trocarAbaLocal('b');
  f.repintar('b');                       // repintura chegou com a 1a viagem ainda no caminho
  f.ctx.trocarAbaLocal('c');             // Ctrl+Tab de novo
  assert.equal(f.fantasmas().length, 1, 'uma viagem por vez');
  assert.equal(f.animacoes[0].cancelada, true, 'a primeira foi encerrada');
  assert.equal(f.cab.a.getAttribute('style'), null, 'e devolveu o estilo da aba que saiu');
  assert.match(f.cab.b.getAttribute('style'), /transparent/, 'b e a antiga da nova viagem');
  assert.match(f.cab.c.getAttribute('style'), /transparent/);
  f.ctx.CockpitAnim.desligar();
  assert.equal(f.ctx.trocarAbaLocal, f.original);
  assert.equal(f.ctx.CockpitAnim.status().aba, false);
  assert.equal(f.fantasmas().length, 0, 'desligar encerra a viagem em curso');
  assert.deepEqual(f.estilos(), SEM_ESTILO);
  f.ctx.CockpitAnim.religar();
  assert.notEqual(f.ctx.trocarAbaLocal, f.original);
  assert.equal(f.ctx.CockpitAnim.status().aba, true);
});

/* ---------- 7) quanto tempo o passo atual ja leva (tempoDoPasso) ---------- */

/* DOM de mentira com o que o envelope do plano le e escreve. A original imita
   o CockpitUI.plan do app: recria a barra inteira (replaceChildren) a cada
   atualizacao. O relogio e a hora sao do teste: passar(ms) anda o tempo e
   dispara cada setInterval uma vez. */
function montarPlano({ comDuracaoCurta = false } = {}) {
  let agora = 1000000, seq = 0;
  const intervalos = new Map();
  const tem = (e, c) => e.className.split(/\s+/).includes(c);
  const descendentes = (e) => e.filhos.flatMap((f) => [f, ...descendentes(f)]);
  function busca(e, sel) {
    let atuais = [e];
    for (const c of sel.trim().split(/\s+/).map((s) => s.replace(/^\./, '')))
      atuais = [...new Set(atuais.flatMap(descendentes))].filter((x) => tem(x, c));
    return atuais;
  }
  function el(classe) {
    const e = {
      className: classe || '', filhos: [], pai: null, atrib: new Map(), textContent: '', offsetWidth: 0,
      classList: { add() {}, remove() {} },
      setAttribute(n, v) { e.atrib.set(n, String(v)); },
      getAttribute(n) { return e.atrib.has(n) ? e.atrib.get(n) : null; },
      append(...fs) { for (const f of fs) { f.pai = e; e.filhos.push(f); } },
      insertBefore(f, ref) { f.pai = e; const i = e.filhos.indexOf(ref); if (i < 0) e.filhos.push(f); else e.filhos.splice(i, 0, f); return f; },
      remove() { if (e.pai) e.pai.filhos.splice(e.pai.filhos.indexOf(e), 1); e.pai = null; },
      replaceChildren() { for (const f of e.filhos) f.pai = null; e.filhos = []; },
      querySelector: (sel) => busca(e, sel)[0] || null,
      querySelectorAll: (sel) => busca(e, sel),
    };
    return e;
  }
  const novoPainel = () => ({ el: el('pane'), busy: true, morto: false, plano: [] });
  const CockpitUI = {
    plan(p, itens) {
      p.plano = Array.isArray(itens) ? itens : [];
      let bar = p.el.querySelector('.ck-plan');
      if (!p.plano.length) { if (bar) bar.remove(); return; }
      if (!bar) { bar = el('ck-plan'); p.el.append(bar); }
      bar.replaceChildren();
      const atual = p.plano.find((x) => x.estado === 'fazendo') || p.plano.find((x) => x.estado !== 'feito');
      const linha = el('ck-plan-line'), cur = el('ck-plan-current'), tot = el('ck-plan-total');
      cur.textContent = atual ? atual.txt : 'Plano concluído';
      tot.textContent = p.plano.filter((x) => x.estado === 'feito').length + '/' + p.plano.length;
      linha.append(cur, tot);
      bar.append(el('ck-plan-segments'), linha);
    },
  };
  const ctx = vm.createContext({
    CockpitUI,
    document: { createElement: () => el('') },
    Date: { now: () => agora },
    setTimeout: () => 0, clearTimeout() {},
    setInterval: (fn, ms) => { intervalos.set(++seq, { fn, ms }); return seq; },
    clearInterval: (id) => { intervalos.delete(id); },
    ...(comDuracaoCurta ? { duracaoCurta: (ms) => 'app:' + ms } : {}),
  });
  vm.runInContext(js, ctx);
  const p = novoPainel();
  return {
    ctx, p, novoPainel,
    plano: (painel, itens) => ctx.CockpitUI.plan(painel, itens),
    passar(ms) { agora += ms; for (const t of [...intervalos.values()]) t.fn(); },
    tempo: (painel = p) => { const c = painel.el.querySelector('.ck-plan-current'); return c && c.title ? c.title.replace(/^Neste passo há /, '') : null; },
    ordem: (painel = p) => painel.el.querySelector('.ck-plan-line').filhos.map((f) => f.className),
    relogios: () => [...intervalos.values()].filter((t) => t.ms === 1000).length,
  };
}
const fazendo = (txt) => ({ txt, estado: 'fazendo' });
const feito = (txt) => ({ txt, estado: 'feito' });

test('passo: o tempo vai no hover do passo; a faixa fica só com o passo e o contador (leva 4, UI 3.4)', () => {
  const f = montarPlano();
  f.plano(f.p, [feito('Ler'), fazendo('Escrever')]);
  assert.deepEqual(f.ordem(), ['ck-plan-current', 'ck-plan-total'], 'nenhum relógio visível na faixa do plano');
  assert.equal(f.tempo(), '0s');
  f.passar(65000);
  assert.equal(f.tempo(), '1m05s');
  assert.match(js, /try\s*\{\s*tempoDoPasso\(p\);\s*\}\s*catch/, 'o relogio mora dentro de try: nunca derruba o plano');
});

test('passo: repintar o MESMO passo continua a conta; passo novo (ou texto novo) zera', () => {
  const f = montarPlano();
  f.plano(f.p, [fazendo('A'), { txt: 'B', estado: 'pendente' }]);
  f.passar(30000);
  f.plano(f.p, [fazendo('A'), { txt: 'B', estado: 'pendente' }]);
  assert.equal(f.tempo(), '30s', 'a barra foi recriada, mas o passo e o mesmo');
  f.plano(f.p, [feito('A'), fazendo('B')]);
  assert.equal(f.tempo(), '0s', 'o passo andou: comeca do zero');
  f.passar(5000);
  f.plano(f.p, [feito('A'), fazendo('B reescrito')]);
  assert.equal(f.tempo(), '0s', 'mesmo lugar, outro texto: e outro passo');
});

test('passo: turno acabou ou painel fechou, o tempo some e o relogio para', () => {
  const f = montarPlano();
  f.plano(f.p, [fazendo('A')]);
  assert.equal(f.relogios(), 1);
  f.p.busy = false;
  f.passar(1000);
  assert.equal(f.tempo(), null, 'fim de turno tira o tempo da linha');
  assert.equal(f.relogios(), 0, 'sem painel ocupado, nenhum relogio fica batendo');
  assert.equal(f.ctx.CockpitAnim.status().passos, 0);
  f.plano(f.p, [fazendo('A')]);
  assert.equal(f.tempo(), null, 'painel parado nao ganha tempo');
  f.p.busy = true;
  f.plano(f.p, [fazendo('A')]);
  assert.equal(f.tempo(), '0s', 'turno novo, conta nova');
  f.p.morto = true;
  f.passar(1000);
  assert.equal(f.relogios(), 0, 'painel fechado sai da conta');
});

test('passo: UM relogio para todos os paineis; plano concluido ou vazio nao conta', () => {
  const f = montarPlano();
  const outro = f.novoPainel();
  f.plano(f.p, [fazendo('A')]);
  f.plano(outro, [fazendo('X')]);
  assert.equal(f.relogios(), 1, 'dois paineis, um relogio');
  f.passar(2000);
  assert.deepEqual([f.tempo(), f.tempo(outro)], ['2s', '2s']);
  f.plano(outro, [feito('X')]);
  assert.equal(f.tempo(outro), null, 'tudo feito: nao ha passo correndo');
  assert.equal(f.ctx.CockpitAnim.status().passos, 1);
  f.plano(f.p, []);
  assert.equal(f.ctx.CockpitAnim.status().passos, 0, 'plano apagado solta o painel');
  assert.equal(f.relogios(), 0);
});

test('passo: desligar() tira o tempo e para o relogio; formato do app quando existe', () => {
  const f = montarPlano();
  f.plano(f.p, [fazendo('A')]);
  f.ctx.CockpitAnim.desligar();
  assert.equal(f.tempo(), null);
  assert.equal(f.relogios(), 0);
  const app = montarPlano({ comDuracaoCurta: true });
  app.plano(app.p, [fazendo('A')]);
  assert.equal(app.tempo(), 'app:0', 'usa o duracaoCurta do app.js: o mesmo formato do "trabalhando…"');
});
