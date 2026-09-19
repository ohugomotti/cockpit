'use strict';
/* Leva 41 (B1): a conta do Claude numa aba de SERVIDOR mora no servidor.

   Aqui o main.js roda DE VERDADE (Electron falso, como o testes/teste-contas.js)
   e o "servidor" e' um sh local numa HOME temporaria: todo spawn de ssh que
   carrega um comando ("-- <script>") roda esse script no sh, com HOME e PATH do
   servidor de mentira -- inclusive um 'claude' falso. Assim os scripts que vao
   pra VPS sao exercitados de verdade, e da' pra provar que NADA toca o arquivo
   de credencial do PC quando o pedido vem com 'remoto'. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const cpReal = require('node:child_process');

function acharSh() {
  const lista = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\usr\\bin\\sh.exe', 'C:\\Program Files\\Git\\bin\\sh.exe',
       'C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe']
    : ['/bin/sh'];
  return lista.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
const SH = acharSh();

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-contas-remoto-'));
const HOME_PC = path.join(RAIZ, 'pc');
const USERDATA = path.join(RAIZ, 'userData');
const HOME_VPS = path.join(RAIZ, 'vps');
const BIN_VPS = path.join(RAIZ, 'vps-bin');
for (const d of [path.join(HOME_PC, '.claude'), USERDATA, path.join(HOME_VPS, '.claude'), BIN_VPS]) fs.mkdirSync(d, { recursive: true });

const CRED_PC = path.join(HOME_PC, '.claude', '.credentials.json');
const CRED_VPS = path.join(HOME_VPS, '.claude', '.credentials.json');
const CONTAS_VPS = path.join(HOME_VPS, '.cockpit-contas');
const TXT_PC = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-PC-nao-mexer', refreshToken: 'rPC' } });
fs.writeFileSync(CRED_PC, TXT_PC);
/* formato medido na VPS: o "mcpOAuth" (um accessToken por conector) vem ANTES
   da conta. O token certo e' o de dentro do "claudeAiOauth". */
const credVps = (tok, espacos) => JSON.stringify({
  mcpOAuth: { 'notion|abc': { serverName: 'notion', accessToken: 'TOKEN-DO-CONECTOR', clientId: 'c' } },
  claudeAiOauth: { accessToken: tok, refreshToken: 'r-' + tok, expiresAt: 1, scopes: ['user:inference', 'user:profile'] },
}, null, espacos);

// o 'claude' do servidor: responde o status que o teste deixar em $HOME/.status.json
fs.writeFileSync(path.join(BIN_VPS, 'claude'),
  '#!/bin/sh\necho "$*" >> "$HOME/.claude-chamado"\nif [ "$1 $2" = "auth status" ]; then cat "$HOME/.status.json"; fi\n');
try { fs.chmodSync(path.join(BIN_VPS, 'claude'), 0o755); } catch {}
/* o $SHELL do servidor: aceita o "-lc" mas nao le o /etc/profile (no Git Bash
   isso custa ~1s por chamada e nao prova nada aqui) */
const SHELL_DO_SERVIDOR = path.join(BIN_VPS, 'shell-login');
fs.writeFileSync(SHELL_DO_SERVIDOR, '#!/bin/sh\nshift\nexec /bin/sh -c "$1"\n');
try { fs.chmodSync(SHELL_DO_SERVIDOR, 0o755); } catch {}
const statusVps = (o) => fs.writeFileSync(path.join(HOME_VPS, '.status.json'), JSON.stringify(o));

const REMOTO = { host: 'vps.exemplo', usuario: 'hugo', chave: 'C:\\chaves\\vps', caminhoRemoto: '~' };

