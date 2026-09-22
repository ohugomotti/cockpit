'use strict';
/* Mutirao dos nomes (tools/nomes/mutirao.js) e o que ele precisa nao quebrar.

   Duas frentes:
   1) o mutirao: quais arquivos ele escolhe (janela de dias, ja tem nome, robo),
      os DOIS formatos de .jsonl (Claude e Codex nao se parecem), a gravacao que
      nunca pisa no nome que voce deu, o teto de 2 em paralelo, a parada nos 5
      erros seguidos e o --simular, que nao chama modelo nem grava;
   2) o gatilho da tela: o nome de 3 palavras vale pra TODO motor. Isto aqui e'
      trava: se alguem puser um `engine !== 'claude'` de volta no caminho do
      titulo automatico, ou fizer o nome do app do Codex esconder o do Cockpit,
      estes testes caem. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const M = require('../tools/nomes/mutirao');
const T = require('../src/titulo-auto');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-mutirao-'));
const CLAUDE = path.join(RAIZ, 'claude', 'projects', 'C--Users-hugom-projeto');
const CODEX = path.join(RAIZ, 'codex', 'sessions', '2026', '09', '21');
const NOMES = path.join(RAIZ, 'userData', 'nomes.json');
for (const d of [CLAUDE, CODEX, path.dirname(NOMES)]) fs.mkdirSync(d, { recursive: true });
test.after(() => { try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {} });

const AGORA = Date.parse('2026-09-21T12:00:00Z');
const DIAS = (n) => AGORA - n * 24 * 60 * 60 * 1000;

/* ---------- fabricas de arquivo, no formato REAL de cada motor ---------- */
function arquivoClaude(sid, falas, quando) {
  const linhas = [JSON.stringify({ type: 'ai-title', aiTitle: 'titulo do CLI', sessionId: sid })];
  for (const f of falas) linhas.push(JSON.stringify({ ...f, sessionId: sid, entrypoint: f.entrypoint || 'cockpit' }));
  const f = path.join(CLAUDE, sid + '.jsonl');
  // enchimento: varrerConversas ignora arquivo com menos de 300 bytes
  fs.writeFileSync(f, linhas.join('\n') + '\n' + JSON.stringify({ type: 'enchimento', x: 'y'.repeat(320) }) + '\n');
  if (quando) fs.utimesSync(f, new Date(quando), new Date(quando));
  return f;
}
const falaClaude = (texto, extra) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: texto }] }, ...(extra || {}) });

function arquivoCodex(sid, falas, quando, originator) {
  const linhas = [JSON.stringify({ type: 'session_meta', payload: { id: sid, session_id: sid, cwd: 'C:\\x', originator: originator || 'Codex Desktop' } })];
  for (const f of falas) linhas.push(JSON.stringify(f));
  const f = path.join(CODEX, 'rollout-2026-09-21T10-00-00-' + sid + '.jsonl');
  fs.writeFileSync(f, linhas.join('\n') + '\n' + JSON.stringify({ type: 'enchimento', x: 'y'.repeat(320) }) + '\n');
  if (quando) fs.utimesSync(f, new Date(quando), new Date(quando));
  return f;
}
const falaCodex = (texto) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: texto }] } });

const U = (n) => '0000000' + n + '-aaaa-4bbb-8ccc-dddddddddddd';
const V7 = (n) => '01a0bbf' + n + '-871a-7521-926a-30ec39004f76';

/* =====================================================================
   1) ler o 1o pedido de cada formato
   ===================================================================== */
test('mutirao: le o 1o pedido do Claude (lista de blocos ou string) e pula sub-agente, meta e ferramenta', async () => {
  const a = arquivoClaude(U(1), [
    falaClaude('fala de sub-agente que nao e sua', { isSidechain: true }),
    falaClaude('Continue from where you left off.', { isMeta: true }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'saida de ferramenta' }] } },
    falaClaude('<system-reminder>lembrete tecnico</system-reminder>'),
    falaClaude('preciso subir uma campanha de remarketing no meta ads'),
  ], DIAS(1));
  const r = await M.lerConversa(a, 'claude');
  assert.equal(r.id, U(1), 'o id vem do sessionId de dentro do arquivo');
  assert.equal(r.prompt, 'preciso subir uma campanha de remarketing no meta ads');

  // content como string crua (formato antigo) tambem vale
  const b = arquivoClaude(U(2), [{ type: 'user', message: { role: 'user', content: 'arruma o rodape da pagina' } }], DIAS(1));
  assert.equal((await M.lerConversa(b, 'claude')).prompt, 'arruma o rodape da pagina');
});

