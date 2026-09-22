'use strict';
/* Leva 41 (B3): ramificar conversa.

   Tres camadas:
   1) ramo-claude.js puro: o "voltar para ca'" do Claude corta o .jsonl ANTES da
      mensagem escolhida e devolve uma cadeia coerente (uuid/parentUuid), com o
      sessionId novo em toda linha -- no mesmo formato que o --fork-session do
      proprio CLI grava (medido no 2.1.270: so' as linhas da cadeia, uuids iguais
      aos da origem, sessionId trocado);
   2) o main.js DE VERDADE (Electron falso): sessao:fork do Claude grava o ramo
      cortado ao lado da origem sem tocar nela; o ramo inteiro no PC nasce com
      --resume + --fork-session + --session-id (o endereco e' conhecido na hora);
      no servidor a linha de comando leva --resume + --fork-session (sem rodar
      Claude nenhum na VPS: o ssh e' falso);
   3) a tela (app.js): "Ramificar em painel novo" pela lista, sem abrir a
      original; o item "Ramificar conversa" do "/" acha por sinonimo; o ramo
      pendente nao e' confundido com religacao (B2) nem com a conversa de origem. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const cpReal = require('node:child_process');

const ORIG = '11111111-2222-4333-8444-555555555555';
const NOVO = '99999999-8888-4777-8666-555555555555';

/* ---------- uma conversa sintetica no formato real do CLI ----------
   Sequencia medida em conversas de verdade desta maquina (so' as chaves, sem
   conteudo): queue-operation antes do envio; anexos de hook ANTES da fala
   (hook_success/hook_additional_context, na cadeia); anexos depois; o
   assistant aponta pro ultimo anexo; last-prompt/ai-title/mode/atis-latch sem
   uuid; prompt_snapshot fecha o turno. */
function conversa(sid, extra) {
  const L = [];
  let ultimo = null, n = 0;
  const base = (tipo, o) => {
    const uuid = 'u' + String(++n).padStart(3, '0');
    const d = { parentUuid: ultimo, isSidechain: false, type: tipo, uuid, timestamp: '2026-09-14T10:00:' + String(n).padStart(2, '0') + 'Z', cwd: 'C:\\proj', sessionId: sid, version: '2.1.270', ...o };
    L.push(d); ultimo = uuid; return d;
  };
  const meta = (o) => L.push({ ...o, sessionId: sid });
  const turno = (pergunta, resposta, comHook) => {
    meta({ type: 'queue-operation', operation: 'enqueue', timestamp: 't', content: pergunta });
    meta({ type: 'queue-operation', operation: 'dequeue', timestamp: 't' });
    if (comHook) {
      base('attachment', { attachment: { type: 'hook_success', hookName: 'UserPromptSubmit' } });
      base('attachment', { attachment: { type: 'hook_additional_context', content: ['contexto do hook sobre: ' + pergunta] } });
    }
    base('user', { promptId: 'pid-' + n, message: { role: 'user', content: pergunta }, promptSource: 'sdk' });
    base('attachment', { attachment: { type: 'total_tokens_reminder' } });
    base('assistant', { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'pensando' }] } });
    base('assistant', { message: { role: 'assistant', content: [{ type: 'text', text: resposta }] } });
    base('attachment', { attachment: { type: 'prompt_snapshot' } });
    meta({ type: 'last-prompt', lastPrompt: pergunta, leafUuid: ultimo });
    meta({ type: 'ai-title', aiTitle: 'Cofre e portao' });
  };
  turno('A senha do cofre é ABACAXI-7', 'Anotado: cofre.', true);
  turno('A cor do portão é VIOLETA', 'Anotado: portão.', true);
  if (extra) extra({ base, meta, turno, getUltimo: () => ultimo, setUltimo: (u) => { ultimo = u; } });
  turno('O nome do gato é BISCOITO', 'Anotado: gato.', true);
  return L.map((d) => JSON.stringify(d)).join('\n') + '\n';
}
const linhas = (texto) => texto.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const falaDe = (d) => d.type === 'user' && typeof d.message.content === 'string' ? d.message.content : '';

/* a cadeia do ramo tem que fechar: todo pai existe e vem antes; uma raiz so'
   (ou uma por compactacao); nenhum anexo do envio cortado; sessionId novo */
function conferirCadeia(texto, idNovo) {
  const L = linhas(texto);
  const vistos = new Set();
  let raizes = 0;
  for (const d of L) {
    assert.equal(d.sessionId, idNovo, 'toda linha leva o sessionId novo');
    assert.ok(d.uuid, 'o ramo leva so' + "' linhas da cadeia (com uuid)");
    if (d.parentUuid == null) raizes++;
    else assert.ok(vistos.has(d.parentUuid), 'pai ' + d.parentUuid + ' tem que vir antes');
    vistos.add(d.uuid);
  }
  return { L, raizes };
}

/* =====================================================================
   1) ramo-claude.js puro
   ===================================================================== */