/* ---- spawn falso: ssh com comando vira sh no "servidor"; o resto e' anotado ---- */
const spawns = [];
function spawnFalso(bin, args, opts) {
  const nome = path.basename(String(bin)).toLowerCase();
  const lista = Array.isArray(args) ? args.slice() : [];
  spawns.push({ bin: String(bin), args: lista });
  if (/^ssh(\.exe)?$/.test(nome)) {
    const i = lista.indexOf('--');
    // sonda de multiplexing (-V, -O check): sem resposta, o main fica no modo simples
    const script = i >= 0 ? lista[i + 1] : 'exit 0';
    const env = { ...process.env, HOME: HOME_VPS, SHELL: SHELL_DO_SERVIDOR, PATH: BIN_VPS + path.delimiter + process.env.PATH };
    delete env.CLAUDE_CONFIG_DIR;
    return cpReal.spawn(SH, ['-c', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  // nada de verdade roda neste PC (nem claude, nem codex): so' fica anotado
  return cpReal.spawn(SH, ['-c', 'exit 127'], { stdio: ['pipe', 'pipe', 'pipe'] });
}
// claude chamado NESTE PC: pelo binario ou pelo cmd.exe que sobe o claude.cmd
const spawnsDeClaudeLocal = () => spawns.filter((s) => !/^ssh(\.exe)?$/i.test(path.basename(s.bin))
  && (/claude/i.test(path.basename(s.bin)) || /claude/i.test(s.args.join(' '))));

/* ---- fetch falso: a API de uso. Guarda o token que chegou ---- */
const fetches = [];
globalThis.fetch = async (url, o) => {
  fetches.push({ url: String(url), auth: o && o.headers && o.headers.Authorization });
  return { ok: true, json: async () => ({ five_hour: { utilization: 42, resets_at: '2026-09-14T20:00:00Z' }, seven_day: { utilization: 7 } }) };
};

/* ---- Electron falso + carga do main de verdade ---- */
const handlers = new Map();
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME_PC),
    whenReady: () => new Promise(() => {}),
    on() {}, setName() {}, quit() {}, disableHardwareAcceleration() {},
    requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
    isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: class { constructor() {} static getAllWindows() { return []; } on() {} loadFile() {} },
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: () => '', writeText() {} },
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
  crashReporter: { start() {} },
};
let carregou = null;
if (SH) {
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (nome) {
    if (nome === 'electron') return eletronFalso;
    if (nome === 'os') {
      const real = requireOriginal.call(this, 'os');
      return new Proxy(real, { get: (alvo, k) => (k === 'homedir' ? () => HOME_PC : alvo[k]) });
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
const pular = !SH ? 'sem sh nesta máquina' : false;
const chamar = (canal, arg) => {
  if (carregou !== true) throw carregou;
  const h = handlers.get(canal);
  if (!h) throw new Error('handler ausente: ' + canal);
  return h({}, arg);
};
const pcIntacto = () => {
  assert.equal(fs.readFileSync(CRED_PC, 'utf8'), TXT_PC, 'a credencial do PC foi tocada');
  const guardadasPc = fs.existsSync(path.join(USERDATA, 'contas')) ? fs.readdirSync(path.join(USERDATA, 'contas')) : [];
  assert.deepEqual(guardadasPc, [], 'guardou conta na pasta do PC');
};

test.after(() => { try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {} });

/* ---- a tela: de ONDE e' a conta, quem para na troca, tarja de login ---- */
const vm = require('node:vm');
const { pegarBloco, globaisFalsos } = require('../testes/raiz');
const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const linhaDoApp = (inicio) => {
  const l = APP.split('\n').find((x) => x.startsWith(inicio));
  assert.ok(l, 'nao achei no app.js: ' + inicio);
  return l.replace(/^const /, 'var ');
};
function telaDeContas(extras) {
  const abas = [
    { id: 'pc', nome: 'PC inteiro', tipo: 'local' },
    { id: 'vps', nome: 'VPS', tipo: 'ssh', host: '203.0.113.10', usuario: 'hugo', chave: 'C:\\k', caminhoRemoto: '~' },
    { id: 'outro', nome: 'Outro', tipo: 'ssh', host: 'outro.host', usuario: 'root', chave: 'C:\\k2' },
  ];
  const chamadas = [];
  const ctx = {
    ...globaisFalsos(), console,
    cfg: { abas, abaAtiva: 'pc' }, ESTE_PC: 'PC',
    panes: new Map(), panesFundo: new Map(), focusPane: null,
    avisos: [], confirmar: true,
    confirm: () => ctx.confirmar,
    mostrarAviso: (o) => ctx.avisos.push(o),
    setFocus: (P) => { ctx.focusPane = P; },
    contaAcao: (P, acao) => chamadas.push('contaAcao:' + P.id + ':' + acao),
    destravarPainel: () => {}, setDot: () => {},
    window: { api: { paneStop: async ({ paneId }) => { chamadas.push('stop:' + paneId); return true; } } },
    chamadas,
    ...(extras || {}),
  };
  vm.createContext(ctx);
  const codigo = [
    pegarBloco(APP, 'function abasLocais(', 'abasLocais'), pegarBloco(APP, 'function abaPorId(', 'abaPorId'),
    pegarBloco(APP, 'function abaAtual(', 'abaAtual'), pegarBloco(APP, 'function remotoDoAba(', 'remotoDoAba'),
    linhaDoApp('const CONTA_NO_SERVIDOR = '), pegarBloco(APP, 'function servidorDaConta(', 'servidorDaConta'),
    linhaDoApp('const chaveDoLugar = '), pegarBloco(APP, 'function lugarDaConta(', 'lugarDaConta'),
    linhaDoApp('const lugarDaContaAtiva = '), linhaDoApp('const lugarDaContaDoPainel = '),
    pegarBloco(APP, 'function pedidoDeConta(', 'pedidoDeConta'), pegarBloco(APP, 'function paineisDaConta(', 'paineisDaConta'),
    pegarBloco(APP, 'function painelParaConta(', 'painelParaConta'), pegarBloco(APP, 'function semPainelDaConta(', 'semPainelDaConta'),
    'async ' + pegarBloco(APP, 'function pararPaineisDaConta(', 'pararPaineisDaConta'),
    // auditoria 2: parar os debates da conta e o recado do religar cancelado
    linhaDoApp('const MOTOR_DO_DEBATE = '), pegarBloco(APP, 'function antesDaTroca(', 'antesDaTroca'), pegarBloco(APP, 'function avisarTroca(', 'avisarTroca'),
    linhaDoApp('const PEDE_LOGIN = '), linhaDoApp('const pedeLogin = '),
    pegarBloco(APP, 'function avisarLoginDoServidor(', 'avisarLoginDoServidor'),
  ].join('\n');
  vm.runInContext(codigo, ctx);
  const painel = (id, engine, abaId, extra) => ({ id, engine, abaId, started: true, busy: false, morto: false, sessaoId: 's-' + id, ...(extra || {}) });
  return { ctx, chamadas, painel };
}

test('a conta do Claude numa aba de servidor é a do servidor; a dos outros motores é sempre do PC', () => {
  const { ctx } = telaDeContas();
  const vps = ctx.abaPorId('vps');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.lugarDaConta('claude', vps))),
    { remoto: { host: '203.0.113.10', usuario: 'hugo', chave: 'C:\\k', caminhoRemoto: '~' }, chave: 'hugo@203.0.113.10', rotulo: 'VPS · hugo@203.0.113.10' });
  assert.equal(ctx.lugarDaConta('codex', vps).chave, 'pc');
  assert.equal(ctx.lugarDaConta('claude', ctx.abaPorId('pc')).rotulo, 'PC');
  // a lateral segue a aba ATIVA
  assert.equal(ctx.lugarDaContaAtiva('claude').chave, 'pc');
  ctx.cfg.abaAtiva = 'vps';
  assert.equal(ctx.lugarDaContaAtiva('claude').chave, 'hugo@203.0.113.10');
  // pedido: sem servidor e' o formato antigo (so' o motor)
  assert.equal(ctx.pedidoDeConta('claude', ctx.lugarDaConta('claude', ctx.abaPorId('pc'))), 'claude');
  assert.equal(ctx.pedidoDeConta('claude', ctx.lugarDaConta('claude', vps), { apelido: 'x' }).remoto.host, '203.0.113.10');
});

