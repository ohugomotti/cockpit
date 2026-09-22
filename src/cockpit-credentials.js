'use strict';
// Pure validation is also sent to the remote Node process. Never logs credential contents.
function inspectCredential(engine, text, now = Date.now()) {
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const token = x => typeof x === 'string' && x.trim() === x && x.length > 0 && !/[\s\x00-\x1f\x7f]/.test(x);
  const claim = value => {
    if (!token(value)) return {};
    try { const parts = value.split('.'); if (parts.length !== 3) return {}; const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); return object(p) ? p : {}; } catch { return {}; }
  };
  const invalid = motivo => ({ valido: false, podeUsar: false, precisaLogin: true, motivo });
  let value;
  try { value = JSON.parse(text); } catch { return invalid('O arquivo da conta está corrompido. Entre novamente para guardá-la.'); }
  if (!object(value)) return invalid('O arquivo não contém uma credencial reconhecida.');
  let access, refresh, expiry = null, identity = '', authMode;
  if (engine === 'claude') {
    const o = value.claudeAiOauth;
    if (!object(o) || !token(o.accessToken)) return invalid('O perfil não contém uma credencial OAuth do Claude.');
    access = o.accessToken; refresh = token(o.refreshToken) ? o.refreshToken : '';
    if (o.refreshToken != null && !token(o.refreshToken)) return invalid('A credencial de renovação do Claude está inválida.');
    if (o.expiresAt != null) {
      if (typeof o.expiresAt !== 'number' || !Number.isFinite(o.expiresAt) || o.expiresAt <= 0) return invalid('A validade da credencial do Claude está inválida.');
      expiry = o.expiresAt;
    }
    const claims = claim(access);
    const id = o.accountUuid || o.accountId || claims.sub;
    if (typeof id === 'string' && id) identity = JSON.stringify(['claude', id, o.organizationUuid || o.organizationId || claims.org_id || '']);
    authMode = 'oauth';
  } else if (engine === 'codex') {
    if (token(value.OPENAI_API_KEY)) return { valido: true, podeUsar: true, precisaLogin: false, motivo: '', identity: '', access: value.OPENAI_API_KEY, refresh: '', authMode: 'apikey', expiresAt: null };
    const o = value.tokens;
    if (!object(o) || !token(o.access_token)) return invalid('O perfil não contém uma credencial do Codex.');
    access = o.access_token; refresh = token(o.refresh_token) ? o.refresh_token : '';
    if (o.refresh_token != null && !token(o.refresh_token)) return invalid('A credencial de renovação do Codex está inválida.');
    const claims = claim(o.id_token), accessClaims = claim(access);
    const account = o.account_id || claims['https://api.openai.com/auth']?.chatgpt_account_id || accessClaims['https://api.openai.com/auth']?.chatgpt_account_id;
    const subject = claims.sub || accessClaims.sub || '';
    if (typeof account === 'string' && account) identity = JSON.stringify(['codex', account, subject]);
    if (typeof accessClaims.exp === 'number' && Number.isFinite(accessClaims.exp)) expiry = accessClaims.exp * 1000;
    authMode = 'oauth';
  } else return invalid('Este motor não tem gestão de credenciais pelo Cockpit.');
  const expired = expiry != null && expiry <= now;
  const podeUsar = !expired || !!refresh;
  return { valido: true, podeUsar, precisaLogin: !podeUsar, precisaRenovar: expired && !!refresh,
    motivo: !podeUsar ? 'A credencial expirou e não tem renovação disponível. Entre novamente.' : expired ? 'O motor precisará renovar esta credencial ao usar a conta.' : '',
    identity, access, refresh, authMode, expiresAt: expiry };
}
function sameCredentialAccount(a, b) {
  if (!a?.valido || !b?.valido || a.authMode !== b.authMode) return false;
  // A known identity mismatch always wins over coincident tokens.
  if (a.identity && b.identity) return a.identity === b.identity;
  return !!((a.access && a.access === b.access) || (a.refresh && a.refresh === b.refresh));
}
function publicCredentialState(info) {
  return { podeUsar: !!info.podeUsar, precisaLogin: !!info.precisaLogin, precisaRenovar: !!info.precisaRenovar, motivo: info.motivo || '' };
}
function credentialPaths(engine, home, env, path) {
  if (engine === 'claude') return env.CLAUDE_CONFIG_DIR
    ? [path.resolve(env.CLAUDE_CONFIG_DIR, '.credentials.json')]
    : [path.join(home, '.claude', '.credentials.json'), path.join(home, '.config', 'claude', '.credentials.json')];
  if (engine === 'codex') return [path.join(env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex'), 'auth.json')];
  return [];
}
function authenticationStatus(engine, output, failed = false) {
  const text = String(output || '').trim();
  let authenticated = null;
  if (engine === 'claude') {
    try { const o = JSON.parse(text); if (typeof o.loggedIn === 'boolean') authenticated = o.loggedIn; } catch {}
  } else if (engine === 'codex') {
    if (!failed && /^Logged in using (ChatGPT|an API key)\b/im.test(text)) authenticated = true;
    else if (/^Not logged in\b/im.test(text)) authenticated = false;
  }
  return { autenticado: authenticated, entrou: authenticated, verificado: authenticated !== null,
    texto: authenticated === true ? 'Conta autenticada.' : authenticated === false ? 'Conta desconectada.' : 'Não foi possível confirmar a autenticação.',
    motivo: authenticated === null ? 'O motor não confirmou o estado da conta. Confira o terminal.' : '' };
}
module.exports = { inspectCredential, sameCredentialAccount, publicCredentialState, credentialPaths, authenticationStatus };
