/* Prova que o teste vale: roda os MESMOS dois casos contra o codigo ANTIGO
   (src-original) e mostra a resposta aparecendo em dobro. Se este arquivo
   parar de acusar o bug, e' sinal de que o teste virou decoracao. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { RAIZ, versaoAnterior } = require('./raiz');
function pegar(txt, assinatura, nome) {
  const i = txt.indexOf(assinatura);
  if (i < 0) throw new Error('nao achei ' + nome);
  let j = txt.indexOf('{', i), nivel = 0;
  for (let k = j; k < txt.length; k++) {
    if (txt[k] === '{') nivel++;
    else if (txt[k] === '}') { nivel--; if (nivel === 0) return txt.slice(i, k + 1); }
  }
  throw new Error('nao fechei ' + nome);
}

function rendererDe(pasta) {
  const appTxt = fs.readFileSync(path.join(RAIZ, pasta, 'renderer', 'app.js'), 'utf8');
  const bolhas = [];
  const ctx = {
    console, __bolhas: bolhas,
    document: { createElement: () => ({ className: '', innerHTML: '', appendChild() {}, addEventListener() {} }) },
    mdSeguro: (t) => String(t),
    clearEmpty() {}, scroll() {}, linkarArquivos() {}, marcarLinksWeb() {}, botoesDeCodigo() {},
    svgMotor: () => '', $: () => ({ innerHTML: '', addEventListener() {} }),
  };
  vm.createContext(ctx);
  if (appTxt.includes('function mesmaFala(')) vm.runInContext(pegar(appTxt, 'function mesmaFala(', 'mesmaFala'), ctx);
  vm.runInContext(`function botBlock(P, key){ const b={el:{innerHTML:''},raw:''}; __bolhas.push(b); P.blocks.set(key,b); return b; }`, ctx);
  // selarPassos nasceu junto com a correcao da resposta quebrada e o textDelta
  // chama ela. Este teste tambem roda contra a versao ANTIGA, que nao tem a
  // funcao - por isso so extrai se existir, igual ao mesmaFala acima.
  if (appTxt.includes('function selarPassos(')) vm.runInContext(pegar(appTxt, 'function selarPassos(', 'selarPassos'), ctx);
  else vm.runInContext('function selarPassos(){}', ctx);
  vm.runInContext(pegar(appTxt, 'function textDelta(', 'textDelta'), ctx);
  vm.runInContext(pegar(appTxt, 'function textFinal(', 'textFinal'), ctx);
  const P = { engine: 'codex', blocks: new Map(), hist: [], chat: {}, el: {} };
  return { ctx, P, bolhas };
}

/* O que o main ANTIGO emitia quando o app-server nao mandava itemId no delta:
   delta com id 'msg' (o fallback) e final com o id de verdade do item. */
const eventosDoBugAntigo = [
  { kind: 'text-delta', id: 'msg', text: 'Bom dia, vou olhar isso agora' },
  { kind: 'text-final', id: 'item_42', text: 'Bom dia, vou olhar isso agora e te falo.' },
];

function rodar(pasta) {
  const r = rendererDe(pasta);
  for (const ev of eventosDoBugAntigo) {
    if (ev.kind === 'text-delta') r.ctx.textDelta(r.P, ev.id, ev.text);
    else r.ctx.textFinal(r.P, ev.id, ev.text);
  }
  return { bolhas: r.bolhas.length, hist: r.P.hist.length };
}


/* A comparacao com a versao ANTIGA prova que o bug existia. Essa copia fica na
   maquina de quem corrigiu, nao no repositorio - entao aqui ela e' opcional: sem
   ela, o teste roda so' a parte que verifica o codigo de hoje. */
const pastaAntiga = versaoAnterior('src-original');
const antes = pastaAntiga ? rodar('src-original') : null;
const depois = rodar('src');
if (!antes) console.log('(sem a copia antiga aqui: pulando a comparacao)');

if (antes) console.log('codigo ANTIGO  ->', antes.bolhas, 'bolha(s) na tela,', antes.hist, 'fala(s) no historico');
console.log('codigo NOVO    ->', depois.bolhas, 'bolha(s) na tela,', depois.hist, 'fala(s) no historico');

let erro = 0;
if (antes && antes.bolhas !== 2) { console.log('FALHA: o codigo antigo deveria duplicar - o teste nao esta provando nada'); erro = 1; }
else console.log('ok   o codigo antigo REALMENTE duplicava a resposta');
if (depois.bolhas !== 1) { console.log('FALHA: o codigo novo ainda duplica'); erro = 1; }
else console.log('ok   o codigo novo mostra a resposta uma vez so');
process.exit(erro);