test('mutirao: le o 1o pedido do Codex e pula o contexto que o app-server injeta', async () => {
  const a = arquivoCodex(V7(1), [
    falaCodex('<recommended_plugins>\n- Dropbox\n</recommended_plugins>'),
    falaCodex('<environment_context>\n  <current_date>2026-09-20</current_date>\n</environment_context>'),
    falaCodex('arruma o bug do login do nexfin'),
  ], DIAS(1));
  const r = await M.lerConversa(a, 'codex');
  assert.equal(r.id, V7(1), 'o id vem do session_meta (o mesmo do nome do arquivo e da tabela threads)');
  assert.equal(r.prompt, 'arruma o bug do login do nexfin');
  assert.equal(r.origem, 'Codex Desktop');
});

test('mutirao: sub-agente "guardian" do Codex e o smoke do proprio Cockpit nao sao demanda', () => {
  assert.equal(M.ehTecnico('The following is the Codex agent history whose request action you are assessing.'), true);
  assert.equal(M.ehTecnico('Responda apenas COCKPIT_111_OK. Não use ferramentas.'), true);
  assert.equal(M.ehTecnico('# AGENTS.md instructions for C:\\Users\\hugom <INSTRUCTIONS>'), true);
  assert.equal(M.ehTecnico('arruma o bug do login'), false);
  assert.equal(M.ROBO.test('cockpit-safe-smoke'), true);
  assert.equal(M.ROBO.test('codex_exec'), true);
  assert.equal(M.ROBO.test('Codex Desktop'), false, 'Codex Desktop e voce, nao robo');
  assert.equal(M.ROBO.test('cockpit'), false);
});

test('mutirao: o enfeite que o Cockpit monta sai antes de virar titulo (igual ao semContexto do main)', () => {
  assert.equal(M.semContexto('bla bla\n\nAgora, o novo pedido: refaz a capa'), 'refaz a capa');
  assert.equal(M.semContexto('refaz a capa\n\nArquivos que anexei (abra cada um):\n- C:\\x.png'), 'refaz a capa');
});

/* a regra de "/comando" e "continue" tem que ser a MESMA da tela: se alguem
   mexer numa e nao na outra, o mutirao batizaria o que a tela recusa */
test('mutirao: soComandoOuContinue e' + ' identico ao do app.js', () => {
  const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const i = APP.indexOf('function soComandoOuContinue(');
  assert.notEqual(i, -1);
  const fim = APP.indexOf('\n}', i);
  const ctx = vm.createContext({});
  vm.runInContext(APP.slice(i, fim + 2), ctx);
  const casos = ['/compact', '/model sonnet', 'continue', 'Continua.', 'prossiga', 'segue', '', '   ',
    'arruma o bug do login', 'continue a campanha do pedro', 'continuar com o plano de midia'];
  for (const c of casos) {
    assert.equal(M.soComandoOuContinue(c), ctx.soComandoOuContinue(c), 'divergiu em: ' + JSON.stringify(c));
  }
});

/* =====================================================================
   2) escolher o que nomear
   ===================================================================== */
test('mutirao: escolhe so os ultimos N dias e so quem nao tem nome; nome SEU e automatico ficam de fora', () => {
  const achados = [
    { arquivo: 'a', mtime: DIAS(1), idArquivo: U(3), motor: 'claude' },
    { arquivo: 'b', mtime: DIAS(9), idArquivo: U(4), motor: 'claude' },     // velha
    { arquivo: 'c', mtime: DIAS(2), idArquivo: U(5), motor: 'codex' },      // ja tem nome seu
    { arquivo: 'd', mtime: DIAS(3), idArquivo: U(6), motor: 'codex' },      // ja tem nome automatico
    { arquivo: 'e', mtime: DIAS(4), idArquivo: '', motor: 'claude' },       // sem id
  ];
  const nomes = { [U(5)]: 'Nome que eu dei', _auto: { [U(6)]: 'Tres Palavras Auto' } };
  const { dentro, fora } = M.escolher(achados, nomes, AGORA, 7);
  assert.deepEqual(dentro.map((x) => x.arquivo), ['a']);
  const porque = Object.fromEntries(fora.map((x) => [x.arquivo, x.porque]));
  assert.deepEqual(porque, { b: 'velha', c: 'ja-tem-nome-seu', d: 'ja-tem-nome-auto', e: 'sem-id' });
});

