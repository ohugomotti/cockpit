'use strict';
/* Leva 41 (A3): Ajustes em grupos na barra lateral, engrenagem, foto reduzida,
   pasta padrao validada, Parakeet que nao some, tema sem piscar -- e o Sonnet 5
   como padrao dos paineis novos do Claude (com o seletor nos Ajustes), a
   conversa reaberta no modelo em que estava, o debate nascendo com o padrao e o
   painel novo de aba de servidor nascendo no Claude. Pecas extraidas do fonte
   de verdade (pegarBloco + vm). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const html = lerFonte('renderer', 'index.html');
const css = lerFonte('renderer', 'style.css');
const marca = lerFonte('renderer', 'motti-brand.css');
const app = lerFonte('renderer', 'app.js');
const main = lerFonte('main.js');
const preload = lerFonte('preload.js');
const collab = lerFonte('renderer', 'collaboration.js');

const vistaAjustes = () => {
  const i = html.indexOf('<div class="side-view hidden" data-view="settings">');
  assert.ok(i > 0, 'nao achei a vista de Ajustes');
  return html.slice(i, html.indexOf('</aside>', i));
};

/* MODELOS_CLAUDE de verdade, num contexto proprio */
function catalogoReal(cfg) {
  const ctx = { cfg };
  vm.createContext(ctx);
  const ini = app.indexOf('const MODELOS_CLAUDE = [');
  vm.runInContext(app.slice(ini, app.indexOf('];', ini) + 2).replace('const MODELOS_CLAUDE', 'var MODELOS_CLAUDE'), ctx);
  const cache = app.indexOf('let catClaudeCache');
  assert.ok(cache > 0, 'nao achei o cache do catalogo do Claude');
  vm.runInContext(app.slice(cache, app.indexOf(';', cache) + 1).replace('let ', 'var '), ctx);
  vm.runInContext(pegarBloco(app, 'function catalogoClaude(', 'catalogoClaude'), ctx);
  const idp = app.indexOf('const idModeloPadraoClaude');
  assert.ok(idp > 0, 'nao achei idModeloPadraoClaude');
  vm.runInContext(app.slice(idp, app.indexOf(';\n', idp) + 1).replace('const ', 'var '), ctx);
  return ctx;
}

