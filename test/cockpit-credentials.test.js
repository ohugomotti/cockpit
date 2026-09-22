'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { inspectCredential, sameCredentialAccount, credentialPaths, authenticationStatus } = require('../src/cockpit-credentials');
const jwt = o => 'x.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.x';
const claude = (accessToken, more = {}) => JSON.stringify({ claudeAiOauth: { accessToken, ...more } });
test('rejects unrelated JSON, arrays, truncated JSON, connector tokens and wrong engine credentials', () => {
 for (const text of ['{"foo":1}', '[1]', '{"token":', '{"mcpOAuth":{"accessToken":"x"}}', '{"tokens":{"access_token":"x"}}']) assert.equal(inspectCredential('claude', text).podeUsar, false);
 assert.equal(inspectCredential('codex', claude('x')).podeUsar, false);
 assert.equal(inspectCredential('claude', claude('token\nheader')).valido, false);
});
test('expiration rejects only unusable credentials and preserves legitimate CLI renewal', () => {
 assert.equal(inspectCredential('claude', claude('a', {expiresAt:1000}),2000).podeUsar,false);
 const renewable=inspectCredential('claude',claude('a',{expiresAt:1000,refreshToken:'r'}),2000);
 assert.equal(renewable.podeUsar,true); assert.equal(renewable.precisaRenovar,true);
 assert.equal(inspectCredential('codex',JSON.stringify({tokens:{access_token:jwt({exp:1})}}),2000).podeUsar,false);
 assert.equal(inspectCredential('codex',JSON.stringify({OPENAI_API_KEY:'test-key'})).authMode,'apikey');
});
test('stable identity survives rotation and does not merge users sharing a Codex workspace', () => {
 const profile=(user,access)=>inspectCredential('codex',JSON.stringify({tokens:{account_id:'workspace',id_token:jwt({sub:user}),access_token:access}}));
 assert.equal(sameCredentialAccount(profile('A','old'),profile('A','new')),true);
 assert.equal(sameCredentialAccount(profile('A','same'),profile('B','same')),false);
 assert.equal(sameCredentialAccount(inspectCredential('claude',claude('opaque-old',{refreshToken:'r'})),inspectCredential('claude',claude('opaque-new',{refreshToken:'r'}))),true);
 assert.equal(sameCredentialAccount(inspectCredential('claude',claude('unknown-old')),inspectCredential('claude',claude('unknown-new'))),false);
});
test('effective engine home overrides default credential paths', () => {
 const path=require('node:path').win32;
 assert.deepEqual(credentialPaths('claude','C:\\home',{CLAUDE_CONFIG_DIR:'C:\\custom\\claude'},path),['C:\\custom\\claude\\.credentials.json']);
 assert.deepEqual(credentialPaths('codex','C:\\home',{CODEX_HOME:'C:\\custom\\codex'},path),['C:\\custom\\codex\\auth.json']);
});
test('auth completion distinguishes authenticated, logout and inconclusive failures', () => {
 assert.equal(authenticationStatus('claude','{"loggedIn":true}').autenticado,true);
 assert.equal(authenticationStatus('claude','{"loggedIn":false}',true).autenticado,false);
 assert.equal(authenticationStatus('codex','Logged in using ChatGPT').autenticado,true);
 assert.equal(authenticationStatus('codex','Not logged in',true).autenticado,false);
 assert.equal(authenticationStatus('codex','Logged in using ChatGPT',true).verificado,false);
 assert.equal(authenticationStatus('codex','HTTP 429',true).autenticado,null);
 assert.equal(authenticationStatus('gemini','installed').autenticado,null);
});
