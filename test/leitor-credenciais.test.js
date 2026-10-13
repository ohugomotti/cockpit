'use strict';
/* Leva 2, Fix C item 5 (decisão de segurança do coordenador): arquivo de credenciais não aparece no leitor.

   Na Task 3 o arquivo SEM extensão passou a abrir como texto. Isso incluiu .env, .npmrc, .git-credentials, .netrc,
   id_rsa e id_ed25519 (o path.extname('.env') é vazio): a chave privada ia parar na tela, no histórico do leitor e nos
   comentários. Agora o main decide pelo NOME, antes de ler qualquer byte: a lista abaixo volta como tipo 'credencial'
   (sem dados), no ramo local e no do servidor. Quem desenha a mensagem ("Arquivo de credenciais: não mostro aqui", com
   "Abrir no programa") é o visor da tela, a partir do tipo.

   Lista: .env, .env.* (menos .env.example), .npmrc, .git-credentials, .netrc, id_rsa, id_dsa, id_ecdsa, id_ed25519,
   *.pem, *.key, *.p12 e *.pfx. Maiúscula e minúscula valem igual (no Windows o nome não distingue).

   O main não carrega em teste (precisa do Electron): o código REAL é recortado do main.js e roda num vm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const temporarias = [];
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-credenciais-'));
temporarias.push(D);
function arq(nome, conteudo) {
  const p = path.join(D, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
  return p;
}
// fs de verdade, mas anotando quem leu conteúdo
function fsQueAnota() {
  const lidos = [];
  const anota = (nome) => (p, ...resto) => { lidos.push(nome + ' ' + path.basename(String(p))); return fs[nome](p, ...resto); };
  return { lidos, fs: { ...fs, readFileSync: anota('readFileSync'), openSync: anota('openSync') } };
}
// de "const EXT_VIS_IMG" até o ramo do servidor: o mesmo recorte do test/leitor-tipos.test.js
function trechoDoLeitor() {
  const ini = MAIN.indexOf("const EXT_VIS_IMG = ['png'");
  const fim = MAIN.indexOf('/* O mesmo arquivo, mas no servidor.');
  assert.ok(ini > 0 && fim > ini, 'não achei o trecho do leitor no main.js');
  return MAIN.slice(ini, fim);
}
function leitor(extras = {}) {
  const ctx = { fs, path, Buffer, TextDecoder, ...extras };
  vm.createContext(ctx);
  vm.runInContext(trechoDoLeitor() + '\nthis.verArquivoLocal = verArquivoLocal; this.tipoDoVisor = tipoDoVisor;', ctx);
  return ctx;
}
function leitorRemoto() {
  const pedidos = [];
  let resposta = { out: '' };
  const ctx = {
    fs: new Proxy({}, { get: (_, nome) => () => { throw new Error('encostou no disco local: fs.' + String(nome)); } }),
    path, Buffer, TextDecoder,
    execRemoto: async (_remoto, script) => { pedidos.push(script); return resposta; },
  };
  vm.createContext(ctx);
  vm.runInContext([trechoDoLeitor(), pegarBloco(MAIN, 'function qLinux(', 'qLinux'), pegarBloco(MAIN, 'function qRemoto(', 'qRemoto'),
    pegarBloco(MAIN, 'async function verArquivoRemoto(', 'verArquivoRemoto'), 'this.verArquivoRemoto = verArquivoRemoto;'].join('\n'), ctx);
  return {
    pedidos,
    ver(arquivo, r) { resposta = r; pedidos.length = 0; return ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, arquivo); },
  };
}
const pacote = (bytes, buf) => ({ out: 'COCKPIT_TAM ' + bytes + '\n' + (buf ? buf.toString('base64') : '') });
const SEGREDO = 'TOKEN_SECRETO=abc123-nao-pode-aparecer\n';

const CREDENCIAIS = [
  '.env', '.ENV', '.env.local', '.env.production', '.env.development.local', '.env.sample', '.npmrc', '.NPMRC', '.git-credentials', '.netrc',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'ID_RSA', 'sub/.ssh/id_ed25519', 'pasta/.env',
  'servidor.pem', 'chave.key', 'CHAVE.KEY', 'cert.p12', 'cert.pfx', 'CERT.PFX', 'meu certificado.pem', '.key', '.pem',
];
const NAO_SAO = [
  ['.env.example', 'texto'], ['.ENV.EXAMPLE', 'texto'], ['LEIAME', 'texto'], ['Makefile', 'texto'], ['turkey', 'texto'],
  ['keyboard.txt', 'texto'], ['monkey.md', 'texto'], ['nota.pem.md', 'texto'], ['environment.md', 'texto'], ['id_rsa_backup.txt', 'texto'],
  ['meu-env.txt', 'texto'], ['id_rsa.pub', 'outro'], ['planilha.xlsx', 'documento'], ['logo.png', 'imagem'],
];

test('credencial local: o main devolve tipo "credencial", sem dados, sem erro, e nem lê o conteúdo do disco', () => {
  const { lidos, fs: fsLido } = fsQueAnota();
  const { verArquivoLocal } = leitor({ fs: fsLido });
  for (const nome of CREDENCIAIS) {
    const r = verArquivoLocal(arq(nome, SEGREDO));
    assert.equal(r.tipo, 'credencial', nome);
    assert.equal(r.dados, undefined, nome);
    assert.equal(r.erro, undefined, nome);
    assert.equal(r.nome, path.basename(nome), nome + ': o visor ainda precisa do nome');
    assert.ok(!JSON.stringify(r).includes('abc123'), nome + ': o conteúdo não pode vazar em campo nenhum');
  }
  assert.deepEqual(lidos, [], 'o conteúdo nem é lido');
});

test('credencial local: vale também para arquivo grande (o teto de tamanho não vem antes) e o tamanho segue informado', () => {
  const { verArquivoLocal } = leitor();
  const grande = arq('grande/.env', 'X=1\n' + 'y'.repeat(700 * 1024));
  const r = verArquivoLocal(grande);
  assert.equal(r.tipo, 'credencial', 'nada de "grande demais": o motivo é o nome');
  assert.equal(r.limite, undefined);
  assert.equal(r.bytes, fs.statSync(grande).size);
});

test('o que parece mas não é credencial segue como antes (.env.example, id_rsa.pub, keyboard, turkey, nota.pem.md...)', () => {
  const { verArquivoLocal } = leitor();
  for (const [nome, tipo] of NAO_SAO) {
    const r = verArquivoLocal(arq('normais/' + nome, nome === 'logo.png' ? Buffer.from([0x89, 0x50, 0x4E, 0x47]) : 'conteudo comum\n'));
    assert.equal(r.tipo, tipo, nome);
  }
});

test('uma pasta com nome de credencial continua sendo só pasta ("outro"), não "credencial"', () => {
  const { verArquivoLocal } = leitor();
  const dir = path.join(D, 'pasta.key');
  fs.mkdirSync(dir, { recursive: true });
  const r = verArquivoLocal(dir);
  assert.equal(r.tipo, 'outro');
  assert.equal(r.erro, undefined);
});

test('tipoDoVisor: a decisão é pelo NOME (inclusive nomes que o Windows não deixa criar, como ".env.")', () => {
  const { tipoDoVisor } = leitor();
  for (const nome of [...CREDENCIAIS.map((n) => path.basename(n)), '.env.', '.env.a.b.c']) {
    const ext = path.extname(nome).slice(1).toLowerCase();
    assert.equal(tipoDoVisor(nome, ext), 'credencial', nome);
  }
  for (const [nome, tipo] of NAO_SAO) {
    assert.equal(tipoDoVisor(nome, path.extname(nome).slice(1).toLowerCase()), tipo, nome);
  }
});

test('credencial no servidor: não baixa nada (nem pede base64), devolve tipo "credencial" e nunca o conteúdo', async () => {
  const { ver, pedidos } = leitorRemoto();
  for (const arquivo of ['~/.env', '/srv/app/.env.production', '~/.ssh/id_ed25519', '~/.ssh/id_rsa', '~/.npmrc', '~/.git-credentials', '~/.netrc',
    '/srv/certs/site.pem', '/srv/certs/SITE.KEY', '/srv/certs/a.p12', '/srv/certs/a.pfx', '/srv/app/.ENV']) {
    const r = await ver(arquivo, pacote(1234));
    assert.equal(r.tipo, 'credencial', arquivo);
    assert.equal(r.dados, undefined, arquivo);
    assert.equal(r.erro, undefined, arquivo);
    assert.equal(r.bytes, 1234, arquivo);
    assert.doesNotMatch(pedidos[0], /base64/, arquivo + ': nada é baixado');
  }
  // mesmo que o servidor mande o conteúdo (resposta torta), ele não passa
  const r = await ver('~/.env', pacote(SEGREDO.length, Buffer.from(SEGREDO)));
  assert.equal(r.tipo, 'credencial');
  assert.ok(!JSON.stringify(r).includes('abc123'), 'o conteúdo não pode vazar em campo nenhum');
});

test('servidor: o que parece mas não é credencial segue como antes (.env.example e arquivo sem extensão baixam o texto)', async () => {
  const { ver, pedidos } = leitorRemoto();
  const exemplo = Buffer.from('CHAVE=\n');
  let r = await ver('/srv/app/.env.example', pacote(exemplo.length, exemplo));
  assert.equal(r.tipo, 'texto');
  assert.equal(r.dados, 'CHAVE=\n');
  assert.match(pedidos[0], /base64 -w0/);
  const leiame = Buffer.from('arquivo sem extensao');
  r = await ver('/srv/app/LEIAME', pacote(leiame.length, leiame));
  assert.equal(r.tipo, 'texto');
  r = await ver('/srv/app/id_rsa.pub', pacote(300));
  assert.equal(r.tipo, 'outro');
});

test('o canal arquivo:ver só registra comentários de documento "texto": a credencial passa direto, sem document', () => {
  const ini = MAIN.indexOf("ipcMain.handle('arquivo:ver'");
  assert.ok(ini > 0, 'não achei o canal arquivo:ver');
  const canal = MAIN.slice(ini, MAIN.indexOf('\n});', ini) + 4);
  assert.match(canal, /result\.tipo === 'texto' && typeof result\.dados === 'string'/);
});
