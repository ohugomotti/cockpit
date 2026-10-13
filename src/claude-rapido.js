'use strict';
/* Tarefa 1 (26/09): executor UNICO do "claude -p" rapido, fora de painel.

   Toda chamada rapida ao Claude que nao e' um painel de chat (titulo de 3
   palavras, "Mais detalhes" de um trecho, nome de conversa/agente) passa por
   aqui. E' o unico lugar que decide o ambiente e se a conta pode rodar -
   assim nenhum chamador precisa lembrar disso sozinho.

   Base: o executor que ja existia em src/titulo-auto.js (stdin, settings em
   arquivo, --safe-mode com reserva quando o CLI e' antigo, leitura da saida,
   fila com limite, windowsHide). Somado as travas do app do Homero
   (cockpit-homero, so' leitura):
     - mais-detalhes.js/ambienteDoDetalhe: nunca deixa credencial de API paga
       ou roteamento de nuvem chegar no processo filho - so' o login local
       (claude.ai) manda;
     - mais-detalhes.js/contaDeAssinatura: "claude auth status" e' consultado
       ANTES de cada pedido (conta logada confirmada fica 10 min no cache;
       o resto, 30s - ver abaixo) e o -p SO' roda com
       assinatura CONFIRMADA (authMethod:'claude.ai', apiProvider:'firstParty',
       sem apiKeySource de API). FAIL-CLOSED, igual ao main.js do Homero
       (2342-2346 e 2395-2399: "if (auth.err || !contaDeAssinatura(conta))
       return erro" - nunca "roda mesmo assim"): conta de API/Console, conta
       deslogada, "auth status" que nao subiu, estourou o prazo ou devolveu
       algo que nao e' JSON - tudo isso BLOQUEIA. So' o ambiente (env limpo)
       nao bloqueia uma conta de API/Console cuja credencial mora no proprio
       login salvo do CLI (nao numa env var) - por isso esta checagem nao
       pode falhar aberta. So' conta CONFIRMADA logada (assinatura, ou conta
       de API/Console logada) fica 10 min no cache. Conta deslogada e falha
       na checagem (nao confirmou) ficam no maximo 30s: uma demora passageira
       no "auth status" nao trava o app pelo resto da janela de 10 min, e quem
       seguiu o "Entre na sua conta" ja' esta' liberado em ate' 30s.

   Matar processo no Windows: taskkill /T /F SINCRONO (execFileSync) ANTES do
   kill(). Armadilha ja conhecida neste repo (src/plataforma.js): disparado
   depois do kill, ou de forma assincrona, o cmd.exe (pai) ja pode estar
   morto e o /T deixa de enxergar o neto - o processo de verdade sobrevive.
   Fora do Windows um kill() simples basta (sem wrapper de shell no meio). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn: spawnPadrao, execFileSync: execFileSyncPadrao } = require('child_process');
const { StringDecoder } = require('node:string_decoder');

const EH_WIN = process.platform === 'win32';
const PRAZO_PADRAO_MS = 60000;
const MAX_SIMULTANEOS_PADRAO = 2;
const PRAZO_CACHE_CONTA_MS = 10 * 60 * 1000;    // sucesso confirmado: 10 min (pedido do brief)
const PRAZO_CACHE_FALHA_MS = 30 * 1000;         // nao confirmou (falhou/sem parse): so 30s
const PRAZO_AUTH_STATUS_MS = 15000;

/* Nunca deixa credencial de API paga nem roteamento de nuvem chegar no claude
   -p fora de painel: so' o login local (claude.ai) manda. Mesma lista do
   ambienteDoDetalhe do Homero (mais-detalhes.js). PATH/Path e USERPROFILE
   (nenhum comeca com esses prefixos) sobrevivem sempre. */
function ambienteLimpo(base) {
  const env = { ...(base || {}) };
  for (const k of Object.keys(env)) {
    if (/^(?:ANTHROPIC_|AWS_|AZURE_|GOOGLE_|GCLOUD_|VERTEX_|CLOUD_ML_)/i.test(k)
      || /^CLAUDE_CODE_(?:USE_|API_KEY)/i.test(k)) delete env[k];
  }
  return env;
}

