'use strict';
// Prova de carregamento do módulo nativo, sem usar main.js nem motores de IA.
const { app } = require('electron');
const fs = require('original-fs'); // Hash do arquivo ASAR físico, sem tratá-lo como pasta virtual.
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, 'artifacts/native-qa-profile'));
app.whenReady().then(async () => {
  const manifestArg = process.argv.find(argument => argument.startsWith('--manifest='));
  if (!manifestArg) throw new Error('Informe --manifest=<manifest.json da compilação específica>.');
  const manifestPath = fs.realpathSync(manifestArg.slice('--manifest='.length));
  const buildRoot = path.dirname(manifestPath);
  if (path.dirname(buildRoot) !== fs.realpathSync(path.join(root, 'artifacts')) || !path.basename(buildRoot).startsWith('package-')) throw new Error('Manifesto fora de uma compilação deste worktree.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const packagePath = fs.realpathSync(manifest.package);
  const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  if (manifest.status !== 'verified' || path.dirname(packagePath) !== buildRoot || path.basename(packagePath) !== 'app.asar' || !fs.statSync(packagePath).isFile() || hashFile(packagePath) !== manifest.packageHash) throw new Error('Pacote divergente ou compilação não verificada.');
  if (!Array.isArray(manifest.nativeFiles) || !manifest.nativeFiles.length) throw new Error('Manifesto não registra arquivos nativos.');
  const nativeRoot = packagePath + '.unpacked';
  if(fs.lstatSync(nativeRoot).isSymbolicLink())throw new Error('Diretório nativo não pode ser um link.');
  function nativeFiles(directory, prefix='') {
    return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
      const relative=path.join(prefix,entry.name);
      if(entry.isSymbolicLink()||fs.lstatSync(path.join(directory,entry.name)).isSymbolicLink())throw new Error('Link inesperado no diretório nativo: '+relative);
      return entry.isDirectory()?nativeFiles(path.join(directory,entry.name),relative):[relative];
    });
  }
  const actualNames=nativeFiles(nativeRoot).sort();
  const expectedNames=manifest.nativeFiles.map(entry=>entry.relative).sort();
  if(JSON.stringify(actualNames)!==JSON.stringify(expectedNames))throw new Error('Há arquivos nativos ausentes ou extras em relação à compilação.');
  for (const entry of manifest.nativeFiles) {
    const nativeFile = fs.realpathSync(path.resolve(nativeRoot, entry.relative));
    if (!nativeFile.startsWith(fs.realpathSync(nativeRoot) + path.sep) || hashFile(nativeFile) !== entry.sha256) throw new Error('Arquivo nativo divergente: ' + entry.relative);
  }
  // Require através do ASAR verifica também a referência ao diretório unpacked.
  const pty = require(packagePath + '/node_modules/@lydell/node-pty');
  const temporary = path.join(buildRoot, 'native-probe-home');
  fs.mkdirSync(temporary, { recursive: true });
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const env = { SystemRoot:windows, WINDIR:windows, PATH:path.join(windows,'System32'), TEMP:temporary, TMP:temporary, HOME:temporary, USERPROFILE:temporary, CODEX_HOME:path.join(temporary,'.codex'), CLAUDE_CONFIG_DIR:path.join(temporary,'.claude') };
  const term = pty.spawn(path.join(windows,'System32/cmd.exe'), ['/d', '/c', 'echo COCKPIT_NATIVE_QA_OK'], {
    cwd: temporary, env, cols: 80, rows: 24,
  });
  const result = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { term.kill(); reject(new Error('PTY de teste excedeu 10 segundos.')); }, 10000);
    term.onData(data => { output += data; });
    term.onExit(event => { clearTimeout(timer); resolve({ exitCode: event.exitCode, output }); });
  });
  if (result.exitCode !== 0 || !result.output.includes('COCKPIT_NATIVE_QA_OK')) throw new Error('PTY empacotado não completou o comando de teste.');
  const report = { status:'passed',createdAt:new Date().toISOString(),manifest:manifestPath, package: packagePath, packageHash:manifest.packageHash, module: '@lydell/node-pty', runtime: process.versions.electron, ...result, productionMainLoaded: false };
  fs.writeFileSync(path.join(root, 'artifacts/native-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
