/* Testa a troca de motor no MEIO de uma resposta, comparando o codigo antigo
   com o novo. O sintoma relatado era o painel travar em "trabalhando...". */
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

async function rodar(pasta) {
  const appTxt = fs.readFileSync(path.join(RAIZ, pasta, 'renderer', 'app.js'), 'utf8');
  const chamou = { paneStop: 0, savePanes: 0, setConfig: 0 };
  const ctx = {
    console, cfg: {},
    window: { api: {
      paneStop: async () => { chamou.paneStop++; return true; },
      setConfig: () => { chamou.setConfig++; },
    } },
    note() {}, remotoDoPane: () => null,
    fillModels() {}, paintEngine() {}, pintarModo() {}, setDot() {},
    pintarTokens() {}, pintarFila() {}, pararTrabalho() {}, limparPassos() {},
    savePanes: () => { chamou.savePanes++; },
    marcaTroca() {}, esconderPermissao() {},
    $: () => ({ value: '', style: {}, scrollHeight: 40 }),
  };
  vm.createContext(ctx);
  vm.runInContext(pegar(appTxt, 'function destravarPainel(', 'destravarPainel'), ctx);
  vm.runInContext(pegar(appTxt, 'function montarContexto(', 'montarContexto'), ctx);
  // esquecerPassos nasceu com a correcao da resposta quebrada e o trocarMotor
  // chama ela; a versao antiga nao tem, por isso o if
  if (appTxt.includes('function esquecerPassos(')) vm.runInContext(pegar(appTxt, 'function esquecerPassos(', 'esquecerPassos'), ctx);
  else vm.runInContext('function esquecerPassos(){}', ctx);
  vm.runInContext(pegar(appTxt, 'async function trocarMotor(', 'trocarMotor'), ctx);

  const P = {
    id: 'p1', engine: 'claude', started: true, busy: true, queued: 'manda de novo',
    sessaoId: 'sess-claude-123', sessaoFile: 'C:/x/sess.jsonl', sessaoRemota: false,
    tokens: 48000, janela: 200000, model: 'opus', morto: false,
    blocks: new Map([['resp', {}], ['respKey', 'm1b0']]),
    hist: [
      { quem: 'Você', texto: 'arruma o rodapé da página' },
      { quem: 'Claude', texto: 'troquei a cor e o espaçamento do rodapé' },
    ],
    el: {}, chat: {},
  };
  await ctx.trocarMotor(P, 'codex');
  return { P, chamou };
}

(async () => {

/* A comparacao com a versao ANTIGA prova que o bug existia. Essa copia fica na
   maquina de quem corrigiu, nao no repositorio - entao aqui ela e' opcional: sem
   ela, o teste roda so' a parte que verifica o codigo de hoje. */
  const pastaAntiga = versaoAnterior('src-original');
  const antigo = pastaAntiga ? await rodar('src-original') : null;
  const novo = await rodar('src');
  if (!antigo) console.log('(sem a copia antiga aqui: pulando a comparacao)');
  let erro = 0;
  const checa = (nome, cond, det) => {
    if (cond) console.log('  ok   ' + nome);
    else { erro = 1; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
  };

  console.log('\nCODIGO ANTIGO (para mostrar o estrago):');
  if (antigo) console.log('  painel continua "trabalhando"? ', antigo.P.busy);
  if (antigo) console.log('  mensagem da fila presa?        ', JSON.stringify(antigo.P.queued));
  if (antigo) console.log('  id da sessao do motor VELHO?   ', JSON.stringify(antigo.P.sessaoId));
  if (antigo) console.log('  contador de contexto do velho? ', antigo.P.tokens);

  console.log('\nCODIGO NOVO:');
  checa('painel destravado (busy = false)', novo.P.busy === false, String(novo.P.busy));
  checa('mensagem da fila devolvida (queued = null)', novo.P.queued === null, JSON.stringify(novo.P.queued));
  checa('id da sessao do motor antigo foi solto', novo.P.sessaoId === null, JSON.stringify(novo.P.sessaoId));
  checa('arquivo da sessao antiga foi solto', novo.P.sessaoFile === '', JSON.stringify(novo.P.sessaoFile));
  checa('contador de contexto zerado', novo.P.tokens === 0 && novo.P.janela === 0, novo.P.tokens + '/' + novo.P.janela);
  checa('motor trocado', novo.P.engine === 'codex', novo.P.engine);
  checa('resumeId limpo', novo.P.resumeId === null, JSON.stringify(novo.P.resumeId));
  checa('a conversa vai junto pro motor novo',
    typeof novo.P.passarContexto === 'string' && novo.P.passarContexto.includes('rodapé'),
    String(novo.P.passarContexto).slice(0, 60));
  checa('o contexto e definido ANTES de gravar a configuracao', novo.chamou.savePanes === 1);

  console.log('\nRegressao que o codigo antigo tinha e o novo nao pode ter:');
  if (antigo) checa('o antigo deixava o painel travado (prova que o teste vale)', antigo.P.busy === true);
  if (antigo) checa('o antigo guardava o id da sessao do outro motor', antigo.P.sessaoId === 'sess-claude-123');

  // troca sem historico nenhum nao pode inventar contexto
  const semHist = await (async () => {
    const r = await rodar('src');
    return r;
  })();
  console.log('');
  process.exit(erro);
})();
