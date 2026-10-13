'use strict';
/* Leva 2, Task 6 -- apresentar_artefato util (UI 7.2-9; ponto de partida: evidencias/teste-artefato.cjs).

   Tres defeitos que o Hugo viu:
   1) o arquivo do Drive (G:\) era recusado quando a conversa estava em C:\Users\hugom: so' a pasta da
      sessao valia. Agora valem tambem o Drive, as Projetos-* da home e as pastas das abas. NUNCA rede.
   2) o agente recebia sempre a mesma frase generica. Agora recebe o MOTIVO exato da recusa.
   3) o cartao nao ficava no historico: sumia ao reabrir a conversa. Agora e' guardado por conversa
      (motor:id, a chave dos favoritos) e desenhado de novo junto com o historico -- e so' no lugar em que nasceu:
      cartao do servidor nao volta num painel local (o "Abrir" leria o caminho dele neste PC).

   Camadas: 1) o broker e o sessionFile (src/cockpit-interactions.js); 2) workRoots e o ponto do main.js
   que decide as pastas; 3) a tela (app.js) com as pecas de verdade num vm, e um fim a fim. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createInteractionBroker, createMcpHostMailbox, callMcpHostTool, dynamicTools, mcpReply } = require('../src/cockpit-interactions');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const REDE = 'Caminho de rede bloqueado por segurança.';
const base = { paneId: 'p1', generation: 'g1', engine: 'codex', threadId: 't1', turnId: 'u1', origin: { kind: 'local' }, cwd: 'C:/QA' };
let seq = 0;
const chamada = (arquivo, callId, extra) => ({ tool: 'apresentar_artefato', arguments: { arquivo, ...(extra || {}) }, callId: callId || 'c' + (++seq) });
const texto = (r) => r.contentItems[0].text;
function pasta(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-artefato-')); t.after(() => fs.rmSync(d, { force: true, recursive: true })); return d; }
function fixture(t, options = {}) {
  const actions = [];
  const broker = createInteractionBroker({ onHostAction: (...a) => { actions.push(a); return { ok: true }; }, ...options });
  t.after(() => broker.dispose());
  return { broker, actions };
}

/* =====================================================================
   1) o broker: raizes de trabalho, motivo exato, rede
   ===================================================================== */
test('arquivo do Drive com a conversa em outra pasta: recusado sem a raiz, aceito quando o main informa a raiz', async t => {
  const sessao = pasta(t), drive = pasta(t);
  fs.mkdirSync(path.join(drive, 'Meu Drive'));
  const arquivo = path.join(drive, 'Meu Drive', 'nota com espaço.md'); fs.writeFileSync(arquivo, '# Nota');
  const sem = fixture(t);
  const recusado = await sem.broker.callTool({ ...base, cwd: sessao }, chamada(arquivo));
  assert.equal(recusado.success, false);
  assert.match(texto(recusado), /fora das pastas permitidas/);
  assert.equal(sem.actions.length, 0);
  const com = fixture(t, { workRoots: () => [drive] });
  const aceito = await com.broker.callTool({ ...base, cwd: sessao }, chamada(arquivo));
  assert.equal(aceito.success, true, texto(aceito));
  assert.equal(com.actions.length, 1);
  assert.equal(com.actions[0][1], 'host-artifact');
  assert.equal(com.actions[0][2].file, fs.realpathSync(arquivo));
  assert.equal(com.actions[0][2].title, 'nota com espaço.md');
});

test('raiz extra só vale para o que está DENTRO dela; lista torta do main não derruba a pasta da sessão', async t => {
  const sessao = pasta(t), drive = pasta(t), outra = pasta(t);
  fs.writeFileSync(path.join(sessao, 'plano.md'), '# Plano'); fs.writeFileSync(path.join(outra, 'x.md'), '# X');
  const { broker, actions } = fixture(t, { workRoots: () => [drive] });
  const scope = { ...base, cwd: sessao };
  const r = await broker.callTool(scope, chamada(path.join(outra, 'x.md')));
  assert.equal(r.success, false); assert.match(texto(r), /fora das pastas permitidas/);
  assert.equal((await broker.callTool(scope, chamada('plano.md'))).success, true, 'a pasta da sessão segue valendo');
  assert.equal(actions.length, 1);
  for (const workRoots of [() => { throw Error('config quebrada'); }, () => 'nao-e-lista', () => [null, 5, {}, 'relativo/pasta']]) {
    const f = fixture(t, { workRoots });
    assert.equal((await f.broker.callTool(scope, chamada('plano.md'))).success, true, 'lista torta é ignorada');
    assert.equal((await f.broker.callTool(scope, chamada(path.join(outra, 'x.md')))).success, false);
  }
});

test('atalho (junction) dentro de uma raiz que sai de todas as raízes continua recusado', async t => {
  const sessao = pasta(t), drive = pasta(t), fora = pasta(t);
  fs.writeFileSync(path.join(fora, 'a.md'), '# Fora');
  try { fs.symlinkSync(fora, path.join(drive, 'atalho'), 'junction'); } catch { t.skip('SO não permite link para fixture'); return; }
  const { broker, actions } = fixture(t, { workRoots: () => [drive] });
  const r = await broker.callTool({ ...base, cwd: sessao }, chamada(path.join(drive, 'atalho', 'a.md')));
  assert.equal(r.success, false); assert.match(texto(r), /fora das pastas permitidas/);
  assert.equal(actions.length, 0);
});

