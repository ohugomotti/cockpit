'use strict';
/* Leva 5, T1. 05/10/2026: uma tela azul pegou o Cockpit gravando o config.json; ele voltou do padrão (2 abas, sem tema) e a
   2ª gravação regravou o .bak com esse padrão. Medido no 6a269da: config.json e .bak com 84 000 zeros -> loadConfig() = {}
   e, na 2ª gravação, o .bak vira o padrão (76 bytes); nenhum arquivo ruim fica guardado. Tudo em pasta temporária. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const MAIN = lerFonte('main.js');

function pasta(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-config-leva5-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function contexto(arquivo, extras = {}) {
  const logs = [];
  const ctx = vm.createContext({ fs, path, Buffer, CONFIG_PATH: () => arquivo, logMain: (c, e) => logs.push([c, String((e && e.message) || e)]), ...extras });
  for (const nome of ['loadConfig', 'gravarSeguro', 'saveConfig']) vm.runInContext(pegarBloco(MAIN, 'function ' + nome + '(', nome), ctx);
  ctx.logs = logs;
  return ctx;
}
const guardados = (dir, base) => fs.readdirSync(dir).filter((n) => n.startsWith(base + '.corrompido-'));
const BOM = JSON.stringify({ tema: 'jornal', visualMac: true, abas: Array.from({ length: 15 }, (_, i) => ({ id: 'a' + i })) });
const RUINS = { vazio: Buffer.alloc(0), zeros: Buffer.alloc(84000), truncado: Buffer.from(BOM.slice(0, Math.floor(BOM.length / 2))) };

for (const [nome, bytes] of Object.entries(RUINS)) {
  test('config ' + nome + ': lê o .bak, guarda o ruim como config.json.corrompido-<data> e não mexe no .bak (leva 5)', (t) => {
    const dir = pasta(t), arquivo = path.join(dir, 'config.json');
    fs.writeFileSync(arquivo, bytes);
    fs.writeFileSync(arquivo + '.bak', BOM);
    const ctx = contexto(arquivo);
    assert.equal(ctx.loadConfig().abas.length, 15, 'veio do .bak');
    const ruins = guardados(dir, 'config.json');
    assert.equal(ruins.length, 1, 'arquivos ruins guardados: ' + ruins.length);
    assert.match(ruins[0], /^config\.json\.corrompido-\d{8}-\d{6}$/);
    assert.deepEqual(fs.readFileSync(path.join(dir, ruins[0])), bytes, 'guardado com os bytes de antes');
    assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'o .bak não mudou');
    assert.equal(ctx.loadConfig.semCopia, undefined, 'com o .bak bom a sessão segue gravando a cópia');
  });
}

test('config e .bak ruins (a tela azul de 05/10): começa do padrão, guarda os dois e nenhuma gravação da sessão recria o .bak (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, RUINS.zeros);
  fs.writeFileSync(arquivo + '.bak', RUINS.zeros);
  const ctx = contexto(arquivo);
  const cfg = ctx.loadConfig();
  assert.deepEqual(Object.keys(cfg), []);
  cfg.abas = [{ id: 'a' }, { id: 'b' }];
  assert.equal(ctx.saveConfig(cfg), true);
  assert.equal(ctx.saveConfig(cfg), true);
  assert.equal(fs.existsSync(arquivo + '.bak'), false, '.bak regravado com o padrão');
  assert.equal(guardados(dir, 'config.json').length, 1, 'o config ruim ficou guardado');
  assert.equal(guardados(dir, 'config.json.bak').length, 1, 'o .bak ruim ficou guardado');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).abas.length, 2, 'o config da sessão continua sendo gravado');
  assert.ok(ctx.logs.some(([c]) => c === 'config'), 'o tela.log conta o que aconteceu');
});

test('a gravação vai ao disco antes do rename: fsync no temporário do config e no da cópia (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const passos = [], abertos = new Map();
  const disco = Object.create(fs);
  disco.openSync = (p, ...r) => { const fd = fs.openSync(p, ...r); abertos.set(fd, path.basename(p)); return fd; };
  disco.fsyncSync = (fd) => { passos.push('fsync ' + abertos.get(fd)); return fs.fsyncSync(fd); };
  disco.renameSync = (de, para) => { passos.push('rename ' + path.basename(de) + ' ' + path.basename(para)); return fs.renameSync(de, para); };
  const ctx = contexto(arquivo, { fs: disco });
  assert.equal(ctx.saveConfig({ tema: 'claro' }), true);
  const renomes = passos.filter((p) => p.startsWith('rename '));
  assert.equal(renomes.length, 2, 'renames (config e cópia): ' + passos.join(' | '));
  for (const r of renomes) {
    const i = passos.indexOf('fsync ' + r.split(' ')[1]);
    assert.ok(i >= 0 && i < passos.indexOf(r), 'fsync antes do "' + r + '": ' + passos.join(' | '));
  }
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'a cópia é o config de antes');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
});

test('config preso pelo antivírus (EBUSY) não vira corrompido: lê o .bak e não renomeia nada (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM.replace('jornal', 'azul'));
  fs.writeFileSync(arquivo + '.bak', BOM);
  const disco = Object.create(fs);
  disco.readFileSync = (p, ...r) => { if (p === arquivo) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); return fs.readFileSync(p, ...r); };
  const ctx = contexto(arquivo, { fs: disco });
  assert.equal(ctx.loadConfig().tema, 'jornal', 'veio do .bak');
  assert.deepEqual(guardados(dir, 'config.json'), [], 'arquivo preso não é arquivo ruim');
  assert.ok(fs.existsSync(arquivo), 'o config continua no lugar');
});

test('nomes.json vazio (queda) não toma o lugar da cópia boa no .bak (leva 5)', (t) => {
  const dir = pasta(t), alvo = path.join(dir, 'nomes.json');
  const bons = JSON.stringify({ 'claude:1': 'Nome que eu dei' });
  fs.writeFileSync(alvo, '');
  fs.writeFileSync(alvo + '.bak', bons);
  const ctx = vm.createContext({ fs, path, Buffer, NOMES_PATH: () => alvo });
  for (const nome of ['gravarSeguro', 'salvarNomes']) vm.runInContext(pegarBloco(MAIN, 'function ' + nome + '(', nome), ctx);
  assert.equal(ctx.salvarNomes({ 'claude:2': 'Outro' }), true);
  assert.equal(fs.readFileSync(alvo + '.bak', 'utf8'), bons, 'o .bak ficou com os nomes bons');
  assert.deepEqual(JSON.parse(fs.readFileSync(alvo, 'utf8')), { 'claude:2': 'Outro' });
});

/* Extra (5/5, opcional). Na suite inteira o 1o teste do multiagentes-backend falhou 1 vez com "EBUSY: resource busy or
   locked, open '...config.json.tmp'": o antivirus segurava, por alguns ms, o arquivo que acabara de ser renomeado duas
   vezes (tmp -> config.json -> config.json.corrompido-<data>) quando o gravarSeguro criou o temporario de novo. Medido sob
   carga de disco (3 processos gravando arquivos, o teste rodando em paralelo): base 0 falhas em 180 execucoes; ramo sem a
   insistencia 6 em 546; com ela 0 em 480. */
test('antivírus segurando o temporário por um instante (EBUSY no open, EPERM no rename): a gravação tenta de novo e consegue (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const tentativas = { open: 0, rename: 0 };
  const disco = Object.create(fs);
  disco.openSync = (p, ...r) => {
    if (p === arquivo + '.tmp' && ++tentativas.open <= 2) throw Object.assign(new Error('EBUSY: resource busy or locked, open'), { code: 'EBUSY' });
    return fs.openSync(p, ...r);
  };
  disco.renameSync = (de, para) => {
    if (de === arquivo + '.tmp' && ++tentativas.rename <= 1) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    return fs.renameSync(de, para);
  };
  const ctx = contexto(arquivo, { fs: disco });
  assert.equal(ctx.saveConfig({ tema: 'claro' }), true);
  assert.deepEqual(tentativas, { open: 3, rename: 2 });
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'a cópia é o config de antes');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
});