test('trocar a conta do PC não derruba painel da VPS; trocar a da VPS só mexe nos daquele usuario@host', async () => {
  const { ctx, chamadas, painel } = telaDeContas();
  const pcClaude = painel('p1', 'claude', 'pc'), pcCodex = painel('p2', 'codex', 'pc');
  const vps1 = painel('p3', 'claude', 'vps'), vpsFundo = painel('p4', 'claude', 'vps');
  const outro = painel('p5', 'claude', 'outro');
  for (const P of [pcClaude, pcCodex, vps1]) ctx.panes.set(P.id, P);
  for (const P of [vpsFundo, outro]) ctx.panesFundo.set(P.id, P);
  const rPc = await ctx.pararPaineisDaConta('claude', ctx.lugarDaConta('claude', ctx.abaPorId('pc')));
  assert.equal(rPc, 1);
  assert.deepEqual(chamadas.splice(0), ['stop:p1']);
  assert.equal(pcClaude.resumeId, 's-p1');
  assert.equal(vps1.started, true, 'painel da VPS foi derrubado pela troca do PC');
  const rVps = await ctx.pararPaineisDaConta('claude', ctx.lugarDaConta('claude', ctx.abaPorId('vps')));
  assert.equal(rVps, 2);
  assert.deepEqual(chamadas.splice(0), ['stop:p3', 'stop:p4']);
  assert.equal(outro.started, true, 'mexeu no painel de outro servidor');
});

