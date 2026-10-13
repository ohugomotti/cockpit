'use strict';
/* Log de erros da tela (src/log-tela.js): o arquivo userData/logs/tela.log.
   Aqui roda só o módulo, no Node, com pasta temporária e relógio falso. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarLogTela, descreverErro } = require('../src/log-tela');

const pastas = [];
test.after(() => { for (const p of pastas) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } });

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
function montar(opcoes = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'logtela-'));
  pastas.push(pasta);
  const relogio = { t: T0 };
  const log = criarLogTela({ dir: pasta, agora: () => relogio.t, ...opcoes });
  const linhas = (nome = 'tela.log') => {
    try { return fs.readFileSync(path.join(pasta, nome), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch { return []; }
  };
  const nomes = () => fs.readdirSync(pasta).sort();
  return { pasta, relogio, log, linhas, nomes };
}
const erro = (msg, extra) => ({ origem: 'tela', tipo: 'erro', msg, ...(extra || {}) });

/* ---------- 1. a linha ---------- */
test('registrar grava UMA linha JSON válida, com ts ISO, em <dir>/tela.log', () => {
  const { pasta, log, linhas, relogio } = montar();
  assert.equal(log.caminho, path.join(pasta, 'tela.log'));
  assert.equal(log.registrar(erro('x')), undefined);
  const bruto = fs.readFileSync(log.caminho, 'utf8');
  assert.equal(bruto.endsWith('\n'), true);
  assert.equal(bruto.trimEnd().includes('\n'), false, 'uma linha só');
  const [l] = linhas();
  assert.equal(l.ts, new Date(relogio.t).toISOString());
  assert.equal(new Date(l.ts).toISOString(), l.ts);
  assert.deepEqual(Object.keys(l), ['ts', 'origem', 'tipo', 'msg']);
  assert.deepEqual([l.origem, l.tipo, l.msg], ['tela', 'erro', 'x']);
});

test('com o relógio de verdade o ts também é ISO', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'logtela-'));
  pastas.push(pasta);
  const log = criarLogTela({ dir: pasta });
  log.registrar(erro('agora'));
  const [l] = fs.readFileSync(log.caminho, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.match(l.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(l.ts) - Date.now()) < 5000);
});

test('campos opcionais saem na ordem do contrato; número sem sentido e campo vazio ficam de fora', () => {
  const { log, linhas } = montar();
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'quebrou', stack: 'Error: quebrou\n  at f (app.js:1:1)', fonte: 'file:///app.js', linha: 12, coluna: 34, contexto: 'colar' });
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'b', linha: NaN, coluna: Infinity, stack: '', fonte: undefined, contexto: null });
  const [a, b] = linhas();
  assert.deepEqual(Object.keys(a), ['ts', 'origem', 'tipo', 'msg', 'stack', 'fonte', 'linha', 'coluna', 'contexto']);
  assert.deepEqual([a.linha, a.coluna, a.contexto], [12, 34, 'colar']);
  assert.deepEqual(Object.keys(b), ['ts', 'origem', 'tipo', 'msg']);
});

