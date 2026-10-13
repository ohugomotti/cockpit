'use strict';

/* Leva 0, tarefa L0-a: auditoria das APIs do Electron 32.3.3 -> 44.
   Confere o inventário (tools/electron44/inventario.cjs) e o comparador
   (tools/electron44/comparar.cjs). Roda só em Node: não abre Electron e não lê a
   área de transferência.

   De onde vem cada afirmação, e por quê:
   - COMPORTAMENTO do inventário e do comparador: sobre a FIXTURE pequena em
     test/fixtures/electron44/ (um mini src/ escrito para este teste). Nada aqui
     depende do src/ vivo. O src/ tem hoje o bug do colar (clipboard.readImage,
     readBuffer, readText síncrono) e a leva 1 vai corrigir isso e trocar os catch
     vazios por logMain; um teste que exigisse esses trechos no main.js ficaria
     vermelho justamente quando o código ficasse certo.
   - PROVAS da auditoria: os arquivos CONGELADOS de tools/electron44/ (o
     inventario.json, retrato do src/ no commit 8145ea6, e os resultado-<versão>.json
     das sondas de 01/10). Não regerar o inventario.json depois de corrigir o colar:
     ele é a prova do que existia. Se for rodar o inventário de novo, guarde uma cópia
     dele antes (o comando sempre grava em inventario.json).
   - O src/ de verdade só entra em INVARIANTES que valem para qualquer código
     (formato do item, linha real, nada de vendor).
   Cada linha da fixture que o teste confere leva uma marca "// @nome" no fim; é por
   ela que o teste acha a linha esperada, em vez de um número fixo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const FERRAMENTAS = path.join(RAIZ, 'tools', 'electron44');
const AMOSTRA = path.join(__dirname, 'fixtures', 'electron44');
const { inventariar, _interno } = require(path.join(FERRAMENTAS, 'inventario.cjs'));
const { comparar } = require(path.join(FERRAMENTAS, 'comparar.cjs'));

const MAIN = 'src/main.js';
const INJETADO = 'src/cockpit-injetado.js';
const VENDOR = 'src/renderer/vendor/biblioteca.js';

const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const congelado = lerJson(path.join(FERRAMENTAS, 'inventario.json'));
const amostra = inventariar({ raiz: AMOSTRA });

const emCache = new Map();
const linhasDe = (base, rel) => {
  const chave = path.join(base, rel);
  if (!emCache.has(chave)) emCache.set(chave, fs.readFileSync(chave, 'utf8').split(/\r?\n/));
  return emCache.get(chave);
};
/* Linha (1-based) da fixture que termina com "// @marca". A marca tem que existir uma vez só. */
const linhaDe = (rel, marca) => {
  const achadas = [];
  linhasDe(AMOSTRA, rel).forEach((l, i) => { if (l.endsWith('// @' + marca)) achadas.push(i + 1); });
  assert.equal(achadas.length, 1, 'a marca @' + marca + ' tem que aparecer uma vez só em ' + rel);
  return achadas[0];
};
const acha = (modulo, membro, arquivo) => amostra.itens.filter((i) => i.modulo === modulo && i.membro === membro
  && (!arquivo || i.arquivo === arquivo));
const naLinha = (rel, linha) => amostra.itens.filter((i) => i.arquivo === rel && i.linha === linha);
const api = (i) => i.modulo + (i.instancia ? '#' : '.') + i.membro;
const daLinha = (i) => i.linha;
const ehVendor = (arquivo) => /(^|\/)vendor\//.test(arquivo.replace(/\\/g, '/'));