/* ---------------- (a) contratos ---------------- */
test('todos os ids e contratos dos Ajustes continuam no index.html', () => {
  for (const id of ['fotoPrev', 'btnFoto', 'btnFotoTirar', 'defCwd', 'btnDefCwd', 'chkRobos', 'chkSugestoes',
    'selMotorVoz', 'motorVozInfo', 'chkVozManda', 'chkAtalhosGlobais', 'atalhosAviso', 'inboxPasta',
    'btnInboxAbrir', 'verLine', 'torre', 'btnTorreAtualizar']) {
    assert.ok(html.includes('id="' + id + '"'), 'sumiu o id ' + id);
  }
  for (const t of ['motti', 'escuro', 'claro', 'jornal']) assert.ok(html.includes('class="tema-bt" data-tema="' + t + '"'), 'sumiu o tema ' + t);
  assert.ok(html.includes('class="act" data-view="settings"'));
  assert.ok(html.includes('class="side-view hidden" data-view="settings"'));
  assert.ok((html.match(/<button class="act/g) || []).length >= 9, 'a barra precisa de 9+ botoes .act');
});

/* ---------------- (b) rotulo normal, interruptor alinhado ---------------- */
test('sem a regra generica .settings label; interruptor em grade nome ao lado', () => {
  assert.doesNotMatch(css, /\.settings label\s*[{,]/, 'a regra generica ainda pinta todo label de titulo');
  assert.match(css, /\.settings \.chave\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*30px 1fr/);
  assert.match(css, /\.settings \.chave\s*\{[^}]*align-items:\s*start/);
  // o unico texto em caixa alta da vista e' o titulo de grupo
  assert.match(css, /\.aj-titulo\s*\{[^}]*text-transform:\s*uppercase/);
  for (const cls of ['aj-nome', 'aj-desc', 'aj-info']) {
    const m = css.match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'falta a regra .' + cls);
    assert.doesNotMatch(m[1], /uppercase/, '.' + cls + ' nao pode ser caixa alta');
  }
  // texto de apoio legivel: --fg-fraco dava 3,5-3,7:1 no escuro e no jornal
  assert.match(css, /\.settings\{--aj-sub:color-mix\(in srgb, var\(--fg\) \d+%, var\(--fg-dim\)\)/);
  assert.match(css, /\.aj-desc\{[^}]*color:var\(--aj-sub\)/);
  assert.match(css, /\.aj-info\{[^}]*color:var\(--aj-sub\)/);
  // titulo de grupo tambem na fonte de titulo do tema motti
  assert.match(marca, /:is\([^)]*\.aj-titulo[^)]*\)\s*\{\s*font-family:\s*var\(--motti-display\)/);
});

/* ---------------- (c) engrenagem ---------------- */
test('o botao de Ajustes e uma engrenagem, nao o sol', () => {
  const i = html.indexOf('data-view="settings" title="Ajustes"');
  assert.ok(i > 0);
  const botao = html.slice(i, html.indexOf('</button>', i));
  assert.ok(botao.includes('M9.671 4.136'), 'sem o path da engrenagem');
  assert.ok(!botao.includes('M4.9 4.9'), 'o sol continua la');
});

/* ---------------- (d) grupos ---------------- */
test('Ajustes em 5 grupos com titulo, sem .sep solto e sem label-titulo', () => {
  const v = vistaAjustes();
  assert.ok((v.match(/<section class="aj-grupo"/g) || []).length >= 5, 'menos de 5 grupos');
  const titulos = [...v.matchAll(/<h3 class="aj-titulo">([^<]+)<\/h3>/g)].map((m) => m[1]);
  for (const t of ['Aparência', 'Painéis e conversas', 'Voz e entradas', 'Motores', 'Sobre']) assert.ok(titulos.includes(t), 'falta o grupo ' + t);
  assert.ok(!v.includes('class="sep"'), 'ainda tem .sep solto');
  assert.ok(!/<label>[^<]*<\/label>/.test(v), 'ainda tem <label> sem classe servindo de titulo');
  // cada interruptor tem nome e descricao separados
  for (const id of ['chkRobos', 'chkSugestoes', 'chkVozManda', 'chkAtalhosGlobais']) {
    const m = v.match(new RegExp('<label class="chave"><input type="checkbox" id="' + id + '"><span><span class="aj-nome">[^<]+</span><span class="aj-desc">'));
    assert.ok(m, 'interruptor sem nome/descricao: ' + id);
  }
  // o seletor de modelo dos paineis novos mora em "Paineis e conversas"
  const grupo = v.slice(v.indexOf('Painéis e conversas'), v.indexOf('Voz e entradas'));
  assert.ok(grupo.includes('id="selModeloClaude"'), 'o seletor do modelo padrao nao esta em Paineis e conversas');
  assert.ok(grupo.includes('Modelo dos painéis novos (Claude)'));
});

test('textos dos Ajustes corrigidos (bugs 2, 3, 4, 10, 11, 12)', () => {
  const v = vistaAjustes();
  assert.ok(!v.includes('Acesso total ligado'), 'acesso total ainda escrito como se valesse sempre');
  assert.ok(v.includes('Sem pedir permissão'), 'o texto de acesso nao diz em que modo vale');
  assert.ok(/ACP/.test(v.slice(v.indexOf('Motores'))) && v.includes('servidor'), 'Motores sem ACP ou sem a aba de servidor');
  assert.ok(!v.includes('robô do WhatsApp'), 'o robo agora e o do Telegram');
  // opcoes curtas no seletor do motor de voz
  const sel = v.slice(v.indexOf('id="selMotorVoz"'), v.indexOf('</select>', v.indexOf('id="selMotorVoz"')));
  for (const m of sel.matchAll(/<option[^>]*>([^<]+)<\/option>/g)) assert.ok(m[1].length <= 26, 'opcao comprida demais: ' + m[1]);
  assert.match(v, /id="btnFotoTirar">Remover</);
  assert.ok(!app.includes("'Cockpit 1.0 · até 12 painéis lado a lado'"), 'versao velha na linha do Sobre');
  assert.ok(!app.includes('Aqui vale só pelo menu'), 'o aviso dos atalhos aponta pra um menu que nao tem Ditar nem Recortar');
  // foto: nada de alert() (trava a janela)
  const foto = app.slice(app.indexOf("$('#btnFoto')"), app.indexOf("$('#btnDefCwd')"));
  assert.ok(foto.length > 50 && !foto.includes('alert('), 'a foto ainda usa alert()');
  assert.ok(/confirmarNoApp\(/.test(foto), 'remover a foto nao pede confirmacao pelo modal do app');
});

/* ---------------- (e) pasta padrao validada no main ---------------- */
test('cwdQueExiste: pasta que sumiu vira a pasta pessoal com aviso', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(pegarBloco(main, 'function cwdQueExiste(', 'cwdQueExiste'), ctx);
  const home = 'C:\\Users\\hugo';
  const some = ctx.cwdQueExiste('H:\\Drive\\Cliente', home, () => false);
  assert.equal(some.cwd, home);
  assert.match(some.aviso, /H:\\Drive\\Cliente/);
  assert.match(some.aviso, /não existe mais/);
  const fica = ctx.cwdQueExiste('C:\\proj', home, (p) => p === 'C:\\proj');
  assert.deepEqual({ ...fica }, { cwd: 'C:\\proj', aviso: '' });
  const vazio = ctx.cwdQueExiste('', home, () => false);
  assert.deepEqual({ ...vazio }, { cwd: home, aviso: '' });
});

test('pane:start confere a pasta de TODO motor local antes de subir', () => {
  const h = main.indexOf("ipcMain.handle('pane:start'");
  const corpo = pegarBloco(main.slice(h), '=> {', 'pane:start');
  const conf = corpo.indexOf('cwdQueExiste(');
  assert.ok(conf > 0, 'pane:start nao confere a pasta');
  for (const alvo of ['claudeStart(', 'acp.start(', 'cliStart(', 'codexStart(']) {
    assert.ok(corpo.indexOf(alvo) > conf, alvo + ' sobe antes da conferencia da pasta');
  }
  assert.ok(/if \(!remoto\)/.test(corpo.slice(0, conf + 40)), 'a conferencia nao pode olhar o disco do PC pra painel remoto');
  // o dialogo da pasta padrao nao diz mais "deste painel"
  assert.match(app, /pickFolder\(\{ start: cfg\.defCwd \|\| HOME, titulo: 'Pasta inicial dos painéis novos' \}\)/);
  const dlg = pegarBloco(main.slice(main.indexOf("ipcMain.handle('dialog:pickFolder'")), '=> {', 'pickFolder');
  assert.ok(dlg.includes('titulo'), 'o dialogo de pasta nao aceita titulo');
});

/* ---------------- (f) foto ---------------- */
test('medidaDaFoto mantem a proporcao e o lado maior fica em ate 256', () => {
  const ctx = {}; vm.createContext(ctx);
  const lado = app.indexOf('const FOTO_LADO = 256;');
  assert.ok(lado > 0, 'o lado maximo da foto nao e 256');
  vm.runInContext('var FOTO_LADO = 256;', ctx);
  vm.runInContext(pegarBloco(app, 'function medidaDaFoto(', 'medidaDaFoto'), ctx);
  assert.deepEqual({ ...ctx.medidaDaFoto(4000, 3000) }, { w: 256, h: 192 });
  assert.deepEqual({ ...ctx.medidaDaFoto(1080, 1920) }, { w: 144, h: 256 });
  assert.deepEqual({ ...ctx.medidaDaFoto(200, 120) }, { w: 200, h: 120 });   // pequena: nao aumenta
  assert.deepEqual({ ...ctx.medidaDaFoto(5000, 10, 256) }, { w: 256, h: 1 });   // nunca zero
  assert.deepEqual({ ...ctx.medidaDaFoto(800, 800, 128) }, { w: 128, h: 128 });
});

test('foto escolhida passa pela reducao antes de ir pro config; a antiga encolhe 1x na abertura', () => {
  const usar = pegarBloco(app, 'async function usarFotoEscolhida(', 'usarFotoEscolhida');
  assert.ok(usar.indexOf('reduzirFoto(') > 0 && usar.indexOf('reduzirFoto(') < usar.indexOf('setConfig'), 'grava antes de reduzir');
  const antiga = pegarBloco(app, 'async function encolherFotoAntiga(', 'encolherFotoAntiga');
  assert.ok(antiga.includes('reduzirFoto(') && antiga.includes('setConfig'));
  const boot = app.slice(app.indexOf('(async function boot()'));
  assert.ok(boot.includes('encolherFotoAntiga('), 'o boot nao encolhe a foto antiga');
  // o main aceita a foto grande (quem reduz e' a tela)
  const pick = pegarBloco(main.slice(main.indexOf("ipcMain.handle('user:pickPhoto'")), '=> {', 'pickPhoto');
  assert.ok(!pick.includes('3 * 1024 * 1024'), 'o main ainda recusa foto de 3 MB');
});

test('foto: reduzirFoto desenha no tamanho de medidaDaFoto e escolhe jpeg sem transparencia', async () => {
  const desenhos = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_i, _x, _y, w, h) => desenhos.push([w, h]), getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }),
    toDataURL: (tipo, q) => 'data:' + tipo + ';q=' + q,
  };
  class Img { set src(v) { this._src = v; this.naturalWidth = 4000; this.naturalHeight = 2000; setImmediate(() => this.onload()); } }
  const ctx = { Image: Img, document: { createElement: () => canvas }, setImmediate, Promise };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(app, 'function medidaDaFoto(', 'medidaDaFoto'), ctx);
  const lado = app.indexOf('const FOTO_LADO');
  if (lado > 0) vm.runInContext(app.slice(lado, app.indexOf(';', lado) + 1).replace('const ', 'var '), ctx);
  vm.runInContext(pegarBloco(app, 'function reduzirFoto(', 'reduzirFoto'), ctx);
  const r = await ctx.reduzirFoto('data:image/png;base64,' + 'A'.repeat(1000));
  assert.deepEqual(desenhos, [[256, 128]]);
  assert.equal(canvas.width, 256); assert.equal(canvas.height, 128);
  assert.equal(r, 'data:image/jpeg;q=0.85');
});

