'use strict';
/* Leva 41 (B6): o Cockpit da' nome de 3 palavras a conversa nova.

   Tres camadas:
   1) titulo-auto.js puro: pos-processamento da resposta do modelo, prompt pelo
      STDIN, linha de comando (Haiku, sem ferramenta, sem MCP, sem hook, sem
      sessao gravada), leitura do JSON do CLI (sem conta = erro, nao titulo),
      regra dos nomes (seu > automatico), fila, prazo e "uma chamada por conversa";
   2) o main.js DE VERDADE (Electron e spawn falsos): canal 'titulo:gerar', o
      automatico gravado separado em nomes.json, a lista do Claude e a releitura
      do aiTitle respeitando seu > 3 palavras > aiTitle;
   3) a tela (app.js): quando gerar e quando NAO (ramo, reaberta, restaurada,
      "continue", "/comando", nome seu), dedupe, fallback, a ficha que guarda de
      onde veio o nome, e o campo do rascunho que nao pode ficar com 0px. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const cpReal = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const T = require('../src/titulo-auto');

/* =====================================================================
   1) titulo-auto.js puro
   ===================================================================== */
test('pos-processamento: aspas, markdown, pontuacao e rotulo saem; 3 palavras e maiuscula', () => {
  assert.equal(T.posProcessar('"Campanha Remarketing Meta."'), 'Campanha Remarketing Meta');
  assert.equal(T.posProcessar('**Bug no Login**'), 'Bug no Login');
  assert.equal(T.posProcessar('# planilha de senhas'), 'Planilha de senhas');
  assert.equal(T.posProcessar('Título: Relatório Meta Ads'), 'Relatório Meta Ads');
  assert.equal(T.posProcessar('“Contrato Fornecedor Revisão”'), 'Contrato Fornecedor Revisão');
  assert.equal(T.posProcessar('`Deploy Nexfin Produção`'), 'Deploy Nexfin Produção');
  assert.equal(T.posProcessar('Campanha Remarketing Meta\n\nUse: h5'), 'Campanha Remarketing Meta', 'so a 1a linha conta (a regra do CLAUDE.md nao entra)');
  assert.equal(T.posProcessar('\n\n  Ajuste Rodapé Página  \n'), 'Ajuste Rodapé Página');
  assert.equal(T.posProcessar('E-mail de boas-vindas'), 'E-mail de boas-vindas', 'hifen dentro da palavra fica');
});

test('pos-processamento: mais de 3 corta, menos de 3 (ou nada) cai no resumo cru', () => {
  assert.equal(T.posProcessar('Campanha de remarketing no Meta Ads'), 'Campanha de remarketing');
  assert.equal(T.posProcessar('Remarketing Meta'), '');
  assert.equal(T.posProcessar('Oi'), '');
  assert.equal(T.posProcessar(''), '');
  assert.equal(T.posProcessar(null), '');
  assert.equal(T.posProcessar('...!!!'), '');
  assert.equal(T.posProcessar('— — —'), '');
  const longo = T.posProcessar('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb Ccccccccccccccccccccc');
  assert.ok(longo.length <= 60, 'nome gigante nao estoura a barra: ' + longo.length);
});

