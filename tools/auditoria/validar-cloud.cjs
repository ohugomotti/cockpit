'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { connect } = require('../redesenho/cdp');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const client = await connect(), checks = [];
  const e = client.evaluate;
  async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } }
  const inspect = async () => { await e(`document.querySelector('[aria-label="Acompanhar Login fictício"]').click()`); await wait(60); };
  try {
    for (const mobile of [false, true]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 960, deviceScaleFactor: 1, mobile });
      await client.send('Page.reload', { ignoreCache: true }); await wait(600); await client.ready();
      await e(`(() => {
        const p=[...panes.values()][0]; window.qaCloudPane=p;
        window.qaLoginAction={type:'computer_use_approval_request',request_id:'r1',cockpit_request_token:'fake-token',request:{type:'browser_authentication',credential_origin:'https://example.test',reason:'Login fictício para auditoria',fields:[{id:'email',label:'E-mail',required:true},{id:'password',label:'Senha',required:true},{id:'code',label:'Código',required:true}],options:[{id:'password',label:'E-mail e senha',field_ids:['email','password']},{id:'code',label:'Código único',field_ids:['code']}]}};
        window.qaLoginPosts=[];
        __qa.override('experimentsStatus',async()=>({configured:true}));
        __qa.override('cloudList',async()=>[{id:'session_qa',title:'Login fictício'}]);
        __qa.override('cloudRead',async()=>({session:{status:'running',required_actions:[qaLoginAction]},items:[],artifacts:[]}));
        __qa.override('cloudApprove',async o=>{qaLoginPosts.push(JSON.parse(JSON.stringify(o)));return {accepted:true};});
        return CockpitExperiments.open(p,{tab:'cloud'});
      })()`);
      await inspect();
      await check((mobile?'Mobile':'Desktop')+' mascara todos os campos e mostra destino', async () => {
        assert.equal(await e(`document.querySelector('.exp-login-origin').textContent`), 'https://example.test');
        assert.deepEqual(await e(`[...document.querySelectorAll('.exp-cloud-login input:not([type=checkbox])')].map(i=>i.type)`), ['password','password']);
        assert.equal(await e('document.documentElement.scrollWidth>innerWidth+1'), false);
        const g = await e(`(() => {const r=document.querySelector('.exp-dialog').getBoundingClientRect();return [r.left,r.right,innerWidth]})()`);
        assert.ok(g[0]>=0&&g[1]<=g[2]+1);
      });
      await check('Trocar método apaga os campos anteriores '+mobile, async () => {
        await e(`window.qaOldInput=document.querySelector('[data-field-id=password]');qaOldInput.value='falso';const s=document.querySelector('.exp-cloud-login select');s.value='code';s.dispatchEvent(new Event('change'));`);
        assert.equal(await e('qaOldInput.value'), '');
        assert.deepEqual(await e(`[...document.querySelectorAll('[data-field-id]')].map(i=>i.dataset.fieldId)`), ['code']);
      });
      await check('Enviar exige consentimento e usa somente evento dedicado '+mobile, async () => {
        await e(`document.querySelector('[data-field-id=code]').value='000000';document.querySelector('.exp-cloud-login').dispatchEvent(new Event('submit',{cancelable:true}));`);
        assert.equal(await e('qaLoginPosts.length'), 0);
        await e(`document.querySelector('.exp-cloud-login input[type=checkbox]').checked=true;document.querySelector('.exp-cloud-login').dispatchEvent(new Event('submit',{cancelable:true}));`); await wait(70);
        assert.deepEqual(await e('qaLoginPosts.map(p=>({decision:p.decision,selectedOption:p.selectedOption,fields:p.fields}))'), [{decision:'submit',selectedOption:'code',fields:[{field_id:'code',value:'000000'}]}]);
        assert.ok(await e(`[...document.querySelectorAll('[data-field-id]')].every(i=>i.value==='')`));
      });
      await check('Mudança de conta impede envio do formulário aberto '+mobile, async () => {
        await e(`document.querySelector('[data-field-id=email]').value='fake';document.querySelector('[data-field-id=password]').value='fake';document.querySelector('.exp-cloud-login input[type=checkbox]').checked=true;qaCloudPane.uiContaGeracao=(qaCloudPane.uiContaGeracao||0)+1;document.querySelector('.exp-cloud-login').dispatchEvent(new Event('submit',{cancelable:true}));`);
        assert.equal(await e('qaLoginPosts.length'), 1);
        assert.ok(await e(`[...document.querySelectorAll('[data-field-id]')].every(i=>i.value==='')`));
        await e('qaCloudPane.uiContaGeracao--;');
      });
      await inspect();
      await client.screenshot('auditoria-cloud-'+(mobile?'390':'desktop')+'.png');
      await check('Fechar remove os dados do formulário e não inicia motor '+mobile, async () => {
        await e(`window.qaClosingInput=document.querySelector('[data-field-id=password]');qaClosingInput.value='falso';document.querySelector('.exp-dialog').close();`);
        assert.equal(await e('qaClosingInput.value'), '');
        assert.deepEqual(await e('__qa.errors'), []);
        assert.equal(await e(`__qa.calls.filter(c=>/^(paneSend|cloudStart|experimentsGrant)$/.test(c.method)).length`), 0);
      });
    }
    const output = path.resolve(__dirname,'../../artifacts/auditoria-fase2/cloud-interface.json');
    const report = { status:checks.every(c=>c.passed)?'passed':'failed',createdAt:new Date().toISOString(),checks,simulated:true,paidApiCalls:false,sourceIdentity:client.sourceIdentity };
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
    process.exitCode=report.status==='passed'?0:1;
  } finally { client.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