/* ---------------- (g) Parakeet nao some ---------------- */
test('boot: checagem do motor de voz que falha NAO grava o config', async () => {
  const gravou = [];
  const info = { textContent: '' };
  const cfg = { motorVoz: 'parakeet' };
  const ctx = {
    cfg, $: () => info,
    window: { api: {
      audioMotor: async () => ({ error: 'Não consegui conferir o modelo do Parakeet (timeout).', motor: 'whisper' }),
      setConfig: async (c) => gravou.push(JSON.stringify(c)),
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(app, 'async function conferirMotorVozNoBoot(', 'conferirMotorVozNoBoot'), ctx);
  const sel = { value: 'parakeet' };
  let pintou = 0;
  const ok = await ctx.conferirMotorVozNoBoot(sel, () => pintou++);
  assert.equal(ok, false);
  assert.equal(sel.value, 'whisper', 'o seletor mostra o que esta valendo');
  assert.deepEqual(gravou, [], 'gravou o config por causa de uma falha passageira');
  assert.equal(cfg.motorVoz, 'parakeet', 'a escolha do Parakeet sumiu');
  assert.match(info.textContent, /timeout/);
  // checagem que passa: so' pinta a nota normal
  ctx.window.api.audioMotor = async () => ({ ok: true, motor: 'parakeet' });
  const sel2 = { value: 'parakeet' };
  assert.equal(await ctx.conferirMotorVozNoBoot(sel2, () => pintou++), true);
  assert.equal(pintou, 1);
  assert.deepEqual(gravou, []);
  // o boot chama esta funcao e nao grava motorVoz por conta propria
  const boot = app.slice(app.indexOf('(async function boot()'));
  assert.ok(boot.includes('conferirMotorVozNoBoot('));
  const caiu = boot.slice(boot.indexOf('onVozMotorCaiu'), boot.indexOf('});', boot.indexOf('onVozMotorCaiu')));
  assert.ok(caiu.length > 20 && !caiu.includes('setConfig'), 'queda do Parakeet ainda apaga a escolha do config');
});

/* ---------------- tema sem piscar ---------------- */
test('tema: janela nasce na cor do tema salvo e a tela aplica antes do resto do boot', () => {
  assert.match(main, /FUNDO_DO_TEMA\s*=\s*\{[^}]*claro:\s*'#ffffff'[^}]*jornal:\s*'#fdf6e3'[^}]*motti:\s*'#07182f'/);
  const cw = pegarBloco(main, 'function createWindow(', 'createWindow');
  assert.ok(/backgroundColor:\s*FUNDO_DO_TEMA\[/.test(cw), 'a janela ainda nasce #1e1e1e fixo');
  assert.ok(/temaInicial/.test(preload), 'o preload nao entrega o tema antes do boot');
  const boot = app.slice(app.indexOf('(async function boot()'));
  const leu = boot.indexOf('cfg = await window.api.getConfig();');
  const aplicou = boot.indexOf('aplicarTema(cfg.tema)');
  assert.ok(leu > 0 && aplicou > leu && aplicou - leu < 200, 'o tema nao e aplicado logo depois de ler o config');
});

/* ---------------- Sonnet 5 padrao + seletor ---------------- */
test('MODELOS_CLAUDE: o padrao e o Sonnet 5, e so ele', () => {
  const ctx = catalogoReal({});
  const padroes = ctx.MODELOS_CLAUDE.filter((m) => m.padrao);
  assert.equal(padroes.length, 1);
  assert.equal(padroes[0].id, 'claude-sonnet-5');
  assert.equal(ctx.idModeloPadraoClaude(), 'claude-sonnet-5');
});

test('cfg.defModelClaude troca o padrao dos paineis novos; vazio ou invalido = Sonnet 5', () => {
  const cfg = { defModelClaude: 'claude-opus-5[1m]' };
  const ctx = catalogoReal(cfg);
  assert.equal(ctx.idModeloPadraoClaude(), 'claude-opus-5[1m]');
  assert.equal(ctx.catalogoClaude().filter((m) => m.padrao).length, 1);
  // o catalogo original nao e' mexido
  assert.equal(ctx.MODELOS_CLAUDE.find((m) => m.padrao).id, 'claude-sonnet-5');
  cfg.defModelClaude = '';
  assert.equal(ctx.idModeloPadraoClaude(), 'claude-sonnet-5');
  cfg.defModelClaude = 'modelo-que-nao-existe';
  assert.equal(ctx.idModeloPadraoClaude(), 'claude-sonnet-5');
  // modelosDe do Claude passa pelo catalogo (e' ele que fillModels/modeloAtual leem)
  assert.match(pegarBloco(app, 'function modelosDe(', 'modelosDe'), /return catalogoClaude\(\)/);
});

test('fillModels real: painel novo pega o padrao; painel com modelo proprio fica com o dele', () => {
  const cfg = { defModelClaude: 'claude-haiku-4-5-20251001' };
  const ctx = catalogoReal(cfg);
  const botao = { innerHTML: '' };
  Object.assign(ctx, { ico: () => '', $: () => botao, EF_DESC_PT: {} });
  for (const n of ['modelosDe', 'modeloAtual', 'esforcosDe', 'fillModels']) vm.runInContext(pegarBloco(app, 'function ' + n + '(', n), ctx);
  const novo = { engine: 'claude', model: '', effort: 'high', el: {} };
  ctx.fillModels(novo);
  assert.equal(novo.model, 'claude-haiku-4-5-20251001');
  const proprio = { engine: 'claude', model: 'claude-opus-5', effort: 'high', el: {} };
  ctx.fillModels(proprio);
  assert.equal(proprio.model, 'claude-opus-5');
  cfg.defModelClaude = '';
  const outro = { engine: 'claude', model: '', effort: 'high', el: {} };
  ctx.fillModels(outro);
  assert.equal(outro.model, 'claude-sonnet-5');
});

test('seletor "Modelo dos paineis novos" grava cfg.defModelClaude (vazio = Sonnet 5)', () => {
  const liga = pegarBloco(app, 'function ligarSeletorModeloClaude(', 'ligarSeletorModeloClaude');
  assert.ok(liga.includes('cfg.defModelClaude') && liga.includes('setConfig'));
  const opcoes = [];
  const sel = { value: '', innerHTML: '', appendChild: (o) => opcoes.push(o), addEventListener: (_t, fn) => { sel._change = fn; } };
  const gravou = [];
  const cfg = {};
  const ctx = catalogoReal(cfg);
  Object.assign(ctx, {
    $: () => sel, document: { createElement: () => ({}) },
    window: { api: { setConfig: async (c) => gravou.push({ ...c }) } },
    // auditoria 2: a troca tambem alcanca painel vazio (sem painel aqui: nada muda)
    panes: new Map(), panesFundo: new Map(), savePanes() {}, fillModels() {},
  });
  vm.runInContext(liga + '\n' + pegarBloco(app, 'function aplicarPadraoNosPaineisVazios(', 'aplicarPadraoNosPaineisVazios'), ctx);
  ctx.ligarSeletorModeloClaude();
  assert.equal(opcoes.length, ctx.MODELOS_CLAUDE.length);
  const padrao = opcoes.find((o) => o.value === '');
  assert.ok(padrao && /Sonnet 5/.test(padrao.textContent) && /padrão/.test(padrao.textContent));
  assert.ok(!opcoes.some((o) => o.value === 'claude-sonnet-5'), 'o Sonnet aparece duas vezes');
  sel.value = 'claude-opus-5';
  return Promise.resolve(sel._change()).then(() => {
    assert.equal(cfg.defModelClaude, 'claude-opus-5');
    assert.equal(gravou.length, 1);
  });
});

/* ---------------- conversa reaberta volta no modelo dela ---------------- */
test('modeloDoHistorico: ultimo modelo que respondeu, mapeado pro catalogo', () => {
  const ctx = catalogoReal({});
  vm.runInContext(pegarBloco(app, 'function modeloDoHistorico(', 'modeloDoHistorico'), ctx);
  const apelidos = app.indexOf('const APELIDO_CLAUDE');
  assert.ok(apelidos > 0, 'falta o mapa de apelidos');
  vm.runInContext(app.slice(apelidos, app.indexOf('};', apelidos) + 2).replace('const ', 'var '), ctx);
  // auditoria 1 (achado 7): Opus 5 do historico volta como Opus 5 (1M)
  const com1m = app.indexOf('const COM_1M');
  assert.ok(com1m > 0, 'falta o mapa do 1M');
  vm.runInContext(app.slice(com1m, app.indexOf('};', com1m) + 2).replace('const ', 'var '), ctx);
  const m = (model, role = 'bot') => ({ role, text: 'x', model });
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5'), m('claude-sonnet-5')]), 'claude-sonnet-5');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5'), { role: 'user', text: 'oi' }]), 'claude-opus-5[1m]');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5'), m('<synthetic>')]), 'claude-opus-5[1m]', '<synthetic> nao e modelo');
  assert.equal(ctx.modeloDoHistorico([m('claude-fable-5-1')]), 'claude-fable-5-1');
  assert.equal(ctx.modeloDoHistorico([m('claude-haiku-4-5-20251001')]), 'claude-haiku-4-5-20251001');
  assert.equal(ctx.modeloDoHistorico([m('sonnet')]), 'claude-sonnet-5');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5[1m]')]), 'claude-opus-5[1m]', 'o Hugo usa o Opus sempre com 1M');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-4-8')]), '', 'modelo fora do catalogo: fica o padrao');
  assert.equal(ctx.modeloDoHistorico([]), '');
  assert.equal(ctx.modeloDoHistorico(null), '');
});