test('erro que não é de arquivo preso (disco cheio) não é repetido: uma tentativa, false e o config de antes inteiro (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  let abertas = 0;
  const disco = Object.create(fs);
  disco.openSync = (p, ...r) => {
    if (p === arquivo + '.tmp') { abertas++; throw Object.assign(new Error('ENOSPC: no space left on device, open'), { code: 'ENOSPC' }); }
    return fs.openSync(p, ...r);
  };
  const ctx = contexto(arquivo, { fs: disco });
  assert.equal(ctx.saveConfig({ tema: 'claro' }), false);
  assert.equal(abertas, 1, 'tentativas: ' + abertas);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'o config de antes ficou inteiro');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
});

test('arquivo preso o tempo todo (EBUSY): desiste na 4ª tentativa, devolve false sem lançar e o config de antes fica inteiro (leva 5)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  let abertas = 0;
  const disco = Object.create(fs);
  disco.openSync = (p, ...r) => {
    if (p === arquivo + '.tmp') { abertas++; throw Object.assign(new Error('EBUSY: resource busy or locked, open'), { code: 'EBUSY' }); }
    return fs.openSync(p, ...r);
  };
  const ctx = contexto(arquivo, { fs: disco });
  const inicio = Date.now();
  assert.equal(ctx.saveConfig({ tema: 'claro' }), false);
  assert.equal(abertas, 4, 'tentativas: ' + abertas);
  assert.ok(Date.now() - inicio < 2000, 'a espera é curta (20 + 40 + 60 ms)');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'o config de antes ficou inteiro');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
});

/* Onda 1, item 4 (revisão da T1): config bom que só estava PRESO (antivírus, indexador) não pode virar padrão. Antes: um erro de
   leitura com code (EBUSY, EPERM, EACCES) lia o .bak ou, sem ele, devolvia {} e ligava o semCopia; a tela começava do padrão e a
   1ª gravação sobrescrevia o config.json bom assim que o antivírus o soltava. Agora: a leitura repete 3 vezes (20, 40 e 60 ms, como
   o gravarSeguro); preso o tempo todo, lê o .bak e, sem .bak, abre do padrão SEM gravar por cima (loadConfig.naoLido); o semCopia
   só liga por conteúdo ruim. Tudo em pasta temporária: o disco "preso" é um fs que lança o erro só nas leituras do config.json. */
const preso = (code) => Object.assign(new Error(code + ': resource busy or locked, open'), { code });
// quando(n) devolve o erro da n-ésima leitura do config.json (ou null para deixar ler)
function discoPreso(alvo, quando) {
  const leituras = { n: 0 };
  const disco = Object.create(fs);
  disco.readFileSync = (p, ...r) => { if (p === alvo) { const erro = quando(++leituras.n); if (erro) throw erro; } return fs.readFileSync(p, ...r); };
  return { disco, leituras };
}

for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
  test('config preso por um instante (' + code + ' na 1ª leitura): a leitura repete e lê o config, não o .bak, e não liga o semCopia (onda 1)', (t) => {
    const dir = pasta(t), arquivo = path.join(dir, 'config.json'), original = BOM.replace('jornal', 'azul');
    fs.writeFileSync(arquivo, original);
    fs.writeFileSync(arquivo + '.bak', BOM);
    const { disco, leituras } = discoPreso(arquivo, (n) => (n === 1 ? preso(code) : null));
    const ctx = contexto(arquivo, { fs: disco });
    assert.equal(ctx.loadConfig().tema, 'azul', 'leu o config, não o .bak');
    assert.equal(leituras.n, 2, 'leituras do config: ' + leituras.n);
    assert.equal(ctx.loadConfig.semCopia, undefined);
    assert.notEqual(ctx.loadConfig.naoLido, true);
    assert.deepEqual(guardados(dir, 'config.json'), [], 'arquivo preso não é arquivo ruim');
    assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'o .bak ficou como estava');
    assert.equal(ctx.saveConfig({ tema: 'claro' }), true, 'e a sessão grava normal');
    assert.equal(JSON.parse(fs.readFileSync(arquivo + '.bak', 'utf8')).tema, 'azul', 'a cópia é o config de antes');
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
  });
}

test('config preso o tempo todo com .bak bom: tenta 4 vezes, lê o .bak, não renomeia nada nem liga o semCopia (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json'), original = BOM.replace('jornal', 'azul');
  fs.writeFileSync(arquivo, original);
  fs.writeFileSync(arquivo + '.bak', BOM);
  const { disco, leituras } = discoPreso(arquivo, () => preso('EBUSY'));
  const ctx = contexto(arquivo, { fs: disco });
  const inicio = Date.now();
  assert.equal(ctx.loadConfig().tema, 'jornal', 'veio do .bak');
  assert.equal(leituras.n, 4, 'leituras do config (1 + 3 repetições): ' + leituras.n);
  assert.ok(Date.now() - inicio < 2000, 'a espera é curta (20 + 40 + 60 ms)');
  assert.equal(ctx.loadConfig.semCopia, undefined, 'preso não é conteúdo ruim');
  assert.notEqual(ctx.loadConfig.naoLido, true, 'com o .bak bom a sessão não começa do padrão');
  assert.deepEqual(guardados(dir, 'config.json'), [], 'arquivo preso não é arquivo ruim');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), original, 'o config continua no lugar, intacto');
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'e o .bak também');
});

test('config preso o tempo todo e sem .bak: abre do padrão, sem semCopia, e nenhuma gravação passa por cima do original; lido com sucesso, grava de novo (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json'), original = BOM.replace('jornal', 'azul');
  fs.writeFileSync(arquivo, original);
  let solto = false;
  const { disco, leituras } = discoPreso(arquivo, () => (solto ? null : preso('EBUSY')));
  const ctx = contexto(arquivo, { fs: disco });
  const cfg = ctx.loadConfig();
  assert.deepEqual(Object.keys(cfg), [], 'sem .bak abre do padrão');
  assert.equal(leituras.n, 4, 'leituras do config (1 + 3 repetições): ' + leituras.n);
  assert.equal(ctx.loadConfig.semCopia, undefined, 'preso não é conteúdo ruim');
  assert.equal(ctx.loadConfig.naoLido, true, 'marcado: não gravar até ler');
  assert.ok(ctx.logs.some(([c]) => c === 'config'), 'o tela.log conta o que aconteceu');
  cfg.abas = [{ id: 'a' }, { id: 'b' }];
  assert.equal(ctx.saveConfig(cfg), false, 'a gravação é recusada (a tela mostra o aviso de falha ao salvar)');
  assert.equal(ctx.saveConfig(cfg), false, 'a 2ª também');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), original, 'o config original continua intacto');
  assert.deepEqual(fs.readdirSync(dir), ['config.json'], 'nada criado ao lado: nem .bak, nem .tmp, nem .corrompido');
  solto = true;   // o antivírus soltou o arquivo
  assert.equal(ctx.loadConfig().tema, 'azul', 'lido com sucesso');
  assert.equal(ctx.loadConfig.naoLido, false);
  assert.equal(ctx.saveConfig({ tema: 'claro' }), true, 'lido o original, a gravação volta');
  assert.equal(JSON.parse(fs.readFileSync(arquivo + '.bak', 'utf8')).tema, 'azul', 'e a cópia é o original que estava preso');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
});

test('config preso e .bak de conteúdo ruim: guarda só o .bak ruim, não toca no original e não deixa o padrão gravar por cima (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  fs.writeFileSync(arquivo + '.bak', RUINS.zeros);
  const { disco } = discoPreso(arquivo, () => preso('EBUSY'));
  const ctx = contexto(arquivo, { fs: disco });
  assert.deepEqual(Object.keys(ctx.loadConfig()), []);
  assert.equal(guardados(dir, 'config.json').length, 0, 'o original preso não é arquivo ruim');
  assert.equal(guardados(dir, 'config.json.bak').length, 1, 'o .bak ruim ficou guardado');
  assert.equal(ctx.loadConfig.semCopia, true, 'conteúdo ruim (o do .bak) liga o semCopia');
  assert.equal(ctx.loadConfig.naoLido, true);
  assert.equal(ctx.saveConfig({ tema: 'claro' }), false);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'o original continua intacto');
});

