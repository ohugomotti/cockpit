'use strict';
/* Leva 2, Task 7 (UI 7.2-10): o desenho .excalidraw que o agente fez abria no Quadro como COPIA e a edicao nunca voltava
   para o arquivo. Agora, quando o Quadro foi aberto de um .excalidraw do disco, aparecem "Salvar" (grava no ORIGINAL depois de
   um "Substituir <nome>?") e "Salvar como" (destino pelo dialogo nativo do Windows).

   Quem decide ONDE gravar e' o main, nunca a tela: so' .excalidraw, nunca caminho de rede (a trava vem ANTES de qualquer fs),
   o "Salvar" so' vale para um arquivo que o proprio main leu para o quadro (arquivo:lerTexto) e o "Salvar como" so' grava no
   caminho que o Hugo escolheu no dialogo. A pergunta "Substituir?" tambem e' do main: a tela nao tem como pula-la.

   O main nao carrega em teste (precisa do Electron). Aqui roda o codigo REAL, recortado do main.js, com o dialog de mentira:
   nenhum dialogo abre e nada e' gravado fora de pastas temporarias. A tela (app.js) tambem roda o codigo real, num vm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { RAIZ, lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const HTML = lerFonte('renderer', 'index.html');
const PRELOAD = lerFonte('preload.js');
const MOCK = fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'mock-api.js'), 'utf8').replace(/\r\n/g, '\n');

const MENSAGEM_REDE = 'Caminho de rede bloqueado por segurança.';
const REDE = [
  '\\\\servidor\\pasta\\a.excalidraw', '//servidor/pasta/a.excalidraw', '/\\servidor/pasta/a.excalidraw', '\\/servidor/pasta/a.excalidraw',
  '  \\\\servidor\\pasta\\a.excalidraw', '\\\\?\\UNC\\servidor\\pasta\\a.excalidraw',
];
// o que o Excalidraw serializa (q.cena()): um texto JSON
const CENA = JSON.stringify({ type: 'excalidraw', version: 2, source: 'teste', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], appState: {}, files: {} });
const simples = (v) => JSON.parse(JSON.stringify(v));   // o objeto nasce dentro do vm (outro Object.prototype)

// pastas temporarias dos testes: saem todas no fim
const temporarias = [];
const pastaTemporaria = (prefixo) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); temporarias.push(d); return d; };
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });
const escrever = (pasta, nome, conteudo) => { const f = path.join(pasta, nome); fs.writeFileSync(f, conteudo); return f; };

/* ============================================================================================================
   O MAIN: o codigo REAL (arquivo:lerTexto, o registro do que o quadro abriu e os dois canais novos)
   ============================================================================================================ */
// "const nome = ...;" em uma linha so'
function linhaConst(nome) {
  const ini = MAIN.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'não achei const ' + nome + ' no main.js');
  return MAIN.slice(ini, MAIN.indexOf('\n', ini));
}
function trechoDoCanal(canal) {
  const ini = MAIN.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, "não achei ipcMain.handle('" + canal + "' no main.js");
  return MAIN.slice(ini, MAIN.indexOf('\n});', ini) + 4);
}
// do registro dos .excalidraw que o quadro abriu ate' o fim do ultimo canal novo
function trechoDoQuadro() {
  const ini = MAIN.indexOf('const quadrosLidos = ');
  assert.ok(ini >= 0, 'não achei const quadrosLidos no main.js (o registro dos .excalidraw que o quadro abriu)');
  const canal = MAIN.indexOf("ipcMain.handle('quadro:salvarComo'", ini);
  assert.ok(canal > ini, "não achei ipcMain.handle('quadro:salvarComo' depois do registro");
  return MAIN.slice(ini, MAIN.indexOf('\n});', canal) + 4);
}

// disco que lanca em qualquer toque (cada toque fica anotado): num caminho de rede nao pode haver nenhum
function discoVigiado() {
  const toques = [];
  const vigiado = new Proxy({}, {
    get: (_, nome) => (...args) => { toques.push('fs.' + String(nome)); throw new Error('encostou no disco: fs.' + String(nome)); },
  });
  return { toques, vigiado };
}

/* Um "main.js em miniatura": so' o que o trecho toca. Documentos, pasta pessoal, dialogos e log sao de mentira.
   opcoes.confirmar: o que o "Substituir <nome>?" responde (0 = Substituir, 1 = Cancelar); opcoes.escolher: o que o dialogo de
   salvar devolve (padrao: o Hugo cancela); opcoes.disco: no lugar do fs real. */
function montarMain(opcoes = {}) {
  const { disco = fs, confirmar = () => 0, escolher = () => ({ canceled: true }) } = opcoes;
  const documentos = pastaTemporaria('cockpit-documentos-');
  const registros = [], dialogos = [], handlers = {};
  const ctx = {
    path, Buffer, fs: disco, EH_WIN: process.platform === 'win32', HOME: pastaTemporaria('cockpit-home-'),
    app: {
      getPath: (nome) => {
        if (nome !== 'documents') throw new Error('pediu a pasta errada: ' + nome);
        return documentos;
      },
    },
    logMain: (contexto, erro) => { registros.push([contexto, erro && erro.message]); },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    win: { janela: 'de mentira' },
    dialog: {
      showMessageBox: async (_janela, o) => { dialogos.push(['confirmar', simples(o)]); return { response: await confirmar(o) }; },
      showSaveDialog: async (_janela, o) => { dialogos.push(['salvar-como', simples(o)]); return escolher(o); },
    },
  };
  vm.createContext(ctx);
  for (const nome of ['MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede']) vm.runInContext(linhaConst(nome), ctx);
  vm.runInContext(pegarBloco(MAIN, 'function opcoesSalvarComo(', 'opcoesSalvarComo'), ctx);
  vm.runInContext(trechoDoCanal('arquivo:lerTexto'), ctx);
  vm.runInContext(trechoDoQuadro(), ctx);
  return { handlers, registros, dialogos, documentos, chamar: async (canal, pedido) => simples(await handlers[canal]({}, pedido)) };
}

test('Salvar: depois de "Substituir" o desenho vai para o arquivo original, e só para ele', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', '{"antigo":true}');
  const vizinho = escrever(pasta, 'outro.excalidraw', '{"vizinho":true}');
  let naPergunta = null;
  const m = montarMain({ confirmar: () => { naPergunta = fs.readFileSync(original, 'utf8'); return 0; } });
  assert.equal((await m.chamar('arquivo:lerTexto', { arquivo: original })).content, '{"antigo":true}');

  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });

  assert.deepEqual(r, { ok: true, arquivo: original });
  assert.equal(naPergunta, '{"antigo":true}', 'o arquivo já tinha sido trocado quando o "Substituir?" apareceu: a pergunta vem ANTES de gravar');
  assert.equal(fs.readFileSync(original, 'utf8'), CENA);
  assert.equal(fs.readFileSync(vizinho, 'utf8'), '{"vizinho":true}', 'o arquivo ao lado não pode mudar');
  assert.deepEqual(fs.readdirSync(pasta).sort(), ['fluxo.excalidraw', 'outro.excalidraw'], 'sobrou arquivo temporário ou cópia ao lado do original');
  assert.equal(m.dialogos.length, 1);
  const [tipo, o] = m.dialogos[0];
  assert.equal(tipo, 'confirmar');
  assert.equal(o.message, 'Substituir fluxo.excalidraw?');
  assert.deepEqual(o.buttons, ['Substituir', 'Cancelar']);
  assert.equal(o.defaultId, 1, 'um Enter sem querer não pode substituir: o botão padrão é o Cancelar');
  assert.equal(o.cancelId, 1, 'Esc cancela');
  assert.ok(String(o.detail).includes(original), 'a pergunta diz qual arquivo vai ser trocado (o caminho inteiro)');
});