test('mutirao: a janela de dias e configuravel e a lista vem do mais recente pro mais antigo', () => {
  const achados = [
    { arquivo: 'velha', mtime: DIAS(20), idArquivo: U(7), motor: 'claude' },
    { arquivo: 'meia', mtime: DIAS(10), idArquivo: U(8), motor: 'claude' },
    { arquivo: 'nova', mtime: DIAS(1), idArquivo: U(9), motor: 'claude' },
  ];
  assert.deepEqual(M.escolher(achados, {}, AGORA, 7).dentro.map((x) => x.arquivo), ['nova']);
  assert.deepEqual(M.escolher(achados, {}, AGORA, 30).dentro.map((x) => x.arquivo), ['nova', 'meia', 'velha']);
});

test('mutirao: o id de reserva sai do nome do arquivo em cada motor', () => {
  assert.equal(M.idDoNome(U(1) + '.jsonl', 'claude'), U(1));
  assert.equal(M.idDoNome('rollout-2026-09-21T10-00-00-' + V7(2) + '.jsonl', 'codex'), V7(2));
});

/* =====================================================================
   3) o mutirao rodando (com gerador falso: nao sobe modelo nenhum)
   ===================================================================== */
const rodar = (extra) => M.mutirao({
  claude: path.join(RAIZ, 'claude', 'projects'),
  codex: path.join(RAIZ, 'codex', 'sessions'),
  nomes: NOMES, agora: AGORA, dias: 7, pausaMs: 0, fala: () => {}, ...(extra || {}),
});
const noDisco = () => { try { return JSON.parse(fs.readFileSync(NOMES, 'utf8')); } catch { return {}; } };

test('mutirao: grava em _auto, preserva o que ja estava e nunca pisa no nome que voce deu', async () => {
  fs.rmSync(CLAUDE, { recursive: true, force: true }); fs.mkdirSync(CLAUDE, { recursive: true });
  fs.rmSync(CODEX, { recursive: true, force: true }); fs.mkdirSync(CODEX, { recursive: true });
  arquivoClaude(U(1), [falaClaude('preciso subir uma campanha de remarketing')], DIAS(1));
  arquivoCodex(V7(1), [falaCodex('arruma o bug do login do nexfin')], DIAS(2));
  arquivoClaude(U(5), [falaClaude('essa aqui eu ja batizei na mao')], DIAS(1));

  // o que JA existe no arquivo tem que sobreviver ao mutirao
  fs.writeFileSync(NOMES, JSON.stringify({
    [U(5)]: 'Nome que eu dei', 'outra-conversa': 'Outro nome meu',
    _auto: { 'ja-existia': 'Nome Automatico Antigo' },
  }));

  const r = await rodar({ gerar: async (texto) => ({ titulo: /login/.test(texto) ? 'Bug Login Nexfin' : 'Campanha Remarketing Meta', motivo: 'ok', ms: 10 }) });
  assert.equal(r.nomeadas, 2, JSON.stringify(r));
  const n = noDisco();
  assert.equal(n[U(5)], 'Nome que eu dei', 'o nome seu continua intacto');
  assert.equal(n['outra-conversa'], 'Outro nome meu');
  assert.equal(n._auto['ja-existia'], 'Nome Automatico Antigo', 'o automatico que ja existia nao se perde');
  assert.equal(n._auto[U(1)], 'Campanha Remarketing Meta');
  assert.equal(n._auto[V7(1)], 'Bug Login Nexfin', 'a conversa do CODEX tambem ganha nome');
  assert.equal(n._auto[U(5)], undefined, 'quem ja tinha nome seu nem foi pro modelo');

  // rodar de novo nao regrava nada: todas ja tem nome
  const r2 = await rodar({ gerar: async () => { throw new Error('nao era pra chamar'); } });
  assert.equal(r2.nomeadas, 0);
  assert.deepEqual(noDisco(), n);
});

