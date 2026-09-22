'use strict';
/* Conta do Claude numa aba de SERVIDOR (SSH).

   O painel remoto roda o 'claude' do servidor, que le a credencial do
   servidor. Ate' a leva 41 todo canal de conta mexia no disco DESTE PC: o
   /login numa aba da VPS logava o PC, o /logout deslogava o PC e "Trocar de
   conta" trocava o arquivo do PC -- e a VPS seguia na conta antiga.

   Aqui ficam so' os COMANDOS que rodam no servidor e a leitura do que eles
   devolvem. Nada disto abre conexao: quem leva o comando e' o execRemoto do
   main (um comando, uma resposta). Separado do main pra dar pra testar sem
   Electron e pra rodar a prova contra uma pasta temporaria no servidor.

   Onde mora cada coisa no servidor:
     - credencial em uso: ~/.claude/.credentials.json (ou $CLAUDE_CONFIG_DIR)
     - contas guardadas:  ~/.cockpit-contas/claude__<apelido>.json
       (pasta 700, arquivo 600: so' o seu usuario le). */

// aspas de shell POSIX (o servidor e' Linux)
function qLinux(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/* Os caminhos padrao sao EXPRESSOES de shell (o $HOME e o $CLAUDE_CONFIG_DIR
   sao os do servidor, entao so' la' da' pra resolver). Um caminho passado nas
   opcoes -- a prova usa uma pasta do mktemp -- entra citado, como texto. */
const PADRAO = {
  pasta: '"$HOME/.cockpit-contas"',
  cred: '"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"',
};
function cabecalho(o) {
  const op = o || {};
  return 'D=' + (op.pasta ? qLinux(op.pasta) : PADRAO.pasta)
    + '; C=' + (op.cred ? qLinux(op.cred) : PADRAO.cred) + '; ';
}

const TETO_APELIDO = 40;
function apelidoValido(apelido) { return String(apelido == null ? '' : apelido).trim().slice(0, TETO_APELIDO); }

/* Nome do arquivo guardado. O encodeURIComponent deixa passar ! ' ( ) * --
   a aspa simples dentro de um comando e' justamente o que nao pode sobrar.
   Com isto o nome so' tem [A-Za-z0-9%._~-]. */
function nomeDoArquivo(apelido) {
  return 'claude__' + encodeURIComponent(apelido)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '.json';
}
function apelidoDoArquivo(nome) {
  const m = /^claude__([A-Za-z0-9%._~-]+)\.json$/.exec(String(nome || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

// Require a real parser; without Node, refuse changes instead of guessing JSON validity.
function scriptPerfis(acao, apelido, o) {
  return cabecalho(o) + 'N=' + qLinux(nomeDoArquivo(apelido || 'perfil')) + '; '
    + 'NODE=$(command -v node || command -v nodejs); [ -n "$NODE" ] || { echo COCKPIT_SEM_NODE; exit 0; }; '
    + '"$NODE" -e ' + qLinux("eval(require('zlib').inflateSync(Buffer.from('" + require('zlib').deflateSync(require('./cockpit-remote-credential-program').program()).toString('base64') + "','base64')).toString('utf8'))") + ' "$D" "$C" "$N" ' + qLinux(acao) + '; exit 0';
}
const scriptListar = o => scriptPerfis('listar', '', o);
const scriptSalvar = (apelido, o) => scriptPerfis('salvar', apelido, o);
const scriptTrocar = (apelido, o) => scriptPerfis('trocar', apelido, o);
const scriptEsquecer = (apelido, o) => scriptPerfis('esquecer', apelido, o);
const scriptDisponivel = o => scriptPerfis('disponivel', '', o);
function lerLista(out) {
  const rows = [];
  for (const line of String(out || '').split('\n')) {
    if (!line.startsWith('COCKPIT_PERFIL\t')) continue;
    try { const p = JSON.parse(Buffer.from(line.slice('COCKPIT_PERFIL\t'.length), 'base64').toString('utf8')); if (typeof p.apelido === 'string') rows.push(p); } catch {}
  }
  return rows.sort((a, b) => a.apelido.localeCompare(b.apelido));
}

/* "claude auth status" pelo shell de LOGIN do usuario ($SHELL -lc): e' la' que
   o PATH costuma ganhar o ~/.local/bin, onde o instalador do Claude poe o
   programa. Junto vem o accessToken -- SO' o da conta do Claude, recortado no
   servidor. O main usa pra ler o limite de uso e ele nunca sai do processo
   principal.
   Medido na VPS (14/09): o mesmo arquivo guarda, ANTES da conta, o
   "mcpOAuth" com um "accessToken" por conector. Pegar o primeiro
   "accessToken" do arquivo mandaria o token de um conector pra API da
   Anthropic. Por isso o recorte e' dentro do objeto "claudeAiOauth" (que nao
   tem objeto dentro: o "scopes" e' lista). tr junta as linhas se o JSON vier
   formatado. */
const STATUS_NO_SERVIDOR = '"${SHELL:-/bin/sh}" -lc \'claude auth status\' 2>&1 | head -c 8000';
const TOKEN_DA_CONTA = 'tr -d \'\\r\\n\' < "$C" 2>/dev/null'
  + ' | sed -n \'s/.*"claudeAiOauth"[[:space:]]*:[[:space:]]*{\\([^}]*\\)}.*/\\1/p\''
  + ' | grep -o \'"accessToken"[[:space:]]*:[[:space:]]*"[^"]*"\' | head -n 1';
function scriptConta(o) {
  return cabecalho(o)
    + 'echo COCKPIT_STATUS; ' + STATUS_NO_SERVIDOR + '; echo; echo COCKPIT_TOKEN; '
    + 'if [ -f "$C" ]; then ' + TOKEN_DA_CONTA + '; fi; exit 0';
}
function scriptStatus() { return STATUS_NO_SERVIDOR + '; exit 0'; }

function jsonDoTexto(txt) {
  const s = String(txt || '');
  const i = s.indexOf('{'), f = s.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  try { const o = JSON.parse(s.slice(i, f + 1)); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
function lerConta(out) {
  const s = String(out || '');
  const iS = s.indexOf('COCKPIT_STATUS'), iT = s.indexOf('COCKPIT_TOKEN');
  const textoStatus = (iS >= 0 ? s.slice(iS + 'COCKPIT_STATUS'.length, iT > iS ? iT : undefined) : s).trim();
  const status = jsonDoTexto(textoStatus);
  let token = '';
  if (iT >= 0) {
    const m = /"accessToken"\s*:\s*"([^"\s]+)"/.exec(s.slice(iT));
    if (m) token = m[1];
  }
  let motivo = '';
  if (!status) {
    motivo = /not found|no such file|command not found/i.test(textoStatus)
      ? 'Não achei o programa claude no servidor.'
      : (textoStatus ? 'O claude do servidor respondeu: ' + textoStatus.split('\n')[0].slice(0, 160) : 'O claude do servidor não respondeu.');
  }
  return { status, token, motivo };
}

/* Resposta por palavra-chave -> {ok} ou {error} com frase em portugues. */
function lerResposta(out, recados) {
  const s = String(out || '');
  if (/\bCOCKPIT_OK\b/.test(s)) return { ok: true };
  if (s.includes('COCKPIT_SEM_NODE')) return { error: 'O servidor precisa de Node.js para validar perfis. Use o terminal para entrar na conta.' };
  if (s.includes('COCKPIT_EXPIRADA')) return { error: 'A credencial guardada expirou e não pode ser renovada. Entre novamente.' };
  if (s.includes('COCKPIT_APELIDO_USADO')) return { error: 'Esse apelido já pertence a outra conta. Escolha outro apelido.' };
  if (s.includes('COCKPIT_ERRO_OPERACAO')) return { error: 'Não foi possível concluir a operação nos arquivos da conta do servidor.' };
  for (const [chave, frase] of Object.entries(recados || {})) {
    if (s.includes(chave)) return { error: frase };
  }
  return { error: 'O servidor não confirmou a operação.' };
}

/* Linha do terminal embutido pro login/logout NO SERVIDOR. Mesmas travas do
   linhaShell da tela: host, usuario e chave vao pra uma linha que o cmd.exe
   (Windows) ou o /bin/sh (Mac) executa; com aspas, "&" ou "%" dentro, o que
   rodaria seria um comando LOCAL. O comando remoto nao pode ter o $SHELL
   expandido aqui: no Windows o cmd deixa o "$" em paz dentro das aspas duplas;
   no Mac vai entre aspas simples. */
const ACAO_CONTA = { login: 'claude auth login', logout: 'claude auth logout' };
function linhaTerminal(remoto, acao, ehWindows) {
  const cmd = ACAO_CONTA[acao];
  if (!cmd || !remoto) return null;
  const usuario = String(remoto.usuario || ''), host = String(remoto.host || ''), chave = String(remoto.chave || '');
  const porta = Number(remoto.porta || 22);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return null;
  // o primeiro caractere NAO pode ser "-", senao o ssh le como opcao
  const ip = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const hostValido = ip.includes(':') ? !ip.includes('%') && require('node:net').isIP(ip) === 6 : /^[\w][\w.-]{0,252}$/.test(host);
  if (!/^[\w][\w.-]{0,31}$/.test(usuario) || !hostValido) return null;
  if (!chave || /["`\r\n%]/.test(chave)) return null;
  const remotoCmd = 'exec ${SHELL:-/bin/sh} -lc ' + "'" + cmd + "'";
  const alvo = usuario + '@' + ip;
  if (ehWindows) {
    return 'ssh -t -i "' + chave + '" -p ' + porta + ' -o StrictHostKeyChecking=accept-new ' + alvo + ' "' + remotoCmd + '"';
  }
  return 'ssh -t -i ' + qLinux(chave) + ' -p ' + porta + ' -o StrictHostKeyChecking=accept-new ' + alvo + ' ' + qLinux(remotoCmd);
}

module.exports = {
  PADRAO, TETO_APELIDO, qLinux, apelidoValido, nomeDoArquivo, apelidoDoArquivo,
  scriptListar, lerLista, scriptSalvar, scriptTrocar, scriptEsquecer, scriptDisponivel,
  scriptConta, scriptStatus, lerConta, lerResposta, linhaTerminal,
};