test('prompt vai pelo STDIN, cortado em ~4000 caracteres; argv sem o texto', () => {
  const grande = 'pedido '.repeat(2000);
  const p = T.montarPrompt(grande);
  assert.ok(p.includes('<pedido>') && p.includes('EXATAMENTE 3 palavras'));
  const miolo = p.slice(p.indexOf('<pedido>\n') + 9, p.indexOf('\n</pedido>'));
  assert.ok(miolo.length <= T.LIMITE_TEXTO, 'cortado: ' + miolo.length);
  const a = T.argumentos('C:/ud/titulo-auto-settings.json');
  assert.ok(!/<pedido>|EXATAMENTE/.test(a.join(' ')), 'o prompt com a mensagem nunca vai no argv');
  const valor = (f) => a[a.indexOf(f) + 1];
  assert.equal(a[0], '-p');
  assert.equal(valor('--model'), 'claude-haiku-4-5-20251001');
  assert.equal(valor('--output-format'), 'json');
  assert.equal(valor('--tools'), '', '--tools "" desliga todas as ferramentas');
  assert.equal(valor('--settings'), 'C:/ud/titulo-auto-settings.json');
  for (const f of ['--strict-mcp-config', '--no-session-persistence', '--safe-mode', '--system-prompt']) assert.ok(a.includes(f), 'falta ' + f);
  assert.ok(!T.argumentos('x', true).includes('--safe-mode'), 'CLI antigo: sem --safe-mode');
  assert.doesNotMatch(T.SISTEMA, /[&|<>^%!"]/, 'o prompt de sistema vai no argv: nada que o cmd.exe coma');
});

test('saida do CLI: so is_error=false com texto vira titulo; "Not logged in" nao', () => {
  assert.deepEqual(T.lerSaida(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Campanha Remarketing Meta' })), { texto: 'Campanha Remarketing Meta' });
  const semConta = T.lerSaida(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }));
  assert.equal(semConta.erro, 'motor');
  assert.equal(T.lerSaida('').erro, 'vazio');
  assert.equal(T.lerSaida('lixo sem json').erro, 'formato');
  assert.deepEqual(T.lerSaida(JSON.stringify([{ type: 'system' }, { type: 'result', is_error: false, subtype: 'success', result: 'A B C' }])), { texto: 'A B C' });
  assert.deepEqual(T.lerSaida('aviso qualquer\n' + JSON.stringify({ type: 'result', is_error: false, subtype: 'success', result: 'X Y Z' })), { texto: 'X Y Z' });
});

test('nomes.json: o seu vence o automatico; o automatico fica separado e da pra distinguir', () => {
  const nomes = { 'id-1': 'Meu nome' };
  T.gravarNomeAuto(nomes, 'id-1', 'Tres Palavras Aqui');
  T.gravarNomeAuto(nomes, 'id-2', 'Campanha Remarketing Meta');
  assert.equal(nomes['id-1'], 'Meu nome', 'o automatico nao mexe no seu');
  assert.deepEqual(T.nomeDaConversa(nomes, 'id-1'), { nome: 'Meu nome', auto: false, manual: true });
  assert.deepEqual(T.nomeDaConversa(nomes, 'id-2'), { nome: 'Campanha Remarketing Meta', auto: true, manual: false });
  assert.deepEqual(T.nomeDaConversa(nomes, 'id-3'), { nome: '', auto: false, manual: false });
  assert.equal(T.nomeDaConversa(nomes, '_auto').nome, '', 'a chave interna nao e conversa');
  const item = { id: 'id-2', title: 'Titulo do aiTitle' };
  assert.deepEqual(T.aplicarNome(item, nomes), { id: 'id-2', title: 'Campanha Remarketing Meta', tituloAuto: true });
  assert.deepEqual(T.aplicarNome({ id: 'id-1', title: 'x' }, nomes), { id: 'id-1', title: 'Meu nome', nome: 'Meu nome' });
  assert.equal(T.aplicarNome({ id: 'id-9', title: 'fica' }, nomes).title, 'fica');
  T.esquecerNome(nomes, 'id-1');
  assert.equal(nomes['id-1'], undefined);
  assert.equal(nomes._auto['id-1'], undefined, 'apagar a conversa leva os dois nomes');
  assert.equal(nomes._auto['id-2'], 'Campanha Remarketing Meta');
});

/* ---------- processo falso do claude (so' pro gerador) ---------- */
function procFalso({ saida, erro, codigo = 0, atraso = 5, nuncaFecha = false, emiteErro = false }) {
  const p = new EventEmitter();
  p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
  p.recebido = '';
  p.stdin.on('data', (d) => { p.recebido += d.toString('utf8'); });
  p.morto = false;
  p.kill = () => { p.morto = true; };
  if (emiteErro) setTimeout(() => p.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), atraso);
  else if (!nuncaFecha) {
    p.stdin.on('finish', () => setTimeout(() => {
      if (saida) p.stdout.write(saida);
      if (erro) p.stderr.write(erro);
      setTimeout(() => p.emit('close', codigo), 2);
    }, atraso));
  }
  return p;
}
const ok = (titulo) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: titulo });

function gerador(roteiro, extra) {
  const chamadas = [];
  const dep = {
    spawn: (bin, args, opts) => { const r = roteiro(chamadas.length, args); const p = procFalso(r); chamadas.push({ bin, args, opts, p }); return p; },
    bin: () => 'claude',
    env: () => ({ PATH: 'x' }),
    matar: (p) => p.kill(),
    arqSettings: () => 'settings.json',
    ...(extra || {}),
  };
  return { g: T.criarGerador(dep), chamadas };
}

test('gerador: manda o prompt pelo stdin, fora de pasta de projeto, e devolve o titulo limpo', async () => {
  const { g, chamadas } = gerador(() => ({ saida: ok('"Campanha Remarketing Meta."') }));
  const r = await g.pedir('p1:a', 'preciso subir uma campanha de remarketing no meta ads');
  assert.equal(r.titulo, 'Campanha Remarketing Meta');
  assert.equal(r.motivo, 'ok');
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].p.recebido, /campanha de remarketing no meta ads/);
  assert.equal(chamadas[0].opts.cwd, os.tmpdir(), 'roda na pasta temporaria: nenhum CLAUDE.md de projeto entra');
  assert.equal(chamadas[0].opts.windowsHide, true);
});

test('gerador: uma chamada por conversa (mesma chave = mesma resposta, sem outro Claude)', async () => {
  const { g, chamadas } = gerador(() => ({ saida: ok('Bug Login Nexfin'), atraso: 30 }));
  const [a, b] = await Promise.all([g.pedir('p1:x', 'o login do nexfin quebrou'), g.pedir('p1:x', 'o login do nexfin quebrou')]);
  const c = await g.pedir('p1:x', 'o login do nexfin quebrou');
  assert.equal(chamadas.length, 1, '2 Enter rapidos + repeticao = 1 chamada');
  assert.equal(a.titulo, 'Bug Login Nexfin'); assert.equal(b.titulo, a.titulo); assert.equal(c.titulo, a.titulo);
  await g.pedir('p2:y', 'outra conversa');
  assert.equal(chamadas.length, 2, 'conversa diferente, chamada nova');
});