test('erro de leitura que não é de arquivo preso (EIO): não espera nem repete, não guarda como ruim e não deixa o padrão gravar por cima (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const { disco, leituras } = discoPreso(arquivo, () => preso('EIO'));
  const ctx = contexto(arquivo, { fs: disco });
  assert.deepEqual(Object.keys(ctx.loadConfig()), []);
  assert.equal(leituras.n, 1, 'só EBUSY, EPERM e EACCES repetem: ' + leituras.n);
  assert.deepEqual(guardados(dir, 'config.json'), []);
  assert.equal(ctx.loadConfig.semCopia, undefined);
  assert.equal(ctx.saveConfig({ tema: 'claro' }), false);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'o config continua intacto');
});

test('a tela que recebeu o padrão no config:get não grava por cima nem depois que o arquivo solta; relendo, grava de novo (onda 1)', (t) => {
  // o config:get é a única leitura que chega à tela. Se o antivírus solta o arquivo logo depois, qualquer leitura do processo
  // principal (tema, pastas...) abriria o original, mas o que a tela tem na mão continua sendo o padrão.
  const dir = pasta(t), arquivo = path.join(dir, 'config.json'), original = BOM.replace('jornal', 'azul');
  fs.writeFileSync(arquivo, original);
  let solto = false;
  const { disco } = discoPreso(arquivo, () => (solto ? null : preso('EBUSY')));
  const ctx = contexto(arquivo, { fs: disco });
  const canais = new Map();
  ctx.ipcMain = { handle: (canal, fn) => canais.set(canal, fn) };
  vm.runInContext(/^ipcMain\.handle\('config:get'.*$/m.exec(MAIN)[0], ctx);
  const daTela = canais.get('config:get')();
  assert.deepEqual(Object.keys(daTela), [], 'a tela recebeu o padrão');
  solto = true;
  assert.equal(ctx.loadConfig().tema, 'azul', 'o processo principal já lê o original');
  daTela.tema = 'claro';
  assert.equal(ctx.saveConfig(daTela), false, 'mas a tela está com o padrão: gravar o sobrescreveria');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), original);
  const relida = canais.get('config:get')();   // recarregar a janela: o boot lê de novo
  assert.equal(relida.tema, 'azul');
  relida.tema = 'claro';
  assert.equal(ctx.saveConfig(relida), true, 'a tela leu o original: pode gravar');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
});

/* Onda 1, item 5 (revisão da T1): dois comportamentos que a leva 5 não fixava em teste. */
test('primeira execução (sem config nem .bak): a 1ª gravação não cria .bak e a 2ª o cria com a 1ª; sem semCopia, sem arquivo guardado e sem log (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  const ctx = contexto(arquivo);
  assert.deepEqual(Object.keys(ctx.loadConfig()), [], 'instalação nova: padrão');
  assert.equal(ctx.loadConfig.semCopia, undefined, 'instalação nova não é config perdido');
  assert.notEqual(ctx.loadConfig.naoLido, true, 'e não é config preso');
  assert.equal(ctx.saveConfig({ tema: 'azul' }), true);
  assert.equal(fs.existsSync(arquivo + '.bak'), false, 'a 1ª gravação não tem config antigo para guardar');
  assert.equal(ctx.saveConfig({ tema: 'claro' }), true);
  assert.equal(JSON.parse(fs.readFileSync(arquivo + '.bak', 'utf8')).tema, 'azul', 'a 2ª guarda a 1ª no .bak');
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tema, 'claro');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'config.json.bak'], 'e mais nada ao lado');
  assert.deepEqual(ctx.logs, [], 'nada a contar no tela.log');
});

test('semCopia fica ligado a sessão inteira: nem as leituras seguintes (arquivos já guardados) nem a gravação de um config novo o desligam (onda 1)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, RUINS.zeros);
  fs.writeFileSync(arquivo + '.bak', RUINS.zeros);
  const ctx = contexto(arquivo);
  assert.deepEqual(Object.keys(ctx.loadConfig()), []);
  assert.equal(ctx.loadConfig.semCopia, true, '1ª leitura: os dois ruins, ligado');
  // 2ª leitura: os dois já foram para .corrompido-<data>, não há arquivo para falhar; o semCopia não pode se perder por isso
  assert.deepEqual(Object.keys(ctx.loadConfig()), []);
  assert.equal(ctx.loadConfig.semCopia, true, '2ª leitura (arquivos já guardados): continua ligado');
  assert.equal(ctx.saveConfig({ tema: 'azul' }), true);
  assert.equal(ctx.loadConfig().tema, 'azul', '3ª leitura: o config novo abre bem');
  assert.equal(ctx.loadConfig.semCopia, true, 'abrir bem não desliga: o config novo, se virasse .bak, seria o padrão');
  assert.equal(ctx.saveConfig({ tema: 'claro' }), true);
  assert.equal(fs.existsSync(arquivo + '.bak'), false, 'e nenhuma gravação da sessão cria o .bak');
  assert.equal(guardados(dir, 'config.json').length, 1, 'os dois ruins continuam guardados (nunca apagados)');
  assert.equal(guardados(dir, 'config.json.bak').length, 1);
});

/* Onda 1, item 6 (revisão da T1): o índice de conversas, as versões dos motores e o cockpit-prompts.json chamam o gravarSeguro sem
   validador e guardavam no .bak o que estivesse no arquivo, até o vazio ou os zeros de uma queda. Agora, sem validador próprio, só
   vai para o .bak o arquivo antigo que abre como JSON (o config e os nomes seguem com o validador deles, que exige objeto). */
test('gravarSeguro sem validador próprio (índice, versões, prompts): só o arquivo antigo que abre como JSON vira .bak (onda 1)', (t) => {
  const dir = pasta(t), alvo = path.join(dir, 'indice-conversas.json');
  const ctx = vm.createContext({ fs, path, Buffer });
  vm.runInContext(pegarBloco(MAIN, 'function gravarSeguro(', 'gravarSeguro'), ctx);
  const bom = JSON.stringify({ sessoes: [1, 2, 3] });
  for (const [nome, bytes] of Object.entries(RUINS)) {
    fs.writeFileSync(alvo, bytes);
    fs.writeFileSync(alvo + '.bak', bom);
    assert.equal(ctx.gravarSeguro(alvo, JSON.stringify({ novo: nome })), true);
    assert.deepEqual(fs.readFileSync(alvo + '.bak'), Buffer.from(bom), nome + ': o .bak continua com a cópia boa');
    assert.equal(JSON.parse(fs.readFileSync(alvo, 'utf8')).novo, nome, nome + ': e o arquivo novo foi gravado');
  }
  fs.writeFileSync(alvo, bom);
  fs.rmSync(alvo + '.bak', { force: true });
  assert.equal(ctx.gravarSeguro(alvo, JSON.stringify({ novo: 'depois' })), true);
  assert.equal(fs.readFileSync(alvo + '.bak', 'utf8'), bom, 'o arquivo antigo que abre vira .bak, como sempre');
  // quem passa validador próprio continua mandando: ele decide, e o padrão não se soma a ele
  fs.writeFileSync(alvo, RUINS.zeros);
  fs.rmSync(alvo + '.bak', { force: true });
  assert.equal(ctx.gravarSeguro(alvo, '{}', () => true), true);
  assert.equal(fs.readFileSync(alvo + '.bak').length, RUINS.zeros.length, 'validador que aceita: guarda o que ele aceitou');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
});

/* Rodada final da leva 5 (revisão final ac9040bba93ba3a12, item 1, CRÍTICO): o .bak PRESO no boot. Antes só o erro de leitura
   do config.json ligava o naoLido. Com o config ruim ou sumido e o .bak preso (EBUSY, EPERM, EACCES: o antivírus), a sessão abria
   do padrão e gravava, e o padrão tomava o lugar do .bak bom: na 2ª gravação, se o config tinha sumido; na 1ª da sessão seguinte,
   se ele estava ruim (ela lia o padrão gravado no config.json). Cada sessão tem o seu loadConfig (contexto novo), como o Cockpit
   fechado e reaberto; a tela lê pelo config:get, como no boot. O antivírus solta o .bak logo depois do boot da sessão 1. */