test('o main manda o modelo de cada resposta do historico do Claude', () => {
  const ctx = { LIM_IMG_HIST: 1e9, LIM_IMG_TOTAL: 1e9, ehTecnico: () => false, semContexto: (t) => t, claudeToolArg: () => '' };
  vm.createContext(ctx);
  // corte por marco: o "startsWith('{')" do corpo engana o contador de chaves
  const ini = main.indexOf('function mensagensDoJsonl(');
  vm.runInContext(main.slice(ini, main.indexOf('function codexHistory(', ini)), ctx);
  const linhas = [
    { type: 'user', message: { role: 'user', content: 'oi' } },
    { type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'ola' }] } },
    { type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'de novo' }] } },
  ].map((o) => JSON.stringify(o)).join('\n');
  const msgs = ctx.mensagensDoJsonl(linhas, 60);
  assert.equal(msgs[1].model, 'claude-opus-5');
  assert.equal(msgs[2].model, 'claude-sonnet-5');
  assert.equal(msgs[0].model, undefined);
});

test('openSession: conversa reaberta volta no modelo do historico (antes zerava)', () => {
  const bloco = pegarBloco(app, 'async function openSession(', 'openSession');
  const carregou = bloco.indexOf('for (const m of (msgs || []))');
  const usa = bloco.indexOf('modeloDoHistorico(msgs)');
  assert.ok(usa > carregou && carregou > 0, 'openSession nao usa o modelo do historico depois de carregar');
  assert.ok(/!P\.started/.test(bloco.slice(usa - 200, usa + 200)), 'trocaria o modelo de um painel que ja subiu');
});

