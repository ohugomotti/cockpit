'use strict';
// R1-02 (revisão de front-end de 01/10): apagar uma aba com a troca de aba em curso.
// Durante a troca o cfg.abaAtiva ainda é a aba que sai (ou já é o destino, que acabou de ser
// apagado) e o savePanes() cai em abasLocais()[0]: os painéis da aba apagada eram gravados POR
// CIMA dos painéis salvos da PRIMEIRA aba. Roda as funções reais (trocarAbaLocal, apagarAbaLocal,
// savePanes) num sandbox vm, com a troca presa em portões para a "pasta abrindo devagar".
// Task 6b (corrida inversa): clicar numa aba ENQUANTO ela é apagada. Variante X: apagar a aba ATIVA força a saída para a
// primeira aba, e o clique na própria aba apagada virava abaPendente (o finally a abria justo quando era removida).
// Variante Y: apagar uma aba NÃO ativa que tem painel guardado; durante o paneStop trocandoAba é false e o clique iniciava
// a troca. Nas duas, cfg.abaAtiva terminava numa aba que não existe e o savePanes voltava a gravar na primeira aba.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pegarBloco } = require('../testes/raiz');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const AVISO = 'Espere a pasta terminar de abrir.';
const portao = () => { let abrir; const p = new Promise(r => { abrir = r; }); return { p, abrir }; };
const respiro = () => new Promise(r => setImmediate(r));   // deixa a fila de promessas andar até o fim
const ids = cfg => cfg.abas.map(a => a.id).join();

function montar() {
  const ficha = (paneId, titulo) => ({ paneId, titulo, engine: 'claude' });
  const abas = [   // A só tem fichas salvas (como depois de reabrir o app); C é onde se está
    { id: 'A', nome: 'Primeira', tipo: 'local', paineis: [ficha('a1', 'Conversa A1'), ficha('a2', 'Conversa A2')] },
    { id: 'B', nome: 'Destino', tipo: 'local', paineis: [ficha('b1', 'Conversa B1')] },
    { id: 'C', nome: 'Atual', tipo: 'local', paineis: [] },
  ];
  const h = { guardar: portao(), restaurar: portao(), avisos: [], perguntas: [] };
  let seq = 0;
  const ctx = h.ctx = {
    cfg: { abaAtiva: 'C', abas }, panes: new Map([['c1', { id: 'c1', abaId: 'C', titulo: 'Conversa C1', el: {} }]]),
    panesFundo: new Map(), fichasPendentes: new Map(), trocandoAba: false, abaGen: 0, abaPendente: null, abaIndoPara: null, apagandoAba: false,
    MOTORES: [], histCache: {}, verTodasAsConversas: {}, clearInterval() {}, clearTimeout() {}, pararIrProFim() {},
    window: { api: { setConfig() {}, paneStop: async () => {}, debateStop: async () => {} } },
    confirm: texto => { h.perguntas.push(texto); return true; }, mostrarAviso: a => h.avisos.push(a),
    fecharMenus() {}, porMotor: () => ({}), lugarDaContaAtiva: () => ({ chave: 'pc' }), pintarAbasLocal() {}, sincronizarPendencias() {},
    repintarContaSeMudouDeLugar() {}, $: sel => sel === '#panes' ? { style: {}, scrollTo() {} } : { focus() {} }, $$: () => [], loadHist() {},
    fichaVale: () => true, fichaDoPainel: P => ({ paneId: P.id, titulo: P.titulo }), newPane() {}, reordenarPaineis() {},
    setFocus() {}, devolverOCursor() {}, matarTerminaisDoPainel() {},
    // sair da aba guarda os painéis vivos no fundo; voltar traz os da aba pedida
    guardarPaineisDaAba: async () => { await h.guardar.p; for (const P of ctx.panes.values()) ctx.panesFundo.set(P.id, P); ctx.panes.clear(); },
    trazerPaineisDoFundo: abaId => {
      let n = 0;
      for (const P of [...ctx.panesFundo.values()]) { if (P.abaId !== abaId) continue; ctx.panesFundo.delete(P.id); ctx.panes.set(P.id, P); n++; }
      return n;
    },
    // restaurar é lento (uma leitura de histórico por conversa): cada painel nasce na aba pedida e o savePanes vem no fim
    restaurarPaineis: async (salvos, abaId) => {
      for (const s of salvos) { await h.restaurar.p; const id = 'n' + (++seq); ctx.panes.set(id, { id, abaId, titulo: s.titulo, el: {} }); }
      ctx.savePanes();
    },
  };
  vm.createContext(ctx);
  for (const assinatura of ['function abasLocais(', 'function abaPorId(', 'function abaAtual(', 'function savePanes(',
    'async function trocarAbaLocal(', 'async function apagarAbaLocal(']) vm.runInContext(pegarBloco(app, assinatura), ctx);
  return h;
}

