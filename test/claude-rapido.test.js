'use strict';
/* Tarefa 1 (26/09): executor unico do "claude -p" rapido, fora de painel.
   Molde do Claude falso de test/titulo-auto.test.js (spawn falso que grava
   argv, env e stdin), com um roteiro a mais: o modulo tambem chama
   "claude auth status" antes de cada pedido (cacheado por 10 min), entao o
   spawn falso aqui despacha pelos dois formatos de argv (['auth','status'] e
   ['-p', ...]). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { criarClaudeRapido, ambienteLimpo } = require('../src/claude-rapido');

/* pastas temporarias (settings do executor): uma lista pra limpar tudo no
   final, em vez de espalhar rmSync por teste (molde de test/titulo-auto.test.js). */
const PASTAS_TMP = [];
function pastaTemp() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-rapido-'));
  PASTAS_TMP.push(p);
  return p;
}
test.after(() => { for (const p of PASTAS_TMP) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } });

/* ---------- processo falso do claude (copiado/adaptado de titulo-auto.test.js) ---------- */
function procFalso({ saida = '', erro = '', codigo = 0, atraso = 5, nuncaFecha = false, emiteErro = false } = {}) {
  const p = new EventEmitter();
  p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
  p.recebido = '';
  p.stdin.on('data', (d) => { p.recebido += d.toString('utf8'); });
  p.morto = false;
  p.kill = () => { p.morto = true; };
  if (emiteErro) setTimeout(() => p.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), atraso);
  else if (!nuncaFecha) {
    // dispara por TEMPO, nao por "stdin.finish": o auth status roda com
    // stdio:['ignore',...] e nunca escreve/fecha o stdin (so o -p faz isso).
    setTimeout(() => {
      if (saida) p.stdout.write(saida);
      if (erro) p.stderr.write(erro);
      setTimeout(() => p.emit('close', codigo), 2);
    }, atraso);
  }
  return p;
}
const okJson = (texto) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: texto });

const CONTA_ASSINATURA = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'usuario@exemplo.com' };
// Console tambem reporta authMethod:'claude.ai' (o login em si e' o mesmo OAuth) - quem distingue a
// cobranca e' apiProvider/apiKeySource. Fixture com authMethod:'console' nao testaria a distincao real.
const CONTA_API = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'anthropic', apiKeySource: 'ANTHROPIC_API_KEY' };

function ambienteBase() {
  return {
    PATH: 'C:/bin', Path: 'C:/bin', USERPROFILE: 'C:/Users/hugom',
    ANTHROPIC_API_KEY: 'sk-ant-secreta', ANTHROPIC_BASE_URL: 'https://api.exemplo',
    AWS_ACCESS_KEY_ID: 'AKIAEXEMPLO', GOOGLE_APPLICATION_CREDENTIALS: 'C:/g/credencial.json',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1',
  };
}

/* helper: monta um criarClaudeRapido com spawn falso que despacha por args[0]
   ('auth' -> status da conta; '-p' -> o roteiro do teste) */
function criar({ conta = CONTA_ASSINATURA, roteiro, extra } = {}) {
  const chamadas = [];
  const spawn = (bin, args, opts) => {
    let r;
    if (args[0] === 'auth' && args[1] === 'status') r = { saida: JSON.stringify(conta), atraso: 2 };
    else r = roteiro ? roteiro(chamadas.filter((c) => c.args[0] === '-p').length, args) : { saida: okJson('Resposta Padrao Ok') };
    const p = procFalso(r);
    chamadas.push({ bin, args, opts, p });
    return p;
  };
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({ acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp, spawn, ...(extra || {}) });
  return { c, chamadas, pastaTmp };
}
const chamadasP = (chamadas) => chamadas.filter((x) => x.args[0] === '-p');

