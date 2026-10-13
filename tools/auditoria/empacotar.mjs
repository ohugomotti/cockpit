// Incremento verificado sobre o app instalado. Nunca grava em Programs/Cockpit.
// Uso: node tools/auditoria/empacotar.mjs [--baseline=<sha256 do app.asar instalado>] [--novos=a,b,c]
// Sem --baseline, vale o hash do app.asar instalado, lido na hora. --novos declara arquivos novos do src/ (somam-se à lista fixa).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'src');
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/Cockpit/resources/app.asar');
const allowedNew = new Set([
  'engine-updates.js',
  'model-benchmarks.js',
  'renderer/model-presentation.js',
  'cockpit-capabilities.js', 'cockpit-history.js', 'cockpit-interactions.js', 'cockpit-experiments.js', 'cockpit-live.js', 'cockpit-media.js',
  'cockpit-ipc-security.js', 'cockpit-session-scan.js', 'cockpit-search.js', 'cockpit-remote-host.js',
  'claude-sessions-scan.js', 'sessions-list.js', 'renderer/historico-lista.js',
  'renderer/history-pager.js', 'renderer/history-pager.css', 'renderer/connector-prompts.js', 'renderer/connector-prompts.css', 'renderer/live-voice.js', 'renderer/experiments.js', 'renderer/experiments.css',
  'visual-mac-native.js', 'renderer/visual-mac.css', 'renderer/visual-mac.js',
  'renderer/conversation-work.js',
  'renderer/file-links.js',
  'reader-comments.js', 'renderer/reader-tools.js', 'renderer/reader-tools.css',
  'navegador-interno.js',
  'renderer/acp-presets.js',
  'renderer/assets/motti/InterVariable.woff2', 'renderer/assets/motti/OFL-Inter.txt',
]);
const ignoredSource = new Set(['package-lock.json','renderer/assets/motti/avatar-640.png']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const relativeEntry = entry => entry.replace(/^[/\\]/, '').replaceAll('\\', '/');
function files(directory, prefix='') {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Link inesperado: ' + path.join(directory,entry.name));
    const relative=prefix+entry.name;
    return entry.isDirectory() ? files(path.join(directory,entry.name),relative+'/') : [relative];
  });
}
const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
const asarPath=fs.readdirSync(cache).map(entry=>path.join(cache,entry,'node_modules/@electron/asar/lib/asar.js')).find(file=>fs.existsSync(file));
if (!asarPath) throw new Error('@electron/asar não encontrado no cache local.');
const asar=await import(pathToFileURL(asarPath).href);
const options={};
for(const argument of process.argv.slice(2)){
  const found=/^--(baseline|novos)=(.*)$/.exec(argument);
  if(!found)throw new Error('Argumento inválido: '+argument+' (use --baseline=<sha256> e --novos=a,b,c).');
  options[found[1]]=found[2];
}
const declaredNew=(options.novos??'').split(',').map(name=>name.trim().replaceAll('\\','/')).filter(Boolean);
const installedHash=hash(fs.readFileSync(installed));
const baselineHash=(options.baseline??installedHash).toUpperCase();
if(installedHash!==baselineHash)throw new Error('A instalação mudou desde o início da auditoria; compare e integre antes de empacotar.');
const previous=asar.listPackage(installed).map(entry=>({native:entry.replace(/^[/\\]/,''),relative:relativeEntry(entry)}));
const previousNames=new Set(previous.map(entry=>entry.relative));
const changedFiles=[];
for (const entry of previous) {
  if (entry.relative.startsWith('node_modules/') || asar.statFile(installed,entry.native).files) continue;
  const local=path.join(source,entry.relative);
  if (!fs.existsSync(local)) throw new Error('Arquivo instalado ausente na fonte: '+entry.relative);
  if(hash(fs.readFileSync(local))!==hash(asar.extractFile(installed,entry.native)))changedFiles.push(entry.relative);
}
const addedFiles=files(source).filter(file=>!file.startsWith('node_modules/')&&!previousNames.has(file)&&!ignoredSource.has(file));
const unexpected=addedFiles.filter(file=>!allowedNew.has(file)&&!declaredNew.includes(file));
if(unexpected.length)throw new Error('Declare explicitamente os arquivos novos antes de empacotar: '+unexpected.join(', ')+' (use --novos=a,b,c).');
if(!changedFiles.length&&!addedFiles.length)throw new Error('Nada mudou na fonte.');
const sourceFiles=[...previous.filter(entry=>!entry.relative.startsWith('node_modules/')&&!asar.statFile(installed,entry.native).files).map(entry=>entry.relative),...addedFiles].sort();
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(path.join(source,file)))]));
const build=path.join(root,'artifacts','multiagentes-'+Date.now());
const staging=path.join(build,'source');
const output=path.join(build,'app.asar');
fs.mkdirSync(build,{recursive:true});
asar.extractAll(installed,staging);
for(const relative of [...changedFiles,...addedFiles]){
  const destination=path.join(staging,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(path.join(source,relative),destination);
}
await asar.createPackageWithOptions(staging,output,{unpackDir:'node_modules/@lydell/node-pty'});
const finalEntries=asar.listPackage(output).map(entry=>({native:entry.replace(/^[/\\]/,''),relative:relativeEntry(entry)}));
const finalNames=new Set(finalEntries.map(entry=>entry.relative));
const removed=[...previousNames].filter(file=>!finalNames.has(file));
const actualAdded=[...finalNames].filter(file=>!previousNames.has(file)).sort();
if(removed.length||JSON.stringify(actualAdded)!==JSON.stringify([...addedFiles].sort()))throw new Error('Entradas do pacote divergentes: '+JSON.stringify({removed,actualAdded}));
const updated=new Set([...changedFiles,...addedFiles]);
let filesVerified=0;
for(const entry of finalEntries){
  if(asar.statFile(output,entry.native).files)continue;
  const expected=updated.has(entry.relative)?fs.readFileSync(path.join(source,entry.relative)):asar.extractFile(installed,entry.native);
  if(hash(expected)!==hash(asar.extractFile(output,entry.native)))throw new Error('Conteúdo divergente: '+entry.relative);
  filesVerified++;
}
const nativeFiles=files(installed+'.unpacked');
for(const relative of nativeFiles){
  const destination=path.join(output+'.unpacked',relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if(!fs.existsSync(destination))fs.copyFileSync(path.join(installed+'.unpacked',relative),destination);
  if(hash(fs.readFileSync(destination))!==hash(fs.readFileSync(path.join(installed+'.unpacked',relative))))throw new Error('Binário nativo divergente: '+relative);
}
if(hash(fs.readFileSync(installed))!==baselineHash)throw new Error('A instalação mudou durante o empacotamento.');
for(const [file,expectedHash] of Object.entries(sourceHashes)){
  const entry=finalEntries.find(entry=>entry.relative===file);
  if(hash(fs.readFileSync(path.join(source,file)))!==expectedHash || hash(asar.extractFile(output,entry.native))!==expectedHash)throw new Error('A fonte mudou durante o empacotamento: '+file);
}
const manifest={status:'verified',createdAt:new Date().toISOString(),workspace:root,baselineHash,package:output,packageHash:hash(fs.readFileSync(output)),changedFiles,addedFiles,sourceHashes,filesVerified,nativeFilesVerified:nativeFiles.length,installedModified:false,origem:'tools/auditoria/empacotar.mjs'};
fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'artifacts/multiagentes-package.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