test('Salvar: "Cancelar" (ou Esc, ou qualquer resposta que não seja "Substituir") não grava nada', async () => {
  for (const resposta of [1, -1, undefined, null]) {
    const pasta = pastaTemporaria('cockpit-quadro-');
    const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
    const m = montarMain({ confirmar: () => resposta });
    await m.chamar('arquivo:lerTexto', { arquivo: original });
    const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
    assert.deepEqual(r, { cancelado: true }, 'resposta ' + String(resposta));
    assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL', 'gravou mesmo cancelado (resposta ' + String(resposta) + ')');
    assert.equal(m.dialogos.length, 1);
    assert.deepEqual(m.registros, [], 'cancelar não é erro');
  }
});

test('Salvar: só grava no arquivo que o quadro abriu (um .excalidraw que o main não leu é recusado, sem diálogo)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const aberto = escrever(pasta, 'a.excalidraw', 'A');
  const outro = escrever(pasta, 'b.excalidraw', 'B');
  const m = montarMain({ confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: aberto });

  const r = await m.chamar('quadro:salvar', { arquivo: outro, texto: CENA });

  assert.match(r.error, /arquivo que o quadro abriu/);
  assert.equal(fs.readFileSync(outro, 'utf8'), 'B', 'gravou num arquivo que o quadro não abriu');
  assert.equal(m.dialogos.length, 0, 'nem pergunta: não há o que substituir');
  // o que o quadro abriu continua valendo
  assert.equal((await m.chamar('quadro:salvar', { arquivo: aberto, texto: CENA })).ok, true);
  assert.equal(fs.readFileSync(aberto, 'utf8'), CENA);
});

test('Salvar: no Windows maiúscula e minúscula são o mesmo arquivo (o registro não derruba o Salvar por isso)', { skip: process.platform !== 'win32' }, async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain({ confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original.replace('fluxo', 'FLUXO'), texto: CENA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(original, 'utf8'), CENA);
});

test('Salvar: só grava em .excalidraw (json, txt, md, .excalidraw.md e caminho relativo continuam recusados, mesmo lidos pelo main)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const m = montarMain({ confirmar: () => 0 });
  for (const nome of ['notas.json', 'a.txt', 'a.md', 'a.excalidraw.md', 'a.excalidraw.bak']) {
    const f = escrever(pasta, nome, 'ORIGINAL');
    await m.chamar('arquivo:lerTexto', { arquivo: f });   // json, txt e md o canal de leitura aceita; o Salvar não pode ir atrás
    const r = await m.chamar('quadro:salvar', { arquivo: f, texto: CENA });
    assert.match(String(r.error), /\.excalidraw/, nome);
    assert.equal(fs.readFileSync(f, 'utf8'), 'ORIGINAL', nome + ' foi gravado');
  }
  const relativo = await m.chamar('quadro:salvar', { arquivo: 'a.excalidraw', texto: CENA });
  assert.match(String(relativo.error), /\.excalidraw/, 'caminho relativo');
  for (const vazio of [undefined, null, '', 42]) {
    const r = await m.chamar('quadro:salvar', { arquivo: vazio, texto: CENA });
    assert.ok(r.error, 'arquivo ' + String(vazio));
  }
  assert.equal(m.dialogos.length, 0, 'nenhuma dessas chegou a perguntar');
});

test('Salvar: no Windows o fluxo alternativo do NTFS (a.txt:b.excalidraw) não vale como .excalidraw', { skip: process.platform !== 'win32' }, async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const m = montarMain({ confirmar: () => 0 });
  const r = await m.chamar('quadro:salvar', { arquivo: path.join(pasta, 'a.txt:b.excalidraw'), texto: CENA });
  assert.match(String(r.error), /\.excalidraw/);
  assert.deepEqual(fs.readdirSync(pasta), [], 'criou alguma coisa');
  assert.equal(m.dialogos.length, 0);
});

test('Salvar e Salvar como: caminho de rede é recusado antes de encostar no disco (as seis grafias de \\\\servidor)', async () => {
  for (const rede of REDE) {
    const { toques, vigiado } = discoVigiado();
    const m = montarMain({ disco: vigiado, confirmar: () => 0, escolher: () => ({ canceled: false, filePath: rede }) });
    // Salvar: nem pergunta
    assert.equal((await m.chamar('quadro:salvar', { arquivo: rede, texto: CENA })).error, MENSAGEM_REDE, rede);
    assert.equal(m.dialogos.length, 0, 'perguntou "Substituir?" para um caminho de rede: ' + rede);
    // Salvar como: o Hugo até pode escolher uma pasta de rede no diálogo, mas o main recusa antes de gravar
    assert.equal((await m.chamar('quadro:salvarComo', { arquivo: rede, texto: CENA })).error, MENSAGEM_REDE, rede);
    assert.deepEqual(m.dialogos.map((d) => d[0]), ['salvar-como']);
    assert.equal(path.dirname(m.dialogos[0][1].defaultPath), m.documentos, 'a dica de pasta de rede não pode virar a pasta do diálogo: ' + rede);
    assert.deepEqual(toques, [], 'encostou no disco com ' + rede + ': ' + toques.join(', '));
  }
});

test('arquivo:lerTexto recusa caminho de rede antes de encostar no disco (a leitura que alimenta o Salvar)', async () => {
  for (const rede of REDE) {
    const { toques, vigiado } = discoVigiado();
    const m = montarMain({ disco: vigiado });
    const r = await m.chamar('arquivo:lerTexto', { arquivo: rede });
    assert.equal(r.error, MENSAGEM_REDE, rede);
    assert.equal(r.content, undefined, 'não pode devolver conteúdo');
    assert.deepEqual(toques, [], 'encostou no disco com ' + rede + ': ' + toques.join(', '));
  }
});

test('Salvar: original que sumiu depois de aberto não é recriado em silêncio (manda usar o Salvar como)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain({ confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  fs.rmSync(original);
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.match(String(r.error), /Salvar como/);
  assert.equal(fs.existsSync(original), false, 'recriou o arquivo que o Hugo tinha apagado');
  assert.equal(m.dialogos.length, 0);
});

test('Salvar e Salvar como: desenho vazio, que não é texto ou acima de 20 MB é recusado ANTES de qualquer diálogo', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain({ confirmar: () => 0, escolher: () => ({ canceled: false, filePath: path.join(pasta, 'copia.excalidraw') }) });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  for (const texto of ['', undefined, null, 42, { elements: [] }, 'x'.repeat(20 * 1024 * 1024 + 1)]) {
    for (const canal of ['quadro:salvar', 'quadro:salvarComo']) {
      const r = await m.chamar(canal, { arquivo: original, texto });
      assert.ok(r.error, canal + ' aceitou ' + (typeof texto === 'string' ? 'texto de ' + texto.length + ' letras' : String(texto)));
    }
  }
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw'], 'criou a cópia mesmo com o desenho inválido');
  assert.equal(m.dialogos.length, 0, 'abriu diálogo para um desenho que nem seria gravado');
});

