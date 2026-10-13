'use strict';
/* Rodada 2 da leva 5i, item 9 (incidente): a janela de teste de uma auditoria abriu as conversas REAIS do Hugo, e ele digitou numa delas achando que
   era o Cockpit dele. O app agora reconhece COCKPIT_JANELA_TESTE=1: poe "TESTE" no titulo da janela, uma faixa vermelha fina no topo e barra o envio de
   mensagens a motores. Sem a variavel, nada muda.

   Tres camadas, testadas aqui:
   1) o main.js DE VERDADE (Electron falso, num processo a parte, com e sem a variavel: testes/carregar-main-janela-teste.cjs): titulo, flag para a tela,
      titulo que a pagina nao troca e os 6 canais que mandam mensagem recusando com o aviso;
   2) o preload (window.api.janelaDeTeste, lido de process.argv);
   3) a tela (app.js): a faixa, o titulo, o aviso no painel e o envio barrado, rodados num DOM de mentira.
   Nenhum objeto falso do Electron entra em assert (regra da maquina): so texto, numero, booleano e dado simples. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const PRELOAD = lerFonte('preload.js');
const APP = lerFonte('renderer', 'app.js');
const copia = (v) => JSON.parse(JSON.stringify(v));
const AVISO_MAIN = 'Janela de teste: o envio de mensagens aos motores está desligado aqui.';

/* ============================ 1) o main.js de verdade ============================ */
function carregarMain(valorDaVariavel) {
  const env = { ...process.env };
  delete env.COCKPIT_JANELA_TESTE;
  if (valorDaVariavel !== undefined) env.COCKPIT_JANELA_TESTE = valorDaVariavel;
  const saida = execFileSync(process.execPath, [path.join(__dirname, '..', 'testes', 'carregar-main-janela-teste.cjs')], { env, encoding: 'utf8', timeout: 60000 });
  const linha = saida.split(/\r?\n/).find((l) => l.startsWith('RESULTADO '));
  assert.ok(linha, 'o carregador nao respondeu: ' + saida.slice(-400));
  return JSON.parse(linha.slice('RESULTADO '.length));
}
const CANAIS = ['pane:send', 'pane:steer', 'pane:compactar', 'debate:start', 'debate:continue', 'detalhe:perguntar'];
const textoDe = (r) => JSON.stringify(r);

test('main com COCKPIT_JANELA_TESTE=1: titulo "TESTE — não use", flag para a tela, titulo que a pagina nao troca, e nenhuma mensagem sai para motor', () => {
  const r = carregarMain('1');
  assert.equal(r.janelasCriadas, 1);
  assert.equal(r.titulo, 'TESTE — não use');
  assert.deepEqual(r.argumentos, ['--cockpit-janela-teste'], 'o preload le esta flag em process.argv');
  assert.equal(r.sandbox, true, 'a janela continua presa (sandbox)');
  assert.deepEqual(r.tituloBarrado, [true], 'o titulo da janela nao e trocado pelo <title> da pagina (page-title-updated barrado)');
  for (const canal of CANAIS) assert.ok(textoDe(r.canais[canal]).includes(AVISO_MAIN), canal + ' deveria recusar com o aviso de janela de teste: ' + textoDe(r.canais[canal]));
  // pane:send e o unico que lanca (devolver false faria a tela "religar e mandar de novo"); os outros devolvem o erro de sempre
  assert.equal(r.canais['pane:send'].lancou, AVISO_MAIN);
  assert.deepEqual(r.canais['pane:steer'].retorno, { error: AVISO_MAIN });
  assert.deepEqual(r.canais['pane:compactar'].retorno, { error: AVISO_MAIN });
  assert.deepEqual(r.canais['debate:start'].retorno, { error: AVISO_MAIN });
  assert.deepEqual(r.canais['debate:continue'].retorno, { error: AVISO_MAIN });
  assert.deepEqual(r.canais['detalhe:perguntar'].retorno, { ok: false, erro: AVISO_MAIN });
  assert.deepEqual(r.spawns, [], 'nenhum processo foi subido');
});

test('main SEM a variavel (e com valor que nao e "1"): nada muda — titulo Cockpit, sem flag, titulo livre e os canais respondem como sempre', () => {
  for (const valor of [undefined, '', '0', 'true', 'sim', ' 1']) {
    const r = carregarMain(valor);
    const rotulo = 'COCKPIT_JANELA_TESTE=' + JSON.stringify(valor);
    assert.equal(r.titulo, 'Cockpit', rotulo);
    assert.equal(r.argumentos, null, rotulo);
    assert.deepEqual(r.tituloBarrado, [], rotulo + ': ninguem barra o titulo');
    for (const canal of CANAIS) assert.equal(textoDe(r.canais[canal]).includes('Janela de teste'), false, rotulo + ' ' + canal + ': ' + textoDe(r.canais[canal]));
    assert.deepEqual(r.spawns, [], rotulo);
  }
});

