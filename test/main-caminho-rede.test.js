'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const source = lerFonte('main.js');

/* R5-01 (segunda trava, no main): mesmo que a tela deixe passar um caminho de rede (\\servidor, //servidor,
   /\servidor), arquivo:ver, shell:open e shell:link recusam ANTES de encostar no disco ou no shell. O statSync
   num caminho de rede fora do ar trava o processo principal ~21 s, e com o servidor no ar o Windows tenta
   autenticar por SMB (entrega o hash da senha).

   O main não carrega em teste (precisa do Electron). Então aqui roda o código REAL dos três canais e do
   verArquivoLocal, recortado do main.js, com o disco e o shell vigiados: qualquer toque fica anotado. */
const MENSAGEM = 'Caminho de rede bloqueado por segurança.';
const REDE = [
  '\\\\servidor\\pasta\\a.md', '//servidor/pasta/a.md', '/\\servidor/pasta/a.md', '\\/servidor/pasta/a.md',
  '  \\\\servidor\\pasta\\a.md', '\\\\?\\UNC\\servidor\\pasta\\a.md',
];

// "const nome = ...;" em uma linha só
function linhaConst(nome) {
  const ini = source.indexOf('const ' + nome + ' = ');
  return ini < 0 ? '' : source.slice(ini, source.indexOf('\n', ini));
}
function trechoDoCanal(canal) {
  const ini = source.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, 'não achei ipcMain.handle(' + canal + ')');
  return source.slice(ini, source.indexOf('\n});', ini) + 4);
}

// Um "main.js em miniatura": só os pedaços que o teste quer, com fs e shell vigiados (cada toque vai para `toques`).
function montar(extras = {}) {
  const toques = [];
  const vigiado = (prefixo, retorno) => new Proxy({}, {
    get: (_, nome) => (...a) => { toques.push(prefixo + '.' + String(nome)); return retorno(String(nome), a); },
  });
  const handlers = {};
  const ctx = {
    path, Buffer, TextDecoder,
    fs: vigiado('fs', (nome) => { throw new Error('encostou no disco: fs.' + nome); }),
    shell: vigiado('shell', () => ''),
    podeAbrirDireto: () => { toques.push('podeAbrirDireto'); return true; },
    // o shell:open consulta a regra pura "script nunca abre direto" (src/abrir-seguro.js): ela não toca em disco nem em shell
    decidirAbertura: require('../src/abrir-seguro.js').decidirAbertura,
    remotoDoPedido: (o) => (o && o.remoto) || null,
    verArquivoRemoto: async () => { toques.push('verArquivoRemoto'); return { tipo: 'outro' }; },
    readerComments: { registerDocument: () => ({ id: 'doc' }) },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    ...extras,
  };
  vm.createContext(ctx);
  for (const nome of ['MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede', 'EXT_VIS_IMG', 'EXT_VIS_TXT', 'TETO_VIS_IMG', 'TETO_VIS_TXT', 'mimeDaImagem', 'EXT_VIS_DOC']) {
    vm.runInContext(linhaConst(nome), ctx);
  }
  // leva 2 (UI 7.2-3/7.2-5): o leitor decide o tipo pelo nome e o acento pelos bytes
  for (const f of ['function tipoDoVisor(', 'function textoDosBytes(']) vm.runInContext(pegarBloco(source, f, f), ctx);
  vm.runInContext(pegarBloco(source, 'function verArquivoLocal(', 'verArquivoLocal'), ctx);
  for (const canal of ['arquivo:ver', 'shell:open', 'shell:link']) vm.runInContext(trechoDoCanal(canal), ctx);
  return { ctx, toques, chamar: (canal, ...args) => handlers[canal]({}, ...args) };
}

test('main.js define o helper ehCaminhoDeRede e a mensagem de bloqueio', () => {
  assert.notEqual(linhaConst('ehCaminhoDeRede'), '', 'falta: const ehCaminhoDeRede = ...');
  assert.notEqual(linhaConst('MSG_CAMINHO_DE_REDE'), '', 'falta: const MSG_CAMINHO_DE_REDE = ...');
  assert.ok(linhaConst('MSG_CAMINHO_DE_REDE').includes("'" + MENSAGEM + "'"));
});