test('o agente recebe o motivo exato de cada recusa', async t => {
  const sessao = pasta(t), fora = pasta(t);
  fs.mkdirSync(path.join(sessao, 'docs')); fs.writeFileSync(path.join(fora, 'x.md'), '# X');
  const { broker, actions } = fixture(t);
  const scope = { ...base, cwd: sessao };
  const casos = [
    ['arquivo que não existe', 'inexistente.md', /não existe/],
    ['pasta, não arquivo', 'docs', /pasta, não um arquivo/],
    ['sobe com ../', '../fora.md', /fora das pastas permitidas/],
    ['absoluto de outra pasta', path.join(fora, 'x.md'), /fora das pastas permitidas/],
    ['endereço file:// local', 'file:///C:/Windows/win.ini', /não um endereço file/],
    ['endereço file://localhost', 'file://localhost/C:/Windows/win.ini', /não um endereço file/],
    ['fluxo alternativo do NTFS', path.join(sessao, 'a.md') + ':stream', /":"/],
    ['caractere de controle', 'a\u0000b.md', /inválido/],
    ['só espaços', '   ', /inválido/],
  ];
  for (const [nome, arquivo, esperado] of casos) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, nome);
    assert.match(texto(r), esperado, nome);
    assert.doesNotMatch(texto(r), /Confira a pasta e o destino/, nome + ': não é mais a frase genérica');
  }
  assert.equal(actions.length, 0);
  // o motivo chega ao agente pelo mesmo formato do MCP do Claude (isError + texto)
  const mcp = mcpReply(await broker.callTool(scope, chamada('inexistente.md')));
  assert.equal(mcp.isError, true); assert.match(mcp.content[0].text, /não existe/);
});

test('caminho de rede é recusado com o motivo e antes de tocar o disco', async t => {
  const sessao = pasta(t), disco = ['realpath', 'stat', 'lstat', 'access', 'readdir'].map(n => t.mock.method(fs.promises, n));
  const sincronos = ['statSync', 'lstatSync', 'existsSync', 'realpathSync', 'readdirSync'].map(n => t.mock.method(fs, n));
  const { broker, actions } = fixture(t, { workRoots: () => ['\\\\srv\\share', '//srv/outro'] });
  const scope = { ...base, cwd: sessao };
  for (const arquivo of ['\\\\srv\\share\\a.md', '//srv/share/a.md', '/\\srv\\share\\a.md', '\\/srv/share/a.md', 'file://srv/share/a.md', '  \\\\srv\\share\\a.md']) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, arquivo); assert.equal(texto(r), REDE, arquivo);
  }
  // a pasta da sessão em rede + nome relativo: o caminho resolvido é de rede
  const emRede = await broker.callTool({ ...base, cwd: '\\\\srv\\share\\projeto' }, chamada('a.md'));
  assert.equal(emRede.success, false); assert.equal(texto(emRede), REDE);
  assert.equal(actions.length, 0);
  assert.deepEqual(disco.map(m => m.mock.callCount()), [0, 0, 0, 0, 0], 'nenhuma chamada ao disco (fs.promises)');
  assert.deepEqual(sincronos.map(m => m.mock.callCount()), [0, 0, 0, 0, 0], 'nenhuma chamada ao disco (fs síncrono)');
});

test('sessão rodando em pasta de rede: nome relativo é de rede; caminho absoluto de uma raiz de trabalho segue valendo, sem tocar a rede', async t => {
  const drive = pasta(t), arquivo = path.join(drive, 'a.md'); fs.writeFileSync(arquivo, '# A');
  const realpath = fs.promises.realpath, tocados = [];
  t.mock.method(fs.promises, 'realpath', async (p, ...resto) => { tocados.push(String(p)); return realpath.call(fs.promises, p, ...resto); });
  const { broker } = fixture(t, { workRoots: () => [drive] });
  const scope = { ...base, cwd: '\\\\srv\\share\\projeto' };
  assert.equal(texto(await broker.callTool(scope, chamada('a.md'))), REDE);
  const absoluto = await broker.callTool(scope, chamada(arquivo));
  assert.equal(absoluto.success, true, texto(absoluto));
  assert.ok(tocados.length > 0 && tocados.every(p => !/^[\\/]{2}/.test(p)), 'nenhum realpath em caminho de rede: ' + tocados.join(' | '));
});

test('o motivo da recusa atravessa a caixa real do MCP do Claude até o agente', async t => {
  const dir = pasta(t), capability = 'a'.repeat(40);
  const { broker } = fixture(t);
  const mailbox = createMcpHostMailbox({ directory: dir, broker, pollMs: 50, resolveScope: q => q.capability === capability ? { ...base, engine: 'claude', cwd: dir } : null });
  t.after(() => mailbox.dispose());
  const aberta = { directory: dir, paneId: 'p1', capability, pollMs: 10, timeoutMs: 3000 };
  const rede = await callMcpHostTool(aberta, 'apresentar_artefato', { arquivo: '\\\\srv\\share\\a.md' });
  assert.equal(rede.isError, true); assert.equal(rede.content[0].text, REDE);
  const falta = await callMcpHostTool(aberta, 'apresentar_artefato', { arquivo: 'nao-existe.md' });
  assert.equal(falta.isError, true); assert.match(falta.content[0].text, /não existe/);
});

