'use strict';
/* Leva 5i, item 1: as IAs que o Cockpit sobe pelo ACP (OpenCode, Grok, Copilot, Qwen Code, Cline, Kilo, Droid, Cursor, Kimi, Vibe e Goose, alem
   do Gemini, do Claude Code e do Codex que ja' existiam).
   Cobre: os presets (comando e logo), os SVGs oficiais (uma cor, sem script nem evento), a disponibilidade por preset (main e servidor), o menuzinho
   do motor (so' as instaladas, escolher certo, teclado), o chip com o logo da IA, o .cmd do Windows resolvido pelo ajudante da plataforma, o Grok
   pelo ACP e os consertos do ACP no servidor. Nenhum no do DOM de mentira entra como actual/expected de assert (so' booleano, numero ou texto). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const IAS = require('../src/renderer/acp-presets');
const Modelos = require('../src/renderer/model-presentation');

const APP = lerFonte('renderer', 'app.js');
const UI = lerFonte('renderer', 'cockpit-ui.js');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const HTML = lerFonte('renderer', 'index.html');
const MAIN = lerFonte('main.js');
const ACPJS = lerFonte('acp.js');

// as 11 da tabela: [id do registro, nome curto, comando]
const ONZE = [
  ['opencode', 'OpenCode', 'opencode acp'],
  ['grok-build', 'Grok', 'grok agent stdio'],
  ['github-copilot-cli', 'Copilot', 'copilot --acp'],
  ['qwen-code', 'Qwen Code', 'qwen --acp --experimental-skills'],
  ['cline', 'Cline', 'cline --acp'],
  ['kilo', 'Kilo', 'kilo acp'],
  ['factory-droid', 'Droid', 'droid exec --output-format acp-daemon'],
  ['cursor', 'Cursor', 'cursor-agent acp'],
  ['kimi', 'Kimi', 'kimi acp'],
  ['mistral-vibe', 'Vibe', 'vibe-acp'],
  ['goose', 'Goose', 'goose acp'],
];
const IDS_DAS_ONZE = ONZE.map(([ia]) => ia);

/* ---------------------------------------------------------------------------------------------------------------------
   Os presets
   --------------------------------------------------------------------------------------------------------------------- */
test('os 11 presets do registro: id, nome curto, o comando da tabela e o programa (1o termo) que o temBin confere', () => {
  for (const [ia, nome, comando] of ONZE) {
    const p = IAS.doId(ia);
    assert.ok(p, 'falta o preset ' + ia);
    assert.equal(p.nome, nome, ia);
    assert.equal(p.comando, comando, ia);
    assert.equal(p.bin, comando.split(' ')[0], ia + ': o programa e o 1o termo do comando');
    assert.equal(IAS.doComando(comando).ia, ia, 'o comando acha o preset de volta');
    assert.ok(p.desc.length > 10, ia + ': tem descricao');
  }
  assert.equal(IAS.PRESETS.filter((p) => IDS_DAS_ONZE.includes(p.ia)).length, 11);
  assert.equal(new Set(IAS.PRESETS.map((p) => p.ia)).size, IAS.PRESETS.length, 'ids unicos');
  assert.equal(new Set(IAS.PRESETS.map((p) => p.comando)).size, IAS.PRESETS.length, 'comandos unicos');
});

test('o Qwen passa a ser "qwen --acp --experimental-skills", como no registro, e o comando se acha mesmo com espaco a mais', () => {
  assert.equal(IAS.doId('qwen-code').comando, 'qwen --acp --experimental-skills');
  assert.equal(IAS.doComando('qwen --acp'), null, 'o comando antigo (so --acp) nao e mais preset');
  assert.equal(IAS.doComando('  opencode    acp ').ia, 'opencode');
  assert.equal(IAS.doComando(''), null);
  assert.equal(IAS.doComando(null), null);
  assert.equal(IAS.doComando('meu-agente --acp'), null, '"Outro comando…" nao e preset');
});

test('os 3 de antes continuam (Gemini padrao, Claude Code e Codex pelos adaptadores) e reaproveitam o logo do motor da mesma marca', () => {
  const tres = [['gemini', 'Gemini (ACP)', 'gemini --acp', 'gemini'], ['claude-code', 'Claude Code (ACP)', 'npx -y @zed-industries/claude-code-acp', 'claude'],
    ['codex', 'Codex (ACP)', 'npx -y @zed-industries/codex-acp', 'codex']];
  for (const [ia, nome, comando, logoMotor] of tres) {
    const p = IAS.doId(ia);
    assert.equal(p.nome, nome); assert.equal(p.comando, comando); assert.equal(p.logoMotor, logoMotor);
    assert.equal(IAS.temLugarProprio(p), false, ia + ': nao ganha logo no menuzinho do motor (o do motor nativo ja esta la)');
  }
  assert.deepEqual(IAS.PRESETS.filter((p) => p.padrao).map((p) => p.ia), ['gemini'], 'so o Gemini e o padrao do ACP');
  assert.deepEqual(IAS.PRESETS.slice(0, 3).map((p) => p.ia), ['gemini', 'claude-code', 'codex'], 'e continuam no comeco da lista');
});

test('onde cada um aparece no menuzinho do motor: o Grok e o 4o logo; dez ficam na linha, na ordem da tabela; os 3 adaptadores so na lista do modelo', () => {
  assert.equal(IAS.doId('grok-build').lugar, 'grok');
  const linha = IAS.PRESETS.filter((p) => p.lugar === 'linha').map((p) => p.ia);
  assert.deepEqual(linha, ['opencode', 'github-copilot-cli', 'qwen-code', 'cline', 'kilo', 'factory-droid', 'cursor', 'kimi', 'mistral-vibe', 'goose']);
  assert.deepEqual(IAS.daLinha(IAS.PRESETS.map((p) => p.ia)).map((p) => p.ia), linha, 'daLinha() devolve esses dez, na ordem');
  assert.deepEqual(IAS.daLinha(['goose', 'opencode', 'grok-build', 'gemini', 'nao-existe', 7]).map((p) => p.ia), ['opencode', 'goose'], 'so as da linha, as que existem, na ordem da tabela');
  assert.deepEqual(IAS.daLinha(undefined), []);
  assert.deepEqual(IAS.daLinha('opencode'), [], 'lista que nao e lista nao vale');
});

test('o MODELOS_ACP do app.js sai da tabela (o "modelo" do painel ACP e o comando) e, sem o modulo, fica so no Gemini', () => {
  const ini = APP.indexOf('const MODELOS_ACP = '), fim = APP.indexOf('];', ini) + 2;
  assert.ok(ini > 0 && fim > ini);
  const decl = APP.slice(ini, fim).replace('const MODELOS_ACP', 'var MODELOS_ACP');
  const com = vm.createContext({ window: { CockpitAcpPresets: IAS } });
  vm.runInContext(decl, com);
  assert.deepEqual(JSON.parse(JSON.stringify(com.MODELOS_ACP)), JSON.parse(JSON.stringify(IAS.modelos())));
  assert.deepEqual(JSON.parse(JSON.stringify(com.MODELOS_ACP.map((m) => m.id))), IAS.PRESETS.map((p) => p.comando), 'o id de cada item e o comando');
  assert.equal(com.MODELOS_ACP.filter((m) => m.padrao).length, 1);
  const sem = vm.createContext({ window: {} });
  vm.runInContext(decl, sem);
  assert.deepEqual(JSON.parse(JSON.stringify(sem.MODELOS_ACP.map((m) => m.id))), ['gemini --acp'], 'sem o modulo: so o Gemini, como o app sempre pode subir');
  const semWindow = vm.createContext({});
  vm.runInContext(decl, semWindow);
  assert.equal(semWindow.MODELOS_ACP.length, 1, 'e nao quebra sem window');
});