test('1. o texto do pedido vai pelo stdin e nunca aparece em nenhum item do argv', async () => {
  const { c, chamadas } = criar({ roteiro: () => ({ saida: okJson('Resposta Qualquer Aqui') }) });
  const r = await c.perguntar({ id: 'a1', modelo: 'haiku', sistema: 'sistema x', texto: 'PALAVRA_SECRETA_NO_STDIN', saida: 'json' });
  assert.equal(r.ok, true);
  assert.equal(r.texto, 'Resposta Qualquer Aqui');
  const [chamadaP] = chamadasP(chamadas);
  assert.ok(chamadaP, 'o -p subiu');
  assert.ok(!chamadaP.args.some((a) => String(a).includes('PALAVRA_SECRETA_NO_STDIN')), 'o texto nao vai no argv');
  assert.match(chamadaP.p.recebido, /PALAVRA_SECRETA_NO_STDIN/, 'o texto chega pelo stdin');
});

test('2. ambienteLimpo tira credencial de API/nuvem e mantem PATH/Path/USERPROFILE', () => {
  const limpo = ambienteLimpo(ambienteBase());
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'AWS_ACCESS_KEY_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
    assert.equal(limpo[k], undefined, k + ' deveria sair do ambiente');
  }
  assert.equal(limpo.PATH, 'C:/bin');
  assert.equal(limpo.Path, 'C:/bin');
  assert.equal(limpo.USERPROFILE, 'C:/Users/hugom');
});