test('falha inesperada não vaza detalhe interno; sessão que saiu e destino remoto dizem o motivo', async t => {
  const sessao = pasta(t); fs.writeFileSync(path.join(sessao, 'a.md'), '# A');
  const scope = { ...base, cwd: sessao };
  const quebrada = fixture(t, { onHostAction: () => { throw Error('SEGREDO: C:\\interno\\token.txt'); } });
  const r = await quebrada.broker.callTool(scope, chamada('a.md'));
  assert.equal(r.success, false); assert.doesNotMatch(texto(r), /SEGREDO|token/); assert.match(texto(r), /Não foi possível apresentar/);
  const saiu = fixture(t, { onHostAction: () => ({ ok: false }) });
  const s = await saiu.broker.callTool(scope, chamada('a.md'));
  assert.equal(s.success, false); assert.match(texto(s), /sessão deixou de estar disponível/);
  const remoto = { ...base, cwd: '/srv/projeto', origin: { kind: 'remote', host: 'vps.test', user: 'hugo' } };
  const semPonte = fixture(t);
  assert.match(texto(await semPonte.broker.callTool(remoto, chamada('a.md'))), /não confirma arquivos remotos/);
  const falta = fixture(t, { validateRemoteFile: async () => ({ root: '/srv/projeto', path: '/srv/projeto/a.md', isFile: false }) });
  assert.match(texto(await falta.broker.callTool(remoto, chamada('a.md'))), /não existe no servidor/);
  const fora = fixture(t, { validateRemoteFile: async () => ({ root: '/srv/projeto', path: '/etc/passwd', isFile: true }) });
  assert.match(texto(await fora.broker.callTool(remoto, chamada('a.md'))), /fora da pasta da sessão/);
  assert.equal((await fixture(t).broker.callTool(remoto, chamada('..\\x.md'))).success, false);
});

test('a descrição da ferramenta diz ao agente onde ele pode buscar o arquivo', () => {
  const d = dynamicTools().find(x => x.name === 'cockpit_apresentar_artefato').description;
  assert.match(d, /Drive/); assert.match(d, /Projetos-/); assert.match(d, /abas/);
});

/* =====================================================================
   2) workRoots e o ponto do main.js que decide as pastas
   ===================================================================== */
const dirent = (name, tipo = 'dir') => ({ name, isDirectory: () => tipo === 'dir', isSymbolicLink: () => tipo === 'link', isFile: () => tipo === 'file' });
const workRoots = (...a) => require('../src/cockpit-interactions').workRoots(...a);

test('workRoots: Drive G:\\ só no Windows, Projetos-* da home (pasta ou atalho) e as pastas das abas locais', () => {
  const home = path.resolve('C:/Users/hugom');
  const lista = [dirent('Projetos-claude'), dirent('projetos-Codex'), dirent('Projetos-atalho', 'link'), dirent('Projetos-leia-me.txt', 'file'), dirent('Documentos'), dirent('MeusProjetos-x')];
  const abas = [
    { id: 'pc', tipo: 'local', caminho: null, paineis: [] },
    { id: 'a1', tipo: 'local', caminhos: ['D:\\Clientes\\Pedro', 'C:\\Users\\hugom\\Projetos-claude'] },
    { id: 'a2', tipo: 'local', caminho: 'E:\\Antiga' },
    { id: 'vps', tipo: 'ssh', host: 'h', usuario: 'u', caminhoRemoto: '/srv', caminhos: ['/srv/app'] },
    { id: 'rede', tipo: 'local', caminhos: ['\\\\srv\\share\\x', '//srv/y', 'relativa/pasta', 42] },
  ];
  const win = workRoots({ home, abas, platform: 'win32', readdirSync: () => lista });
  assert.deepEqual(win.map(r => r.toLowerCase()).sort(), [
    'c:\\users\\hugom\\projetos-atalho', 'c:\\users\\hugom\\projetos-claude', 'c:\\users\\hugom\\projetos-codex',
    'd:\\clientes\\pedro', 'e:\\antiga', 'g:\\'].sort());
  const mac = workRoots({ home, abas: [], platform: 'darwin', readdirSync: () => lista });
  assert.ok(!mac.some(r => /^g:/i.test(r)), 'sem G:\\ fora do Windows');
});

test('workRoots: pasta de verdade, sem home, sem abas e leitura da home que falha não quebram', t => {
  const home = pasta(t);
  for (const n of ['Projetos-a', 'projetos-B', 'Outro']) fs.mkdirSync(path.join(home, n));
  fs.writeFileSync(path.join(home, 'Projetos-arquivo.txt'), 'x');
  const r = workRoots({ home, abas: undefined, platform: 'linux' });
  assert.deepEqual(r.map(x => path.basename(x)).sort(), ['Projetos-a', 'projetos-B']);
  assert.deepEqual(workRoots({ platform: 'linux' }), []);
  assert.deepEqual(workRoots({ home: path.join(home, 'nao-existe'), abas: 'torto', platform: 'linux' }), []);
  assert.deepEqual(workRoots({ home, platform: 'linux', readdirSync: () => { throw Error('sem acesso'); } }), []);
});