test('mutirao: --simular mostra a pauta, nao chama modelo e nao encosta no arquivo', async () => {
  const antes = fs.readFileSync(NOMES, 'utf8');
  arquivoClaude(U(2), [falaClaude('refaz a pagina de vendas do manual do comercial')], DIAS(1));
  const linhas = [];
  const r = await rodar({ simular: true, fala: (s) => linhas.push(s), gerar: async () => { throw new Error('nao era pra chamar'); } });
  assert.equal(r.simuladas, 1);
  assert.equal(r.nomeadas, 0);
  assert.equal(fs.readFileSync(NOMES, 'utf8'), antes, 'o nomes.json nao foi tocado');
  assert.match(linhas.join('\n'), /refaz a pagina de vendas/);
  assert.match(linhas.join('\n'), /SIMULACAO/);
});

test('mutirao: "/comando" e "continue" nao viram nome; conversa de robo fica de fora', async () => {
  fs.writeFileSync(NOMES, JSON.stringify({}));
  fs.rmSync(CLAUDE, { recursive: true, force: true }); fs.mkdirSync(CLAUDE, { recursive: true });
  fs.rmSync(CODEX, { recursive: true, force: true }); fs.mkdirSync(CODEX, { recursive: true });
  arquivoClaude(U(3), [falaClaude('/compact')], DIAS(1));
  arquivoClaude(U(4), [falaClaude('continue')], DIAS(1));
  arquivoCodex(V7(3), [falaCodex('roda o radar diario')], DIAS(1), 'codex_exec');
  arquivoCodex(V7(4), [falaCodex('Responda apenas COCKPIT_111_OK. Não use ferramentas.')], DIAS(1), 'cockpit');
  const r = await rodar({ simular: true });
  assert.equal(r.simuladas, 0, 'nenhuma delas e demanda: ' + JSON.stringify(r.pauta.map((p) => p.prompt)));
  // com --robos o do codex_exec entra (o smoke continua fora: e texto tecnico)
  const r2 = await rodar({ simular: true, robos: true });
  assert.deepEqual(r2.pauta.map((p) => p.prompt), ['roda o radar diario']);
});

test('mutirao: no maximo 2 no ar ao mesmo tempo', async () => {
  fs.writeFileSync(NOMES, JSON.stringify({}));
  fs.rmSync(CLAUDE, { recursive: true, force: true }); fs.mkdirSync(CLAUDE, { recursive: true });
  fs.rmSync(CODEX, { recursive: true, force: true }); fs.mkdirSync(CODEX, { recursive: true });
  for (let i = 1; i <= 6; i++) arquivoClaude(U(i), [falaClaude('demanda numero ' + i + ' pra nomear agora')], DIAS(1));
  let vivos = 0, pico = 0;
  const r = await rodar({
    gerar: async () => {
      vivos++; pico = Math.max(pico, vivos);
      await new Promise((ok) => setTimeout(ok, 8));
      vivos--;
      return { titulo: 'Nome De Teste', motivo: 'ok', ms: 8 };
    },
  });
  assert.equal(r.nomeadas, 6);
  assert.equal(pico, 2, 'subiu ' + pico + ' de uma vez; o teto e 2');
  assert.equal(M.JUNTOS, 2);
});