function sessaoComBakPreso(arquivo) {
  const trava = { solto: false };
  const disco = Object.create(fs);
  disco.readFileSync = (p, ...r) => { if (p === arquivo + '.bak' && !trava.solto) throw preso('EBUSY'); return fs.readFileSync(p, ...r); };
  return { ctx: contexto(arquivo, { fs: disco }), trava };
}
function configDaTela(ctx) {
  const canais = new Map();
  ctx.ipcMain = { handle: (canal, fn) => canais.set(canal, fn) };
  vm.runInContext(/^ipcMain\.handle\('config:get'.*$/m.exec(MAIN)[0], ctx);
  return canais.get('config:get')();
}

test('config ruim e .bak preso no boot: nenhuma gravação da sessão escreve nada e a sessão seguinte, com o .bak solto, abre as 15 abas (final)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, RUINS.zeros);
  fs.writeFileSync(arquivo + '.bak', BOM);
  const s1 = sessaoComBakPreso(arquivo);
  const daTela = configDaTela(s1.ctx);
  assert.deepEqual(Object.keys(daTela), [], 'sem config que abra e com o .bak preso, a tela recebe o padrão');
  s1.trava.solto = true;
  daTela.abas = [{ id: 'a' }, { id: 'b' }];
  assert.equal(s1.ctx.saveConfig(daTela), false, 'a 1ª gravação do padrão é recusada');
  assert.equal(s1.ctx.saveConfig(daTela), false, 'a 2ª também');
  assert.equal(fs.existsSync(arquivo), false, 'nenhum config.json com o padrão');
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'o .bak continua com as 15 abas');
  assert.equal(guardados(dir, 'config.json').length, 1, 'o config ruim ficou guardado');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], 'nenhum temporário sobrando');
  assert.equal(s1.ctx.loadConfig.naoLido === true || s1.ctx.loadConfig.telaComPadrao === true, true);
  assert.ok(s1.ctx.logs.some(([c, m]) => c === 'config' && /\.bak/.test(m) && /preso/.test(m)), 'o tela.log conta que a cópia pode estar presa: ' + JSON.stringify(s1.ctx.logs));
  const s2 = contexto(arquivo);
  assert.equal(s2.loadConfig().abas.length, 15, 'a sessão seguinte abre as 15 abas do .bak');
});

test('config sumido e .bak preso no boot: nem a 1ª nem a 2ª gravação da sessão tocam no .bak, e a sessão seguinte abre as 15 abas (final)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo + '.bak', BOM);
  const s1 = sessaoComBakPreso(arquivo);
  const daTela = configDaTela(s1.ctx);
  assert.deepEqual(Object.keys(daTela), [], 'a tela recebe o padrão');
  s1.trava.solto = true;
  daTela.abas = [{ id: 'a' }, { id: 'b' }];
  assert.equal(s1.ctx.saveConfig(daTela), false, 'a 1ª gravação do padrão é recusada');
  assert.equal(s1.ctx.saveConfig(daTela), false, 'a 2ª também');
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM, 'o .bak continua com as 15 abas');
  // o processo principal relê (tema, pastas...) e já abre o .bak; a tela continua com o padrão na mão
  assert.equal(s1.ctx.loadConfig().abas.length, 15);
  assert.equal(s1.ctx.saveConfig(daTela), false, 'depois da releitura do processo principal, a tela com o padrão continua sem gravar');
  assert.deepEqual(fs.readdirSync(dir), ['config.json.bak'], 'nada criado ao lado: nem config.json, nem .tmp, nem .corrompido');
  assert.equal(fs.readFileSync(arquivo + '.bak', 'utf8'), BOM);
  const s2 = contexto(arquivo);
  assert.equal(s2.loadConfig().abas.length, 15, 'a sessão seguinte abre as 15 abas do .bak');
});

/* Todos os caminhos: config e .bak em cada estado (bom, ruim, sumido, preso no boot e solto logo depois), duas gravações da tela
   na sessão 1 e a leitura da sessão 2. Havendo cópia boa (config ou .bak bom ou preso), o padrão nunca grava por cima dela e a
   sessão seguinte abre uma cópia boa; sem nenhuma cópia boa (1ª execução, os dois ruins), a sessão grava. */
test('matriz config × .bak (bom, ruim, sumido, preso): o padrão nunca toma o lugar de uma cópia boa e, sem cópia boa, a sessão grava (final)', (t) => {
  const ESTADOS = ['bom', 'ruim', 'sumido', 'preso'];
  const NOVO = BOM.replace('jornal', 'azul');   // o config.json é mais novo que o .bak
  for (const doConfig of ESTADOS) for (const doBak of ESTADOS) {
    const caso = 'config ' + doConfig + ', .bak ' + doBak + ': ';
    const dir = pasta(t), arquivo = path.join(dir, 'config.json');
    const escrever = (alvo, estado, bom) => { if (estado === 'ruim') fs.writeFileSync(alvo, RUINS.zeros); else if (estado !== 'sumido') fs.writeFileSync(alvo, bom); };
    escrever(arquivo, doConfig, NOVO);
    escrever(arquivo + '.bak', doBak, BOM);
    const trava = { solto: false };
    const disco = Object.create(fs);
    disco.readFileSync = (p, ...r) => {
      if (!trava.solto && ((p === arquivo && doConfig === 'preso') || (p === arquivo + '.bak' && doBak === 'preso'))) throw preso('EBUSY');
      return fs.readFileSync(p, ...r);
    };
    const s1 = contexto(arquivo, { fs: disco });
    const daTela = configDaTela(s1);
    trava.solto = true;
    daTela.abas = [{ id: 'nova' }];
    const gravou = [s1.saveConfig(daTela), s1.saveConfig(daTela)];
    const reaberto = contexto(arquivo).loadConfig();
    const haviaBom = ['bom', 'preso'].includes(doConfig) || ['bom', 'preso'].includes(doBak);
    if (haviaBom) {
      assert.ok(['azul', 'jornal'].includes(reaberto.tema), caso + 'a sessão seguinte abre uma cópia boa, não o padrão: ' + JSON.stringify(reaberto).slice(0, 80));
      for (const alvo of [arquivo, arquivo + '.bak']) {
        if (fs.existsSync(alvo)) assert.ok(JSON.parse(fs.readFileSync(alvo, 'utf8')).tema, caso + path.basename(alvo) + ' ficou com o padrão');
      }
      if (doConfig === 'bom') assert.deepEqual(gravou, [true, true], caso + 'config bom: a sessão grava normal');
    } else {
      assert.deepEqual(gravou, [true, true], caso + 'sem cópia boa a sessão grava (1ª execução, recuperação)');
      assert.equal(JSON.stringify(reaberto.abas), '[{"id":"nova"}]', caso + 'e a sessão seguinte abre o que ela gravou');
    }
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], caso + 'nenhum temporário sobrando');
  }
});

/* Rodada final da leva 5 (item 3): o nomes.json e o cockpit-prompts.json vazios (0 bytes, só espaço ou zeros) ou com JSON quebrado
   (queda no meio da gravação) eram lidos como {} ou [], ninguém lia o .bak e a 2ª gravação o substituía: os nomes e os prompts bons
   iam embora. Agora os leitores caem no .bak; o {} ou [] de verdade continua valendo, sem .bak. */
const QUEBRADOS = { vazio: '', espacos: '  \r\n\t ', zeros: Buffer.alloc(4096), truncado: '{"claude:1": "Nome' };
function leitorDeNomes(alvo) {
  const ctx = vm.createContext({ fs, path, Buffer, NOMES_PATH: () => alvo });
  for (const nome of ['gravarSeguro', 'lerNomesSeguro', 'lerNomes', 'salvarNomes']) vm.runInContext(pegarBloco(MAIN, 'function ' + nome + '(', nome), ctx);
  return ctx;
}
const TRES_NOMES = { 'claude:1': 'Contrato do Pedro', 'codex:2': 'Planilha mestre', 'claude:3': 'Revisão da leva' };

for (const [nome, bytes] of Object.entries(QUEBRADOS)) {
  test('nomes.json ' + nome + ' com .bak de 3 nomes: lê os 3 do .bak, e duas gravações seguidas não perdem nenhum (final)', (t) => {
    const dir = pasta(t), alvo = path.join(dir, 'nomes.json');
    fs.writeFileSync(alvo, bytes);
    fs.writeFileSync(alvo + '.bak', JSON.stringify(TRES_NOMES));
    const ctx = leitorDeNomes(alvo);
    const lidos = ctx.lerNomesSeguro();
    assert.equal(JSON.stringify(lidos), JSON.stringify(TRES_NOMES), 'os 3 nomes do .bak');
    assert.equal(JSON.stringify(ctx.lerNomes()), JSON.stringify(TRES_NOMES), 'a lista também mostra os 3');
    lidos['claude:4'] = 'Nome novo';
    assert.equal(ctx.salvarNomes(lidos), true);
    assert.equal(ctx.salvarNomes(lidos), true);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(alvo, 'utf8'))), ['claude:1', 'codex:2', 'claude:3', 'claude:4']);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(alvo + '.bak', 'utf8'))), ['claude:1', 'codex:2', 'claude:3', 'claude:4'], 'e o .bak não perdeu os 3');
  });
}

