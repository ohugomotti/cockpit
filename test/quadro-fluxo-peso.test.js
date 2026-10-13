'use strict';
/* Leva 3, Tarefa 8 (R5-07): converter desenho grande do Quadro em texto não trava a tela. Medidas:
   - leituras das pontas das setas ao ordenar 300 caixas e 599 setas (antes ~40,9 milhões; depois <= 4 por seta);
   - fluxoEmTexto com 600 caixas em cadeia (antes ~330-430 ms; teto 150 ms);
   - a ordem é a MESMA de antes em 20 mil desenhos aleatórios (ciclos, setas repetidas, setas para a mesma caixa) e no
     grafo de 300 caixas. Rodada final: sorteio mulberry32 (o de antes perdia os bits baixos); com ele o mutante "sem
     comEntrada na saída do ciclo" cai (antes passava). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const { fluxoEmTexto } = require('../src/renderer/quadro-fluxo.js');

const FONTE = lerFonte('renderer', 'quadro-fluxo.js');
// porPosicao + ordenar de verdade numa closure, como no módulo (no vm as globais ficam lentas e distorcem o tempo)
const ordenar = new Function(pegarBloco(FONTE, 'function porPosicao(') + '\n' + pegarBloco(FONTE, 'function ordenar(') + '\nreturn ordenar;')();
const porPosicao = new Function(pegarBloco(FONTE, 'function porPosicao(') + '\nreturn porPosicao;')();

/* a ordenar de ANTES da leva 3, copiada como referência: a nova tem que dar a mesma ordem */
function ordenarReferencia(nos, ligacoes) {
  const ordem = [], posDe = new Map();
  const restantes = new Set(nos);
  const entradasDe = (n) => ligacoes.filter((l) => l.para === n && l.de !== n);
  const nota = (n) => { let m = -1; for (const l of entradasDe(n)) if (posDe.has(l.de)) m = Math.max(m, posDe.get(l.de)); return m; };
  const melhor = (lista) => lista.sort((a, b) => (nota(b) - nota(a)) || porPosicao(a, b))[0];
  while (restantes.size) {
    const vivos = [...restantes];
    let prontos = vivos.filter((n) => entradasDe(n).every((l) => posDe.has(l.de)));
    if (!prontos.length) { const comEntrada = vivos.filter((n) => nota(n) >= 0); prontos = comEntrada.length ? comEntrada : vivos; }
    const n = melhor(prontos);
    posDe.set(n, ordem.length); ordem.push(n); restantes.delete(n);
  }
  return ordem;
}
const caixa = (x, y, h = 60) => ({ x1: x, y1: y, x2: x + 100, y2: y + h, cx: x + 50, cy: y + h / 2, h });
/* Mulberry32, só com inteiros de 32 bits, como o test/linkar-arquivos-linear.test.js. O "semente * 1103515245" de antes
   passava de 2^53 e perdia os bits baixos: o sorteio saía torto e o mutante "sem comEntrada na saída do ciclo" passava.
   Cada teste cria o seu sorteio, com a semente do começo: o resultado não depende da ordem dos testes. */
function gerador(semente) {
  return (n) => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

test('ordenar 300 caixas e 599 setas lê cada seta poucas vezes e dá a ordem de antes (R5-07)', () => {
  const sorteio = gerador(7);
  const nos = Array.from({ length: 300 }, (_, i) => ({ id: 'n' + i, caixa: caixa((i % 7) * 120, Math.floor(i / 7) * 90) }));
  let leituras = 0;
  const seta = (de, para) => ({ get de() { leituras++; return de; }, get para() { leituras++; return para; } });
  const ligacoes = [];
  for (let i = 1; i < 300; i++) ligacoes.push(seta(nos[i - 1], nos[i]));
  for (let i = 0; i < 300; i++) ligacoes.push(seta(nos[sorteio(300)], nos[sorteio(300)]));
  const ordem = ordenar(nos, ligacoes);
  assert.ok(leituras <= 4 * ligacoes.length, 'leituras das pontas: ' + leituras + ' (setas: ' + ligacoes.length + ')');
  // a referência relê as setas milhões de vezes: vai com cópias simples, sem o contador
  const simples = ligacoes.map((l) => ({ de: l.de, para: l.para }));
  assert.equal(ordem.map((n) => n.id).join(','), ordenarReferencia(nos, simples).map((n) => n.id).join(','));
});

test('a ordem é a mesma de antes em 20 mil desenhos aleatórios, com ciclos e caixas em escada (R5-07)', () => {
  const sorteio = gerador(7);
  for (let k = 0; k < 20000; k++) {
    // até 40 caixas, mais desenhos pequenos que grandes (a referência custa N² por seta: 20 mil desenhos em menos de 1 s);
    // setas densas fecham ciclos, e é na saída do ciclo que o comEntrada decide
    const N = 1 + Math.min(sorteio(40), sorteio(40), sorteio(40)), L = sorteio(50);
    const nos = Array.from({ length: N }, (_, i) => ({ id: 'n' + i, caixa: caixa(sorteio(5) * 30, sorteio(8) * 7, 10 + sorteio(30)) }));
    const ligacoes = Array.from({ length: L }, () => ({ de: nos[sorteio(N)], para: nos[sorteio(N)] }));
    const esperado = ordenarReferencia(nos, ligacoes).map((n) => n.id).join(',');
    assert.equal(ordenar(nos, ligacoes).map((n) => n.id).join(','), esperado, 'desenho ' + k);
  }
});

function cena(N) {
  const els = [];
  for (let i = 0; i < N; i++) els.push({ id: 'r' + i, type: 'rectangle', x: (i % 8) * 220, y: Math.floor(i / 8) * 140, width: 180, height: 80 });
  for (let i = 1; i < N; i++) {
    const a = els[i - 1], b = els[i];
    els.push({ id: 'a' + i, type: 'arrow', x: a.x + 90, y: a.y + 80, width: b.x - a.x, height: b.y - a.y - 80,
      points: [[0, 0], [b.x - a.x, b.y - a.y - 80]], startBinding: { elementId: a.id }, endBinding: { elementId: b.id } });
  }
  return { elements: els };
}

test('fluxoEmTexto com 600 caixas em cadeia fica abaixo de 150 ms (R5-07)', () => {
  fluxoEmTexto(cena(20));   // aquece
  const t0 = performance.now();
  const texto = fluxoEmTexto(cena(600));
  const ms = performance.now() - t0;
  assert.match(texto, /^1\. \(caixa sem texto\) → 2\. \(caixa sem texto\)$/m);
  assert.ok(ms < 150, 'fluxoEmTexto de 600 caixas: ' + Math.round(ms) + ' ms');
});
