'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte } = require('../testes/raiz');
const source = lerFonte('main.js');

/* R5-01, acompanhamento da Task 4 (Task 4b da leva 1): anexar arquivo -- copiado no Explorer, arrastado para o
   painel ou escolhido pelo + -- termina no canal anexo:ler, e ele fazia fs.statSync(file) sem a trava de caminho
   de rede. O statSync num \\servidor fora do ar trava o processo principal ~21 s e, com o servidor no ar, o
   Windows tenta autenticar por SMB (entrega o hash da senha). O arquivo:ver, o shell:open e o shell:link já
   recusavam (Task 1); o anexo:ler ficou de fora.

   O main não carrega em teste (precisa do Electron). Aqui roda o código REAL do canal, recortado do main.js,
   com o disco vigiado: qualquer toque no fs fica anotado e, num caminho de rede, ainda lança. */
const MENSAGEM = 'Caminho de rede bloqueado por segurança.';
const REDE = [
  '\\\\servidor\\pasta\\a.png', '//servidor/pasta/a.png', '/\\servidor/pasta/a.png', '\\/servidor/pasta/a.png',
  '  \\\\servidor\\pasta\\a.png', '\\\\?\\UNC\\servidor\\pasta\\a.png',
];

// "const nome = ...;" em uma linha só
function linhaConst(nome) {
  const ini = source.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'não achei: const ' + nome);
  return source.slice(ini, source.indexOf('\n', ini));
}
function trechoDoCanal(canal) {
  const ini = source.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, 'não achei ipcMain.handle(' + canal + ')');
  return source.slice(ini, source.indexOf('\n});', ini) + 4);
}

// o objeto nasce dentro do vm (outro Object.prototype): comparar o conteúdo, não o protótipo
const simples = (v) => JSON.parse(JSON.stringify(v));

// Um "main.js em miniatura": só o anexo:ler e as três constantes que ele usa, com o fs que o teste mandar.
function montar(fsDoCanal) {
  const handlers = {};
  const ctx = { path, Buffer, fs: fsDoCanal, ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } } };
  vm.createContext(ctx);
  for (const nome of ['EXT_IMG', 'MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede']) vm.runInContext(linhaConst(nome), ctx);
  vm.runInContext(trechoDoCanal('anexo:ler'), ctx);
  assert.equal(typeof handlers['anexo:ler'], 'function', 'falta o canal anexo:ler');
  return (arquivo) => handlers['anexo:ler']({}, arquivo);
}

// Disco vigiado: cada toque vai para `toques` e, como num caminho de rede não pode haver nenhum, também lança.
function discoVigiado() {
  const toques = [];
  const vigiado = new Proxy({}, {
    get: (_, nome) => (...args) => { toques.push('fs.' + String(nome)); throw new Error('encostou no disco: fs.' + String(nome)); },
  });
  return { toques, vigiado };
}

test('anexo:ler recusa caminho de rede sem encostar no disco (as seis grafias de \\\\servidor)', async () => {
  for (const p of REDE) {
    const { toques, vigiado } = discoVigiado();
    const r = simples(await montar(vigiado)(p));
    // o canal já devolvia "erro"; "error" é o nome que arquivo:ver, shell:open e shell:link usam: o mesmo texto da Task 1
    assert.equal(r.erro, MENSAGEM, JSON.stringify(p));
    assert.equal(r.error, MENSAGEM, JSON.stringify(p));
    assert.equal(r.path, p, 'a ficha continua sabendo qual arquivo foi recusado');
    assert.equal(r.nome, path.basename(p));
    // nada de conteúdo: sem miniatura, sem tamanho, sem extensão (a ficha de erro não vira imagem)
    for (const campo of ['mini', 'bytes', 'ext']) assert.equal(r[campo], undefined, campo + ' não pode existir: ' + JSON.stringify(p));
    assert.deepEqual(toques, [], 'encostou no disco com caminho de rede: ' + JSON.stringify(p));
  }
});

test('o vigia do teste enxerga o disco: caminho local passa pelo fs (senão o teste acima seria vazio)', async () => {
  const { toques, vigiado } = discoVigiado();
  const r = simples(await montar(vigiado)('C:\\Users\\hugom\\a.png'));
  assert.deepEqual(toques, ['fs.statSync']);
  assert.match(r.erro, /encostou no disco/);
});

test('anexo:ler: o que é local continua igual (texto sem miniatura, imagem com miniatura, arquivo que não existe)', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-anexo-'));
  try {
    const anexoLer = montar(fs);
    const gravar = (nome, bytes) => { const f = path.join(pasta, nome); fs.writeFileSync(f, bytes); return f; };

    const nota = gravar('nota.txt', 'olá, mundo');
    assert.deepEqual(simples(await anexoLer(nota)), { path: nota, nome: 'nota.txt', ext: 'txt', bytes: Buffer.byteLength('olá, mundo') });

    // imagem até 8 MB ganha miniatura em data URL; jpg e svg usam o tipo certo
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    for (const [nome, tipo] of [['foto.png', 'png'], ['foto.JPG', 'jpeg'], ['logo.svg', 'svg+xml']]) {
      const f = gravar(nome, bytes);
      assert.deepEqual(simples(await anexoLer(f)), {
        path: f, nome, ext: path.extname(nome).slice(1).toLowerCase(), bytes: bytes.length,
        mini: 'data:image/' + tipo + ';base64,' + bytes.toString('base64'),
      }, nome);
    }

    // acima de 8 MB anexa do mesmo jeito, só que sem miniatura
    const grande = gravar('grande.png', Buffer.alloc(8 * 1024 * 1024 + 1));
    const g = simples(await anexoLer(grande));
    assert.equal(g.bytes, 8 * 1024 * 1024 + 1);
    assert.equal(g.mini, undefined);

    // o erro de sempre (arquivo que não existe) segue com o texto do sistema, no mesmo formato
    const sumiu = path.join(pasta, 'sumiu.png');
    const e = simples(await anexoLer(sumiu));
    assert.match(e.erro, /ENOENT/);
    assert.equal(e.path, sumiu);
    assert.equal(e.nome, 'sumiu.png');
    assert.equal(e.mini, undefined);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
