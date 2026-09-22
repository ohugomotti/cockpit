/* ============================================================================
   cockpit-anim.js — o minimo de JS que a camada de movimento precisa (v2)
   Vanilla, sem dependencia, sem build. Casa com cockpit-anim.css.

   POR QUE EXISTE: o plano e recriado inteiro a cada atualizacao
   (CockpitUI.plan faz bar.replaceChildren()). Se a conclusao fosse animada por
   CSS de estado, TODOS os segmentos ja feitos re-animariam a cada passo — a
   barra piscaria o turno inteiro. Este arquivo compara o antes e o depois e
   marca so o que mudou.

   COMO FAZ: envelopa CockpitUI.plan. Nao usa MutationObserver de proposito —
   durante o streaming de resposta o DOM muda a cada quadro, e um observer no
   documento cobraria esse preco o tempo todo. O envelope custa uma comparacao
   de array por atualizacao de plano, e nada no resto.

   Carregar DEPOIS de cockpit-ui.js:
       <script src="cockpit-anim.js"></script>
   Nao precisa chamar nada: ele se liga sozinho. Para desligar em tempo de
   execucao: CockpitAnim.desligar()
   ============================================================================ */
(function (raiz) {
  'use strict';

  var reduzido = false;
  try {
    reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* ambiente sem matchMedia: segue com movimento */ }

  var LIMPA = 420;          // ms ate tirar a classe de animacao
  var MAX_SEGMENTOS = 12;   // acima disso o Cockpit troca a barra por <progress>
  var estado = { planEnvelopado: false, legadoEnvelopado: false, originais: {} };

  /* -------- utilitarios de uso manual (nada disto roda sozinho) -------- */
  function marcar(el, classe) {
    if (!el || reduzido) return;
    el.classList.remove(classe);
    void el.offsetWidth;            // reflow: sem isto a mesma animacao nao reinicia
    el.classList.add(classe);
    setTimeout(function () { el.classList.remove(classe); }, LIMPA);
  }

  function flash(el, valor) {
    if (!el) return;
    var novo = String(valor);
    if (el.textContent === novo) return;   // nao mudou, nao pisca
    el.textContent = novo;
    marcar(el, 'mv-flash');
  }

  function tempo(el, desde) {
    if (!el) return { parar: function () {} };
    var t0 = desde || Date.now();
    el.classList.add('mv-tempo');
    function pinta() {
      var s = Math.max(0, Math.round((Date.now() - t0) / 1000));
      if (s < 60) el.textContent = s + 's';
      else {
        var m = Math.floor(s / 60), r = s % 60;
        el.innerHTML = m + '<span class="mv-sep">:</span>' + (r < 10 ? '0' + r : r);
      }
    }
    pinta();
    var id = setInterval(pinta, 1000);
    return { parar: function () { clearInterval(id); }, zerar: function () { t0 = Date.now(); pinta(); } };
  }

  var ESTADOS_ORB = ['pensando', 'escrevendo', 'espera', 'feito'];
  function orb(el, e) {
    if (!el) return;
    el.classList.add('mv-orb');
    ESTADOS_ORB.forEach(function (x) { if (x !== e) el.classList.remove(x); });
    if (e && ESTADOS_ORB.indexOf(e) >= 0) el.classList.add(e);
  }

  /* -------- leitura do plano: do array, nao do DOM -------- */
  function eFeito(it) { return it && it.estado === 'feito'; }
  function eAtual(it) {
    return it && ['fazendo', 'andamento', 'em_andamento', 'in_progress'].indexOf(it.estado) >= 0;
  }
  function resumo(lista) {
    var l = Array.isArray(lista) ? lista : [];
    var feitos = 0, atual = null;
    for (var i = 0; i < l.length; i++) {
      if (eFeito(l[i])) feitos++;
      else if (!atual && eAtual(l[i])) atual = l[i];
    }
    if (!atual) for (var j = 0; j < l.length; j++) if (!eFeito(l[j])) { atual = l[j]; break; }
    return {
      total: l.length,
      feitos: feitos,
      atual: (atual && atual.txt) || '',
      /* o mapa de quem ja estava feito, por posicao: e ele que diz QUAL segmento
         virou agora, em vez de re-animar todos os concluidos */
      mapa: l.map(eFeito)
    };
  }

  /* -------- o que animar depois que o Cockpit redesenhou o plano -------- */
  function aplicarPlano(p, antes, depois) {
    if (reduzido || !p || !p.el) return;
    var bar = p.el.querySelector('.ck-plan');
    if (!bar) return;

    // 1. segmento que acabou de concluir (so os que mudaram de posicao)
    var segs = bar.querySelectorAll('.ck-plan-segment');
    if (segs.length && depois.total <= MAX_SEGMENTOS) {
      for (var i = 0; i < depois.mapa.length && i < segs.length; i++) {
        var eraFeito = antes && antes.mapa ? antes.mapa[i] === true : false;
        if (depois.mapa[i] && !eraFeito) marcar(segs[i], 'mv-feito');
      }
    }
    // 2. o texto do passo atual trocou
    if (!antes || antes.atual !== depois.atual) {
      marcar(bar.querySelector('.ck-plan-current'), 'mv-troca');
    }
    // 3. o contador mudou
    if (!antes || antes.feitos !== depois.feitos || antes.total !== depois.total) {
      marcar(bar.querySelector('.ck-plan-total'), 'mv-flash');
    }
  }

  /* -------- caminho legado (.pl-*), quando nao ha CockpitUI -------- */
  function aplicarLegado(p, antes, depois) {
    if (reduzido || !p || !p.el) return;
    var cx = p.el.querySelector('.pane-plano');
    if (!cx) return;
    var itens = cx.querySelectorAll('.pl-item');
    for (var i = 0; i < itens.length && i < depois.mapa.length; i++) {
      var eraFeito = antes && antes.mapa ? antes.mapa[i] === true : false;
      var existia = antes ? i < antes.total : false;
      if (depois.mapa[i] && !eraFeito) marcar(itens[i], 'mv-feito');
      else if (!existia) marcar(itens[i], 'mv-novo');
    }
    if (!antes || antes.feitos !== depois.feitos || antes.total !== depois.total) {
      marcar(cx.querySelector('.pl-conta'), 'mv-flash');
    }
  }

  /* -------- o envelope -------- */
  function envelopar() {
    var ok = false;

    if (raiz.CockpitUI && typeof raiz.CockpitUI.plan === 'function' && !estado.planEnvelopado) {
      estado.originais.plan = raiz.CockpitUI.plan;
      raiz.CockpitUI.plan = function (p, itens) {
        var antes = p ? resumo(p.plano) : null;
        var r = estado.originais.plan.apply(this, arguments);
        try { aplicarPlano(p, antes, resumo(itens)); } catch (e) { /* nunca derruba o render */ }
        return r;
      };
      estado.planEnvelopado = true;
      ok = true;
    }

    if (typeof raiz.desenharPlano === 'function' && !estado.legadoEnvelopado) {
      estado.originais.desenharPlano = raiz.desenharPlano;
      raiz.desenharPlano = function (p, itens) {
        var antes = p ? resumo(p.plano) : null;
        var r = estado.originais.desenharPlano.apply(this, arguments);
        try { aplicarLegado(p, antes, resumo(itens)); } catch (e) { /* idem */ }
        return r;
      };
      estado.legadoEnvelopado = true;
      ok = true;
    }
    return ok;
  }

  function desligar() {
    if (estado.planEnvelopado && estado.originais.plan) {
      raiz.CockpitUI.plan = estado.originais.plan;
      estado.planEnvelopado = false;
    }
    if (estado.legadoEnvelopado && estado.originais.desenharPlano) {
      raiz.desenharPlano = estado.originais.desenharPlano;
      estado.legadoEnvelopado = false;
    }
  }

  /* tenta agora; se cockpit-ui.js ainda nao publicou o CockpitUI, tenta mais
     algumas vezes e desiste — nada aqui fica batendo pra sempre */
  var tentativas = 0;
  (function tentar() {
    envelopar();
    if (estado.planEnvelopado || tentativas >= 12) return;
    tentativas++;
    setTimeout(tentar, 250);
  })();

  raiz.CockpitAnim = {
    flash: flash, tempo: tempo, orb: orb, marcar: marcar,
    desligar: desligar, religar: envelopar,
    reduzido: function () { return reduzido; },
    status: function () {
      return { plan: estado.planEnvelopado, legado: estado.legadoEnvelopado, reduzido: reduzido };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
