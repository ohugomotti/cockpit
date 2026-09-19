'use strict';
/* Leva 41 (B2): sessoes que nao caem.

   O que mora aqui e' a parte que da' pra testar sem subir o Electron:
   - saber quais paineis estao NO MEIO de um turno (o main liga no envio e
     desliga no fim do turno), pra tela decidir se religa sozinha;
   - dizer que tipo de queda foi: limite de uso, conta pedindo login, motor que
     nem existe, ou queda de verdade. So' a ultima religa sozinha;
   - ler a hora em que o limite de uso libera, nos formatos que o Claude e o
     Codex escrevem;
   - o registro das quedas em userData/logs/motores.log (gira em 1 MB);
   - o retomar.json: quem estava em turno quando a tela recarregou ou o app
     fechou. E' lido uma vez no boot e cada conversa so' pode ser pega UMA vez. */
const fs = require('fs');
const path = require('path');

/* ---------- limite de uso ---------- */
/* "rate limit" (sobrecarga de alguns segundos) NAO entra: aquilo passa sozinho.
   Limite de uso e' o do plano: 5 horas, semana, cota do Codex. O "limit reached"
   solto tambem casava "Rate limit reached" (a sobrecarga da API) -- e o painel
   nao religava numa queda que passaria em segundos (auditoria 1): o lookbehind
   tira o "rate" da frente. */
/* auditoria 2: as frases do Claude 2.1.270 (lidas de dentro do claude.exe:
   `You've hit your ${e}`) sao "You've hit your session limit · resets 6:20pm",
   "weekly limit", "Opus limit", "Sonnet limit", "Fable limit", "usage credit
   limit" e "You're out of usage credits · resets ...". So' "hit your limit" e
   "hit your usage limit" casavam: o resto virava QUEDA e o painel religava com
   "continue" -- contra a decisao do Hugo (limite nao retoma sozinho). Aceita
   ate' 30 letras entre "hit your" e "limit" (sem ponto nem separador), menos
   quando o que vem antes do "limit" e' "rate" (sobrecarga de segundos). */
const RE_LIMITE = /usage limit|(?<!rate[\s_-]?)limit reached|hit your (?![^.\n·∙|]{0,30}?rate[\s_-]?limit)[^.\n·∙|]{0,30}?limit|out of [^.\n·∙|]{0,20}?credits|usage_limit|limite de uso/i;
const MESES = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 };
const dois = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => dois(h) + ':' + dois(m);

function hora12(h, ampm) {
  let n = Number(h);
  const a = String(ampm || '').toLowerCase();
  if (a === 'pm' && n < 12) n += 12;
  if (a === 'am' && n === 12) n = 0;
  return n;
}

/* Devolve null se o texto nao fala de limite de uso. Senao:
   { hora: 'HH:MM' ou '', dia: 'dd/mm' ou '', texto: frase pronta pra tela }.
   Formatos conhecidos (Claude Code e Codex, 2025-2026):
   - "Claude AI usage limit reached|1757872800"          (segundos do Unix)
   - "5-hour limit reached ∙ resets 3pm"                 (hora do relogio dele)
   - "You've hit your limit · resets 3:30pm (America/Sao_Paulo)"
   - "Weekly limit reached ∙ resets Oct 9, 5pm"
   - "You've hit your usage limit. ... try again at 8:57 PM."
   - "You've hit your usage limit. Try again in 2 hours 5 minutes."
   - "You've hit your session limit · resets 6:20pm"     (Claude 2.1.270)
   - "You've hit your weekly limit · resets Sep 16, 6:20pm"
   - "You're out of usage credits · resets 6pm"
   - resets_at: "2026-09-14T20:00:00Z"                   (ISO) */
