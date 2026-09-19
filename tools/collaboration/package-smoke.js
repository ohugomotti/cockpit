'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect } = require('./cdp');
async function main() {
  const c = await connect(); const root = path.resolve(__dirname, '../..');
  try {
    const profile = await c.evaluate(`(async () => ({url:location.href,config:await window.api.getConfig(),theme:document.documentElement.dataset.tema}))()`);
    assert.ok(profile.url.includes('/resources/app.asar/'), 'Não é o pacote ASAR real.');
    assert.equal(profile.config.abaAtiva, 'teste', 'O perfil não é o isolado.');
    const histories = await c.evaluate('window.api.debateList()'); assert.ok(histories.some(d => d.status === 'completed'));
    const checks = await c.evaluate(`(async () => {
      document.querySelector('dialog[open]')?.close();
      const P=[...panes.values()][0]||newPane({engine:'codex',model:'gpt-6-astra',mode:'manual'}); window.smokePaneId=P.id;
      const before=await window.api.debateList(); const original=before.find(d=>d.status==='completed');
      P.debateId=original.id; await window.CockpitCollaboration.open(P);
      const read=await window.api.debateGet(original.id); const after=await window.api.debateList();
      await document.fonts.ready;
      const result={historyReloaded:read.status==='completed'&&read.messages.length===2,noRestart:before.length===after.length,
        realMessages:document.querySelectorAll('dialog[open] .co-message').length, fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),
        themeButton:!!document.querySelector('.tema-bt[data-tema="motti"]'), theme:document.documentElement.dataset.tema};
      document.querySelector('dialog[open]').close();
      P.busy=true;
      tratarEventoDoPainel({paneId:P.id,kind:'tool-start',id:'fixture-image',name:'Print de teste',arg:'imagem local de teste'});
      tratarEventoDoPainel({paneId:P.id,kind:'tool-end',id:'fixture-image',output:'Imagem e recurso de teste',error:false,
        imagens:[{mime:'image/png',dados:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTj8AAAAASUVORK5CYII='}],
        recursos:[{nome:'Documentação de teste',uri:'https://example.com/',abrivel:true}]});
      result.image=!!P.el.querySelector('img[src^="data:image/png"]'); result.resource=!!P.el.querySelector('.co-resource-link');
      P.busy=false;
      const tower=document.getElementById('torre'); await window.CockpitCollaboration.paintAgents(tower); result.tower=!!tower.querySelector('.co-agents');
      return result;
    })()`);
    console.log(JSON.stringify(checks));
    assert.ok(checks.historyReloaded && checks.noRestart && checks.realMessages === 2); assert.ok(checks.image && checks.resource && checks.tower);
    assert.ok(checks.fonts.includes('Archivo') && checks.fonts.includes('IBM Plex Sans')); assert.ok(checks.themeButton);
    console.log('Pacote real: perfil separado, histórico, fontes, imagens, links e Torre conferidos.');
    const terminal = await c.evaluate(`(async()=>{
      const id='collab-pty-'+Date.now(); let output=''; let finish;
      const done=new Promise(r=>finish=r); window.api.onTermEvent(e=>{if(e.id!==id)return;if(e.kind==='data')output+=e.data;if(e.kind==='exit')finish(e.code);});
      const start=await window.api.termRun({id,linha:'echo COCKPIT_COLLAB_PTY_OK',cols:80,rows:20});
      const exit=await Promise.race([done,new Promise(r=>setTimeout(()=>r('timeout'),10000))]); await window.api.termKill({id});
      return {ok:start.ok===true&&output.includes('COCKPIT_COLLAB_PTY_OK')&&exit!=='timeout'};
    })()`); assert.ok(terminal.ok);
    const diagnostic = await c.evaluate(`window.api.mcpDiagnostico({engine:'codex',paneId:window.smokePaneId})`, 90000);
    assert.ok(!diagnostic.error, JSON.stringify(diagnostic)); assert.ok(Array.isArray(diagnostic.itens));
    assert.ok(diagnostic.itens.every(i => i.ultimaChamada === null), 'Não inventar chamadas de ferramenta no diagnóstico.');
    console.log('Terminal nativo e diagnóstico real sem executar ferramentas conferidos.');
    const packagePath = path.join(root, 'artifacts/cockpit-test-runtime/resources/app.asar');
    const packageHash = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex').toUpperCase();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/package-manifest.json')));
    assert.equal(packageHash, manifest.packageHash); assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
    fs.writeFileSync(path.join(root, 'artifacts/interface-smoke.json'), JSON.stringify({passed:true,packageHash,checks,terminal,diagnostic:{count:diagnostic.itens.length,noToolCalls:true},errors:c.errors,at:new Date().toISOString()},null,2));
    console.log('Pacote aprovado: ' + packageHash);
  } finally { c.close(); }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
