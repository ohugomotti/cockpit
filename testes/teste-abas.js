/* Apagar a aba ATIVA gravava os paineis dela por cima da aba vizinha.
   Perda de verdade: a outra aba voltava com os paineis errados. */
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
  const cfg = {
    abaAtiva: 'projetoX',
    abas: [
      { id: 'pc', nome: 'PC inteiro', tipo: 'local', paineis: [{ engine: 'claude', cwd: 'C:/pc', titulo: 'conversa do PC' }] },
      { id: 'projetoX', nome: 'Projeto X', tipo: 'local', paineis: [{ engine: 'codex', cwd: 'C:/x', titulo: 'conversa do X' }] },
    ],
  };
  // um painel aberto, que pertence a aba ativa (Projeto X)
  const painelAberto = {
    id: 'p1', engine: 'codex', cwd: 'C:/x', model: 'gpt', mode: 'bypass', effort: 'medio',
    titulo: 'conversa do X', sessaoId: 'sx', sessaoFile: '', sessaoRemota: false,
    passarContexto: null, el: {},
  };
  const ctx = {
    console, cfg,
    panes: new Map([['p1', painelAberto]]),
    panesFundo: new Map(),          // nenhum painel rodando fora da aba neste caso
    window: { api: { setConfig: () => {} } },
    confirm: () => true,
    pintarAbasLocal() {}, remotoDoPane: () => null,
    $: () => ({ value: '' }),
  };
  vm.createContext(ctx);
  vm.runInContext(`
    function abasLocais(){ return cfg.abas || []; }
    function abaPorId(id){ return abasLocais().find(a => a.id === id); }
    function abaAtual(){ return abaPorId(cfg.abaAtiva) || abasLocais()[0]; }
    // troca de aba de mentira, mas com o savePanes() no comeco, igual a de verdade
    async function trocarAbaLocal(novoId){
      if (novoId === cfg.abaAtiva) return;
      savePanes();
      cfg.abaAtiva = novoId;
      window.api.setConfig(cfg);
    }
  `, ctx);
  // savePanes passou a usar fichaDoPainel; o codigo antigo nao tem essa funcao
  if (appTxt.includes('function fichaDoPainel(')) {
    vm.runInContext(pegar(appTxt, 'function fichaDoPainel(', 'fichaDoPainel'), ctx);
  }
  vm.runInContext(pegar(appTxt, 'function savePanes(', 'savePanes'), ctx);
  vm.runInContext(pegar(appTxt, 'async function apagarAbaLocal(', 'apagarAbaLocal'), ctx);

  await ctx.apagarAbaLocal(abaDe(cfg, 'projetoX'));
  return cfg;
}
function abaDe(cfg, id) { return cfg.abas.find(a => a.id === id); }

(async () => {
  let erro = 0;
  const checa = (nome, cond, det) => {
    if (cond) console.log('  ok   ' + nome);
    else { erro = 1; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
  };


/* A comparacao com a versao ANTIGA prova que o bug existia. Essa copia fica na
   maquina de quem corrigiu, nao no repositorio - entao aqui ela e' opcional: sem
   ela, o teste roda so' a parte que verifica o codigo de hoje. */
  const pastaAntiga = versaoAnterior('src-original');
  const antigo = pastaAntiga ? await rodar('src-original') : null;
  const novo = await rodar('src');
  if (!antigo) console.log('(sem a copia antiga aqui: pulando a comparacao)');

  const tituloDoPC = (cfg) => {
    const pc = cfg.abas.find(a => a.id === 'pc');
    return pc && pc.paineis && pc.paineis[0] ? pc.paineis[0].titulo : '(vazio)';
  };

  console.log('\nApagando a aba ativa "Projeto X", com a aba "PC inteiro" ao lado:');
  if (antigo) console.log('  codigo ANTIGO -> a aba PC ficou com:', JSON.stringify(tituloDoPC(antigo)));
  console.log('  codigo NOVO   -> a aba PC ficou com:', JSON.stringify(tituloDoPC(novo)));

  console.log('');
  if (antigo) checa('o antigo REALMENTE estragava a aba vizinha (prova que o teste vale)',
    tituloDoPC(antigo) !== 'conversa do PC', tituloDoPC(antigo));
  checa('a aba vizinha manteve os paineis dela', tituloDoPC(novo) === 'conversa do PC', tituloDoPC(novo));
  checa('a aba apagada saiu mesmo', !novo.abas.find(a => a.id === 'projetoX'));
  checa('a aba ativa passou a ser a que sobrou', novo.abaAtiva === 'pc', novo.abaAtiva);
  console.log('');
  process.exit(erro);
})().catch((e) => { console.log('ESTOUROU:', e.message); process.exit(1); });