test('main.js: o broker recebe as pastas de trabalho, lidas do config a cada chamada (aba nova vale na hora)', () => {
  const MAIN = lerFonte('main.js');
  // assert.ok (e não match): o main tem 380 KB e o match imprimiria o arquivo inteiro na falha
  assert.ok(/createInteractionBroker\(\{[\s\S]*?workRoots: pastasDeTrabalho,[\s\S]*?\n\}\);/.test(MAIN), 'o broker recebe workRoots: pastasDeTrabalho');
  const ctx = vm.createContext({ cockpitInteractions: require('../src/cockpit-interactions'), HOME: path.resolve('C:/Users/hugom'), config: { abas: [{ tipo: 'local', caminhos: ['D:\\Clientes\\Pedro'] }] } });
  ctx.loadConfig = () => ctx.config;
  vm.runInContext(MAIN.slice(MAIN.indexOf('const pastasDeTrabalho = '), MAIN.indexOf('\n', MAIN.indexOf('const pastasDeTrabalho = ')) + 1).replace('const pastasDeTrabalho', 'var pastasDeTrabalho'), ctx);
  const antes = ctx.pastasDeTrabalho().map(r => r.toLowerCase());
  assert.ok(antes.includes('d:\\clientes\\pedro'), 'pasta da aba entra');
  ctx.config = { abas: [{ tipo: 'local', caminhos: ['D:\\Clientes\\Pedro', 'F:\\AbaNova'] }] };
  assert.ok(ctx.pastasDeTrabalho().map(r => r.toLowerCase()).includes('f:\\abanova'), 'aba nova vale sem reiniciar');
});

/* =====================================================================
   3) a tela (app.js): o cartao fica guardado e volta ao reabrir a conversa
   ===================================================================== */
const APP = lerFonte('renderer', 'app.js');
class El {
  constructor(tag) { this.tagName = String(tag || 'div').toUpperCase(); this.children = []; this.pai = null; this.className = ''; this._texto = ''; this.dataset = {}; }
  get textContent() { return this._texto + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._texto = String(v); }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.pai) c.pai.children = c.pai.children.filter(x => x !== c); c.pai = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  remove() { if (this.pai) this.pai.children = this.pai.children.filter(x => x !== this); this.pai = null; }
}
function trecho(assinatura) {
  const i = APP.indexOf(assinatura);
  assert.notEqual(i, -1, 'o app.js ainda não tem: ' + assinatura);
  return pegarBloco(APP, assinatura, assinatura);
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [^\\n]*$', 'm').exec(APP);
  assert.ok(m, 'o app.js ainda não tem a constante ' + nome);
  return m[0].replace(/^const /, 'var ');
}
/* A tela com as pecas de verdade -- os cartoes (mostrarCartaoDoHost, guardarArtefato, redesenharArtefatos),
   o evento (tratarEventoDoPainel) e o desenho do historico (desenharHistorico) -- e o resto de mentira. */
function tela(cfg) {
  const reg = { configs: 0, cartoes: [], aberto: [], rascunhos: [] };
  const ctx = vm.createContext({
    console, Map, Set, JSON, Array, Object, String, Number, Date, Promise, Event: class { constructor(t) { this.type = t; } },
    document: { createElement: tag => new El(tag) },
    cfg, panes: new Map(), clearEmpty() {}, nomeDoMotor: () => 'Claude', mdSeguro: x => x,
    marcarRecibo() {}, desenharBlocosExcalidraw() {}, linkarArquivos() {}, marcarLinksWeb() {}, botoesDeCodigo() {},
    remotoDoPane: P => P.remoto || null,   // o lugar do painel: null = este PC, ou { host, usuario, porta, ... } de uma aba SSH
    verArquivo: (P, file, remoto) => { reg.aberto.push({ P: P.id, file, remoto }); return { ok: true }; },
    $: () => ({ value: '', dispatchEvent() {} }),
    userMsg: (P, text) => { const d = new El('div'); d.className = 'msg user'; d.textContent = text; P.chat.appendChild(d); P.hist.push({ quem: 'Você', texto: text }); return { balao: d }; },
    botBlock: P => { const d = new El('div'); d.className = 'msg bot'; P.chat.appendChild(d); return { el: d, raw: '' }; },
    window: {
      api: { setConfig: () => { reg.configs++; return Promise.resolve(true); } },
      CockpitFileLinks: require('../src/renderer/file-links'),
      CockpitConnectorPrompts: { mountHostAction(o) {
        const c = new El('section'); c.className = 'connector-host-action'; c.textContent = o.action.title || '';
        c.acao = o.action; c.opcoes = o; reg.cartoes.push(c); o.container.appendChild(c); return { element: c };
      } },
    },
  });
  ctx.acharPainel = id => ctx.panes.get(id);
  vm.runInContext([
    constante('ARTEFATOS_POR_CONVERSA'), constante('CONVERSAS_COM_ARTEFATO'), trecho('function chaveDosArtefatos('),
    trecho('function mostrarCartaoDoHost('), trecho('function guardarArtefato('), trecho('function redesenharArtefatos('),
    trecho('function desenharHistorico('), trecho('function tratarEventoDoPainel('),
  ].join('\n'), ctx);
  ctx.reg = reg;
  ctx.painel = (extra) => { const P = { id: 'p' + (++seq), engine: 'claude', sessaoId: 'sess-1', chat: new El('div'), hist: [], blocks: new Map(), morto: false, revisaoHist: 0, ...(extra || {}) }; ctx.panes.set(P.id, P); return P; };
  return ctx;
}
const evento = (P, extra) => ({ paneId: P.id, kind: 'host-artifact', id: 'a-' + (++seq), title: 'Relatório', file: 'G:\\Meu Drive\\relatório.md', origin: { kind: 'local' }, ...(extra || {}) });
const classes = (P) => P.chat.children.map(c => c.className);
// objeto/lista criado dentro do vm tem outro Object.prototype: copia por JSON pra comparar com deepEqual
const js = (x) => JSON.parse(JSON.stringify(x));