/* O que o item tem que trazer, em qualquer código (contrato do brief da Task 1). */
function conferirFormato(i) {
  assert.equal(typeof i.arquivo, 'string');
  assert.ok(i.arquivo.length > 0, 'item sem arquivo: ' + JSON.stringify(i));
  assert.ok(Number.isInteger(i.linha) && i.linha > 0, 'linha inválida: ' + JSON.stringify(i));
  assert.equal(typeof i.modulo, 'string');
  assert.equal(typeof i.membro, 'string');
  assert.equal(typeof i.aguardado, 'boolean');
  assert.equal(typeof i.trecho, 'string');
}
/* A linha apontada tem que mostrar de fato o membro (ou o módulo, nos itens "(módulo)" e "(construtor)"). */
function conferirLinhaReal(base, i) {
  const linha = linhasDe(base, i.arquivo)[i.linha - 1];
  assert.equal(typeof linha, 'string', 'linha ' + i.linha + ' não existe em ' + i.arquivo);
  const procurado = /^[A-Za-z_$][\w$]*$/.test(i.membro) ? i.membro : i.modulo;
  assert.ok(linha.includes(procurado), i.arquivo + ':' + i.linha + ' não mostra "' + procurado + '": ' + linha.trim());
  assert.equal(i.trecho, linha.trim().slice(0, 200), 'trecho diferente da linha em ' + i.arquivo + ':' + i.linha);
}

/* ================= inventario.cjs sobre a FIXTURE ================= */

test('inventário (fixture): acha clipboard.readImage, readText e readBuffer, cada um na linha certa', () => {
  assert.deepEqual(acha('clipboard', 'readImage', MAIN).map(daLinha), [linhaDe(MAIN, 'imagem')]);
  assert.deepEqual(acha('clipboard', 'readText', MAIN).map(daLinha), [linhaDe(MAIN, 'texto-await'), linhaDe(MAIN, 'texto-sem-await')]);
  assert.deepEqual(acha('clipboard', 'readBuffer', MAIN).map(daLinha), [linhaDe(MAIN, 'buffer')]);
  for (const i of [...acha('clipboard', 'readImage'), ...acha('clipboard', 'readText')]) assert.equal(i.chamada, true);
});

test('inventário (fixture): cada item tem arquivo, linha > 0, módulo, membro, aguardado e trecho', () => {
  assert.ok(amostra.itens.length > 0);
  assert.equal(amostra.totalItens, amostra.itens.length);
  for (const i of amostra.itens) conferirFormato(i);
});

test('inventário (fixture): a linha registrada é a linha real do arquivo', () => {
  for (const i of amostra.itens) conferirLinhaReal(AMOSTRA, i);
});

test('inventário (fixture): vendor fica de fora, mesmo com uso de API do Electron lá dentro', () => {
  // o arquivo de vendor existe e TEM uso de API (senão o teste passaria de graça)...
  const direto = _interno.itensDoArquivo(_interno.prepararArquivo(AMOSTRA, path.join(AMOSTRA, VENDOR)));
  assert.ok(direto.some((i) => i.modulo === 'clipboard' && i.membro === 'readBookmark'),
    'a fixture de vendor tem que usar clipboard.readBookmark, senão não prova nada');
  // ...e mesmo assim o inventário não o lista em lugar nenhum
  assert.ok(!amostra.arquivosLidos.includes(VENDOR), 'vendor entrou em arquivosLidos');
  assert.deepEqual(amostra.itens.filter((i) => ehVendor(i.arquivo)), []);
  assert.deepEqual(amostra.catchVazios.filter((c) => ehVendor(c.arquivo)), []);
  assert.deepEqual(amostra.web.filter((w) => ehVendor(w.arquivo)), []);
  // o resto da fixture continua sendo lido
  for (const rel of [MAIN, INJETADO, 'src/janela-opcoes.js', 'src/generico.js']) assert.ok(amostra.arquivosLidos.includes(rel), rel);
});

test('inventário (fixture): await e .then( marcam aguardado; chamada sem await não', () => {
  const aguarda = (modulo, membro, marca) => {
    const achados = acha(modulo, membro, MAIN).filter((i) => i.linha === linhaDe(MAIN, marca));
    assert.equal(achados.length, 1, modulo + '.' + membro + ' na marca @' + marca);
    return achados[0].aguardado;
  };
  assert.equal(aguarda('clipboard', 'readText', 'texto-await'), true, 'await clipboard.readText()');
  assert.equal(aguarda('clipboard', 'readText', 'texto-sem-await'), false, 'return clipboard.readText() sem esperar');
  assert.equal(aguarda('clipboard', 'writeText', 'copiar'), true);
  assert.equal(aguarda('dialog', 'showSaveDialog', 'salvar-await'), true);
  assert.equal(aguarda('dialog', 'showSaveDialog', 'salvar-sem-await'), false);
  assert.equal(aguarda('dialog', 'showOpenDialog', 'abrir-then'), true, 'showOpenDialog(...).then(');
  assert.equal(aguarda('app', 'whenReady', 'pronto'), true, 'app.whenReady().then(');
  // ler uma propriedade não é chamada: não há o que esperar
  assert.equal(acha('app', 'isPackaged', MAIN)[0].aguardado, false);
});