test('mensagem com quebra de linha continua sendo UMA linha do arquivo', () => {
  const { log, linhas } = montar();
  log.registrar(erro('primeira\nsegunda\r\nterceira\u2028quarta', { stack: 'a\nb\nc' }));
  assert.equal(fs.readFileSync(log.caminho, 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(linhas()[0].msg, 'primeira\nsegunda\r\nterceira\u2028quarta');
});

test('origem e tipo ausentes ganham padrão; texto fora do lugar não derruba nada', () => {
  const { log, linhas } = montar();
  log.registrar({ msg: 'sem origem nem tipo' });
  log.registrar({ origem: 'main', tipo: 'promessa', msg: { objeto: 1 } });
  log.registrar({ origem: 'main', tipo: 'erro', msg: undefined });
  const [a, b, c] = linhas();
  assert.deepEqual([a.origem, a.tipo], ['main', 'erro']);
  assert.equal(b.msg, '[object Object]');
  assert.equal(c.msg, '');
});

test('entrada que não é objeto é ignorada sem lançar e sem criar arquivo', () => {
  const { log, nomes } = montar();
  for (const x of [null, undefined, 'texto', 42, true, Symbol('s')]) assert.doesNotThrow(() => log.registrar(x));
  assert.deepEqual(nomes(), []);
  assert.equal(log.descartados(), 0);
});

/* ---------- 2. tamanho ---------- */
test('msg de 5.000 caracteres sai com no máximo 2.000; stack com no máximo 4.000', () => {
  const { log, linhas } = montar();
  log.registrar(erro('a'.repeat(5000), { stack: 'b'.repeat(9000), fonte: 'c'.repeat(3000), contexto: 'd'.repeat(3000) }));
  const [l] = linhas();
  assert.ok(l.msg.length <= 2000 && l.msg.length >= 1900, String(l.msg.length));
  assert.ok(l.stack.length <= 4000 && l.stack.length >= 3900, String(l.stack.length));
  assert.ok(l.fonte.length <= 500 && l.contexto.length <= 500);
  assert.ok(l.msg.startsWith('aaaa') && l.stack.startsWith('bbbb'));
  assert.equal(l.msg.length < 5000 && l.msg.endsWith('…'), true, 'o corte aparece');
});

test('texto dentro do limite não é cortado', () => {
  const { log, linhas } = montar();
  log.registrar(erro('m'.repeat(2000), { stack: 's'.repeat(4000) }));
  const [l] = linhas();
  assert.equal(l.msg.length, 2000);
  assert.equal(l.stack.length, 4000);
  assert.equal(l.msg.includes('…'), false);
});

/* ---------- 3. segredos ---------- */
test('segredos viram [segredo] na msg, no stack e na fonte', () => {
  const { log, linhas } = montar();
  const segredos = [
    'sk-ant-api03-abc123DEF456_xyz',
    'sk-ant-abc123',
    'ghp_' + 'a1B2c3D4e5'.repeat(3),
    'AIza' + 'x1Y2z3W4v5'.repeat(3) + 'Ab-_Q',
    'Bearer abc.def',
    'token=xyz',
  ];
  const [, , gh, google] = segredos;
  assert.equal(gh.length, 34);
  assert.equal(google.length, 39);
  segredos.forEach((s, i) => log.registrar({
    origem: 'tela', tipo: 'erro', msg: 'falhou com ' + s + ' no fim ' + i,
    stack: 'Error: ' + s + '\n  at x', fonte: 'https://api.exemplo/x?' + s,
  }));
  const bruto = fs.readFileSync(log.caminho, 'utf8');
  for (const s of segredos) {
    const valor = s.replace(/^(Bearer |token=)/, '');
    assert.equal(bruto.includes(valor), false, 'vazou: ' + s);
  }
  const todas = linhas();
  assert.equal(todas.length, segredos.length);
  todas.forEach((l, i) => {
    assert.equal(l.msg, 'falhou com [segredo] no fim ' + i);
    assert.match(l.stack, /^Error: \[segredo\]\n {2}at x$/);
    assert.ok(l.fonte.includes('[segredo]'));
  });
});

test('mais formas de segredo: chave estilo OpenAI, token do GitHub novo, JSON com token e senha=', () => {
  const { log, linhas } = montar();
  log.registrar(erro('chave ' + 'sk-proj-' + 'Ab1_'.repeat(10)));
  log.registrar(erro('pat ' + 'github_pat_' + '11AB'.repeat(12)));
  log.registrar(erro('config {"token":"valor-secreto","ok":true}'));
  log.registrar(erro('login?user=a&senha=minhaSenha&x=1'));
  log.registrar(erro('Authorization: bearer eyJhbGciOi.payload.assinatura'));
  const bruto = fs.readFileSync(log.caminho, 'utf8');
  for (const vazou of ['Ab1_Ab1_', '11AB11AB', 'valor-secreto', 'minhaSenha', 'eyJhbGciOi']) assert.equal(bruto.includes(vazou), false, vazou);
  const todas = linhas();
  assert.equal(todas.length, 5);
  assert.equal(todas[2].msg, 'config {[segredo],"ok":true}');
  assert.equal(todas[3].msg, 'login?user=a&[segredo]&x=1');
  assert.equal(todas[4].msg, 'Authorization: [segredo]');
});

test('texto comum, parecido com segredo mas sem ser, não é mascarado', () => {
  const { log, linhas } = montar();
  const comum = 'Unexpected token } em app.js; portador sem valor; sk-curto; ghp_ curto; disk-backup-2026; a chave do mapa';
  log.registrar(erro(comum));
  assert.equal(linhas()[0].msg, comum);
});

test('o corte de 2.000 não deixa a ponta de um segredo para trás', () => {
  const { log, linhas } = montar();
  const segredo = 'sk-ant-' + 'Z9'.repeat(30);
  // com o segredo mascarado a linha passa de 2.000; cortar ANTES de mascarar deixaria "sk-ant-Z9..." na ponta
  log.registrar(erro('a'.repeat(1995) + segredo));
  const l = linhas()[0];
  assert.equal(l.msg.includes('sk-ant'), false);
  assert.equal(l.msg.includes('Z9Z9'), false);
  assert.ok(l.msg.length <= 2000);
  assert.ok(l.msg.includes('[seg'), 'a máscara está lá (pelo menos o começo)');
});

test('texto gigante com cara de segredo é processado depressa (sem laço lento de regex)', () => {
  const { log, linhas } = montar();
  const inicio = Date.now();
  log.registrar(erro('a-'.repeat(200000), { stack: 'token'.repeat(100000), fonte: 'Bearer ' + ' '.repeat(300000) }));
  assert.ok(Date.now() - inicio < 2000, 'demorou ' + (Date.now() - inicio) + ' ms');
  assert.equal(linhas().length, 1);
});

/* ---------- 4. repetição ---------- */
test('a mesma (origem, tipo, msg) 5 vezes em menos de 10 s grava 1 linha; depois de 10 s a próxima traz repeticoes: 4', () => {
  const { log, linhas, relogio } = montar();
  for (let i = 0; i < 5; i++) { log.registrar(erro('de novo')); relogio.t += 1000; }   // t0 .. t0+4 s
  assert.equal(linhas().length, 1);
  assert.equal(linhas()[0].repeticoes, undefined);
  relogio.t = T0 + 10 * 1000;
  log.registrar(erro('de novo'));
  const todas = linhas();
  assert.equal(todas.length, 2);
  assert.equal(todas[1].repeticoes, 4);
  assert.equal(todas[1].ts, new Date(T0 + 10 * 1000).toISOString());
  // a contagem recomeça: a repetição seguinte não herda o 4
  log.registrar(erro('de novo'));
  assert.equal(linhas().length, 2);
  relogio.t += 10 * 1000;
  log.registrar(erro('de novo'));
  assert.equal(linhas().length, 3);
  assert.equal(linhas()[2].repeticoes, 1);
});

test('cinco repetições no MESMO instante também viram uma linha (relógio parado)', () => {
  const { log, linhas } = montar();
  for (let i = 0; i < 5; i++) log.registrar(erro('parado'));
  assert.equal(linhas().length, 1);
  assert.equal(log.descartados(), 0, 'repetição suprimida não é descarte do teto');
});

test('só (origem, tipo, contexto, msg) iguais contam como repetição; a stack e a linha não entram na chave', () => {
  const { log, linhas } = montar();
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'm', stack: 'um', linha: 1 });
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'm', stack: 'outro', linha: 2 });     // repetição
  log.registrar({ origem: 'main', tipo: 'erro', msg: 'm' });                                // outra origem
  log.registrar({ origem: 'tela', tipo: 'promessa', msg: 'm' });                            // outro tipo
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'n' });                                // outra msg
  log.registrar({ origem: 'tela', tipo: 'erro', msg: 'm', contexto: 'colar' });             // outro contexto
  assert.equal(linhas().length, 5);
});

