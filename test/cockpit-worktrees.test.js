'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const worktrees = require('../src/cockpit-worktrees');
const artifacts = path.resolve(__dirname, '..', 'artifacts');
const git = async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], { windowsHide: true })).stdout;

async function repository(t) {
  await fs.mkdir(artifacts, { recursive: true });
  const temp = await fs.mkdtemp(path.join(artifacts, 'worktrees-test-'));
  t.after(async () => {
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), artifacts, 'a limpeza só alcança a pasta descartável deste teste');
    assert.ok(path.basename(resolved).startsWith('worktrees-test-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = path.join(temp, 'projeto com espaço');
  await fs.mkdir(root);
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.name', 'Teste local Cockpit');
  await git(root, 'config', 'user.email', 'teste@example.invalid');
  await git(root, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'arquivo.txt'), 'original\n');
  await git(root, 'add', 'arquivo.txt');
  await git(root, 'commit', '-m', 'base descartável');
  return { root, baseDir: path.join(temp, 'pastas isoladas'), temp };
}

test('criação Git real preserva index, alterações locais e arquivos não rastreados', async (t) => {
  const { root, baseDir } = await repository(t);
  await fs.writeFile(path.join(root, 'arquivo.txt'), 'alteração preparada\n');
  await git(root, 'add', 'arquivo.txt');
  await fs.writeFile(path.join(root, 'arquivo.txt'), 'alteração ainda não preparada\n');
  await fs.writeFile(path.join(root, 'rascunho.txt'), 'rascunho do usuário');
  const before = await git(root, 'status', '--porcelain=v1');
  const staged = await git(root, 'diff', '--cached');
  const created = await worktrees.create({ cwd: root, name: 'revisao-um' }, { baseDir });
  assert.equal(created.branch, 'cockpit/revisao-um');
  assert.equal(created.isMain, false);
  assert.equal(await fs.readFile(path.join(created.path, 'arquivo.txt'), 'utf8'), 'original\n');
  assert.equal(await fs.readFile(path.join(root, 'rascunho.txt'), 'utf8'), 'rascunho do usuário');
  assert.equal(await git(root, 'status', '--porcelain=v1'), before);
  assert.equal(await git(root, 'diff', '--cached'), staged);
  assert.equal(await git(root, 'branch', '--show-current'), 'main\n');
  const listed = await worktrees.list({ cwd: created.path });
  assert.equal(listed.items.length, 2);
  assert.equal(listed.items.filter((entry) => entry.isCurrent)[0].branch, created.branch);
  assert.equal((await worktrees.open({ cwd: created.path, path: root })).isMain, true);
});

test('abre worktree Git preexistente, inclusive detached, sem criar ou alterar', async (t) => {
  const { root, temp } = await repository(t);
  const existing = path.join(temp, 'isolada externa');
  await git(root, 'worktree', 'add', '--detach', '--', existing, 'HEAD');
  const listed = await worktrees.list({ cwd: root });
  assert.equal(listed.items.find((entry) => entry.detached).path, existing);
  const opened = await worktrees.open({ cwd: root, path: existing });
  assert.equal(opened.branch, '');
  assert.equal(opened.path, existing);
});

test('recusa nomes que poderiam escapar de caminho ou introduzir comandos', async (t) => {
  const { root, baseDir } = await repository(t);
  for (const name of ['../fora', '-b-outra', 'x;echo', 'x$(echo)', 'x y', 'x/y', 'x\\y', 'a..b', 'x.lock', 'x\n']) {
    await assert.rejects(worktrees.create({ cwd: root, name }, { baseDir }), /Use de 1 a 64/);
  }
  assert.equal((await worktrees.list({ cwd: root })).items.length, 1);
});

test('recusa destino que pertence a outro repositório', async (t) => {
  const a = await repository(t);
  const b = await repository(t);
  await assert.rejects(worktrees.open({ cwd: a.root, path: b.root }), /não é uma worktree/);
});

test('criação repetida falha preservando arquivos da worktree existente', async (t) => {
  const { root, baseDir } = await repository(t);
  const created = await worktrees.create({ cwd: root, name: 'mesmo' }, { baseDir });
  await fs.writeFile(path.join(created.path, 'arquivo.txt'), 'trabalho em curso');
  await assert.rejects(worktrees.create({ cwd: root, name: 'mesmo' }, { baseDir }), /Já existe uma pasta/);
  assert.equal(await fs.readFile(path.join(created.path, 'arquivo.txt'), 'utf8'), 'trabalho em curso');
  assert.equal((await worktrees.list({ cwd: root })).items.length, 2);
});

test('não cria worktree em repositório sem primeiro commit', async (t) => {
  const { temp, baseDir } = await repository(t);
  const empty = path.join(temp, 'vazio');
  await fs.mkdir(empty);
  await git(empty, 'init', '--initial-branch=main');
  await assert.rejects(worktrees.create({ cwd: empty, name: 'tentativa' }, { baseDir }));
  assert.equal((await worktrees.list({ cwd: empty })).items.length, 1);
});