test('tela: o cartão do arquivo fica guardado no config, por conversa (motor:id), só com título, caminho e lugar', () => {
  const t = tela({}); const P = t.painel();
  t.tratarEventoDoPainel(evento(P, { id: 'a1', file: 'G:\\Meu Drive\\a.md', content: 'NAO GUARDAR', texto: 'NAO GUARDAR' }));
  assert.equal(t.reg.cartoes.length, 1, 'o cartão aparece na hora, como sempre');
  assert.equal(t.reg.cartoes[0].opcoes.type, 'host-artifact');
  assert.deepEqual(js(t.cfg.artefatos['claude:sess-1']), [{ id: 'a1', title: 'Relatório', file: 'G:\\Meu Drive\\a.md', origin: { kind: 'local' } }]);
  assert.equal(t.reg.configs, 1, 'gravou o config');
  t.tratarEventoDoPainel(evento(P, { id: 'a2' })); t.tratarEventoDoPainel(evento(P, { id: 'a1', title: 'Atualizado' }));
  assert.deepEqual(js(t.cfg.artefatos['claude:sess-1'].map(a => a.id)), ['a2', 'a1'], 'mesmo id não duplica (o mais novo vale)');
  assert.equal(t.cfg.artefatos['claude:sess-1'][1].title, 'Atualizado');
  assert.equal(JSON.stringify(t.cfg).includes('NAO GUARDAR'), false, 'nenhum conteúdo vai pro config');
});

test('tela: rascunho não é guardado; sem conversa identificada ou sem arquivo, nada é guardado', () => {
  const t = tela({}); const P = t.painel();
  t.tratarEventoDoPainel({ paneId: P.id, kind: 'host-draft', id: 'd1', text: 'Revise isto.', origin: { kind: 'local' } });
  assert.equal(t.reg.cartoes.length, 1, 'o cartão do rascunho segue aparecendo'); assert.equal(t.reg.cartoes[0].opcoes.type, 'host-draft');
  assert.equal(t.cfg.artefatos, undefined, 'rascunho não vai pro config');
  const sem = t.painel({ sessaoId: null, resumeId: null });
  t.tratarEventoDoPainel(evento(sem)); assert.equal(t.cfg.artefatos, undefined, 'sem id da conversa não há onde guardar');
  t.tratarEventoDoPainel(evento(P, { file: '' })); assert.equal(t.cfg.artefatos, undefined, 'sem arquivo nada é guardado');
  assert.equal(t.reg.cartoes.length, 3, 'mas o cartão sempre aparece');
});

test('tela: guarda os 20 mais novos de cada conversa e lembra só as 60 conversas mais recentes', () => {
  const t = tela({}); const P = t.painel();
  for (let i = 0; i < 25; i++) t.tratarEventoDoPainel(evento(P, { id: 'a' + i }));
  assert.deepEqual(js(t.cfg.artefatos['claude:sess-1'].map(a => a.id)), Array.from({ length: 20 }, (_, i) => 'a' + (i + 5)));
  for (let i = 0; i < 65; i++) t.tratarEventoDoPainel(evento(t.painel({ sessaoId: 'conv-' + i }), { id: 'x' + i }));
  const chaves = Object.keys(t.cfg.artefatos);
  assert.equal(chaves.length, 60);
  assert.ok(!chaves.includes('claude:sess-1') && !chaves.includes('claude:conv-0') && chaves.includes('claude:conv-64'), 'saem as conversas mais antigas');
  // mexer numa conversa antiga a traz de volta pra frente da fila
  const velha = t.painel({ sessaoId: 'conv-10' }); t.tratarEventoDoPainel(evento(velha, { id: 'nova' }));
  assert.equal(Object.keys(t.cfg.artefatos).at(-1), 'claude:conv-10');
});

test('tela: o cartão guardado reaparece ao desenhar a conversa de novo, depois das falas, na ordem em que foi oferecido', () => {
  const t = tela({}); const ao = t.painel();
  t.tratarEventoDoPainel(evento(ao, { id: 'a1', title: 'Primeiro', file: 'G:\\Meu Drive\\um.md' }));
  t.tratarEventoDoPainel(evento(ao, { id: 'a2', title: 'Segundo', file: 'C:\\Users\\hugom\\Projetos-claude\\dois.md' }));
  // outro painel (ou o app reaberto): mesma conversa, tela nova
  t.reg.cartoes.length = 0;
  const reaberto = t.painel({ sessaoId: null, resumeId: 'sess-1' });
  const msgs = [{ role: 'user', text: 'oi' }, { role: 'bot', text: 'oi, tudo bem' }];
  assert.equal(t.desenharHistorico(reaberto, msgs, { revisao: 0 }), true);
  assert.deepEqual(classes(reaberto), ['msg user', 'msg bot', 'connector-host-action', 'connector-host-action']);
  assert.deepEqual(t.reg.cartoes.map(c => [c.acao.title, c.acao.file]), [['Primeiro', 'G:\\Meu Drive\\um.md'], ['Segundo', 'C:\\Users\\hugom\\Projetos-claude\\dois.md']]);
  assert.deepEqual(js(t.reg.cartoes[1].acao.origin), { kind: 'local' }, 'o lugar do cartão volta junto');
  assert.equal(t.reg.cartoes[0].opcoes.type, 'host-artifact');
  // o botão do cartão reaberto abre no leitor
  t.reg.cartoes[0].opcoes.onOpen(t.reg.cartoes[0].acao);
  assert.deepEqual(t.reg.aberto.map(a => a.file), ['G:\\Meu Drive\\um.md']);
});