test('inventário (fixture): comentário de linha e de bloco não vira item', () => {
  // "clipboard.writeHTML(...)" e "app.relaunch()" só aparecem em comentário
  assert.deepEqual(amostra.itens.filter((i) => ['writeHTML', 'relaunch'].includes(i.membro)), []);
});

test('inventário (fixture): texto entre aspas, template e regex não viram item', () => {
  // dialog.showMessageBox (aspas), clipboard.readRTF (template), clipboard.readFindText (regex)
  // e "renderer/app.js" (aspas: não é app.js) só aparecem como texto
  assert.deepEqual(amostra.itens.filter((i) => ['showMessageBox', 'readRTF', 'readFindText', 'js'].includes(i.membro)), []);
  for (const marca of ['aspas-dialog', 'template-rtf', 'regex']) {
    assert.deepEqual(naLinha(MAIN, linhaDe(MAIN, marca)).map(api), [], 'a linha @' + marca + ' só tem texto');
  }
  // na linha do 'renderer/app.js' só existe a chamada de verdade
  assert.deepEqual(naLinha(MAIN, linhaDe(MAIN, 'aspas-app')).map(api), ['BrowserWindow#loadFile']);
});

test('inventário (fixture): o código depois de um texto com // dentro continua sendo lido', () => {
  // 'https://exemplo.com/a'; clipboard.availableFormats();  -> o // da URL não é comentário
  assert.deepEqual(naLinha(MAIN, linhaDe(MAIN, 'depois-das-aspas')).map(api), ['clipboard.availableFormats']);
});

test('inventário (fixture): apelido no require (ipcMain: ipcPrincipal) e injeção por parâmetro (ipcMain: nativeIpc)', () => {
  const noMain = acha('ipcMain', 'handle', MAIN);
  assert.deepEqual(noMain.map((i) => i.canal), ['clipboard:anexos', 'clipboard:copiar']);
  assert.ok(noMain.every((i) => i.origem === 'require'));
  assert.deepEqual(noMain.map(daLinha).slice(0, 1), [linhaDe(MAIN, 'canal-anexos')]);

  const injetados = [['ipcMain', 'handle', 'ping'], ['safeStorage', 'encryptString', 'cifrar'], ['nativeTheme', 'shouldUseDarkColors', 'escuro']];
  for (const [modulo, membro, marca] of injetados) {
    const achados = acha(modulo, membro, INJETADO);
    assert.deepEqual(achados.map(daLinha), [linhaDe(INJETADO, marca)], modulo + '.' + membro);
    assert.equal(achados[0].origem, 'injecao', modulo + '.' + membro + ' chega por parâmetro');
  }
  assert.equal(acha('ipcMain', 'handle', INJETADO)[0].canal, 'exemplo:ping');
});

test('inventário (fixture): nome genérico sozinho (app, shell) num parâmetro não vira API do Electron', () => {
  assert.ok(amostra.arquivosLidos.includes('src/generico.js'));
  assert.deepEqual(amostra.itens.filter((i) => i.arquivo === 'src/generico.js'), []);
});

test('inventário (fixture): instâncias de janela, webContents, sessão e imagem aparecem', () => {
  const inst = (modulo, membro) => acha(modulo, membro, MAIN).filter((i) => i.instancia);
  assert.deepEqual(inst('BrowserWindow', 'setAppDetails').map(daLinha), [linhaDe(MAIN, 'detalhes')]);
  assert.deepEqual(inst('WebContents', 'setWindowOpenHandler').map(daLinha), [linhaDe(MAIN, 'abrir-handler')]);
  assert.deepEqual(inst('Session', 'setPermissionCheckHandler').map(daLinha), [linhaDe(MAIN, 'permissao')]);
  assert.deepEqual(inst('NativeImage', 'isEmpty').map(daLinha), [linhaDe(MAIN, 'png')]);
  assert.deepEqual(inst('NativeImage', 'toPNG').map(daLinha), [linhaDe(MAIN, 'png')]);
});

