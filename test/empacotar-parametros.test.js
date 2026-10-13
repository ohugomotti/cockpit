'use strict';
/* Task 19a: tools/auditoria/empacotar.mjs aceita --baseline=<sha256> e --novos=a,b,c.

   Antes, o hash do baseline e a lista de arquivos novos eram fixos no código. A cada instalação o baseline
   envelhecia ("A instalação mudou...") e arquivo novo de leva abortava: abrir-seguro.js (o app não abre sem ele),
   log-tela.js (o log fica mudo) e renderer/log-tela.js (dá 404).

   Como o teste roda sem o Cockpit instalado: ele executa uma CÓPIA do empacotar.mjs dentro de uma pasta
   temporária. A raiz do script é a pasta onde ele mora, então src/ e artifacts/ também são os da pasta temporária.
   LOCALAPPDATA aponta para um "AppData" falso que tem só um app.asar falso (um JSON) e um @electron/asar falso
   (a biblioteca que o script procura no cache do npx). Nada aqui lê, grava ou mede o Programs/Cockpit de verdade. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EMPACOTAR = path.join(__dirname, '..', 'tools', 'auditoria', 'empacotar.mjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

// @electron/asar falso: o "pacote" é um JSON { "<caminho com />": "<conteúdo em base64>" }.
const ASAR_FALSO = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const ler = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const chave = (entrada) => entrada.replace(/^[/\\]/, '').replaceAll('\\', '/');
exports.listPackage = (arquivo) => {
  const nomes = new Set(Object.keys(ler(arquivo)));
  for (const nome of [...nomes]) {
    const partes = nome.split('/');
    for (let i = 1; i < partes.length; i++) nomes.add(partes.slice(0, i).join('/'));
  }
  return [...nomes].sort().map((nome) => path.sep + nome.split('/').join(path.sep));
};
exports.statFile = (arquivo, entrada) => {
  const mapa = ler(arquivo);
  const nome = chave(entrada);
  if (Object.hasOwn(mapa, nome)) return { size: Buffer.from(mapa[nome], 'base64').length };
  if (Object.keys(mapa).some((outro) => outro.startsWith(nome + '/'))) return { files: {} };
  throw new Error('entrada inexistente: ' + entrada);
};
exports.extractFile = (arquivo, entrada) => Buffer.from(ler(arquivo)[chave(entrada)], 'base64');
exports.extractAll = (arquivo, destino) => {
  for (const [nome, base64] of Object.entries(ler(arquivo))) {
    const alvo = path.join(destino, nome);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, Buffer.from(base64, 'base64'));
  }
};
exports.createPackageWithOptions = async (pasta, saida) => {
  const mapa = {};
  const andar = (dir, prefixo) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.isDirectory()) andar(path.join(dir, entrada.name), prefixo + entrada.name + '/');
      else mapa[prefixo + entrada.name] = fs.readFileSync(path.join(dir, entrada.name)).toString('base64');
    }
  };
  andar(pasta, '');
  fs.writeFileSync(saida, JSON.stringify(mapa));
};
`;

// O que há dentro do app.asar falso instalado e o que há no src/ (preload.js mudou; node_modules é ignorado pelo script).
const INSTALADO = { 'main.js': 'main v1', 'preload.js': 'preload v1', 'renderer/app.js': 'app v1', 'node_modules/dep/index.js': 'dep' };
const FONTE = { 'main.js': 'main v1', 'preload.js': 'preload v2', 'renderer/app.js': 'app v1' };

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-empacotar-')));
after(() => {
  assert.ok(base.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  fs.rmSync(base, { recursive: true, force: true });
});

let contador = 0;
const gravar = (arquivo, conteudo) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, conteudo); };
const empacotadoFalso = (arquivos) => JSON.stringify(Object.fromEntries(Object.entries(arquivos).map(([nome, texto]) => [nome, Buffer.from(texto).toString('base64')])));

/* Monta uma "máquina" nova: copia do script + src/ + AppData falso. `novos` são arquivos que existem no src/ mas
   não no app.asar instalado. */