/* A leva 1 põe logMain('<contexto>', e) em dezenas de catch. Quando dois deles falham com a MESMA mensagem
   ("Object has been destroyed", "EPERM: operation not permitted"...), o contexto é a única pista de qual foi:
   se ele não entra na chave, a 2ª linha vira "repetição" da 1ª e o contexto dela some. */
test('o contexto entra na chave: o mesmo erro em dois catch diferentes (contextos diferentes) grava as duas linhas', () => {
  const { log, linhas } = montar();
  const entrada = (contexto) => ({ origem: 'main', tipo: 'erro', contexto, msg: 'Object has been destroyed' });
  log.registrar(entrada('recorte:fechar'));
  log.registrar(entrada('atalhos:desligar'));      // mesma origem, tipo e msg; é outro catch
  log.registrar(entrada('recorte:fechar'));        // esta sim é repetição do primeiro
  const todas = linhas();
  assert.deepEqual(todas.map((l) => l.contexto), ['recorte:fechar', 'atalhos:desligar'], 'o 2º contexto não pode sumir');
  assert.equal(todas.some((l) => 'repeticoes' in l), false);
});

test('com e sem contexto são chaves diferentes: a mesma msg num catch sem contexto não esconde a de um catch com contexto', () => {
  const { log, linhas } = montar();
  log.registrar({ origem: 'main', tipo: 'erro', msg: 'mesma' });
  log.registrar({ origem: 'main', tipo: 'erro', msg: 'mesma', contexto: 'config:set' });
  log.registrar({ origem: 'main', tipo: 'erro', msg: 'mesma', contexto: '' });          // contexto vazio = sem contexto: repetição da 1ª
  assert.deepEqual(linhas().map((l) => l.contexto), [undefined, 'config:set']);
});