test('apagar o destino enquanto a pasta abre é recusado e a primeira aba fica como estava', async () => {
  const h = montar(), { cfg } = h.ctx, [A, B] = cfg.abas, antes = JSON.stringify(A.paineis);
  const troca = h.ctx.trocarAbaLocal('B');
  h.guardar.abrir(); await respiro();                 // cfg.abaAtiva já é B; a restauração de B está lenta
  assert.equal(h.ctx.trocandoAba, true); assert.equal(cfg.abaAtiva, 'B');
  await h.ctx.apagarAbaLocal(B);                      // o clique em "apagar B" no meio da troca
  h.restaurar.abrir(); await troca; await respiro();  // deixa a troca terminar
  assert.equal(JSON.stringify(A.paineis), antes, 'a primeira aba perdeu os painéis salvos dela');
  assert.equal(ids(cfg), 'A,B,C', 'nada foi apagado'); assert.equal(cfg.abaAtiva, 'B');
  assert.deepEqual(h.avisos.map(a => a.texto), [AVISO]);
  assert.equal(h.perguntas.length, 0, 'recusa antes de perguntar se quer apagar');
  await h.ctx.apagarAbaLocal(cfg.abas[2]);            // pasta aberta: a trava solta (C não é a ativa)
  assert.equal(ids(cfg), 'A,B'); assert.equal(h.avisos.length, 1);
});

test('apagar o destino ainda durante a saída da aba atual não deixa cfg.abaAtiva numa aba que não existe', async () => {
  const h = montar(), { cfg } = h.ctx, B = cfg.abas[1];
  const troca = h.ctx.trocarAbaLocal('B');            // ainda parando os painéis de C: cfg.abaAtiva segue C
  assert.equal(h.ctx.trocandoAba, true); assert.equal(cfg.abaAtiva, 'C');
  await h.ctx.apagarAbaLocal(B);
  h.guardar.abrir(); h.restaurar.abrir(); await troca; await respiro();
  assert.ok(cfg.abas.some(a => a.id === cfg.abaAtiva), 'cfg.abaAtiva = ' + cfg.abaAtiva + ', que não existe mais');
  assert.deepEqual(h.avisos.map(a => a.texto), [AVISO]);
});

test('sem troca em curso, apagar segue como antes: pergunta, apaga e não avisa nada', async () => {
  const outra = montar(), ativa = montar();
  await outra.ctx.apagarAbaLocal(outra.ctx.cfg.abas[1]);   // B, que não é a ativa
  assert.equal(ids(outra.ctx.cfg), 'A,C');
  ativa.guardar.abrir(); ativa.restaurar.abrir();
  await ativa.ctx.apagarAbaLocal(ativa.ctx.cfg.abas[2]);   // C, a ativa: sai para a primeira aba antes de apagar
  assert.equal(ids(ativa.ctx.cfg), 'A,B'); assert.equal(ativa.ctx.cfg.abaAtiva, 'A');
  for (const h of [outra, ativa]) { assert.equal(h.perguntas.length, 1); assert.equal(h.avisos.length, 0); }
});

const guardado = (id, abaId) => ({ id, abaId, titulo: 'Conversa ' + id.toUpperCase(), engine: 'claude', el: {} });   // painel guardado no fundo
const titulos = aba => aba.paineis.map(f => f.titulo).join();   // string: o array nasce no sandbox (outro realm), deepEqual estrito não aceita

test('6b (X): apagar a aba ativa e clicar nela durante a saída forçada não a deixa como aba ativa nem como troca pendente', { timeout: 5000 }, async () => {
  const h = montar(), { cfg } = h.ctx, [A, B, C] = cfg.abas;
  const apagar = h.ctx.apagarAbaLocal(C);              // C é a ativa: sai para a primeira aba (A) antes de apagar
  assert.equal(h.ctx.trocandoAba, true); assert.equal(h.ctx.abaIndoPara, 'A');
  const clique = h.ctx.trocarAbaLocal('C');            // o clique na aba que está indo embora
  const pendente = h.ctx.abaPendente;
  h.guardar.abrir(); h.restaurar.abrir(); await apagar; await clique; await respiro();
  assert.equal(ids(cfg), 'A,B'); assert.equal(cfg.abaAtiva, 'A', 'cfg.abaAtiva = ' + cfg.abaAtiva + ' (devia ser a primeira aba, para onde a exclusão sai)');
  assert.equal(titulos(A), 'Conversa A1,Conversa A2', 'a primeira aba perdeu os painéis salvos dela'); assert.equal(titulos(B), 'Conversa B1');
  assert.equal(pendente, null, 'o clique na aba que estava sendo apagada ficou de pendência'); assert.equal(h.ctx.abaPendente, null);
  assert.equal(h.ctx.trocandoAba, false); assert.equal(h.avisos.length, 0);
});