test('inventário (fixture): evento assinado fica registrado', () => {
  assert.deepEqual(acha('app', 'on', MAIN).map((i) => i.evento), ['before-quit', 'child-process-gone']);
  assert.deepEqual(acha('app', 'on', MAIN).map(daLinha), [linhaDe(MAIN, 'evento-quit'), linhaDe(MAIN, 'evento-child')]);
});

test('inventário (fixture): nativeTheme.themeSource = ... é escrita; ler shouldUseDarkColors não é', () => {
  const escrita = acha('nativeTheme', 'themeSource', MAIN);
  assert.deepEqual(escrita.map(daLinha), [linhaDe(MAIN, 'tema-escrita')]);
  assert.equal(escrita[0].escrita, true);
  const leitura = acha('nativeTheme', 'shouldUseDarkColors', MAIN);
  assert.deepEqual(leitura.map(daLinha), [linhaDe(MAIN, 'tema-leitura')]);
  assert.ok(!leitura[0].escrita);
  assert.equal(acha('nativeTheme', 'themeSource', INJETADO)[0].escrita, true);
});

test('inventário (fixture): opções do new BrowserWindow incluem webPreferences e as espalhadas', () => {
  assert.equal(amostra.opcoesBrowserWindow.length, 1);
  const o = amostra.opcoesBrowserWindow[0];
  assert.equal(o.arquivo, MAIN);
  assert.equal(o.linha, linhasDe(AMOSTRA, MAIN).findIndex((l) => l.includes('new BrowserWindow(')) + 1);
  for (const k of ['title', 'width', 'height', 'webPreferences']) assert.ok(o.chaves.includes(k), k);
  assert.deepEqual(o.webPreferences, ['preload', 'contextIsolation', 'nodeIntegration', 'sandbox']);
  assert.equal(o.valoresWebPreferences.contextIsolation, 'true');
  assert.equal(o.valoresWebPreferences.nodeIntegration, 'false');
  assert.equal(o.valoresWebPreferences.sandbox, 'true');
  // ...ajudante.opcoesDaJanela(): as chaves vêm da função, que mora em outro arquivo
  const daFuncao = o.espalhadas.find((e) => e.chaves.includes('titleBarOverlay'));
  assert.ok(daFuncao, 'opções espalhadas por uma função não foram resolvidas');
  assert.deepEqual(daFuncao.chaves, ['titleBarStyle', 'titleBarOverlay', 'backgroundMaterial']);
  assert.match(daFuncao.origem, /^src\/janela-opcoes\.js:\d+ \(opcoesDaJanela\)$/);
  // ...(app.isPackaged ? { show: false } : {}): as chaves vêm do objeto escrito ali mesmo
  assert.ok(o.espalhadas.some((e) => e.chaves.includes('show')));
});

test('inventário (fixture): catch vazio e silencioso em volta de API do Electron é achado', () => {
  const catches = amostra.catchVazios.filter((c) => c.arquivo === MAIN);
  const em = (marca) => catches.find((c) => c.linha === linhaDe(MAIN, marca));

  const buffer = em('catch-buffer');
  assert.ok(buffer, 'catch {} em volta de clipboard.readBuffer não apareceu');
  assert.equal(buffer.classe, 'vazio');
  assert.equal(buffer.forma, 'catch {…}');
  assert.ok(buffer.apis.includes('clipboard.readBuffer'));
  // vale o bloco try inteiro: a API fica a mais de 3 linhas do catch (a regra das 3 linhas a perderia)
  assert.ok(buffer.linha - Math.min(...buffer.linhasApis) > 3, 'a API deveria estar a mais de 3 linhas do catch');

  const imagem = em('catch-imagem');
  assert.ok(imagem && imagem.classe === 'vazio' && imagem.forma === 'catch (e) {…}');
  assert.ok(imagem.apis.includes('clipboard.readImage'));

  const reload = em('catch-reload');
  assert.ok(reload && reload.classe === 'vazio' && reload.forma === 'catch (_) {…}');
  assert.ok(reload.apis.includes('WebContents#reload'));

  const comentario = em('catch-comentario');
  assert.ok(comentario && comentario.classe === 'vazio' && comentario.soComentario === true, 'catch só com comentário continua sendo vazio');
  assert.ok(comentario.apis.includes('dialog.showErrorBox'));

  const copiar = em('copiar');
  assert.ok(copiar && copiar.classe === 'silencioso', 'catch que só devolve um valor padrão é silencioso');
  assert.equal(copiar.corpo, 'return false;');
  assert.ok(copiar.apis.includes('clipboard.writeText'));
});