function montar(novos = {}) {
  const raiz = path.join(base, 'caso-' + ++contador);
  const appdata = path.join(raiz, 'appdata');
  const recursos = path.join(appdata, 'Programs', 'Cockpit', 'resources');
  const instalado = path.join(recursos, 'app.asar');
  const script = path.join(raiz, 'tools', 'auditoria', 'empacotar.mjs');
  gravar(script, fs.readFileSync(EMPACOTAR));
  for (const [nome, texto] of Object.entries({ ...FONTE, ...novos })) gravar(path.join(raiz, 'src', nome), texto);
  gravar(instalado, empacotadoFalso(INSTALADO));
  gravar(path.join(recursos, 'app.asar.unpacked', 'node_modules', '@lydell', 'node-pty', 'pty.node'), 'nativo');
  gravar(path.join(appdata, 'npm-cache', '_npx', 'falso', 'node_modules', '@electron', 'asar', 'lib', 'asar.js'), ASAR_FALSO);
  const env = { ...process.env, LOCALAPPDATA: appdata };
  delete env.NODE_TEST_CONTEXT;
  return {
    raiz,
    instalado,
    hashInstalado: () => sha(fs.readFileSync(instalado)),
    rodar: (...argumentos) => spawnSync(process.execPath, [script, ...argumentos], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 }),
    manifesto: () => JSON.parse(fs.readFileSync(path.join(raiz, 'artifacts', 'multiagentes-package.json'), 'utf8')),
    temArtifacts: () => fs.existsSync(path.join(raiz, 'artifacts')),
  };
}

/* O Node imprime, antes da mensagem, a linha de código que lançou o erro (e ela repete o texto). Por isso as
   regex pedem a linha "Error: ...", que é a mensagem de verdade. */
const MSG_BASELINE = /^Error: A instalação mudou desde o início da auditoria; compare e integre antes de empacotar\.$/m;
const MSG_NOVOS = /^Error: Declare explicitamente os arquivos novos antes de empacotar: (.*) \(use --novos=a,b,c\)\.$/m;
const MSG_ARGUMENTO = /^Error: Argumento inválido: (.*) \(use --baseline=<sha256> e --novos=a,b,c\)\.$/m;

test('arquivo novo sem --novos aborta e não gera pacote', () => {
  const caso = montar({ 'novo.js': 'novo' });
  const r = caso.rodar();
  assert.notEqual(r.status, 0);
  assert.equal(MSG_NOVOS.exec(r.stderr)?.[1].trim(), 'novo.js', r.stderr);
  assert.equal(caso.temArtifacts(), false);
});

test('--novos faz o arquivo novo entrar no pacote e no manifesto, sem tocar na instalação', () => {
  const caso = montar({ 'novo.js': 'novo' });
  const antes = caso.hashInstalado();
  const r = caso.rodar('--novos=novo.js');
  assert.equal(r.status, 0, r.stderr);
  const manifesto = caso.manifesto();
  assert.deepEqual(manifesto.addedFiles, ['novo.js']);
  assert.deepEqual(manifesto.changedFiles, ['preload.js']);
  assert.equal(manifesto.sourceHashes['novo.js'], sha('novo'));
  const pacote = JSON.parse(fs.readFileSync(manifesto.package, 'utf8'));
  assert.equal(Buffer.from(pacote['novo.js'], 'base64').toString(), 'novo');
  assert.equal(Buffer.from(pacote['preload.js'], 'base64').toString(), 'preload v2');
  assert.equal(caso.hashInstalado(), antes);
});

test('os 3 arquivos novos da leva 1 entram com --novos=abrir-seguro.js,log-tela.js,renderer/log-tela.js', () => {
  const caso = montar({ 'abrir-seguro.js': 'a', 'log-tela.js': 'b', 'renderer/log-tela.js': 'c' });
  assert.notEqual(caso.rodar().status, 0, 'sem declarar, aborta');
  const r = caso.rodar('--novos=abrir-seguro.js,log-tela.js,renderer/log-tela.js');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(caso.manifesto().addedFiles.sort(), ['abrir-seguro.js', 'log-tela.js', 'renderer/log-tela.js']);
});

test('--novos soma-se à lista fixa, e a lista fixa continua valendo sozinha', () => {
  const soma = montar({ 'engine-updates.js': 'fixo', 'novo.js': 'novo' });
  const r = soma.rodar('--novos=novo.js');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(soma.manifesto().addedFiles.sort(), ['engine-updates.js', 'novo.js']);

  const sozinha = montar({ 'engine-updates.js': 'fixo' });
  const s = sozinha.rodar();
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(sozinha.manifesto().addedFiles, ['engine-updates.js']);
});

