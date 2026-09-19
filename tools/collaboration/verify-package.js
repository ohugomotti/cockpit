'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
async function main() {
  const root = path.resolve(__dirname, '../..');
  const manifestFile = path.join(root, 'artifacts/package-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx'); let library;
  for (const folder of fs.readdirSync(cache)) {
    const p = path.join(cache, folder, 'node_modules/@electron/asar');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
      const entry = typeof pkg.exports === 'string' ? pkg.exports : pkg.main;
      if (pkg.version === '4.3.0' && entry && fs.existsSync(path.join(p, entry))) { library = path.join(p, entry); break; }
    } catch {}
  }
  if (!library) throw new Error('Empacotador revisado não encontrado.');
  const imported = await import(pathToFileURL(library)); const asar = imported.default || imported;
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
  const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
  for (const file of files) {
    if (hash(fs.readFileSync(path.join(root, file))) !== hash(asar.extractFile(manifest.package, path.normalize(file.slice(4))))) throw new Error('Conteúdo diferente no pacote: ' + file);
  }
  if (hash(fs.readFileSync(manifest.package)) !== manifest.packageHash) throw new Error('Hash do pacote diferente.');
  const report = { sourceFiles: files.length, packageHash: manifest.packageHash, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), passed: true, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'artifacts/package-content-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