test('inventário (fixture): catch que registra, que repassa o erro ou sem API dentro NÃO é achado', () => {
  const linhas = new Set(amostra.catchVazios.filter((c) => c.arquivo === MAIN).map(daLinha));
  for (const marca of ['catch-loga', 'catch-repassa', 'catch-sem-api']) {
    assert.ok(!linhas.has(linhaDe(MAIN, marca)), '@' + marca + ' não devia ser achado');
  }
  // contagem exata: nada além do esperado entra (as 5 de try/catch + as 2 de .catch())
  const esperadas = ['catch-buffer', 'catch-imagem', 'copiar', 'catch-reload', 'catch-comentario', 'promessa-vazia', 'promessa-null']
    .map((m) => linhaDe(MAIN, m)).sort((a, b) => a - b);
  assert.deepEqual([...linhas].sort((a, b) => a - b), esperadas);
  assert.deepEqual(amostra.catchVazios.filter((c) => c.arquivo !== MAIN), []);
});

test('inventário (fixture): .catch(() => {}) e .catch(() => null) só valem perto de uma API (3 linhas)', () => {
  const em = (marca) => amostra.catchVazios.find((c) => c.arquivo === MAIN && c.linha === linhaDe(MAIN, marca));
  const vazia = em('promessa-vazia');
  assert.ok(vazia && vazia.forma === '.catch(() => {})' && vazia.apis.includes('dialog.showOpenDialog'));
  const nula = em('promessa-null');
  assert.ok(nula && nula.forma === '.catch(() => null)' && nula.apis.includes('clipboard.read'));
  assert.equal(em('promessa-longe'), undefined, 'o .catch(() => {}) longe de API não devia entrar');
});

/* ================= comparar.cjs ================= */

const membro = (modulo, nome, existe, tipo, length = null, instancia = false) =>
  ({ modulo, membro: nome, instancia, verificavel: true, existe, typeof: tipo, length });
const chamada = (modulo, nome, extra) => ({ id: modulo + '.' + nome + '()', modulo, membro: nome, instancia: false, ...extra });

test('comparador: acusa o que sumiu, o typeof que mudou e o retorno que virou Promise', () => {
  const antigo = { electron: '1.0.0', membros: [membro('clipboard', 'readImage', true, 'function', 0),
    membro('app', 'isPackaged', true, 'boolean'), membro('clipboard', 'readText', true, 'function', 0)],
  chamadas: [chamada('clipboard', 'readText', { ok: true, promise: false, tipo: 'string' }),
    chamada('clipboard', 'readImage', { ok: true, promise: false, tipo: 'NativeImage' })] };
  const novo = { electron: '2.0.0', membros: [membro('clipboard', 'readImage', false, 'undefined'),
    membro('app', 'isPackaged', true, 'function', 0), membro('clipboard', 'readText', true, 'function', 0)],
  chamadas: [chamada('clipboard', 'readText', { ok: true, promise: true, tipo: 'string' }),
    chamada('clipboard', 'readImage', { ok: false, erro: 'TypeError: clipboard.readImage is not a function' })] };
  const d = comparar(antigo, novo);
  assert.deepEqual(d.sumiu.map((x) => x.api), ['clipboard.readImage']);
  assert.deepEqual(d.mudouTypeof.map((x) => x.api), ['app.isPackaged']);
  assert.deepEqual(d.virouPromise.map((x) => x.api), ['clipboard.readText']);
  assert.deepEqual(d.passouAFalhar.map((x) => x.api), ['clipboard.readImage']);
  assert.equal(d.conferencia.ok, true);
  assert.deepEqual(d.sumiu[0].usos, [], 'sem inventário, não há arquivo:linha');

  // com o inventário da fixture, cada achado traz o arquivo:linha de quem usa a API
  const comUsos = comparar(antigo, novo, amostra);
  assert.deepEqual(comUsos.sumiu[0].usos, [MAIN + ':' + linhaDe(MAIN, 'imagem')]);
  assert.deepEqual(comUsos.virouPromise[0].usos, [MAIN + ':' + linhaDe(MAIN, 'texto-await'), MAIN + ':' + linhaDe(MAIN, 'texto-sem-await')]);
});