/* ---------------- debate nasce com o padrao ---------------- */
/* leva 41 (A5): "defaults" virou "modeloInicial" (a tela do debate passou a
   montar modelo e esforco separados: o esforco nasce em Alto). O contrato e' o
   mesmo: sem modelo proprio do painel, vale o padrao do catalogo do Claude --
   que ja' traz o escolhido nos Ajustes. */
test('debate: o Claude nasce no padrao dos paineis novos, nao num Opus fixo', () => {
  assert.ok(!/'claude-opus-5'/.test(collab), 'collaboration.js ainda tem Opus fixo');
  const ctx = { panes: new Map() };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(collab, 'function modeloInicial(', 'modeloInicial'), ctx);
  const catalogo = [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5', padrao: true }];
  assert.equal(ctx.modeloInicial({ engine: 'codex', engineStates: {} }, 'claude', catalogo), 'claude-sonnet-5');
  assert.equal(ctx.modeloInicial({ engine: 'claude', model: 'claude-opus-5', effort: 'max' }, 'claude', catalogo), 'claude-opus-5');
  assert.match(collab, /claude: \(\) => \(typeof catalogoClaude === 'function' \? catalogoClaude\(\) : MODELOS_CLAUDE\)/);
});

/* ---------------- painel novo em aba de servidor nasce Claude ---------------- */
function motorNovo(cfg) {
  const ctx = { cfg, MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'] };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(app, 'function remotoDoAba(', 'remotoDoAba'), ctx);
  vm.runInContext(pegarBloco(app, 'function motorDoPainelNovo(', 'motorDoPainelNovo'), ctx);
  return ctx;
}
test('motorDoPainelNovo: aba de servidor = Claude; sem ultimo motor = Claude', () => {
  const vps = { id: 'vps', tipo: 'ssh', host: 'h', usuario: 'u' };
  const pc = { id: 'pc', tipo: 'local' };
  let ctx = motorNovo({ lastEngine: 'codex' });
  assert.equal(ctx.motorDoPainelNovo(undefined, vps), 'claude', 'Codex rodaria no PC com a tela dizendo VPS');
  assert.equal(ctx.motorDoPainelNovo('gemini', vps), 'claude');
  assert.equal(ctx.motorDoPainelNovo(undefined, pc), 'codex', 'numa aba local o ultimo motor continua valendo');
  assert.equal(ctx.motorDoPainelNovo('gemini', pc), 'gemini');
  ctx = motorNovo({});
  assert.equal(ctx.motorDoPainelNovo(undefined, pc), 'claude', 'sem ultimo motor o padrao e o Claude');
  ctx = motorNovo({ lastEngine: 'inventado' });
  assert.equal(ctx.motorDoPainelNovo(undefined, pc), 'claude');
});

test('newPane usa motorDoPainelNovo (nada de "|| \'codex\'"); pedido recusado vira nota', () => {
  // corte por marco: o "opts = {}" da assinatura engana o contador de chaves
  const np = app.slice(app.indexOf('function newPane('), app.indexOf('/* ===================== COLUNAS'));
  assert.ok(np.length > 1000, 'nao achei o corpo do newPane');
  assert.ok(!/cfg\.lastEngine \|\| 'codex'/.test(np), 'newPane ainda cai no Codex');
  assert.ok(np.includes('motorDoPainelNovo('));
  assert.ok(/ainda não roda em servidor remoto/.test(np), 'pedido de outro motor numa aba de servidor some calado');
  // mesma frase da guarda do trocarMotor
  assert.ok(pegarBloco(app, 'async function trocarMotor(', 'trocarMotor').includes('ainda não roda em servidor remoto'));
});

test('conversa de outro motor numa aba de servidor: a lista recusa e a restauracao nao traz historico alheio', () => {
  const os = pegarBloco(app, 'async function openSession(', 'openSession');
  const guarda = os.search(/s\.engine !== 'claude' && remotoDoAba\(abaAtual\(\)\)/);
  assert.ok(guarda > 0 && guarda < os.indexOf('newPane('), 'openSession abre Codex numa aba de servidor (e depois troca P.engine pra ele)');
  // corte por marco: o "startsWith('{')" do corpo engana o contador de chaves
  const iniRest = app.indexOf('async function restaurarPaineisMiolo(');
  const rest = app.slice(iniRest, app.indexOf('/* ===================== RAMIFICAR', iniRest));
  assert.ok(iniRest > 0 && rest.length > 500, 'nao achei restaurarPaineisMiolo');
  assert.match(rest, /const mesmoMotor = P\.engine === s\.engine;/);
  assert.match(rest, /P\.forkPendente = mesmoMotor && !!s\.fork;/);
  assert.ok(rest.indexOf('if (!mesmoMotor) msgs = [];') > 0 && rest.indexOf('if (!mesmoMotor) msgs = [];') < rest.indexOf('sessionHistoryRemoto'), 'ficha recusada ainda busca o historico do outro motor');
});

test('novaConversa e a tela de abertura recusam motor que nao roda na aba de servidor', () => {
  const nc = pegarBloco(app, 'async function novaConversa(', 'novaConversa');
  const guarda = nc.indexOf('remotoDoAba(abaAtual())');
  assert.ok(guarda > 0 && guarda < nc.indexOf('newPane('), 'novaConversa abre o painel antes de conferir a aba');
  const boot = app.slice(app.indexOf('(async function boot()'));
  const comecar = boot.slice(boot.indexOf('const comecar = (quais) =>'), boot.indexOf('sairDaAbertura();', boot.indexOf('const comecar = (quais) =>')));
  assert.ok(/remotoDoAba\(abaAtual\(\)\)/.test(comecar), 'a tela de abertura abre Codex numa aba de servidor');
});