test('nomes.json {} de verdade não cai no .bak; sem .bak, vazio continua {} e JSON quebrado continua ilegível (final)', (t) => {
  const dir = pasta(t), alvo = path.join(dir, 'nomes.json');
  fs.writeFileSync(alvo, '{}');
  fs.writeFileSync(alvo + '.bak', JSON.stringify(TRES_NOMES));
  const ctx = leitorDeNomes(alvo);
  assert.deepEqual(Object.keys(ctx.lerNomesSeguro()), [], 'você apagou todos os nomes: vale o {}');
  fs.rmSync(alvo + '.bak');
  fs.writeFileSync(alvo, '');
  assert.deepEqual(Object.keys(ctx.lerNomesSeguro()), [], 'vazio sem .bak: nenhum nome ainda, como antes');
  fs.writeFileSync(alvo, QUEBRADOS.truncado);
  assert.equal(ctx.lerNomesSeguro(), null, 'quebrado sem .bak: quem grava recusa, como antes');
  fs.writeFileSync(alvo + '.bak', '[]');
  assert.equal(ctx.lerNomesSeguro(), null, 'e um .bak que não é objeto não serve');
});

function leitorDePrompts(alvo) {
  const canais = new Map();
  const ctx = vm.createContext({ fs, path, PROMPTS_PATH: () => alvo, ipcMain: { handle: (canal, fn) => canais.set(canal, fn) } });
  const ini = MAIN.indexOf("ipcMain.handle('prompts:ler'"), fim = MAIN.indexOf("ipcMain.handle('prompts:salvar'", ini);
  vm.runInContext(MAIN.slice(ini, fim), ctx);
  return () => canais.get('prompts:ler')();
}
const DOIS_PROMPTS = [{ nome: 'Relatório', texto: 'Resuma o dia', quando: 1 }, { nome: 'Revisão', texto: 'Revise a peça', quando: 2 }];

for (const [nome, bytes] of Object.entries(QUEBRADOS)) {
  test('cockpit-prompts.json ' + nome + ' com .bak de 2 prompts: lê os 2 do .bak (final)', (t) => {
    const dir = pasta(t), alvo = path.join(dir, 'cockpit-prompts.json');
    fs.writeFileSync(alvo, bytes);
    fs.writeFileSync(alvo + '.bak', JSON.stringify(DOIS_PROMPTS));
    assert.deepEqual(Array.from(leitorDePrompts(alvo)(), (p) => p.nome), ['Relatório', 'Revisão']);
  });
}

test('cockpit-prompts.json [] de verdade não cai no .bak; sem arquivo ou sem .bak que abra, a lista é vazia como antes (final)', (t) => {
  const dir = pasta(t), alvo = path.join(dir, 'cockpit-prompts.json');
  const ler = leitorDePrompts(alvo);
  assert.equal(ler().length, 0, 'sem arquivo: lista vazia');
  fs.writeFileSync(alvo + '.bak', JSON.stringify(DOIS_PROMPTS));
  fs.writeFileSync(alvo, '[]');
  assert.equal(ler().length, 0, 'você apagou todos: vale o []');
  fs.writeFileSync(alvo, QUEBRADOS.truncado);
  fs.writeFileSync(alvo + '.bak', RUINS.zeros);
  assert.equal(ler().length, 0, 'quebrado e .bak ruim: lista vazia, sem lançar');
});

/* Rodada final da leva 5 (item 7): a recusa por telaComPadrao ou naoLido dura até reabrir o Cockpit, mas o aviso dizia "Tente salvar
   novamente". Agora o config:set manda { reler: true } nesse caso e a tela pede para reabrir; as outras falhas seguem com o texto de
   antes. Ponta a ponta, com o config:get, o config:set e o aviso da tela de verdade. */
const APP = lerFonte('renderer', 'app.js');
function avisoDaTela() {
  const avisos = []; let ouvinte;
  const ctx = vm.createContext({ mostrarAviso: (a) => avisos.push(a),
    window: { api: { onConfigSaveError: (fn) => { ouvinte = fn; return () => {}; } }, addEventListener() {}, removeEventListener() {} } });
  vm.runInContext(pegarBloco(APP, 'function acompanharFalhaAoSalvarConfig(', 'acompanharFalhaAoSalvarConfig'), ctx);
  ctx.acompanharFalhaAoSalvarConfig();
  return { avisos, receber: (dados) => ouvinte(dados) };
}
function configSet(ctx) {
  const canais = new Map(), enviados = [];
  ctx.ipcMain = { handle: (canal, fn) => canais.set(canal, fn) };
  ctx.visualMacNative = { syncConfig() {} };
  vm.runInContext(pegarBloco(MAIN, "ipcMain.handle('config:set'", 'config:set') + ');', ctx);
  return { enviados, gravar: (c) => canais.get('config:set')({ sender: { send: (canal, dados) => enviados.push([canal, JSON.stringify(dados)]) } }, c) };
}

test('tela com o padrão de um config preso: o config:set manda { reler: true } e o aviso pede para reabrir o Cockpit (final)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const { disco } = discoPreso(arquivo, () => preso('EBUSY'));
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.deepEqual(Object.keys(daTela), [], 'o config preso e sem .bak: a tela recebe o padrão');
  const set = configSet(ctx), tela = avisoDaTela();
  daTela.tema = 'claro';
  assert.equal(set.gravar(daTela), false);
  assert.deepEqual(set.enviados, [['config:save-error', '{"reler":true}']], 'a recusa dura até reabrir: o main diz isso à tela');
  tela.receber(JSON.parse(set.enviados[0][1]));
  assert.match(tela.avisos[0].texto, /^Não foi possível salvar suas preferências\./);
  assert.match(tela.avisos[0].texto, /Reabra o Cockpit para ler suas preferências\.$/);
  assert.doesNotMatch(tela.avisos[0].texto, /Tente salvar novamente/, 'tentar de novo não adianta até reabrir');
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'e o config original continua intacto');
});

test('outra falha ao salvar (disco cheio): o config:set manda {} e o aviso continua "Tente salvar novamente" (final)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const disco = Object.create(fs);
  disco.openSync = (p, ...r) => { if (p === arquivo + '.tmp') throw Object.assign(new Error('ENOSPC: no space left on device, open'), { code: 'ENOSPC' }); return fs.openSync(p, ...r); };
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.equal(daTela.tema, 'jornal', 'a tela leu o config');
  const set = configSet(ctx), tela = avisoDaTela();
  assert.equal(set.gravar({ ...daTela, tema: 'claro' }), false);
  assert.deepEqual(set.enviados, [['config:save-error', '{}']], 'nada de reler: a próxima tentativa pode dar certo');
  tela.receber(JSON.parse(set.enviados[0][1]));
  assert.match(tela.avisos[0].texto, /Tente salvar novamente\.$/);
  assert.doesNotMatch(tela.avisos[0].texto, /Reabra/);
});

/* Rodada 2 da leva 5 (item 1): a tela leu bem no boot, mas OUTRO leitor do processo principal (o pastasDeTrabalho do
   apresentar_artefato, o ligado() do nome dos agentes, o setVisualMac) releu o config com ele e o .bak presos pelo antivírus por mais
   de 120 ms, o que acontece logo depois de cada gravação. Esse padrão ligava o naoLido e, dali em diante, todo config:set da tela era
   recusado com o aviso FALSO "Reabra o Cockpit", até outra leitura do main dar certo (o savePanes de 30 s e o do beforeunload também
   caíam). Agora o config:set da tela que leu bem relê antes de gravar, e o "Reabra" só aparece quando a tela está com o padrão. */