test('mutirao: para sozinho depois de 5 erros seguidos (rate limit) e nao perde o que ja gravou', async () => {
  fs.writeFileSync(NOMES, JSON.stringify({}));
  fs.rmSync(CLAUDE, { recursive: true, force: true }); fs.mkdirSync(CLAUDE, { recursive: true });
  fs.rmSync(CODEX, { recursive: true, force: true }); fs.mkdirSync(CODEX, { recursive: true });
  for (let i = 1; i <= 9; i++) arquivoClaude(U(i), [falaClaude('demanda numero ' + i + ' pra nomear agora')], DIAS(i === 1 ? 0.1 : 1));
  let n = 0;
  const r = await rodar({
    gerar: async () => {
      n++;
      if (n === 1) return { titulo: 'Primeiro Nome Ok', motivo: 'ok', ms: 5 };
      return { titulo: '', motivo: 'motor', ms: 5 };
    },
  });
  assert.equal(r.parou, true, 'tinha que ter parado sozinho');
  assert.equal(r.nomeadas, 1);
  assert.ok(n < 9, 'nao pode ter tentado as 9: parou em ' + n);
  assert.equal(Object.keys(noDisco()._auto).length, 1, 'o que deu certo antes do rate limit ficou gravado');

  // "resposta torta" NAO e erro de cota: o mutirao segue em frente
  fs.writeFileSync(NOMES, JSON.stringify({}));
  const r2 = await rodar({ gerar: async () => ({ titulo: '', motivo: 'resposta-torta', ms: 5 }) });
  assert.equal(r2.parou, false);
  assert.equal(r2.puladas, 9);
  assert.equal(M.ehErro('motor'), true);
  assert.equal(M.ehErro('prazo'), true);
  assert.equal(M.ehErro('codigo-127'), true);
  assert.equal(M.ehErro('resposta-torta'), false);
});

test('mutirao: nome SEU que chega no meio do mutirao nao e atropelado', async () => {
  fs.writeFileSync(NOMES, JSON.stringify({}));
  fs.rmSync(CLAUDE, { recursive: true, force: true }); fs.mkdirSync(CLAUDE, { recursive: true });
  fs.rmSync(CODEX, { recursive: true, force: true }); fs.mkdirSync(CODEX, { recursive: true });
  arquivoClaude(U(1), [falaClaude('essa vai ser renomeada no meio do caminho')], DIAS(1));
  const r = await rodar({
    gerar: async () => {
      // o Cockpit, aberto, gravou um nome seu enquanto o Haiku pensava
      fs.writeFileSync(NOMES, JSON.stringify({ [U(1)]: 'Nome que eu dei agora' }));
      return { titulo: 'Tres Palavras Auto', motivo: 'ok', ms: 5 };
    },
  });
  assert.equal(r.nomeadas, 0);
  assert.equal(noDisco()[U(1)], 'Nome que eu dei agora');
  assert.equal((noDisco()._auto || {})[U(1)], undefined);
});

test('mutirao: gravacao segura -- temporario + rename, com copia de seguranca e sem .tmp sobrando', () => {
  const alvo = path.join(RAIZ, 'grava', 'nomes.json');
  assert.equal(M.gravarSeguro(alvo, '{"a":1}'), true);
  assert.equal(fs.readFileSync(alvo, 'utf8'), '{"a":1}');
  assert.equal(fs.existsSync(alvo + '.tmp'), false, 'o temporario nao pode ficar pra tras');
  M.gravarSeguro(alvo, '{"a":2}');
  assert.equal(fs.readFileSync(alvo + '.bak', 'utf8'), '{"a":1}', 'a versao anterior fica no .bak');
});

test('mutirao: bandeiras da linha de comando', () => {
  assert.deepEqual(M.lerArgumentos(['--simular']), { simular: true });
  const o = M.lerArgumentos(['--dias', '14', '--limite', '30', '--robos']);
  assert.equal(o.dias, 14); assert.equal(o.limite, 30); assert.equal(o.robos, true); assert.equal(o.simular, false);
  assert.equal(M.lerArgumentos(['--dias', 'abacaxi']).dias, M.DIAS_PADRAO, 'valor torto volta pro padrao');
});

/* o titulo tem que sair IGUAL ao da tela: se alguem escrever um segundo prompt
   ou um segundo pos-processamento aqui, os dois caminhos comecam a divergir */
test('mutirao: usa o gerador do app, sem prompt proprio nem pos-processamento proprio', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nomes', 'mutirao.js'), 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/src\/titulo-auto'\)/);
  assert.match(src, /T\.gerarTitulo\(/, 'quem gera e o gerador do app');
  assert.ok(!src.includes('EXATAMENTE 3 palavras'), 'prompt proprio: nao');
  assert.ok(!/function\s+posProcessar/.test(src), 'pos-processamento proprio: nao');
  assert.ok(!src.includes('claude-haiku'), 'o modelo e escolha do titulo-auto.js, nao daqui');
  // e o dep entregue ao gerador tem tudo que o rodarUmaVez pede
  const dep = M.dependencias(RAIZ);
  for (const k of ['spawn', 'bin', 'env', 'matar', 'arqSettings', 'cwd']) assert.ok(dep[k], 'falta dep.' + k);
  assert.deepEqual(JSON.parse(fs.readFileSync(dep.arqSettings(), 'utf8')), { disableAllHooks: true, alwaysThinkingEnabled: false });
});