test('a contagem de repetições é POR (contexto, msg): cada catch conta a sua e a próxima gravação dele traz o seu repeticoes', () => {
  const { log, linhas, relogio } = montar();
  const a = { origem: 'main', tipo: 'erro', contexto: 'a', msg: 'x' };
  const b = { origem: 'main', tipo: 'erro', contexto: 'b', msg: 'x' };
  for (const e of [a, b, a, a, b]) log.registrar(e);          // a: grava + 2 suprimidas; b: grava + 1 suprimida
  assert.equal(linhas().length, 2);
  relogio.t += 10 * 1000;
  log.registrar(a);
  log.registrar(b);
  assert.deepEqual(linhas().map((l) => [l.contexto, l.repeticoes]), [['a', undefined], ['b', undefined], ['a', 2], ['b', 1]]);
});

test('o contexto da chave é o já cortado e mascarado, como a msg: contextos que só diferem no segredo são o mesmo catch', () => {
  const { log, linhas } = montar();
  log.registrar({ origem: 'main', tipo: 'erro', contexto: 'chamada token=aaa', msg: 'falhou' });
  log.registrar({ origem: 'main', tipo: 'erro', contexto: 'chamada token=bbb', msg: 'falhou' });
  assert.equal(linhas().length, 1);
  assert.equal(linhas()[0].contexto, 'chamada [segredo]');
});

test('duas mensagens que só diferem no segredo são a mesma repetição (a chave usa a msg já mascarada)', () => {
  const { log, linhas } = montar();
  log.registrar(erro('falhou com token=aaa'));
  log.registrar(erro('falhou com token=bbb'));
  assert.equal(linhas().length, 1);
  assert.equal(linhas()[0].msg, 'falhou com [segredo]');
});

test('centenas de mensagens diferentes ao longo de minutos: a tabela de repetições se poda e tudo continua gravando', () => {
  const { log, linhas, relogio } = montar({ maxBytes: 1024 * 1024 });
  for (let i = 0; i < 700; i++) { log.registrar(erro('distinta ' + i)); relogio.t += 1500; }   // 40 por minuto
  assert.equal(linhas().length, 700);
  assert.equal(log.descartados(), 0);
  log.registrar(erro('distinta 0'));          // uma antiga que volta depois de muito tempo é gravada, não presa
  assert.equal(linhas().length, 701);
});

test('relógio que volta para trás não prende a mensagem como repetida para sempre', () => {
  const { log, linhas, relogio } = montar();
  log.registrar(erro('volta'));
  relogio.t -= 3600 * 1000;
  log.registrar(erro('volta'));
  assert.equal(linhas().length, 2);
});

/* ---------- 5. teto por minuto ---------- */
test('teto de 120 linhas por minuto: a 121ª é descartada e descartados() conta', () => {
  const { log, linhas, relogio } = montar();
  for (let i = 0; i < 121; i++) log.registrar(erro('erro número ' + i));
  assert.equal(linhas().length, 120);
  assert.equal(log.descartados(), 1);
  for (let i = 121; i < 150; i++) log.registrar(erro('erro número ' + i));
  assert.equal(linhas().length, 120);
  assert.equal(log.descartados(), 30);
  // passou o minuto: volta a gravar, e o total de descartados não zera
  relogio.t += 60 * 1000;
  log.registrar(erro('depois do minuto'));
  assert.equal(linhas().length, 121);
  assert.equal(linhas().at(-1).msg, 'depois do minuto');
  assert.equal(log.descartados(), 30);
});