// o lugar de uma aba SSH (o que o remotoDoPane devolve) e o "origin" que o main põe no evento do cartão
const SERVIDOR = { host: 'vps.test', usuario: 'u', porta: 22, chave: 'k', caminhoRemoto: '~' };
const ORIGEM_SERVIDOR = { kind: 'remote', host: 'vps.test', user: 'u', port: 22 };

test('tela: cartão nascido no servidor, reaberto num painel LOCAL, não volta (o "Abrir" leria o caminho dele neste PC); no painel do mesmo servidor volta e abre lá', () => {
  const t = tela({});
  const local = t.painel(), servidor = t.painel({ remoto: SERVIDOR });
  t.tratarEventoDoPainel(evento(local, { id: 'l1', title: 'Neste PC', file: 'G:\\Meu Drive\\a.md' }));
  t.tratarEventoDoPainel(evento(servidor, { id: 'r1', title: 'No servidor', file: '/srv/app/relatorio.md', origin: ORIGEM_SERVIDOR }));
  assert.deepEqual(js(t.cfg.artefatos['claude:sess-1'].map(a => a.id)), ['l1', 'r1'], 'os dois ficam guardados na conversa');
  // a conversa reaberta num painel local: só o cartão local
  t.reg.cartoes.length = 0;
  const reaberto = t.painel({ sessaoId: null, resumeId: 'sess-1' });
  t.desenharHistorico(reaberto, [{ role: 'user', text: 'oi' }], { revisao: 0 });
  assert.deepEqual(t.reg.cartoes.map(c => c.acao.title), ['Neste PC'], 'o do servidor não volta num painel local');
  t.reg.cartoes[0].opcoes.onOpen(t.reg.cartoes[0].acao);
  assert.deepEqual(js(t.reg.aberto.at(-1)), { P: reaberto.id, file: 'G:\\Meu Drive\\a.md', remoto: null });
  // e no painel do mesmo servidor: só o cartão do servidor, que abre pelo servidor
  t.reg.cartoes.length = 0; t.reg.aberto.length = 0;
  const noServidor = t.painel({ sessaoId: null, resumeId: 'sess-1', remoto: { ...SERVIDOR } });
  t.desenharHistorico(noServidor, [{ role: 'user', text: 'oi' }], { revisao: 0 });
  assert.deepEqual(t.reg.cartoes.map(c => c.acao.title), ['No servidor'], 'o local não volta num painel de servidor');
  t.reg.cartoes[0].opcoes.onOpen(t.reg.cartoes[0].acao);
  assert.deepEqual(js(t.reg.aberto), [{ P: noServidor.id, file: '/srv/app/relatorio.md', remoto: SERVIDOR }]);
});

test('tela: o lugar do cartão é comparado com o do painel — outro servidor (host, usuário, porta), local num painel de servidor e o contrário não voltam', () => {
  const casos = [
    // [origin guardado, remoto do painel, volta?]
    [ORIGEM_SERVIDOR, SERVIDOR, true],
    [{ ...ORIGEM_SERVIDOR, host: 'VPS.Test' }, SERVIDOR, true],            // caixa do host não conta
    [ORIGEM_SERVIDOR, { ...SERVIDOR, host: 'VPS.TEST' }, true],
    [ORIGEM_SERVIDOR, { ...SERVIDOR, porta: undefined }, true],            // aba sem porta = 22
    [{ ...ORIGEM_SERVIDOR, port: 2222 }, { ...SERVIDOR, porta: 2222 }, true],
    [ORIGEM_SERVIDOR, { ...SERVIDOR, host: 'outro.test' }, false],
    [ORIGEM_SERVIDOR, { ...SERVIDOR, usuario: 'outro' }, false],
    [ORIGEM_SERVIDOR, { ...SERVIDOR, porta: 2222 }, false],
    [ORIGEM_SERVIDOR, null, false],                                         // painel local
    [{ kind: 'local' }, { ...SERVIDOR }, false],                            // cartão local num painel de servidor
    [{ kind: 'local' }, null, true],
    [undefined, null, true],                                                // entrada sem origin: vale como local
    [undefined, SERVIDOR, false],
  ];
  for (const [origin, remoto, volta] of casos) {
    const t = tela({ artefatos: { 'claude:sess-1': [{ id: 'x', title: 'Cartão', file: '/srv/app/x.md', ...(origin ? { origin } : {}) }] } });
    t.desenharHistorico(t.painel({ remoto }), [{ role: 'user', text: 'oi' }], { revisao: 0 });
    assert.equal(t.reg.cartoes.length, volta ? 1 : 0, (volta ? 'devia voltar: ' : 'não devia voltar: ') + JSON.stringify([origin, remoto]));
  }
});