test('2b. o env que chega no spawn do -p (e do auth status) ja sai limpo', async () => {
  const { c, chamadas } = criar({ roteiro: () => ({ saida: okJson('Ok') }) });
  await c.perguntar({ id: 'a2', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.ok(chamadas.length >= 2, 'auth status + -p');
  for (const ch of chamadas) {
    assert.equal(ch.opts.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(ch.opts.env.CLAUDE_CODE_USE_VERTEX, undefined);
    assert.equal(ch.opts.env.PATH, 'C:/bin');
  }
});

test('3. argv tem os flags certos e o arquivo de settings tem o conteudo certo', async () => {
  const { c, chamadas, pastaTmp } = criar({ roteiro: () => ({ saida: okJson('Nome Da Conversa') }) });
  await c.perguntar({ id: 'a3', modelo: 'haiku', sistema: 'sistema de teste', texto: 'oi', saida: 'json' });
  const [chamadaP] = chamadasP(chamadas);
  const a = chamadaP.args;
  assert.equal(a[0], '-p');
  assert.equal(a[a.indexOf('--model') + 1], 'haiku');
  assert.ok(a.includes('--no-session-persistence'));
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(a[a.indexOf('--tools') + 1], '', '--tools vazio desliga todas as ferramentas');
  assert.equal(a[a.indexOf('--system-prompt') + 1], 'sistema de teste');
  assert.equal(a[a.indexOf('--output-format') + 1], 'json', 'saida:"json" pede --output-format json');
  const arqSettings = a[a.indexOf('--settings') + 1];
  assert.ok(arqSettings, 'tem --settings com um arquivo');
  assert.equal(path.dirname(arqSettings), pastaTmp);
  /* Tarefa 6 (27/09, revisao), mudado de proposito: + disableAllHooks (o settings
     antigo do titulo-auto tinha). Se o CLI recusar o --safe-mode, a 2a tentativa
     sem ele nao roda os hooks do usuario (ha' um SessionEnd neste PC que vira
     nota a cada sessao) -- e o nome da conversa agora chama o Haiku bem mais. */
  assert.deepEqual(JSON.parse(fs.readFileSync(arqSettings, 'utf8')), { forceLoginMethod: 'claudeai', alwaysThinkingEnabled: false, disableAllHooks: true });

  // saida "texto" (default): sem --output-format
  const { c: c2, chamadas: ch2 } = criar({ roteiro: () => ({ saida: 'resposta em texto puro' }) });
  await c2.perguntar({ id: 'a3b', modelo: 'haiku', texto: 'oi' });
  assert.ok(!chamadasP(ch2)[0].args.includes('--output-format'), 'saida "texto" nao pede --output-format');
});

test('4. conta de API/Console recusa antes do -p rodar; com assinatura o -p roda', async () => {
  const { c: cApi, chamadas: chApi } = criar({ conta: CONTA_API });
  const rApi = await cApi.perguntar({ id: 'b1', modelo: 'haiku', texto: 'oi' });
  assert.deepEqual(rApi, { ok: false, erro: 'conta-api', motivo: 'conta-api' });
  assert.equal(chamadasP(chApi).length, 0, 'o -p nem roda com conta de API/Console');
  assert.equal(await cApi.contaDeAssinatura(), false);

  const { c: cOk, chamadas: chOk } = criar({ conta: CONTA_ASSINATURA, roteiro: () => ({ saida: okJson('Titulo Bom Aqui') }) });
  const rOk = await cOk.perguntar({ id: 'b2', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.equal(rOk.ok, true);
  assert.equal(rOk.texto, 'Titulo Bom Aqui');
  assert.equal(chamadasP(chOk).length, 1, 'com assinatura o -p roda');
  assert.equal(await cOk.contaDeAssinatura(), true);
});

test('5. o resultado do auth status fica guardado por 10 min', async () => {
  let agoraMs = 1000000;
  const { c, chamadas } = criar({ roteiro: () => ({ saida: okJson('A B C') }), extra: { agora: () => agoraMs } });
  const qtdAuth = () => chamadas.filter((x) => x.args[0] === 'auth').length;

  await c.perguntar({ id: 'c1', modelo: 'haiku', texto: 'um' });
  await c.perguntar({ id: 'c2', modelo: 'haiku', texto: 'dois' });
  assert.equal(qtdAuth(), 1, 'dois pedidos seguidos = 1 auth status');

  agoraMs += 11 * 60 * 1000;
  await c.perguntar({ id: 'c3', modelo: 'haiku', texto: 'tres' });
  assert.equal(qtdAuth(), 2, 'agora + 11 min = confere de novo');
});

test('6. "Not logged in" na saida vira motivo sem-login', async () => {
  const { c } = criar({ roteiro: () => ({ saida: 'Not logged in · Please run /login', atraso: 5 }) });
  const r = await c.perguntar({ id: 'd1', modelo: 'haiku', texto: 'oi' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sem-login');
});

test('7. cancelar(id) mata o processo e a promessa resolve motivo cancelado', async () => {
  const { c, chamadas } = criar({ roteiro: () => ({ nuncaFecha: true }) });
  const promessa = c.perguntar({ id: 'e1', modelo: 'haiku', texto: 'oi' });
  await new Promise((r) => setTimeout(r, 30));   // deixa o -p "subir" antes de cancelar
  assert.equal(c.cancelar('nao-existe'), false);
  const cancelou = c.cancelar('e1');
  assert.equal(cancelou, true);
  const r = await promessa;
  assert.deepEqual(r, { ok: false, erro: 'cancelado', motivo: 'cancelado' });
  assert.equal(chamadasP(chamadas)[0].p.morto, true, 'o processo foi morto');
});

test('8. prazo estourado mata o processo e resolve motivo prazo', async () => {
  const { c, chamadas } = criar({ roteiro: () => ({ nuncaFecha: true }) });
  const t0 = Date.now();
  const r = await c.perguntar({ id: 'f1', modelo: 'haiku', texto: 'oi', prazoMs: 60 });
  assert.deepEqual(r, { ok: false, erro: 'prazo', motivo: 'prazo' });
  assert.ok(Date.now() - t0 < 2000, 'nao ficou esperando o prazo padrao (60s)');
  assert.equal(chamadasP(chamadas)[0].p.morto, true);
});

test('9. com maxSimultaneos = 2, o 3o pedido so sobe o processo quando um dos dois termina', async () => {
  let vivos = 0, pico = 0;
  const subidos = [];
  const spawn = (bin, args) => {
    if (args[0] === 'auth') return procFalso({ saida: JSON.stringify(CONTA_ASSINATURA), atraso: 1 });
    vivos++; pico = Math.max(pico, vivos);
    const p = procFalso({ saida: 'Ok', atraso: 25 });
    p.on('close', () => { vivos--; });
    subidos.push(p);
    return p;
  };
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({ acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp, spawn, maxSimultaneos: 2 });
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => c.perguntar({ id: 'g' + i, modelo: 'haiku', texto: 'pedido ' + i })));
  assert.equal(subidos.length, 5);
  assert.ok(pico <= 2, 'pico de ' + pico + ' processos -p simultaneos');
  assert.ok(rs.every((r) => r.ok && r.texto === 'Ok'));
});

test('10. windowsHide: true nas opcoes do spawn (do -p e do auth status)', async () => {
  const { c, chamadas } = criar({ roteiro: () => ({ saida: okJson('Ok') }) });
  await c.perguntar({ id: 'h1', modelo: 'haiku', texto: 'oi' });
  assert.ok(chamadas.length >= 2);
  for (const ch of chamadas) assert.equal(ch.opts.windowsHide, true);
});

test('Windows: taskkill /T /F SINCRONO roda ANTES do kill() (armadilha conhecida do repo)', async () => {
  const ordem = [];
  const chamadasTaskkill = [];
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp,
    ehWindows: true,
    execFileSync: (bin, args, opts) => { ordem.push('taskkill'); chamadasTaskkill.push({ bin, args, opts }); return ''; },
    spawn: (bin, args) => {
      if (args[0] === 'auth') return procFalso({ saida: JSON.stringify(CONTA_ASSINATURA), atraso: 1 });
      const p = procFalso({ nuncaFecha: true });
      p.pid = 4242;
      const killDeVerdade = p.kill;
      p.kill = () => { ordem.push('kill'); killDeVerdade(); };
      return p;
    },
  });
  const promessa = c.perguntar({ id: 'n1', modelo: 'haiku', texto: 'oi' });
  await new Promise((r) => setTimeout(r, 30));   // deixa o -p "subir" (com o .pid) antes de cancelar
  assert.equal(c.cancelar('n1'), true);
  const r = await promessa;
  assert.deepEqual(r, { ok: false, erro: 'cancelado', motivo: 'cancelado' });
  assert.equal(chamadasTaskkill.length, 1, 'taskkill chamado uma vez');
  assert.equal(chamadasTaskkill[0].bin, 'taskkill');
  assert.deepEqual(chamadasTaskkill[0].args, ['/PID', '4242', '/T', '/F']);
  assert.deepEqual(chamadasTaskkill[0].opts, { windowsHide: true, stdio: 'ignore' });
  assert.deepEqual(ordem, ['taskkill', 'kill'], 'taskkill roda SINCRONO e ANTES do kill() - nunca depois');
});

test('fora do Windows (ehWindows:false): nunca chama taskkill, so o kill() basta', async () => {
  const chamadasTaskkill = [];
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp,
    ehWindows: false,
    execFileSync: (...a) => { chamadasTaskkill.push(a); return ''; },
    spawn: (bin, args) => {
      if (args[0] === 'auth') return procFalso({ saida: JSON.stringify(CONTA_ASSINATURA), atraso: 1 });
      const p = procFalso({ nuncaFecha: true });
      p.pid = 4242;
      return p;
    },
  });
  const promessa = c.perguntar({ id: 'n2', modelo: 'haiku', texto: 'oi' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.cancelar('n2'), true);
  const r = await promessa;
  assert.deepEqual(r, { ok: false, erro: 'cancelado', motivo: 'cancelado' });
  assert.equal(chamadasTaskkill.length, 0, 'fora do Windows nunca chama taskkill');
});

/* ---------- extra: comportamento portado de titulo-auto.js que precisa sobreviver ---------- */

test('CLI antigo sem --safe-mode: tenta de novo sem ele (1x) e acerta', async () => {
  const { c, chamadas } = criar({
    roteiro: (n, args) => (args.includes('--safe-mode')
      ? { saida: '', erro: "error: unknown option '--safe-mode'\n", codigo: 1 }
      : { saida: okJson('Segunda Tentativa Ok') }),
  });
  const r = await c.perguntar({ id: 'i1', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.equal(r.ok, true);
  assert.equal(r.texto, 'Segunda Tentativa Ok');
  const cs = chamadasP(chamadas);
  assert.equal(cs.length, 2, 'a 1a com --safe-mode falhou, a 2a sem ele acertou');
  assert.ok(cs[0].args.includes('--safe-mode'));
  assert.ok(!cs[1].args.includes('--safe-mode'));
});

test('sem o Claude instalado: ENOENT (evento "error") cai em falhou', async () => {
  const { c } = criar({ roteiro: () => ({ emiteErro: true }) });
  const r = await c.perguntar({ id: 'j1', modelo: 'haiku', texto: 'oi' });
  assert.deepEqual(r, { ok: false, erro: 'sem-claude', motivo: 'falhou' });
});

test('sem o Claude instalado: spawn que lanca sincronamente tambem cai em falhou', async () => {
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp,
    spawn: (bin, args) => {
      if (args[0] === 'auth') return procFalso({ saida: JSON.stringify(CONTA_ASSINATURA), atraso: 1 });
      throw new Error('spawn claude ENOENT');
    },
  });
  const r = await c.perguntar({ id: 'k1', modelo: 'haiku', texto: 'oi' });
  assert.deepEqual(r, { ok: false, erro: 'sem-claude', motivo: 'falhou' });
});

test('FAIL-CLOSED: auth status que falha (sem Claude) BLOQUEIA o pedido, nunca "roda mesmo assim"', async () => {
  const chamadas = [];
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp,
    spawn: (bin, args, opts) => {
      chamadas.push({ args, opts });
      return args[0] === 'auth' ? procFalso({ emiteErro: true, atraso: 1 }) : procFalso({ saida: okJson('Nunca deveria rodar'), atraso: 5 });
    },
  });
  assert.equal(await c.contaDeAssinatura(), false);
  const r = await c.perguntar({ id: 'l1', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.deepEqual(r, { ok: false, erro: 'conta-desconhecida', motivo: 'conta-api' });
  assert.equal(chamadasP(chamadas).length, 0, 'auth status sem confirmar a conta: o -p nunca sobe (mesma regra do main.js do Homero)');
});

test('FAIL-CLOSED: auth status que devolve lixo (nao-JSON) tambem bloqueia', async () => {
  const { c, chamadas } = criar({ conta: 'isto nao e JSON de conta nenhuma' });
  const r = await c.perguntar({ id: 'l2', modelo: 'haiku', texto: 'oi' });
  assert.deepEqual(r, { ok: false, erro: 'conta-desconhecida', motivo: 'conta-api' });
  assert.equal(chamadasP(chamadas).length, 0);
});

test('a falha do auth status (nao confirmou) fica cacheada so 30s, NAO os 10 min do sucesso', async () => {
  let agoraMs = 2000000;
  let chamadasAuth = 0;
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp, agora: () => agoraMs,
    spawn: (bin, args) => {
      if (args[0] === 'auth') { chamadasAuth++; return procFalso({ emiteErro: true, atraso: 1 }); }
      return procFalso({ saida: okJson('Nunca deveria rodar') });
    },
  });
  await c.perguntar({ id: 'l3', modelo: 'haiku', texto: 'oi' });
  assert.equal(chamadasAuth, 1);
  agoraMs += 20 * 1000;   // 20s depois: ainda dentro dos 30s da falha
  await c.perguntar({ id: 'l4', modelo: 'haiku', texto: 'oi' });
  assert.equal(chamadasAuth, 1, '20s depois: a falha ainda esta em cache');
  agoraMs += 15 * 1000;   // total 35s: passou dos 30s da falha (mas nao chegaria aos 10 min do sucesso)
  await c.perguntar({ id: 'l5', modelo: 'haiku', texto: 'oi' });
  assert.equal(chamadasAuth, 2, '35s depois: a falha ja expirou, confere de novo (nao esperaria os 10 min de um sucesso)');
});

