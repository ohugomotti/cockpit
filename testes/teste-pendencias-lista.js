/* Task 5: listaDePendencias cruza panes+panesFundo com abasLocais, igual a
   pintarTorre ja faz - e' a mesma fonte de dados, entao painel da aba VPS
   entra igual ao local (nao precisa de codigo especial pra remoto). */
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

const ctx = {
  ...globaisFalsos(), console,
  // estadoDoPainel (extraida abaixo) chama duracaoCurta no ramo "busy" (fixture
  // p1); globaisFalsos() nao inclui esse helper - mesmo mock local que
  // teste-torre-entrada.js ja usa pra extrair a mesma funcao.
  duracaoCurta: (ms) => Math.round(ms / 1000) + 's',
  panes: new Map(),
  panesFundo: new Map(),
  abasLocais: () => [
    { id: 'pc', nome: 'PC inteiro', tipo: 'local' },
    { id: 'vps', nome: 'VPS', tipo: 'ssh' },
  ],
};
vm.createContext(ctx);
for (const f of ['function estadoDoPainel(', 'function listaDePendencias(']) {
  vm.runInContext(pegarBloco(app, f, f), ctx);
}

// painel local trabalhando (nao e' pendencia)
ctx.panes.set('p1', { id: 'p1', abaId: 'pc', busy: true, t0: Date.now() });
// painel local com permissao pendente (E' pendencia)
ctx.panes.set('p2', { id: 'p2', abaId: 'pc', pedindoPerm: true, filaPerm: [{ key: 'k1' }] });
// painel da VPS (fundo) com pergunta bloqueante pendente (E' pendencia)
ctx.panesFundo.set('p3', { id: 'p3', abaId: 'vps', perguntaAberta: { id: 'q1', bloqueante: true } });
// painel da VPS com pergunta NAO bloqueante (nao e' pendencia - nao trava o motor)
ctx.panesFundo.set('p4', { id: 'p4', abaId: 'vps', perguntaAberta: { id: 'q2', bloqueante: false } });
// painel vazio (nao e' pendencia)
ctx.panes.set('p5', { id: 'p5', abaId: 'pc' });

const itens = ctx.listaDePendencias();
checa('so entram os 2 paineis em espera (permissao + pergunta bloqueante)', itens.length === 2, JSON.stringify(itens.map((i) => i.P.id)));
checa('painel da VPS entra pela MESMA lista (sem tratamento especial de remoto)', itens.some((i) => i.aba && i.aba.tipo === 'ssh' && i.P.id === 'p3'));
checa('painel local com permissao entra com a aba certa', itens.some((i) => i.P.id === 'p2' && i.aba && i.aba.id === 'pc'));
checa('trabalhando, vazio e pergunta-nao-bloqueante ficam de fora', !itens.some((i) => ['p1', 'p4', 'p5'].includes(i.P.id)));

// --- pecas que mexem em DOM real de verdade: conferidas por padrao no
// fonte (mesmo estilo do resto do repo), nao por execucao - simular o DOM
// completo do card so' pra isso custaria mais do que vale aqui.
checa('montarCorpoDaPendencia usa a versao COM container das duas funcoes (nao a versao antiga sem argumento)', /desenharPermissao\(P, bar\)/.test(app) && /desenharPergunta\(P, cx\)/.test(app));
checa('sincronizarPendencias atualiza o badge do icone e so repinta a lista se a view estiver aberta', /function sincronizarPendencias\(\)/.test(app) && /if \(pendenciasVisivel\(\)\) pintarPendencias\(\);/.test(app));
checa('os 6 pontos de integracao chamam sincronizarPendencias (nao ficou nenhum esquecido)', (app.match(/sincronizarPendencias\(\);/g) || []).length >= 6, 'achei ' + (app.match(/sincronizarPendencias\(\);/g) || []).length);
checa('o botao da activitybar existe e abre pintarPendencias ao clicar', /data-view="pendencias"/.test(lerFonte('renderer', 'index.html')) && /if \(v === 'pendencias'\) pintarPendencias\(\);/.test(app));

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-pendencias-lista: tudo ok');
process.exit(falhas ? 1 : 0);