test('tela: conversa sem cartão, outra conversa, outro motor, caminho de rede e entrada torta não desenham nada', () => {
  const t = tela({ artefatos: {
    'claude:sess-1': [null, 7, { id: 'r1', title: 'Rede', file: '\\\\srv\\share\\a.md' }, { id: 'r2', title: 'Rede 2', file: 'file://srv/share/b.md' }, { id: 'v', title: 'Sem arquivo', file: '' }, { id: 'ok', title: 'Bom', file: 'G:\\ok.md' }],
    'codex:sess-1': [{ id: 'c1', title: 'Do Codex', file: 'G:\\codex.md' }],
    'claude:outra': [{ id: 'o1', title: 'Outra conversa', file: 'G:\\outra.md' }],
  } });
  const P = t.painel();
  t.desenharHistorico(P, [{ role: 'user', text: 'oi' }], { revisao: 0 });
  assert.deepEqual(t.reg.cartoes.map(c => c.acao.title), ['Bom'], 'só o cartão válido desta conversa e deste motor');
  const vazio = t.painel({ sessaoId: 'sem-cartao' });
  t.desenharHistorico(vazio, [{ role: 'user', text: 'oi' }], { revisao: 0 });
  assert.deepEqual(classes(vazio), ['msg user']);
  const semConfig = tela({}); const Q = semConfig.painel();
  assert.equal(semConfig.desenharHistorico(Q, [{ role: 'user', text: 'oi' }], { revisao: 0 }), true);
  assert.deepEqual(classes(Q), ['msg user']);
  // sem a regra de rede carregada (file-links.js), nada volta: a trava fecha, não abre
  const semRegra = tela({ artefatos: { 'claude:sess-1': [{ id: 'ok', title: 'Bom', file: 'G:\\ok.md' }] } });
  semRegra.window.CockpitFileLinks = undefined;
  semRegra.desenharHistorico(semRegra.painel(), [{ role: 'user', text: 'oi' }], { revisao: 0 });
  assert.equal(semRegra.reg.cartoes.length, 0);
});

test('tela: página do histórico paginado não repete os cartões; no histórico longo eles vêm uma vez, depois do paginador', () => {
  const t = tela({ artefatos: { 'claude:sess-1': [{ id: 'a1', title: 'Guardado', file: 'G:\\a.md' }] } });
  const P = t.painel();
  t.desenharHistorico(P, [{ role: 'user', text: 'oi' }], { revisao: 0, pagina: true, offset: 40 });
  assert.equal(t.reg.cartoes.length, 0, 'a página sozinha não desenha cartão');
  const longa = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'fala ' + i }));
  t.window.CockpitHistoryPager = { mount: ({ container }) => { const g = new El('div'); g.className = 'history-pages'; container.appendChild(g); return { dispose() {} }; } };
  const Q = t.painel();
  assert.equal(t.desenharHistorico(Q, longa, { revisao: 0 }), true);
  assert.deepEqual(classes(Q), ['history-pages', 'connector-host-action']);
  assert.equal(t.reg.cartoes.length, 1);
});

test('tela: o cartão reaberto só abre na mesma conversa (mesma regra do cartão ao vivo)', () => {
  const t = tela({}); const P = t.painel();
  t.tratarEventoDoPainel(evento(P, { id: 'a1', file: 'G:\\a.md' }));
  const { onOpen } = t.reg.cartoes[0].opcoes;
  assert.deepEqual(js(onOpen({ file: 'G:\\a.md' })), { ok: true });
  P.sessaoId = 'outra-conversa';
  assert.deepEqual(js(onOpen({ file: 'G:\\a.md' })), { ok: false }, 'conversa trocada: não abre');
  P.sessaoId = 'sess-1'; P.morto = true;
  assert.deepEqual(js(onOpen({ file: 'G:\\a.md' })), { ok: false }, 'painel fechado: não abre');
  assert.equal(t.reg.aberto.length, 1);
});

test('fim a fim: o agente pede o arquivo do G:, o cartão aparece, é guardado e volta ao reabrir a conversa', async t => {
  const sessao = pasta(t), drive = pasta(t); fs.mkdirSync(path.join(drive, 'Meu Drive'));
  const arquivo = path.join(drive, 'Meu Drive', 'relatório final.md'); fs.writeFileSync(arquivo, '# Relatório');
  const eventos = [];
  const { broker } = fixture(t, { workRoots: () => [drive], onHostAction: (scope, kind, data) => { eventos.push({ paneId: scope.paneId, kind, ...data }); return { ok: true }; } });
  const resposta = await broker.callTool({ ...base, paneId: 'p-viva', cwd: sessao }, chamada(arquivo, 'fim-a-fim', { titulo: 'Relatório final' }));
  assert.equal(resposta.success, true, texto(resposta));
  const tela1 = tela({}); const viva = tela1.painel({ id: 'p-viva' }); tela1.panes.set('p-viva', viva);
  tela1.tratarEventoDoPainel(eventos[0]);
  assert.equal(tela1.reg.cartoes.length, 1);
  // app reaberto: config lido do disco (ida e volta por JSON), painel novo na mesma conversa
  const tela2 = tela(JSON.parse(JSON.stringify(tela1.cfg))); const reaberto = tela2.painel({ sessaoId: null, resumeId: 'sess-1' });
  tela2.desenharHistorico(reaberto, [{ role: 'user', text: 'gera o relatório' }, { role: 'bot', text: 'pronto, está no Drive' }], { revisao: 0 });
  assert.deepEqual(classes(reaberto), ['msg user', 'msg bot', 'connector-host-action']);
  assert.equal(tela2.reg.cartoes[0].acao.title, 'Relatório final');
  assert.equal(tela2.reg.cartoes[0].acao.file, fs.realpathSync(arquivo));
});

/* =====================================================================
   Fix C, item 3 (revisão da Task 6): motivos certos e teto no cartão guardado
   ===================================================================== */