test('espalhadas dentro do mesmo minuto, as linhas também contam para o teto', () => {
  const { log, linhas, relogio } = montar();
  for (let i = 0; i < 130; i++) { log.registrar(erro('espalhada ' + i)); relogio.t += 400; }   // 52 s no total
  assert.equal(linhas().length, 120);
  assert.equal(log.descartados(), 10);
});

test('a mensagem descartada pelo teto não é marcada como "já gravada": grava quando o minuto vira', () => {
  const { log, linhas, relogio } = montar();
  for (let i = 0; i < 120; i++) log.registrar(erro('enche ' + i));
  log.registrar(erro('perdida'));
  assert.equal(log.descartados(), 1);
  relogio.t += 5 * 1000;
  log.registrar(erro('perdida'));          // ainda no mesmo minuto: descartada de novo, não "repetida"
  assert.equal(log.descartados(), 2);
  relogio.t += 60 * 1000;
  log.registrar(erro('perdida'));
  assert.equal(linhas().at(-1).msg, 'perdida');
});

/* ---------- 6. rotação ---------- */
test('rotação com maxBytes pequeno: só tela.log, tela.1.log e tela.2.log, e nenhum passa de maxBytes', () => {
  const maxBytes = 400;
  const { log, pasta, nomes, linhas, relogio } = montar({ maxBytes });
  for (let i = 0; i < 40; i++) { log.registrar(erro('linha ' + String(i).padStart(2, '0') + ' ' + 'x'.repeat(40))); relogio.t += 1000; }
  assert.deepEqual(nomes(), ['tela.1.log', 'tela.2.log', 'tela.log']);
  for (const n of nomes()) assert.ok(fs.statSync(path.join(pasta, n)).size <= maxBytes, n + ' passou de maxBytes');
  // o mais novo no tela.log, o anterior no .1, o outro no .2; o resto saiu
  const msgs = (n) => linhas(n).map((l) => l.msg.slice(0, 8));
  assert.equal(msgs('tela.log').at(-1), 'linha 39');
  assert.ok(msgs('tela.1.log').at(-1) < msgs('tela.log')[0] && msgs('tela.2.log').at(-1) < msgs('tela.1.log')[0]);
  const todas = [...msgs('tela.2.log'), ...msgs('tela.1.log'), ...msgs('tela.log')];
  assert.deepEqual(todas, [...todas].sort(), 'a ordem entre os arquivos é a do tempo');
  assert.equal(todas.includes('linha 00'), false, 'o mais velho saiu');
  assert.equal(log.descartados(), 0);
});

test('sem opções valem os padrões do contrato: arquivos de 512 KB e só três deles (tela.log, tela.1.log, tela.2.log)', () => {
  const { log, pasta, nomes, relogio } = montar();       // nem maxBytes nem arquivos
  // ~1,9 KB por linha, 100 linhas por "minuto" (o teto é 120): ~2,8 MB de relógio falso, uma meia dúzia de rotações
  for (let i = 0; i < 1500; i++) {
    log.registrar(erro('p' + String(i).padStart(4, '0') + ' ' + 'p'.repeat(1800)));
    if (i % 100 === 99) relogio.t += 61 * 1000;
  }
  assert.equal(log.descartados(), 0);
  assert.deepEqual(nomes(), ['tela.1.log', 'tela.2.log', 'tela.log'], 'três arquivos e nenhum "tela.3.log"');
  for (const n of nomes()) assert.ok(fs.statSync(path.join(pasta, n)).size <= 512 * 1024, n + ' passou de 512 KB');
  const cheio = fs.statSync(path.join(pasta, 'tela.1.log')).size;
  assert.ok(cheio > 500 * 1024, 'o arquivo que girou estava perto dos 512 KB (' + cheio + ' bytes), não de um limite maior');
});