test('comparador: sem readImage sumido ou sem readText virando Promise, a conferência obrigatória reprova', () => {
  const base = { electron: '1.0.0', membros: [membro('clipboard', 'readImage', true, 'function', 0), membro('clipboard', 'readText', true, 'function', 0)],
    chamadas: [chamada('clipboard', 'readText', { ok: true, promise: false, tipo: 'string' })] };
  const igual = comparar(base, { ...base, electron: '2.0.0' });
  assert.equal(igual.conferencia.ok, false);
  assert.equal(igual.conferencia.readImageSumiu, false);
  assert.equal(igual.conferencia.readTextVirouPromise, false);
});

test('comparador: conferência obrigatória nas sondas reais 32.3.3 x 44.5.1 (inventário congelado)', () => {
  const antigo = lerJson(path.join(FERRAMENTAS, 'resultado-32.3.3.json'));
  const novo = lerJson(path.join(FERRAMENTAS, 'resultado-44.5.1.json'));
  assert.equal(antigo.electron, '32.3.3');
  assert.equal(novo.electron, '44.5.1');
  const d = comparar(antigo, novo, congelado);
  assert.ok(d.sumiu.some((x) => x.api === 'clipboard.readImage'), 'readImage tinha que aparecer como sumido');
  assert.ok(d.virouPromise.some((x) => x.api === 'clipboard.readText'), 'readText tinha que virar Promise');
  assert.equal(d.conferencia.ok, true);
  for (const x of d.sumiu) assert.ok(x.usos.length > 0, x.api + ' sem arquivo:linha');
});

/* ================= arquivos congelados e src/ real (só o que vale para qualquer código) ================= */

test('congelado: o inventario.json segue o contrato do brief, sem vendor, e guarda o que a auditoria achou', () => {
  assert.ok(congelado.itens.length > 0);
  assert.equal(congelado.totalItens, congelado.itens.length);
  for (const i of congelado.itens) conferirFormato(i);
  assert.deepEqual(congelado.itens.filter((i) => ehVendor(i.arquivo)), []);
  assert.ok(!congelado.arquivosLidos.some(ehVendor));
  // o retrato do src/ de 01/10: os usos que a sonda provou quebrados estão lá, com arquivo:linha
  for (const m of ['readImage', 'readText', 'readBuffer']) {
    const achados = congelado.itens.filter((i) => i.modulo === 'clipboard' && i.membro === m && i.arquivo === MAIN);
    assert.ok(achados.length >= 1, 'clipboard.' + m + ' sumiu do inventario.json congelado');
    for (const i of achados) assert.ok(i.trecho.includes('clipboard.' + m), 'trecho de ' + i.linha + ' não mostra clipboard.' + m);
  }
});

test('src/ real: o inventário roda no código vivo e respeita o formato, a linha real e a exclusão de vendor', () => {
  const real = inventariar({ raiz: RAIZ });
  assert.ok(real.totalItens > 0 && real.arquivosLidos.length > 0);
  assert.equal(real.totalItens, real.itens.length);
  assert.ok(real.arquivosLidos.includes(MAIN), 'o inventário não leu o src/main.js');
  assert.ok(!real.arquivosLidos.some(ehVendor), 'src/renderer/vendor/ não podia ser lido');
  assert.ok(!real.arquivosLidos.some((a) => a.includes('node_modules')));
  for (const i of real.itens) { conferirFormato(i); conferirLinhaReal(RAIZ, i); }
  assert.deepEqual(real.itens.filter((i) => ehVendor(i.arquivo)), []);
  for (const c of real.catchVazios) assert.ok(Number.isInteger(c.linha) && c.linha > 0 && c.apis.length > 0, JSON.stringify(c));
});