/* Fix round 1 (item 1): o main só grava uma CENA do Excalidraw. Antes só olhava "é texto, não vazio, até 20 MB" (e contava
   letras, não bytes): um texto qualquer virava o .excalidraw do agente. */
test('Salvar e Salvar como: só grava cena do Excalidraw (JSON inválido, outro tipo de JSON ou sem a lista elements é recusado, sem diálogo e sem gravar)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain({ confirmar: () => 0, escolher: () => ({ canceled: false, filePath: path.join(pasta, 'copia.excalidraw') }) });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const invalidos = {
    'texto que não é JSON': 'isto não é um desenho',
    'JSON cortado no meio': CENA.slice(0, CENA.length - 10),
    'null': 'null',
    'lista': '[]',
    'número': '42',
    'texto entre aspas': '"excalidraw"',
    'objeto qualquer': '{"antigo":true}',
    'arquivo de outro tipo (biblioteca)': JSON.stringify({ type: 'excalidrawlib', version: 2, library: [] }),
    'sem type': JSON.stringify({ elements: [] }),
    'sem elements': JSON.stringify({ type: 'excalidraw', version: 2 }),
    'elements que não é lista': JSON.stringify({ type: 'excalidraw', elements: {} }),
  };
  for (const [nome, texto] of Object.entries(invalidos)) {
    for (const canal of ['quadro:salvar', 'quadro:salvarComo']) {
      const r = await m.chamar(canal, { arquivo: original, texto });
      assert.match(String(r.error), /Excalidraw/, canal + ' aceitou: ' + nome);
    }
  }
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL', 'gravou um desenho inválido por cima do original');
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw'], 'gravou (ou deixou temporário) com um desenho inválido');
  assert.equal(m.dialogos.length, 0, 'abriu diálogo para um desenho que nem seria gravado');
  // a cena de verdade continua passando nos dois canais
  assert.equal((await m.chamar('quadro:salvar', { arquivo: original, texto: CENA })).ok, true);
  assert.equal((await m.chamar('quadro:salvarComo', { arquivo: original, texto: CENA })).ok, true);
  assert.equal(fs.readFileSync(original, 'utf8'), CENA);
  assert.equal(fs.readFileSync(path.join(pasta, 'copia.excalidraw'), 'utf8'), CENA);
});

test('Salvar e Salvar como: o teto de 20 MB conta BYTES, não letras (acento ocupa 2 posições no arquivo e 1 no texto)', async () => {
  const LIMITE = 20 * 1024 * 1024;
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain({ confirmar: () => 0, escolher: () => ({ canceled: false, filePath: path.join(pasta, 'copia.excalidraw') }) });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const cenaCom = (miolo) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [], files: { a: miolo } });
  // ~21 MB em bytes e só ~10,5 milhões de letras: o teto antigo (texto.length) deixava passar
  const grande = cenaCom('ã'.repeat(LIMITE / 2 + 1));
  assert.ok(grande.length < LIMITE && Buffer.byteLength(grande, 'utf8') > LIMITE, 'a cena do teste precisa passar do teto em bytes sem passar em letras');
  for (const canal of ['quadro:salvar', 'quadro:salvarComo']) {
    const r = await m.chamar(canal, { arquivo: original, texto: grande });
    assert.match(String(r.error), /20 MB/, canal + ' aceitou um desenho de mais de 20 MB em bytes');
  }
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw']);
  assert.equal(m.dialogos.length, 0, 'abriu diálogo para um desenho grande demais');
  // exatamente 20 MB em bytes ainda passa: o teto é "acima de"
  const noLimite = cenaCom('a'.repeat(LIMITE - Buffer.byteLength(cenaCom(''), 'utf8')));
  assert.equal(Buffer.byteLength(noLimite, 'utf8'), LIMITE);
  assert.equal((await m.chamar('quadro:salvar', { arquivo: original, texto: noLimite })).ok, true);
  assert.equal(fs.statSync(original).size, LIMITE);
});