const { createVisualMacNative } = require('../src/visual-mac-native');
function discoComTrava(arquivo) {
  // presa: config.json e .bak presos enquanto ligada; leiturasPresas: as N leituras seguintes deles falham e depois soltam
  const trava = { presa: false, leiturasPresas: 0 };
  const disco = Object.create(fs);
  disco.readFileSync = (p, ...r) => {
    if (p === arquivo || p === arquivo + '.bak') {
      if (trava.leiturasPresas > 0) { trava.leiturasPresas--; throw preso('EBUSY'); }
      if (trava.presa) throw preso('EBUSY');
    }
    return fs.readFileSync(p, ...r);
  };
  return { disco, trava };
}
function sessaoQueLeuBem(t) {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  fs.writeFileSync(arquivo + '.bak', BOM);
  const { disco, trava } = discoComTrava(arquivo);
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.equal(daTela.abas.length, 15, 'a tela leu bem no boot');
  assert.equal(ctx.loadConfig.telaComPadrao, false);
  return { dir, arquivo, trava, ctx, daTela, set: configSet(ctx), tela: avisoDaTela() };
}

test('a tela leu bem e outro leitor do main pegou o config e o .bak presos: solto o arquivo, o config:set seguinte grava (rodada 2)', (t) => {
  const s = sessaoQueLeuBem(t);
  s.daTela.tema = 'claro';
  assert.equal(s.set.gravar(s.daTela), true, 'a tela grava');
  s.trava.presa = true;   // o antivírus segura os dois logo depois da gravação
  assert.deepEqual(Object.keys(s.ctx.loadConfig()), [], 'o outro leitor (pastasDeTrabalho, ligado(), setVisualMac) recebe o padrão');
  assert.equal(s.ctx.loadConfig.naoLido, true);
  s.trava.presa = false;  // e solta
  s.daTela.uiCollapsed = true;
  assert.equal(s.set.gravar(s.daTela), true, 'a tela leu bem: a gravação dela passa');
  s.daTela.uiTorreAltura = 40;
  assert.equal(s.set.gravar(s.daTela), true, 'e a seguinte também');
  assert.deepEqual(s.set.enviados, [], 'nenhum aviso de falha');
  const gravado = JSON.parse(fs.readFileSync(s.arquivo, 'utf8'));
  assert.deepEqual([gravado.tema, gravado.uiCollapsed, gravado.uiTorreAltura, gravado.abas.length], ['claro', true, 40, 15]);
  assert.equal(JSON.parse(fs.readFileSync(s.arquivo + '.bak', 'utf8')).uiCollapsed, true, 'a cópia é a gravação de antes');
  assert.notEqual(s.ctx.loadConfig.naoLido, true);
});

test('a mesma coisa com o arquivo ainda preso: recusa com o aviso normal, sem "Reabra"; solto, a próxima grava sem reabrir (rodada 2)', (t) => {
  const s = sessaoQueLeuBem(t);
  s.trava.presa = true;
  s.ctx.loadConfig();   // o outro leitor do main
  assert.equal(s.ctx.loadConfig.naoLido, true);
  s.daTela.uiCollapsed = true;
  assert.equal(s.set.gravar(s.daTela), false, 'ainda preso: não grava');
  assert.deepEqual(s.set.enviados, [['config:save-error', '{}']], 'é passageiro: nada de reler');
  s.tela.receber(JSON.parse(s.set.enviados[0][1]));
  assert.match(s.tela.avisos[0].texto, /Tente salvar novamente\.$/);
  assert.doesNotMatch(s.tela.avisos[0].texto, /Reabra/);
  assert.equal(fs.readFileSync(s.arquivo, 'utf8'), BOM, 'o config continua intacto');
  s.trava.presa = false;
  assert.equal(s.set.gravar(s.daTela), true, 'tentar de novo adianta');
  assert.equal(JSON.parse(fs.readFileSync(s.arquivo, 'utf8')).uiCollapsed, true);
  assert.equal(s.set.enviados.length, 1, 'sem aviso novo');
});

test('a tela com o padrão do boot (config preso, sem .bak) continua recusada com "Reabra", mesmo com o arquivo solto e relido pelo main (rodada 2)', (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const { disco, trava } = discoComTrava(arquivo);
  trava.presa = true;
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.deepEqual(Object.keys(daTela), [], 'a tela recebeu o padrão');
  assert.equal(ctx.loadConfig.telaComPadrao, true);
  const set = configSet(ctx), tela = avisoDaTela();
  trava.presa = false;   // o antivírus soltou
  daTela.tema = 'claro';
  assert.equal(set.gravar(daTela), false, 'com o padrão na mão: recusa');
  assert.equal(ctx.loadConfig().tema, 'jornal', 'o main já relê o original');
  assert.equal(ctx.loadConfig.naoLido, false);
  assert.equal(set.gravar(daTela), false, 'e a tela continua com o padrão: recusa');
  assert.deepEqual(set.enviados, [['config:save-error', '{"reler":true}'], ['config:save-error', '{"reler":true}']]);
  tela.receber(JSON.parse(set.enviados[1][1]));
  assert.match(tela.avisos[0].texto, /Reabra o Cockpit para ler suas preferências\.$/);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), BOM, 'o original continua intacto');
  assert.deepEqual(fs.readdirSync(dir), ['config.json'], 'nada criado ao lado');
});

test('o visual-mac-native continua recusado com o config não lido: o padrão não grava por cima, nem com o arquivo solto logo depois da leitura dele (rodada 2)', (t) => {
  const s = sessaoQueLeuBem(t);
  const canais = new Map();
  const webContents = { mainFrame: {}, isDestroyed: () => false, send() {}, on() {} };
  const janela = { webContents, isDestroyed: () => false, on() {}, setBackgroundMaterial() {}, setBackgroundColor() {}, setTitleBarOverlay() {} };
  const nativo = createVisualMacNative({ app: {}, ipcMain: { handle: (c, fn) => canais.set(c, fn), on() {} }, Menu: {}, nativeImage: {},
    nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' }, systemPreferences: { getAccentColor: () => '2468acff' },
    platform: 'win32', getWindow: () => janela, loadConfig: s.ctx.loadConfig, saveConfig: s.ctx.saveConfig });
  nativo.install();
  const visualMac = (v) => canais.get('visual-mac:set')({ sender: webContents, senderFrame: webContents.mainFrame }, v);
  s.trava.leiturasPresas = 8;   // as 4 tentativas do config.json e as 4 do .bak na leitura do setVisualMac; soltam logo depois
  assert.deepEqual(visualMac(false), { error: 'Não foi possível salvar a aparência.' });
  assert.equal(s.trava.leiturasPresas, 0, 'a leitura dele pegou os dois presos');
  assert.equal(s.ctx.loadConfig.naoLido, true);
  assert.equal(fs.readFileSync(s.arquivo, 'utf8'), BOM, 'o padrão com o visualMac não foi gravado por cima');
  s.trava.presa = true;
  assert.deepEqual(visualMac(false), { error: 'Não foi possível salvar a aparência.' }, 'preso: recusado');
  s.trava.presa = false;
  assert.deepEqual(visualMac(false), { ok: true, visualMac: false }, 'lido o config, grava');
  const gravado = JSON.parse(fs.readFileSync(s.arquivo, 'utf8'));
  assert.deepEqual([gravado.visualMac, gravado.abas.length], [false, 15], 'com as 15 abas');
});

/* Rodada 2 da leva 5 (item 2): quem lê o config no main para fazer uma coisa automática tratava o padrão de um config NÃO lido
   (naoLido: config e .bak presos; semCopia: os dois ruins) como verdade. O limparQuadrosOrfaos, no boot, via fichas "{}" e APAGAVA
   todo quadro com mais de 1 dia, até os que o config de verdade aponta; o atualizador de motores (autoUpdateEngines) e o nome dos
   agentes (tituloAuto) liam o padrão como "ligado". Agora, sem o config lido, a coisa automática opcional não acontece naquela vez. */