test('arquivos: 2 guarda só tela.log e tela.1.log; arquivos: 1 só o tela.log', () => {
  const dois = montar({ maxBytes: 300, arquivos: 2 });
  const um = montar({ maxBytes: 300, arquivos: 1 });
  for (let i = 0; i < 20; i++) {
    for (const x of [dois, um]) { x.log.registrar(erro('rodada ' + i + ' ' + 'y'.repeat(60))); x.relogio.t += 1000; }
  }
  assert.deepEqual(dois.nomes(), ['tela.1.log', 'tela.log']);
  assert.deepEqual(um.nomes(), ['tela.log']);
  assert.ok(fs.statSync(path.join(um.pasta, 'tela.log')).size <= 300);
});

test('rotação continua de onde o arquivo parou (nova instância sobre o mesmo dir)', () => {
  const a = montar({ maxBytes: 600 });
  a.log.registrar(erro('da primeira instância'));
  const b = criarLogTela({ dir: a.pasta, maxBytes: 600, agora: () => a.relogio.t + 1000 });
  for (let i = 0; i < 8; i++) b.registrar(erro('da segunda ' + i + ' ' + 'z'.repeat(80)));
  assert.ok(a.nomes().includes('tela.1.log'));
  for (const n of a.nomes()) assert.ok(fs.statSync(path.join(a.pasta, n)).size <= 600);
});

test('uma linha maior que maxBytes perde a stack; se ainda não couber, é descartada, e o limite vale sempre', () => {
  const { log, pasta, nomes, linhas } = montar({ maxBytes: 300 });
  log.registrar(erro('curta', { stack: 's'.repeat(2000) }));
  assert.equal(linhas()[0].msg, 'curta');
  assert.equal(linhas()[0].stack, undefined);
  log.registrar(erro('m'.repeat(1500)));
  assert.equal(log.descartados(), 1);
  for (const n of nomes()) assert.ok(fs.statSync(path.join(pasta, n)).size <= 300);
  // linha que nunca caberia não gira os arquivos à toa: o log antigo fica onde está
  assert.deepEqual(nomes(), ['tela.log']);
  assert.equal(linhas()[0].msg, 'curta');
});

test('se a rotação falha (arquivo preso no Windows), o arquivo não passa de maxBytes: descarta e conta', () => {
  const real = fs;
  let travado = false;
  const fsPreso = { ...real, renameSync: (...a) => { if (travado) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return real.renameSync(...a); } };
  const { log, pasta, linhas, relogio } = montar({ maxBytes: 350, fs: fsPreso });
  for (let i = 0; i < 3; i++) { log.registrar(erro('antes ' + i + ' ' + 'k'.repeat(40))); relogio.t += 1000; }
  travado = true;
  for (let i = 0; i < 10; i++) { log.registrar(erro('preso ' + i + ' ' + 'k'.repeat(40))); relogio.t += 1000; }
  assert.ok(fs.statSync(path.join(pasta, 'tela.log')).size <= 350);
  assert.ok(log.descartados() > 0);
  assert.ok(linhas().length >= 1);
});

/* ---------- 7. disco e dir ---------- */
test('dir inválido não lança (ausente, nulo, número, com NUL, arquivo no lugar da pasta, pasta impossível)', () => {
  const { pasta } = montar();
  const arquivo = path.join(pasta, 'sou-um-arquivo');
  fs.writeFileSync(arquivo, 'x');
  const invalidos = [undefined, null, 42, '', {}, [], 'a\0b', arquivo, path.join(arquivo, 'filha'), path.join(pasta, 'x'.repeat(5000))];
  for (const dir of invalidos) {
    let log;
    assert.doesNotThrow(() => { log = criarLogTela({ dir }); }, String(dir));
    assert.doesNotThrow(() => log.registrar(erro('em ' + String(dir).slice(0, 20))), String(dir));
    assert.equal(typeof log.caminho, 'string');
    assert.equal(typeof log.descartados(), 'number');
  }
  assert.doesNotThrow(() => criarLogTela());
  assert.doesNotThrow(() => criarLogTela({}).registrar(erro('sem opções')));
  assert.equal(fs.readFileSync(arquivo, 'utf8'), 'x', 'não mexe no que já existe');
});

test('a pasta é criada na hora de gravar, inclusive aninhada', () => {
  const { pasta } = montar();
  const dir = path.join(pasta, 'a', 'b', 'logs');
  const log = criarLogTela({ dir });
  assert.equal(fs.existsSync(dir), false, 'criar o log não toca no disco');
  log.registrar(erro('cria a pasta'));
  assert.equal(fs.readFileSync(path.join(dir, 'tela.log'), 'utf8').includes('cria a pasta'), true);
});