test('--novos que declara só um dos arquivos novos aborta pelo outro', () => {
  const caso = montar({ 'novo.js': 'novo', 'outro.js': 'outro' });
  const r = caso.rodar('--novos=novo.js');
  assert.notEqual(r.status, 0);
  assert.equal(MSG_NOVOS.exec(r.stderr)?.[1].trim(), 'outro.js', r.stderr);
  assert.equal(caso.temArtifacts(), false);
});

test('--novos aceita espaço depois da vírgula e barra invertida do Windows', () => {
  const caso = montar({ 'novo.js': 'novo', 'renderer/estilo.css': 'css' });
  const r = caso.rodar('--novos=novo.js, renderer\\estilo.css');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(caso.manifesto().addedFiles.sort(), ['novo.js', 'renderer/estilo.css']);
});

test('--baseline errado aborta como antes, sem gerar pacote', () => {
  const caso = montar();
  const hash = caso.hashInstalado();
  const errado = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
  const r = caso.rodar('--baseline=' + errado);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, MSG_BASELINE);
  // vazio também aborta: "--baseline=" não pode cair no padrão em silêncio
  const vazio = caso.rodar('--baseline=');
  assert.notEqual(vazio.status, 0);
  assert.match(vazio.stderr, MSG_BASELINE);
  assert.equal(caso.temArtifacts(), false);
});

test('--baseline igual ao instalado passa, em maiúsculas ou minúsculas, e o manifesto guarda o hash em maiúsculas', () => {
  for (const forma of [(hash) => hash, (hash) => hash.toLowerCase()]) {
    const caso = montar();
    const r = caso.rodar('--baseline=' + forma(caso.hashInstalado()));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(caso.manifesto().baselineHash, caso.hashInstalado());
  }
});

test('sem --baseline, o padrão é o SHA-256 do app.asar instalado, lido na hora', () => {
  const caso = montar();
  const primeira = caso.rodar();
  assert.equal(primeira.status, 0, primeira.stderr);
  const hash1 = caso.hashInstalado();
  assert.equal(caso.manifesto().baselineHash, hash1);

  // a instalação "envelhece" (outro app.asar): o padrão acompanha, sem hash fixo no código
  gravar(caso.instalado, empacotadoFalso({ ...INSTALADO, 'node_modules/dep/index.js': 'dep v2' }));
  const hash2 = caso.hashInstalado();
  assert.notEqual(hash2, hash1);
  const segunda = caso.rodar();
  assert.equal(segunda.status, 0, segunda.stderr);
  assert.equal(caso.manifesto().baselineHash, hash2);
});

test('argumento desconhecido aborta: um --baseline mal escrito não pode pular a conferência em silêncio', () => {
  const caso = montar();
  const hash = caso.hashInstalado();
  for (const argumentos of [['--baselin=' + hash], ['--baseline', hash], ['novo.js'], ['--novos'], ['--outra=1']]) {
    const r = caso.rodar(...argumentos);
    assert.notEqual(r.status, 0, argumentos.join(' '));
    assert.equal(MSG_ARGUMENTO.exec(r.stderr)?.[1], argumentos[0], r.stderr);
  }
  assert.equal(caso.temArtifacts(), false);
});

test('mesmo manifesto e mesma saída de antes: mesmas chaves na mesma ordem, e o stdout é o manifesto', () => {
  const caso = montar({ 'novo.js': 'novo' });
  const r = caso.rodar('--novos=novo.js');
  assert.equal(r.status, 0, r.stderr);
  const manifesto = caso.manifesto();
  assert.deepEqual(Object.keys(manifesto), [
    'status', 'createdAt', 'workspace', 'baselineHash', 'package', 'packageHash', 'changedFiles', 'addedFiles',
    'sourceHashes', 'filesVerified', 'nativeFilesVerified', 'installedModified', 'origem',
  ]);
  assert.equal(manifesto.status, 'verified');
  assert.equal(manifesto.workspace, caso.raiz);
  assert.equal(manifesto.baselineHash, caso.hashInstalado());
  assert.equal(manifesto.packageHash, sha(fs.readFileSync(manifesto.package)));
  assert.deepEqual(Object.keys(manifesto.sourceHashes), ['main.js', 'novo.js', 'preload.js', 'renderer/app.js']);
  assert.equal(manifesto.filesVerified, 5);
  assert.equal(manifesto.nativeFilesVerified, 1);
  assert.equal(manifesto.installedModified, false);
  assert.equal(manifesto.origem, 'tools/auditoria/empacotar.mjs');
  assert.deepEqual(JSON.parse(r.stdout), manifesto);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(manifesto.package), 'manifest.json'), 'utf8')), manifesto);
});