test('painel trabalhando só para com o seu ok', async () => {
  const { ctx, chamadas, painel } = telaDeContas();
  const ocupado = painel('p1', 'claude', 'vps', { busy: true });
  ctx.panes.set('p1', ocupado);
  ctx.confirmar = false;
  assert.equal(await ctx.pararPaineisDaConta('claude', ctx.lugarDaConta('claude', ctx.abaPorId('vps'))), null);
  assert.deepEqual(chamadas, [], 'parou sem perguntar');
  ctx.confirmar = true;
  assert.equal(await ctx.pararPaineisDaConta('claude', ctx.lugarDaConta('claude', ctx.abaPorId('vps'))), 1);
  assert.deepEqual(chamadas, ['stop:p1']);
});

test('"Entrar com outra conta" escolhe painel do motor e do lugar certos, não o foco cego', () => {
  const { ctx, painel } = telaDeContas();
  const codexEmFoco = painel('p1', 'codex', 'vps'), claudeVps = painel('p2', 'claude', 'vps');
  ctx.panes.set('p1', codexEmFoco); ctx.panes.set('p2', claudeVps);
  ctx.focusPane = codexEmFoco;
  assert.equal(ctx.painelParaConta('claude', 'hugo@203.0.113.10'), claudeVps);
  assert.equal(ctx.painelParaConta('claude', 'pc'), null, 'um painel da VPS nao serve pra conta do PC');
  // painel de segundo plano nao serve: o terminal de login abre DENTRO do painel visivel
  ctx.panes.delete('p2'); ctx.panesFundo.set('p2', claudeVps);
  assert.equal(ctx.painelParaConta('claude', 'hugo@203.0.113.10'), null);
});

/* Leva 41 (B2, item 5 do adendo): o painel DESTE PC tambem ganhou tarja propria
   ("Entrar de novo", que abre o login daqui). Antes da B2 este teste provava
   que no PC nao saia tarja nenhuma. */
test('erro de login num painel do servidor vira tarja "Entrar na conta da VPS"; no PC, "Entrar de novo" daqui', () => {
  const { ctx, chamadas, painel } = telaDeContas({ nomeDoMotor: () => 'Claude' });
  for (const t of ['Not logged in · Please run /login', 'Invalid API key · Please run /login',
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
    'OAuth session expired, sign in again']) assert.ok(ctx.pedeLogin(t), t);
  for (const t of ['A conexão caiu.', 'crie a página de login do site', '', undefined]) assert.ok(!ctx.pedeLogin(t), String(t));
  const vps = painel('p1', 'claude', 'vps'), pc = painel('p2', 'claude', 'pc');
  ctx.panes.set('p1', vps); ctx.panes.set('p2', pc);
  assert.equal(ctx.avisarLoginDoServidor(pc, 'A conexão caiu.'), false, 'sem erro de conta, sem tarja');
  assert.equal(ctx.avisos.length, 0);
  assert.equal(ctx.avisarLoginDoServidor(pc, 'Not logged in · Please run /login'), true);
  const local = ctx.avisos[0];
  assert.equal(local.acao, 'Entrar de novo');
  assert.match(local.texto, /neste PC/);
  assert.doesNotMatch(local.texto, /VPS|servidor/);
  local.aoClicar();
  assert.deepEqual(chamadas, ['contaAcao:p2:login'], 'o login e o deste PC, no painel certo');
  assert.equal(ctx.avisarLoginDoServidor(vps, 'Not logged in · Please run /login'), true);
  const av = ctx.avisos[1];
  assert.equal(av.acao, 'Entrar na conta da VPS');
  assert.match(av.texto, /hugo@203\.0\.113\.10/);
  av.aoClicar();
  assert.deepEqual(chamadas, ['contaAcao:p2:login', 'contaAcao:p1:login']);
});

