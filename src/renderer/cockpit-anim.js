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

   Pelo mesmo caminho envelopa window.trocarAbaLocal: o destaque da pasta
   ativa desliza de uma aba para a outra (secao "a pasta ativa", abaixo).

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
  var estado = { planEnvelopado: false, legadoEnvelopado: false, abaEnvelopada: false, originais: {} };

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

  /* -------- a pasta ativa: o destaque VIAJA de uma aba para a outra --------
     Na faixa de pastas (.ck-place-bar) a aba ativa tem fundo e sombra (leva
     5h: ela "levanta" na trilha; antes tinha fundo e sublinhado).
     Sem isto, trocar de pasta apaga o destaque de uma aba e acende o da
     outra. Aqui um "fantasma" com o MESMO fundo, sombra e raio -- lidos
     do estilo COMPUTADO da aba ativa, entao os 4 temas continuam valendo --
     sai do retangulo da aba antiga e chega ao da nova em 220 ms, so' em
     transform (translate + scale). Nada entra na tela: e' o destaque de
     estado mudando de lugar.

     API. Quem troca de pasta (clique na faixa, activate() da Torre, busca,
     Ctrl+Tab) segue chamando window.trocarAbaLocal(id) como sempre: mesmos
     argumentos, e volta a MESMA Promise da original. O envelope mede as duas
     abas e dispara a viagem ANTES de chamar a original, sem esperar a
     repintura; o que e' dele mora em try/catch e nunca derruba a troca. A
     viagem se encerra sozinha. CockpitAnim.desligar() devolve a original e
     encerra a viagem em curso; CockpitAnim.religar() liga de novo.

     UM DESTAQUE POR VEZ. O renderNavigator acende a aba nova no quadro
     seguinte, com o fantasma ainda no caminho; no app de verdade a antiga so'
     apaga depois do await de guardarPaineisDaAba. Como o groupFor
     REAPROVEITA o botao (cache por chave), o destaque real das duas abas fica
     apagado por estilo inline durante a viagem e volta no fim. O transition
     sai junto: sem isso o fade de 120 ms da secao 11 do CSS deixaria o fundo
     antigo sumindo devagar ao lado do fantasma.

     POR BAIXO DO NOME. O fundo da aba e' opaco nos 4 temas: um fantasma por
     cima da faixa apagaria os nomes no caminho. Ele nasce DENTRO da faixa com
     z-index -1, e a faixa vira contexto de empilhamento (isolation) so'
     enquanto ele existe: fica acima do fundo da faixa, abaixo dos nomes, e
     abaixo de menu, popup e modal, que tem z-index proprio fora da faixa.

     O FIM ESPERA A REPINTURA. Se a viagem termina antes dela, o fantasma fica
     parado na aba nova e olha de novo a cada 40 ms; se a troca desistiu (o
     app ficou na aba antiga), ele sai. Teto de 2 s: nada da viagem passa dele.

     NAO ANIMA quando: mesma aba; troca ja em andamento (trocandoAba); exclusao
     de aba em andamento (apagandoAba: o app recusa o clique); a repintura
     anterior ainda nao chegou; aba antiga ou nova cortada pela rolagem
     lateral; prefers-reduced-motion; alguma das duas abas nao achada. */
  var ABA_MS = 220;
  var ABA_CURVA = 'cubic-bezier(.2,.8,.2,1)';
  var ABA_OLHA = 40;          // ms entre olhadas na repintura, depois da viagem
  var ABA_TETO = 2000;        // seguranca: some com tudo, aconteca o que for
  /* transition PRIMEIRO: a volta desfaz a lista de tras pra frente, e ele so'
     volta depois que o fundo real ja foi aplicado */
  var ABA_APAGA = [['transition', 'none'], ['background-color', 'transparent'], ['box-shadow', 'none']];
  var viagem = null;          // a viagem em curso -- uma por vez

  /* trocandoAba, apagandoAba e cfg sao 'let' de topo do app.js: moram no escopo
     global dos scripts classicos, mas NAO em window. typeof cobre o app sem
     elas; o try cobre a zona morta (TDZ) se o app.js parou antes de declara-las.
     apagandoAba (apagarAbaLocal em curso): o app recusa todo clique de troca ate'
     ela acabar, entao o destaque nao pode viajar para uma troca que nao vem. */
  function trocaEmCurso() {
    try {
      return (typeof trocandoAba !== 'undefined' && !!trocandoAba)
        || (typeof apagandoAba !== 'undefined' && !!apagandoAba);
    }
    catch (e) { return true; }            // sem saber, nao anima
  }
  function abaDoApp() {
    try { return typeof cfg === 'object' && cfg ? cfg.abaAtiva : undefined; }
    catch (e) { return undefined; }
  }
  /* lido na hora, nao so' no carregamento: a preferencia do sistema pode
     mudar com o app aberto */
  function menosMovimento() {
    try { return raiz.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return reduzido; }
  }

  /* a aba ativa NA TELA (data-current, que a repintura poe na secao) e a
     aba destino (data-place-id, que o groupFor poe no botao) */
  function acharAbas(novoId) {
    var bar = document.querySelector('.ck-place-bar');
    if (!bar) return null;
    var cabecas = bar.querySelectorAll('.ck-place-only > .ck-group-head');
    var antiga = null, nova = null;
    for (var i = 0; i < cabecas.length; i++) {
      if (cabecas[i].parentElement.getAttribute('data-current') === 'true') antiga = cabecas[i];
      if (cabecas[i].dataset.placeId === String(novoId)) nova = cabecas[i];
    }
    return antiga && nova ? { bar: bar, antiga: antiga, nova: nova } : null;
  }

  /* inteira dentro da parte visivel da faixa, que rola na horizontal */
  function inteira(r, bar) {
    var caixa = bar.getBoundingClientRect();
    var esq = caixa.left + bar.clientLeft, dir = esq + bar.clientWidth;
    return r.width > 0 && r.height > 0 && r.left >= esq - 0.5 && r.right <= dir + 0.5;
  }

  /* estilo inline com volta garantida: guarda valor e prioridade de cada
     propriedade; se o elemento nao tinha atributo style, tira o que sobrar */
  function marcarInline(el, pares) {
    var guardado = { el: el, semStyle: !el.hasAttribute('style'), props: [] };
    for (var i = 0; i < pares.length; i++) {
      var p = pares[i][0];
      guardado.props.push([p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      el.style.setProperty(p, pares[i][1], 'important');
    }
    return guardado;
  }
  function devolverInline(guardado) {
    var el = guardado.el;
    for (var i = guardado.props.length - 1; i >= 0; i--) {
      var p = guardado.props[i];
      /* ler o estilo aqui aplica o fundo real com o transition ainda 'none':
         o destaque volta inteiro, sem o fade de 120 ms */
      if (p[0] === 'transition') void getComputedStyle(el).backgroundColor;
      if (p[1]) el.style.setProperty(p[0], p[1], p[2]);
      else el.style.removeProperty(p[0]);
    }
    if (guardado.semStyle && !el.getAttribute('style')) el.removeAttribute('style');
  }

  function prepararViagem(novoId) {
    /* so' a troca que o app vai MESMO fazer mexe no destaque: na mesma aba, ou
       com outra troca em andamento, a original volta sem trocar (a da fila
       passa por aqui de novo quando a primeira acabar) */
    if (trocaEmCurso() || String(novoId) === String(abaDoApp())) return;
    /* uma viagem por vez: a nova sai de onde o fantasma anterior esta agora */
    var desde = viagem ? onde(viagem) : null;
    encerrarViagem();
    if (menosMovimento()) return;
    var abas = acharAbas(novoId);
    if (!abas || abas.antiga === abas.nova) return;
    /* a repintura da troca anterior ainda nao chegou: o destaque na tela nao
       e' o da aba em que o app esta, e sair dele seria sair do lugar errado */
    var ativa = abaDoApp();
    if (ativa !== undefined && abas.antiga.dataset.placeId !== String(ativa)) return;
    var ra = abas.antiga.getBoundingClientRect(), rn = abas.nova.getBoundingClientRect();
    if (!inteira(ra, abas.bar) || !inteira(rn, abas.bar)) return;
    viajar(abas, desde && desde.width > 0 && desde.height > 0 ? desde : ra, rn);
  }

  function viajar(abas, de, ate) {
    var cs = getComputedStyle(abas.antiga);   // o destaque real, antes de apagar
    var g = document.createElement('div');
    g.className = 'mv-aba-fantasma';
    g.setAttribute('aria-hidden', 'true');
    g.style.left = de.left + 'px';
    g.style.top = de.top + 'px';
    g.style.width = de.width + 'px';
    g.style.height = de.height + 'px';
    g.style.backgroundColor = cs.backgroundColor;
    g.style.boxShadow = cs.boxShadow;
    g.style.borderRadius = cs.borderRadius;
    var v = { antiga: abas.antiga, nova: abas.nova, de: abas.antiga.dataset.placeId,
      g: g, anim: null, inline: [], acabou: false, limpo: false, olhando: 0, teto: 0 };
    viagem = v;
    v.teto = setTimeout(function () { fim(v); }, ABA_TETO);   // antes de mexer em qualquer coisa
    v.inline.push(marcarInline(abas.antiga, ABA_APAGA));
    v.inline.push(marcarInline(abas.nova, ABA_APAGA));
    v.inline.push(marcarInline(abas.bar, [['isolation', 'isolate']]));
    abas.bar.appendChild(g);
    v.anim = g.animate([
      { transform: 'translate(0px, 0px) scale(1, 1)' },
      { transform: 'translate(' + (ate.left - de.left) + 'px, ' + (ate.top - de.top) + 'px) scale(' +
        (ate.width / de.width) + ', ' + (ate.height / de.height) + ')' }
    ], { duration: ABA_MS, easing: ABA_CURVA, fill: 'forwards' });
    v.anim.onfinish = function () { v.acabou = true; olhar(v); };
    v.anim.oncancel = function () { fim(v); };
  }

  /* depois da viagem: sai quando a repintura chegou (a antiga deixou de ser a
     atual, ou a nova virou) ou quando a troca desistiu (o app ficou na antiga).
     Roda fora do envelope (no finish e no relogio), entao tem o proprio try. */
  function olhar(v) {
    if (v.limpo || !v.acabou) return;
    var pronto = true;                    // na duvida, limpa
    try {
      var repintou = !v.antiga.isConnected || !v.nova.isConnected ||
        v.antiga.parentElement.getAttribute('data-current') !== 'true' ||
        v.nova.parentElement.getAttribute('data-current') === 'true';
      var desistiu = !trocaEmCurso() && String(abaDoApp()) === v.de;
      pronto = repintou || desistiu;
    } catch (e) { /* segue com pronto */ }
    if (pronto) fim(v);
    else v.olhando = setTimeout(function () { olhar(v); }, ABA_OLHA);
  }

  function onde(v) {
    try { return v.g.isConnected ? v.g.getBoundingClientRect() : null; }
    catch (e) { return null; }
  }

  /* fantasma fora e estilos de volta NA MESMA tarefa: nenhum quadro fica sem
     destaque nem com dois. Cada passo no seu try: um erro nao prende o resto. */
  function fim(v) {
    if (v.limpo) return;
    v.limpo = true;
    clearTimeout(v.teto);
    clearTimeout(v.olhando);
    if (viagem === v) viagem = null;
    try { if (v.anim) { v.anim.onfinish = v.anim.oncancel = null; v.anim.cancel(); } } catch (e) { /* segue */ }
    try { v.g.remove(); } catch (e) { /* segue */ }
    for (var i = 0; i < v.inline.length; i++) {
      try { devolverInline(v.inline[i]); } catch (e) { /* segue */ }
    }
  }
  function encerrarViagem() { if (viagem) fim(viagem); }

  /* -------- quanto tempo o passo atual ja leva --------
     O plano diz O QUE esta sendo feito; o tempo diz se esta andando. Passo
     parado ha 20 min e' sinal de que travou (ou de que o plano ficou velho).
     UM relogio so' para todos os paineis, e so' enquanto algum painel OCUPADO
     tem passo em andamento: o turno acabou ou o painel fechou, o tempo some e
     o painel sai da conta. O passo mudou (outra posicao ou outro texto), zera.
     Painel guardado em outra pasta segue contando: ele continua trabalhando no
     fundo (guardarPaineisDaAba, app.js). E' texto que muda, nao animacao --
     nada pisca --, por isso vale tambem com movimento reduzido.
     Leva 4: vai no title do passo. */
  var passos = new Map();   // painel -> { chave, desde, el }
  var relogioPasso = 0;
  function duracao(ms) {
    // o formato do "trabalhando…" do painel: "45s", "3m05s"
    if (typeof raiz.duracaoCurta === 'function') return raiz.duracaoCurta(ms);
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
  }
  function chaveDoPasso(lista) {
    var l = Array.isArray(lista) ? lista : [];
    for (var i = 0; i < l.length; i++) if (eAtual(l[i])) return i + '|' + (l[i].txt || '');
    for (var j = 0; j < l.length; j++) if (!eFeito(l[j])) return j + '|' + (l[j].txt || '');
    return '';   // tudo feito: nao ha passo correndo
  }
  function soltarPasso(p) {
    var reg = passos.get(p);
    // UI 3.4: o tempo do passo mora no title do proprio passo (nao e' mais um elemento a tirar). title="" sobrando
    // calaria o tooltip do botao do plano em cima do passo: com a barra no DOM de verdade, o atributo sai de vez
    if (reg && reg.el) { reg.el.title = ''; if (reg.el.removeAttribute) reg.el.removeAttribute('title'); }
    passos.delete(p);
    if (!passos.size && relogioPasso) { clearInterval(relogioPasso); relogioPasso = 0; }
  }
  function tiquePasso() {
    passos.forEach(function (reg, p) {
      if (!p || p.morto || !p.busy) { soltarPasso(p); return; }
      if (reg.el) reg.el.title = 'Neste passo há ' + duracao(Date.now() - reg.desde);
    });
  }
  function tempoDoPasso(p) {
    if (!p || !p.el) return;
    var linha = p.el.querySelector('.ck-plan .ck-plan-line');
    var chave = chaveDoPasso(p.plano);
    if (!linha || !chave || !p.busy || p.morto) { soltarPasso(p); return; }
    var reg = passos.get(p);
    if (!reg || reg.chave !== chave) reg = { chave: chave, desde: Date.now(), el: null };
    /* UI 3.4: um relogio so' por coluna (o do "trabalhando…"); o tempo do passo vai no hover do proprio passo. O
       CockpitUI.plan recria a barra inteira a cada atualizacao: o title volta junto. */
    var el = linha.querySelector('.ck-plan-current');
    if (!el) { soltarPasso(p); return; }
    el.title = 'Neste passo há ' + duracao(Date.now() - reg.desde);
    reg.el = el;
    passos.set(p, reg);
    if (!relogioPasso) relogioPasso = setInterval(tiquePasso, 1000);
  }
  function pararTempoDoPasso() {
    passos.forEach(function (reg, p) { soltarPasso(p); });
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
        try { tempoDoPasso(p); } catch (e) { /* idem: o relogio e' enfeite */ }
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

    /* trocarAbaLocal e' funcao de topo do app.js (script classico): mora em
       window, e as chamadas "trocarAbaLocal(id)" do app e do cockpit-ui.js
       leem window na hora -- passam todas por aqui */
    if (typeof raiz.trocarAbaLocal === 'function' && !estado.abaEnvelopada) {
      estado.originais.trocarAbaLocal = raiz.trocarAbaLocal;
      raiz.trocarAbaLocal = function (novoId) {
        /* mede e dispara ANTES da original: a repintura vem depois, e a
           viagem tem que sair do destaque que ainda esta na tela */
        try { prepararViagem(novoId); } catch (e) { encerrarViagem(); /* enfeite nunca derruba a troca */ }
        return estado.originais.trocarAbaLocal.apply(this, arguments);
      };
      estado.abaEnvelopada = true;
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
    if (estado.abaEnvelopada && estado.originais.trocarAbaLocal) {
      raiz.trocarAbaLocal = estado.originais.trocarAbaLocal;
      estado.abaEnvelopada = false;
    }
    encerrarViagem();
    pararTempoDoPasso();
  }

  /* tenta agora; se cockpit-ui.js ainda nao publicou o CockpitUI, tenta mais
     algumas vezes e desiste — nada aqui fica batendo pra sempre */
  var tentativas = 0;
  (function tentar() {
    envelopar();
    if ((estado.planEnvelopado && estado.abaEnvelopada) || tentativas >= 12) return;
    tentativas++;
    setTimeout(tentar, 250);
  })();

  raiz.CockpitAnim = {
    flash: flash, tempo: tempo, orb: orb, marcar: marcar,
    desligar: desligar, religar: envelopar,
    reduzido: function () { return reduzido; },
    status: function () {
      return { plan: estado.planEnvelopado, legado: estado.legadoEnvelopado, aba: estado.abaEnvelopada, reduzido: reduzido, passos: passos.size, relogio: !!relogioPasso };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
