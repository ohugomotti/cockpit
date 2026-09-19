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

/* Credencial com cara de JSON de verdade: o primeiro caractere util e' "{" e
   logo depois vem uma chave. Um arquivo vazio ou cortado nao passa. */
const CARA_DE_JSON = '[ "$(tr -d \' \\t\\r\\n\' < "$ARQ" 2>/dev/null | head -c 2)" = \'{"\' ]';
const confereJson = (variavel) => CARA_DE_JSON.replace('$ARQ', () => variavel);

// Todo script termina com "exit 0" e responde por palavra-chave: codigo
// diferente de zero o execRemoto trataria como falha de conexao.
function scriptListar(o) {
  return cabecalho(o)
    + '[ -d "$D" ] || exit 0; '
    + "find \"$D\" -maxdepth 1 -type f -name 'claude__*.json' 2>/dev/null | while IFS= read -r f; do "
    + 'if [ -f "$C" ] && cmp -s "$f" "$C"; then a=1; else a=0; fi; '
    + "printf '%s\\t%s\\n' \"$a\" \"${f##*/}\"; done; exit 0";
}
function lerLista(out) {
  const lista = [];
  for (const linha of String(out || '').split('\n')) {
    const m = /^([01])\t(\S+)$/.exec(linha.trim());
    if (!m) continue;
    const apelido = apelidoDoArquivo(m[2]);
    if (apelido !== null) lista.push({ apelido, atual: m[1] === '1' });
  }
  lista.sort((a, b) => a.apelido.localeCompare(b.apelido));
  return lista;
}

function scriptSalvar(apelido, o) {
  return cabecalho(o) + 'N=' + qLinux(nomeDoArquivo(apelido)) + '; '
    + 'if [ ! -s "$C" ] || ! ' + confereJson('$C') + '; then echo COCKPIT_SEM_CONTA; exit 0; fi; '
    + 'umask 077; mkdir -p "$D" && chmod 700 "$D" || { echo COCKPIT_ERRO_PASTA; exit 0; }; '
    + 'T="$D/.guardando.$$"; '
    + 'if cp "$C" "$T" && chmod 600 "$T" && mv -f "$T" "$D/$N"; then echo COCKPIT_OK; '
    + 'else rm -f "$T"; echo COCKPIT_ERRO_COPIA; fi; exit 0';
}

/* Trocar: copia a guardada pra um temporario AO LADO da credencial e faz um mv
   (rename no mesmo disco = troca de uma vez). Escrever direto por cima podia
   pegar o Claude no meio de uma renovacao de token e deixar o arquivo pela
   metade. */
function scriptTrocar(apelido, o) {
  return cabecalho(o) + 'A="$D"/' + qLinux(nomeDoArquivo(apelido)) + '; '
    + '[ -f "$A" ] || { echo COCKPIT_SEM_CONTA; exit 0; }; '
    + confereJson('$A') + ' || { echo COCKPIT_CORROMPIDA; exit 0; }; '
    + 'umask 077; mkdir -p "$(dirname "$C")" || { echo COCKPIT_ERRO_PASTA; exit 0; }; '
    + 'T="$C.cockpit-troca.$$"; '
    + 'if cp "$A" "$T" && chmod 600 "$T" && mv -f "$T" "$C"; then echo COCKPIT_OK; '
    + 'else rm -f "$T"; echo COCKPIT_ERRO_TROCA; fi; exit 0';
}

function scriptEsquecer(apelido, o) {
  return cabecalho(o) + 'if rm -f -- "$D"/' + qLinux(nomeDoArquivo(apelido))
    + '; then echo COCKPIT_OK; else echo COCKPIT_ERRO; fi; exit 0';
}

function scriptDisponivel(o) {
  return cabecalho(o) + 'if [ -s "$C" ]; then echo COCKPIT_SIM; else echo COCKPIT_NAO; fi; exit 0';
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
  // o primeiro caractere NAO pode ser "-", senao o ssh le como opcao
  if (!/^[\w][\w.-]{0,31}$/.test(usuario) || !/^[\w][\w.-]{0,252}$/.test(host)) return null;
  if (!chave || /["`\r\n%]/.test(chave)) return null;
  const remotoCmd = 'exec ${SHELL:-/bin/sh} -lc ' + "'" + cmd + "'";
  const alvo = usuario + '@' + host;
  if (ehWindows) {
    return 'ssh -t -i "' + chave + '" -o StrictHostKeyChecking=accept-new ' + alvo + ' "' + remotoCmd + '"';
  }
  return 'ssh -t -i ' + qLinux(chave) + ' -o StrictHostKeyChecking=accept-new ' + alvo + ' ' + qLinux(remotoCmd);
}

module.exports = {
  PADRAO, TETO_APELIDO, qLinux, apelidoValido, nomeDoArquivo, apelidoDoArquivo,
  scriptListar, lerLista, scriptSalvar, scriptTrocar, scriptEsquecer, scriptDisponivel,
  scriptConta, scriptStatus, lerConta, lerResposta, linhaTerminal,
};
