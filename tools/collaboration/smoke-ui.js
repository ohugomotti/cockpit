'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { connect } = require('./cdp');
async function main() {
  const c = await connect(); const output = path.resolve(__dirname, '../../artifacts');
  try {
    for (let i = 0; i < 60; i++) { if (await c.evaluate('typeof newPane === "function" && !!window.CockpitCollaboration')) break; await new Promise(r => setTimeout(r, 250)); }
    await c.call('Page.bringToFront');
    const before = await c.evaluate('window.api.debateList()'); assert.ok(Array.isArray(before));
    const setup = await c.evaluate(`(async () => {
      const P = [...panes.values()][0] || newPane({engine:'codex',model:'gpt-6-astra',mode:'manual',titulo:'Verificação da colaboração'});
      P.hist = [{quem:'Você',texto:'Estamos organizando o atendimento dos leads.'}];
      window.smokePaneId=P.id; aplicarTema('motti');
      await window.CockpitCollaboration.open(P);
      return {botao:!!P.el.querySelector('.p-debate'), titulo:document.querySelector('.co-dialog h2')?.textContent,
        opcoes:document.querySelectorAll('.co-participant').length, tema:document.documentElement.dataset.tema,
        fontes:await document.fonts.ready.then(()=>document.fonts.check('14px "IBM Plex Sans"'))};
    })()`);
    assert.ok(setup.botao); assert.equal(setup.opcoes, 2); assert.equal(setup.tema, 'motti');
    console.log('Diálogo e fontes carregados; nenhum motor iniciado.');
    const afterOpen = await c.evaluate('window.api.debateList()'); assert.equal(afterOpen.length, before.length, 'Abrir o diálogo não pode iniciar modelos.');
    for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
      console.log('Conferindo tela ' + name);
      await c.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const layout = await c.evaluate(`(() => { const d=document.querySelector('.co-dialog'); return {width:d.getBoundingClientRect().width,overflow:d.scrollWidth>d.clientWidth+1,heading:!!d.querySelector('h2'),actions:!!d.querySelector('.co-actions')}; })()`);
      assert.ok(layout.width <= width); assert.equal(layout.overflow, false);
      if (!process.argv.includes('--no-screenshots')) { const screenshot = await c.call('Page.captureScreenshot', { format: 'png', fromSurface: false }); fs.writeFileSync(path.join(output, 'colaboracao-' + name + '.png'), Buffer.from(screenshot.data, 'base64')); }
    }
    await c.call('Emulation.clearDeviceMetricsOverride');
    if (process.argv.includes('--real')) {
      await c.evaluate(`(() => {
        const d=document.querySelector('.co-dialog'); const topic=d.querySelector('.co-setup textarea');
        topic.value='Precisamos responder leads em ordem de chegada ou priorizar os mais urgentes? Defenda uma regra simples em no máximo 3 frases, respondendo à ideia do outro participante quando houver. Não use ferramentas.';
        d.querySelector('.co-options select').value='1';
        d.querySelector('.co-participant.codex select').value='gpt-6-astra';
        d.querySelector('.co-participant.claude select').value='claude-haiku-4-5-20251001';
        for(const p of d.querySelectorAll('.co-participant')) p.querySelectorAll('select')[1].value='low';
        d.querySelector('.co-actions .co-primary').click();
      })()`);
      const started = Date.now(); let saved;
      while (Date.now() - started < 8 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        saved = await c.evaluate(`(async () => { const id=acharPainel(window.smokePaneId).debateId; return id ? await window.api.debateGet(id) : {status:'starting',error:document.querySelector('.co-error:not([hidden])')?.textContent}; })()`);
        console.log(JSON.stringify({status:saved.status,error:saved.error||'',falas:saved.messages?.map(m=>({motor:m.speaker,estado:m.status,chars:m.text.length}))}));
        if (saved.status === 'starting' && saved.error) throw new Error(saved.error);
        if (['completed', 'failed', 'interrupted'].includes(saved.status)) break;
      }
      assert.equal(saved.status, 'completed', JSON.stringify(saved)); assert.equal(saved.messages.length, 2);
      assert.deepEqual(saved.messages.map(m => m.speaker), ['codex', 'claude']); assert.ok(saved.messages.every(m => m.text.length > 20));
      if (!process.argv.includes('--no-screenshots')) { const screenshot = await c.call('Page.captureScreenshot', { format: 'png', fromSurface: false }); fs.writeFileSync(path.join(output, 'debate-real.png'), Buffer.from(screenshot.data, 'base64')); }
      fs.writeFileSync(path.join(output, 'debate-real.json'), JSON.stringify(saved, null, 2));
      await c.evaluate(`document.querySelector('.co-actions .co-secondary').click()`);
      const draft = await c.evaluate(`acharPainel(window.smokePaneId).el.querySelector('.p-input').value`); assert.ok(draft.includes('Conclusão do debate')); assert.equal(await c.evaluate(`acharPainel(window.smokePaneId).busy`), false, 'Conclusão deve ficar no rascunho.');
    }
    assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
    fs.writeFileSync(path.join(output, 'collaboration-ui-smoke.json'), JSON.stringify({ setup, noAutomaticStart:true, mobile:true, real:process.argv.includes('--real'), errors:c.errors, passed:true, at:new Date().toISOString() }, null, 2));
    console.log('Interface conferida: desktop, mobile e acionamento manual.');
  } finally { c.close(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