/* =====================================================================
   4) TAREFA 1: o nome de 3 palavras vale pra TODO motor
   ===================================================================== */
const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
function funcaoApp(nome) {
  const inicio = APP.indexOf('function ' + nome + '(');
  assert.notEqual(inicio, -1, 'nao achei ' + nome);
  const abre = APP.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    if (APP[i] === '}' && --nivel === 0) return APP.slice(APP.slice(inicio - 6, inicio) === 'async ' ? inicio - 6 : inicio, i + 1);
  }
  throw new Error('funcao incompleta: ' + nome);
}
function telaDoMotor() {
  const renomeados = [], pedidos = [];
  const ctx = vm.createContext({
    cfg: {}, histCache: {}, renomeados, pedidos,
    window: { api: {
      renomear: async (o) => { renomeados.push(o); return true; },
      tituloAuto: (o) => { pedidos.push(o); return Promise.resolve({ titulo: 'Bug Login Nexfin', motivo: 'ok' }); },
      sessionTitulo: async () => '',
    } },
    $: () => null, loadHist: () => {}, savePanes: () => {}, pintarNome: () => {}, remotoDoPane: () => null,
    setTimeout, clearTimeout, Promise, Date, Math, String, JSON, Object, Array, Set, Map, RegExp, console,
  });
  const i = APP.indexOf('const PALAVRA_VAZIA'), j = APP.indexOf('function tituloCurto(');
  vm.runInContext(APP.slice(i, j), ctx);
  vm.runInContext('const PALAVRAS_DO_NOME = 3;', ctx);
  vm.runInContext(['tituloCurto', 'soComandoOuContinue', 'tituloCurto3', 'podeGerarTituloAuto',
    'iniciarTituloAuto', 'gravarNomeDoPainel', 'esquecerTituloAuto', 'aoNascerSessao'].map(funcaoApp).join('\n'), ctx);
  return ctx;
}

test('tela: conversa nova de QUALQUER motor pede e grava o nome de 3 palavras', async () => {
  for (const engine of ['claude', 'codex', 'gemini', 'grok', 'acp']) {
    const c = telaDoMotor();
    const P = { id: 'p1', engine, el: {}, titulo: '', hist: [], resumeId: null, sessaoId: null, forkPendente: false, nomeManual: false };
    assert.equal(c.podeGerarTituloAuto(P, 'arruma o bug do login do nexfin'), true, engine + ': o gatilho barrou');
    await c.iniciarTituloAuto(P, 'arruma o bug do login do nexfin');
    assert.equal(c.pedidos.length, 1, engine + ': nao pediu o titulo');
    assert.equal(P.titulo, 'Bug Login Nexfin', engine + ': ficou com ' + P.titulo);
    assert.equal(P.tituloAuto, true, engine);
    // o endereco da conversa so' chega no evento 'sessao' -- e' ele que dispara a gravacao
    assert.equal(c.renomeados.length, 0, engine + ': gravou sem endereco');
    c.aoNascerSessao(P, { id: 'conversa-do-' + engine, file: 'x' });
    await new Promise((ok) => setTimeout(ok, 5));
    assert.deepEqual(JSON.parse(JSON.stringify(c.renomeados)),
      [{ engine, id: 'conversa-do-' + engine, nome: 'Bug Login Nexfin', auto: true, remoto: null }],
      engine + ': nao gravou o nome na conversa');
  }
});

/* O 'engine !== claude' que sobrou e' o do buscarNome, e ele e' OUTRA coisa: le
   o aiTitle que so' o Claude Code escreve no arquivo. Fica documentado aqui pra
   ninguem confundir com o gatilho do nome de 3 palavras. */