const CASOS_DO_BOOT = {
  'config bom e .bak bom': { config: 'bom', bak: 'bom', presos: [] },
  'config ruim e .bak bom': { config: 'ruim', bak: 'bom', presos: [] },
  'config bom e .bak presos (antivírus)': { config: 'bom', bak: 'bom', presos: ['config', 'bak'] },
  'config bom preso e sem .bak (1ª sessão)': { config: 'bom', bak: 'sumido', presos: ['config'] },
  'config ruim e .bak preso (o caso da final 1)': { config: 'ruim', bak: 'bom', presos: ['bak'] },
  'config e .bak zerados (tela azul de 05/10)': { config: 'ruim', bak: 'ruim', presos: [] },
};
const LIDOS = ['config bom e .bak bom', 'config ruim e .bak bom'];
function bootCom(t, caso, conteudoDe) {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  const { config, bak, presos } = CASOS_DO_BOOT[caso];
  const conteudo = typeof conteudoDe === 'function' ? conteudoDe(dir) : conteudoDe;
  const escrever = (alvo, estado) => { if (estado === 'ruim') fs.writeFileSync(alvo, Buffer.alloc(8000)); else if (estado === 'bom') fs.writeFileSync(alvo, conteudo); };
  escrever(arquivo, config);
  escrever(arquivo + '.bak', bak);
  const travados = presos.map((p) => (p === 'bak' ? arquivo + '.bak' : arquivo));
  const disco = Object.create(fs);
  disco.readFileSync = (p, ...r) => { if (travados.includes(p)) throw preso('EBUSY'); return fs.readFileSync(p, ...r); };
  return { dir, ctx: contexto(arquivo, { fs: disco, app: { getPath: () => dir, isPackaged: true }, explicitUserData: false }) };
}

for (const caso of Object.keys(CASOS_DO_BOOT)) {
  const lido = LIDOS.includes(caso);
  test('limparQuadrosOrfaos no boot, ' + caso + ': o quadro que a ficha aponta fica' + (lido ? ' e o órfão de 2 dias sai' : ', e nada é apagado com o config não lido') + ' (rodada 2)', (t) => {
    let q;   // a ficha guarda o caminho inteiro do quadro, dentro do userData da sessão
    const b = bootCom(t, caso, (dir) => {
      q = { daFicha: path.join(dir, 'quadros', 'quadro-p1.excalidraw'), orfao: path.join(dir, 'quadros', 'quadro-velho.excalidraw') };
      return JSON.stringify({ abas: [{ id: 'a', paineis: [{ id: 'p1', quadro: q.daFicha }] }] });
    });
    fs.mkdirSync(path.join(b.dir, 'quadros'));
    const doisDias = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    for (const alvo of [q.daFicha, q.orfao]) { fs.writeFileSync(alvo, '{"type":"excalidraw","elements":[1,2,3]}'); fs.utimesSync(alvo, doisDias, doisDias); }
    vm.runInContext(pegarBloco(MAIN, 'function limparQuadrosOrfaos(', 'limparQuadrosOrfaos'), b.ctx);
    b.ctx.limparQuadrosOrfaos();
    assert.equal(fs.existsSync(q.daFicha), true, 'o quadro de uma conversa de anteontem, ainda na ficha, ficou');
    assert.equal(fs.existsSync(q.orfao), !lido, lido ? 'config lido: o órfão sai, como sempre' : 'config não lido: a limpeza fica para a próxima vez');
  });
}

test('atualizar os motores (autoUpdateEngines) e o nome dos agentes (tituloAuto) não ligam sozinhos com o config não lido; lido, seguem a chave (rodada 2)', (t) => {
  const atualizacao = /^\s*enabled: (\(\) => app\.isPackaged[^\n]*?),$/m.exec(MAIN);
  const nomeador = /^\s*ligado: (\(\) => [^\n]*?),?$/m.exec(pegarBloco(MAIN, 'const nomeadorDeAgentes = nomesAgentes.registrar(ipcMain, {', 'nomeadorDeAgentes'));
  assert.ok(atualizacao && nomeador, 'achei as duas linhas no main.js');
  const ligados = (ctx) => [vm.runInContext('(' + atualizacao[1] + ')', ctx)(), vm.runInContext('(' + nomeador[1] + ')', ctx)()];
  for (const caso of Object.keys(CASOS_DO_BOOT)) {
    const lido = LIDOS.includes(caso);
    assert.deepEqual(ligados(bootCom(t, caso, BOM).ctx), [lido, lido], caso + (lido ? ': ligados por padrão' : ': não ligam sozinhos'));
  }
  const desligado = JSON.stringify({ ...JSON.parse(BOM), autoUpdateEngines: false, tituloAuto: false });
  assert.deepEqual(ligados(bootCom(t, 'config bom e .bak bom', desligado).ctx), [false, false], 'desligados nos Ajustes: seguem desligados');
});

/* Conferência da rodada 2 da leva 5 (item 1 dos 2 achados Menores): o ligado() do nome dos agentes. A tela leu bem (cfg.tituloAuto
   ligado) e o lote de agentes chega ao main logo depois de uma gravação, com o config e o .bak presos pelo antivírus: o ligado() lia o
   padrão, via naoLido e devolvia false. O Haiku nem era chamado e a tela, que marca o agente como "já pedido" ANTES da resposta, o
   deixava com o nome em inglês para sempre. Agora, com a leitura presa, vale a tela que leu bem (ela mesma confere cfg.tituloAuto antes
   de mandar o lote); a tela com o padrão do boot continua sem nome. As funções são as de verdade: o loadConfig, o config:get e o
   ligado() do main.js, o criarNomeador do nomes-agentes.js e o lote da tela (app.js); só o Haiku é de mentira. */
const { criarNomeador } = require('../src/nomes-agentes');
const AGENTE = { id: 'ag1', paneId: 'p1', tipo: 'Explore', pedido: 'Review the landing page links', task: 'Explore codebase' };
const LOTE = [{ chave: 'p1|ag1', tipo: 'Explore', pedido: 'Review the landing page links', descricao: '' }];
// as duas linhas do main.js (a atualização dos motores e o nome dos agentes), avaliadas no contexto do loadConfig
function guardasDoMain(ctx) {
  const atualizacao = /^\s*enabled: (\(\) => app\.isPackaged[^\n]*?),$/m.exec(MAIN);
  const nomeador = /^\s*ligado: (\(\) => [^\n]*?),?$/m.exec(pegarBloco(MAIN, 'const nomeadorDeAgentes = nomesAgentes.registrar(ipcMain, {', 'nomeadorDeAgentes'));
  assert.ok(atualizacao && nomeador, 'achei as duas linhas no main.js');
  return { enabled: vm.runInContext('(' + atualizacao[1] + ')', ctx), ligado: vm.runInContext('(' + nomeador[1] + ')', ctx) };
}
// o Haiku de mentira conta as chamadas e responde um nome válido para o 1º agente do lote
function nomeadorComHaiku(ligado) {
  const haiku = { chamadas: 0 };
  const claudeRapido = { cancelar() {}, perguntar: async () => { haiku.chamadas++; return { ok: true, texto: JSON.stringify([{ id: '1', titulo: 'Revisando página', linha: 'confere textos e links da home' }]) }; } };
  return { haiku, nomeador: criarNomeador({ claudeRapido, ligado }) };
}
// a tela de verdade (app.js, bloco "nome dos agentes"): junta o lote, fecha no timer e manda ao main pelo agentes:nomes
function telaDosAgentes(cfg, nomear) {
  const timers = [], aplicados = [];
  const tela = vm.createContext({ cfg, aplicados, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, window: { api: { agentesNomes: nomear } } });
  vm.runInContext(/^const NOMES_AG = .*$/m.exec(APP)[0] + '\n' + /^const agNomes = .*$/m.exec(APP)[0], tela);
  for (const n of ['chaveDoAgente', 'coletarNomeDoAgente', 'agendarNomesDosAgentes']) vm.runInContext(pegarBloco(APP, 'function ' + n + '(', n), tela);
  vm.runInContext(pegarBloco(APP, 'async function buscarNomesDosAgentes(', 'buscarNomesDosAgentes'), tela);
  vm.runInContext('function aplicarNomesDosAgentes(itens) { for (const a of itens) aplicados.push(a.chave); }', tela);
  return { tela, timers, aplicados, fecharLote: async () => { while (timers.length) await timers.shift()(); } };
}