test('resposta vazia ou JSON invalido cai em falhou (nunca trava, nunca vira titulo)', async () => {
  const { c: c1 } = criar({ roteiro: () => ({ saida: '', codigo: 1, erro: 'boom' }) });
  const r1 = await c1.perguntar({ id: 'm1', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.equal(r1.ok, false);
  assert.equal(r1.motivo, 'falhou');

  const { c: c2 } = criar({ roteiro: () => ({ saida: 'isto nao e json' }) });
  const r2 = await c2.perguntar({ id: 'm2', modelo: 'haiku', texto: 'oi', saida: 'json' });
  assert.equal(r2.ok, false);
  assert.equal(r2.motivo, 'falhou');
});

/* ---------- revisao da Tarefa 3 (26/09): politica do cache da conta ----------
   So' conta CONFIRMADA logada (assinatura, ou conta de API/Console logada) fica
   10 min no cache. Deslogada (loggedIn:false) e "auth status" que falhou ficam
   no maximo 30 s: quem seguiu o "Entre na sua conta" nao pode continuar
   bloqueado por 10 min depois de entrar (a revisao reproduziu: entrou, +1 min,
   o mesmo aviso e nenhum -p). */
// o que o "claude auth status" imprime sem login (conferido em 26/09 com um CLAUDE_CONFIG_DIR vazio)
const CONTA_DESLOGADA = { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' };
function criarComContaTrocavel(inicial, agora) {
  let conta = inicial;
  const chamadas = [];
  const pastaTmp = pastaTemp();
  const c = criarClaudeRapido({
    acharBin: () => 'claude', buildEnv: ambienteBase, pastaDados: () => pastaTmp, agora,
    spawn: (bin, args, opts) => {
      const p = args[0] === 'auth' ? procFalso({ saida: JSON.stringify(conta), atraso: 1 }) : procFalso({ saida: 'Liberado' });
      chamadas.push({ args, opts, p });
      return p;
    },
  });
  const qtdAuth = () => chamadas.filter((x) => x.args[0] === 'auth').length;
  return { c, chamadas, qtdAuth, trocarConta: (nova) => { conta = nova; } };
}

test('conta deslogada: sem-login, bloqueada antes do -p (fail-closed)', async () => {
  const { c, chamadas } = criarComContaTrocavel(CONTA_DESLOGADA, () => 5000000);
  assert.deepEqual(await c.perguntar({ id: 'p1', modelo: 'haiku', texto: 'oi' }), { ok: false, erro: 'sem-login', motivo: 'sem-login' });
  assert.equal(chamadasP(chamadas).length, 0, 'o -p nem sobe');
  assert.equal(await c.contaDeAssinatura(), false);
});

test('conta deslogada fica no maximo 30 s no cache: entrou na conta, em menos de 1 min ja libera', async () => {
  let agoraMs = 6000000;
  const { c, chamadas, qtdAuth, trocarConta } = criarComContaTrocavel(CONTA_DESLOGADA, () => agoraMs);
  assert.equal((await c.perguntar({ id: 'p2', modelo: 'haiku', texto: 'oi' })).motivo, 'sem-login');
  trocarConta(CONTA_ASSINATURA);   // seguiu o aviso e entrou na conta
  agoraMs += 20 * 1000;
  assert.equal((await c.perguntar({ id: 'p3', modelo: 'haiku', texto: 'oi' })).motivo, 'sem-login', '20 s depois: ainda o cache curto');
  assert.equal(qtdAuth(), 1);
  agoraMs += 11 * 1000;   // 31 s depois do primeiro
  assert.deepEqual(await c.perguntar({ id: 'p4', modelo: 'haiku', texto: 'oi' }), { ok: true, texto: 'Liberado' },
    '31 s depois (antes de 1 min): confere de novo e libera');
  assert.equal(qtdAuth(), 2);
  assert.equal(chamadasP(chamadas).length, 1);
});

test('conta de API/Console confirmada (logada) continua 10 min no cache', async () => {
  let agoraMs = 7000000;
  const { c, qtdAuth, trocarConta } = criarComContaTrocavel(CONTA_API, () => agoraMs);
  assert.equal((await c.perguntar({ id: 'p5', modelo: 'haiku', texto: 'oi' })).motivo, 'conta-api');
  trocarConta(CONTA_ASSINATURA);
  agoraMs += 9 * 60 * 1000;
  assert.equal((await c.perguntar({ id: 'p6', modelo: 'haiku', texto: 'oi' })).motivo, 'conta-api', '9 min: a conta logada confirmada ainda vale');
  assert.equal(qtdAuth(), 1);
  agoraMs += 2 * 60 * 1000;   // 11 min
  assert.equal((await c.perguntar({ id: 'p7', modelo: 'haiku', texto: 'oi' })).ok, true, 'passou dos 10 min: confere de novo');
  assert.equal(qtdAuth(), 2);
});
