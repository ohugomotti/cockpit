/* Painel que continua rodando quando você troca de aba.
   O risco desta funcionalidade não é ela não funcionar — é ela ESTRAGAR o que
   está salvo nas outras abas. Estes casos travam exatamente isso. */
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

const appTxt = fs.readFileSync(path.join(RAIZ_PROJETO, 'src', 'renderer', 'app.js'), 'utf8');

function montar() {
  const cfg = {
    abaAtiva: 'pc',
    abas: [
      { id: 'pc', nome: 'PC inteiro', tipo: 'local', paineis: [] },
      { id: 'nex', nome: 'Nexfin', tipo: 'local', paineis: [] },
    ],
  };
  const painel = (id, abaId, titulo, sessaoId) => ({
    id, abaId, titulo, sessaoId, engine: 'claude', cwd: 'C:/x', model: '', mode: 'bypass',
    effort: 'medium', sessaoFile: '', sessaoRemota: false, passarContexto: null, el: {},
  });
  const ctx = {
    console, cfg,
    panes: new Map(), panesFundo: new Map(),
    window: { api: { setConfig: () => {} } },
    pintarAbasLocal() {}, remotoDoPane: () => null,
    $: () => ({ value: '' }),
  };
  vm.createContext(ctx);
  vm.runInContext(`
    function abasLocais(){ return cfg.abas || []; }
    function abaPorId(id){ return abasLocais().find(a => a.id === id); }
    function abaAtual(){ return abaPorId(cfg.abaAtiva) || abasLocais()[0]; }
  `, ctx);
  vm.runInContext(pegar(appTxt, 'function fichaDoPainel(', 'fichaDoPainel'), ctx);
  vm.runInContext(pegar(appTxt, 'function savePanes(', 'savePanes'), ctx);
  return { ctx, cfg, painel };
}

let falhas = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};
const NL = String.fromCharCode(10);

// ---------- 1. o pior caso: painel de fundo apagando os irmãos ----------
console.log(NL + '1) aba PC tinha 3 painéis; 1 ficou rodando, 2 foram desligados');
{
  const { ctx, cfg, painel } = montar();
  // estado de partida: a aba PC com 3 painéis salvos
  ctx.panes.set('p1', painel('p1', 'pc', 'tarefa longa', 's1'));
  ctx.panes.set('p2', painel('p2', 'pc', 'conversa parada A', 's2'));
  ctx.panes.set('p3', painel('p3', 'pc', 'conversa parada B', 's3'));
  ctx.savePanes();
  const salvosAntes = cfg.abas.find(a => a.id === 'pc').paineis.map(p => p.titulo);

  // troca pra aba Nexfin: p1 fica rodando em segundo plano, p2 e p3 saem
  ctx.panesFundo.set('p1', ctx.panes.get('p1'));
  ctx.panes.clear();
  cfg.abaAtiva = 'nex';
  ctx.panes.set('n1', painel('n1', 'nex', 'nexfin', 'sn1'));

  ctx.savePanes();
  ctx.savePanes();   // acontece o tempo todo (nasce sessão, muda rascunho...)

  const salvosDepois = cfg.abas.find(a => a.id === 'pc').paineis.map(p => p.titulo);
  console.log('     antes: ' + JSON.stringify(salvosAntes));
  console.log('     depois: ' + JSON.stringify(salvosDepois));
  checa('os 3 painéis da aba PC continuam salvos', salvosDepois.length === 3, salvosDepois.length + ' de 3');
  checa('as conversas paradas não sumiram',
    salvosDepois.includes('conversa parada A') && salvosDepois.includes('conversa parada B'),
    JSON.stringify(salvosDepois));
  checa('a aba Nexfin ficou só com o que é dela',
    cfg.abas.find(a => a.id === 'nex').paineis.every(p => p.titulo === 'nexfin'),
    JSON.stringify(cfg.abas.find(a => a.id === 'nex').paineis.map(p => p.titulo)));
}

// ---------- 2. o painel de fundo tem que ATUALIZAR a ficha dele, não duplicar ----------
console.log(NL + '2) a sessão do painel de fundo nasce depois: atualiza a ficha dele');
{
  const { ctx, cfg, painel } = montar();
  const p1 = painel('p1', 'pc', 'tarefa longa', null);
  ctx.panes.set('p1', p1);
  ctx.panes.set('p2', painel('p2', 'pc', 'outra', 's2'));
  ctx.savePanes();

  ctx.panesFundo.set('p1', p1);
  ctx.panes.clear();
  cfg.abaAtiva = 'nex';

  p1.sessaoId = 'nasceu-no-fundo';   // o evento 'sessao' chegou fora da tela
  ctx.savePanes();

  const pc = cfg.abas.find(a => a.id === 'pc').paineis;
  checa('continua com 2 painéis (não duplicou)', pc.length === 2, pc.length + ' painéis');
  const ficha = pc.find(p => p.paneId === 'p1');
  checa('a ficha dele recebeu a sessão nova', ficha && ficha.sessaoId === 'nasceu-no-fundo',
    JSON.stringify(ficha));
  checa('a ficha do irmão continua intacta',
    pc.some(p => p.paneId === 'p2' && p.sessaoId === 's2'), JSON.stringify(pc));
}

// ---------- 3. painel de fundo de uma aba não pode aparecer na aba atual ----------
console.log(NL + '3) o que roda em segundo plano não vaza para a aba que está na tela');
{
  const { ctx, cfg, painel } = montar();
  cfg.abaAtiva = 'nex';
  ctx.panes.set('n1', painel('n1', 'nex', 'nexfin', 'sn1'));
  ctx.panesFundo.set('p1', painel('p1', 'pc', 'tarefa longa', 's1'));
  ctx.savePanes();

  const nex = cfg.abas.find(a => a.id === 'nex').paineis.map(p => p.titulo);
  const pc = cfg.abas.find(a => a.id === 'pc').paineis.map(p => p.titulo);
  checa('a aba na tela só tem o painel dela', nex.length === 1 && nex[0] === 'nexfin', JSON.stringify(nex));
  checa('o de segundo plano foi para a aba de origem', pc.length === 1 && pc[0] === 'tarefa longa', JSON.stringify(pc));
}

// ---------- 4. ficha precisa carregar o id do painel ----------
console.log(NL + '4) toda ficha salva leva o id do painel (é o que permite mesclar)');
{
  const { ctx, cfg, painel } = montar();
  ctx.panes.set('p1', painel('p1', 'pc', 'x', 's1'));
  ctx.savePanes();
  const f = cfg.abas.find(a => a.id === 'pc').paineis[0];
  checa('a ficha tem paneId', !!f.paneId, JSON.stringify(f));
}

console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'todos os casos passaram'));
process.exit(falhas ? 1 : 0);