test('gerador: no maximo 2 Claudes juntos (5 paineis novos de uma vez nao sobem 5)', async () => {
  let vivos = 0, pico = 0;
  const chamadas = [];
  const g = T.criarGerador({
    spawn: () => {
      vivos++; pico = Math.max(pico, vivos);
      const p = procFalso({ saida: ok('Um Dois Tres'), atraso: 25 });
      p.on('close', () => { vivos--; });
      chamadas.push(p); return p;
    },
    bin: () => 'claude', env: () => ({}), matar: (p) => p.kill(), arqSettings: () => 's.json',
  });
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => g.pedir('c' + i, 'pedido ' + i)));
  assert.equal(chamadas.length, 5);
  assert.ok(pico <= 2, 'pico de ' + pico);
  assert.ok(rs.every((r) => r.titulo === 'Um Dois Tres'));
});

test('fallback calado: sem Claude, sem conta, prazo estourado, resposta torta', async () => {
  const semBin = await T.gerarTitulo('texto', { spawn: () => { throw new Error('ENOENT'); }, bin: () => 'claude', arqSettings: () => 's' });
  assert.deepEqual([semBin.titulo, semBin.motivo], ['', 'sem-claude']);

  const { g: g2 } = gerador(() => ({ emiteErro: true }));
  const enoent = await g2.pedir('k2', 'texto');
  assert.deepEqual([enoent.titulo, enoent.motivo], ['', 'sem-claude']);

  const { g: g3 } = gerador(() => ({ saida: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }) }));
  const semConta = await g3.pedir('k3', 'texto');
  assert.deepEqual([semConta.titulo, semConta.motivo], ['', 'motor'], 'o recado de login nunca vira nome de conversa');

  const { g: g4, chamadas: c4 } = gerador(() => ({ nuncaFecha: true }), { prazoMs: 60 });
  const t0 = Date.now();
  const prazo = await g4.pedir('k4', 'texto');
  assert.deepEqual([prazo.titulo, prazo.motivo], ['', 'prazo']);
  assert.ok(c4[0].p.morto, 'o processo que estourou o prazo e morto');
  assert.ok(Date.now() - t0 < 2000);

  const { g: g5 } = gerador(() => ({ saida: ok('Oi') }));
  const torta = await g5.pedir('k5', 'oi');
  assert.deepEqual([torta.titulo, torta.motivo], ['', 'resposta-torta']);

  const { g: g6 } = gerador(() => ({ saida: '', codigo: 1, erro: 'boom' }));
  const caiu = await g6.pedir('k6', 'texto');
  assert.equal(caiu.titulo, '');

  assert.equal((await T.gerarTitulo('   ', {})).motivo, 'vazio', 'mensagem vazia nem sobe o Claude');
});

test('CLI antigo sem --safe-mode: tenta de novo sem ele (1x) e acerta', async () => {
  const { g, chamadas } = gerador((n, args) => (args.includes('--safe-mode')
    ? { saida: '', erro: "error: unknown option '--safe-mode'\n", codigo: 1 }
    : { saida: ok('Planilha Senhas Drive') }));
  const r = await g.pedir('k-antigo', 'faz uma planilha com essas senhas');
  assert.equal(r.titulo, 'Planilha Senhas Drive');
  assert.equal(chamadas.length, 2);
  assert.ok(!chamadas[1].args.includes('--safe-mode'));
});

