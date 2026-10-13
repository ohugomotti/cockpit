'use strict';
/* Task 8 da leva 1 (R1-03): clicar duas vezes no microfone (ou apertar
   Ctrl+Shift+Space duas vezes) abria DUAS capturas.

   Por que: o ditado (D) so' ganhava valor depois de dois awaits
   (audioDisponivel e getUserMedia). Um segundo clique no meio passava pelo
   "if (D)" e abria OUTRA captura: a primeira trilha e o primeiro AudioContext
   nunca fechavam (luz do microfone acesa ate fechar o app), o relogio dela
   seguia rodando e o audio dela entrava no mesmo D (em dobro).

   Regra escolhida (a mais simples): enquanto o microfone esta ABRINDO, o clique
   seguinte e' IGNORADO. Nao abre outra captura e nao desliga a que esta abrindo;
   quem queria parar clica de novo quando o botao ja estiver aceso.

   A ligarDitado e' recortada do app.js de verdade e rodada num vm, com um
   "Windows" falso: getUserMedia lento, AudioContext e trilhas que se contam. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const INI = APP.indexOf('const TAXA_DITADO');
const FIM = APP.indexOf('function ligarDitado(');
assert.ok(INI >= 0 && FIM > INI, 'nao achei o bloco do ditado no app.js');
// constantes e ajudantes do ditado + a ligarDitado, na ordem do arquivo
const DITADO = APP.slice(INI, FIM) + pegarBloco(APP, 'function ligarDitado(', 'ligarDitado');

const tick = () => new Promise((r) => setImmediate(r));

/* Segura uma chamada no meio do caminho ate o teste soltar (ou fazer falhar).
   E' assim que o audioDisponivel e o getUserMedia ficam "lentos": o 2o clique
   chega justamente nessa janela. */
function porta() {
  const presos = [];
  return {
    prender: () => new Promise((ok, falha) => presos.push({ ok, falha })),
    async soltar(fabrica) { presos.splice(0).forEach((p) => p.ok(fabrica())); await tick(); },
    async falhar(erro) { presos.splice(0).forEach((p) => p.falha(erro)); await tick(); },
  };
}

/* Um painel com o botao do microfone, o ditado de verdade e um Windows falso
   que conta tudo o que abre e fecha. */
function montar() {
  const h = { pediuDisponivel: 0, pediuMicrofone: 0, trilhas: [], contextos: [], processadores: [], relogios: new Map(), avisos: [] };
  const disp = porta();
  const mic = porta();
  let seqRelogio = 0;

  class AudioContextFalso {
    constructor() { this.sampleRate = 16000; this.destination = {}; this.aberto = true; h.contextos.push(this); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { const p = { onaudioprocess: null, connect() {}, disconnect() {} }; h.processadores.push(p); return p; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    close() { this.aberto = false; }
  }
  const novaStream = () => {
    const trilha = { aberta: true, stop() { this.aberta = false; } };
    h.trilhas.push(trilha);
    return { getTracks: () => [trilha] };
  };

  const campo = { value: '', style: {}, scrollHeight: 20, focus() {} };
  const botao = {
    handlers: {}, title: '',
    addEventListener(tipo, fn) { this.handlers[tipo] = fn; },
    classList: { add() {}, remove() {} },
    style: { setProperty() {}, removeProperty() {} },
  };
  const P = { id: 'p1', morto: false, _ditado: null, rascunho: '' };

  const ctx = vm.createContext({
    window: {
      api: {
        audioDisponivel() { h.pediuDisponivel++; return disp.prender(); },
        audioAquecer() {}, audioDitadoCancelar() {},
        audioDitado: async () => ({}), audioDitadoFinal: async () => ({}),
      },
    },
    navigator: { mediaDevices: { getUserMedia() { h.pediuMicrofone++; return mic.prender(); } } },
    AudioContext: AudioContextFalso,
    $: (sel) => (sel === '.p-input' ? campo : null),
    mostrarAviso: (a) => h.avisos.push(a),
    cfg: { vozManda: false },
    send() {}, irParaPainel() {}, normalizarFala: (t) => String(t || ''),
    setInterval: (fn) => { h.relogios.set(++seqRelogio, fn); return seqRelogio; },
    clearInterval: (id) => { h.relogios.delete(id); },
    setTimeout: (fn) => { fn(); return 0; },
  });
  vm.runInContext(DITADO, ctx);
  ctx.ligarDitado(P, botao, {});

  return Object.assign(h, {
    P,
    // um clique no botao (o Ctrl+Shift+Space tambem cai aqui: faz .click() no botao)
    clicar: () => Promise.resolve(botao.handlers.click({ stopPropagation() {}, shiftKey: false })),
    liberarDisponivel: (resposta = { ok: true }) => disp.soltar(() => resposta),
    quebrarDisponivel: () => disp.falhar(new Error('ipc caiu')),
    liberarMicrofone: () => mic.soltar(novaStream),
    negarMicrofone: () => mic.falhar(Object.assign(new Error('negado'), { name: 'NotAllowedError' })),
    /* o que ficou aceso: criadas = capturas que chegaram a existir; o resto e'
       o que continua aberto. Ditado desligado tem que dar tudo zero. */
    resumo: () => ({
      criadas: h.trilhas.length,
      trilhasAbertas: h.trilhas.filter((t) => t.aberta).length,
      contextosAbertos: h.contextos.filter((c) => c.aberto).length,
      relogiosVivos: h.relogios.size,
    }),
    /* entrega UM bloco de audio a cada captura que ainda escuta e devolve
       quantas amostras entraram no ditado: uma captura so = 4096 */
    soarUmBloco() {
      const bloco = { inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.05) } };
      for (const p of h.processadores) if (p.onaudioprocess) p.onaudioprocess(bloco);
      return P._ditado ? P._ditado.amostrasNaFrase : 0;
    },
  });
}