test('nome dos agentes: a tela leu bem e o lote chega com o config e o .bak presos: o Haiku é chamado e o agente ganha o nome em português (conferência da rodada 2)', async (t) => {
  const s = sessaoQueLeuBem(t);   // a tela leu as 15 abas no boot; o config não tem tituloAuto: ligado por padrão
  const { haiku, nomeador } = nomeadorComHaiku(guardasDoMain(s.ctx).ligado);
  const agentes = telaDosAgentes(s.daTela, (lista) => nomeador.nomear(lista));
  s.trava.presa = true;   // logo depois de uma gravação o antivírus segura o config e o .bak
  agentes.tela.coletarNomeDoAgente(AGENTE);
  await agentes.fecharLote();
  assert.equal(s.ctx.loadConfig.naoLido, true, 'o ligado() pegou o config e o .bak presos e leu o padrão');
  assert.equal(haiku.chamadas, 1, 'a tela leu bem: o Haiku é chamado');
  assert.deepEqual(agentes.aplicados, ['p1|ag1'], 'o agente ganhou o nome em português');
});

test('nome dos agentes: a tela com o padrão do boot (config preso, sem .bak) e a leitura ainda presa no lote: não nomeia e o Haiku nem é chamado (conferência da rodada 2)', async (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, BOM);
  const { disco, trava } = discoComTrava(arquivo);
  trava.presa = true;
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.deepEqual(Object.keys(daTela), [], 'a tela recebeu o padrão');
  assert.equal(ctx.loadConfig.telaComPadrao, true);
  const { haiku, nomeador } = nomeadorComHaiku(guardasDoMain(ctx).ligado);
  assert.deepEqual(await nomeador.nomear(LOTE), {}, 'a tela não sabe o que o Hugo escolheu: o main não nomeia');
  assert.equal(ctx.loadConfig.naoLido, true);
  assert.equal(haiku.chamadas, 0, 'e o Haiku nem é chamado');
});

test('nome dos agentes: tituloAuto:false lido nos Ajustes não nomeia, e a tela que leu isso nem manda o lote, com ou sem a leitura presa (conferência da rodada 2)', async (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  const desligado = JSON.stringify({ ...JSON.parse(BOM), tituloAuto: false });
  fs.writeFileSync(arquivo, desligado);
  fs.writeFileSync(arquivo + '.bak', desligado);
  const { disco, trava } = discoComTrava(arquivo);
  const ctx = contexto(arquivo, { fs: disco });
  const daTela = configDaTela(ctx);
  assert.equal(daTela.tituloAuto, false, 'a tela leu o desligado');
  const { haiku, nomeador } = nomeadorComHaiku(guardasDoMain(ctx).ligado);
  assert.deepEqual(await nomeador.nomear(LOTE), {}, 'lido: o main segue a chave do Hugo');
  assert.equal(haiku.chamadas, 0);
  // Com a leitura presa o main lê o padrão e confia na tela que leu bem; quem barra é a tela, que confere cfg.tituloAuto antes de
  // juntar o lote e de novo antes de mandá-lo (é a premissa de o ligado() confiar nela).
  trava.presa = true;
  const agentes = telaDosAgentes(daTela, (lista) => nomeador.nomear(lista));
  agentes.tela.coletarNomeDoAgente(AGENTE);
  assert.equal(agentes.timers.length, 0, 'tituloAuto:false na tela: nenhum lote é juntado');
  daTela.tituloAuto = true;
  agentes.tela.coletarNomeDoAgente(AGENTE);
  assert.equal(agentes.timers.length, 1, 'ligado na tela: o lote é juntado');
  daTela.tituloAuto = false;   // o Hugo desligou enquanto o lote juntava
  await agentes.fecharLote();
  assert.equal(haiku.chamadas, 0, 'a tela não manda o lote; o Haiku nunca é chamado');
  assert.deepEqual(agentes.aplicados, []);
});

/* Conferência da rodada 2 da leva 5 (item 2 dos 2 achados Menores): o semCopia liga uma vez e não desliga mais. O boot pega um config.json
   ruim e o .bak preso só na 1ª leitura (a do createVisualMacNative, antes do whenReady); depois o .bak solta e a tela lê as abas de
   verdade. Mesmo assim o semCopia seguia ligado e a sessão inteira ficava sem o nome dos agentes e sem a atualização dos motores: o
   engineUpdates.start() roda UMA vez, no whenReady, e sem o enabled() ele não chama nem o recover() do Codex (a volta de uma atualização
   que caiu no meio). Agora o semCopia (que continua ligado, só a gravação precisa dele) só segura quando ESTA leitura devolveu o padrão,
   sem chave nenhuma; a leitura de um config de verdade (as abas do .bak, ou o config que a sessão gravou) vale. Com o config e o .bak
   zerados nada liga, e na 1ª execução (sem config nem .bak) segue tudo ligado. O atualizador é o de verdade (createEngineUpdater, do
   engine-updates.js) com o enabled() do main.js e um backend de mentira que só conta o recover(). */
const { createEngineUpdater } = require('../src/engine-updates');
const NO_PACOTE = { app: { isPackaged: true }, explicitUserData: false };
async function rodarAtualizador(t, enabled) {
  const dir = pasta(t), chamadas = { recover: 0 };
  const backend = { recover: async () => { chamadas.recover++; }, inspect: async () => ({ installed: '1.0.0', target: '1.0.0', state: 'current' }), install: async () => '1.0.0' };
  const atualizador = createEngineUpdater({ directory: () => dir, enabled, platform: 'win32', backend, run: async () => ({ stdout: '' }) });
  await atualizador.start();
  return { ligado: atualizador.snapshot().enabled, recover: chamadas.recover };
}

test('semCopia ligado pela 1ª leitura do boot (config ruim e .bak preso) e o .bak solta: a tela lê as 15 abas e a atualização dos motores, com o recover do Codex, e o nome dos agentes ligam (conferência da rodada 2)', async (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, RUINS.zeros);
  fs.writeFileSync(arquivo + '.bak', BOM);
  const s = sessaoComBakPreso(arquivo);   // o .bak fica preso até trava.solto
  Object.assign(s.ctx, NO_PACOTE);
  assert.deepEqual(Object.keys(s.ctx.loadConfig()), [], 'a 1ª leitura do boot pega o config ruim e o .bak preso');
  assert.equal(s.ctx.loadConfig.semCopia, true);
  s.trava.solto = true;   // o antivírus solta o .bak
  const g = guardasDoMain(s.ctx);
  const motores = await rodarAtualizador(t, g.enabled);   // o engineUpdates.start() do whenReady
  assert.deepEqual(motores, { ligado: true, recover: 1 }, 'a atualização liga e o recover() do Codex roda');
  assert.equal(configDaTela(s.ctx).abas.length, 15, 'a tela lê as 15 abas do .bak');
  assert.equal(s.ctx.loadConfig.semCopia, true, 'o semCopia segue ligado: só a leitura do padrão é que ele segura');
  assert.equal(g.ligado(), true, 'e o nome dos agentes liga');
});

test('semCopia e a leitura devolve o padrão (config e .bak zerados, depois já guardados): a atualização, o recover do Codex e o nome dos agentes não ligam; gravado o config da sessão, a leitura volta a valer (conferência da rodada 2)', async (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  fs.writeFileSync(arquivo, RUINS.zeros);
  fs.writeFileSync(arquivo + '.bak', RUINS.zeros);
  const ctx = contexto(arquivo, NO_PACOTE);
  const g = guardasDoMain(ctx);
  assert.deepEqual(await rodarAtualizador(t, g.enabled), { ligado: false, recover: 0 }, 'os dois ruins: nem atualiza nem recupera');
  assert.equal(ctx.loadConfig.semCopia, true);
  assert.equal(g.ligado(), false, 'os dois já guardados como .corrompido: a leitura segue devolvendo o padrão e o nome não liga');
  assert.equal(ctx.saveConfig({ tema: 'azul', abas: [{ id: 'a' }] }), true);
  assert.equal(g.ligado(), true, 'a sessão gravou o config dela: a leitura seguinte é de um config de verdade');
  assert.equal(ctx.loadConfig.semCopia, true);
});

test('1ª execução (sem config nem .bak): a atualização dos motores, com o recover do Codex, e o nome dos agentes seguem ligados por padrão (conferência da rodada 2)', async (t) => {
  const dir = pasta(t), arquivo = path.join(dir, 'config.json');
  const ctx = contexto(arquivo, NO_PACOTE);
  const g = guardasDoMain(ctx);
  assert.deepEqual(await rodarAtualizador(t, g.enabled), { ligado: true, recover: 1 });
  assert.equal(g.ligado(), true);
  assert.equal(ctx.loadConfig.semCopia, undefined, 'instalação nova não é config perdido');
  assert.notEqual(ctx.loadConfig.naoLido, true);
});