function limiteDeUso(texto, agora) {
  const s = String(texto == null ? '' : texto);
  if (!RE_LIMITE.test(s)) return null;
  const ja = agora instanceof Date ? agora : new Date(agora || Date.now());
  /* ms: a hora de liberar como numero (auditoria 1). A tarja do limite compara
     o "reseta" como numero pra saber se o limite e' outro; "15:00" virava NaN e
     a tarja fechada nunca mais voltava. 0 = nao se sabe. */
  let hora = '', dia = '', ms = 0;
  const deData = (d) => {
    if (!d || isNaN(d.getTime())) return;
    hora = hhmm(d.getHours(), d.getMinutes());
    ms = d.getTime();
    // passa de amanha: a hora sozinha enganaria
    if (d.getTime() - ja.getTime() > 20 * 3600 * 1000 || d.getDate() !== ja.getDate()) dia = dois(d.getDate()) + '/' + dois(d.getMonth() + 1);
  };
  // so' a hora do relogio (e talvez o dia): a proxima vez que ela chega
  const proxima = (h, min, mes, diaMes) => {
    const d = new Date(ja.getTime());
    d.setSeconds(0, 0); d.setHours(h, min);
    if (mes != null) { d.setMonth(mes, diaMes); if (d.getTime() < ja.getTime() - 24 * 3600 * 1000) d.setFullYear(d.getFullYear() + 1); }
    else if (d.getTime() <= ja.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  let m;
  if ((m = /\|(\d{10})(?:\D|$)/.exec(s))) deData(new Date(Number(m[1]) * 1000));
  else if ((m = /resets?\s+(?:at\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s))) {
    hora = hhmm(hora12(m[3], m[5]), Number(m[4] || 0));
    const mes = m[1] ? MESES[m[1].toLowerCase()] : null;
    if (m[1] && mes != null) dia = dois(Number(m[2])) + '/' + dois(mes + 1);
    ms = proxima(hora12(m[3], m[5]), Number(m[4] || 0), mes != null ? mes : null, Number(m[2]));
  } else if ((m = /try again at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s))) {
    hora = hhmm(hora12(m[1], m[3]), Number(m[2] || 0));
    ms = proxima(hora12(m[1], m[3]), Number(m[2] || 0));
  } else if ((m = /try again in\s+([^.\n]+)/i.exec(s))) {
    let dur = 0;
    const re = /(\d+)\s*(day|dia|hour|hora|hr|h\b|minute|minuto|min|m\b)/gi;
    let p;
    while ((p = re.exec(m[1]))) {
      const n = Number(p[1]); const u = p[2].toLowerCase();
      if (u.startsWith('d')) dur += n * 86400000;
      else if (u.startsWith('h')) dur += n * 3600000;
      else dur += n * 60000;
    }
    if (dur) deData(new Date(ja.getTime() + dur));
  } else if ((m = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(s))) {
    deData(new Date(m[1]));
  }
  const quando = hora ? (dia ? dia + ' às ' + hora : hora) : '';
  return {
    hora, dia, ms,
    texto: quando
      ? 'Limite de uso atingido — libera às ' + quando + '. Não vou retomar sozinho; mande "continue" quando liberar.'
      : 'Limite de uso atingido. O motor não disse quando libera. Não vou retomar sozinho.',
  };
}

/* ---------- que tipo de queda foi ---------- */
// mesma lista da tela (app.js PEDE_LOGIN): a conta pediu login de novo
const RE_LOGIN = /not logged in|please run \/login|oauth (?:token|session)[^.\n]{0,40}expired|invalid api key|authentication_error/i;
// o motor (ou o ssh, ou a pasta) nem existe: religar so' repetiria o erro
const RE_AUSENTE = /ENOENT|não consegui rodar|nao consegui rodar|is not recognized as an internal|não é reconhecido como|command not found|No conversation found/i;
// o ssh ja respondeu um "nao" fechado: chave, host, identidade trocada
const RE_CONFIG = /Permission denied|denied \(publickey|no such identity|Load key|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Could not resolve hostname|Name or service not known|No such file or directory/i;

function tipoDaQueda(texto) {
  const s = String(texto == null ? '' : texto);
  if (RE_LIMITE.test(s)) return 'limite';
  if (RE_LOGIN.test(s)) return 'login';
  if (RE_AUSENTE.test(s)) return 'ausente';
  if (RE_CONFIG.test(s)) return 'config';
  return 'queda';
}

/* ---------- registro das quedas ---------- */
const TETO_LOG = 1024 * 1024;
function criarRegistro(pastaDados) {
  return function registrar(info) {
    try {
      const dir = path.join(typeof pastaDados === 'function' ? pastaDados() : pastaDados, 'logs');
      fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, 'motores.log');
      // passou de 1 MB: vira .1 (o .1 anterior sai) e comeca um novo
      try { if (fs.statSync(arq).size > TETO_LOG) fs.renameSync(arq, arq + '.1'); } catch {}
      const linha = { hora: new Date().toISOString(), ...info };
      if (linha.cauda) linha.cauda = String(linha.cauda).slice(-2000);
      fs.appendFileSync(arq, JSON.stringify(linha) + '\n');
      return arq;
    } catch { return null; }
  };
}

/* ---------- quem esta no meio de um turno ---------- */
/* O main chama:
   - registrarPainel(paneId, {engine, abaId, remoto}) no pane:start
   - ligar(paneId) quando manda uma mensagem (Claude e Codex)
   - desligar(paneId) no stop, no interrupt e no reinicio de proposito
   - passar(paneId, kind, data) dentro do emit(): o fim do turno desliga, o
     endereco da sessao fica guardado e o 'engine-down' sai com emTurno/tipo. */
function criarVigiaDeTurno(opts) {
  const o = opts || {};
  const registrar = o.registrar || (() => {});
  const emTurno = new Map();   // paneId -> desde (ms)
  const info = new Map();      // paneId -> {engine, abaId, remoto, sessaoId}
  /* auditoria 2: limite que chegou NESTE turno pela resposta (nota de erro do
     'result' ou a fala de ERRO que o CLI escreve) -- se o motor morrer logo
     depois, o stderr vem vazio e a queda pareceria queda comum (religar +
     "continue"). Conferencia final: a fala do MODELO nunca conta, nem curta e
     comecando por "You've hit your limit" (ele citando a frase) -- so' a que o
     main marcou erroDoCli (o CLI a escreveu como erro de API). */
  const limiteDoTurno = new Map();   // paneId -> { lim, avisado }
  const dado = (paneId) => { if (!info.has(paneId)) info.set(paneId, {}); return info.get(paneId); };
  return {
    registrarPainel(paneId, extra) { Object.assign(dado(paneId), extra || {}); },
    ligar(paneId) { emTurno.set(paneId, Date.now()); limiteDoTurno.delete(paneId); },
    desligar(paneId) { emTurno.delete(paneId); },
    esta(paneId) { return emTurno.has(paneId); },
    // o painel fechou (stop): o que se sabia dele nao vale mais
    esquecer(paneId) { emTurno.delete(paneId); info.delete(paneId); limiteDoTurno.delete(paneId); },
    passar(paneId, kind, data) {
      if (kind === 'turn-end') { emTurno.delete(paneId); return data; }
      if (kind === 'sessao') { if (data && data.id) dado(paneId).sessaoId = String(data.id); return data; }
      if (kind === 'note') {
        if (!data || !data.error) return data;
        const lim = limiteDeUso(data.text);
        if (lim) limiteDoTurno.set(paneId, { lim, avisado: true });
        return lim ? { ...data, limite: lim } : data;
      }
      if (kind === 'text-final') {
        const lim = data && data.erroDoCli === true ? limiteDeUso(data.text) : null;
        if (lim && !(limiteDoTurno.get(paneId) || {}).avisado) limiteDoTurno.set(paneId, { lim, avisado: false });
        return data;
      }
      if (kind !== 'engine-down') return data;
      const d = data || {};
      const estava = emTurno.has(paneId) && !d.deProposito;
      emTurno.delete(paneId);
      const visto = limiteDoTurno.get(paneId);
      limiteDoTurno.delete(paneId);
      /* so' o 'motivo' (as ultimas linhas que o motor reclamou) decide o tipo.
         A cauda do Codex e' log do Rust: uma linha solta dali ("No such file")
         faria uma queda de verdade parecer erro de configuracao. */
      let tipo = d.deProposito ? 'proposito' : tipoDaQueda(d.motivo || '');
      let lim = tipo === 'limite' ? limiteDeUso(d.motivo || '') : null;
      let jaAvisado = false;
      // morreu calado logo depois de dizer que bateu no limite: e' o limite
      if (visto && visto.lim && (tipo === 'queda' || (tipo === 'limite' && !lim.hora))) {
        tipo = 'limite'; lim = visto.lim; jaAvisado = !!visto.avisado;
      }
      const i = info.get(paneId) || {};
      if (!d.deProposito) {
        registrar({
          motor: d.engine || i.engine || '?', painel: String(paneId), aba: i.abaId || '',
          sessao: i.sessaoId || '', codigo: d.codigo == null ? null : d.codigo, sinal: d.sinal || null,
          emTurno: estava, tipo, remoto: !!(d.remoto || i.remoto), cauda: d.cauda || d.motivo || '',
        });
      }
      const out = { ...d, emTurno: estava, tipo };
      delete out.cauda;   // o rabo inteiro do stderr vai pro log, nao pra tela
      if (lim) out.limite = lim;
      if (jaAvisado) out.limiteJaAvisado = true;   // a tarja ja' saiu pela nota: a tela nao repete
      return out;
    },
    /* quem estava trabalhando agora, com o endereco da conversa. Remoto fica de
       fora: religar la' pode achar o processo antigo ainda vivo no servidor. */
    emTurnoAgora() {
      const lista = [];
      for (const [paneId, desde] of emTurno) {
        const i = info.get(paneId) || {};
        if (!i.sessaoId || i.remoto || !i.engine) continue;
        lista.push({ paneId: String(paneId), sessaoId: i.sessaoId, engine: i.engine, abaId: i.abaId || '', hora: Date.now(), desde });
      }
      return lista;
    },
    // endereco da conversa deste painel (o main confere se outro motor vivo ja' esta nela)
    sessaoDe(paneId) { const i = info.get(paneId); return (i && i.sessaoId) || ''; },
  };
}

/* ---------- retomar.json ---------- */
const DUAS_HORAS = 2 * 3600 * 1000;
function criarRetomada(pastaDados, opts) {
  const maxIdade = (opts && opts.maxIdadeMs) || DUAS_HORAS;
  const arquivo = () => path.join(typeof pastaDados === 'function' ? pastaDados() : pastaDados, 'retomar.json');
  let pool = [];
  let gravado = false;   // o arquivo existe de novo nesta sessao (um shutdown gravou)
  const chave = (x) => String(x.engine) + '|' + String(x.sessaoId);
  const fresco = (x, agora) => x && x.sessaoId && x.engine && (agora - Number(x.hora || 0)) < maxIdade;
  function escrever() {
    const arq = arquivo();
    try {
      if (!pool.length) { try { fs.unlinkSync(arq); } catch {} gravado = false; return; }
      const tmp = arq + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ versao: 1, itens: pool }, null, 1));
      fs.renameSync(tmp, arq);
      gravado = true;
    } catch {}
  }
  return {
    arquivo,
    // boot: le, APAGA o arquivo e fica com o que tem menos de 2 h
    carregar(agora) {
      const t = agora || Date.now();
      let itens = [];
      try { const j = JSON.parse(fs.readFileSync(arquivo(), 'utf8')); itens = Array.isArray(j && j.itens) ? j.itens : []; } catch {}
      try { fs.unlinkSync(arquivo()); } catch {}
      const vistos = new Set();
      pool = itens.filter((x) => fresco(x, t) && !vistos.has(chave(x)) && vistos.add(chave(x)));
      return pool.slice();
    },
    /* shutdown (fechar, recarregar, tela que caiu): soma quem esta em turno ao
       que ainda nao foi pego e grava. Chamado varias vezes seguidas, nao duplica. */
    juntarEGravar(itens) {
      const porChave = new Map(pool.map((x) => [chave(x), x]));
      for (const x of (itens || [])) if (x && x.sessaoId && x.engine) porChave.set(chave(x), x);
      pool = [...porChave.values()];
      escrever();
      return pool.slice();
    },
    /* a tela restaurou um painel: esta conversa estava em turno? Devolve o item
       e o TIRA da lista (e do arquivo, se ele foi regravado): a mesma conversa
       nunca e' retomada duas vezes. */
    pegar(criterio, agora) {
      const c = criterio || {};
      const t = agora || Date.now();
      const i = pool.findIndex((x) => x.engine === c.engine
        && ((c.sessaoId && x.sessaoId === String(c.sessaoId)) || (c.paneId && x.paneId === String(c.paneId))));
      if (i < 0) return null;
      const [item] = pool.splice(i, 1);
      if (gravado) escrever();
      return fresco(item, t) ? item : null;
    },
    pendentes() { return pool.slice(); },
  };
}

module.exports = { limiteDeUso, tipoDaQueda, criarRegistro, criarVigiaDeTurno, criarRetomada, RE_LOGIN, DUAS_HORAS };