test('erro de disco em qualquer operação é engolido', () => {
  const real = fs;
  for (const falha of ['mkdirSync', 'statSync', 'appendFileSync', 'renameSync', 'unlinkSync']) {
    const fsQuebrado = { ...real, [falha]: () => { throw new Error('disco: ' + falha); } };
    const { log, relogio } = montar({ fs: fsQuebrado, maxBytes: 200 });
    for (let i = 0; i < 6; i++) { assert.doesNotThrow(() => log.registrar(erro('quebra ' + falha + ' ' + i + ' ' + 'q'.repeat(60)))); relogio.t += 1000; }
  }
});

test('disco que falhou não "gasta" o teto nem marca a mensagem como repetida: a próxima tentativa grava', () => {
  let falhar = true;
  const real = fs;
  const fsInstavel = { ...real, appendFileSync: (...a) => { if (falhar) throw new Error('cheio'); return real.appendFileSync(...a); } };
  const { log, linhas } = montar({ fs: fsInstavel });
  log.registrar(erro('tentativa'));
  falhar = false;
  log.registrar(erro('tentativa'));
  assert.equal(linhas().length, 1);
  assert.equal(linhas()[0].msg, 'tentativa');
});

test('relógio quebrado (agora devolve lixo ou lança) não impede de gravar', () => {
  for (const agora of [() => NaN, () => undefined, () => 'ontem', () => { throw new Error('sem relógio'); }, () => 1e20]) {
    const { log, linhas } = montar({ agora });
    assert.doesNotThrow(() => log.registrar(erro('sem relógio')));
    assert.equal(linhas().length, 1);
    assert.match(linhas()[0].ts, /^\d{4}-\d\d-\d\dT/);
  }
});

test('opções absurdas (maxBytes 0/negativo/texto, arquivos 0) caem nos padrões e continuam funcionando', () => {
  for (const extra of [{ maxBytes: 0 }, { maxBytes: -5 }, { maxBytes: 'grande' }, { arquivos: 0 }, { arquivos: 'tres' }, { arquivos: 2.7 }]) {
    const { log, linhas } = montar(extra);
    assert.doesNotThrow(() => log.registrar(erro('ok')), JSON.stringify(extra));
    assert.equal(linhas().length >= 0, true);
  }
  const { log, linhas } = montar({ maxBytes: 0, arquivos: 0 });
  log.registrar(erro('padrão'));
  assert.equal(linhas().length, 1, 'maxBytes 0 não vira "nada cabe"');
});

/* ---------- descreverErro (o que o main usa no logMain) ---------- */
test('descreverErro: Error vira mensagem + stack; texto, objeto e coisas estranhas viram msg', () => {
  const e = new Error('quebrou');
  const d = descreverErro(e);
  assert.equal(d.msg, 'quebrou');
  assert.match(d.stack, /^Error: quebrou/);
  assert.deepEqual(descreverErro('só texto'), { msg: 'só texto' });
  assert.deepEqual(descreverErro({ code: 7, onde: 'x' }), { msg: '{"code":7,"onde":"x"}' });
  assert.deepEqual(descreverErro(undefined), { msg: 'undefined' });
  assert.deepEqual(descreverErro(null), { msg: 'null' });
  assert.deepEqual(descreverErro(404), { msg: '404' });
  assert.deepEqual(descreverErro(Symbol('s')), { msg: 'Symbol(s)' });
  assert.deepEqual(descreverErro(10n), { msg: '10' });
  assert.equal(descreverErro(new Error('')).msg, 'Error');
  const circular = {}; circular.eu = circular;
  assert.equal(descreverErro(circular).msg, '[object Object]');
  assert.ok(descreverErro({ lista: 'x'.repeat(5000) }).msg.length <= 500);
  const hostil = { get message() { throw new Error('getter'); } };
  assert.doesNotThrow(() => descreverErro(hostil));
  assert.equal(typeof descreverErro(hostil).msg, 'string');
  // erro de outro "mundo" (a tela, o vm) também é reconhecido: vale o formato, não o instanceof
  assert.equal(descreverErro({ message: 'de fora', stack: 'pilha' }).stack, 'pilha');
});