/* Settings proprio deste executor (arquivo, nao JSON no argv: pelo cmd.exe as
   aspas do JSON viram "" e o CLI recebia lixo - o mesmo motivo de
   titulo-auto.js). forceLoginMethod trava o login em claude.ai mesmo se o
   usuario tiver outro metodo configurado; alwaysThinkingEnabled:false e' o
   raciocinio desligado (uma resposta rapida nao precisa dele).
   disableAllHooks (Tarefa 6, revisao; o settings antigo do titulo-auto tinha):
   o --safe-mode ja' tira os hooks, mas se o CLI recusar a flag a 2a tentativa
   sem ela rodaria os hooks do usuario -- neste PC ha' um SessionEnd que vira
   nota no Obsidian a cada sessao, e o nome da conversa chama o Haiku bem mais. */
function arquivoDeSettings(pasta) {
  const f = path.join(pasta, 'claude-rapido-settings.json');
  const conteudo = JSON.stringify({ forceLoginMethod: 'claudeai', alwaysThinkingEnabled: false, disableAllHooks: true });
  try { if (fs.readFileSync(f, 'utf8') === conteudo) return f; } catch {}
  try { fs.mkdirSync(pasta, { recursive: true }); fs.writeFileSync(f, conteudo); } catch {}
  return f;
}

/* --tools '' desliga TODAS as ferramentas; --strict-mcp-config nao deixa
   nenhum MCP entrar; --no-session-persistence: a propria chamada nao vira
   conversa gravada. --safe-mode tira CLAUDE.md, skills, plugins e hooks (com
   reserva: CLI antigo que nao conhece a flag tenta de novo sem ela, uma
   unica vez - ver tentarUmaVez/rodarPergunta). */
function argumentos({ modelo, sistema, saida, arqSettings, semSafeMode }) {
  const a = ['-p', '--model', modelo];
  if (saida === 'json') a.push('--output-format', 'json');
  a.push('--no-session-persistence', '--strict-mcp-config', '--tools', '', '--settings', arqSettings);
  if (sistema) a.push('--system-prompt', sistema);
  if (!semSafeMode) a.push('--safe-mode');
  return a;
}

/* A saida do -p: com saida:'json' e' o envelope --output-format json (um
   objeto {type:'result', is_error, result}, igual ao lerSaida de
   titulo-auto.js); com saida:'texto' (padrao) o stdout CRU e' a resposta.
   Nos dois formatos, "Not logged in" no texto vira 'sem-login' - sem conta
   o CLI pode sair com codigo 0 e a mensagem de login no lugar da resposta. */
function lerSaida(stdout, saida) {
  const t = String(stdout || '').trim();
  if (!t) return { erro: 'vazio' };
  if (saida === 'json') {
    let j = null;
    try { j = JSON.parse(t); } catch {
      // alguma versao pode soltar linha extra antes: fica com a ultima linha JSON
      const ult = t.split('\n').reverse().find((l) => l.trim().startsWith('{'));
      try { j = ult ? JSON.parse(ult) : null; } catch { j = null; }
    }
    if (Array.isArray(j)) j = j.filter((x) => x && x.type === 'result').pop() || null;
    if (!j || typeof j !== 'object') return { erro: 'formato' };
    if (j.is_error || (j.subtype && j.subtype !== 'success')) {
      const detalhe = String(j.result || '').slice(0, 200);
      return { erro: /not logged in/i.test(detalhe) ? 'sem-login' : 'motor', detalhe };
    }
    if (typeof j.result !== 'string') return { erro: 'formato' };
    return { texto: j.result };
  }
  if (/not logged in/i.test(t)) return { erro: 'sem-login', detalhe: t.slice(0, 200) };
  return { texto: t };
}

function ehAssinatura(conta) {
  // Console tambem guarda uma chave em authMethod:"claude.ai" (o login em si
  // e' o mesmo OAuth) - apiProvider/apiKeySource e' quem distingue a cobranca.
  return !!conta && conta.loggedIn === true && conta.authMethod === 'claude.ai'
    && conta.apiProvider === 'firstParty'
    && (conta.apiKeySource === undefined || conta.apiKeySource === 'none');
}

