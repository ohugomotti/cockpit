'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const PORT = 4319;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const workspaceHash = digest(fs.realpathSync(ROOT).replace(/\\/g, '/').toLowerCase());
function identity() {
  const hash = crypto.createHash('sha256');
  function rendererFiles(directory) {
    return fs.readdirSync(path.join(ROOT,directory),{withFileTypes:true}).flatMap(entry=>{
      const file=directory+'/'+entry.name;
      if(entry.isSymbolicLink())throw new Error('Link inesperado no renderer QA: '+file);
      return entry.isDirectory()?rendererFiles(file):[file];
    });
  }
  const files=[...rendererFiles('src/renderer'),'tools/redesenho/mock-api.js','tools/redesenho/fixtures.js','tools/redesenho/qa-environment.cjs','tools/redesenho/server.js'].sort();
  for (const file of files) {
    hash.update(file + '\0'); hash.update(fs.readFileSync(path.join(ROOT,file)));
  }
  return { protocol: 'cockpit-qa-v2', workspaceHash, sourceHash: hash.digest('hex'), processId: process.pid, port: PORT };
}
async function verifyServer() {
  const response = await fetch(ORIGIN + '/__qa/identity', { signal: AbortSignal.timeout(3000) });
  if (!response.ok || response.headers.get('x-cockpit-qa') !== 'simulado-sem-motores') throw new Error('A porta QA não pertence a uma prévia válida.');
  const actual = await response.json(), expected = identity();
  if (actual.protocol !== expected.protocol || actual.workspaceHash !== expected.workspaceHash || actual.sourceHash !== expected.sourceHash) throw new Error('A prévia pertence a outro worktree ou versão. Reinicie somente o servidor desta prévia.');
  return actual;
}
module.exports = { ROOT, PORT, ORIGIN, identity, verifyServer };