let ramo = null;
try { ramo = require('../src/ramo-claude'); } catch (e) { ramo = e; }
const tec = (t) => /^<(command-name|local-command-stdout)>/.test(String(t).trim());
const semCtx = (t) => { const i = t.indexOf('Agora, o novo pedido:'); return i >= 0 ? t.slice(i + 21).trim() : t; };
const cortar = (bruto, o) => ramo.cortarConversa(bruto, { idVelho: ORIG, idNovo: NOVO, ehTecnico: tec, semContexto: semCtx, ...o });

test('ramo-claude.js existe e exporta cortarConversa', () => {
  assert.ok(!(ramo instanceof Error), String(ramo && ramo.message));
  assert.equal(typeof ramo.cortarConversa, 'function');
});

test('corte pelo texto: fica tudo ANTES da mensagem, sem ela, sem a resposta e sem os anexos de hook dela', () => {
  const r = cortar(conversa(ORIG), { alvo: 'O nome do gato é BISCOITO', repetidasDepois: 0, doFim: 1 });
  assert.ok(r.texto, JSON.stringify(r));
  const { L, raizes } = conferirCadeia(r.texto, NOVO);
  assert.equal(raizes, 1);
  const tudo = r.texto;
  assert.match(tudo, /ABACAXI-7/); assert.match(tudo, /VIOLETA/); assert.match(tudo, /Anotado: portão/);
  assert.doesNotMatch(tudo, /BISCOITO/, 'a mensagem escolhida e o contexto do hook dela ficam de fora');
  assert.doesNotMatch(tudo, /Anotado: gato/);
  assert.ok(!L.some((d) => d.type === 'queue-operation' || d.type === 'last-prompt' || d.type === 'ai-title'), 'linha sem uuid nao vai (como no --fork-session do CLI)');
  // a folha e' a resposta do turno anterior, nao um anexo solto
  assert.equal(L.at(-1).type, 'assistant');
  assert.ok(!tudo.includes(ORIG), 'o id velho nao sobra em lugar nenhum');
});

test('mesmo texto repetido: repetidasDepois escolhe qual; texto que nao existe vira erro (nunca corte no escuro)', () => {
  const bruto = conversa(ORIG, ({ turno }) => { turno('sim', 'ok 1'); turno('sim', 'ok 2'); });
  const ultimo = cortar(bruto, { alvo: 'sim', repetidasDepois: 0, doFim: 2 });
  assert.match(ultimo.texto, /ok 1/); assert.doesNotMatch(ultimo.texto, /ok 2/);
  const penultimo = cortar(bruto, { alvo: 'sim', repetidasDepois: 1, doFim: 3 });
  assert.match(penultimo.texto, /VIOLETA/); assert.doesNotMatch(penultimo.texto, /ok 1/);
  const nada = cortar(bruto, { alvo: 'isto nunca foi dito', repetidasDepois: 0, doFim: 1 });
  assert.ok(nada.erro, 'texto nao achado: erro, e a tela cai no texto colado');
});

test('sem texto (mensagem so de imagem): corta pela posicao contada do fim; comando e texto tecnico nao contam', () => {
  const bruto = conversa(ORIG, ({ base }) => {
    base('user', { message: { role: 'user', content: '<command-name>/compact</command-name>' } });
    base('user', { message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] } });
    base('assistant', { message: { role: 'assistant', content: [{ type: 'text', text: 'vi a imagem' }] } });
  });
  // do fim: 1 = gato, 2 = a imagem, 3 = portao
  const r = cortar(bruto, { alvo: '', doFim: 2 });
  assert.match(r.texto, /VIOLETA/); assert.doesNotMatch(r.texto, /vi a imagem/); assert.doesNotMatch(r.texto, /BISCOITO/);
  conferirCadeia(r.texto, NOVO);
});

test('voltar para a PRIMEIRA mensagem: nao sobra conversa (vazio), sem gravar arquivo torto', () => {
  const r = cortar(conversa(ORIG), { alvo: 'A senha do cofre é ABACAXI-7', repetidasDepois: 0, doFim: 3 });
  assert.equal(r.vazio, true, JSON.stringify(r));
});

test('galho abandonado (rewind no meio) e sub-agente ficam de fora; so a cadeia ate a folha', () => {
  const bruto = conversa(ORIG, ({ base, getUltimo, setUltimo }) => {
    const ponto = getUltimo();
    base('user', { message: { role: 'user', content: 'pergunta abandonada' } });
    base('assistant', { message: { role: 'assistant', content: [{ type: 'text', text: 'resposta abandonada' }] } });
    base('assistant', { isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'fala de sub-agente' }] } });
    setUltimo(ponto);   // o rewind volta a cadeia pro ponto de antes
  });
  const r = cortar(bruto, { alvo: 'O nome do gato é BISCOITO', repetidasDepois: 0, doFim: 1 });
  conferirCadeia(r.texto, NOVO);
  assert.doesNotMatch(r.texto, /abandonada/);
  assert.doesNotMatch(r.texto, /sub-agente/);
  assert.match(r.texto, /VIOLETA/);
});