test('a própria pasta da sessão, ou uma raiz de trabalho, é "uma pasta, não um arquivo" (e não "fora das pastas permitidas")', async t => {
  const sessao = pasta(t), drive = pasta(t), fora = pasta(t);
  fs.mkdirSync(path.join(sessao, 'docs'));
  const { broker, actions } = fixture(t, { workRoots: () => [drive] });
  const scope = { ...base, cwd: sessao };
  for (const [nome, arquivo] of [
    ['ponto', '.'], ['a pasta da sessão, absoluta', sessao], ['com separador no fim', sessao + path.sep],
    ['uma raiz de trabalho', drive], ['uma raiz com separador no fim', drive + path.sep],
  ]) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, nome);
    assert.match(texto(r), /pasta, não um arquivo/, nome);
    assert.doesNotMatch(texto(r), /fora das pastas/, nome);
  }
  // o que continua fora: o pai da pasta da sessão, uma pasta de outro lugar e subir com ..
  for (const [nome, arquivo] of [['o pai da sessão', path.dirname(sessao)], ['pasta de outro lugar', fora], ['sobe com ..', '..']]) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, nome);
    assert.match(texto(r), /fora das pastas permitidas/, nome);
  }
  assert.match(texto(await broker.callTool(scope, chamada('docs'))), /pasta, não um arquivo/, 'subpasta segue como antes');
  assert.equal(actions.length, 0);
});

test('no servidor, pedir a própria pasta da sessão também é "uma pasta, não um arquivo" (subir com .. segue fora da pasta)', async t => {
  const remoto = { ...base, cwd: '/srv/projeto', origin: { kind: 'remote', host: 'vps.test', user: 'hugo' } };
  const { broker, actions } = fixture(t, { validateRemoteFile: async () => { throw Error('a pasta nem devia chegar ao servidor'); } });
  for (const arquivo of ['.', '/srv/projeto', '/srv/projeto/']) {
    const r = await broker.callTool(remoto, chamada(arquivo));
    assert.equal(r.success, false, arquivo); assert.match(texto(r), /pasta, não um arquivo/, arquivo);
  }
  for (const arquivo of ['..', '/srv']) assert.match(texto(await broker.callTool(remoto, chamada(arquivo))), /fora da pasta da sessão/, arquivo);
  assert.equal(actions.length, 0);
});

test('\\\\?\\ e \\\\.\\ são recusados como "formato de caminho não aceito" (não como rede), sem tocar o disco; \\\\?\\UNC\\ e \\\\srv\\ seguem sendo rede', async t => {
  const sessao = pasta(t), disco = ['realpath', 'stat', 'lstat', 'access', 'readdir'].map(n => t.mock.method(fs.promises, n));
  const sincronos = ['statSync', 'lstatSync', 'existsSync', 'realpathSync', 'readdirSync'].map(n => t.mock.method(fs, n));
  const { broker, actions } = fixture(t);
  const scope = { ...base, cwd: sessao };
  for (const arquivo of ['\\\\?\\C:\\QA\\a.md', '\\\\.\\C:\\QA\\a.md', '//?/C:/QA/a.md', '//./C:/QA/a.md', '\\\\.\\pipe\\x', '  \\\\?\\C:\\QA\\a.md', '\\\\?\\']) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, arquivo);
    assert.match(texto(r), /formato de caminho não aceito/, arquivo);
    assert.notEqual(texto(r), REDE, arquivo + ': não é caminho de rede');
  }
  for (const arquivo of ['\\\\?\\UNC\\srv\\share\\a.md', '\\\\?\\unc\\srv\\share\\a.md', '//?/UNC/srv/share/a.md', '\\\\srv\\share\\a.md', '//srv/share/a.md']) {
    const r = await broker.callTool(scope, chamada(arquivo));
    assert.equal(r.success, false, arquivo); assert.equal(texto(r), REDE, arquivo);
  }
  if (process.platform === 'win32') {
    // a pasta da sessão em formato longo + nome relativo: o caminho resolvido é \\?\...
    const longa = await broker.callTool({ ...base, cwd: '\\\\?\\C:\\QA' }, chamada('a.md'));
    assert.equal(longa.success, false); assert.match(texto(longa), /formato de caminho não aceito/);
  }
  assert.equal(actions.length, 0);
  assert.deepEqual(disco.map(m => m.mock.callCount()), [0, 0, 0, 0, 0], 'nenhuma chamada ao disco (fs.promises)');
  assert.deepEqual(sincronos.map(m => m.mock.callCount()), [0, 0, 0, 0, 0], 'nenhuma chamada ao disco (fs síncrono)');
});

test('tela: título e caminho guardados no cartão têm teto (160 e 1024 letras); o cartão que aparece na hora segue inteiro', () => {
  const t = tela({}); const P = t.painel();
  const titulo = 'T'.repeat(500), caminho = 'G:\\' + 'pasta\\'.repeat(400) + 'a.md';
  t.tratarEventoDoPainel(evento(P, { id: 'a1', title: titulo, file: caminho }));
  const guardado = t.cfg.artefatos['claude:sess-1'][0];
  assert.equal(guardado.title, titulo.slice(0, 160));
  assert.equal(guardado.file, caminho.slice(0, 1024));
  assert.equal(t.reg.cartoes[0].acao.file, caminho, 'o cartão ao vivo é o do agente, sem corte');
  // dentro do teto nada muda
  const justo = 'G:\\' + 'x'.repeat(1020) + '.md';
  t.tratarEventoDoPainel(evento(P, { id: 'a2', title: 'Relatório', file: justo.slice(0, 1024) }));
  assert.equal(t.cfg.artefatos['claude:sess-1'][1].file.length, 1024);
  assert.equal(t.cfg.artefatos['claude:sess-1'][1].title, 'Relatório');
});
