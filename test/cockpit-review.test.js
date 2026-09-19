'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { captureReview } = require('../src/cockpit-review');

const run = promisify(execFile);
const artifacts = path.resolve(__dirname, '..', 'artifacts');
const git = async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], { windowsHide: true })).stdout;

async function repository(t) {
  await fs.mkdir(artifacts, { recursive: true });
  const temp = await fs.mkdtemp(path.join(artifacts, 'review-test-'));
  t.after(async () => {
    const target = path.resolve(temp);
    assert.equal(path.dirname(target), artifacts);
    assert.ok(path.basename(target).startsWith('review-test-'));
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = path.join(temp, 'projeto para revisar');
  await fs.mkdir(root);
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.name', 'Teste de revisão Cockpit');
  await git(root, 'config', 'user.email', 'teste@example.invalid');
  await git(root, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'staged.txt'), 'base preparada\n');
  await fs.writeFile(path.join(root, 'working.txt'), 'base local\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base descartável da revisão');
  return { root, temp };
}

test('revisão inclui alterações preparadas e locais sem alterar index ou arquivos', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'staged.txt'), 'mudança no index\n');
  await git(root, 'add', 'staged.txt');
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança só na pasta\n');
  const before = {
    staged: await git(root, 'diff', '--cached', '--binary'),
    working: await git(root, 'diff', '--binary'),
    status: await git(root, 'status', '--porcelain=v1'),
    head: await git(root, 'rev-parse', 'HEAD'),
  };
  const result = await captureReview(root);
  assert.match(result.diff, /\+mudança no index/);
  assert.match(result.diff, /\+mudança só na pasta/);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal(path.resolve(result.cwd), root);
  assert.equal(result.note, '');
  assert.equal(await git(root, 'diff', '--cached', '--binary'), before.staged);
  assert.equal(await git(root, 'diff', '--binary'), before.working);
  assert.equal(await git(root, 'status', '--porcelain=v1'), before.status);
  assert.equal(await git(root, 'rev-parse', 'HEAD'), before.head);
  assert.equal(await fs.readFile(path.join(root, 'staged.txt'), 'utf8'), 'mudança no index\n');
  assert.equal(await fs.readFile(path.join(root, 'working.txt'), 'utf8'), 'mudança só na pasta\n');
});

test('hash é estável na mesma revisão e muda quando o código muda', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'working.txt'), 'versão A\n');
  const first = await captureReview(root);
  const unchanged = await captureReview(root);
  assert.equal(unchanged.hash, first.hash);
  await fs.writeFile(path.join(root, 'working.txt'), 'versão B\n');
  const changed = await captureReview(root);
  assert.notEqual(changed.hash, first.hash);
  assert.match(first.diff, /\+versão A/);
  assert.match(changed.diff, /\+versão B/);
});

test('arquivo não rastreado aparece no aviso mas seu conteúdo não entra na revisão', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança revisável\n');
  await fs.writeFile(path.join(root, 'novo.txt'), 'CONTEUDO_NOVO_NAO_DEVE_SAIR_93753');
  const result = await captureReview(root);
  assert.match(result.note, /NÃO incluídos/);
  assert.match(result.note, /novo\.txt/);
  assert.match(result.files, /\?\? novo\.txt/);
  assert.doesNotMatch(JSON.stringify(result), /CONTEUDO_NOVO_NAO_DEVE_SAIR_93753/);
  assert.equal(await fs.readFile(path.join(root, 'novo.txt'), 'utf8'), 'CONTEUDO_NOVO_NAO_DEVE_SAIR_93753');
});

test('repositório apenas com arquivos não rastreados não simula revisão vazia', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'novo.txt'), 'arquivo ainda fora do Git');
  await assert.rejects(captureReview(root), /Só há arquivos novos fora do Git/);
  assert.equal(await git(root, 'diff', '--cached'), '');
});

