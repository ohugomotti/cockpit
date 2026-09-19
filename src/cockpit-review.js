'use strict';
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const MAX_NOVOS = 30;
function git(cwd, args) {
  return new Promise((resolve, reject) => execFile('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
    (err, out, errOut) => {
      if (!err) return resolve(out);
      const e = new Error('Não foi possível ler as alterações do Git. Verifique a pasta e o tamanho da revisão.');
      e.gitStderr = String(errOut || ''); reject(e);
    }));
}
async function captureReview(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('Escolha uma pasta local válida.');
  let root;
  try { root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim(); }
  catch (e) { throw /not a git repository|não é um repositório/i.test(e.gitStderr || '') ? new Error('Esta pasta não é um repositório git: não há alterações para revisar.') : e; }
  let head;
  try { head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(); }
  catch { throw new Error('O repositório ainda não tem nenhum commit. Faça o primeiro commit antes de revisar as alterações.'); }
  const [diff, status] = await Promise.all([git(root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=4', 'HEAD', '--', '.']), git(root, ['status', '--porcelain=v1', '--untracked-files=all'])]);
  if (diff.length > 120000) throw new Error('As mudanças são grandes demais para esta revisão. Separe uma parte em outra branch.');
  const untracked = status.split('\n').filter(l => l.startsWith('?? ')).map(l => l.slice(3)).sort();
  const note = untracked.length ? 'Arquivos novos ainda fora do Git NÃO incluídos no conteúdo desta revisão: ' + untracked.slice(0, MAX_NOVOS).join(', ')
    + (untracked.length > MAX_NOVOS ? ' e mais ' + (untracked.length - MAX_NOVOS) : '') : '';
  if (!diff.trim()) throw new Error(untracked.length ? 'Só há arquivos novos fora do Git. Adicione os arquivos desejados ao Git antes de revisar aqui.' : 'Não há alterações em arquivos acompanhados pelo Git para revisar.');
  /* impressao digital = commit de base + diff + NOMES dos arquivos novos. Os
     codigos do "git status" ficaram de fora (um "git add" sem mudar nada virava
     "o codigo mudou") e o HEAD entrou (trocar de branch com o mesmo diff passava
     como igual). */
  const hash = crypto.createHash('sha256').update(head + '\n' + diff + '\n' + untracked.join('\n')).digest('hex');
  return { cwd: root, head, hash, diff, note, files: status.slice(0, 4000), at: new Date().toISOString() };
}
module.exports = { captureReview };