test('contaAcao numa aba de servidor pede o login/logout DO SERVIDOR (e o logout pergunta antes)', async () => {
  const auths = [];
  const { ctx, painel } = telaDeContas({
    note: () => {}, avisoTemp: () => {}, janelaTerminal: () => {}, nomeDoMotor: () => 'Claude',
    AVISO_ABA_EM_BRANCO: 'em branco', faltaConfigurarServidor: (r) => !!r && (!r.usuario || !r.host),
  });
  ctx.window.api.auth = async (o) => { auths.push(o); return { terminal: 'ssh ...', titulo: 't' }; };
  vm.runInContext('async ' + pegarBloco(APP, 'function contaAcao(', 'contaAcao'), ctx);
  const vps = painel('p1', 'claude', 'vps'), pc = painel('p2', 'claude', 'pc');
  await ctx.contaAcao(vps, 'login');
  assert.equal(auths[0].remoto.host, '203.0.113.10');
  await ctx.contaAcao(pc, 'login');
  assert.equal(auths[1].remoto, undefined, 'o login do PC ganhou remoto');
  ctx.confirmar = false;
  await ctx.contaAcao(vps, 'logout');
  assert.equal(auths.length, 2, 'saiu da conta do servidor sem perguntar');
  ctx.confirmar = true;
  await ctx.contaAcao(vps, 'logout');
  assert.equal(auths[2].acao, 'logout');
  assert.equal(auths[2].remoto.usuario, 'hugo');
});

/* ---- os comandos em si (modulo puro) ---- */
const cr = require('../src/cockpit-contas-remoto');

test('nome do arquivo guardado não carrega caractere de shell e volta pro apelido', () => {
  for (const apelido of ["d'avó (2)", 'a;b|c&d', '$(rm -rf ~)', 'trabalho', '`x`', 'ç~!*']) {
    const n = cr.nomeDoArquivo(apelido);
    assert.match(n, /^claude__[A-Za-z0-9%._~-]+\.json$/, n);
    assert.equal(cr.apelidoDoArquivo(n), apelido);
  }
  assert.equal(cr.apelidoDoArquivo('../../etc/passwd'), null);
  assert.equal(cr.apelidoDoArquivo('claude__x.json.bak'), null);
});

test('lerConta separa status e token, e explica quando o claude não existe no servidor', () => {
  const ok = cr.lerConta('COCKPIT_STATUS\n{"loggedIn": true, "email": "a@b"}\n\nCOCKPIT_TOKEN\n"accessToken": "sk-ant-oat01-XYZ"\n');
  assert.deepEqual(ok.status, { loggedIn: true, email: 'a@b' });
  assert.equal(ok.token, 'sk-ant-oat01-XYZ');
  const sem = cr.lerConta('COCKPIT_STATUS\nsh: 1: claude: not found\n\nCOCKPIT_TOKEN\n');
  assert.equal(sem.status, null);
  assert.equal(sem.token, '');
  assert.match(sem.motivo, /Não achei o programa claude/);
});

test('linha do login no servidor: Windows (cmd) e Mac (sh) não expandem o $SHELL aqui', () => {
  const r = { host: '203.0.113.10', usuario: 'hugo', chave: 'C:\\Users\\hugom\\.ssh\\chave_vps' };
  assert.equal(cr.linhaTerminal(r, 'login', true),
    'ssh -t -i "C:\\Users\\hugom\\.ssh\\chave_vps" -o StrictHostKeyChecking=accept-new hugo@203.0.113.10 "exec ${SHELL:-/bin/sh} -lc \'claude auth login\'"');
  assert.equal(cr.linhaTerminal({ ...r, chave: '/Users/h/.ssh/k' }, 'logout', false),
    "ssh -t -i '/Users/h/.ssh/k' -o StrictHostKeyChecking=accept-new hugo@203.0.113.10 'exec ${SHELL:-/bin/sh} -lc '\\''claude auth logout'\\'''");
  assert.equal(cr.linhaTerminal(r, 'status', true), null, 'status nao e interativo');
  assert.equal(cr.linhaTerminal({ ...r, host: '-oProxyCommand=x' }, 'login', true), null);
  assert.equal(cr.linhaTerminal({ ...r, chave: 'C:\\%TEMP%\\k' }, 'login', true), null);
});

test('pasta de contas e credencial parametrizáveis (a prova usa uma pasta do mktemp)', () => {
  const s = cr.scriptTrocar('x', { pasta: '/tmp/tmp.AB/contas', cred: "/tmp/tmp.AB/c'red/.credentials.json" });
  assert.ok(s.startsWith("D='/tmp/tmp.AB/contas'; C='/tmp/tmp.AB/c'\\''red/.credentials.json'; "), s);
  assert.ok(cr.scriptListar().startsWith('D="$HOME/.cockpit-contas"; C="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"; '));
  for (const sc of [cr.scriptListar(), cr.scriptSalvar('a'), cr.scriptTrocar('a'), cr.scriptEsquecer('a'), cr.scriptDisponivel(), cr.scriptConta(), cr.scriptStatus()]) {
    assert.match(sc, /exit 0$/, 'script sem "exit 0" no fim vira falha de conexao no execRemoto: ' + sc);
  }
});

