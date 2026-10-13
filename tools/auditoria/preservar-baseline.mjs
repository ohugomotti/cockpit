// Desfaz somente conversões automáticas CRLF de arquivos semanticamente intactos.
// Arquivos alterados pelos agentes e a instalação em uso nunca são sobrescritos.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const installed=path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
if(sha(fs.readFileSync(installed))!=='F50EA862206E558B4441BED83007404355738A72215F47A69BAA50A252FBEF17')throw Error('Instalação mudou.');
const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
const asarPath=fs.readdirSync(cache).map(e=>path.join(cache,e,'node_modules/@electron/asar/lib/asar.js')).find(f=>fs.existsSync(f));
const asar=await import(pathToFileURL(asarPath).href);
const restored=[];
for(const entry of asar.listPackage(installed)){
  const native=entry.replace(/^[/\\]/,''),relative=native.replaceAll('\\','/');
  if(relative.startsWith('node_modules/')||asar.statFile(installed,native).files)continue;
  const file=path.join(root,'src',relative);
  if(!fs.existsSync(file))throw Error('Fonte ausente: '+relative);
  const source=fs.readFileSync(file),baseline=asar.extractFile(installed,native);
  if(source.equals(baseline)||source.includes(0)||baseline.includes(0))continue;
  if(source.toString('utf8').replace(/\r\n/g,'\n')===baseline.toString('utf8').replace(/\r\n/g,'\n')){
    fs.writeFileSync(file,baseline);restored.push(relative);
  }
}
fs.writeFileSync(path.join(root,'artifacts/auditoria/eol-baseline.json'),JSON.stringify({restored,installedModified:false},null,2));
console.log(JSON.stringify({restored:restored.length,installedModified:false}));
