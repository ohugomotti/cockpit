// Gera um pacote revisável; nunca grava na instalação em uso.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/package-manifest.json'), JSON.stringify({ status: 'building', startedAt: new Date().toISOString() }) + '\n');
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/Cockpit/resources');
const baseline = path.join(installed, 'app.asar');
const expected = '6F382680F2837206D4A7FF2622421547206C375C4FA68B6C1DEBEBE403A395E2';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hashFile = file => hash(fs.readFileSync(file));
if (hashFile(baseline) !== expected) throw new Error('O Cockpit instalado mudou. Reavaliar o baseline antes de empacotar.');
const installedNative = path.join(installed, 'app.asar.unpacked');
const baselineNative = filesUnder(installedNative).sort().map(relative => {
  const data = fs.readFileSync(path.join(installedNative, relative));
  return { relative, data, sha256: hash(data) };
});

const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx');
const asarDirectory = fs.readdirSync(cache).map(name => path.join(cache, name, 'node_modules/@electron/asar'))
  .find(dir => fs.existsSync(path.join(dir, 'package.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version === '4.3.0');
if (!asarDirectory) throw new Error('Empacotador local asar 4.3.0 ausente. Nenhuma instalação foi iniciada.');
const asar = await import(pathToFileURL(path.join(asarDirectory, 'lib/asar.js')).href);
const listSources = () => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
const sourcePaths = listSources();
const snapshot = sourcePaths.map(entry => {
  if (!entry.startsWith('src/') || entry.includes('/node_modules/') || entry.split('/').includes('..')) throw new Error('Fonte inesperado: ' + entry);
  const file = path.join(root, entry);
  if (!fs.statSync(file).isFile()) throw new Error('Fonte não é arquivo: ' + entry);
  const data = fs.readFileSync(file);
  return { entry, relative: entry.slice(4), data, sha256: hash(data) };
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const buildRoot = path.join(root, 'artifacts', 'package-' + stamp);
fs.mkdirSync(buildRoot); // Recusa reutilizar e sobrescrever uma compilação existente.
const staging = path.join(buildRoot, 'source');
const output = path.join(buildRoot, 'app.asar');
asar.extractAll(baseline, staging);
for (const file of snapshot) {
  const destination = path.join(staging, file.relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.data);
}
await asar.createPackageWithOptions(staging, output, { unpackDir: 'node_modules/@lydell/node-pty' });
for (const file of snapshot) {
  if (hash(asar.extractFile(output, path.normalize(file.relative))) !== file.sha256) throw new Error('Conteúdo empacotado divergente: ' + file.entry);
  if (hashFile(path.join(root, file.entry)) !== file.sha256) throw new Error('Fonte mudou durante compilação: ' + file.entry);
}
function filesUnder(directory, prefix = '') {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Diretório nativo inválido: ' + directory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Link inesperado no pacote nativo: ' + relative);
    if (!entry.isDirectory() && !entry.isFile()) throw new Error('Item nativo inesperado: ' + relative);
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), relative) : [relative];
  });
}
const nativeRoot = output + '.unpacked';
// Preserva também arquivos antigos do diretório nativo sem acrescentá-los ao
// cabeçalho do ASAR. Os arquivos gerados pelo pack jamais são sobrescritos.
for (const file of baselineNative) {
  const destination = path.join(nativeRoot, file.relative);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.data, { flag: 'wx' });
  }
}
const nativeFiles = filesUnder(nativeRoot).sort();
const expectedNative = baselineNative.map(file => file.relative);
if (JSON.stringify(nativeFiles) !== JSON.stringify(expectedNative)) throw new Error('Conjunto de arquivos nativos difere da instalação.');
if (JSON.stringify(filesUnder(installedNative).sort()) !== JSON.stringify(expectedNative)) throw new Error('Árvore nativa instalada mudou durante compilação.');
for (const file of baselineNative) {
  if (hashFile(path.join(nativeRoot, file.relative)) !== file.sha256) throw new Error('Arquivo nativo divergente: ' + file.relative);
  if (hashFile(path.join(installedNative, file.relative)) !== file.sha256) throw new Error('Arquivo nativo instalado mudou durante compilação: ' + file.relative);
}
if (hashFile(baseline) !== expected) throw new Error('Instalação mudou durante a compilação.');
if (JSON.stringify(listSources()) !== JSON.stringify(sourcePaths)) throw new Error('Lista de fontes mudou durante a compilação.');
const manifest = {
  status: 'verified',
  createdAt: new Date().toISOString(), workspace: root,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  baselineHash: expected, package: output, packageHash: hashFile(output),
  asarVersion: '4.3.0', sourceFiles: snapshot.map(({ entry, sha256 }) => ({ entry, sha256 })),
  nativeFilesVerified: nativeFiles.length, nativeFiles: nativeFiles.map(relative => ({ relative, sha256: hashFile(path.join(nativeRoot, relative)) })), installedModified: false,
};
fs.writeFileSync(path.join(buildRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'artifacts/package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ manifest: path.join(buildRoot, 'manifest.json'), package: output, sha256: manifest.packageHash, sourcesVerified: snapshot.length, nativeFilesVerified: nativeFiles.length, installedModified: false }, null, 2));