test('guardar e listar contas NO SERVIDOR, sem tocar no PC', { skip: pular }, async () => {
  fs.writeFileSync(CRED_VPS, credVps('sk-vps-TRABALHO'));
  const r1 = await chamar('contas:salvar', { engine: 'claude', apelido: 'trabalho', remoto: REMOTO });
  assert.deepEqual(r1, { ok: true });
  fs.writeFileSync(CRED_VPS, credVps('sk-vps-PESSOAL'));
  const r2 = await chamar('contas:salvar', { engine: 'claude', apelido: "d'avó (2)", remoto: REMOTO });
  assert.deepEqual(r2, { ok: true });
  const arquivos = fs.readdirSync(CONTAS_VPS).sort();
  assert.equal(arquivos.length, 2, JSON.stringify(arquivos));
  assert.ok(arquivos.every((f) => /^claude__[A-Za-z0-9%._~-]+\.json$/.test(f)), 'nome com caractere perigoso: ' + arquivos);
  assert.equal(fs.readFileSync(path.join(CONTAS_VPS, 'claude__trabalho.json'), 'utf8'), credVps('sk-vps-TRABALHO'));
  const lista = await chamar('contas:listar', { engine: 'claude', remoto: REMOTO });
  assert.deepEqual(lista, [{ apelido: "d'avó (2)", atual: true }, { apelido: 'trabalho', atual: false }]);
  assert.ok(!fs.readdirSync(CONTAS_VPS).some((f) => f.startsWith('.')), 'sobrou temporario na pasta do servidor');
  pcIntacto();
  assert.deepEqual(spawnsDeClaudeLocal(), [], 'rodou claude local');
});

test('guardar sem conta logada no servidor devolve recado', { skip: pular }, async () => {
  const antes = fs.readFileSync(CRED_VPS, 'utf8');
  fs.writeFileSync(CRED_VPS, '');
  const r = await chamar('contas:salvar', { engine: 'claude', apelido: 'vazia', remoto: REMOTO });
  assert.ok(r.error && /servidor/i.test(r.error), JSON.stringify(r));
  fs.writeFileSync(CRED_VPS, antes);
  const semNome = await chamar('contas:salvar', { engine: 'claude', apelido: '   ', remoto: REMOTO });
  assert.ok(semNome.error, JSON.stringify(semNome));
  pcIntacto();
});

test('trocar no servidor troca o arquivo do servidor; o do PC fica intacto', { skip: pular }, async () => {
  const r = await chamar('contas:trocar', { engine: 'claude', apelido: 'trabalho', remoto: REMOTO });
  assert.deepEqual(r, { ok: true });
  assert.equal(fs.readFileSync(CRED_VPS, 'utf8'), credVps('sk-vps-TRABALHO'));
  const lista = await chamar('contas:listar', { engine: 'claude', remoto: REMOTO });
  assert.equal(lista.find((x) => x.apelido === 'trabalho').atual, true);
  assert.ok(!fs.readdirSync(path.dirname(CRED_VPS)).some((f) => /cockpit-troca/.test(f)), 'sobrou temporario da troca');
  pcIntacto();
  assert.deepEqual(spawnsDeClaudeLocal(), []);
});

test('conta corrompida ou sumida no servidor não é aplicada', { skip: pular }, async () => {
  fs.writeFileSync(path.join(CONTAS_VPS, 'claude__quebrada.json'), 'isto nao e json');
  const r = await chamar('contas:trocar', { engine: 'claude', apelido: 'quebrada', remoto: REMOTO });
  assert.ok(r.error && /corromp/i.test(r.error), JSON.stringify(r));
  const r2 = await chamar('contas:trocar', { engine: 'claude', apelido: 'nao-existe', remoto: REMOTO });
  assert.ok(r2.error, JSON.stringify(r2));
  assert.equal(fs.readFileSync(CRED_VPS, 'utf8'), credVps('sk-vps-TRABALHO'));
  pcIntacto();
});