test('main: a variavel e lida num lugar so (so o valor "1" liga) e a flag da tela tem o mesmo nome no main e no preload', () => {
  assert.match(MAIN, /const JANELA_DE_TESTE = process\.env\.COCKPIT_JANELA_TESTE === '1';/);
  assert.equal((MAIN.match(/process\.env\.COCKPIT_JANELA_TESTE/g) || []).length, 1, 'a variavel nao e lida em outro lugar');
  assert.match(MAIN, /additionalArguments: \['--cockpit-janela-teste'\]/);
  assert.match(PRELOAD, /process\.argv\.includes\('--cockpit-janela-teste'\)/);
  // cada guarda esta' no comeco do canal que ela protege (nada roda antes dela)
  for (const [canal, guarda] of [['pane:send', 'barrarNaJanelaDeTeste();'], ['pane:steer', 'if (JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };'],
    ['pane:compactar', 'if (JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };']]) {
    const i = MAIN.indexOf("ipcMain.handle('" + canal + "'");
    assert.ok(i > 0, canal);
    // o corpo comeca depois do "=> {" (os parametros tem chaves de desestruturacao, entao nao da pra contar a partir da 1a chave)
    const primeira = MAIN.slice(MAIN.indexOf('=> {', i) + 4).split('\n')[1].trim();
    assert.ok(primeira.startsWith(guarda), canal + ': a 1a linha do corpo devia ser a guarda, e e: ' + primeira);
  }
  assert.match(MAIN, /ipcMain\.handle\('debate:start', debateCall\(input => \{ barrarNaJanelaDeTeste\(\); return debates\.start\(input\); \}\)\);/);
  assert.match(MAIN, /ipcMain\.handle\('debate:continue', debateCall\(async input => \{\n  barrarNaJanelaDeTeste\(\);/);
  assert.match(MAIN, /ipcMain\.handle\('detalhe:perguntar', \(_e, o\) => \(JANELA_DE_TESTE \? \{ ok: false, erro: AVISO_JANELA_DE_TESTE \} : maisDetalhes\.perguntar\(o\)\)\);/);
});

/* ============================ 2) o preload ============================ */
function preloadCom(processo) {
  let api;
  vm.runInNewContext(PRELOAD, {
    process: processo,
    require: () => ({ ipcRenderer: { sendSync: () => ({}), invoke: async () => ({}), on() {}, removeListener() {}, send() {} }, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  return api;
}
test('preload: window.api.janelaDeTeste e true so com a flag em process.argv; sem a flag, sem argv ou com argv torto e false (nunca lanca)', () => {
  assert.equal(preloadCom({ platform: 'win32', argv: ['Cockpit.exe', '--cockpit-janela-teste'] }).janelaDeTeste, true);
  assert.equal(preloadCom({ platform: 'win32', argv: ['Cockpit.exe', '--outra-coisa'] }).janelaDeTeste, false);
  assert.equal(preloadCom({ platform: 'win32', argv: ['Cockpit.exe', '--cockpit-janela-teste=1'] }).janelaDeTeste, false, 'so a flag exata');
  assert.equal(preloadCom({ platform: 'win32' }).janelaDeTeste, false, 'sem argv (os outros testes do preload): false');
  assert.equal(preloadCom({ platform: 'win32', argv: null }).janelaDeTeste, false);
  assert.equal(preloadCom({ platform: 'win32', argv: [] }).janelaDeTeste, false);
});

/* ============================ 3) a tela ============================ */
function telaFalsa({ janelaDeTeste, comApi = true } = {}) {
  const filhos = [];
  const notas = [];
  const documento = {
    title: 'Cockpit',
    body: { appendChild: (e) => { filhos.push(e); return e; } },
    getElementById: (id) => filhos.find((f) => f.id === id) || null,
    createElement: (tag) => ({ tag, id: '', textContent: '', style: { cssText: '' }, atributos: {}, setAttribute(k, v) { this.atributos[k] = String(v); } }),
  };
  const ctx = vm.createContext({
    document: documento, note: (P, texto, erro) => notas.push({ P: P.id, texto, erro: !!erro }),
    window: comApi ? { api: janelaDeTeste === undefined ? {} : { janelaDeTeste } } : {},
  });
  vm.runInContext(['const janelaDeTeste = ', 'const TITULO_DA_JANELA_DE_TESTE = ', 'const AVISO_DA_JANELA_DE_TESTE = '].map((ini) => {
    const i = APP.indexOf(ini); assert.ok(i >= 0, ini);
    return 'var ' + APP.slice(i + 6, APP.indexOf('\n', i));
  }).join('\n') + '\n' + ['function marcarJanelaDeTeste(', 'function barrarEnvioDaJanelaDeTeste('].map((n) => pegarBloco(APP, n, n)).join('\n'), ctx);
  return { ctx, documento, filhos, notas };
}

test('tela: sem a flag (o normal) nada acontece — nem titulo, nem faixa, nem envio barrado', () => {
  for (const flag of [undefined, false, 'sim', 1, null]) {
    const t = telaFalsa({ janelaDeTeste: flag });
    assert.equal(t.ctx.marcarJanelaDeTeste(), false, String(flag));
    assert.equal(t.documento.title, 'Cockpit');
    assert.equal(t.filhos.length, 0);
    assert.equal(t.ctx.barrarEnvioDaJanelaDeTeste({ id: 'p1' }), false);
    assert.deepEqual(t.notas, []);
  }
  const semPonte = telaFalsa({ comApi: false });   // a previa (sem window.api) tambem nao quebra
  assert.equal(semPonte.ctx.marcarJanelaDeTeste(), false);
  assert.equal(semPonte.ctx.barrarEnvioDaJanelaDeTeste({ id: 'p1' }), false);
});

test('tela: com a flag, o titulo vira "TESTE — não use" e uma faixa vermelha fina, fixa no topo e sem pegar clique, aparece uma vez so', () => {
  const t = telaFalsa({ janelaDeTeste: true });
  assert.equal(t.ctx.marcarJanelaDeTeste(), true);
  assert.equal(t.documento.title, 'TESTE — não use');
  assert.equal(t.filhos.length, 1);
  const faixa = t.filhos[0];
  assert.equal(faixa.id, 'faixa-janela-teste');
  assert.match(faixa.textContent, /^TESTE — não use/);
  assert.equal(faixa.atributos.role, 'status');
  const css = faixa.style.cssText;
  for (const parte of ['position:fixed', 'top:0', 'left:0', 'right:0', 'pointer-events:none', 'z-index:2147483647']) assert.ok(css.includes(parte), parte + ' em ' + css);
  assert.match(css, /height:(\d+)px/);
  assert.ok(Number(/height:(\d+)px/.exec(css)[1]) <= 20, 'fina (ate 20 px)');
  assert.match(css, /background:#c[0-9a-f]{5}/i, 'vermelha');
  t.ctx.marcarJanelaDeTeste();
  assert.equal(t.filhos.length, 1, 'chamar de novo nao empilha outra faixa');
});

test('tela: com a flag, o envio e barrado com o aviso "Janela de teste" no painel (e o send de verdade chama a guarda antes de qualquer outra coisa)', () => {
  const t = telaFalsa({ janelaDeTeste: true });
  assert.equal(t.ctx.barrarEnvioDaJanelaDeTeste({ id: 'p7' }), true);
  assert.equal(t.notas.length, 1);
  assert.equal(t.notas[0].P, 'p7');
  assert.equal(t.notas[0].erro, true);
  assert.match(t.notas[0].texto, /^Janela de teste: o envio de mensagens aos motores está desligado aqui\./);
  assert.match(t.notas[0].texto, /o texto continua no campo/);
  // no send de verdade: a guarda e a 2a linha do corpo (logo depois de "painel inexistente ou morto"), antes de ler o campo, de limpar ou de mandar
  const corpo = pegarBloco(APP, 'async function send(', 'send');
  const linhas = corpo.split('\n');
  assert.equal(linhas[1].trim(), 'if (!P || P.morto) return;');
  assert.match(linhas[2], /^\s*if \(typeof barrarEnvioDaJanelaDeTeste === 'function' && barrarEnvioDaJanelaDeTeste\(P\)\) return;/);
  assert.ok(corpo.indexOf('barrarEnvioDaJanelaDeTeste(P)') < corpo.indexOf('const inp = $('), 'antes de tocar no campo');
  assert.ok(corpo.indexOf('barrarEnvioDaJanelaDeTeste(P)') < corpo.indexOf('window.api.paneSend('), 'e antes de qualquer envio');
});

test('tela: o boot marca a janela de teste antes de tudo (primeira linha do boot) e o titulo/aviso/faixa moram em textos que as auditorias conferem', () => {
  const boot = APP.slice(APP.indexOf('(async function boot() {'));
  assert.match(boot.split('\n')[1], /^\s*marcarJanelaDeTeste\(\);/, 'a faixa nasce no inicio do boot, antes de ler o config');
  // o main e a tela dizem o mesmo titulo (a sonda da rodada 1 e o abrir-candidato-teste.ps1 procuram por "TESTE")
  assert.ok(MAIN.includes("const TITULO_JANELA_DE_TESTE = 'TESTE — não use';"));
  assert.ok(APP.includes("const TITULO_DA_JANELA_DE_TESTE = 'TESTE — não use';"));
  assert.match(copia(AVISO_MAIN), /^Janela de teste/);
});
