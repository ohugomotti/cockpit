/* Log de erros da tela. É o PRIMEIRO <script> do index.html: tudo que quebra
   depois dele deixa rastro em userData/logs/tela.log, pelo caminho
   window.api.logTela -> canal 'tela:log' -> processo principal (src/log-tela.js).
   - erro de script (evento "error") e script/CSS que nem carregou;
   - promessa sem tratamento (evento "unhandledrejection");
   - console.error (o original continua rodando, igualzinho).
   Sem dependências. Sem window.api (a prévia de QA no navegador comum) não faz
   nada, e o console.error segue funcionando. Nunca lança e nunca esconde o erro
   do console: só anota. */
(function () {
  'use strict';

  var w = typeof window !== 'undefined' ? window : globalThis;
  if (!w || w.__cockpitLogTela) return;          // carregado duas vezes: não duplica o registro
  w.__cockpitLogTela = true;

  var MAX_MSG = 2000, MAX_STACK = 4000, MAX_CAMPO = 500, MAX_OBJETO = 500;
  var enviando = false;

  function cortar(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }
  function ehErro(v) { return !!v && typeof v === 'object' && typeof v.message === 'string'; }

  // JSON.stringify protegido: ciclo, BigInt, getter que lança e objeto enorme viram texto curto
  function json(v) {
    var passos = 0;
    try {
      var s = JSON.stringify(v, function (_chave, valor) { if (++passos > 2000) throw 0; return valor; });
      return typeof s === 'string' ? s : String(v);
    } catch (e) {
      try { return String(v); } catch (e2) { return '[ilegível]'; }
    }
  }

  // um valor qualquer vira um texto curto: Error = mensagem; objeto = JSON (até 500 letras)
  function texto(v) {
    try {
      if (typeof v === 'string') return v;
      if (ehErro(v)) return v.message || String(v.name || 'Error');
      if (v !== null && (typeof v === 'object' || typeof v === 'function')) return cortar(json(v), MAX_OBJETO);
      return String(v);
    } catch (e) { return '[ilegível]'; }
  }

  function pilha(v) {
    try { return ehErro(v) && typeof v.stack === 'string' && v.stack ? cortar(v.stack, MAX_STACK) : ''; }
    catch (e) { return ''; }
  }

  /* Manda e esquece. A ponte é procurada a cada envio (na prévia de QA ela pode
     aparecer depois). "enviando" corta o laço: um console.error (ou um erro)
     disparado de DENTRO do logTela não é registrado de novo. */
  function mandar(entrada) {
    if (enviando) return;
    var api;
    try { api = w.api; } catch (e) { return; }
    if (!api || typeof api.logTela !== 'function') return;
    enviando = true;
    try {
      var r = api.logTela(entrada);
      // promessa rejeitada da ponte não pode virar outro "unhandledrejection", que voltaria pra cá
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) {
      // a ponte quebrou: não há onde registrar isso, e tentar seria o laço
    } finally { enviando = false; }
  }

  function aoErro(ev) {
    try {
      if (!ev) return;
      var alvo = ev.target, entrada;
      if (alvo && alvo !== w && alvo.tagName) {
        // recurso que nem carregou (o evento só chega aqui por causa da captura): só script e CSS importam
        var tag = String(alvo.tagName).toLowerCase();
        if (tag !== 'script' && !(tag === 'link' && /stylesheet/i.test(String(alvo.rel || '')))) return;
        entrada = { tipo: 'erro', msg: cortar('Falha ao carregar ' + tag + ' ' + String(alvo.src || alvo.href || ''), MAX_MSG) };
      } else {
        entrada = { tipo: 'erro', msg: cortar(typeof ev.message === 'string' ? ev.message : texto(ev.error), MAX_MSG) };
        if (ev.filename) entrada.fonte = cortar(String(ev.filename), MAX_CAMPO);
        if (typeof ev.lineno === 'number') entrada.linha = ev.lineno;
        if (typeof ev.colno === 'number') entrada.coluna = ev.colno;
        var s = pilha(ev.error);
        if (s) entrada.stack = s;
      }
      mandar(entrada);
    } catch (e) {}
  }

  function aoRejeitar(ev) {
    try {
      var motivo = ev && ev.reason;
      var entrada = { tipo: 'promessa', msg: cortar(texto(motivo), MAX_MSG) };
      var s = pilha(motivo);
      if (s) entrada.stack = s;
      mandar(entrada);
    } catch (e) {}
  }

  function ligarConsole() {
    var c = (typeof console !== 'undefined' && console) || w.console;
    if (!c || typeof c.error !== 'function') return;
    var original = c.error;
    c.error = function () {
      var args = arguments;
      // o original primeiro e sempre: o que aparece no console não depende do log
      try { return original.apply(c, args); }
      finally {
        try {
          var partes = [], stack = '';
          for (var i = 0; i < args.length; i++) {
            partes.push(texto(args[i]));
            if (!stack) stack = pilha(args[i]);
          }
          var entrada = { tipo: 'console', msg: cortar(partes.join(' '), MAX_MSG) };
          if (stack) entrada.stack = stack;
          mandar(entrada);
        } catch (e) {}
      }
    };
  }

  // cada passo sozinho: um ambiente sem addEventListener não impede o resto
  try { w.addEventListener('error', aoErro, true); } catch (e) {}
  try { w.addEventListener('unhandledrejection', aoRejeitar); } catch (e) {}
  try { ligarConsole(); } catch (e) {}
})();