test('esquecer apaga só a cópia guardada no servidor', { skip: pular }, async () => {
  const r = await chamar('contas:esquecer', { engine: 'claude', apelido: 'quebrada', remoto: REMOTO });
  assert.deepEqual(r, { ok: true });
  assert.ok(!fs.existsSync(path.join(CONTAS_VPS, 'claude__quebrada.json')));
  assert.equal(fs.readFileSync(CRED_VPS, 'utf8'), credVps('sk-vps-TRABALHO'));
  const d = await chamar('contas:disponivel', { engine: 'claude', remoto: REMOTO });
  assert.equal(d.ok, true);
  pcIntacto();
});

test('conta:ler remoto lê status e uso do SERVIDOR; o token não vai pra tela; cache por host', { skip: pular }, async () => {
  statusVps({ loggedIn: true, authMethod: 'claude.ai', email: 'vps@exemplo.com', orgName: "Hugo's Organization", subscriptionType: 'max' });
  fetches.length = 0;
  const antesSsh = spawns.length;
  const c = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO });
  assert.equal(c.entrou, true);
  assert.equal(c.email, 'vps@exemplo.com');
  assert.equal(c.nome, 'Hugo');
  assert.equal(c.plano, 'max');
  assert.equal(c.sessao.pct, 42);
  assert.equal(c.semana.pct, 7);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].auth, 'Bearer sk-vps-TRABALHO', 'usou o token errado');
  assert.ok(!JSON.stringify(c).includes('sk-vps'), 'o token vazou pra resposta');
  assert.match(fs.readFileSync(path.join(HOME_VPS, '.claude-chamado'), 'utf8'), /auth status/);
  assert.deepEqual(spawnsDeClaudeLocal(), [], 'leu a conta do PC');
  const sshFeitos = spawns.length - antesSsh;
  // de novo, dentro do prazo: sem ir ao servidor
  const c2 = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO });
  assert.equal(c2.email, 'vps@exemplo.com');
  assert.equal(spawns.length - antesSsh, sshFeitos, 'o cache por host nao segurou');
  // pedido fresco (depois de login/troca): vai de novo
  statusVps({ loggedIn: false });
  const c3 = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
  assert.equal(c3.entrou, false);
  pcIntacto();
});

test('token do limite: o da conta do Claude, nunca o de um conector, mesmo com JSON formatado', { skip: pular }, async () => {
  const antes = fs.readFileSync(CRED_VPS, 'utf8');
  statusVps({ loggedIn: true, email: 'vps@exemplo.com' });
  fs.writeFileSync(CRED_VPS, credVps('sk-vps-FORMATADO', 2));
  fetches.length = 0;
  await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
  assert.deepEqual(fetches.map((f) => f.auth), ['Bearer sk-vps-FORMATADO']);
  fs.writeFileSync(CRED_VPS, JSON.stringify({ mcpOAuth: { x: { accessToken: 'TOKEN-DO-CONECTOR' } } }));
  fetches.length = 0;
  await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
  assert.deepEqual(fetches, [], 'mandou token de conector pra API de uso');
  fs.writeFileSync(CRED_VPS, antes);
});

test('trocar no servidor derruba o cache da conta daquele host', { skip: pular }, async () => {
  statusVps({ loggedIn: true, email: 'antes@exemplo.com' });
  await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
  statusVps({ loggedIn: true, email: 'depois@exemplo.com' });
  assert.deepEqual(await chamar('contas:trocar', { engine: 'claude', apelido: "d'avó (2)", remoto: REMOTO }), { ok: true });
  const c = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO });
  assert.equal(c.email, 'depois@exemplo.com');
});

test('servidor inválido vira erro com motivo, não "não logado"', { skip: pular }, async () => {
  const c = await chamar('conta:ler', { engine: 'claude', remoto: { ...REMOTO, host: '-oProxyCommand=calc' }, fresco: true });
  assert.equal(c.entrou, false);
  assert.equal(c.erro, true);
  assert.ok(c.motivo, JSON.stringify(c));
});