/* O que tem que valer depois de qualquer duplo clique: UMA captura, o audio
   entra uma vez so, e desligar apaga tudo (era aqui que a luz ficava acesa). */
async function conferirUmaCapturaSo(h) {
  assert.deepEqual(h.resumo(), { criadas: 1, trilhasAbertas: 1, contextosAbertos: 1, relogiosVivos: 1 }, 'ligado: uma captura so');
  assert.equal(h.soarUmBloco(), 4096, 'o audio entra uma vez so, nao em dobro');
  assert.ok(h.P._ditado, 'o ditado segue ligado (o 2o clique nao o desliga)');
  await h.clicar();   // agora esta aceso: clicar desliga
  assert.equal(h.P._ditado, null, 'o clique seguinte desliga');
  assert.deepEqual(h.resumo(), { criadas: 1, trilhasAbertas: 0, contextosAbertos: 0, relogiosVivos: 0 }, 'desligado: nenhuma trilha, contexto ou relogio fica sem fechar');
}

test('R1-03: duplo clique com a checagem da transcricao lenta (1o await) abre UMA captura so', async () => {
  const h = montar();
  const c1 = h.clicar();
  const c2 = h.clicar();   // chega antes de o 1o terminar de abrir o microfone
  await h.liberarDisponivel();
  await h.liberarMicrofone();
  await Promise.all([c1, c2]);
  await conferirUmaCapturaSo(h);
  assert.equal(h.pediuDisponivel, 1, 'o 2o clique foi IGNORADO: nao abriu outra ligacao');
  assert.equal(h.pediuMicrofone, 1, 'o Windows foi chamado uma vez so');
});

test('R1-03: 2o clique com o getUserMedia ainda lento (2o await) tambem abre UMA captura so', async () => {
  const h = montar();
  const c1 = h.clicar();
  await h.liberarDisponivel();   // o 1o passa pela checagem e fica esperando o Windows abrir o microfone
  assert.equal(h.pediuMicrofone, 1);
  const c2 = h.clicar();         // chega no meio da segunda espera
  await h.liberarDisponivel();
  await h.liberarMicrofone();
  await Promise.all([c1, c2]);
  await conferirUmaCapturaSo(h);
  assert.equal(h.pediuMicrofone, 1, 'o 2o clique foi IGNORADO: o Windows foi chamado uma vez so');
});

test('R1-03: a trava solta em toda saida (permissao negada, transcricao ausente, IPC com erro): da pra tentar de novo', async () => {
  const falhas = [
    ['o Windows nega o microfone', async (h) => { await h.liberarDisponivel(); await h.negarMicrofone(); }],
    ['a transcricao nao esta instalada', async (h) => { await h.liberarDisponivel({ ok: false }); }],
    ['o IPC do audioDisponivel quebra', async (h) => { await h.quebrarDisponivel(); }],
  ];
  for (const [nome, falhar] of falhas) {
    const h = montar();
    const c1 = h.clicar();
    const fim1 = c1.catch(() => {});   // a falha do IPC sobe como rejeicao: ja deixo tratada
    await falhar(h);
    await fim1;                        // e a trava tem que ter soltado mesmo assim
    assert.equal(h.P._ditado, null, nome + ': nada ficou ligado');
    const c2 = h.clicar();      // nova tentativa
    await h.liberarDisponivel();
    await h.liberarMicrofone();
    await c2;
    assert.ok(h.P._ditado, nome + ': o clique seguinte liga (a trava nao ficou presa)');
    assert.equal(h.resumo().criadas, 1, nome);
  }
});

test('R1-03: depois de ligar e desligar, clicar de novo liga outra captura normalmente', async () => {
  const h = montar();
  for (let volta = 1; volta <= 2; volta++) {
    const c = h.clicar();
    await h.liberarDisponivel();
    await h.liberarMicrofone();
    await c;
    assert.ok(h.P._ditado, 'volta ' + volta + ': ligou');
    await h.clicar();
    assert.equal(h.P._ditado, null, 'volta ' + volta + ': desligou');
  }
  assert.deepEqual(h.resumo(), { criadas: 2, trilhasAbertas: 0, contextosAbertos: 0, relogiosVivos: 0 });
});

test('R1-03: o atalho Ctrl+Shift+Space cai no mesmo clique do botao (a trava vale pros dois caminhos)', () => {
  assert.match(APP, /'ditar'[^\n]*\.p-mic[^\n]*\.click\(\)/, "o atalho 'ditar' tem que continuar passando pelo click() do botao, onde mora a trava");
});