test('pasta relativa, inexistente, arquivo e pasta sem Git são recusados', async t => {
  const { root, temp } = await repository(t);
  await assert.rejects(captureReview('.'), /pasta local válida/);
  await assert.rejects(captureReview(path.join(temp, 'não-existe')));
  await assert.rejects(captureReview(path.join(root, 'working.txt')), /pasta local válida/);
  const nonRepo = path.join(temp, 'sem Git'); await fs.mkdir(nonRepo);
  // Os descartáveis ficam dentro do checkout do Cockpit: limitar a busca de
  // ancestrais só neste processo de teste evita achar o repositório hospedeiro.
  const ceilingBefore = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = temp;
  // leva 41: a mensagem deixou de ser generica ("nao foi possivel ler as alteracoes")
  try { await assert.rejects(captureReview(nonRepo), /não é um repositório git/); }
  finally { if (ceilingBefore === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceilingBefore; }
  await assert.rejects(captureReview(root), /Não há alterações/);
});

/* ---------------- leva 41 (A5): impressão digital estável ---------------- */

test('git add sem mudar conteúdo não muda a impressão digital', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança\n');
  const antes = await captureReview(root);
  await git(root, 'add', 'working.txt');
  const depois = await captureReview(root);
  assert.equal(depois.hash, antes.hash);
});

test('mesmo diff em outro commit (HEAD diferente) muda a impressão digital', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'outro.txt'), 'x\n'); await git(root, 'add', 'outro.txt'); await git(root, 'commit', '-m', 'segundo');
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança igual\n');
  const noRamo = await captureReview(root);
  // working.txt e' igual nos dois commits: o checkout leva a mudanca junto
  await git(root, 'checkout', '-q', 'HEAD~1');
  const noPai = await captureReview(root);
  assert.equal(noPai.diff, noRamo.diff);
  assert.notEqual(noPai.hash, noRamo.hash);
});

test('45 arquivos novos: aviso lista 30 e diz "e mais 15"', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança\n');
  for (let i = 0; i < 45; i++) await fs.writeFile(path.join(root, 'novo-' + String(i).padStart(2, '0') + '.txt'), 'n');
  const r = await captureReview(root);
  assert.match(r.note, /novo-29\.txt/);
  assert.doesNotMatch(r.note, /novo-30\.txt/);
  assert.match(r.note, /e mais 15/);
});

test('arquivo novo entra na impressão pelo nome (ordenado), não pelo conteúdo', async t => {
  const { root } = await repository(t);
  await fs.writeFile(path.join(root, 'working.txt'), 'mudança\n');
  const semNovo = await captureReview(root);
  await fs.writeFile(path.join(root, 'b.txt'), '1');
  const comNovo = await captureReview(root);
  assert.notEqual(comNovo.hash, semNovo.hash);
  await fs.writeFile(path.join(root, 'b.txt'), 'conteúdo diferente');
  assert.equal((await captureReview(root)).hash, comNovo.hash);
});

test('repositório sem nenhum commit tem mensagem própria', async t => {
  await fs.mkdir(artifacts, { recursive: true });
  const temp = await fs.mkdtemp(path.join(artifacts, 'review-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true, maxRetries: 3 }));
  await git(temp, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(temp, 'a.txt'), 'a');
  await assert.rejects(captureReview(temp), /ainda não tem nenhum commit/);
});

test('diff excessivo é recusado sem truncar nem alterar o trabalho original', async t => {
  const { root } = await repository(t);
  const large = 'linha longa para teste '.repeat(7000) + '\n';
  await fs.writeFile(path.join(root, 'working.txt'), large);
  const before = await git(root, 'diff', '--cached');
  await assert.rejects(captureReview(root), /grandes demais/);
  assert.equal(await fs.readFile(path.join(root, 'working.txt'), 'utf8'), large);
  assert.equal(await git(root, 'diff', '--cached'), before);
});