test('ehCaminhoDeRede: duas barras de qualquer tipo; caminho local, do servidor e vazio passam', () => {
  const { ctx } = montar();
  const ehCaminhoDeRede = vm.runInContext('ehCaminhoDeRede', ctx);
  for (const p of REDE) assert.equal(ehCaminhoDeRede(p), true, JSON.stringify(p));
  for (const p of ['C:\\a\\b.md', 'C:/a/b.md', '/home/hugo/a.md', '/opt/equipe/a.md', './a.md', 'a.md', '~/a.md', 'https://exemplo.com/a', '', '   ', null, undefined, 42]) {
    assert.equal(ehCaminhoDeRede(p), false, JSON.stringify(p));
  }
});

test('arquivo:ver recusa caminho de rede sem encostar no disco (string e objeto { file })', async () => {
  for (const p of REDE) {
    for (const pedido of [p, { file: p }]) {
      const { toques, chamar } = montar();
      const r = await chamar('arquivo:ver', pedido);
      // a tela do visor lê "erro"; "error" é o nome que os outros canais usam
      assert.equal(r.erro, MENSAGEM, JSON.stringify(p));
      assert.equal(r.error, MENSAGEM, JSON.stringify(p));
      assert.equal(r.tipo, undefined, 'não pode devolver conteúdo');
      assert.deepEqual(toques, [], 'encostou em algo: ' + JSON.stringify(p));
    }
  }
});

// o objeto nasce dentro do vm (outro Object.prototype): comparar o conteúdo, não o protótipo
const simples = (v) => JSON.parse(JSON.stringify(v));

test('shell:open recusa caminho de rede antes de olhar o nome, o disco ou o shell', async () => {
  for (const p of REDE) {
    const { toques, chamar } = montar();
    assert.deepEqual(simples(await chamar('shell:open', p)), { error: MENSAGEM }, JSON.stringify(p));
    assert.deepEqual(toques, [], 'encostou em algo: ' + JSON.stringify(p));
  }
});

test('shell:link recusa caminho de rede antes de olhar o nome, o disco ou o shell', async () => {
  for (const p of REDE) {
    const { toques, chamar } = montar();
    assert.deepEqual(simples(await chamar('shell:link', p)), { error: MENSAGEM }, JSON.stringify(p));
    assert.deepEqual(toques, [], 'encostou em algo: ' + JSON.stringify(p));
  }
});

test('o que é local continua abrindo: arquivo no visor, pasta/arquivo no shell, https no navegador', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-rede-'));
  try {
    const arquivo = path.join(pasta, 'nota.md');
    fs.writeFileSync(arquivo, 'olá, mundo');
    const visor = montar({ fs });
    const r = await visor.chamar('arquivo:ver', arquivo);
    assert.equal(r.tipo, 'texto');
    assert.equal(r.dados, 'olá, mundo');
    assert.equal(r.erro, undefined);

    const aberto = montar({ fs: { existsSync: () => true } });
    await aberto.chamar('shell:open', 'C:\\Users\\hugom\\nota.md');
    await aberto.chamar('shell:link', 'C:\\Users\\hugom\\nota.md');
    assert.equal(aberto.toques.filter((t) => t === 'shell.openPath').length, 2, 'os dois canais abrem o caminho local');

    const web = montar();
    await web.chamar('shell:link', 'https://exemplo.com/a');
    assert.deepEqual(web.toques, ['shell.openExternal']);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('arquivo:ver de servidor (remoto) não é bloqueado: não encosta no disco deste PC', async () => {
  const { toques, chamar } = montar();
  const r = await chamar('arquivo:ver', { file: '//opt/equipe/a.md', remoto: { host: 'vps' } });
  assert.equal(r.tipo, 'outro');
  assert.deepEqual(toques, ['verArquivoRemoto']);
});
