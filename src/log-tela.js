'use strict';
/* Log de erros da tela: userData/logs/tela.log, uma linha JSON por evento.

   Por que existe: o que quebra na tela (erro de script, promessa sem tratamento,
   console.error) e os catch do processo principal não ficavam em lugar nenhum.
   O motores.log (quedas.js) só conta queda de motor. Dois bugs graves (colar
   imagem, por exemplo) passaram calados por causa disso.

   Aqui mora a parte que dá para testar no Node, sem Electron:
   - corta (msg em 2.000 letras, stack em 4.000) e mascara segredo ANTES de gravar;
   - a mesma (origem, tipo, contexto, msg) em menos de 10 s vira UMA linha; a próxima
     gravação dela traz "repeticoes: N";
   - teto de 120 linhas por minuto (o que passar disso conta em descartados());
   - rotação tela.log -> tela.1.log -> tela.2.log, e nenhum arquivo passa de maxBytes;
   - tudo o que der errado no disco é engolido: é o log de erro, não pode derrubar o app.
   Linha: { ts, origem: 'tela'|'main', tipo, msg, stack?, fonte?, linha?, coluna?, contexto?, repeticoes? } */
const path = require('path');

const MAX_MSG = 2000;
const MAX_STACK = 4000;
const MAX_CAMPO = 500;                  // fonte e contexto
const MAX_OBJETO = 500;                 // objeto que virou texto (JSON)
const MAX_BRUTO = 20000;                // o que entra nos regex: texto gigante não deixa o log lento
const JANELA_REPETICAO_MS = 10 * 1000;
const TETO_POR_MINUTO = 120;
const MINUTO_MS = 60 * 1000;
const MAX_CHAVES = 500;                 // memória das repetições

/* Cada padrão leva o segredo INTEIRO: a máscara cobre também o "Bearer " e o "token=".
   Sem \b nos prefixos bem característicos (sk-ant-, ghp_, AIza): o segredo colado
   em outra palavra também some. */