test('settings proprio: sem hook, sem pensamento; arquivo (nao JSON no argv)', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-titulo-'));
  try {
    const f = T.arquivoDeSettings(pasta);
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { disableAllHooks: true, alwaysThinkingEnabled: false });
    assert.equal(T.arquivoDeSettings(pasta), f);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

/* =====================================================================
   2) main.js de verdade, com Electron e spawn falsos
   ===================================================================== */
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-b6-'));
const HOME = path.join(RAIZ, 'home');
const USERDATA = path.join(RAIZ, 'userData');
const PASTA = path.join(RAIZ, 'projeto');
const PROJ = path.join(HOME, '.claude', 'projects', PASTA.replace(/[\\/.:]/g, '-'));
const STDIN_LOG = path.join(RAIZ, 'stdin.log');
for (const d of [PROJ, USERDATA, PASTA]) fs.mkdirSync(d, { recursive: true });

const RESUMIDOR = path.join(RAIZ, 'resumidor-falso.js');
fs.writeFileSync(RESUMIDOR, `
const fs = require('fs');
let b = '';
process.stdin.on('data', (d) => { b += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.argv[2], JSON.stringify(b) + '\\n');
  const t = /remarketing/i.test(b) ? '"Campanha Remarketing Meta."' : 'Resumo Da Demanda';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: t }));
});
`);

const spawns = [];
const filhos = [];
function spawnFalso(bin, args, opts) {
  const lista = Array.isArray(args) ? args : [];
  spawns.push({ bin: String(bin), args: lista, cwd: opts && opts.cwd });
  const o = { ...(opts || {}) }; delete o.windowsVerbatimArguments;
  const p = lista.includes('--no-session-persistence')
    ? cpReal.spawn(process.execPath, [RESUMIDOR, STDIN_LOG], { cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    : cpReal.spawn(process.execPath, ['-e', 'process.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  filhos.push(p);
  return p;
}

const handlers = new Map();
class JanelaFalsa {
  constructor() { this.webContents = { on() {}, send() {}, setWindowOpenHandler() {}, reload() {}, isDestroyed: () => false }; }
  static getAllWindows() { return []; }
  on() {} loadFile() {} isDestroyed() { return false; } isMinimized() { return false; }
}
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME),
    whenReady: () => Promise.resolve(), on() {},
    setName() {}, quit() {}, disableHardwareAcceleration() {}, setPath() {},
    requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
    isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: JanelaFalsa,
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {}, trashItem: async (f) => fs.rmSync(f, { force: true }) },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: () => '', writeText() {} },
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
  crashReporter: { start() {} },
};
const intervaloReal = global.setInterval;
global.setInterval = (...a) => { const t = intervaloReal(...a); if (t && t.unref) t.unref(); return t; };
const watchReal = fs.watch;
const vigias = [];
fs.watch = (...a) => { const w = watchReal(...a); vigias.push(w); if (w && w.unref) w.unref(); return w; };
test.after(() => {
  for (const p of filhos) { try { p.kill(); } catch {} for (const s of [p.stdin, p.stdout, p.stderr]) { try { s && s.destroy(); } catch {} } }
  for (const w of vigias) { try { w.close(); } catch {} }
  try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {}
});

let carregou = null;
{
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (nome) {
    if (nome === 'electron') return eletronFalso;
    if (nome === 'os') {
      const real = requireOriginal.call(this, 'os');
      return new Proxy(real, { get: (alvo, k) => (k === 'homedir' ? () => HOME : alvo[k]) });
    }
    if (nome === 'child_process') {
      const real = requireOriginal.call(this, 'child_process');
      return new Proxy(real, { get: (alvo, k) => (k === 'spawn' ? spawnFalso : alvo[k]) });
    }
    return requireOriginal.apply(this, arguments);
  };
  try { require(path.join(__dirname, '..', 'src', 'main.js')); carregou = true; }
  catch (e) { carregou = e; }
  finally { Module.prototype.require = requireOriginal; }
}
const chamar = (canal, arg) => {
  if (carregou !== true) throw carregou;
  const h = handlers.get(canal);
  if (!h) throw new Error('handler ausente: ' + canal);
  return h({}, arg);
};
const nomesNoDisco = () => { try { return JSON.parse(fs.readFileSync(path.join(USERDATA, 'nomes.json'), 'utf8')); } catch { return {}; } };

const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function conversaComAiTitle(sid) {
  const l = [
    { type: 'user', entrypoint: 'cockpit', cwd: PASTA, sessionId: sid, uuid: 'u1', message: { role: 'user', content: 'preciso subir uma campanha de remarketing no meta ads pro manual do comercial' } },
    { type: 'assistant', sessionId: sid, uuid: 'u2', parentUuid: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Certo, vamos montar a campanha passo a passo.' }] } },
    { type: 'ai-title', aiTitle: 'Titulo do CLI que nao pode vencer', sessionId: sid },
  ];
  return l.map((x) => JSON.stringify(x)).join('\n') + '\n';
}

test('main: titulo:gerar sobe o Haiku sem ferramenta, com o texto pelo stdin, e responde o nome limpo', async () => {
  const r = await chamar('titulo:gerar', { chave: 'p1:1', texto: 'preciso subir uma campanha de remarketing no meta ads pro manual do comercial' });
  assert.equal(r.titulo, 'Campanha Remarketing Meta', JSON.stringify(r));
  const s = spawns.filter((x) => x.args.includes('--no-session-persistence'));
  assert.equal(s.length, 1);
  const a = s[0].args;
  assert.equal(a[a.indexOf('--model') + 1], 'claude-haiku-4-5-20251001');
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(a.includes('--strict-mcp-config') && a.includes('--safe-mode'));
  assert.ok(!a.join(' ').includes('remarketing'), 'o texto nao vai no argv');
  const arq = a[a.indexOf('--settings') + 1];
  assert.equal(path.dirname(arq), USERDATA);
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { disableAllHooks: true, alwaysThinkingEnabled: false });
  assert.match(fs.readFileSync(STDIN_LOG, 'utf8'), /remarketing no meta ads/, 'o texto chegou pelo stdin');
  assert.equal(s[0].cwd, os.tmpdir());
  // mesma conversa de novo: nenhuma chamada nova
  const r2 = await chamar('titulo:gerar', { chave: 'p1:1', texto: 'qualquer coisa' });
  assert.equal(r2.titulo, 'Campanha Remarketing Meta');
  assert.equal(spawns.filter((x) => x.args.includes('--no-session-persistence')).length, 1);
  // vazio nao sobe nada
  const r3 = await chamar('titulo:gerar', { chave: 'p9:1', texto: '   ' });
  assert.equal(r3.titulo, '');
  assert.equal(spawns.filter((x) => x.args.includes('--no-session-persistence')).length, 1);
});

test('main: lista e releitura seguem seu > 3 palavras do Cockpit > aiTitle', async () => {
  fs.writeFileSync(path.join(PROJ, SID + '.jsonl'), conversaComAiTitle(SID));
  const achar = async () => (await chamar('sessions:claude', false)).find((s) => s.id === SID);
  let s = await achar();
  assert.equal(s.title, 'Titulo do CLI que nao pode vencer', 'sem nome do Cockpit: o aiTitle');
  assert.equal(await chamar('sessions:titulo', { engine: 'claude', id: SID }), 'Titulo do CLI que nao pode vencer');

  await chamar('sessao:renomear', { engine: 'claude', id: SID, nome: 'Campanha Remarketing Meta', auto: true });
  assert.deepEqual(nomesNoDisco(), { _auto: { [SID]: 'Campanha Remarketing Meta' } }, 'o automatico mora em _auto');
  s = await achar();
  assert.equal(s.title, 'Campanha Remarketing Meta', 'o de 3 palavras vence o aiTitle na lista');
  assert.equal(s.tituloAuto, true); assert.equal(s.nome, undefined);
  assert.equal(await chamar('sessions:titulo', { engine: 'claude', id: SID }), 'Campanha Remarketing Meta', 'a releitura nao passa por cima');

  await chamar('sessao:renomear', { engine: 'claude', id: SID, nome: 'Remarketing do Pedro' });
  s = await achar();
  assert.equal(s.title, 'Remarketing do Pedro', 'o seu vence tudo');
  assert.equal(s.nome, 'Remarketing do Pedro'); assert.equal(s.tituloAuto, undefined);
  assert.equal(nomesNoDisco()._auto[SID], 'Campanha Remarketing Meta', 'o automatico continua guardado (da pra distinguir)');
  assert.equal(await chamar('sessions:titulo', { engine: 'claude', id: SID }), 'Remarketing do Pedro');

  // um automatico que chegue DEPOIS nao apaga o seu
  await chamar('sessao:renomear', { engine: 'claude', id: SID, nome: 'Outro Nome Auto', auto: true });
  assert.equal((await achar()).title, 'Remarketing do Pedro');

  // voce apaga o seu nome: volta o automatico
  await chamar('sessao:renomear', { engine: 'claude', id: SID, nome: '' });
  assert.equal((await achar()).title, 'Outro Nome Auto');
});

test('main: automatico do Codex nao escreve no app do Codex; apagar conversa leva os dois nomes', async () => {
  const antes = spawns.length;
  await chamar('sessao:renomear', { engine: 'codex', id: 'thread-1', nome: 'Bug Login Nexfin', auto: true });
  assert.equal(spawns.slice(antes).filter((x) => /codex/i.test(x.bin) || x.args.includes('app-server')).length, 0, 'automatico nao sobe o Codex pra dar thread/name/set');
  assert.equal(nomesNoDisco()._auto['thread-1'], 'Bug Login Nexfin');

  const outro = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const arq = path.join(PROJ, outro + '.jsonl');
  fs.writeFileSync(arq, conversaComAiTitle(outro));
  await chamar('sessao:renomear', { engine: 'claude', id: outro, nome: 'Auto Qualquer Coisa', auto: true });
  await chamar('sessao:renomear', { engine: 'claude', id: outro, nome: 'Meu nome' });
  const r = await chamar('sessao:apagar', { engine: 'claude', id: outro, file: arq });
  assert.ok(r && r.ok, JSON.stringify(r));
  const n = nomesNoDisco();
  assert.equal(n[outro], undefined); assert.equal(n._auto[outro], undefined);
});

test('main: lista do Gemini/ACP tambem passa pelo nomes.json', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const i = MAIN.indexOf("ipcMain.handle('sessions:cli'");
  const bloco = MAIN.slice(i, MAIN.indexOf('\n});', i));
  assert.match(bloco, /comNomes\(acp\.sessoes\(\)\)/);
  assert.match(bloco, /comNomes\(cliSessions\(engine\)\)/);
});