test('o modulo carrega antes do app.js e e o mesmo arquivo que o main, o acp.js e o servidor usam', () => {
  const iModulo = HTML.indexOf('<script src="acp-presets.js"></script>'), iApp = HTML.indexOf('<script src="app.js"></script>');
  assert.ok(iModulo > 0 && iApp > iModulo, 'acp-presets.js vem antes do app.js no index.html');
  assert.match(MAIN, /require\('\.\/renderer\/acp-presets'\)/);
  assert.match(ACPJS, /require\('\.\/renderer\/acp-presets'\)/);
  assert.match(lerFonte('cockpit-remote.js'), /require\("\.\/renderer\/acp-presets"\)/);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Os logos oficiais
   --------------------------------------------------------------------------------------------------------------------- */
const ATRIBUTOS_OK = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx']);
const TAGS_OK = new Set(['path', 'circle', 'rect']);

test('cada IA com marca propria tem o logo oficial embutido: so path, circle e rect, uma cor so (currentColor), sem script, evento, endereco nem estilo', () => {
  assert.deepEqual(Object.keys(IAS.LOGOS).sort(), [...IDS_DAS_ONZE].sort(), 'um logo para cada uma das 11, e nenhum a mais');
  for (const ia of IDS_DAS_ONZE) {
    const l = IAS.LOGOS[ia];
    assert.match(l.vb, /^0 0 \d+(\.\d+)? \d+(\.\d+)?$/, ia + ': viewBox');
    assert.ok(l.corpo.length > 100, ia + ': tem desenho');
    const tags = [...l.corpo.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map((m) => m[1].toLowerCase());
    assert.ok(tags.length > 0 && tags.every((t) => TAGS_OK.has(t)), ia + ': tags fora da lista: ' + [...new Set(tags)].join(','));
    const atributos = [...l.corpo.matchAll(/\s([a-zA-Z][\w:-]*)=/g)].map((m) => m[1]);
    assert.ok(atributos.every((a) => ATRIBUTOS_OK.has(a)), ia + ': atributo fora da lista: ' + atributos.filter((a) => !ATRIBUTOS_OK.has(a)).join(','));
    assert.doesNotMatch(l.corpo, /<script|<style|<use|<image|<foreignObject|<!|javascript:|data:|https?:|\/\/|xlink|href|\bstyle\s*=|\bon[a-z]+\s*=|url\(/i, ia + ': nada de script, evento ou endereco');
    // uma cor so': todo fill e stroke e "currentColor"; nenhuma cor escrita no desenho
    const cores = [...l.corpo.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(cores.every((c) => c === 'currentColor'), ia + ': cor fora do currentColor: ' + cores.filter((c) => c !== 'currentColor').join(','));
    assert.doesNotMatch(l.corpo, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color\s*=/i, ia + ': sem cor escrita');
  }
});

test('logoSvg() monta o <svg> com a classe dos logos de motor (logo-motor), o viewBox da IA e currentColor; id desconhecido ou hostil devolve vazio', () => {
  for (const ia of IDS_DAS_ONZE) {
    const svg = IAS.logoSvg(ia);
    assert.match(svg, new RegExp('^<svg viewBox="' + IAS.LOGOS[ia].vb.replace(/\./g, '\\.') + '" class="logo-motor logo-ia" data-ia="' + ia + '" fill="currentColor" aria-hidden="true" focusable="false">'), ia);
    assert.ok(svg.endsWith('</svg>') && svg.includes(IAS.LOGOS[ia].corpo));
    assert.equal((svg.match(/<svg/g) || []).length, 1);
  }
  for (const ruim of ['"><img src=x onerror=1>', '__proto__', 'constructor', 'gemini', '', undefined, null, 7, {}]) assert.equal(IAS.logoSvg(ruim), '', String(ruim));
  assert.match(IAS.logoSvg('goose', 'ti-logo" onclick="x'), /class="logo-motor logo-ia ti-logo onclickx"/, 'a classe extra perde aspas e simbolos: nenhuma aspa escapa do atributo');
  const hostil = IAS.logoSvg('goose', '"><script>x</script>'), abre = hostil.slice(0, hostil.indexOf('>') + 1);
  assert.equal((abre.match(/"/g) || []).length, 12, 'o <svg ...> segue com as 6 aspas de par em par dos 6 atributos');
  assert.doesNotMatch(abre.slice(1, -1), /[<>]/, 'e nada abre outra tag dentro do atributo');
  assert.equal(hostil.includes('<script'), false);
});

test('todos os SVGs sao de uma cor so (currentColor): nenhum precisou ficar com a cor original da marca', () => {
  const comCor = IDS_DAS_ONZE.filter((ia) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(IAS.LOGOS[ia].corpo) || /\b(?:fill|stroke)="(?!currentColor")/.test(IAS.LOGOS[ia].corpo));
  assert.deepEqual(comCor, []);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Disponibilidade por preset (main e servidor)
   --------------------------------------------------------------------------------------------------------------------- */
test('instalados(): cada preset confere o proprio programa; semNpx tira os adaptadores; temBin que quebra conta como ausente', () => {
  const com = (...bins) => (b) => bins.includes(b);
  assert.deepEqual(IAS.instalados(com()), []);
  assert.deepEqual(IAS.instalados(com('opencode')), ['opencode']);
  assert.deepEqual(IAS.instalados(com('cursor-agent', 'goose', 'vibe-acp')), ['cursor', 'mistral-vibe', 'goose'], 'na ordem da tabela');
  assert.deepEqual(IAS.instalados(com('npx')), ['claude-code', 'codex'], 'os adaptadores contam o npx');
  assert.deepEqual(IAS.instalados(com('npx'), { semNpx: true }), [], 'no servidor a instalacao automatica esta desligada');
  assert.deepEqual(IAS.instalados(() => { throw new Error('quebrou'); }), []);
  const binarios = IAS.binarios({ semNpx: true });
  for (const b of ['gemini', 'opencode', 'grok', 'copilot', 'qwen', 'cline', 'kilo', 'droid', 'cursor-agent', 'kimi', 'vibe-acp', 'goose']) assert.ok(binarios.includes(b), b);
  assert.ok(!binarios.includes('npx'));
  assert.ok(IAS.binarios().includes('npx'));
});

/* O handler de verdade do main.js (recortado do fonte), com o temBin de mentira */
function motoresDisponiveis({ bins = [], claude = false, remoto } = {}) {
  const ini = MAIN.indexOf("const iasAcp = require('./renderer/acp-presets');"), fim = MAIN.indexOf('\n});', MAIN.indexOf("ipcMain.handle('motores:disponiveis'")) + 4;
  assert.ok(ini > 0 && fim > ini, 'nao achei o motores:disponiveis no main.js');
  let handler = null;
  const ctx = vm.createContext({
    require: (n) => { assert.equal(n, './renderer/acp-presets'); return IAS; },
    ipcMain: { handle: (nome, f) => { if (nome === 'motores:disponiveis') handler = f; } },
    remoteEngines: { inspect: async (r) => ({ doServidor: r }) },
    fs: { existsSync: () => claude }, claudeBin: () => 'claude.exe', temBin: (b) => bins.includes(b),
    CLIS: { gemini: { bin: 'gemini' }, grok: { bin: 'grok' } }, Object, Promise,
  });
  vm.runInContext(MAIN.slice(ini, fim), ctx);
  assert.equal(typeof handler, 'function');
  return (pedido) => handler(null, pedido);
}

test('motores:disponiveis: o ACP fica disponivel com QUALQUER preset instalado (antes so gemini, npx, opencode e qwen) e o modo detalhado traz quais', async () => {
  const sem = motoresDisponiveis({ bins: [] });
  assert.equal((await sem()).acp, false, 'nada instalado: o ACP nao e oferecido');
  for (const [ia, , comando] of ONZE) {
    const bin = comando.split(' ')[0];
    const r = await motoresDisponiveis({ bins: [bin] })({ detalhado: true });
    assert.equal(r.acp.disponivel, true, ia + ': ' + bin + ' instalado liga o ACP');
    assert.deepEqual(r.acp.presets, [ia], ia + ': e a lista traz so ele');
    assert.equal(r.acp.remoto, false);
  }
  const varios = await motoresDisponiveis({ bins: ['opencode', 'goose', 'grok', 'gemini', 'npx'], claude: true })({ detalhado: true });
  assert.deepEqual(varios.acp.presets, ['gemini', 'claude-code', 'codex', 'opencode', 'grok-build', 'goose']);
  assert.equal(varios.claude.disponivel, true);
  assert.equal(varios.grok.disponivel, true, 'o Grok continua conferindo o proprio programa');
  assert.equal(varios.codex.disponivel, false);
  // sem o modo detalhado a resposta continua a de sempre: um booleano por motor (o app.js a copia para motorDisponivel)
  const simples = await motoresDisponiveis({ bins: ['kimi'] })();
  assert.equal(simples.acp, true);
  assert.equal(typeof simples.acp, 'boolean');
  assert.equal(Object.prototype.hasOwnProperty.call(simples, 'presets'), false);
  // servidor: a resposta e a do inspect do servidor
  const remoto = await motoresDisponiveis({ bins: [] })({ remoto: { host: 'h' } });
  assert.deepEqual(remoto, { doServidor: { host: 'h' } });
});

/* O inspect do servidor, de verdade, com o transporte de mentira */
const REMOTO = { usuario: 'user', host: 'a.example', chave: 'C:\\keys\\a key', caminhoRemoto: '~' };
function servidorCom(saida) {
  const corridas = [];
  const { createRemote } = require('../src/cockpit-remote');
  const transport = { run: async (r, cmd) => { corridas.push(cmd); return saida; }, spawn() { throw new Error('nao deveria subir nada'); }, kill() {}, upload: async () => ({ paths: [], cleanup: async () => {} }) };
  return { manager: createRemote({ transport, emit() {}, cliArgs: () => [], cliEvent() {}, cliFlush() {} }), corridas };
}

test('servidor: o inspect libera o ACP se houver QUALQUER IA conhecida (antes so o gemini) e devolve quais; sem nenhuma, indisponivel com o motivo', async () => {
  const so = await servidorCom('opencode\ncursor-agent\n').manager.inspect(REMOTO);
  assert.equal(so.acp.disponivel, true, 'opencode e cursor-agent bastam');
  assert.deepEqual(so.acp.presets, ['opencode', 'cursor']);
  assert.equal(so.gemini.disponivel, false, 'o motor Gemini continua dependendo do proprio gemini');
  assert.equal(so.codex.disponivel, false);
  assert.equal(so.acp.remoto, true);
  assert.match(so.acp.detalhe, /IA do ACP detectada/);
  const gemini = await servidorCom('gemini\n').manager.inspect({ ...REMOTO, host: 'b.example' });
  assert.equal(gemini.acp.disponivel, true, 'o jeito antigo (so o gemini) continua valendo');
  assert.deepEqual(gemini.acp.presets, ['gemini']);
  const nenhuma = await servidorCom('codex\n').manager.inspect({ ...REMOTO, host: 'c.example' });
  assert.equal(nenhuma.acp.disponivel, false);
  assert.deepEqual(nenhuma.acp.presets, []);
  assert.match(nenhuma.acp.detalhe, /Nenhuma IA do ACP/);
  assert.equal(nenhuma.codex.disponivel, true);
  // o comando que roda no servidor confere os programas de todos os presets (menos o npx, que la esta desligado)
  const s = servidorCom('');
  await s.manager.inspect({ ...REMOTO, host: 'd.example' });
  const cmd = s.corridas[0];
  for (const b of ['claude', 'codex', 'gemini', 'grok', 'opencode', 'copilot', 'qwen', 'cline', 'kilo', 'droid', 'cursor-agent', 'kimi', 'vibe-acp', 'goose']) assert.match(cmd, new RegExp('\\b' + b + '\\b'), b);
  assert.doesNotMatch(cmd, /\bnpx\b/);
  // npx achado no servidor nao liga o ACP (a instalacao automatica esta desligada la)
  const comNpx = await servidorCom('npx\n').manager.inspect({ ...REMOTO, host: 'e.example' });
  assert.equal(comNpx.acp.disponivel, false);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Servidor: msgId/acc zeram a cada turno
   --------------------------------------------------------------------------------------------------------------------- */
function processoFalso(aoReceber) {
  const p = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = new EventEmitter();
  p.sent = [];
  p.stdin.write = (linha) => { const m = JSON.parse(linha); p.sent.push(m); aoReceber(m, p); };
  p.stdin.end = () => {};
  p.kill = () => { p.killed = true; };
  p.answer = (id, result) => p.stdout.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  p.note = (method, params) => p.stdout.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
  return p;
}
const tique = () => new Promise((r) => setImmediate(r));

test('servidor: cada turno do ACP nasce limpo (msgId e acc zerados); a resposta do turno 2 nao cola na do turno 1', async () => {
  const { createRemote } = require('../src/cockpit-remote');
  const eventos = [], processos = [];
  const transport = {
    run: async (r, cmd) => (cmd.includes('pwd') ? '/srv/project\n' : ''),
    upload: async () => ({ paths: [], cleanup: async () => {} }), kill: (p) => p.kill(),
    spawn: () => {
      const p = processoFalso((m, proc) => queueMicrotask(() => {
        if (m.method === 'initialize') proc.answer(m.id, { agentCapabilities: { loadSession: true } });
        else if (m.method === 'session/new') proc.answer(m.id, { sessionId: 'sessao-1' });
        else if (m.method !== 'session/prompt' && m.id) proc.answer(m.id, {});
      }));
      processos.push(p);
      return p;
    },
  };
  const manager = createRemote({ transport, emit: (pane, kind, data) => eventos.push({ pane, kind, ...data }), cliArgs: () => [], cliEvent() {}, cliFlush() {} });
  try {
    assert.equal(await manager.start('p', { engine: 'acp', remoto: REMOTO, model: 'opencode acp', approval: 'manual' }), true);
    const proc = processos[0];
    const fala = (texto) => proc.note('session/update', { sessionId: 'sessao-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: texto } } });
    const ultimoPrompt = () => proc.sent.filter((m) => m.method === 'session/prompt').at(-1);
    const turno = async (pergunta, ...pedacos) => {
      const enviando = manager.send('p', pergunta, '', []);
      for (let i = 0; i < 6 && !(ultimoPrompt() && ultimoPrompt().params.prompt[0].text === pergunta); i++) await tique();
      for (const pedaco of pedacos) fala(pedaco);
      proc.answer(ultimoPrompt().id, { stopReason: 'end_turn' });
      await enviando;
    };
    await turno('um', 'Primeira ', 'resposta');
    await turno('dois', 'Segunda ', 'resposta');
    const falas = eventos.filter((e) => e.kind === 'text-final');
    assert.deepEqual(falas.map((e) => e.text), ['Primeira ', 'Primeira resposta', 'Segunda ', 'Segunda resposta'], 'o texto do turno 2 NAO herda o do turno 1');
    assert.equal(new Set(falas.slice(0, 2).map((e) => e.id)).size, 1, 'dentro de um turno e a mesma fala');
    assert.equal(new Set(falas.slice(2).map((e) => e.id)).size, 1);
    assert.notEqual(falas[0].id, falas[2].id, 'e o turno 2 e outra fala (outro id)');
    const bot = manager.panes.get('p').history.filter((m) => m.role === 'bot');
    assert.deepEqual(bot.map((m) => m.text), ['Primeira resposta', 'Segunda resposta'], 'o registro guardado tem as duas respostas, separadas');
    assert.equal(eventos.filter((e) => e.kind === 'turn-end').length, 2);
  } finally { await manager.close(); }
});

/* ---------------------------------------------------------------------------------------------------------------------
   O .cmd do Windows: o acp.js sobe pelo ajudante da plataforma
   --------------------------------------------------------------------------------------------------------------------- */
test('o acp.js sobe o agente pelo spawnBin que recebe (o da plataforma, que resolve .cmd) e nunca por shell solto', () => {
  assert.doesNotMatch(ACPJS, /shell\s*:\s*true/);
  assert.doesNotMatch(ACPJS, /require\(['"]child_process['"]\)/, 'o acp.js nao chama o child_process direto: o spawn vem de fora');
  assert.match(ACPJS, /proc = spawnBin\(bin, args,/);
  assert.match(MAIN, /acpMod\.criarAcp\(\{\s*emit, spawnBin, buildEnv, matarProcesso, HOME,/, 'o main entrega o spawnBin da plataforma');
  assert.match(MAIN, /const \{ EH_WIN, acharBin, spawnBin, abrirPty, matarProcesso, temBin \} = plataforma;/);
  const plataforma = fs.readFileSync(path.join(__dirname, '..', 'src', 'plataforma.js'), 'utf8');
  assert.match(plataforma, /if \(EH_WIN && \/\\\.\(cmd\|bat\)\$\/i\.test\(alvo\)\) \{[\s\S]*?comspec, \['\/d', '\/s', '\/c', linhaWindows\(alvo, args\)\]/, 'o .cmd roda pelo cmd.exe com a linha montada e escapada por nos');
  assert.match(plataforma, /path\.join\(HOME, '\.local', 'bin'\),/, 'o .local\\bin (cursor-agent, kimi, vibe-acp, goose) esta no PATH do app');
  assert.match(plataforma, /path\.join\(appdata, 'npm'\),/, 'e o npm global (opencode, grok, copilot, qwen, cline, kilo, droid)');
});

const EH_WIN = process.platform === 'win32';
test('Windows de ponta a ponta: um .cmd no PATH, com argumentos (um com espaco), faz o aperto de mao, abre a sessao e responde um turno pelo acp.js real', { skip: !EH_WIN, timeout: 40000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cmd-')), dados = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-dados-'));
  const antes = process.env.PATH;
  try {
    const agente = [
      "const readline = require('readline');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "const enviar = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "rl.on('line', (l) => {",
      "  let m; try { m = JSON.parse(l); } catch (e) { return; }",
      "  if (m.method === 'initialize') enviar({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'ia-falsa', version: '9.9' }, authMethods: [], agentCapabilities: {} } });",
      "  else if (m.method === 'session/new') enviar({ jsonrpc: '2.0', id: m.id, result: { sessionId: 's-falsa' } });",
      "  else if (m.method === 'session/prompt') {",
      "    enviar({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's-falsa', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ola ' + process.argv.slice(2).join('|') } } } });",
      "    enviar({ jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn' } });",
      "  }",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(pasta, 'agente-falso.js'), agente);
    const nome = 'ia-falsa-5i';
    fs.writeFileSync(path.join(pasta, nome + '.cmd'), '@echo off\r\n"' + process.execPath + '" "%~dp0agente-falso.js" %*\r\n');
    process.env.PATH = pasta + path.delimiter + antes;
    const plataforma = require('../src/plataforma');
    assert.ok(plataforma.temBin(nome), 'o temBin acha o .cmd pelo nome, sem extensao');
    assert.equal(path.extname(plataforma.acharBin(nome)).toLowerCase(), '.cmd');
    const { criarAcp } = require('../src/acp');
    const eventos = [];
    const acp = criarAcp({ emit: (id, kind, data) => eventos.push({ kind, ...data }), spawnBin: plataforma.spawnBin, buildEnv: plataforma.buildEnv,
      matarProcesso: plataforma.matarProcesso, HOME: os.homedir(), pastaDados: () => dados });
    try {
      assert.equal(await acp.start('p1', { comando: nome + ' acp --flag "com espaco"', cwd: pasta }), true);
      const info = eventos.find((e) => e.kind === 'acp-info');
      assert.ok(info, 'o aperto de mao passou e o painel recebeu o acp-info');
      assert.equal(info.agente, 'ia-falsa');
      assert.equal(info.versao, '9.9');
      assert.equal(acp.enviar('p1', 'oi'), true);
      for (let i = 0; i < 200 && !eventos.some((e) => e.kind === 'turn-end'); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(eventos.some((e) => e.kind === 'turn-end'), 'o turno terminou');
      const falas = eventos.filter((e) => e.kind === 'text-final').map((e) => e.text);
      assert.equal(falas.at(-1), 'ola acp|--flag|com espaco', 'os argumentos chegaram inteiros ao agente, o do espaco inclusive');
    } finally { acp.parar('p1'); }
  } finally {
    process.env.PATH = antes;
    fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dados, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('o ambiente que o registro manda junto do comando (so o Droid) entra no processo, e so nele', async () => {
  const { criarAcp } = require('../src/acp');
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-env-'));
  const chamadas = [];
  const spawnBin = (bin, args, opts) => {
    chamadas.push({ bin, args, env: opts.env });
    return processoFalso((m, proc) => queueMicrotask(() => {
      if (m.method === 'initialize') proc.answer(m.id, { agentInfo: { name: bin }, agentCapabilities: {} });
      else if (m.method === 'session/new') proc.answer(m.id, { sessionId: 'x-' + chamadas.length });
      else if (m.id) proc.answer(m.id, {});
    }));
  };
  const acp = criarAcp({ emit() {}, spawnBin, buildEnv: () => ({ PATH: 'p' }), matarProcesso: (p) => { p.killed = true; }, HOME: os.homedir(), pastaDados: () => dados });
  try {
    await acp.start('p1', { comando: 'droid exec --output-format acp-daemon', cwd: os.tmpdir() });
    await acp.start('p2', { comando: 'opencode acp', cwd: os.tmpdir() });
    assert.deepEqual(chamadas.map((c) => [c.bin, c.args.join(' ')]), [['droid', 'exec --output-format acp-daemon'], ['opencode', 'acp']]);
    assert.equal(chamadas[0].env.DROID_DISABLE_AUTO_UPDATE, 'true');
    assert.equal(chamadas[0].env.FACTORY_DROID_AUTO_UPDATE_ENABLED, 'false');
    assert.equal(chamadas[0].env.PATH, 'p', 'o resto do ambiente segue o do app');
    assert.equal(chamadas[1].env.DROID_DISABLE_AUTO_UPDATE, undefined, 'as outras IAs nao ganham nada');
    assert.deepEqual(IAS.ambienteDoComando('droid exec --output-format acp-daemon'), { DROID_DISABLE_AUTO_UPDATE: 'true', FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false' });
    assert.equal(IAS.ambienteDoComando('opencode acp'), null);
    assert.equal(IAS.ambienteDoComando('qualquer coisa'), null);
  } finally { acp.pararTodos(); fs.rmSync(dados, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

/* ---------------------------------------------------------------------------------------------------------------------
   O menuzinho do motor (a linha das IAs) e o chip
   --------------------------------------------------------------------------------------------------------------------- */
function corpo(nome) {
  const i = APP.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'nao achei ' + nome);
  let nivel = 0;
  for (let j = APP.indexOf(') {', i) + 2; j < APP.length; j++) { if (APP[j] === '{') nivel++; else if (APP[j] === '}' && --nivel === 0) return APP.slice(i, j + 1); }
  throw new Error('nao fechei ' + nome);
}
const constDe = (assinatura, nome) => pegarBloco(APP, assinatura, nome).replace(/^const /, 'var ') + ';';
const MAPA = (() => {
  const ctx = vm.createContext({});
  const ini = APP.indexOf('const ICONES = '), fim = APP.indexOf('\n', APP.indexOf('const ico = (n) =>'));
  vm.runInContext(APP.slice(ini, fim).replace('const ICONES = ', 'var ICONES = ').replace('const ico = ', 'var ico = '), ctx);
  return ctx;
})();
const casaUm = (e, sel) => {
  sel = sel.trim();
  let m;
  if ((m = /^\[([\w-]+)\^="([^"]*)"\]$/.exec(sel))) return String(e.getAttribute(m[1]) ?? '').startsWith(m[2]);
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return e.getAttribute(m[1]) === m[2];
  if ((m = /^\[data-([\w-]+)\]$/.exec(sel))) return e.dataset[m[1]] !== undefined;
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) return e.getAttribute(m[1]) !== null;
  if (sel.startsWith('.')) return e._cls.has(sel.slice(1));
  return e.tagName === sel.toUpperCase();
};
const casa = (e, sel) => sel.split(',').some((s) => casaUm(e, s));
const ZERO = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
const PRESETS_DO_PC = ['gemini', 'claude-code', 'codex', 'opencode', 'grok-build', 'github-copilot-cli', 'cursor', 'goose'];

/* O DOM de mentira e o menuzinho do motor de verdade (cockpit-ui.js), com o app.js de verdade nos pedacos que importam (svgIa, iaDoPainel, usarIaAcp,
   novoMenu...). As trocas sao de mentira: gravam o pedido e aplicam no painel. */
function bancada({ engine = 'claude', modelo = '', disponiveis, semModulo = false, remoto = null } = {}) {
  const eventos = [], tarefas = [];
  const doc = { activeElement: null, listeners: {} };
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this._cls = new Set(); this.attrs = {}; this.ouvintes = {};
      this.dataset = {}; this.tabIndex = -1; this._html = ''; this._texto = ''; this.title = ''; this.type = ''; this.disabled = false; this.hidden = false;
      this.vars = {}; this.caixa = null; this.clientLeft = 0; this.onkeydown = null; this.onclick = null;
      const este = this;
      this.style = { setProperty(k, v) { este.vars[k] = String(v); }, getPropertyValue(k) { return este.vars[k] || ''; }, height: '' };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._cls;
      return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
        toggle: (c, on) => { const liga = on === undefined ? !s.has(c) : !!on; if (liga) s.add(c); else s.delete(c); return liga; } };
    }
    get innerHTML() { return this._html; }
    set innerHTML(h) { this._html = String(h); for (const f of this.filhos) f.pai = null; this.filhos = []; this._texto = ''; }
    get textContent() { return this._texto + this.filhos.map((f) => f.textContent).join(''); }
    set textContent(v) { for (const f of this.filhos) f.pai = null; this.filhos = []; this._html = ''; this._texto = String(v); }
    get parentNode() { return this.pai; }
    get isConnected() { let x = this; while (x.pai) x = x.pai; return x === doc.body; }
    append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? Object.assign(new El('#texto'), { _texto: n }) : n); }
    appendChild(c) { if (c.pai) c.pai.filhos = c.pai.filhos.filter((x) => x !== c); c.pai = this; this.filhos.push(c); return c; }
    replaceChildren(...ns) { for (const f of this.filhos) f.pai = null; this.filhos = []; this._html = ''; this._texto = ''; this.append(...ns); }
    remove() { if (this.pai) { this.pai.filhos = this.pai.filhos.filter((x) => x !== this); this.pai = null; } }
    contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    matches(s) { return casa(this, s); }
    querySelectorAll(sel) { const r = []; const andar = (x) => { for (const f of x.filhos) { if (casa(f, sel)) r.push(f); andar(f); } }; andar(this); return r; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
    disparar(t, extra) {
      const e = { type: t, target: this, defaultPrevented: false, parou: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; },
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...(extra || {}) };
      for (let x = this; x && !e.parou; x = x.pai) {
        for (const f of x.ouvintes[t] || []) f(e);
        if (typeof x['on' + t] === 'function' && !e.parou) x['on' + t](e);
      }
      return e;
    }
    click() { if (this.disabled) return; this.disparar('click'); }
    focus() { if (this.disabled) return; doc.activeElement = this; }
    scrollIntoView() {}
    getBoundingClientRect() { return this.caixa ? this.caixa() : ZERO; }
  }
  doc.body = new El('body'); doc.createElement = (t) => new El(t);
  const pane = new El('section'), modal = new El('div'), cx = new El('div');
  const pm = (cls) => { const b = new El('button'); b.className = 'pm-btn ' + cls; return b; };
  const motorPeca = pm('pm-motor'), modeloPeca = pm('pm-modelo'), permPeca = pm('pm-perm');
  pane.className = 'pane'; modal.className = 'modal p-modal hidden'; cx.className = 'modal-cx';
  modal.appendChild(cx); pane.appendChild(modal);
  for (const b of [motorPeca, modeloPeca, permPeca]) pane.appendChild(b);
  const pop = new El('div'), global = new El('div');
  pop.className = 'hidden'; global.className = 'hidden';
  doc.body.appendChild(pane); doc.body.appendChild(pop); doc.body.appendChild(global);
  const P = { id: 'p1', el: pane, engine, model: modelo, effort: 'medium', mode: 'manual', envio: 'fila', cwd: 'C:\\proj', abaId: 'aba1', uiContaGeracao: 0, remotoFalso: remoto };
  const cfg = { fallbackClaude: false, envioPadrao: 'fila' };
  const tudoLigado = {
    claude: { disponivel: true }, codex: { disponivel: true }, gemini: { disponivel: true }, grok: { disponivel: true },
    acp: { disponivel: true, presets: PRESETS_DO_PC },
  };
  const api = {
    motoresDisponiveis: async (lugar) => { eventos.push('disponiveis:' + (lugar ? 'vps' : 'pc')); return disponiveis || tudoLigado; },
    setConfig: () => {},
  };
  const sistema = { recusa: false };
  const aplicar = async (nome, f) => { eventos.push(nome); if (!sistema.recusa) f(); };
  const ctx = vm.createContext({
    document: doc, d: doc, panes: new Map([[P.id, P]]), focusPane: P, ICONES: MAPA.ICONES, ico: MAPA.ico, marcaDoMotor: () => '', cfg, Date, JSON, Promise, Number, String, Math, Array, Object, Set,
    MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' }[e]),
    svgMotor: (e) => '<svg data-motor="' + e + '"></svg>', window: { api, CockpitModels: Modelos, ...(semModulo ? {} : { CockpitAcpPresets: IAS }) },
    $: (sel, raiz) => (sel === '#popGrupo' ? pop : sel === '#modalGrupo' ? global : raiz ? raiz.querySelector(sel) : null),
    q: (sel, raiz) => (raiz || doc.body).querySelector(sel),
    cancelarSaidaDoModal() {}, soltarNavArquivos() {}, pararBuscaEmVoo() {}, queueMicrotask: (f) => tarefas.push(f),
    fecharModalGlobal() {}, fecharVisor() {}, fecharTerminalDoPainel() {}, fecharModal() {}, interromperPainel: () => eventos.push('parou'),
    remotoDoPane: () => P.remotoFalso, abaPorId: (id) => ({ id }), refresh: () => eventos.push('refresh'),
    // as trocas de mentira: o trocarMotor (com o comando da IA) e o trocarAgenteAcp (painel que ja e do ACP)
    trocarMotor: (p, eng, comando) => aplicar('trocarMotor:' + eng + (comando ? ':' + comando : ''), () => { p.engine = eng; p.model = comando || ''; }),
    trocarAgenteAcp: (p, cmd) => aplicar('trocarAgenteAcp:' + cmd, () => { p.model = cmd; }),
  });
  vm.runInContext([constDe('const svgIa = ', 'svgIa'), pegarBloco(APP, 'function iaDoPainel(', 'iaDoPainel'), pegarBloco(APP, 'async function usarIaAcp(', 'usarIaAcp')].join('\n'), ctx);
  vm.runInContext(['fecharPopGlobal', 'fecharMenus', 'novoMenu', 'elItem', 'elLinha', 'tituloPopup', 'subPopup', 'tratarEsc'].map(corpo).join('\n'), ctx);
  vm.runInContext(['function node(', 'function chipAncorar(', 'function chipControle(', 'function chipTeclado(', 'function chipController(', 'async function chipPintarMotor(',
    'async function chipMenu(', 'async function agentLayer('].map((a) => pegarBloco(UI, a, a)).join('\n'), ctx);
  const rodar = () => { while (tarefas.length) tarefas.shift()(); };
  const sleep = async (n = 6) => { for (let i = 0; i < n; i++) { rodar(); await tique(); } };
  const abrir = async (parte, foco) => { if (foco) foco.focus(); const m = await ctx.agentLayer(P, parte); rodar(); return m; };
  const todos = () => cx.querySelectorAll('[data-chave]');
  const por = (chave) => cx.querySelectorAll('[data-chave]').find((b) => b.dataset.chave === chave) || null;
  return { ctx, doc, El, P, pane, modal, cx, motorPeca, eventos, api, sistema, rodar, sleep, abrir, todos, por, esc: () => ctx.tratarEsc(P) };
}
const tecla = (alvo, key, extra) => alvo.disparar('keydown', { key, ...(extra || {}) });
const aberto = (t) => t.modal._cls.has('como-menu') && !t.modal._cls.has('hidden');
const marcado = (t, chave) => t.por(chave).getAttribute('aria-checked') === 'true';
const visivel = (e) => (e._texto || '') + String(e._html).replace(/<[^>]*>/g, '') + e.filhos.map(visivel).join('');

test('menuzinho do motor: depois dos 5 logos, um traco e a linha das IAs INSTALADAS, na ordem da tabela, cada uma com o nome no aria e no hover', async () => {
  const t = bancada();
  await t.abrir('engine');
  await t.sleep();
  assert.deepEqual(t.todos().map((b) => b.dataset.chave), ['motor:claude', 'motor:codex', 'motor:gemini', 'motor:grok', 'motor:acp', 'ia:opencode', 'ia:github-copilot-cli', 'ia:cursor', 'ia:goose']);
  const conteudo = t.cx.querySelector('.mz-conteudo');
  assert.deepEqual(conteudo.filhos.map((f) => [...f._cls].join(' ')), ['mz-linha mz-motores', 'mz-traco', 'mz-linha mz-ias'], 'os 5 logos, o traco e a linha das IAs');
  const traco = conteudo.filhos[1], linha = conteudo.filhos[2];
  assert.equal(traco.getAttribute('role'), 'separator');
  assert.equal(linha.getAttribute('role'), 'group');
  assert.equal(linha.getAttribute('aria-label'), 'IAs pelo ACP');
  for (const ia of ['opencode', 'github-copilot-cli', 'cursor', 'goose']) {
    const p = IAS.doId(ia), b = t.por('ia:' + ia);
    assert.equal(b.tagName, 'BUTTON'); assert.equal(b.type, 'button');
    assert.equal(b.getAttribute('role'), 'menuitemradio');
    assert.equal(b.getAttribute('aria-label'), p.nome, 'o nome no aria');
    assert.equal(b.title, p.nome, 'e no hover');
    assert.equal(b.dataset.ia, ia);
    assert.equal(b._html, IAS.logoSvg(ia), 'o logo e o SVG oficial da IA');
    assert.ok(b._cls.has('mz-icone') && b._cls.has('mz-ia-op'));
    assert.equal(marcado(t, 'ia:' + ia), false);
  }
  assert.equal(visivel(t.cx).trim(), '', 'a janelinha nao escreve nada: so logos');
  // as que nao estao instaladas (Qwen, Cline, Kilo, Droid, Kimi, Vibe) nao aparecem; o Grok e o 4o logo, nao entra de novo na linha; os adaptadores ficam de fora
  for (const fora of ['qwen-code', 'cline', 'kilo', 'factory-droid', 'kimi', 'mistral-vibe', 'grok-build', 'gemini', 'claude-code', 'codex']) assert.ok(!t.por('ia:' + fora), 'nao devia aparecer: ' + fora);
  assert.equal(marcado(t, 'motor:claude'), true, 'o motor do painel segue marcado');
});

test('menuzinho do motor: so as instaladas aparecem, e uma lista vazia, ausente ou torta nao desenha traco nem linha', async () => {
  const base = { claude: { disponivel: true }, codex: { disponivel: true }, gemini: { disponivel: true }, grok: { disponivel: true } };
  for (const acp of [{ disponivel: true, presets: [] }, { disponivel: true }, { disponivel: true, presets: 'opencode' }, { disponivel: true, presets: ['nao-existe'] }, { disponivel: true, presets: ['gemini', 'grok-build'] }, true]) {
    const t = bancada({ disponiveis: { ...base, acp } });
    await t.abrir('engine');
    await t.sleep();
    assert.equal(t.todos().length, 5, JSON.stringify(acp));
    assert.ok(!t.cx.querySelector('.mz-traco'), 'sem IA instalada da linha, sem traco');
    assert.ok(!t.cx.querySelector('.mz-ias'), 'e sem a linha');
  }
  const so = bancada({ disponiveis: { ...base, acp: { disponivel: true, presets: ['kimi', 'nao-existe', 'mistral-vibe'] } } });
  await so.abrir('engine');
  await so.sleep();
  assert.deepEqual(so.todos().slice(5).map((b) => b.dataset.chave), ['ia:kimi', 'ia:mistral-vibe'], 'id desconhecido some; as conhecidas ficam na ordem da tabela');
});

test('menuzinho do motor: sem o modulo das IAs (ou no servidor sem a lista) sao os 5 logos de sempre e o Grok troca para o motor nativo, como antes', async () => {
  const t = bancada({ semModulo: true });
  await t.abrir('engine');
  await t.sleep();
  assert.equal(t.todos().length, 5);
  assert.ok(!t.cx.querySelector('.mz-traco'), 'sem o modulo, sem traco');
  t.por('motor:grok').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), ['trocarMotor:grok'], 'sem o modulo vale o caminho nativo de sempre');
});

test('escolher uma IA num painel de outro motor poe o painel no ACP com o comando dela (trocarMotor + comando), repinta com ela marcada e o foco nela', async () => {
  const t = bancada({ engine: 'claude', modelo: 'claude-sonnet-5-5' });
  await t.abrir('engine');
  await t.sleep();
  t.por('ia:opencode').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), ['trocarMotor:acp:opencode acp'], 'o mesmo trocarMotor, ja com o comando da IA');
  assert.equal(t.P.engine, 'acp');
  assert.equal(t.P.model, 'opencode acp');
  assert.equal(marcado(t, 'ia:opencode'), true, 'a IA escolhida fica marcada');
  assert.equal(t.por('ia:opencode')._cls.has('mz-sel'), true);
  assert.equal(marcado(t, 'motor:acp'), false, 'e o plugue nao: a IA tem logo proprio');
  assert.equal(marcado(t, 'motor:claude'), false);
  assert.equal(t.doc.activeElement.dataset.chave, 'ia:opencode', 'o foco volta para o botao usado');
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, true);
  assert.ok(t.eventos.includes('refresh'), 'a Torre e a lateral sao atualizadas');
});

test('num painel que ja e do ACP, escolher outra IA so troca o agente (o caminho do menu do modelo), sem trocar de motor', async () => {
  const t = bancada({ engine: 'acp', modelo: 'opencode acp' });
  await t.abrir('engine');
  await t.sleep();
  assert.equal(marcado(t, 'ia:opencode'), true, 'a IA do painel ja abre marcada');
  assert.equal(t.doc.activeElement.dataset.chave, 'ia:opencode', 'e o foco abre nela');
  t.por('ia:opencode').click();
  await t.sleep();
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), [], 'a IA atual nao faz nada');
  t.por('ia:goose').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), ['trocarAgenteAcp:goose acp']);
  assert.equal(t.P.engine, 'acp');
  assert.equal(marcado(t, 'ia:goose'), true);
  assert.equal(marcado(t, 'ia:opencode'), false);
});

test('se a troca nao pegou, a janelinha diz que a IA anterior foi mantida e a escolha anterior segue marcada', async () => {
  const t = bancada({ engine: 'claude' });
  t.sistema.recusa = true;
  await t.abrir('engine');
  await t.sleep();
  t.por('ia:cursor').click();
  await t.sleep(10);
  assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'Esta IA não pôde ser ativada neste painel. A anterior foi mantida.');
  assert.equal(marcado(t, 'motor:claude'), true);
  assert.equal(marcado(t, 'ia:cursor'), false);
});

test('o plugue so fica marcado num painel ACP cuja IA nao tem lugar proprio: comando de outro, ou o Gemini/Claude Code/Codex pelos adaptadores', async () => {
  for (const [modelo, plugue] of [['meu-agente --acp', true], ['gemini --acp', true], ['npx -y @zed-industries/codex-acp', true], ['', true],
    ['opencode acp', false], ['grok agent stdio', false], ['cursor-agent acp', false]]) {
    const t = bancada({ engine: 'acp', modelo });
    await t.abrir('engine');
    await t.sleep();
    assert.equal(marcado(t, 'motor:acp'), plugue, JSON.stringify(modelo) + ': plugue');
  }
});

test('o Grok (4o logo) abre o ACP com "grok agent stdio": a mesma troca das outras IAs; marcado quando o painel roda esse comando; o motor nativo fica marcado se ja era o do painel', async () => {
  const t = bancada({ engine: 'claude' });
  await t.abrir('engine');
  await t.sleep();
  assert.equal(marcado(t, 'motor:grok'), false);
  t.por('motor:grok').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), ['trocarMotor:acp:grok agent stdio']);
  assert.equal(t.P.engine, 'acp');
  assert.equal(t.P.model, 'grok agent stdio');
  assert.equal(marcado(t, 'motor:grok'), true);
  assert.equal(marcado(t, 'motor:acp'), false, 'o plugue nao: o Grok tem o logo dele');
  assert.equal(t.doc.activeElement.dataset.chave, 'motor:grok');
  t.por('motor:grok').click();
  await t.sleep();
  assert.equal(t.eventos.filter((e) => e.startsWith('trocar')).length, 1, 'o Grok que ja esta em uso nao reinicia nada');
  // um painel do Grok nativo (conversa de antes desta leva) ainda aparece marcado
  const velho = bancada({ engine: 'grok' });
  await velho.abrir('engine');
  await velho.sleep();
  assert.equal(marcado(velho, 'motor:grok'), true);
  // e o Grok indisponivel (programa ausente) continua apagado, com o motivo
  const sem = bancada({ disponiveis: { claude: { disponivel: true }, codex: { disponivel: true }, gemini: { disponivel: true }, grok: { disponivel: false }, acp: { disponivel: true, presets: ['opencode'] } } });
  await sem.abrir('engine');
  await sem.sleep();
  assert.equal(sem.por('motor:grok').disabled, true);
  assert.equal(sem.por('motor:grok').title, 'Grok · indisponível · não instalado nesta máquina');
});

test('no servidor a consulta e a do servidor, e a linha mostra so as IAs que ele tem', async () => {
  const t = bancada({ remoto: { host: 'h', usuario: 'u' }, disponiveis: { claude: { disponivel: true }, codex: { disponivel: false }, gemini: { disponivel: false }, grok: { disponivel: false },
    acp: { disponivel: true, presets: ['opencode', 'goose'] } } });
  await t.abrir('engine');
  await t.sleep();
  assert.ok(t.eventos.includes('disponiveis:vps'));
  assert.deepEqual(t.todos().slice(5).map((b) => b.dataset.chave), ['ia:opencode', 'ia:goose']);
});

test('teclado: as setas passam do ultimo motor para a primeira IA e voltam, dando a volta nas pontas; Home e End; Enter e clique; Esc fecha e devolve o foco ao botao do chip', async () => {
  const t = bancada();
  await t.abrir('engine', t.motorPeca);
  await t.sleep();
  const chaveDoFoco = () => t.doc.activeElement.dataset.chave;
  assert.equal(chaveDoFoco(), 'motor:claude', 'o foco abre no motor atual');
  t.por('motor:acp').focus();
  const direita = tecla(t.doc.activeElement, 'ArrowRight');
  assert.equal(direita.defaultPrevented, true);
  assert.equal(direita.parou, true, 'a tecla tratada nao vaza para o app');
  assert.equal(chaveDoFoco(), 'ia:opencode', 'do plugue vai para a primeira IA');
  tecla(t.doc.activeElement, 'ArrowLeft');
  assert.equal(chaveDoFoco(), 'motor:acp', 'e a seta para tras volta ao plugue');
  tecla(t.doc.activeElement, 'ArrowDown');
  assert.equal(chaveDoFoco(), 'ia:opencode');
  tecla(t.doc.activeElement, 'End');
  assert.equal(chaveDoFoco(), 'ia:goose');
  tecla(t.doc.activeElement, 'ArrowRight');
  assert.equal(chaveDoFoco(), 'motor:claude', 'depois da ultima IA, a volta vai ao primeiro motor');
  tecla(t.doc.activeElement, 'ArrowLeft');
  assert.equal(chaveDoFoco(), 'ia:goose', 'e para tras do primeiro motor, vai a ultima IA');
  tecla(t.doc.activeElement, 'Home');
  assert.equal(chaveDoFoco(), 'motor:claude');
  // Enter num botao e o clique dele (o navegador faz isso sozinho): a IA focada e escolhida
  t.por('ia:cursor').focus();
  t.doc.activeElement.click();
  await t.sleep(10);
  assert.equal(t.P.model, 'cursor-agent acp');
  // Esc
  t.esc();
  assert.equal(aberto(t), false, 'Esc fechou');
  assert.ok(t.doc.activeElement === t.motorPeca, 'e o foco voltou ao botao do chip que a abriu');
});

test('itens desligados da linha sao pulados pelo teclado (a IA nao fica desligada, mas o motor indisponivel sim)', async () => {
  const t = bancada({ disponiveis: { claude: { disponivel: true }, codex: { disponivel: false }, gemini: { disponivel: false }, grok: { disponivel: false }, acp: { disponivel: true, presets: ['kimi'] } } });
  await t.abrir('engine');
  await t.sleep();
  t.por('motor:claude').focus();
  tecla(t.doc.activeElement, 'ArrowRight');
  assert.equal(t.doc.activeElement.dataset.chave, 'motor:acp', 'pula o Codex, o Gemini e o Grok apagados');
  tecla(t.doc.activeElement, 'ArrowRight');
  assert.equal(t.doc.activeElement.dataset.chave, 'ia:kimi');
});

test('CSS: a linha das IAs quebra de 5 em 5 logos (a grade dos 5 motores) e usa o mesmo botao de 32 px com o logo de 16 px', () => {
  const m = /\.ck-app \.menu-chip \.mz-ias \{([^}]*)\}/.exec(CSS_UI);
  assert.ok(m, 'falta a regra da linha das IAs');
  assert.match(m[1], /max-width:\s*calc\(5 \* 32px \+ 4 \* 2px\)/);
  assert.match(CSS_UI, /\.ck-app \.menu-chip \.mz-icone \.logo-motor \{[^}]*width:\s*16px[^}]*height:\s*16px[^}]*fill:\s*currentColor/, 'o logo (cheio) das IAs herda a regra dos logos de motor');
  assert.match(CSS_UI, /\.ck-app \.menu-chip \.mz-traco \{[^}]*height:\s*1px/, 'o traco e o mesmo da permissao');
});

/* ---------------------------------------------------------------------------------------------------------------------
   O chip: o logo da IA no lugar do plugue
   --------------------------------------------------------------------------------------------------------------------- */
function motorDoChip() {
  const dataset = {};
  const filho = () => ({ innerHTML: '', textContent: '' });
  const cab = { dataset, title: '', ...{ logo: filho(), nome: filho(), seta: filho() } };
  const motor = { innerHTML: '', title: '', ariaLabel: '', escritas: 0 };
  let html = '';
  Object.defineProperty(motor, 'innerHTML', { get: () => html, set: (v) => { html = v; motor.escritas++; } });
  const ctx = vm.createContext({ ico: () => '<ico/>', svgMotor: (e) => '<svg data-motor="' + e + '"></svg>', nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' }[e]),
    atalhoDaMaquina: (s) => s, window: { CockpitAcpPresets: IAS },
    $: (sel) => (sel === '.p-motor' ? cab : sel === '.pm-motor' ? motor : sel === '.logo-lugar' ? cab.logo : sel === '.pm-nome' ? cab.nome : sel === '.pm-seta' ? cab.seta : null) });
  vm.runInContext([constDe('const svgIa = ', 'svgIa'), pegarBloco(APP, 'function iaDoPainel(', 'iaDoPainel'), pegarBloco(APP, 'function pintarBotaoDeMotor(', 'pintarBotaoDeMotor')].join('\n'), ctx);
  return { ctx, cab, motor };
}

test('chip: num painel ACP que roda uma IA de preset o botao do motor mostra o logo dela (e nao o plugue), com o nome no hover e no aria', () => {
  const { ctx, cab, motor } = motorDoChip();
  const P = { el: {}, engine: 'acp', model: 'opencode acp' };
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.innerHTML, IAS.logoSvg('opencode'), 'o SVG oficial do OpenCode');
  assert.notEqual(motor.innerHTML, '<svg data-motor="acp"></svg>');
  assert.equal(motor.title, 'Motor: OpenCode — trocar de motor');
  assert.equal(motor.ariaLabel, 'Motor: OpenCode');
  assert.equal(cab.logo.innerHTML, IAS.logoSvg('opencode'), 'o botao do cabecalho segue junto');
  assert.equal(cab.nome.textContent, 'OpenCode');
  assert.equal(cab.dataset.motor, 'acp');
  assert.equal(cab.dataset.ia, 'opencode');
  assert.match(cab.title, /^Motor: OpenCode — clique pra trocar/);
});

test('chip: cada uma das 11 mostra o proprio logo; os adaptadores (Gemini, Claude Code, Codex) o logo do motor da mesma marca; comando proprio, o plugue', () => {
  for (const [ia, nome] of ONZE) {
    const { ctx, motor } = motorDoChip();
    ctx.pintarBotaoDeMotor({ el: {}, engine: 'acp', model: IAS.doId(ia).comando });
    assert.equal(motor.innerHTML, IAS.logoSvg(ia), ia);
    assert.equal(motor.ariaLabel, 'Motor: ' + nome, ia);
  }
  for (const [comando, logo] of [['gemini --acp', 'gemini'], ['npx -y @zed-industries/claude-code-acp', 'claude'], ['npx -y @zed-industries/codex-acp', 'codex']]) {
    const { ctx, motor } = motorDoChip();
    ctx.pintarBotaoDeMotor({ el: {}, engine: 'acp', model: comando });
    assert.equal(motor.innerHTML, '<svg data-motor="' + logo + '"></svg>', comando);
  }
  for (const model of ['meu-agente --acp', '']) {
    const { ctx, motor, cab } = motorDoChip();
    ctx.pintarBotaoDeMotor({ el: {}, engine: 'acp', model });
    assert.equal(motor.innerHTML, '<svg data-motor="acp"></svg>', 'o plugue generico: ' + JSON.stringify(model));
    assert.equal(motor.ariaLabel, 'Motor: ACP');
    assert.equal(cab.dataset.ia, undefined);
  }
  const { ctx, motor } = motorDoChip();
  ctx.pintarBotaoDeMotor({ el: {}, engine: 'claude', model: 'opencode acp' });
  assert.equal(motor.innerHTML, '<svg data-motor="claude"></svg>', 'fora do ACP o comando no model nao vira logo');
});

test('chip: so repinta quando muda o motor OU a IA (o resize nao reescreve; trocar de IA dentro do ACP e de volta ao plugue repinta)', () => {
  const { ctx, cab, motor } = motorDoChip();
  const P = { el: {}, engine: 'acp', model: 'goose acp' };
  ctx.pintarBotaoDeMotor(P);
  const escritas = motor.escritas;
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.escritas, escritas, 'mesma IA (o resize do arrasto): nada e reescrito');
  P.model = 'cline --acp';
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.escritas, escritas + 1, 'outra IA no mesmo motor: repinta');
  assert.equal(motor.innerHTML, IAS.logoSvg('cline'));
  assert.equal(cab.dataset.ia, 'cline');
  P.model = 'meu-agente --acp';
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.innerHTML, '<svg data-motor="acp"></svg>');
  assert.equal(cab.dataset.ia, undefined, 'sem IA, o data-ia sai');
  const e = motor.escritas;
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.escritas, e);
});

test('svgIa e iaDoPainel: sem o modulo ou fora do ACP, cai no logo do motor e em null, sem quebrar', () => {
  const com = vm.createContext({ window: { CockpitAcpPresets: IAS }, svgMotor: (e) => '<svg data-motor="' + e + '"></svg>' });
  const sem = vm.createContext({ window: {}, svgMotor: (e) => '<svg data-motor="' + e + '"></svg>' });
  const semWindow = vm.createContext({ svgMotor: (e) => '<svg data-motor="' + e + '"></svg>' });
  for (const c of [com, sem, semWindow]) vm.runInContext([constDe('const svgIa = ', 'svgIa'), pegarBloco(APP, 'function iaDoPainel(', 'iaDoPainel')].join('\n'), c);
  assert.equal(com.svgIa('goose'), IAS.logoSvg('goose'));
  assert.equal(com.svgIa('gemini'), '<svg data-motor="gemini"></svg>', 'adaptador: logo do motor da mesma marca');
  assert.equal(com.svgIa('nao-existe'), '<svg data-motor="acp"></svg>', 'IA desconhecida: o plugue');
  assert.equal(sem.svgIa('goose'), '<svg data-motor="acp"></svg>');
  assert.equal(semWindow.svgIa('goose'), '<svg data-motor="acp"></svg>');
  assert.equal(com.iaDoPainel({ engine: 'acp', model: 'kimi acp' }).ia, 'kimi');
  assert.equal(com.iaDoPainel({ engine: 'claude', model: 'kimi acp' }), null);
  assert.equal(com.iaDoPainel(null), null);
  assert.equal(sem.iaDoPainel({ engine: 'acp', model: 'kimi acp' }), null);
  assert.equal(semWindow.iaDoPainel({ engine: 'acp', model: 'kimi acp' }), null);
});

/* ---------------------------------------------------------------------------------------------------------------------
   trocarMotor com a IA, trocarAgenteAcp e usarIaAcp
   --------------------------------------------------------------------------------------------------------------------- */
function troca({ salvo = null, hist = [] } = {}) {
  const chamadas = [];
  const sem = () => {};
  const ctx = vm.createContext({
    window: { CockpitUI: { cancelResume() {} }, CockpitAcpPresets: IAS, api: { paneStop: async (o) => { chamadas.push(['paneStop', o.engine]); return true; }, setConfig() {} } },
    cfg: {}, remotoDoPane: () => null, motorDisponivel: { acp: true, claude: true }, COMO_INSTALAR: {}, nomeDoMotor: (e) => ({ claude: 'Claude', acp: 'ACP' }[e]),
    note: (P, t) => chamadas.push(['note', t]), capacidadeRemota: async () => true,
    guardarEstadoDoMotor: (P) => chamadas.push(['guardar', P.engine]),
    restaurarEstadoDoMotor: (P) => { P.model = salvo ? salvo.model : ''; P.resumeId = salvo ? salvo.resumeId : null; P.sessaoId = salvo ? salvo.sessaoId : null; return !!P.resumeId; },
    montarContexto: () => 'CONTEXTO', modoValido: (e, m) => m, destravarPainel: sem, pintarTokens: sem, esquecerPassos: sem, limparPlano: sem, limparAuditoria: sem, zerarTurno: sem,
    fillModels: (P) => chamadas.push(['fillModels', P.model]), paintEngine: (P) => chamadas.push(['paintEngine', P.model]), mostrarPastaNoPainel: sem, pintarModo: sem,
    setDot: sem, savePanes: sem,
    pintarBotaoDeMotor: (P) => chamadas.push(['pintarBotaoDeMotor', P.model]),
    modeloAtual: (P) => ({ nome: (IAS.doComando(P.model) || { nome: 'ACP' }).nome }),
    marcaTroca: (P, de, para) => chamadas.push(['marcaTroca', de, para]),
  });
  vm.runInContext([pegarBloco(APP, 'async function trocarMotor(', 'trocarMotor'), pegarBloco(APP, 'async function trocarAgenteAcp(', 'trocarAgenteAcp'),
    pegarBloco(APP, 'async function usarIaAcp(', 'usarIaAcp')].join('\n'), ctx);
  const painel = (extra) => ({ id: 'p1', abaId: 'a', engine: 'claude', model: 'claude-sonnet-5-5', hist, blocks: new Map(), mode: 'manual', ...extra });
  return { ctx, chamadas, painel };
}

test('trocarMotor(P, "acp", comando): o painel nasce rodando a IA escolhida, com o aviso dizendo o nome dela (e nao so "ACP")', async () => {
  const t = troca();
  const P = t.painel();
  await t.ctx.trocarMotor(P, 'acp', 'opencode acp');
  assert.equal(P.engine, 'acp');
  assert.equal(P.model, 'opencode acp');
  assert.ok(t.chamadas.some((c) => c[0] === 'paintEngine' && c[1] === 'opencode acp'), 'o paintEngine ja enxerga a IA');
  assert.deepEqual(t.chamadas.find((c) => c[0] === 'marcaTroca'), ['marcaTroca', 'Claude', 'OpenCode'], '"daqui em diante quem responde e o OpenCode (antes era o Claude)"');
  assert.ok(t.chamadas.some((c) => c[0] === 'paneStop' && c[1] === 'claude'), 'o motor de antes parou');
  // sem comando: o de sempre (o ACP generico)
  const u = troca();
  const Q = u.painel();
  await u.ctx.trocarMotor(Q, 'acp');
  assert.equal(Q.model, '');
  assert.deepEqual(u.chamadas.find((c) => c[0] === 'marcaTroca'), ['marcaTroca', 'Claude', 'ACP']);
});

test('trocarMotor com a IA: se o painel guardava OUTRO agente do ACP a sessao dele e esquecida; se guardava este mesmo, volta nela', async () => {
  const outro = troca({ salvo: { model: 'gemini --acp', resumeId: 'sessao-do-gemini', sessaoId: 'sessao-do-gemini' } });
  const P = outro.painel();
  await outro.ctx.trocarMotor(P, 'acp', 'goose acp');
  assert.equal(P.model, 'goose acp');
  assert.equal(P.resumeId, null, 'a sessao do Gemini nao serve ao Goose');
  assert.equal(P.sessaoId, null);
  assert.equal(P.passarContexto, null, 'sem conversa visivel nao ha contexto a levar');
  const mesmo = troca({ salvo: { model: 'goose acp', resumeId: 'sessao-do-goose', sessaoId: 'sessao-do-goose' }, hist: [{ quem: 'Você', texto: 'oi' }] });
  const Q = mesmo.painel();
  await mesmo.ctx.trocarMotor(Q, 'acp', 'goose acp');
  assert.equal(Q.resumeId, 'sessao-do-goose', 'voltou ao mesmo agente: retoma a conversa dele');
  assert.equal(Q.passarContexto, null, 'e nao precisa colar o contexto');
  const novo = troca({ hist: [{ quem: 'Você', texto: 'oi' }] });
  const R = novo.painel();
  await novo.ctx.trocarMotor(R, 'acp', 'kimi acp');
  assert.equal(R.passarContexto, 'CONTEXTO', 'primeira visita: a conversa visivel vai junto');
});

test('trocarAgenteAcp: para o agente, guarda o contexto, zera o que era do anterior, repinta o botao do motor e avisa; o mesmo agente nao faz nada', async () => {
  const t = troca({ hist: [{ quem: 'Você', texto: 'oi' }] });
  const P = t.painel({ engine: 'acp', model: 'gemini --acp', resumeId: 'x', sessaoId: 'x', sessaoFile: 'f', tokens: 9, started: true });
  await t.ctx.trocarAgenteAcp(P, 'gemini --acp');
  assert.deepEqual(t.chamadas, [], 'o mesmo agente: nada a trocar');
  await t.ctx.trocarAgenteAcp(P, 'cursor-agent acp');
  assert.equal(P.model, 'cursor-agent acp');
  assert.equal(P.resumeId, null); assert.equal(P.sessaoId, null); assert.equal(P.sessaoFile, '');
  assert.equal(P.started, false);
  assert.equal(P.passarContexto, 'CONTEXTO');
  assert.deepEqual(t.chamadas.find((c) => c[0] === 'marcaTroca'), ['marcaTroca', 'Gemini (ACP)', 'Cursor']);
  assert.deepEqual(t.chamadas.find((c) => c[0] === 'pintarBotaoDeMotor'), ['pintarBotaoDeMotor', 'cursor-agent acp'], 'o logo do botao do motor acompanha a IA nova');
  assert.ok(t.chamadas.findIndex((c) => c[0] === 'paneStop') < t.chamadas.findIndex((c) => c[0] === 'fillModels'), 'primeiro para o agente, depois troca');
});

test('usarIaAcp: em painel do ACP troca o agente; em outro motor troca de motor com o comando; painel morto ou comando vazio, nada', async () => {
  const t = troca();
  const acp = t.painel({ engine: 'acp', model: 'gemini --acp' });
  await t.ctx.usarIaAcp(acp, 'goose acp');
  assert.equal(acp.model, 'goose acp');
  assert.ok(!t.chamadas.some((c) => c[0] === 'guardar'), 'nao passou pelo trocarMotor');
  const claude = t.painel();
  await t.ctx.usarIaAcp(claude, 'kimi acp');
  assert.equal(claude.engine, 'acp');
  assert.equal(claude.model, 'kimi acp');
  const n = t.chamadas.length;
  await t.ctx.usarIaAcp(t.painel({ morto: true }), 'kimi acp');
  await t.ctx.usarIaAcp(t.painel(), '');
  await t.ctx.usarIaAcp(null, 'kimi acp');
  assert.equal(t.chamadas.length, n);
});

/* ---------------------------------------------------------------------------------------------------------------------
   O Grok: o CLI oficial nao fala o formato do motor nativo, entao o logo dele abre o ACP
   --------------------------------------------------------------------------------------------------------------------- */
test('Grok: o comando do ACP vem da tabela, e o app.js so o devolve com o modulo carregado (sem ele vale o nativo de sempre)', () => {
  assert.equal(IAS.GROK_COMANDO, 'grok agent stdio');
  assert.equal(IAS.doId('grok-build').comando, IAS.GROK_COMANDO);
  const com = vm.createContext({ window: { CockpitAcpPresets: IAS } }), sem = vm.createContext({ window: {} });
  for (const c of [com, sem]) vm.runInContext(pegarBloco(APP, 'function comandoDoGrokNoAcp(', 'comandoDoGrokNoAcp'), c);
  assert.equal(com.comandoDoGrokNoAcp(), 'grok agent stdio');
  assert.equal(sem.comandoDoGrokNoAcp(), '');
});

test('opcoesDoMotor: so o Grok vira um painel do ACP rodando "grok agent stdio"; os outros motores seguem com o pedido de sempre', () => {
  const com = vm.createContext({ window: { CockpitAcpPresets: IAS } }), sem = vm.createContext({ window: {} });
  for (const c of [com, sem]) vm.runInContext(pegarBloco(APP, 'function comandoDoGrokNoAcp(', 'comandoDoGrokNoAcp') + '\n' + pegarBloco(APP, 'function opcoesDoMotor(', 'opcoesDoMotor'), c);
  const resto = { cwd: 'C:\\proj', abaId: 'a1' };
  const comoTexto = (o) => JSON.stringify(o);
  assert.equal(comoTexto(com.opcoesDoMotor('grok', resto)), comoTexto({ engine: 'acp', model: 'grok agent stdio', cwd: 'C:\\proj', abaId: 'a1' }));
  for (const m of ['claude', 'codex', 'gemini', 'acp']) assert.equal(comoTexto(com.opcoesDoMotor(m, resto)), comoTexto({ engine: m, cwd: 'C:\\proj', abaId: 'a1' }), m + ': o pedido nao ganha nenhuma chave');
  assert.equal(comoTexto(sem.opcoesDoMotor('grok', resto)), comoTexto({ engine: 'grok', cwd: 'C:\\proj', abaId: 'a1' }), 'sem o modulo vale o nativo de sempre');
  assert.equal(Object.keys(resto).length, 2, 'e o objeto de quem chamou nao e alterado');
});

test('Grok: as 4 portas para uma conversa nova (menu do motor de reserva, Nova conversa da coluna, tela de abertura, e a troca no chip) abrem o ACP', () => {
  const menu = pegarBloco(APP, 'function menuMotores(', 'menuMotores');
  assert.match(menu, /const viaAcp = eng === 'grok' \? comandoDoGrokNoAcp\(\) : '';\s*if \(viaAcp\) usarIaAcp\(P, viaAcp\); else trocarMotor\(P, eng\);/);
  const nova = pegarBloco(APP, 'async function novaConversa(', 'novaConversa');
  assert.match(nova, /const comandoNovo = engine === 'grok' \? comandoDoGrokNoAcp\(\) : '';\s*if \(comandoNovo\) engine = 'acp';/);
  assert.match(nova, /newPane\(\{ engine, cwd: cwdPadraoDaAba\(abaNova\), abaId: abaIdNova, \.\.\.\(comandoNovo \? \{ model: comandoNovo \} : \{\}\) \}\)/, 'o painel novo so ganha o model quando e o Grok: para os outros o pedido segue igual');
  assert.match(nova, /if \(comandoNovo\) P\.model = comandoNovo;/);
  assert.ok(nova.indexOf('motorDisponivel[engine] === false') < nova.indexOf("if (comandoNovo) engine = 'acp'"), 'a checagem de instalado usa o Grok, antes de virar ACP');
  assert.match(APP, /for \(const m of \[\.\.\.quais\]\.reverse\(\)\) newPane\(opcoesDoMotor\(m, \{ cwd: cwdPadraoDaAba\(abaAtual\(\)\), abaId: cfg\.abaAtiva \}\)\);/,
    'a tela de abertura segue criando de tras pra frente (o sessao-nova-na-esquerda vigia isso), agora pelo opcoesDoMotor');
  assert.match(UI, /usarIaAcp\(p, IAS\.GROK_COMANDO\)/);
});

test('Grok: o motor nativo nao entende o que o CLI oficial 1.0.50 manda (uma atualizacao de sessao do ACP por linha): nada apareceria na tela', () => {
  const cliEvento = vm.createContext({});
  vm.runInContext(pegarBloco(MAIN, 'function cliEvento(', 'cliEvento'), cliEvento);
  const st = { engine: 'grok', msgId: null, acc: '' };
  // o que o "grok --output-format streaming-json" escreve, por linha (ACP): uma atualizacao de sessao, sem o campo "type" que o cliEvento le
  const linhas = [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ola' } }, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls' },
    { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ola' } } } }];
  for (const l of linhas) assert.equal(cliEvento.cliEvento('p1', st, l), undefined);
  assert.equal(st.msgId, null, 'nenhuma fala foi aberta');
  assert.equal(st.acc, '');
  // e o que o nativo manda ao CLI: o prompt pelo stdin e --session-id em TODA mensagem (o oficial so aceita --session-id numa conversa NOVA)
  const bloco = MAIN.slice(MAIN.indexOf('  grok: {\n    nome: \'Grok\''), MAIN.indexOf('const ehCli ='));
  assert.match(bloco, /porStdin: true/);
  assert.match(bloco, /const a = \['--output-format', 'streaming-json'\];/);
  assert.match(bloco, /if \(o\.sessao\) a\.push\('--session-id', o\.sessao\);/);
});

/* rodada 2 da leva 5i: o arquivo novo da leva (a tabela das IAs do ACP, que a tela, o main, o acp.js e o servidor leem) nao estava na lista dos arquivos
   novos do empacotador: o empacotar.mjs recusava empacotar ("Declare explicitamente os arquivos novos") sem o --novos. */
test('o empacotador declara o arquivo novo da tabela das IAs (renderer/acp-presets.js)', () => {
  const empacotar = fs.readFileSync(path.join(__dirname, '..', 'tools', 'auditoria', 'empacotar.mjs'), 'utf8');
  assert.match(empacotar, /'renderer\/acp-presets\.js'/);
  // e o que o app carrega de verdade: o index.html e o arquivo existem
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', 'acp-presets.js')));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8'), /<script src="acp-presets\.js"><\/script>/);
});

// a copia publica (GitHub) leva so' src, testes, test e tools: sem a pasta docs, este teste e' pulado
const SPEC_LEVA5I = path.join(__dirname, '..', 'docs', 'superpowers', 'specs', '2026-10-09-leva5i-ias-navegador-organograma-barra-design.md');
test('a spec registra a decisao do Grok e que o campo "ambiente" por preset ficou para depois (cofre cifrado)', { skip: !fs.existsSync(SPEC_LEVA5I) && 'sem a pasta docs (copia publica)' }, () => {
  const spec = fs.readFileSync(SPEC_LEVA5I, 'utf8');
  assert.match(spec, /grok agent stdio/);
  assert.match(spec, /streaming-json/);
  assert.match(spec, /cofre cifrado/);
});