test('conversa compactada: o corte depois do resumo mantem o antes pelo logicalParentUuid; resumo automatico nao e ponto de volta', () => {
  const bruto = conversa(ORIG, ({ base, getUltimo, setUltimo }) => {
    const antes = getUltimo();
    setUltimo(null);
    base('system', { subtype: 'compact_boundary', logicalParentUuid: antes, content: 'Conversation compacted' });
    base('user', { isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation. Resumo: cofre e portao.' } });
  });
  const r = cortar(bruto, { alvo: 'O nome do gato é BISCOITO', repetidasDepois: 0, doFim: 1 });
  const { L, raizes } = conferirCadeia(r.texto, NOVO);
  assert.equal(raizes, 2, 'raiz original + a fronteira da compactacao, como no arquivo de origem');
  assert.ok(L.some((d) => d.subtype === 'compact_boundary'));
  assert.match(r.texto, /ABACAXI-7/);
  const noResumo = cortar(bruto, { alvo: 'This session is being continued from a previous conversation. Resumo: cofre e portao.', repetidasDepois: 0, doFim: 2 });
  assert.ok(noResumo.erro, 'voltar pro resumo automatico nao faz sentido: erro claro');
});

test('texto de mensagem com o id velho entre aspas continua intacto (so o campo sessionId troca)', () => {
  const bruto = conversa(ORIG, ({ turno }) => { turno('o id era ' + ORIG + ' e "sessionId":"' + ORIG + '"', 'visto'); });
  const r = cortar(bruto, { alvo: 'O nome do gato é BISCOITO', repetidasDepois: 0, doFim: 1 });
  const fala = linhas(r.texto).map(falaDe).find((t) => t.startsWith('o id era'));
  assert.equal(fala, 'o id era ' + ORIG + ' e "sessionId":"' + ORIG + '"');
});

/* =====================================================================
   2) main.js de verdade, com Electron e processos falsos
   ===================================================================== */
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-ramo-'));
const HOME = path.join(RAIZ, 'home');
const USERDATA = path.join(RAIZ, 'userData');
const PASTA = path.join(RAIZ, 'projeto');
const PROJ = path.join(HOME, '.claude', 'projects', PASTA.replace(/[\\/.:]/g, '-'));
for (const d of [PROJ, USERDATA, PASTA]) fs.mkdirSync(d, { recursive: true });

const spawns = [];
const filhos = [];
function spawnFalso(bin, args, opts) {
  const lista = Array.isArray(args) ? args : [];
  const tudo = String(bin) + ' ' + lista.join(' ');
  spawns.push({ bin: String(bin), args: lista, tudo });
  /* o motor (claude local ou ssh) so' fica de pe um tempo -- o que se prova aqui
     e' a linha de comando; qualquer outro spawn (git, where...) sai na hora */
  const motor = /--input-format/.test(tudo) || /(^|[\\/])ssh(\.exe)?$/i.test(String(bin));
  const p = cpReal.spawn(process.execPath, ['-e', motor ? 'process.stdin.on("data",()=>{});setTimeout(()=>{},15000)' : 'process.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  filhos.push(p);
  return p;
}

const handlers = new Map();
const enviados = [];
class JanelaFalsa {
  constructor() {
    this.webContents = {
      on() {}, send: (canal, p) => enviados.push({ canal, ...(p || {}) }),
      setWindowOpenHandler() {}, reload() {}, isDestroyed: () => false,
    };
  }
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
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {} },
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
/* fim: mata os processos falsos, solta os canos (o claudeStop tira o ouvinte do
   stdout e o cano pausado seguraria o teste), FECHA os vigias de pasta do main
   (perguntas, inbox) e so' depois apaga a pasta temporaria -- no Windows,
   apagar a pasta com o vigia aberto vira um laco de eventos sem fim */
test.after(() => {
  for (const p of filhos) {
    try { p.kill(); } catch {}
    for (const s of [p.stdin, p.stdout, p.stderr]) { try { s && s.destroy(); } catch {} }
  }
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
const eventos = (paneId, kind) => enviados.filter((e) => e.canal === 'pane:event' && e.paneId === paneId && (!kind || e.kind === kind));

test('main: "voltar para cá" do Claude grava o ramo cortado AO LADO da origem, sem tocar nela', async () => {
  const origem = path.join(PROJ, ORIG + '.jsonl');
  const bruto = conversa(ORIG);
  fs.writeFileSync(origem, bruto);
  const r = await chamar('sessao:fork', { engine: 'claude', id: ORIG, doFim: 1, alvo: 'O nome do gato é BISCOITO', repetidasDepois: 0, cwd: PASTA });
  assert.ok(r && r.id, JSON.stringify(r));
  assert.notEqual(r.id, ORIG);
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  const novo = path.join(PROJ, r.id + '.jsonl');
  assert.ok(fs.existsSync(novo), 'o ramo mora na mesma pasta de projeto (o --resume acha)');
  assert.equal(fs.readFileSync(origem, 'utf8'), bruto, 'a conversa de origem fica byte a byte igual');
  const t = fs.readFileSync(novo, 'utf8');
  conferirCadeia(t, r.id);
  assert.match(t, /VIOLETA/); assert.doesNotMatch(t, /BISCOITO/);
});

test('main: conversa sem arquivo, primeira mensagem e fork inteiro do Claude respondem com recado, nao com lixo', async () => {
  const semArq = await chamar('sessao:fork', { engine: 'claude', id: '00000000-0000-4000-8000-000000000000', doFim: 1, alvo: 'x', cwd: PASTA });
  assert.ok(semArq.error, JSON.stringify(semArq));
  const primeira = await chamar('sessao:fork', { engine: 'claude', id: ORIG, doFim: 3, alvo: 'A senha do cofre é ABACAXI-7', repetidasDepois: 0, cwd: PASTA });
  assert.equal(primeira.vazio, true, JSON.stringify(primeira));
  const inteira = await chamar('sessao:fork', { engine: 'claude', id: ORIG, cwd: PASTA });
  assert.ok(inteira.error, 'a conversa inteira do Claude ramifica no start (--fork-session), nao aqui');
  const torto = await chamar('sessao:fork', { engine: 'claude', id: '../../etc/passwd', doFim: 1, alvo: 'x', cwd: PASTA });
  assert.ok(torto.error, 'id que nao e uuid nao vira caminho');
});

test('main: ramo inteiro no PC nasce com --resume + --fork-session + --session-id e avisa o endereco novo NA HORA', async () => {
  const antes = spawns.length;
  const ok = await chamar('pane:start', { paneId: 'r1', engine: 'claude', cwd: PASTA, approval: 'bypass', resumeId: ORIG, fork: true, abaId: 'pc' });
  assert.equal(ok, true);
  const s = spawns.slice(antes).find((x) => /--input-format/.test(x.tudo));
  assert.ok(s, 'o claude subiu');
  const m = s.tudo.match(/--resume"?\s+"?([0-9a-f-]{36})"?\s+"?--fork-session"?\s+"?--session-id"?\s+"?([0-9a-f-]{36})/);
  assert.ok(m, s.tudo);
  assert.equal(m[1], ORIG);
  assert.notEqual(m[2], ORIG);
  const ev = eventos('r1', 'sessao').at(-1);
  assert.ok(ev, 'o evento sessao sai antes do system init: sem a janela em que o ramo nao tem endereco');
  assert.equal(ev.id, m[2]);
  assert.equal(ev.file, path.join(PROJ, m[2] + '.jsonl'));
  await chamar('pane:stop', { paneId: 'r1', engine: 'claude' });
});

test('main: ramo no servidor = --resume + --fork-session DENTRO do ssh (linha de comando so; nada roda na VPS)', async () => {
  const REMOTO = { host: 'vps.exemplo', usuario: 'hugo', chave: 'C:\\chaves\\vps', caminhoRemoto: '~/projeto' };
  const antes = spawns.length;
  const ok = await chamar('pane:start', { paneId: 'r2', engine: 'claude', cwd: '~/projeto', approval: 'bypass', resumeId: ORIG, fork: true, remoto: REMOTO, abaId: 'vps' });
  assert.equal(ok, true);
  const s = spawns.slice(antes).find((x) => /(^|[\\/])ssh(\.exe)?$/i.test(x.bin));
  assert.ok(s, 'subiu pelo ssh');
  assert.ok(s.args.includes('hugo@vps.exemplo'));
  const comando = s.args.at(-1);
  assert.match(comando, /^cd ~\/'projeto' \|\| exit 1; claude /);
  assert.ok(comando.includes("'--resume' '" + ORIG + "' '--fork-session'"), comando);
  // a versao do CLI no servidor nao foi medida com --session-id junto do fork: o id chega no system init
  assert.ok(!comando.includes('--session-id'), comando);
  assert.equal(eventos('r2', 'sessao').length, 0);
  await chamar('pane:stop', { paneId: 'r2', engine: 'claude' });
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
function tela(extras) {
  const criados = [], faixas = [], notas = [], forks = [], historicos = [], consultas = [], avisos = [], salvou = { n: 0 };
  const cfg = { abaAtiva: 'pc', abas: [
    { id: 'pc', tipo: 'local' },
    { id: 'vps', tipo: 'ssh', host: 'vps.test', usuario: 'qa', chave: 'chave-vps', caminhoRemoto: '~/projeto' },
    { id: 'outro', tipo: 'ssh', host: 'outro.test', usuario: 'qa2', chave: 'chave-outro', caminhoRemoto: '~/outro' },
  ], ...(extras?.cfg || {}) };
  const ctx = vm.createContext({
    criados, faixas, notas, forks, historicos, consultas, avisos, salvou,
    newPane: (o) => {
      const P = { id: 'n' + criados.length, engine: o.engine, cwd: o.cwd, model: o.model || '', mode: o.mode, effort: o.effort,
        abaId: o.abaId || 'pc', titulo: o.titulo || '', resumeId: o.resumeId || null, sessaoId: null,
        hist: [], el: { campo: { value: '', style: {} } }, engineStates: {} };
      criados.push(P); return P;
    },
    $: (sel, el) => (sel === '.p-input' && el ? el.campo : null),
    pintarNome() {}, savePanes: () => { salvou.n++; },
    faixaDeRamo: (novo, origem, doFim, soResumo, extra) => faixas.push({ novo: novo.id, origem: origem && origem.titulo, doFim, soResumo: !!soResumo, extra }),
    note: (P, t, erro) => notas.push({ P: P && P.id, t, erro: !!erro }),
    mostrarAviso: (aviso) => avisos.push(aviso),
    cabeMaisPainel: () => true,
    montarContexto: ({ hist }) => 'CONTEXTO:' + hist.map((h) => h.quem + '=' + h.texto).join('|'),
    nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' })[e] || e,
    guardarEstadoDoMotor() {},
    // auditoria 1: o ramo pela lista pergunta o modelo da origem (painel aberto ou historico)
    panes: new Map(), panesFundo: new Map(), modeloDoHistorico: () => '', listaOuErro: (x) => ({ itens: x || [] }),
    window: { api: {
      sessaoFork: async (o) => { forks.push(o); return (extras && extras.forkResp) ? extras.forkResp(o) : { id: 'fork-' + o.engine }; },
      sessionHistory: async (o) => { historicos.push(o); return [{ role: 'user', text: 'oi' }, { role: 'bot', text: 'ola' }]; },
      motoresDisponiveis: async (remoto) => {
        consultas.push(remoto);
        if (extras?.mapaResp) return extras.mapaResp(remoto);
        return Object.fromEntries(['claude', 'codex', 'gemini', 'grok', 'acp'].map((engine) =>
          [engine, { disponivel: true, capacidades: { fork: ['claude', 'codex', 'gemini'].includes(engine) } }]));
      },
      retomarPegar: async () => { throw new Error('ramo pendente nao pode pedir retomada'); },
    } },
    ...(extras || {}),
    cfg,
  });
  vm.runInContext(['tituloDeRamo', 'novoPainelRamo', 'forkClaude', 'abrirRamo', 'ramoPorContexto', 'ramificar', 'ramificarAte',
    'ramificarDaLista', 'painelDaConversa', 'retomarSeCaiu', 'aoNascerSessao', 'acaoCasa', 'fichaDoPainel',
    'guardarEnderecoAteASessao', 'religarEContinuar', 'modeloDaOrigem',
    'abasLocais', 'abaPorId', 'abaAtual', 'remotoDoAba', 'remotoDoPane', 'faltaConfigurarServidor', 'capacidadeRemota', 'avisoRamoNoServidor',
    // B6: o aoNascerSessao passa o nome do painel pra lista (ramo sem nome seu/automatico nao grava nada)
    'gravarNomeDoPainel'].map(funcao).join('\n'), ctx);
  return ctx;
}

test('tela: "Ramificar em painel novo" pela lista (Claude do PC) cria o ramo pendente SEM abrir a original', async () => {
  const c = tela();
  await c.ramificarDaLista({ engine: 'claude', id: ORIG, title: 'Plano do cofre', cwd: 'C:\\proj', when: 1 });
  assert.equal(c.criados.length, 1, 'um painel so: o ramo');
  const R = c.criados[0];
  assert.deepEqual([R.engine, R.cwd, R.abaId, R.resumeId, R.forkPendente, R.titulo],
    ['claude', 'C:\\proj', 'pc', ORIG, true, '(ramo) Plano do cofre']);
  assert.equal(c.forks.length, 0, 'o Claude ramifica no start, nao antes');
  assert.equal(c.faixas[0].origem, 'Plano do cofre');
  // guardar/restaurar antes da 1a mensagem: a ficha mantem o fork (senao vira continuacao da origem)
  const f = c.fichaDoPainel(R);
  assert.equal(f.fork, true);
  assert.equal(f.sessaoId, ORIG);
  // clicar na conversa de ORIGEM na lista nao pode achar o ramo como se fosse ela
  assert.equal(c.painelDaConversa([R], ORIG), undefined);
  assert.equal(c.painelDaConversa([{ ...R, forkPendente: false }], ORIG).id, R.id);
  assert.equal(c.painelDaConversa([{ id: 'x', sessaoId: ORIG }], ORIG).id, 'x');
});

test('tela: pela lista, Claude do servidor tambem vira fork real; Codex usa thread/fork; motor sem fork leva o resumo', async () => {
  const c = tela({ cfg: { abaAtiva: 'vps' } });
  await c.ramificarDaLista({ engine: 'claude', id: ORIG, title: 'Na VPS', cwd: '~/projeto', remoto: true });
  assert.deepEqual([c.criados[0].abaId, c.criados[0].resumeId, c.criados[0].forkPendente], ['vps', ORIG, true]);

  const d = tela();
  await d.ramificarDaLista({ engine: 'codex', id: 'thr-1', title: 'Tarefa', cwd: 'C:\\proj' });
  // { ...x }: o objeto nasceu dentro do vm (outro Object.prototype)
  assert.deepEqual({ ...d.forks[0] }, { engine: 'codex', id: 'thr-1', remoto: undefined });
  assert.equal(d.criados[0].resumeId, 'fork-codex');
  assert.ok(!d.criados[0].forkPendente);
  assert.equal(d.criados[0].titulo, '(ramo) Tarefa');

  const g = tela({ forkResp: () => ({ error: 'Este motor não ramifica por aqui.' }) });
  await g.ramificarDaLista({ engine: 'grok', id: 'g-1', title: 'Grok', cwd: 'C:\\proj' });
  assert.equal(g.criados.length, 1);
  assert.equal(g.criados[0].passarContexto, 'CONTEXTO:Você=oi|Grok=ola');
  assert.equal(g.faixas[0].soResumo, true);
});

test('tela: Codex e Gemini da lista ramificam no destino capturado, mesmo com outra aba ativa', async () => {
  for (const engine of ['codex', 'gemini']) {
    for (const abaAtiva of ['pc', 'outro']) {
      const c = tela({ cfg: { abaAtiva } });
      const remoto = c.remotoDoAba(c.abaPorId('vps'));
      await c.ramificarDaLista({ engine, id: 'sessao-igual', title: 'Remota', cwd: '~/projeto', remoto: true, remotoDestino: remoto });
      assert.equal(c.forks.length, 1);
      assert.deepEqual({ ...c.forks[0] }, { engine, id: 'sessao-igual', remoto });
      assert.equal(c.consultas[0], remoto);
      assert.equal(c.criados[0].engine, engine);
      assert.equal(c.criados[0].abaId, 'vps');
      assert.equal(c.criados[0].cwd, '~/projeto');
      assert.equal(c.criados[0].resumeId, 'fork-' + engine);
      assert.equal(c.historicos.length, 0, 'fork nativo não lê histórico local nem remoto');
    }
  }
});

test('tela: Claude herda modelo apenas da mesma sessão no mesmo servidor', async () => {
  const c = tela();
  c.panes.set('errado', { engine: 'claude', abaId: 'outro', sessaoId: ORIG, model: 'modelo-outro' });
  c.panesFundo.set('certo', { engine: 'claude', abaId: 'vps', sessaoId: ORIG, model: 'modelo-certo', effort: 'high' });
  const remoto = c.remotoDoAba(c.abaPorId('vps'));
  await c.ramificarDaLista({ engine: 'claude', id: ORIG, remoto: true, remotoDestino: remoto });
  assert.equal(c.criados[0].abaId, 'vps');
  assert.equal(c.criados[0].model, 'modelo-certo');
  assert.equal(c.criados[0].effort, 'high');
  assert.equal(c.criados[0].forkPendente, true);
  assert.equal(c.historicos.length, 0);
});

test('tela: motor remoto indisponível, fork recusado e falha de consulta não tocam o PC', async () => {
  for (const engine of ['claude', 'codex', 'gemini', 'grok', 'acp']) {
    const respostas = [() => ({ [engine]: { disponivel: false } }), () => { throw new Error('SSH indisponível'); }];
    if (['claude', 'codex', 'gemini'].includes(engine)) {
      respostas.push(() => ({ [engine]: { disponivel: true, capacidades: { fork: false } } }));
    }
    for (const mapaResp of respostas) {
      const c = tela({ cfg: { abaAtiva: 'vps' }, mapaResp });
      assert.equal(await c.ramificarDaLista({ engine, id: 's-remota', remoto: true }), null);
      assert.equal(c.forks.length, 0, engine);
      assert.equal(c.criados.length, 0, engine);
      assert.equal(c.historicos.length, 0, engine);
      assert.equal(c.avisos.length, 1, engine);
    }
  }
});

test('tela: destino remoto removido ou sem configuração recusa antes de consultar motores', async () => {
  for (const remotoDestino of [{ host: 'ausente.test', usuario: 'qa' }, { host: '', usuario: '' }]) {
    const c = tela();
    assert.equal(await c.ramificarDaLista({ engine: 'codex', id: 's', remoto: true, remotoDestino }), null);
    assert.equal(c.consultas.length, 0);
    assert.equal(c.historicos.length, 0);
    assert.equal(c.forks.length, 0);
    assert.equal(c.criados.length, 0);
  }
});

test('tela: Grok e ACP ramificam por resumo do mesmo servidor e falha de fork não consulta o PC', async () => {
  for (const engine of ['grok', 'acp', 'codex', 'gemini']) {
    const c = tela({ forkResp: () => ({ error: 'fork indisponível' }) });
    const remoto = c.remotoDoAba(c.abaPorId('vps'));
    await c.ramificarDaLista({ engine, id: 's', cwd: '~/projeto', remoto: true, remotoDestino: remoto });
    assert.equal(c.criados[0].abaId, 'vps');
    assert.equal(c.criados[0].engine, engine);
    assert.ok(c.criados[0].passarContexto);
    assert.deepEqual({ ...c.historicos[0] }, { engine, id: 's', remoto });
    assert.equal(c.historicos.length, 1);
    if (engine === 'codex' || engine === 'gemini') assert.match(c.notas[0].t, /resumo/);
    else assert.equal(c.forks.length, 0);
  }
});

test('tela: ramificar até ponto com Codex e Gemini remotos preserva motor e destino', async () => {
  for (const engine of ['codex', 'gemini']) {
    const c = tela();
    const P = { id: 'p1', engine, abaId: 'vps', cwd: '~/projeto', sessaoId: 's', hist: [] };
    await c.ramificarAte(P, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(c.forks[0])), { engine, id: 's', doFim: 2, remoto: { ...c.remotoDoPane(P) } });
    assert.equal(c.criados[0].abaId, 'vps');
    assert.equal(c.criados[0].engine, engine);
    assert.equal(c.historicos.length, 0);
    const indisponivel = tela({ mapaResp: () => ({ [engine]: { disponivel: false } }) });
    assert.equal(await indisponivel.ramificarAte(P, 2), null);
    assert.equal(indisponivel.forks.length, 0);
    assert.equal(indisponivel.criados.length, 0);
    assert.equal(indisponivel.historicos.length, 0);
  }
});

test('tela: ramo de ramo nao empilha "(ramo) (ramo)"', () => {
  const c = tela();
  assert.equal(c.tituloDeRamo('(ramo) Plano'), '(ramo) Plano');
  assert.equal(c.tituloDeRamo(''), '(ramo) Conversa');
});

test('tela: Claude na VPS ramifica de verdade (sem a guarda antiga); "voltar para cá" no servidor leva o resumo', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'claude', abaId: 'vps', cwd: '~/projeto', sessaoId: ORIG, titulo: 'X', hist: [{ quem: 'Você', texto: 'a' }, { quem: 'Claude', texto: 'b' }] };
  await c.ramificarAte(P, null);
  assert.deepEqual([c.criados[0].abaId, c.criados[0].resumeId, c.criados[0].forkPendente], ['vps', ORIG, true]);
  await c.ramificarAte(P, 1, { texto: 'a', repetidasDepois: 0 });
  assert.equal(c.forks.length, 0, 'o corte do .jsonl e do PC; no servidor nao ha arquivo aqui');
  assert.ok(c.criados[1].passarContexto);
});

test('tela: "voltar para cá" no Claude do PC pede o corte ao main e abre o ramo com a mensagem de volta no campo', async () => {
  const c = tela({ forkResp: () => ({ id: NOVO }) });
  const P = { id: 'p1', engine: 'claude', abaId: 'pc', cwd: 'C:\\proj', sessaoId: ORIG, titulo: 'Cofre', model: 'claude-sonnet-5', hist: [] };
  await c.ramificarAte(P, 2, { texto: 'A cor do portão é VIOLETA', repetidasDepois: 0 });
  assert.deepEqual({ ...c.forks[0] }, { engine: 'claude', id: ORIG, doFim: 2, alvo: 'A cor do portão é VIOLETA', repetidasDepois: 0, cwd: 'C:\\proj' });
  const R = c.criados[0];
  assert.equal(R.resumeId, NOVO);
  assert.ok(!R.forkPendente, 'o ramo cortado ja e sessao nova: --resume nele, sem fork de novo');
  assert.equal(R.model, 'claude-sonnet-5');
  assert.equal(R.el.campo.value, 'A cor do portão é VIOLETA', 'a mensagem escolhida volta pro campo, pra reenviar ou mudar');
  assert.equal(c.faixas[0].extra && c.faixas[0].extra.antes, true);

  const v = tela({ forkResp: () => ({ vazio: true }) });
  await v.ramificarAte({ ...P }, 3, { texto: 'primeira', repetidasDepois: 0 });
  assert.equal(v.criados[0].resumeId, null, 'antes da 1a mensagem nao ha conversa: painel novo do zero');
  assert.equal(v.criados[0].el.campo.value, 'primeira');

  const e = tela({ forkResp: () => ({ error: 'Não achei essa mensagem na conversa gravada.' }) });
  await e.ramificarAte({ ...P, hist: [{ quem: 'Você', texto: 'a' }] }, 1, { texto: 'a', repetidasDepois: 0 });
  assert.ok(e.notas.some((n) => n.erro && /resumo/.test(n.t)), 'falhou o corte: avisa e cai no texto colado');
  assert.ok(e.criados[0].passarContexto);
});

test('tela: ramo pendente nao pede retomada no boot (B2) e so deixa de ser ramo quando o endereco NOVO chega', async () => {
  const c = tela();
  const R = { id: 'r', engine: 'claude', abaId: 'pc', resumeId: ORIG, forkPendente: true };
  assert.equal(await c.retomarSeCaiu(R, { engine: 'claude', sessaoId: ORIG, paneId: 'r', fork: true }), false);
  // o 'sessao' com o id da ORIGEM nao desliga o fork; o do ramo desliga
  const Q = { id: 'q', forkPendente: true, resumeId: null, resumeAnterior: ORIG };
  c.aoNascerSessao(Q, { id: ORIG, file: '' });
  assert.equal(Q.forkPendente, true);
  c.aoNascerSessao(Q, { id: NOVO, file: 'x.jsonl', remoto: false });
  assert.deepEqual([Q.forkPendente, Q.sessaoId, Q.sessaoFile, Q.resumeAnterior], [false, NOVO, 'x.jsonl', null]);
  assert.ok(c.salvou.n > 0);
  // painel comum: o de sempre
  const P = { id: 'p', forkPendente: false, resumeId: 'A' };
  c.aoNascerSessao(P, { id: 'A', file: 'a.jsonl' });
  assert.equal(P.sessaoId, 'A');
});

test('tela: o envio nao apaga o fork antes do endereco novo chegar (queda antes do init refaz o ramo, nao continua a origem)', () => {
  const corpo = funcao('send');
  assert.doesNotMatch(corpo, /forkPendente\s*=\s*false/, 'quem desliga o fork e o evento sessao (aoNascerSessao)');
  assert.doesNotMatch(funcao('religarEContinuar'), /forkPendente\s*=\s*false/);
  assert.match(APP, /case 'sessao':\s*aoNascerSessao\(P, ev\)/);
});

test('tela: ramo que caiu antes de nascer nao religa (nem "continue" num fork novo da origem)', async () => {
  let ligou = 0;
  const c = tela({
    setDot() {}, pararTrabalho() {}, devolverFilaAoCampo() {}, pintarAbasLocal() {}, panes: new Map([['r', {}]]),
    window: { api: { paradaEm: () => 0, paneStart: async () => { ligou++; return true; }, paneSend: async () => true } },
  });
  const R = { id: 'r', engine: 'claude', abaId: 'vps', forkPendente: true, started: false, resumeId: null, resumeAnterior: ORIG, sessaoId: null, busy: true };
  R._religar = { n: 1, tQueda: Date.now(), timer: 0 };
  assert.equal(await c.religarEContinuar(R, 1, R._religar.tQueda), false);
  assert.equal(ligou, 0, 'nao liga motor nenhum');
  assert.ok(c.notas.some((n) => n.erro && /ramo/.test(n.t)), 'avisa que a proxima mensagem refaz o ramo');
  assert.equal(R.forkPendente, true, 'o ramo continua pendente');
});

test('tela: endereco do ramo que chega ANTES da resposta do start nao deixa o id da origem guardado', () => {
  const c = tela();
  const R = { sessaoId: NOVO, resumeId: ORIG, resumeAnterior: null };   // o 'sessao' do ramo ja' chegou
  c.guardarEnderecoAteASessao(R);
  assert.equal(R.resumeAnterior, null, 'senao a lista acharia o ramo como se fosse a origem');
  const P = { sessaoId: null, resumeId: ORIG, resumeAnterior: null };   // retomada comum: guarda ate' o init
  c.guardarEnderecoAteASessao(P);
  assert.equal(P.resumeAnterior, ORIG);
  const Q = { sessaoId: 'X', resumeId: 'X', resumeAnterior: null };
  c.guardarEnderecoAteASessao(Q);
  assert.equal(Q.resumeAnterior, 'X');
  // como o send deixa o ramo depois do start (resumeId limpo, fork ja' desligado pelo 'sessao')
  assert.equal(c.painelDaConversa([{ ...R, resumeId: null, forkPendente: false }], ORIG), undefined);
  assert.equal(c.tituloDeRamo('Plano (ramo)'), '(ramo) Plano', 'o sufixo antigo vira o prefixo de agora');
});

test('"/": item "Ramificar conversa" acha por ramificar, fork, ramo e "continuar em outro painel"', () => {
  const c = tela();
  const m = APP.match(/\{[^{}]*nome: 'Ramificar conversa'[^{}]*\}/);
  assert.ok(m, 'item "Ramificar conversa" na lista de acoes do /');
  assert.match(m[0], /act: \(\) => ramificar\(P\)/);
  const chaves = (m[0].match(/chaves: '([^']*)'/) || [])[1];
  assert.ok(chaves, 'o item traz sinonimos pro filtro');
  const item = { nome: 'Ramificar conversa', chaves };
  for (const q of ['ramificar', 'fork', 'ramo', 'continuar em outro painel', 'Ramif']) assert.equal(c.acaoCasa(item, q.toLowerCase()), true, q);
  assert.equal(c.acaoCasa(item, 'exportar'), false);
  assert.equal(c.acaoCasa({ nome: 'Trocar modelo…' }, 'modelo'), true, 'item sem sinonimo segue achando pelo nome');
  assert.doesNotMatch(APP, /nome: 'Continuar em outro painel'/);
  assert.match(funcao('menuSkills'), /acaoCasa\(a, q\)/);
});

test('lista: "Mais ações" oferece "Ramificar em painel novo" tambem na conversa do servidor', () => {
  const corpo = funcao('linhaConversa');
  const iRamo = corpo.indexOf("'Ramificar em painel novo'");
  const iRemoto = corpo.indexOf('if (s.remoto)');
  assert.ok(iRamo > 0, 'item na lista');
  assert.ok(iRemoto < 0 || iRamo < iRemoto, 'vem antes da saida da conversa remota');
  assert.match(corpo, /ramificarDaLista\(s\)/);
  assert.match(funcao('openSession'), /painelDaConversa\(/, 'abrir a origem pela lista nao confunde com o ramo pendente');
});
