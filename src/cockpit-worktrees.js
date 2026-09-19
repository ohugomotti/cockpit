'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

// Nenhuma chamada passa pelo shell. Git tambem protege branches ja abertas;
// nao usamos --force, checkout, reset, clean, merge ou worktree remove.
function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], {
      windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 1200)));
      else resolve(stdout);
    });
  });
}

function pathKey(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseWorktrees(output) {
  const items = [];
  let item;
  for (const token of String(output).split('\0')) {
    if (token.startsWith('worktree ')) {
      item = { path: token.slice(9), branch: '', head: '', detached: false, locked: false, prunable: false, bare: false };
      items.push(item);
    } else if (item && token.startsWith('HEAD ')) item.head = token.slice(5);
    else if (item && token.startsWith('branch ')) item.branch = token.slice(7).replace(/^refs\/heads\//, '');
    else if (item && token === 'detached') item.detached = true;
    else if (item && token === 'bare') item.bare = true;
    else if (item && /^locked(?: |$)/.test(token)) item.locked = true;
    else if (item && /^prunable(?: |$)/.test(token)) item.prunable = true;
  }
  return items;
}

async function list({ cwd } = {}) {
  if (typeof cwd !== 'string' || !cwd || /[\0\r\n]/.test(cwd)) throw new Error('Informe uma pasta Git local válida.');
  const currentPath = await fs.realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  const items = parseWorktrees(await git(currentPath, ['worktree', 'list', '--porcelain', '-z']));
  if (!items.length || items[0].bare) throw new Error('Abra um repositório Git com uma pasta principal de trabalho.');
  const root = await fs.realpath(items[0].path);
  return { root, currentPath, items: items.map((item, index) => ({
    ...item, root, path: path.resolve(item.path), isMain: index === 0,
    isCurrent: pathKey(item.path) === pathKey(currentPath),
  })) };
}

async function open({ cwd, path: target } = {}) {
  if (typeof target !== 'string' || !target || /[\0\r\n]/.test(target)) throw new Error('Escolha uma pasta isolada existente.');
  const catalog = await list({ cwd });
  const realTarget = await fs.realpath(target);
  const item = catalog.items.find((candidate) => pathKey(candidate.path) === pathKey(realTarget));
  if (!item || item.prunable) throw new Error('Esta pasta não é uma worktree disponível deste repositório.');
  // Uma pasta removida e recriada por fora pode conservar registro velho no Git.
  // A leitura no destino comprova que ele ainda pertence ao mesmo repositório.
  const verified = await list({ cwd: realTarget });
  if (pathKey(verified.root) !== pathKey(catalog.root) || pathKey(verified.currentPath) !== pathKey(realTarget)) {
    throw new Error('O vínculo Git desta pasta mudou. Atualize a lista.');
  }
  return { root: catalog.root, path: realTarget, branch: item.branch, isMain: item.isMain };
}

function validateName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
      || name.includes('..') || /\.$|\.lock$/i.test(name)) {
    throw new Error('Use de 1 a 64 letras, números, hífen, ponto ou sublinhado; comece com letra ou número.');
  }
  return name;
}

async function create({ cwd, name } = {}, { baseDir } = {}) {
  const clean = validateName(name);
  if (typeof baseDir !== 'string' || !path.isAbsolute(baseDir)) throw new Error('A pasta de worktrees do Cockpit não foi configurada.');
  const catalog = await list({ cwd });
  // Aponta ao HEAD da pasta escolhida, nunca copia nem faz stash dos arquivos
  // sujos do usuario. Repositorio sem primeiro commit recebe o erro do Git.
  const head = (await git(catalog.currentPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const branch = 'cockpit/' + clean;
  await git(catalog.currentPath, ['check-ref-format', '--branch', branch]);
  const repoId = path.basename(catalog.root).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
    + '-' + crypto.createHash('sha256').update(pathKey(catalog.root)).digest('hex').slice(0, 10);
  await fs.mkdir(baseDir, { recursive: true });
  const realBase = await fs.realpath(baseDir);
  if (pathKey(realBase) !== pathKey(baseDir)) throw new Error('A pasta de worktrees do Cockpit foi redirecionada. Confira o local configurado.');
  const repoDir = path.join(realBase, repoId);
  await fs.mkdir(repoDir, { recursive: true });
  // Nao aceitar uma junction/symlink colocada no diretorio reservado ao repo.
  if (pathKey(await fs.realpath(repoDir)) !== pathKey(repoDir)) throw new Error('A pasta reservada às worktrees foi redirecionada. Escolha outro local.');
  const target = path.join(repoDir, clean);
  try { await fs.lstat(target); throw new Error('Já existe uma pasta com esse nome. Abra a existente ou escolha outro nome.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await git(catalog.currentPath, ['worktree', 'add', '-b', branch, '--', target, head]);
  return await open({ cwd: catalog.root, path: target });
}

module.exports = { list, open, create, parseWorktrees, validateName };