test('auth:acao remoto: login e logout rodam NO SERVIDOR pelo terminal embutido', { skip: pular }, async () => {
  const r = await chamar('auth:acao', { engine: 'claude', acao: 'login', remoto: REMOTO });
  assert.ok(r.terminal, JSON.stringify(r));
  assert.match(r.terminal, /^ssh -t -i /);
  assert.ok(r.terminal.includes('hugo@vps.exemplo'), r.terminal);
  assert.ok(r.terminal.includes("-lc 'claude auth login'"), r.terminal);
  assert.ok(r.titulo && /servidor|hugo@vps\.exemplo/.test(r.titulo), r.titulo);
  const s = await chamar('auth:acao', { engine: 'claude', acao: 'logout', remoto: REMOTO });
  assert.ok(s.terminal.includes("'claude auth logout'"), s.terminal);
  statusVps({ loggedIn: true, email: 'vps@exemplo.com' });
  const st = await chamar('auth:acao', { engine: 'claude', acao: 'status', remoto: REMOTO });
  assert.match(st.texto, /vps@exemplo\.com/);
  assert.deepEqual(spawnsDeClaudeLocal(), [], 'rodou claude local');
});

test('remoto torto vira erro e NUNCA cai no PC', { skip: pular }, async () => {
  // chave com aspas: pelo execRemoto ela vai como argumento (sem shell, nao
  // injeta nada), mas na LINHA do terminal o cmd.exe rodaria o resto no PC
  const chaveTorta = { ...REMOTO, chave: 'C:\\x" & calc & "' };
  const l0 = await chamar('auth:acao', { engine: 'claude', acao: 'login', remoto: chaveTorta });
  assert.ok(l0.error && !l0.terminal, 'login aceitou chave com aspas -> ' + JSON.stringify(l0));
  const tortos = [
    { ...REMOTO, host: '-oProxyCommand=calc' },
    { ...REMOTO, usuario: 'a b' },
    { host: '', usuario: '', chave: '' },
  ];
  for (const remoto of tortos) {
    const t = await chamar('contas:trocar', { engine: 'claude', apelido: 'trabalho', remoto });
    assert.ok(t.error, 'trocar aceitou ' + JSON.stringify(remoto));
    const l = await chamar('auth:acao', { engine: 'claude', acao: 'login', remoto });
    assert.ok(l.error && !l.terminal, 'login aceitou ' + JSON.stringify(remoto) + ' -> ' + JSON.stringify(l));
    const g = await chamar('contas:salvar', { engine: 'claude', apelido: 'x', remoto });
    assert.ok(g.error, 'guardar aceitou ' + JSON.stringify(remoto));
  }
  pcIntacto();
});

test('só o Claude tem conta no servidor', { skip: pular }, async () => {
  const r = await chamar('contas:trocar', { engine: 'codex', apelido: 'x', remoto: REMOTO });
  assert.ok(r.error, JSON.stringify(r));
  const a = await chamar('auth:acao', { engine: 'codex', acao: 'login', remoto: REMOTO });
  assert.ok(a.error, JSON.stringify(a));
  assert.deepEqual(await chamar('contas:listar', { engine: 'codex', remoto: REMOTO }), []);
});

test('conta:ler do PC continua lendo o limite com o token do PC', { skip: pular || (process.platform !== 'win32' && 'no Mac o token vem do Chaveiro') }, async () => {
  fetches.length = 0;
  const c = await chamar('conta:ler', 'claude');
  assert.deepEqual(fetches.map((f) => f.auth), ['Bearer sk-PC-nao-mexer']);
  assert.equal(c.sessao.pct, 42);
  assert.ok(!JSON.stringify(c).includes('sk-PC'), 'o token do PC vazou pra resposta');
});

test('API de uso com 429: não insiste até o Retry-After', { skip: pular }, async () => {
  const antes = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => { chamadas++; return { ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? '900' : null) } }; };
  try {
    fs.writeFileSync(CRED_VPS, credVps('sk-vps-CASTIGADO'));
    statusVps({ loggedIn: true, email: 'vps@exemplo.com' });
    const c1 = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
    const c2 = await chamar('conta:ler', { engine: 'claude', remoto: REMOTO, fresco: true });
    assert.equal(c1.entrou, true);
    assert.equal(c1.sessao, null);
    assert.equal(c2.sessao, null);
    assert.equal(chamadas, 1, 'insistiu na API depois do 429');
  } finally { globalThis.fetch = antes; }
});

test('sem remoto, os canais continuam no PC (compatível com o formato antigo)', { skip: pular }, async () => {
  assert.deepEqual(await chamar('contas:listar', 'claude'), []);
  assert.deepEqual(await chamar('contas:listar', { engine: 'claude' }), []);
  assert.equal((await chamar('contas:disponivel', 'claude')).ok, process.platform === 'win32');
});
