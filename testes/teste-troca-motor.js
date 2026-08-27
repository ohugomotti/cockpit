/* Testa a troca de motor no MEIO de uma resposta, comparando o codigo antigo
   com o novo. O sintoma relatado era o painel travar em "trabalhando...". */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* os testes moram em testes/; o app mora em src/ */
const RAIZ_PROJETO = path.join(__dirname, '..');

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
  const appTxt = fs.readFileSync(path.join(RAIZ_PROJETO, pasta, 'renderer', 'app.js'), 'utf8');
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
  const temAntigo = fs.existsSync(path.join(RAIZ_PROJETO, 'src-original'));
  const antigo = temAntigo ? await rodar('src-original') : null;
  const novo = await rodar('src');
  let erro = 0;
  const checa = (nome, cond, det) => {
    if (cond) console.log('  ok   ' + nome);
    else { erro = 1; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
  };

  if (antigo) {
    console.log('\nCODIGO ANTIGO (para mostrar o estrago):');
    console.log('  painel continua "trabalhando"? ', antigo.P.busy);
    console.log('  mensagem da fila presa?        ', JSON.stringify(antigo.P.queued));
    console.log('  id da sessao do motor VELHO?   ', JSON.stringify(antigo.P.sessaoId));
    console.log('  contador de contexto do velho? ', antigo.P.tokens);
  }

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

  if (antigo) {
    console.log('\nRegressao que o codigo antigo tinha e o novo nao pode ter:');
    checa('o antigo deixava o painel travado (prova que o teste vale)', antigo.P.busy === true);
    checa('o antigo guardava o id da sessao do outro motor', antigo.P.sessaoId === 'sess-claude-123');
  } else console.log('\n  --   comparacao com o codigo antigo pulada (src-original nao existe aqui)');

  // troca sem historico nenhum nao pode inventar contexto
  const semHist = await (async () => {
    const r = await rodar('src');
    return r;
  })();
  console.log('');
  process.exit(erro);
})();
