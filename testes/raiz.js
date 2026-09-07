/* Onde fica a raiz do projeto (a pasta que tem src/main.js).

   Os testes rodam de dois lugares: da raiz, durante o desenvolvimento, e de
   dentro de testes/ aqui no repositorio. Em vez de cada um adivinhar, sobe os
   diretorios ate achar o src/ de verdade. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function raizDoProjeto(comeco) {
  let d = comeco || __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'src', 'main.js'))) return d;
    const acima = path.dirname(d);
    if (acima === d) break;
    d = acima;
  }
  return comeco || __dirname;
}

const RAIZ = raizDoProjeto();

/* Alguns testes comparam com uma copia anterior do codigo (src-original,
   src-antes-leva18...) pra provar que o bug existia. Essas copias ficam na
   maquina de quem corrigiu, nao no repositorio - entao aqui elas sao
   OPCIONAIS: quem nao achar, pula a comparacao em vez de quebrar. */
function versaoAnterior(nome) {
  const p = path.join(RAIZ, nome);
  return fs.existsSync(path.join(p, 'renderer', 'app.js')) || fs.existsSync(path.join(p, 'main.js')) ? p : null;
}

/* Pega um trecho do fonte contando chave por chave. Vale para "function x(" e
   para "const X = {": em ambos o bloco comeca na primeira { depois da
   assinatura. */
function pegarBloco(txt, assinatura, nome) {
  const i = txt.indexOf(assinatura);
  if (i < 0) throw new Error('nao achei ' + (nome || assinatura));
  let nivel = 0;
  for (let k = txt.indexOf('{', i); k < txt.length; k++) {
    if (txt[k] === '{') nivel++;
    else if (txt[k] === '}') { nivel--; if (nivel === 0) return txt.slice(i, k + 1); }
  }
  throw new Error('nao fechei ' + (nome || assinatura));
}

const lerFonte = (...partes) => fs.readFileSync(path.join(RAIZ, 'src', ...partes), 'utf8');

/* O vm.createContext nasce sem timers e sem os globais que o app.js declara
   fora das funcoes. Como os testes extraem funcoes soltas, esses nomes ficam
   livres. Aqui vao os minimos, para o teste falhar por bug de verdade e nao
   por falta de andaime. */
function globaisFalsos() {
  return {
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: (fn) => fn(),
    requestAnimationFrame: (fn) => { fn(0); return 0; },
    cancelAnimationFrame: () => {},
    fichasPendentes: new Map(),
    /* a troca de motor recusa motor que nao esta na maquina (leva 31). Aqui
       todos existem por padrao; o teste que quiser provar a recusa sobrescreve. */
    motorDisponivel: { claude: true, codex: true, gemini: true, grok: true },
    COMO_INSTALAR: {},
    /* leva 32: limpezas de conversa que a troca de motor passou a chamar */
    limparPlano: () => {},
    limparAuditoria: () => {},
    limparSugestoes: () => {},
    zerarTurno: () => {},
    /* levas 33/34: legenda do trabalhando, linha do tempo sem teto, continuar,
       diff tardio do ACP - os testes extraem textDelta/textFinal/passo soltos */
    legendarTrabalho: () => {},
    ajustarCaixaDePassos: () => {},
    tipoDoPasso: () => "outro",
    anexarMudancaAoPasso: () => {},
    limparContinuar: () => {},
    mostrarContinuar: () => {},
    /* leva 35: recibo no fim da fala e perfis de conectores da aba */
    marcarRecibo: () => {},
    conectoresForaDaAba: () => undefined,
    // estes dois o recolherCaixa usa de verdade: contar so' os .passo e rotular erros
    passosDaCaixa: (box) => [...box.children].filter((x) => x.classList && x.classList.contains("passo")),
    rotuloDeErros: (erros) => (erros ? " · " + erros + (erros === 1 ? " erro" : " erros") : ""),
    /* A tela pergunta ao registro quem e' cada motor. Nos testes o registro de
       verdade e' usado, para o teste continuar provando o comportamento certo
       (ex: Codex nao roda em servidor remoto) e nao uma versao de mentira. */
    ...registroDeMotores(),
    Map, Set, JSON, Date, Math, Promise, Array, Object, String, Number, Boolean, RegExp, Error,
  };
}

/* O registro de motores voltou pra DENTRO do app.js (const NOME_MOTOR / MOTORES)
   quando a leva 28 foi empacotada -- os arquivos motores.js e motor-turno.js
   foram um passo intermediario e nao existem no app.asar. Em vez de exigir um
   modulo que ja nao existe, o andaime le as tabelas direto do fonte que vai pro
   asar: assim o teste continua provando o comportamento do codigo de verdade. */
function registroDeMotores() {
  let txt = '';
  try { txt = lerFonte('renderer', 'app.js'); } catch { return {}; }
  const ctx = {};
  vm.createContext(ctx);
  /* "const X = ..." dentro do vm cria uma variavel de bloco: ela NAO vira
     propriedade do contexto e some assim que a linha acaba. Por isso aqui so' o
     valor e' avaliado, entre parenteses, e o retorno e' lido direto. */
  const valorDe = (decl) => {
    const i = txt.indexOf(decl);
    if (i < 0) return null;
    const fim = txt.indexOf(';', i + decl.length);
    if (fim < 0) return null;
    try { return vm.runInContext('(' + txt.slice(i + decl.length, fim) + ')', ctx); } catch { return null; }
  };
  const NOME_MOTOR = valorDe('const NOME_MOTOR = ') || {};
  const MOTORES = valorDe('const MOTORES = ') || [];
  if (!MOTORES.length) return {};
  const nomeDoMotor = (eng) => NOME_MOTOR[eng] || 'Claude';
  return {
    NOME_MOTOR, MOTORES, nomeDoMotor,
    // apelidos de quando o registro era um modulo separado
    nomeMotor: nomeDoMotor,
    proximoMotor: (atual) => MOTORES[(MOTORES.indexOf(atual) + 1 + MOTORES.length) % MOTORES.length],
  };
}

module.exports = { RAIZ, raizDoProjeto, versaoAnterior, globaisFalsos, registroDeMotores, pegarBloco, lerFonte };