for (const [quando, apagarAcabaAntes] of [['o apagar acaba antes da troca', true], ['a troca acabaria antes do apagar', false]]) {
  test('6b (Y): apagar uma aba não ativa com painel guardado e clicar nela durante o paneStop não troca para ela (' + quando + ')', { timeout: 5000 }, async () => {
    const h = montar(), { cfg } = h.ctx, [A, B] = cfg.abas, antesA = JSON.stringify(A.paineis);
    h.ctx.panesFundo.set('b9', guardado('b9', 'B'));   // B tem um painel guardado no fundo
    const parada = portao(); h.ctx.window.api.paneStop = () => parada.p;   // parar o motor dele demora
    const apagar = h.ctx.apagarAbaLocal(B);
    assert.equal(h.ctx.trocandoAba, false);            // a guarda da Task 6 não vale aqui: nenhuma troca em curso
    const clique = h.ctx.trocarAbaLocal('B');          // o clique na aba que está sendo apagada
    if (apagarAcabaAntes) { parada.abrir(); await apagar; h.guardar.abrir(); h.restaurar.abrir(); await clique; }
    else { h.guardar.abrir(); h.restaurar.abrir(); await clique; parada.abrir(); await apagar; }
    await respiro(); h.ctx.savePanes();                // e o próximo salvamento automático
    assert.equal(ids(cfg), 'A,C'); assert.equal(cfg.abaAtiva, 'C', 'cfg.abaAtiva = ' + cfg.abaAtiva + ' (o clique trocou de aba)');
    assert.ok(h.ctx.panes.has('c1'), 'o painel da aba C saiu da tela por causa do clique');
    assert.equal(JSON.stringify(A.paineis), antesA, 'a primeira aba perdeu os painéis salvos dela');
    assert.equal(h.ctx.trocandoAba, false); assert.equal(h.ctx.panesFundo.size, 0);
  });
}

test('6b: troca pendente para uma aba que deixou de existir é descartada; para uma que existe, continua valendo', { timeout: 5000 }, async () => {
  const existe = montar(), sumiu = montar();
  for (const h of [existe, sumiu]) {
    h.troca = h.ctx.trocarAbaLocal('B');               // C -> B em curso, presa nos portões
    await h.ctx.trocarAbaLocal('A'); assert.equal(h.ctx.abaPendente, 'A');   // o clique em A fica de pendência
  }
  sumiu.ctx.cfg.abas = sumiu.ctx.cfg.abas.filter(a => a.id !== 'A');         // A some antes de a troca acabar
  for (const h of [existe, sumiu]) { h.guardar.abrir(); h.restaurar.abrir(); await h.troca; await respiro(); }
  assert.equal(existe.ctx.cfg.abaAtiva, 'A', 'a pendente para uma aba que existe tem que acontecer');
  assert.equal(sumiu.ctx.cfg.abaAtiva, 'B', 'cfg.abaAtiva = ' + sumiu.ctx.cfg.abaAtiva); assert.equal(ids(sumiu.ctx.cfg), 'B,C');
  for (const h of [existe, sumiu]) { assert.equal(h.ctx.abaPendente, null); assert.equal(h.ctx.trocandoAba, false); }
});

test('6b: a trava do apagar solta em qualquer saída (cancelou, quebrou no meio, terminou) e a troca de aba volta a funcionar', { timeout: 5000 }, async () => {
  const cancelou = montar(), quebrou = montar(), terminou = montar();
  cancelou.ctx.confirm = () => false;
  quebrou.ctx.panesFundo.set('b9', guardado('b9', 'B'));
  quebrou.ctx.matarTerminaisDoPainel = () => { throw new Error('quebrou no meio'); };
  await cancelou.ctx.apagarAbaLocal(cancelou.ctx.cfg.abas[1]);
  await assert.rejects(quebrou.ctx.apagarAbaLocal(quebrou.ctx.cfg.abas[1]), /quebrou no meio/);
  await terminou.ctx.apagarAbaLocal(terminou.ctx.cfg.abas[1]);
  for (const h of [cancelou, quebrou, terminou]) {
    h.guardar.abrir(); h.restaurar.abrir(); await h.ctx.trocarAbaLocal('A');
    assert.equal(h.ctx.cfg.abaAtiva, 'A', 'depois do apagar a troca de aba ficou travada');
  }
});

test('6b: um segundo apagar enquanto o primeiro corre é ignorado e não solta a trava do primeiro', { timeout: 5000 }, async () => {
  const h = montar(), { cfg } = h.ctx;
  h.ctx.panesFundo.set('b9', guardado('b9', 'B'));
  const parada = portao(); h.ctx.window.api.paneStop = () => parada.p;
  const primeiro = h.ctx.apagarAbaLocal(cfg.abas[1]);  // B, parada em paneStop
  await h.ctx.apagarAbaLocal(cfg.abas[0]);             // o X de outra aba no meio do caminho
  assert.equal(ids(cfg), 'A,B,C', 'o segundo apagou sem esperar o primeiro'); assert.equal(h.perguntas.length, 1);
  const clique = h.ctx.trocarAbaLocal('B');            // a trava do primeiro segue ligada
  assert.equal(h.ctx.trocandoAba, false);
  parada.abrir(); await primeiro; await clique; await respiro();
  assert.equal(ids(cfg), 'A,C'); assert.equal(cfg.abaAtiva, 'C');
});
