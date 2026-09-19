// Diagnóstico do pacote de TESTE do próprio Cockpit, nunca de uma janela pessoal.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9335/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('/artifacts/cockpit-test-runtime/'));
  assert.ok(page, 'A porta 9335 não aponta para o runtime isolado de teste');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); const errors = []; let seq = 0;
  ws.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Conexao CDP encerrada')); } pending.clear(); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true}); });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Tempo excedido: ' + method)); }, 45000);
      pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
    });
  }
  async function evaluate(expression) {
    const r = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
  }
  try {
    await call('Runtime.enable');
    console.log('CDP conectado ao pacote isolado');
    if (process.argv.includes('--close')) { await call('Browser.close').catch(() => {}); return; }
    const checks = await evaluate(`(async () => {
      const check = (ok, text) => { if (!ok) throw new Error(text); };
      const P = newPane({engine:'claude', model:'claude-opus-5', mode:'manual', effort:'high', titulo:'Verificação Astra e Claude'});
      for (const q of [...panes.values()]) if(q !== P) await closePane(q.id);
      P.resumeId = 'fixture-claude'; P.worktree = 'fixture-isolada';
      await trocarMotor(P, 'codex');
      check(!P.worktree, 'Codex herdou worktree Claude');
      check(!P.el.querySelector('.p-cwd').textContent.includes('fixture-isolada'), 'Indicador de pasta ficou preso no motor anterior');
      P.model='gpt-6-astra'; P.effort='xhigh'; P.mode='manual'; P.resumeId='fixture-codex';
      await trocarMotor(P, 'claude');
      check(opcoesDeStart(P).worktree === 'fixture-isolada', 'Claude perdeu worktree');
      check(P.resumeId === 'fixture-claude', 'Claude perdeu sessão');
      await trocarMotor(P, 'codex');
      check(P.model === 'gpt-6-astra' && P.effort === 'xhigh' && P.resumeId === 'fixture-codex', 'Codex perdeu escolhas');
      const ficha = fichaDoPainel(P);
      check(ficha.engineStates.claude.worktree === 'fixture-isolada', 'Ficha perdeu worktree');
      // As sessões acima são apenas fixtures locais. Não tentar retomá-las em um motor.
      limparSessoesDeTodosMotores(P); P.resumeId=null; P.sessaoId=null; P.worktree=null;
      fillModels(P); savePanes();
      return {trocaMotores:true, escolhas:true, worktree:true, ficha:true,
        painel:P.id, modeloVisivel:P.el.querySelector('.p-model').textContent};
    })()`);
    console.log('Troca de motores e persistência conferidas');
    const terminal = await evaluate(`(async () => {
      const id='smoke-pty-'+Date.now();
      let output=''; let done;
      const finished=new Promise(resolve=>{done=resolve;});
      window.api.onTermEvent(e=>{if(e.id!==id)return; if(e.kind==='data')output+=e.data; if(e.kind==='exit')done(e.code);});
      const start=await window.api.termRun({id,linha:'echo cockpit-pty-ok',cols:100,rows:30});
      const code=await Promise.race([finished,new Promise(resolve=>setTimeout(()=>resolve('timeout'),12000))]);
      await window.api.termKill({id});
      return {start,code,ok:output.includes('cockpit-pty-ok')};
    })()`);
    assert.equal(terminal.start.ok, true); assert.equal(terminal.ok, true); assert.notEqual(terminal.code, 'timeout');
    console.log('Terminal nativo conferido');
    const root = path.resolve(__dirname, '../../artifacts');
    for (const [name,width,height] of [['desktop',1440,900],['estreita',800,850]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await call('Page.bringToFront');
      const shot=await call('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(root,'interface-'+name+'.png'),Buffer.from(shot.data,'base64'));
    }
    await call('Emulation.clearDeviceMetricsOverride');
    assert.equal(errors.length,0,JSON.stringify(errors));
    const packageHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'cockpit-test-runtime/resources/app.asar'))).digest('hex').toUpperCase();
    const report={checks,terminal,errors,packageHash,passed:true,at:new Date().toISOString()};
    fs.writeFileSync(path.join(root,'interface-smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { ws.close(); for(const p of pending.values()) clearTimeout(p.timer); }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