function criarClaudeRapido(opts) {
  const {
    acharBin, buildEnv, pastaDados, spawn = spawnPadrao, agora = Date.now, maxSimultaneos = MAX_SIMULTANEOS_PADRAO,
    execFileSync = execFileSyncPadrao, ehWindows = EH_WIN,
  } = opts || {};

  let cacheConta = null;     // { quando, conta, duracao }
  let contaEmVoo = null;     // Promise em andamento (evita 2 "auth status" simultaneos)
  const emAndamento = new Map();   // id -> { cancelar() }
  const fila = [];                 // { id, tarefa, resolve } ainda nao iniciados
  let rodando = 0;

  function ambienteFilho() { return ambienteLimpo(buildEnv()); }

  /* Windows: taskkill /T /F SINCRONO antes do kill (ver comentario do topo do
     arquivo). Fora do Windows, kill() simples ja basta. execFileSync e
     ehWindows sao injetaveis (como spawn/acharBin) para o teste conferir a
     ordem sem chamar o taskkill de verdade. */
  function matarProcesso(child) {
    if (!child) return;
    if (ehWindows && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch {}
    }
    try { child.kill(); } catch {}
  }

  /* "claude auth status": sem --json (a versao instalada aqui ja devolve
     JSON puro sem a flag - conferido em 26/09). Nao parseou (formato novo,
     spawn falhou, prazo estourou)? volta null - e null NAO e' assinatura
     (ehAssinatura(null) === false): quem chama (perguntar) bloqueia. */
  function rodarAuthStatus() {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(acharBin('claude'), ['auth', 'status'],
          { cwd: os.tmpdir(), env: ambienteFilho(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch { return resolve(null); }
      let out = '', acabou = false;
      const dec = new StringDecoder('utf8');
      const fim = (v) => { if (acabou) return; acabou = true; clearTimeout(prazo); resolve(v); };
      const prazo = setTimeout(() => { matarProcesso(proc); fim(null); }, PRAZO_AUTH_STATUS_MS);
      proc.on('error', () => fim(null));
      if (proc.stdout) proc.stdout.on('data', (d) => { if (out.length < 20000) out += dec.write(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
      proc.on('close', () => {
        if (acabou) return;
        out += dec.end();
        let j = null;
        try { j = JSON.parse(out.trim()); } catch {}
        fim(j && typeof j === 'object' ? j : null);
      });
    });
  }

  function obterConta() {
    const agoraMs = agora();
    if (cacheConta && agoraMs - cacheConta.quando < cacheConta.duracao) return Promise.resolve(cacheConta.conta);
    if (contaEmVoo) return contaEmVoo;
    contaEmVoo = rodarAuthStatus().then((conta) => {
      // so' conta CONFIRMADA logada (loggedIn:true: assinatura, ou API/Console
      // logada) fica 10 min. Deslogada (loggedIn:false) e falha (null: nao deu
      // pra confirmar) ficam so' 30s: quem entrou na conta depois do aviso nao
      // pode ficar bloqueado 10 min (revisao da Tarefa 3), e uma demora
      // passageira no "auth status" nao trava o app pelo resto da janela.
      const logadaConfirmada = !!conta && conta.loggedIn === true;
      cacheConta = { quando: agoraMs, conta, duracao: logadaConfirmada ? PRAZO_CACHE_CONTA_MS : PRAZO_CACHE_FALHA_MS };
      contaEmVoo = null;
      return conta;
    });
    return contaEmVoo;
  }

  async function contaDeAssinatura() { return ehAssinatura(await obterConta()); }

  /* uma tentativa do -p (a 2a, sem --safe-mode, so' acontece se o CLI
     recusar a flag - ver rodarPergunta). Resolve sempre (nunca rejeita):
     {ok:true, texto} | {ok:false, erro, motivo} | {retry:true} (CLI antigo). */
  function tentarUmaVez({ id, modelo, sistema, texto, prazoMs, saida, arqSettings, semSafeMode }) {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(acharBin('claude'), argumentos({ modelo, sistema, saida, arqSettings, semSafeMode }),
          { cwd: os.tmpdir(), env: ambienteFilho(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch { return resolve({ ok: false, erro: 'sem-claude', motivo: 'falhou' }); }

      let out = '', err = '', acabou = false;
      const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8');
      const fim = (r) => {
        if (acabou) return;
        acabou = true;
        clearTimeout(prazo);
        if (emAndamento.get(id) === registro) emAndamento.delete(id);
        resolve(r);
      };
      const registro = { cancelar: () => { matarProcesso(proc); fim({ ok: false, erro: 'cancelado', motivo: 'cancelado' }); } };
      emAndamento.set(id, registro);
      const prazo = setTimeout(() => { matarProcesso(proc); fim({ ok: false, erro: 'prazo', motivo: 'prazo' }); }, prazoMs);

      proc.on('error', () => fim({ ok: false, erro: 'sem-claude', motivo: 'falhou' }));
      if (proc.stdout) proc.stdout.on('data', (d) => { if (out.length < 400000) out += outDec.write(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
      if (proc.stderr) proc.stderr.on('data', (d) => { if (err.length < 20000) err += errDec.write(Buffer.isBuffer(d) ? d : Buffer.from(d)); });
      proc.on('close', (code) => {
        if (acabou) return;
        out += outDec.end(); err += errDec.end();
        if (!semSafeMode && /unknown option[^\n]*safe-mode/i.test(err + out)) return fim({ retry: true });
        const lido = lerSaida(out, saida);
        if (lido.erro) {
          const motivo = lido.erro === 'sem-login' ? 'sem-login' : 'falhou';
          const erroPublico = lido.erro === 'vazio' && code ? 'codigo-' + code : lido.erro;
          return fim({ ok: false, erro: erroPublico, motivo });
        }
        fim({ ok: true, texto: lido.texto });
      });
      if (proc.stdin) {
        proc.stdin.on('error', () => {});   // o processo pode morrer antes de ler: nao derruba o chamador
        try { proc.stdin.end(String(texto || ''), 'utf8'); } catch {}
      }
    });
  }

  async function rodarPergunta({ id, modelo, sistema, texto, prazoMs, saida }) {
    // tentarUmaVez nunca rejeita, mas pastaDados()/arquivoDeSettings sao
    // chamados FORA dela: um try/catch aqui garante que o pedido sempre
    // resolve (nunca trava a fila nem o chamador) mesmo se uma dependencia
    // injetada se comportar mal.
    try {
      const arqSettings = arquivoDeSettings(pastaDados());
      let r = await tentarUmaVez({ id, modelo, sistema, texto, prazoMs, saida, arqSettings, semSafeMode: false });
      if (r && r.retry) r = await tentarUmaVez({ id, modelo, sistema, texto, prazoMs, saida, arqSettings, semSafeMode: true });
      return r;
    } catch {
      return { ok: false, erro: 'falhou', motivo: 'falhou' };
    }
  }

  /* fila: no maximo maxSimultaneos tarefas rodando; o resto espera a vez. */
  function proximo() {
    while (rodando < maxSimultaneos && fila.length) {
      const { tarefa, resolve } = fila.shift();
      rodando++;
      tarefa().then(resolve).finally(() => { rodando--; proximo(); });
    }
  }
  function enfileirar(id, tarefa) {
    return new Promise((resolve) => { fila.push({ id, tarefa, resolve }); proximo(); });
  }

  async function perguntar({ id, modelo, sistema, texto, prazoMs = PRAZO_PADRAO_MS, saida = 'texto' }) {
    const conta = await obterConta();
    // FAIL-CLOSED (igual ao main.js do Homero): so' roda com assinatura
    // CONFIRMADA. Tudo o mais bloqueia aqui, ANTES de gastar uma chamada, com
    // o motivo certo:
    //   - deslogada (loggedIn:false, o que o "auth status" imprime sem login):
    //     erro e motivo 'sem-login' (o que falta e' entrar na conta);
    //   - conta de API/Console logada: erro e motivo 'conta-api';
    //   - "auth status" que nao deu pra confirmar (null): erro
    //     'conta-desconhecida', motivo 'conta-api' (o vocabulario fixo da
    //     interface nao tem um motivo so' pra isso).
    if (!ehAssinatura(conta)) {
      /* Tarefa 3 (26/09): deslogada antes caia em 'conta-api', e a janelinha
         do Mais detalhes dizia "chave de API" pra quem so' estava deslogado. */
      if (conta && conta.loggedIn === false) return { ok: false, erro: 'sem-login', motivo: 'sem-login' };
      return { ok: false, erro: conta ? 'conta-api' : 'conta-desconhecida', motivo: 'conta-api' };
    }
    return enfileirar(id, () => rodarPergunta({ id, modelo, sistema, texto, prazoMs, saida }));
  }

  function cancelar(id) {
    const idxFila = fila.findIndex((x) => x.id === id);
    if (idxFila !== -1) {
      const [item] = fila.splice(idxFila, 1);
      item.resolve({ ok: false, erro: 'cancelado', motivo: 'cancelado' });
      return true;
    }
    const registro = emAndamento.get(id);
    if (!registro) return false;
    registro.cancelar();
    return true;
  }

  return { perguntar, cancelar, contaDeAssinatura };
}

module.exports = { criarClaudeRapido, ambienteLimpo };