test('Salvar: falha ao gravar volta como { error } com o motivo e vai para o log; o que foi lido continua no disco', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const falha = Object.assign(new Error("EPERM: operation not permitted, open '" + original + "'"), { code: 'EPERM' });
  const m = montarMain({ disco: { ...fs, writeFileSync: () => { throw falha; } }, confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.match(String(r.error), /EPERM/);
  assert.deepEqual(m.registros, [['quadro:salvar', falha.message]]);
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
});

/* Fix round 1 (item 2): a gravação era writeFileSync NO LUGAR (trunca o original e depois escreve): uma queda ou falta de espaço no
   meio deixava o .excalidraw do agente pela metade. Agora vai para um temporário na MESMA pasta e só no fim troca (renameSync). */
// disco que enche NO MEIO da escrita: grava só a primeira metade do texto no arquivo que recebeu e lança ENOSPC
function discoQueEnche() {
  const escritas = [];
  const enche = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  const disco = {
    ...fs,
    writeFileSync: (arquivo, dados, ...resto) => {
      escritas.push(arquivo);
      fs.writeFileSync(arquivo, String(dados).slice(0, Math.floor(String(dados).length / 2)), ...resto);
      throw enche;
    },
  };
  return { disco, enche, escritas };
}

test('Salvar: se o disco enche NO MEIO da escrita o original continua intacto (grava num temporário e só no fim troca o arquivo)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', '{"antigo":true}');
  const { disco, enche, escritas } = discoQueEnche();
  const m = montarMain({ disco, confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.match(String(r.error), /ENOSPC/, 'o Hugo tem que ver o motivo');
  assert.equal(fs.readFileSync(original, 'utf8'), '{"antigo":true}', 'o original ficou pela metade: a escrita foi direto nele');
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw'], 'sobrou o temporário pela metade ao lado do original');
  assert.deepEqual(m.registros, [['quadro:salvar', enche.message]]);
  assert.equal(escritas.length, 1);
  assert.notEqual(escritas[0], original, 'escreveu direto no original');
});

test('Salvar: o temporário nasce na MESMA pasta do original e a troca é um renameSync (nunca escreve direto no original)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const chamadas = [];
  const disco = {
    ...fs,
    writeFileSync: (...a) => { chamadas.push(['escreveu', a[0]]); return fs.writeFileSync(...a); },
    renameSync: (...a) => { chamadas.push(['trocou', a[0], a[1]]); return fs.renameSync(...a); },
  };
  const m = montarMain({ disco, confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(chamadas[0] && chamadas[0][0], 'escreveu');
  const tmp = chamadas[0][1];
  assert.notEqual(tmp, original, 'escreveu direto no original');
  assert.equal(path.dirname(tmp), pasta, 'o temporário tem que ficar na mesma pasta (em outro disco a troca deixa de ser de uma vez)');
  assert.deepEqual(chamadas.slice(1), [['trocou', tmp, original]]);
  assert.equal(fs.readFileSync(original, 'utf8'), CENA);
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw'], 'sobrou o temporário depois da troca');
});

test('Salvar: se a troca final falha (arquivo preso por outro programa) o original continua intacto e o temporário é apagado', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const preso = Object.assign(new Error("EBUSY: resource busy or locked, rename '" + original + "'"), { code: 'EBUSY' });
  const m = montarMain({ disco: { ...fs, renameSync: () => { throw preso; } }, confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.match(String(r.error), /EBUSY/);
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw'], 'sobrou o temporário ao lado do original');
  assert.deepEqual(m.registros, [['quadro:salvar', preso.message]]);
});

test('Salvar como: escolher um arquivo que JÁ existe também é à prova de falha no meio (o escolhido fica intacto, sem temporário)', async () => {
  const destino = pastaTemporaria('cockpit-destino-');
  const escolhido = escrever(destino, 'copia.excalidraw', '{"escolhido":"antigo"}');
  const { disco, enche } = discoQueEnche();
  const m = montarMain({ disco, escolher: () => ({ canceled: false, filePath: escolhido }) });
  const r = await m.chamar('quadro:salvarComo', { arquivo: path.join(destino, 'fluxo.excalidraw'), texto: CENA });
  assert.match(String(r.error), /ENOSPC/);
  assert.equal(fs.readFileSync(escolhido, 'utf8'), '{"escolhido":"antigo"}', 'o arquivo escolhido ficou pela metade: a escrita foi direto nele');
  assert.deepEqual(fs.readdirSync(destino), ['copia.excalidraw'], 'sobrou o temporário ao lado do arquivo escolhido');
  assert.deepEqual(m.registros, [['quadro:salvar-como', enche.message]]);
});

test('se nem o temporário dá para apagar o motivo vai para o log, e quem chamou ainda recebe o erro da gravação (não o da limpeza)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const { disco, enche } = discoQueEnche();
  const presa = Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' });
  const m = montarMain({ disco: { ...disco, unlinkSync: () => { throw presa; } }, confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.match(String(r.error), /ENOSPC/);
  assert.deepEqual(m.registros, [['quadro:temporario', presa.message], ['quadro:salvar', enche.message]]);
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
});

/* Fix round 1 (item 3): as recusas voltavam { error } para a tela mas não deixavam rastro no log; só o erro inesperado (o catch) ia. */
test('Salvar: toda recusa vai para o log com a mesma mensagem que a tela recebe (rede, extensão, arquivo que o quadro não abriu, original que sumiu, desenho inválido); cancelar não é recusa', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const outro = escrever(pasta, 'outro.excalidraw', 'B');
  const texto = escrever(pasta, 'a.txt', 'T');
  const sumido = escrever(pasta, 'sumido.excalidraw', 'S');
  const m = montarMain({ confirmar: () => 1 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  await m.chamar('arquivo:lerTexto', { arquivo: sumido });
  fs.rmSync(sumido);
  const casos = {
    'caminho de rede': { arquivo: REDE[0], texto: CENA },
    'destino que não é .excalidraw': { arquivo: texto, texto: CENA },
    'arquivo que o quadro não abriu': { arquivo: outro, texto: CENA },
    'original que sumiu': { arquivo: sumido, texto: CENA },
    'desenho vazio': { arquivo: original, texto: '' },
    'desenho que não é do Excalidraw': { arquivo: original, texto: 'isto não é um desenho' },
  };
  for (const [nome, pedido] of Object.entries(casos)) {
    m.registros.length = 0;
    const r = await m.chamar('quadro:salvar', pedido);
    assert.ok(r.error, nome + ' não foi recusado');
    assert.deepEqual(m.registros, [['quadro:salvar', r.error]], nome + ': a recusa não foi para o log (ou foi com outra mensagem)');
  }
  // o "Cancelar" do Substituir? não é recusa nem erro: nada no log
  m.registros.length = 0;
  assert.deepEqual(await m.chamar('quadro:salvar', { arquivo: original, texto: CENA }), { cancelado: true });
  assert.deepEqual(m.registros, []);
});

test('Salvar como: toda recusa (desenho inválido, destino de rede, destino que não é .excalidraw) também vai para o log; cancelar o diálogo não', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  let destino = '';
  const m = montarMain({ escolher: () => ({ canceled: false, filePath: destino }) });
  const casos = [
    ['desenho vazio', '', path.join(pasta, 'copia.excalidraw')],
    ['desenho que não é do Excalidraw', 'isto não é um desenho', path.join(pasta, 'copia.excalidraw')],
    ['destino de rede', CENA, REDE[0]],
    ['destino que não é .excalidraw', CENA, path.join(pasta, 'copia.txt')],
  ];
  for (const [nome, texto, escolhido] of casos) {
    destino = escolhido;
    m.registros.length = 0;
    const r = await m.chamar('quadro:salvarComo', { arquivo: original, texto });
    assert.ok(r.error, nome + ' não foi recusado');
    assert.deepEqual(m.registros, [['quadro:salvar-como', r.error]], nome + ': a recusa não foi para o log (ou foi com outra mensagem)');
  }
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw']);
  const cancelou = montarMain();   // o padrão do montarMain é o Hugo cancelar o diálogo
  assert.deepEqual(await cancelou.chamar('quadro:salvarComo', { arquivo: original, texto: CENA }), { cancelado: true });
  assert.deepEqual(cancelou.registros, []);
});

/* Fix round 1 (item 4): se o agente reescreveu o .excalidraw enquanto o Hugo editava no quadro, o Salvar (depois do "Substituir?")
   apagava a versão nova sem ninguém dizer. O main guarda a data (mtimeMs) e o tamanho do arquivo no momento em que o lê para o
   quadro (arquivo:lerTexto) e a pergunta avisa se isso mudou. Só avisa: quem decide continua sendo o Hugo, na caixa nativa. */
const AVISO_MUDOU = 'O arquivo mudou depois que você abriu';

test('Salvar: se o arquivo mudou no disco depois que o quadro o abriu (o agente reescreveu), a pergunta "Substituir?" avisa; sem mudança não avisa', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', '{"antigo":true}');
  let resposta = 1;   // Cancelar: nas duas primeiras só interessa o que a pergunta diz
  const m = montarMain({ confirmar: () => resposta });
  await m.chamar('arquivo:lerTexto', { arquivo: original });

  // 1) nada mudou: a pergunta é a de sempre
  await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.ok(!String(m.dialogos[0][1].detail).includes(AVISO_MUDOU), 'avisou "mudou" sem o arquivo ter mudado: ' + m.dialogos[0][1].detail);

  // 2) o agente reescreveu: a pergunta avisa (e continua só uma pergunta: Cancelar não grava)
  const doAgente = '{"agente":"reescreveu o desenho","elements":[]}';
  fs.writeFileSync(original, doAgente);
  await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.ok(String(m.dialogos[1][1].detail).includes(AVISO_MUDOU), 'não avisou que o arquivo mudou: ' + m.dialogos[1][1].detail);
  assert.ok(String(m.dialogos[1][1].detail).includes(original), 'o aviso não pode apagar o caminho que a pergunta já dizia');
  assert.equal(m.dialogos[1][1].message, 'Substituir fluxo.excalidraw?');
  assert.equal(m.dialogos[1][1].defaultId, 1, 'com o aviso o Enter continua sendo o Cancelar');
  assert.equal(fs.readFileSync(original, 'utf8'), doAgente, 'cancelar gravou');

  // 3) o aviso não trava: se o Hugo disser "Substituir" mesmo assim, grava
  resposta = 0;
  const r = await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(String(m.dialogos[2][1].detail).includes(AVISO_MUDOU));
  assert.equal(fs.readFileSync(original, 'utf8'), CENA);

  // 4) abrir o arquivo de novo no quadro (ler de novo) renova o que o main sabe: o aviso é só para o que mudou DEPOIS da última leitura
  fs.writeFileSync(original, doAgente);
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  resposta = 1;
  await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
  assert.ok(!String(m.dialogos[3][1].detail).includes(AVISO_MUDOU), 'avisou "mudou" para um arquivo que o quadro acabou de reabrir: ' + m.dialogos[3][1].detail);
});

test('Salvar: tanto a mudança só da data (mtime) quanto a só do tamanho contam como "mudou" (o main guarda os dois)', async () => {
  const ANTES = new Date('2026-01-01T12:00:00.000Z');
  const casos = [
    ['só a data mudou (conteúdo e tamanho iguais)', (f) => fs.utimesSync(f, new Date('2026-01-01T12:05:00.000Z'), new Date('2026-01-01T12:05:00.000Z'))],
    ['só o tamanho mudou (a data voltou à de antes)', (f) => { fs.writeFileSync(f, 'ORIGINAL, MAIS LONGO'); fs.utimesSync(f, ANTES, ANTES); }],
  ];
  for (const [nome, mudar] of casos) {
    const pasta = pastaTemporaria('cockpit-quadro-');
    const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
    fs.utimesSync(original, ANTES, ANTES);   // uma data conhecida, inteira em milissegundos, antes de o quadro ler
    const m = montarMain({ confirmar: () => 1 });
    await m.chamar('arquivo:lerTexto', { arquivo: original });
    mudar(original);
    await m.chamar('quadro:salvar', { arquivo: original, texto: CENA });
    assert.ok(String(m.dialogos[0][1].detail).includes(AVISO_MUDOU), nome + ': não avisou');
  }
});

test('Salvar: depois de gravar, o main atualiza o que sabe do arquivo (o segundo Salvar não acusa "mudou" pela própria gravação)', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', '{"antigo":true}');
  const CENA2 = JSON.stringify({ type: 'excalidraw', version: 2, source: 'teste', elements: [{ id: 'b', type: 'ellipse', x: 5, y: 5, width: 20, height: 20 }, { id: 'c', type: 'arrow', x: 0, y: 0, width: 5, height: 5 }], appState: {}, files: {} });
  const m = montarMain({ confirmar: () => 0 });
  await m.chamar('arquivo:lerTexto', { arquivo: original });
  assert.equal((await m.chamar('quadro:salvar', { arquivo: original, texto: CENA })).ok, true);
  assert.equal((await m.chamar('quadro:salvar', { arquivo: original, texto: CENA2 })).ok, true);
  assert.ok(!String(m.dialogos[1][1].detail).includes(AVISO_MUDOU), 'o segundo Salvar acusou "mudou" por causa da própria gravação: ' + m.dialogos[1][1].detail);
  assert.equal(fs.readFileSync(original, 'utf8'), CENA2);
  // se alguém mexer DEPOIS da gravação, volta a avisar
  fs.writeFileSync(original, '{"agente":"de novo"}');
  assert.equal((await m.chamar('quadro:salvar', { arquivo: original, texto: CENA })).ok, true);
  assert.ok(String(m.dialogos[2][1].detail).includes(AVISO_MUDOU), 'não avisou que o agente mexeu depois da última gravação');
});

test('Salvar como: o diálogo abre na pasta do original, com o nome dele e só o filtro .excalidraw, e grava onde o Hugo escolher', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const destino = pastaTemporaria('cockpit-destino-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const escolhido = path.join(destino, 'copia.excalidraw');
  const m = montarMain({ escolher: () => ({ canceled: false, filePath: escolhido }) });

  // sem ler antes: o "Salvar como" não depende do arquivo que o quadro abriu, só do que o Hugo escolhe
  const r = await m.chamar('quadro:salvarComo', { arquivo: original, texto: CENA });

  assert.deepEqual(r, { ok: true, arquivo: escolhido });
  assert.equal(fs.readFileSync(escolhido, 'utf8'), CENA);
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL', 'o Salvar como não mexe no original');
  assert.deepEqual(m.dialogos.map((d) => d[0]), ['salvar-como'], 'o Salvar como não faz a pergunta do Salvar: o diálogo do Windows já avisa se o arquivo existe');
  const o = m.dialogos[0][1];
  assert.equal(o.defaultPath, path.join(pasta, 'fluxo.excalidraw'));
  assert.ok(path.isAbsolute(o.defaultPath), 'o defaultPath sai absoluto (Task 17 da leva 1)');
  assert.deepEqual(o.filters, [{ name: 'Desenho do Excalidraw', extensions: ['excalidraw'] }]);
});

test('Salvar como: cancelar o diálogo não grava nada e sem desenho de origem o diálogo abre em Documentos', async () => {
  const pasta = pastaTemporaria('cockpit-quadro-');
  const original = escrever(pasta, 'fluxo.excalidraw', 'ORIGINAL');
  const m = montarMain();
  assert.deepEqual(await m.chamar('quadro:salvarComo', { arquivo: original, texto: CENA }), { cancelado: true });
  assert.deepEqual(await m.chamar('quadro:salvarComo', { texto: CENA }), { cancelado: true });
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw']);
  assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
  assert.equal(m.dialogos[1][1].defaultPath, path.join(m.documentos, 'desenho.excalidraw'));
  // o diálogo devolveu "cancelado" mas com caminho (ou sem caminho nenhum): também não grava
  const m2 = montarMain({ escolher: () => ({ canceled: true, filePath: path.join(pasta, 'x.excalidraw') }) });
  assert.deepEqual(await m2.chamar('quadro:salvarComo', { arquivo: original, texto: CENA }), { cancelado: true });
  const m3 = montarMain({ escolher: () => ({ canceled: false }) });
  assert.deepEqual(await m3.chamar('quadro:salvarComo', { arquivo: original, texto: CENA }), { cancelado: true });
  assert.deepEqual(fs.readdirSync(pasta), ['fluxo.excalidraw']);
});

test('Salvar como: destino que não termina em .excalidraw (o Windows deixa digitar qualquer nome) é recusado sem gravar', async () => {
  const destino = pastaTemporaria('cockpit-destino-');
  for (const nome of ['copia.txt', 'copia.json', 'copia.excalidraw.md', 'copia']) {
    const m = montarMain({ escolher: () => ({ canceled: false, filePath: path.join(destino, nome) }) });
    const r = await m.chamar('quadro:salvarComo', { arquivo: 'C:\\x\\fluxo.excalidraw', texto: CENA });
    assert.match(String(r.error), /\.excalidraw/, nome);
  }
  assert.deepEqual(fs.readdirSync(destino), [], 'gravou num arquivo que não é .excalidraw');
});

test('Salvar como: falha ao gravar volta como { error } e vai para o log com o contexto do Salvar como', async () => {
  const destino = pastaTemporaria('cockpit-destino-');
  const falha = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  const m = montarMain({
    disco: { ...fs, writeFileSync: () => { throw falha; } },
    escolher: () => ({ canceled: false, filePath: path.join(destino, 'copia.excalidraw') }),
  });
  const r = await m.chamar('quadro:salvarComo', { arquivo: path.join(destino, 'fluxo.excalidraw'), texto: CENA });
  assert.match(String(r.error), /ENOSPC/);
  assert.deepEqual(m.registros, [['quadro:salvar-como', falha.message]]);
});

test('o main registra os dois canais pela fachada de segurança e o Salvar só abre diálogo do main (nada de confirm da tela)', () => {
  for (const canal of ['quadro:salvar', 'quadro:salvarComo']) trechoDoCanal(canal);
  assert.ok(/dialog\.showMessageBox\(win, \{/.test(trechoDoCanal('quadro:salvar')), 'a pergunta "Substituir?" é do main (dialog.showMessageBox)');
  assert.ok(/dialog\.showSaveDialog\(win, opcoesSalvarComo\(/.test(trechoDoCanal('quadro:salvarComo')), 'o Salvar como usa o opcoesSalvarComo da leva 1');
});

/* ============================================================================================================
   A PONTE (preload) e o simulador da previa (mock-api)
   ============================================================================================================ */
test('preload: quadroSalvar e quadroSalvarComo ficam ao lado do textoLer e levam só { arquivo, texto } para o canal certo', async () => {
  // assert.ok (e nao match): quando falha, o match despejaria o preload inteiro na tela
  assert.ok(/textoLer: \(o\) => ipcRenderer\.invoke\('arquivo:lerTexto', o\),\n(?:\s*\/\/[^\n]*\n)*\s+quadroSalvar: [^\n]+\n\s+quadroSalvarComo: [^\n]+\n/.test(PRELOAD),
    'falta, logo depois do textoLer, as linhas quadroSalvar e quadroSalvarComo');
  const bus = new EventEmitter(), chamadas = []; let api;
  bus.sendSync = () => ({}); bus.invoke = async (...args) => { chamadas.push(args); return { ok: true }; };
  vm.runInNewContext(PRELOAD, {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  assert.equal(typeof api.quadroSalvar, 'function', 'falta api.quadroSalvar');
  assert.equal(typeof api.quadroSalvarComo, 'function', 'falta api.quadroSalvarComo');
  // a tela manda o arquivo de origem e o texto; qualquer outro campo (um destino "livre", por exemplo) fica na tela
  await api.quadroSalvar({ arquivo: 'C:\\x\\a.excalidraw', texto: CENA, destino: 'C:\\Windows\\sistema.excalidraw' });
  await api.quadroSalvarComo({ arquivo: 'C:\\x\\a.excalidraw', texto: CENA, destino: 'C:\\Windows\\sistema.excalidraw' });
  assert.deepEqual(simples(chamadas), [
    ['quadro:salvar', { arquivo: 'C:\\x\\a.excalidraw', texto: CENA }],
    ['quadro:salvarComo', { arquivo: 'C:\\x\\a.excalidraw', texto: CENA }],
  ]);
});

function carregarMock() {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  return win;
}
test('mock-api.js: quadroSalvar e quadroSalvarComo estão declarados ao lado do parecido e devolvem { ok, arquivo }', async () => {
  assert.ok(/colarSalvarImagem:[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*quadroSalvar:[^\n]*\n\s*quadroSalvarComo:[^\n]*\n/.test(MOCK), 'falta, logo depois do colarSalvarImagem, as linhas quadroSalvar e quadroSalvarComo');
  const win = carregarMock();
  const salvou = await win.api.quadroSalvar({ arquivo: 'C:/QA/fluxo.excalidraw', texto: CENA });
  assert.equal(salvou.ok, true);
  assert.equal(typeof salvou.arquivo, 'string');
  const como = await win.api.quadroSalvarComo({ arquivo: 'C:/QA/fluxo.excalidraw', texto: CENA });
  assert.equal(como.ok, true);
  assert.equal(typeof como.arquivo, 'string');
  assert.ok(!win.__qa.missing.has('quadroSalvar') && !win.__qa.missing.has('quadroSalvarComo'), 'o simulador inventou o método: ' + [...win.__qa.missing].join(', '));
});

/* ============================================================================================================
   A TELA: os botoes, o quadro aberto de arquivo e o clique em "Salvar" / "Salvar como" (codigo REAL do app.js)
   ============================================================================================================ */
test('index.html: "Salvar" e "Salvar como" moram no topo do Quadro e nascem escondidos', () => {
  const topo = HTML.slice(HTML.indexOf('<div class="quadro-top">'), HTML.indexOf('<div id="quadroArea">'));
  assert.ok(topo.length > 100, 'não achei o topo do Quadro no index.html');
  for (const [id, rotulo] of [['quadroSalvar', 'Salvar'], ['quadroSalvarComo', 'Salvar como']]) {
    const botao = (topo.match(new RegExp('<button[^>]*\\bid="' + id + '"[^>]*>[^<]*</button>')) || [])[0];
    assert.ok(botao, 'falta o botão #' + id);
    assert.match(botao, /\bclass="[^"]*\bhidden\b/, '#' + id + ' tem que nascer escondido (só aparece quando o quadro abriu de um arquivo)');
    assert.equal(botao.replace(/<[^>]*>/g, '').trim(), rotulo);
  }
});

// elemento de mentira: so' o que o quadro toca (classes, texto, atributos e ouvintes de clique)
function noFalso() {
  const classes = new Set(), eventos = {}, attrs = {};
  const n = {
    classes, eventos, textContent: '', title: '',
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c),
      toggle: (c, on) => { const liga = on === undefined ? !classes.has(c) : !!on; if (liga) classes.add(c); else classes.delete(c); return liga; },
    },
    setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (nome, fn) => { (eventos[nome] = eventos[nome] || []).push(fn); },
    focus() {},
  };
  return n;
}
const esperar = () => new Promise((res) => setTimeout(res, 0));   // deixa as promessas do vm terminarem
const painelDeTeste = () => ({ id: 'p1', engine: 'claude', titulo: 'Conversa de teste', el: {} });
const ORIGEM = 'C:\\Projetos\\fluxo.excalidraw';

function fonteDoQuadro() {
  const pedacos = ['function mostrarSalvarDoQuadro(', 'async function abrirQuadro(', 'function fecharQuadro(', 'async function salvarQuadro('].map((assinatura) => {
    assert.ok(APP.includes(assinatura), 'o app.js precisa de ' + assinatura + ')');
    return pegarBloco(APP, assinatura, assinatura);
  });
  // a rotina que liga os botoes do Quadro (o IIFE logo depois do anexarQuadro)
  const meio = APP.indexOf("const liga = (id, fn) => { const b = document.getElementById(id);");
  assert.ok(meio > 0, 'não achei onde o app.js liga os botões do Quadro');
  pedacos.push(APP.slice(APP.lastIndexOf('(() => {', meio), APP.indexOf('})();', meio) + 5));
  return pedacos.join('\n');
}

/* O quadro de mentira: montar() devolve um objeto com a mesma forma do Quadro.montar do vendor (pronto, carregar, cena, vazio,
   destruir, limpar). opcoes.carregar troca o carregar (para segurar ou falhar a leitura da cena de arquivo). */
function montarQuadro(opcoes = {}) {
  const nos = new Map();
  const no = (sel) => { if (!nos.has(sel)) nos.set(sel, noFalso()); return nos.get(sel); };
  const avisos = [], notas = [], erros = [], quadros = [];
  const api = {
    textoLer: async () => ({ error: 'o quadro não devia ler arquivo aqui' }),
    textoSalvar: async () => ({ arquivo: 'C:\\dados\\quadros\\q.excalidraw' }),
    quadroSalvar: async (o) => ({ ok: true, arquivo: o.arquivo }),
    quadroSalvarComo: async () => ({ ok: true, arquivo: 'C:\\outra\\copia.excalidraw' }),
    ...(opcoes.api || {}),
  };
  const ctx = {
    ...globaisFalsos(),
    console: { error: (...a) => erros.push(a.map(String).join(' ')), warn() {}, log() {} },
    $: (sel) => no(sel), fecharMenus() {}, carregarQuadro: async () => true, confirm: () => true,
    cfg: { tema: 'escuro' }, nomeDoMotor: () => 'Claude', savePanes() {}, focarQuadro() {},
    note: (_P, texto, erro) => notas.push([texto, erro === true]),
    avisarNoQuadro: (texto, erro) => avisos.push([texto, erro === true]),
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    document: { getElementById: (id) => no('#' + id) },
    window: {
      api,
      Quadro: {
        montar: (_el, o) => {
          const q = {
            opcoes: o, pronto: Promise.resolve(), vazio: () => false, cena: () => CENA,
            carregar: opcoes.carregar || (async () => 1), destruir() {}, limpar() {},
          };
          quadros.push(q);
          return q;
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext('let quadro = null;\n' + fonteDoQuadro(), ctx);
  const botao = (id) => no('#' + id);
  return {
    ctx, no, botao, avisos, notas, erros, quadros, api,
    escondido: (id) => botao(id).classes.has('hidden'),
    atual: () => vm.runInContext('quadro', ctx),
    clicar: async (id) => { for (const fn of botao(id).eventos.click || []) fn({ stopPropagation() {} }); await esperar(); },
  };
}

test('quadro aberto de um .excalidraw do disco: depois de a cena carregar, "Salvar" e "Salvar como" aparecem', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  assert.equal(t.escondido('quadroSalvar'), false);
  assert.equal(t.escondido('quadroSalvarComo'), false);
  assert.equal(t.atual().origem, ORIGEM);
  assert.ok(String(t.botao('quadroSalvar').title).includes('fluxo.excalidraw'), 'o título do Salvar diz qual arquivo ele troca: ' + t.botao('quadroSalvar').title);
});

test('quadro aberto de outro jeito (sem arquivo no disco: pelo menu, ou por um bloco ```excalidraw da conversa) não tem "Salvar" nem "Salvar como"', async () => {
  const t = montarQuadro();
  // as duas formas de abrir que ja existiam: sem cena (quadro do painel) e com cena mas sem arquivo de origem (bloco da conversa)
  await t.ctx.abrirQuadro(painelDeTeste());
  assert.equal(t.escondido('quadroSalvar'), true);
  assert.equal(t.escondido('quadroSalvarComo'), true);
  assert.equal(t.atual().origem, null);
  await t.ctx.abrirQuadro(painelDeTeste(), CENA);
  assert.equal(t.escondido('quadroSalvar'), true);
  assert.equal(t.escondido('quadroSalvarComo'), true);
  assert.equal(t.atual().origem, null);
});

test('os botões não vazam de um quadro para o próximo: abriu de arquivo, fechou, abriu um quadro comum → escondidos de novo', async () => {
  const t = montarQuadro();
  const P = painelDeTeste();
  await t.ctx.abrirQuadro(P, CENA, ORIGEM);
  assert.equal(t.escondido('quadroSalvar'), false);
  t.ctx.fecharQuadro();
  assert.equal(t.atual(), null);
  await t.ctx.abrirQuadro(P);
  assert.equal(t.escondido('quadroSalvar'), true);
  assert.equal(t.escondido('quadroSalvarComo'), true);
  // abrir direto de outro arquivo (o quadro anterior ainda aberto) troca a origem
  await t.ctx.abrirQuadro(P, CENA, ORIGEM);
  await t.ctx.abrirQuadro(P, CENA, 'C:\\Projetos\\outro.excalidraw');
  assert.equal(t.atual().origem, 'C:\\Projetos\\outro.excalidraw');
});

test('enquanto a cena do arquivo ainda carrega, os botões ficam escondidos (salvar agora gravaria um quadro vazio por cima do arquivo)', async () => {
  let terminar;
  const t = montarQuadro({ carregar: () => new Promise((res) => { terminar = res; }) });
  const abrindo = t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  await esperar();
  assert.equal(t.escondido('quadroSalvar'), true, 'o Salvar apareceu antes de a cena entrar');
  assert.equal(t.escondido('quadroSalvarComo'), true);
  terminar(1);
  await abrindo;
  assert.equal(t.escondido('quadroSalvar'), false);
  assert.equal(t.escondido('quadroSalvarComo'), false);
});

test('se a cena do arquivo não carregar, o quadro avisa e os botões continuam escondidos', async () => {
  const t = montarQuadro({ carregar: async () => { throw new Error('cena quebrada'); } });
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  assert.equal(t.escondido('quadroSalvar'), true);
  assert.equal(t.escondido('quadroSalvarComo'), true);
  assert.ok(t.notas.some(([texto, erro]) => /cena quebrada/.test(texto) && erro), 'o aviso de leitura que já existia continua: ' + JSON.stringify(t.notas));
});

test('clicar em "Salvar" manda o desenho do quadro e o arquivo de origem; o main é quem pergunta, e o resultado aparece no topo do quadro', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  const pedidos = [];
  t.api.quadroSalvar = async (o) => { pedidos.push(o); return { ok: true, arquivo: ORIGEM }; };
  t.api.quadroSalvarComo = async () => { throw new Error('o Salvar não pode usar o Salvar como'); };
  await t.clicar('quadroSalvar');
  assert.deepEqual(simples(pedidos), [{ arquivo: ORIGEM, texto: CENA }]);
  assert.deepEqual(t.avisos, [['Desenho salvo em fluxo.excalidraw.', false]]);
  assert.deepEqual(t.erros, []);
});

test('clicar em "Salvar como" usa o canal do Salvar como e mostra o nome do arquivo que o Hugo escolheu', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  const pedidos = [];
  t.api.quadroSalvar = async () => { throw new Error('o Salvar como não pode usar o Salvar'); };
  t.api.quadroSalvarComo = async (o) => { pedidos.push(o); return { ok: true, arquivo: 'D:\\Meus desenhos\\copia final.excalidraw' }; };
  await t.clicar('quadroSalvarComo');
  assert.deepEqual(simples(pedidos), [{ arquivo: ORIGEM, texto: CENA }]);
  assert.deepEqual(t.avisos, [['Desenho salvo em copia final.excalidraw.', false]]);
});

test('"Cancelar" no diálogo não mostra aviso nenhum (cancelar não é erro)', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  t.api.quadroSalvar = async () => ({ cancelado: true });
  t.api.quadroSalvarComo = async () => ({ cancelado: true });
  await t.clicar('quadroSalvar');
  await t.clicar('quadroSalvarComo');
  assert.deepEqual(t.avisos, []);
  assert.deepEqual(t.notas, []);
  assert.deepEqual(t.erros, []);
});

test('erro de gravação (do main ou da ponte) aparece em vermelho para o Hugo; o da ponte também vai para o log da tela', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  // o main devolve { error }: ele mesmo já registrou no log
  t.api.quadroSalvar = async () => ({ error: "EPERM: operation not permitted, open 'C:\\Projetos\\fluxo.excalidraw'" });
  await t.clicar('quadroSalvar');
  assert.equal(t.avisos.length, 1);
  assert.equal(t.avisos[0][1], true, 'o erro tem que ir em vermelho');
  assert.match(t.avisos[0][0], /^Não consegui salvar o desenho: EPERM/);
  assert.deepEqual(t.erros, [], 'o main já registrou: a tela não registra de novo');
  // a ponte recusa (por exemplo, janela sem permissão): a tela mostra e registra
  t.api.quadroSalvarComo = async () => { throw new Error('Esta janela não pode acessar este recurso do Cockpit.'); };
  await t.clicar('quadroSalvarComo');
  assert.equal(t.avisos.length, 2);
  assert.equal(t.avisos[1][1], true);
  assert.match(t.avisos[1][0], /Não consegui salvar o desenho: Esta janela não pode acessar/);
  assert.equal(t.erros.length, 1, 'o erro da ponte tem que ir para o tela.log (console.error)');
  assert.match(t.erros[0], /Esta janela não pode acessar/);
});

test('quadro vazio: não manda nada para o main (um quadro vazio nunca substitui o arquivo)', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA, ORIGEM);
  t.atual().q.vazio = () => true;
  const pedidos = [];
  t.api.quadroSalvar = async (o) => { pedidos.push(o); return { ok: true, arquivo: ORIGEM }; };
  t.api.quadroSalvarComo = async (o) => { pedidos.push(o); return { ok: true, arquivo: ORIGEM }; };
  await t.clicar('quadroSalvar');
  await t.clicar('quadroSalvarComo');
  assert.deepEqual(pedidos, []);
  assert.equal(t.avisos.length, 2);
  for (const [texto, erro] of t.avisos) { assert.equal(erro, true); assert.match(texto, /vazio/); }
});

test('sem arquivo de origem a função não faz nada (nem se for chamada por fora)', async () => {
  const t = montarQuadro();
  await t.ctx.abrirQuadro(painelDeTeste(), CENA);
  const pedidos = [];
  t.api.quadroSalvar = async (o) => { pedidos.push(o); return { ok: true }; };
  t.api.quadroSalvarComo = async (o) => { pedidos.push(o); return { ok: true }; };
  await t.ctx.salvarQuadro(false);
  await t.ctx.salvarQuadro(true);
  assert.deepEqual(pedidos, []);
  assert.deepEqual(t.avisos, []);
});

/* A porta de entrada: o botao "Abrir no quadro" do leitor (verArquivo) tem que passar o caminho do arquivo para o quadro.
   Roda o visor REAL (app.js) num DOM de mentira, como o test/abrir-seguro.test.js. */
class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.eventos = {};
    this.texto = ''; this.html = ''; this.scrollTop = 0; this.title = '';
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const no = this;
    return {
      add: (...c) => c.forEach((x) => no.classes.add(x)),
      remove: (...c) => c.forEach((x) => no.classes.delete(x)),
      contains: (c) => no.classes.has(c),
      toggle: (c, liga) => { const on = liga === undefined ? !no.classes.has(c) : !!liga; if (on) no.classes.add(c); else no.classes.delete(c); return on; },
    };
  }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = String(v); this.texto = ''; this.esvaziar(); }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.esvaziar(); }
  get isConnected() { return true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  esvaziar() { for (const f of this.filhos) f.pai = null; this.filhos = []; }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  focus() {}
  scrollIntoView() {}
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  querySelectorAll(sel) {
    const casa = sel.startsWith('.') ? (n) => n.classes.has(sel.slice(1)) : (n) => n.tagName.toLowerCase() === sel;
    return this.descendentes.filter(casa);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function filho(pai, tag, classes = '') { const n = new No(tag); n.className = classes; pai.appendChild(n); return n; }
function painelComVisor() {
  const el = new No('section');
  const v = filho(el, 'div', 'modal p-visor hidden');
  const cx = filho(v, 'div', 'visor-cx');
  const top = filho(cx, 'div', 'visor-top');
  const ident = filho(top, 'div', 'visor-identidade'); filho(ident, 'span', 'visor-nome'); filho(ident, 'span', 'visor-origem');
  filho(top, 'button', 'visor-abrir'); filho(top, 'button', 'visor-x');
  filho(cx, 'div', 'visor-caminho');
  const barra = filho(cx, 'div', 'visor-toolbar hidden');
  const modos = filho(barra, 'div', 'visor-modos'); filho(modos, 'button', 'visor-previa'); filho(modos, 'button', 'visor-fonte');
  filho(barra, 'button', 'visor-copiar');
  filho(cx, 'div', 'visor-corpo');
  return { P: { id: 'p1', el }, v };
}
const trechoVisor = APP.slice(
  APP.indexOf('/* ============ visualizador de arquivo ============ */'),
  APP.indexOf('/* ============ conversas recentes ============ */'));

function montarLeitor(resposta, lido) {
  const { P, v } = painelComVisor();
  const corpoDoc = new No('body');
  const abertos = [];
  const api = {
    verArquivo: async () => resposta,
    textoLer: async (o) => { lido.push(o); return { content: CENA }; },
    openPath: async () => ({ ok: true }), mostrarNaPasta: async () => ({ ok: true }),
  };
  const ctx = {
    ...globaisFalsos(), console,
    document: { body: corpoDoc, activeElement: null, createElement: (t) => new No(t) },
    $: (sel, raiz) => (raiz || corpoDoc).querySelector(sel),
    $$: (sel) => (sel === '.p-visor' ? [v] : []),
    ico: (n) => '<i>' + n + '</i>',
    note() {}, abrirQuadro: (...args) => { abertos.push(args); }, ESTE_PC: 'PC',
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    tamanhoBonito: (b) => b + ' B',
    faltaConfigurarServidor: () => false, AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    window: { api },
  };
  vm.createContext(ctx);
  vm.runInContext(trechoVisor, ctx);
  return { ctx, P, v, abertos, corpo: v.querySelector('.visor-corpo') };
}

test('leitor: "Abrir no quadro" de um .excalidraw do disco passa o caminho do arquivo para o quadro (é daí que vem o Salvar)', async () => {
  const lido = [];
  const t = montarLeitor({ tipo: 'outro', nome: 'fluxo.excalidraw', ext: 'excalidraw', bytes: 1234 }, lido);
  await t.ctx.verArquivo(t.P, ORIGEM, null);
  const abrir = t.corpo.querySelector('.reader-action');
  assert.ok(abrir, 'faltou o botão "Abrir no quadro" no leitor do .excalidraw');
  await abrir.eventos.click[0]();
  assert.deepEqual(simples(lido), [{ arquivo: ORIGEM }], 'o conteúdo vem do main (arquivo:lerTexto): é ele que registra o arquivo como aberto');
  assert.equal(t.abertos.length, 1);
  assert.equal(t.abertos[0][0], t.P);
  assert.equal(t.abertos[0][1], CENA);
  assert.equal(t.abertos[0][2], ORIGEM, 'sem o caminho como 3º argumento o quadro abre como cópia e não oferece o Salvar');
});

test('leitor: desenho do Obsidian (.excalidraw.md) continua abrindo uma CÓPIA no quadro, sem origem (o .md não muda)', async () => {
  const caminho = 'C:\\Projetos\\fluxo.excalidraw.md';
  const t = montarLeitor({ tipo: 'texto', nome: 'fluxo.excalidraw.md', ext: 'md', bytes: 99, dados: '# Drawing\n```json\n' + CENA + '\n```\n' }, []);
  await t.ctx.verArquivo(t.P, caminho, null);
  const abrir = t.corpo.querySelector('.reader-action');
  assert.ok(abrir, 'faltou o botão "Abrir no quadro" no leitor do .excalidraw.md');
  await abrir.eventos.click[0]();
  assert.equal(t.abertos.length, 1);
  assert.equal(t.abertos[0][1], CENA);
  assert.equal(t.abertos[0][2], undefined, 'o .md do Obsidian não ganha Salvar: o quadro não sabe devolver a cena ao markdown');
});