test('tela: o engine !== claude que sobrou e so do aiTitle, e o main confirma isso', () => {
  const b = funcaoApp('buscarNome');
  assert.match(b, /P\.engine !== 'claude'/, 'o buscarNome continua so no Claude (de proposito)');
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const i = MAIN.indexOf("ipcMain.handle('sessions:titulo'");
  assert.match(MAIN.slice(i, i + 300), /if \(engine !== 'claude'\) return '';/,
    'o main devolve vazio pra outro motor: por isso ler o aiTitle fora do Claude nao adiantaria');
  // e o gatilho do nome de 3 palavras NAO pode ter motor nenhum no caminho
  for (const nome of ['podeGerarTituloAuto', 'iniciarTituloAuto', 'gravarNomeDoPainel']) {
    assert.ok(!/engine (!==|===) '(claude|codex|gemini|grok|acp)'/.test(funcaoApp(nome)),
      nome + ' nao pode olhar o motor: o nome de 3 palavras vale pra todos');
  }
});

/* =====================================================================
   5) TAREFA 1: a lista do Codex mostra o nome do Cockpit
   ===================================================================== */
/* O Codex 0.155 batiza a thread sozinho. Enquanto esse nome contava como "seu",
   o de 3 palavras do Cockpit era gravado mas ficava invisivel na lista -- e a
   linha vinha marcada como "nome seu", o que travava o painel reaberto. */
function codexSessionsIsolado(o) {
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const i = MAIN.indexOf('function codexSessions(');
  assert.notEqual(i, -1);
  const abre = MAIN.indexOf('{', i);
  let nivel = 0, fim = -1;
  for (let k = abre; k < MAIN.length; k++) {
    if (MAIN[k] === '{') nivel++;
    if (MAIN[k] === '}' && --nivel === 0) { fim = k + 1; break; }
  }
  const ctx = vm.createContext({
    varrerConversas: (_d, achados) => { achados.push({ f: 'arq.jsonl', mtime: 1, size: 9, id: 'do-arquivo' }); },
    CODEX_SESS: 'x', HOME: 'C:\\Users\\hugom',
    fichaCodex: () => ({ title: 'primeira mensagem do arquivo', cwd: '', entrada: 'cockpit', sid: 'thread-1' }),
    lerNomes: () => o.nomes, gravarIndice: () => {},
    ORIGENS_DE_GENTE: ['cockpit'], tituloAuto: T, Object, Array, String,
  });
  vm.runInContext(MAIN.slice(i, fim), ctx);
  return ctx.codexSessions(true, o.doApp || {})[0];
}

test('main: na lista do Codex o nome de 3 palavras do Cockpit vence o nome que o proprio Codex se deu', () => {
  // so' o nome automatico do Codex: e' ele quem aparece
  let l = codexSessionsIsolado({ nomes: {}, doApp: { 'thread-1': 'Comando sleep em segundo plano' } });
  assert.equal(l.title, 'Comando sleep em segundo plano');
  assert.equal(l.nome, undefined, 'o nome do app do Codex nao e "nome seu"');
  assert.equal(l.tituloAuto, true, 'e automatico: o painel reaberto sabe que pode ser trocado');

  // com o de 3 palavras do Cockpit gravado, e' ELE que aparece
  l = codexSessionsIsolado({ nomes: { _auto: { 'thread-1': 'Bug Login Nexfin' } }, doApp: { 'thread-1': 'Comando sleep em segundo plano' } });
  assert.equal(l.title, 'Bug Login Nexfin', 'o de 3 palavras do Cockpit ficou escondido pelo nome do Codex');
  assert.equal(l.tituloAuto, true);
  assert.equal(l.nome, undefined);

  // o nome que VOCE deu continua vencendo os dois
  l = codexSessionsIsolado({ nomes: { 'thread-1': 'Nome que eu dei', _auto: { 'thread-1': 'Bug Login Nexfin' } }, doApp: { 'thread-1': 'Comando sleep em segundo plano' } });
  assert.equal(l.title, 'Nome que eu dei');
  assert.equal(l.nome, 'Nome que eu dei');
  assert.equal(l.tituloAuto, undefined);

  // sem nome nenhum: sobra a 1a mensagem do arquivo
  l = codexSessionsIsolado({ nomes: {}, doApp: {} });
  assert.equal(l.title, 'primeira mensagem do arquivo');
  assert.equal(l.tituloAuto, undefined);
  assert.equal(l.id, 'thread-1', 'a chave do nomes.json e o id de dentro do arquivo');
});