const SEGREDOS = [
  /sk-ant-[\w-]+/g,                                            // Anthropic
  /\bsk-[A-Za-z0-9_-]{20,}/g,                                  // OpenAI e parecidas
  /gh[pousr]_[A-Za-z0-9_]{10,}/g,                              // GitHub (ghp_, gho_, ghu_, ghs_, ghr_)
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /AIza[\w-]{20,}/g,                                           // Google
  /\bBearer\s+[\w.~+/=-]+/gi,
  /"[\w-]*(?:token|secret|password|passwd|senha|api[_-]?key|authorization)"\s*:\s*(?:"[^"]*"|[^\s,}\]]+)/gi,   // {"token":"..."}
  /(?:token|secret|password|passwd|senha|api[_-]?key)=[^\s&"']+/gi,                                            // ?token=..., senha=...
];

function mascarar(texto) {
  let s = texto;
  for (const padrao of SEGREDOS) s = s.replace(padrao, '[segredo]');
  return s;
}

const cortar = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/* Qualquer valor vira texto: mascara primeiro (o corte não pode deixar a ponta de
   um segredo para trás) e só depois corta. Nunca lança. */
function limpar(valor, max) {
  if (valor == null) return '';
  let s;
  try { s = typeof valor === 'string' ? valor : String(valor); } catch { s = '[ilegível]'; }
  if (s.length > MAX_BRUTO) s = s.slice(0, MAX_BRUTO);
  return cortar(mascarar(s), max);
}

/* O que o main faz com o "erro" de um catch (que pode ser qualquer coisa):
   Error vira mensagem + stack; texto fica como está; objeto vira JSON (até 500
   letras); o resto vira String(). Reconhece pelo formato, não pelo instanceof:
   erro que veio de outro "mundo" (a tela, um vm) também conta. */
function descreverErro(valor) {
  try {
    if (valor && typeof valor === 'object' && typeof valor.message === 'string') {
      const r = { msg: valor.message || String(valor.name || 'Error') };
      if (typeof valor.stack === 'string' && valor.stack) r.stack = valor.stack;
      return r;
    }
    if (typeof valor === 'string') return { msg: valor };
    if (valor !== null && (typeof valor === 'object' || typeof valor === 'function')) {
      let json;
      try { json = JSON.stringify(valor); } catch { json = undefined; }
      return { msg: cortar(typeof json === 'string' ? json : String(valor), MAX_OBJETO) };
    }
    return { msg: String(valor) };
  } catch { return { msg: '[ilegível]' }; }
}

function criarLogTela({ dir, maxBytes = 512 * 1024, arquivos = 3, agora = () => Date.now(), fs = require('fs') } = {}) {
  const limiteBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 512 * 1024;
  const quantos = Number.isFinite(arquivos) && arquivos >= 1 ? Math.floor(arquivos) : 3;
  const valido = typeof dir === 'string' && dir.length > 0;
  const arquivoDe = (i) => path.join(dir, i === 0 ? 'tela.log' : 'tela.' + i + '.log');
  const caminho = valido ? arquivoDe(0) : '';

  const recentes = new Map();           // chave -> { desde, suprimidas }
  let janelaDesde = 0, naJanela = 0, descartadas = 0;

  function tempo() {
    let t;
    try { t = Number(agora()); } catch { t = NaN; }
    return Number.isFinite(t) && Math.abs(t) <= 8.64e15 ? t : Date.now();
  }
  function tamanho(arquivo) { try { return fs.statSync(arquivo).size; } catch { return 0; } }
  // o mais velho sai e cada um sobe um degrau; falha de uma troca não impede as outras
  function girar() {
    try { fs.unlinkSync(arquivoDe(quantos - 1)); } catch {}
    for (let i = quantos - 2; i >= 0; i--) { try { fs.renameSync(arquivoDe(i), arquivoDe(i + 1)); } catch {} }
  }
  function podar(t) {
    if (recentes.size < MAX_CHAVES) return;
    for (const [chave, v] of recentes) if (t < v.desde || t - v.desde >= JANELA_REPETICAO_MS) recentes.delete(chave);
  }

  function registrar(entrada) {
    try {
      if (!valido || !entrada || typeof entrada !== 'object') return;
      const t = tempo();
      const origem = limpar(entrada.origem, 20) || 'main';
      const tipo = limpar(entrada.tipo, 40) || 'erro';
      const msg = limpar(entrada.msg, MAX_MSG);
      const contexto = limpar(entrada.contexto, MAX_CAMPO);

      // 1) a mesma coisa de novo, dentro de 10 s: só conta (sai na próxima gravação dela)
      //    O contexto entra na chave: dois catch com a mesma msg não podem esconder um ao outro.
      const chave = JSON.stringify([origem, tipo, contexto, msg]);
      const anterior = recentes.get(chave);
      if (anterior && t >= anterior.desde && t - anterior.desde < JANELA_REPETICAO_MS) { anterior.suprimidas++; return; }

      // 2) teto por minuto (janela que começa na primeira linha dela)
      if (t < janelaDesde || t - janelaDesde >= MINUTO_MS) { janelaDesde = t; naJanela = 0; }
      if (naJanela >= TETO_POR_MINUTO) { descartadas++; return; }

      // 3) monta a linha, na ordem do contrato
      const linha = { ts: new Date(t).toISOString(), origem, tipo, msg };
      const stack = limpar(entrada.stack, MAX_STACK);
      if (stack) linha.stack = stack;
      const fonte = limpar(entrada.fonte, MAX_CAMPO);
      if (fonte) linha.fonte = fonte;
      if (Number.isFinite(entrada.linha)) linha.linha = Math.trunc(entrada.linha);
      if (Number.isFinite(entrada.coluna)) linha.coluna = Math.trunc(entrada.coluna);
      if (contexto) linha.contexto = contexto;
      if (anterior && anterior.suprimidas > 0) linha.repeticoes = anterior.suprimidas;

      // linha maior que o arquivo inteiro: perde a stack; se ainda não couber, não grava
      let texto = JSON.stringify(linha) + '\n';
      if (Buffer.byteLength(texto) > limiteBytes && linha.stack) { delete linha.stack; texto = JSON.stringify(linha) + '\n'; }
      const bytes = Buffer.byteLength(texto);
      if (bytes > limiteBytes) { descartadas++; return; }

      // 4) rotação ANTES de gravar; se a troca não andou (arquivo preso), não cresce além do limite
      fs.mkdirSync(dir, { recursive: true });
      if (tamanho(caminho) + bytes > limiteBytes) {
        girar();
        if (tamanho(caminho) + bytes > limiteBytes) { descartadas++; return; }
      }
      fs.appendFileSync(caminho, texto);

      // só agora o que foi gravado conta (disco que falhou não gasta o teto nem vira "repetida")
      naJanela++;
      podar(t);
      recentes.set(chave, { desde: t, suprimidas: 0 });
    } catch {}
  }

  return { registrar, caminho, descartados: () => descartadas };
}

module.exports = { criarLogTela, descreverErro };