/* =====================================================================
   3) a tela (app.js)
   ===================================================================== */
const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
function funcao(nome) {
  const inicio = APP.indexOf('function ' + nome + '(');
  assert.notEqual(inicio, -1, 'funcao nao encontrada no app.js: ' + nome);
  const abre = APP.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    if (APP[i] === '}' && --nivel === 0) return APP.slice(APP.slice(inicio - 6, inicio) === 'async ' ? inicio - 6 : inicio, i + 1);
  }
  throw new Error('funcao incompleta: ' + nome);
}
/* funcao com chave dentro de texto ('{') engana a contagem: corta ate a proxima funcao do topo */
function trecho(nome) {
  const m = APP.match(new RegExp('\\n(async )?function ' + nome + '\\('));
  assert.ok(m, 'funcao nao encontrada: ' + nome);
  const ini = m.index + 1;
  const prox = APP.slice(ini + 10).search(/\n(async )?function /);
  return APP.slice(ini, ini + 10 + prox);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function tela(extras) {
  const x = extras || {};
  const renomeados = [], pedidos = [], salvos = { n: 0 }, pintados = [];
  let respostaTitulo = x.respostaTitulo || (async () => ({ titulo: 'Campanha Remarketing Meta', motivo: 'ok' }));
  const ctx = vm.createContext({
    cfg: x.cfg || {},
    histCache: {}, renomeados, pedidos, salvos, pintados,
    window: { api: {
      renomear: async (o) => { renomeados.push(o); return true; },
      tituloAuto: (o) => { pedidos.push(o); return respostaTitulo(o); },
      sessionTitulo: async () => x.aiTitle || '',
    } },
    $: () => null,
    loadHist: () => {},
    savePanes: () => { salvos.n++; },
    pintarNome: (P) => { pintados.push(P.titulo); },
    remotoDoPane: () => null,
    setTimeout, clearTimeout, Promise, Date, Math, String, JSON, Object, Array, Set, Map, RegExp, console,
  });
  const i = APP.indexOf('const PALAVRA_VAZIA');
  const j = APP.indexOf('function tituloCurto(');
  vm.runInContext(APP.slice(i, j), ctx);
  vm.runInContext('const PALAVRAS_DO_NOME = 3;', ctx);
  vm.runInContext(['tituloCurto', 'soComandoOuContinue', 'tituloCurto3', 'podeGerarTituloAuto', 'iniciarTituloAuto',
    'gravarNomeDoPainel', 'esquecerTituloAuto', 'buscarNome', 'aoNascerSessao', 'tituloDeRamo',
    'guardarEstadoDoMotor', 'fichaDoPainel'].map(funcao).join('\n'), ctx);
  ctx.definirResposta = (fn) => { respostaTitulo = fn; };
  return ctx;
}
const painel = (o) => ({ id: 'p1', engine: 'claude', el: {}, titulo: '', hist: [], resumeId: null, sessaoId: null, forkPendente: false, nomeManual: false, ...(o || {}) });

test('tela: quando gera -- conversa nova, 1a mensagem de verdade', () => {
  const c = tela();
  assert.equal(c.podeGerarTituloAuto(painel(), 'preciso subir uma campanha de remarketing'), true);
  assert.equal(c.podeGerarTituloAuto(painel({ engine: 'codex' }), 'arruma o bug do login'), true, 'vale pra todos os motores');
  assert.equal(c.podeGerarTituloAuto(painel({ engine: 'gemini' }), 'faz uma planilha'), true);
  // a 1a foi so' "/model": a proxima mensagem de verdade ainda e' a 1a demanda
  assert.equal(c.podeGerarTituloAuto(painel({ hist: [{ quem: 'Você', texto: '/model sonnet' }] }), 'arruma o rodape'), true);
});

test('tela: quando NAO gera -- ramo, reaberta, restaurada, continue, /comando, nome seu, debate desligado', () => {
  const c = tela();
  const msg = 'preciso subir uma campanha de remarketing';
  assert.equal(c.podeGerarTituloAuto(painel({ titulo: '(ramo) Campanha do Pedro', resumeId: 'x', forkPendente: true }), msg), false, 'ramo mantem "(ramo) …"');
  assert.equal(c.podeGerarTituloAuto(painel({ titulo: 'Conversa antiga', resumeId: 's-velha' }), msg), false, 'reaberta pela lista');
  assert.equal(c.podeGerarTituloAuto(painel({ resumeId: 's-velha' }), msg), false, 'restaurada sem nome tambem nao');
  assert.equal(c.podeGerarTituloAuto(painel({ hist: [{ quem: 'Você', texto: 'mensagem antiga' }, { quem: 'Claude', texto: 'resp' }] }), msg), false, 'ja tinha fala sua');
  assert.equal(c.podeGerarTituloAuto(painel(), 'continue'), false);
  assert.equal(c.podeGerarTituloAuto(painel(), 'Continua.'), false);
  assert.equal(c.podeGerarTituloAuto(painel(), '/compact'), false);
  assert.equal(c.podeGerarTituloAuto(painel({ nomeManual: true, titulo: '' }), msg), false, 'nome seu vence');
  assert.equal(c.podeGerarTituloAuto(painel({ _tituloAutoChave: 'p1:x' }), msg), false, 'ja pediu nesta conversa');
  assert.equal(c.podeGerarTituloAuto(painel({ morto: true }), msg), false);
  const desligado = tela({ cfg: { tituloAuto: false } });
  assert.equal(desligado.podeGerarTituloAuto(painel(), msg), false, 'cfg.tituloAuto === false desliga');
  assert.equal(tela({ cfg: { tituloAuto: true } }).podeGerarTituloAuto(painel(), msg), true);
});

test('tela: resumo cru na hora, depois o de 3 palavras; grava marcado como automatico quando a sessao nasce', async () => {
  const c = tela();
  const P = painel();
  const texto = 'preciso subir uma campanha de remarketing no meta ads pro manual do comercial';
  const vai = c.iniciarTituloAuto(P, texto);
  assert.equal(P.titulo.split(' ').length <= 3, true, 'o provisorio ja tem no maximo 3 palavras: ' + P.titulo);
  assert.equal(c.podeGerarTituloAuto(P, 'segunda mensagem rapida'), false, 'dedupe: a 2a mensagem nao pede de novo');
  await vai;
  assert.equal(P.titulo, 'Campanha Remarketing Meta');
  assert.equal(P.tituloAuto, true);
  assert.equal(c.pedidos.length, 1);
  assert.equal(c.pedidos[0].texto, texto, 'vai so o texto que voce escreveu');
  assert.equal(c.renomeados.length, 0, 'sem endereco da conversa ainda: espera');
  c.aoNascerSessao(P, { id: 'sess-1', file: 'x.jsonl' });
  await esperar(5);
  assert.deepEqual(JSON.parse(JSON.stringify(c.renomeados[0])), { engine: 'claude', id: 'sess-1', nome: 'Campanha Remarketing Meta', auto: true });
  c.aoNascerSessao(P, { id: 'sess-1', file: 'x.jsonl' });
  await esperar(5);
  assert.equal(c.renomeados.length, 1, 'nao regrava o mesmo nome');
  // a ficha guarda de onde veio o nome (sobrevive a reabrir o app)
  const f = c.fichaDoPainel({ ...P, coluna: 0, el: {}, engineStates: {} });
  assert.equal(f.tituloAuto, true); assert.equal(f.nomeManual, undefined); assert.equal(f.titulo, 'Campanha Remarketing Meta');
});

test('tela: sessao que ja nasceu antes do nome chegar grava na hora', async () => {
  const c = tela();
  const P = painel({ sessaoId: null });
  const vai = c.iniciarTituloAuto(P, 'o login do nexfin quebrou depois do deploy');
  P.sessaoId = 'sess-2';
  await vai;
  await esperar(5);
  assert.deepEqual(JSON.parse(JSON.stringify(c.renomeados.map((r) => [r.id, r.auto]))), [['sess-2', true]]);
});

test('tela: precedencia -- voce renomeia no meio: o seu vence; o aiTitle nao passa por cima do de 3 palavras', async () => {
  let solta;
  const c = tela({ aiTitle: 'Titulo do CLI' });
  c.definirResposta(() => new Promise((r) => { solta = r; }));
  const P = painel({ sessaoId: 'sess-3' });
  const vai = c.iniciarTituloAuto(P, 'preciso de um relatorio do meta ads do mes');
  await esperar(2);
  // enquanto o nome esta' chegando a releitura do aiTitle espera (nao troca)
  await c.buscarNome(P);
  assert.notEqual(P.titulo, 'Titulo do CLI');
  clearTimeout(P.timerNome);
  P.titulo = 'Relatorio do Hugo'; P.nomeManual = true;   // renomeou a mao
  solta({ titulo: 'Relatório Meta Ads', motivo: 'ok' });
  await vai;
  assert.equal(P.titulo, 'Relatorio do Hugo', 'o nome que voce deu vence');
  assert.ok(!P.tituloAuto);
  assert.equal(c.renomeados.filter((r) => r.auto).length, 0, 'nada automatico gravado por cima');

  const c2 = tela({ aiTitle: 'Titulo do CLI' });
  const Q = painel({ sessaoId: 'sess-4' });
  await c2.iniciarTituloAuto(Q, 'preciso de um relatorio do meta ads do mes');
  await c2.buscarNome(Q);
  assert.equal(Q.titulo, 'Campanha Remarketing Meta', 'releitura do aiTitle nao sobrescreve o de 3 palavras');
  clearTimeout(Q.timerNome);
});

test('tela: fallback -- sem Claude/sem conta/torto fica o resumo cru de 3 palavras, e o aiTitle ainda pode chegar', async () => {
  const c = tela({ respostaTitulo: async () => ({ titulo: '', motivo: 'sem-claude' }), aiTitle: 'Titulo Do Claude Code' });
  const P = painel({ sessaoId: 'sess-5' });
  await c.iniciarTituloAuto(P, 'quero que voce revise todos os clientes e veja quais estao sem trafego');
  assert.ok(P.titulo && P.titulo.split(' ').length <= 3, P.titulo);
  assert.equal(P.tituloAuto, undefined);
  assert.equal(c.renomeados.length, 0, 'resumo cru nao se grava (e do motor, nao do Cockpit)');
  assert.equal(c.podeGerarTituloAuto(P, 'outra'), false, 'uma chamada por conversa, mesmo falhando');
  await c.buscarNome(P);
  assert.equal(P.titulo, 'Titulo Do Claude Code', 'sem o de 3 palavras, o aiTitle ainda vence o resumo cru');
  clearTimeout(P.timerNome);

  const c2 = tela({ respostaTitulo: async () => { throw new Error('ipc caiu'); } });
  const Q = painel();
  await c2.iniciarTituloAuto(Q, 'arruma o rodape da pagina de vendas');
  assert.ok(Q.titulo.length > 0 && !Q.tituloAuto);
  assert.equal(c2.tituloCurto3('link https://x.com/a/b so'), 'Link so');
});

test('tela: o painel virou outra conversa no meio -- o nome atrasado nao cai na conversa nova', async () => {
  let solta;
  const c = tela();
  c.definirResposta(() => new Promise((r) => { solta = r; }));
  const P = painel();
  const vai = c.iniciarTituloAuto(P, 'preciso subir uma campanha de remarketing');
  c.esquecerTituloAuto(P); P.titulo = '';   // "Nova conversa" / abriu outra da lista
  solta({ titulo: 'Campanha Remarketing Meta', motivo: 'ok' });
  await vai;
  assert.equal(P.titulo, '');
  assert.equal(c.podeGerarTituloAuto(P, 'conversa nova de verdade'), true, 'a conversa nova pode ganhar o nome dela');
});

test('tela: ramo de conversa com nome do Cockpit fica "(ramo) <esse nome>" e o aiTitle herdado nao passa por cima', async () => {
  const c = tela({ aiTitle: 'Titulo herdado da origem' });
  c.newPane = (o) => ({ id: 'r1', engine: o.engine, el: {}, hist: [], titulo: o.titulo, resumeId: o.resumeId, sessaoId: null });
  vm.runInContext(funcao('novoPainelRamo'), c);
  const origem = painel({ titulo: 'Campanha Remarketing Meta', tituloAuto: true, sessaoId: 's-orig' });
  const R = c.novoPainelRamo(origem, { resumeId: 's-orig', fork: true });
  assert.equal(R.titulo, '(ramo) Campanha Remarketing Meta');
  assert.equal(R.tituloAuto, true);
  assert.equal(c.podeGerarTituloAuto(R, 'mensagem no ramo'), false, 'ramo nunca pede nome');
  R.sessaoId = 's-ramo'; R.forkPendente = false;
  await c.buscarNome(R);
  assert.equal(R.titulo, '(ramo) Campanha Remarketing Meta', 'o aiTitle herdado no arquivo nao troca o nome');
  // origem sem nome do Cockpit: comportamento de antes (o aiTitle ainda assume, com a marca de ramo)
  const R2 = c.novoPainelRamo(painel({ titulo: 'Resumo cru aqui' }), { resumeId: 's-o2', fork: true });
  assert.ok(!R2.tituloAuto);
  R2.sessaoId = 's-r2';
  await c.buscarNome(R2);
  assert.equal(R2.titulo, '(ramo) Titulo herdado da origem');
  clearTimeout(R2.timerNome);
  const lista = funcao('ramificarDaLista');
  assert.match(lista, /tituloAuto: !!\(s\.tituloAuto \|\| s\.nome\)/, 'pela lista tambem');
});

test('tela: send() decide antes do userMsg e "continue"/"/" nao viram nome', () => {
  const s = funcao('send');
  const iPode = s.indexOf('podeGerarTituloAuto(P, text)');
  const iUser = s.indexOf('userMsg(P, text, anexos)');
  assert.ok(iPode > 0 && iPode < iUser, 'decide antes do userMsg (ele poe a mensagem no historico)');
  assert.match(s, /if \(nomeAuto\) iniciarTituloAuto\(P, text\);/);
  assert.match(s, /!soComandoOuContinue\(text\)\) \{ P\.titulo = tituloCurto\(text\)/);
  // fila (painel ocupado) sai antes: 2 Enter rapidos nao chegam ao pedido de nome
  assert.ok(s.indexOf('if (P.busy || P.ligando)') < iPode);
});

test('tela: restaurar traz de onde veio o nome; reabrir pela lista e "Nova conversa" zeram o automatico', () => {
  const r = trecho('restaurarPaineisMiolo');
  assert.match(r, /P\.nomeManual = !!s\.nomeManual; P\.tituloAuto = !P\.nomeManual && !!s\.tituloAuto;/);
  const o = funcao('openSession');
  assert.match(o, /esquecerTituloAuto\(P\); P\.tituloAuto = !P\.nomeManual && !!s\.tituloAuto;/);
  const qtd = (APP.match(/esquecerTituloAuto\(P\);/g) || []).length;
  assert.ok(qtd >= 3, 'openSession + trocar de pasta + nova conversa: ' + qtd);
  assert.match(funcao('renomearAqui'), /P\.nomeManual = true; P\.tituloAuto = false;/);
  assert.match(funcao('pintarNome'), /Nome dado pelo Cockpit/);
});

/* ---------- o rascunho que ficava com 0px (achado da B4) ---------- */
test('rascunho: campo medido fora da tela nao fica com 0px e e medido de novo ao entrar na tela', () => {
  const ini = APP.indexOf('const grow = () =>');
  const fim = APP.indexOf('}).observe(inp);', ini);
  assert.ok(ini > 0 && fim > ini, 'bloco do grow/observador no newPane');
  const bloco = APP.slice(ini, APP.indexOf('\n', fim));
  const obs = [];
  // textarea falso: fora da tela scrollHeight/clientWidth sao 0
  const inp = { style: { height: '' }, value: 'rascunho guardado de 3 linhas\nlinha 2\nlinha 3', naTela: false, ouvintes: {},
    get scrollHeight() { return this.naTela ? 66 : 0; }, get clientWidth() { return this.naTela ? 480 : 0; },
    addEventListener(ev, fn) { this.ouvintes[ev] = fn; } };
  const ctx = vm.createContext({ inp, Math, obs, ResizeObserver: class { constructor(fn) { this.fn = fn; obs.push(this); } observe() {} } });
  vm.runInContext(bloco + '\n}', ctx);
  // restaurado fora da tela: o grow (via 'input' ou chamado direto) nao pode deixar 0px
  inp.ouvintes.input();
  assert.notEqual(inp.style.height, '0px', 'fora da tela fica a altura natural, nao 0px');
  assert.equal(inp.style.height, 'auto');
  obs[0].fn();   // o observador acorda com largura 0 (ainda fora)
  assert.equal(inp.style.height, 'auto');
  inp.naTela = true; obs[0].fn();   // entrou na coluna
  assert.equal(inp.style.height, '66px', 'mediu de novo ao ganhar largura');
  inp.style.height = '66px'; obs[0].fn();
  assert.equal(inp.style.height, '66px', 'mesma largura: nao mede de novo (sem laco)');

  const rest = trecho('restaurarPaineisMiolo');
  assert.match(rest, /campo\.style\.height = 'auto'; if \(campo\.scrollHeight\) campo\.style\.height = Math\.min\(campo\.scrollHeight, 190\) \+ 'px';/,
    'a restauracao so mede quando da pra medir');
});
