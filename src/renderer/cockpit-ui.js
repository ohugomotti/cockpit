/* Apresentação: sessões e processos continuam pertencendo ao app.js. */
(function (root) {
  "use strict";
  const STATES = {
    attention: { glyph: "!", label: "Sua vez", rank: 0 },
    working: { glyph: "◌", label: "Trabalhando", rank: 1 },
    done: { glyph: "✓", label: "Concluída não lida", rank: 2 },
    saved: { glyph: "○", label: "Guardado", rank: 3 },
  };
  function stateOf(p) {
    if (
      p.pedindoPerm ||
      p.filaPerm?.length ||
      // Tarefa 8: o plano pronto do Claude esperando o Executar ou o Ajustar
      p.planoPendente ||
      (p.perguntaAberta && p.perguntaAberta.bloqueante !== false)
    )
      return "attention";
    if (p._religar) return "working";
    if (
      ["error", "erro"].includes(p.uiLastState) ||
      p.uiTerminalError ||
      p.uiInterrupted ||
      p.morto
    )
      return "attention";
    if (p.busy || p.queued) return "working";
    if (p.uiLastState === "done" || p.uiCompleted) return "done";
    return "saved";
  }
  /* A Torre mostra, de TODAS as pastas: o que espera voce (attention), o que
     esta' rodando (working) e o que esta' PRONTO PRA LER (uiUnread).
     Conversa concluida que ele JA' leu nao entra -- essa e' historico.
     (Em 21/09 isto chegou a virar "tudo que nao e' saved"; com o config real
     a Torre nascia com 18 linhas de conversas velhas ja' lidas, porque ler
     zera o uiUnread mas nao o uiCompleted. O que ele pediu -- "ativas,
     aguardando resposta, em andamento ou prontas pra eu ler" -- e' isto aqui.
     O que fazia a Torre mudar ao trocar de pasta era outra coisa: a chave, a
     ordem e a ficha sem estado, corrigidas em liveRows/ordemDaTorre.) */
  function inControlTower(row) {
    return row.state === "attention" || row.state === "working" || !!(row.p || row.f)?.uiUnread;
  }
  function searchKind(q) {
    return q.startsWith(">")
      ? "commands"
      : q.startsWith("@") ? "agents"
      : q.startsWith("~") || /[\\/]/.test(q)
        ? "files"
        : "all";
  }
  function searchText(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }
  function identityOf(p, accountKey, remoteKey) {
    return {
      paneId: p.id,
      engine: p.engine,
      sessionId: p.sessaoId || p.resumeId || "",
      accountKey: accountKey || "",
      remoteKey: remoteKey || "pc",
      generation: p.uiGeneration || 0,
    };
  }
  function sameIdentity(a, b) {
    return [
      "paneId",
      "engine",
      "sessionId",
      "accountKey",
      "remoteKey",
      "generation",
    ].every((k) => a?.[k] === b?.[k]);
  }
  function paneFromSaved(candidates, saved, abaId) {
    const matching = candidates.filter(
      (p) => !p.morto && p.abaId === abaId && p.engine === (saved.engine || "claude"),
    );
    if (saved.paneId) {
      const exact = matching.find(
        (p) => p.id === saved.paneId || p.uiRestoredPaneId === saved.paneId,
      );
      if (exact) return exact;
    }
    if (!saved.sessaoId || saved.fork) return null;
    const sessions = matching.filter(
      (p) => !p.forkPendente &&
        (p.sessaoId || p.resumeId || p.resumeAnterior) === saved.sessaoId,
    );
    return sessions.length === 1 ? sessions[0] : null;
  }
  function parseSshAddress(value) {
    const text = String(value || "").trim();
    if (!text) return { error: "Informe usuário e servidor, ou abra Detalhes SSH." };
    const match = /^([^@\s]+)@(\[[^\]]+\]|[^:\s]+)(?::(.*))?$/.exec(text);
    if (!match) return { error: "Use usuario@host:caminho. Para IPv6, use [endereço]." };
    const host = match[2].startsWith("[") ? match[2].slice(1, -1) : match[2];
    if (!host || /[\r\n]/.test(text)) return { error: "Endereço SSH inválido." };
    return { usuario: match[1], host, caminhoRemoto: match[3]?.trim() || "~" };
  }
  function formatSshAddress(remote) {
    if (!remote?.usuario || !remote?.host) return "";
    const host = remote.host.includes(":") ? "[" + remote.host + "]" : remote.host;
    return remote.usuario + "@" + host + ":" + (remote.caminhoRemoto || "~");
  }
  /* Leva 5h (faixa de pastas como abas do Safari, decisão do Hugo em 08/10): quais pastas ficam na trilha e quais vão para o ▾. É uma
     conta pura, sem layout, para testar com qualquer largura. As medidas vêm do CSS (organizarTrilha as lê; os valores de reserva abaixo
     são os mesmos que o cockpit-ui.css declara):
       total    quantas pastas existem;
       ativa    índice da pasta ativa (fora da lista, vale a primeira);
       largura  o que sobra para as abas e o ▾, já sem o respiro da trilha;
       minimo   a menor largura de uma aba; vao: o espaço entre duas; mais: a largura do ▾.
     Devolve os ÍNDICES das visíveis, em ordem. Se todas cabem, o ▾ nem aparece. Senão cabem k abas ao lado do ▾ (sempre ao menos 1), e a
     ativa NUNCA fica escondida: se estivesse depois do k-ésimo lugar, ela ocupa o último lugar visível e a que estava lá vai para o ▾. */
  function abasVisiveis({ total, ativa, largura, minimo = 96, vao = 2, mais = 28 }) {
    const n = Math.max(0, Math.trunc(Number(total)) || 0);
    if (!n) return [];
    const todas = Array.from({ length: n }, (_, i) => i);
    // sem medida (NaN), nada a esconder: o chamador só pergunta com a faixa medida, e esconder no escuro é pior que mostrar demais
    const folga = Number.isFinite(largura) ? largura : Infinity;
    const passo = minimo + vao;
    if (Math.floor((folga + vao) / passo) >= n) return todas;
    const k = Math.max(1, Math.floor((folga - mais) / passo));
    if (k >= n) return todas;
    const i = Number.isInteger(ativa) && ativa >= 0 && ativa < n ? ativa : 0;
    return i < k ? todas.slice(0, k) : [...todas.slice(0, k - 1), i];
  }
  const exported = { inControlTower, STATES, stateOf, searchKind, searchText, identityOf, sameIdentity, paneFromSaved, parseSshAddress, formatSshAddress, abasVisiveis };
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  const d = document,
    q = (s, parent = d) => parent.querySelector(s);
  function node(tag, cls, text) {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(icon, title, action, cls = "") {
    const b = node("button", "ck-button " + cls);
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = ICONES[icon] ? ico(icon) : "";
    if (!ICONES[icon]) b.textContent = icon;
    if (action) b.addEventListener("click", action);
    return b;
  }
  function labelled(text, action, cls = "") {
    const b = button("", text, action, cls);
    b.textContent = text;
    return b;
  }
  function stopEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  let nav,
    sessionList,
    controlList,
    accountList,
    countButton,
    groupButton,
    placeBar,
    trilha,       // leva 5h: a cápsula das abas de pasta, dentro da placeBar (o + vem depois dela)
    maisPastas,   // leva 5h: o ▾ no fim da trilha, com as pastas que não couberam
    escondidasAntes = "",   // leva 5h: quais pastas estavam no ▾ na última conta (organizarTrilha)
    medidasDaTrilha = null,   // rodada 2 da leva 5h, item 5: o que a medirTrilha leu da faixa (largura, aba mínima, vão, ▾, reserva do arrasto); lido de novo só quando a largura ou o visual muda
    observandoAFaixa = false,   // o ResizeObserver da faixa está ligado: só então a medida guardada vale. Sem ele, mede a cada chamada (como antes)
    contaDaTrilha = null,   // a última abasVisiveis ({ medidas, total, ativa, ficam }): só refeita quando uma dessas muda
    newPlace,
    folderHeading,
    ajustarTorre,
    ajustarLargura,
    historyPlace = null,
    historyTimer,
    skeletonTimer,
    historyLoading = 0,   // quantas recargas do historico estao em andamento (0 = nenhuma)
    ultimaPendencia = null,
    historyTried = 0,
    initialized = false,
    dirty = false,
    draggingPlace = false,
    peekTimer;
  const rows = new Map(),
    histRows = new Map(),
    groups = new Map(),
    periodHeaders = new Map(),   // R4-01: "Hoje", "Esta semana"… reaproveitados entre repinturas
    accountCache = new Map();
  let layerSeq = 0,
    searchSeq = 0,
    activationSeq = 0;
  const layers = [];
  /* 29/09 (Hugo): a camada some com um fade curto em vez de sumir seca. Marca
     .ck-saindo (sem clique, ver cockpit-ui.css) e tira da tela no fim. Tira na
     hora se o sistema pede menos movimento ou se o elemento nem sabe animar
     (sem getAnimations: nao ha' fade nenhum pra esperar). */
  function sairDaTela(el) {
    const semMovimento = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || !el.isConnected || semMovimento || typeof el.getAnimations !== "function") return el?.remove();
    el.classList.add("ck-saindo");
    setTimeout(() => el.remove(), 150);
  }
  function closeLayer(layer = layers.at(-1)) {
    if (!layer || !layers.includes(layer)) return;
    while (layers.at(-1) !== layer) closeLayer();
    layers.pop();
    layer.closed = true;
    /* camada NAO modal: o foco so' volta se estava nela. Fechando sozinha
       (o painel dela mudou), ela nao puxa o foco de quem esta' escrevendo em
       outro lugar. A modal devolve sempre, como antes. */
    const devolverFoco = !layer.naoModal || layer.panel.contains(d.activeElement);
    layer.onClose?.();
    // 29/09: sai com um fade curto (cockpit-anim.css); o resto do fechamento e' na hora
    sairDaTela(layer.overlay);
    if (devolverFoco && layer.focus?.isConnected) {
      layer.focus.focus({ preventScroll: true });
      if (layer.selection && layer.focus.setSelectionRange)
        layer.focus.setSelectionRange(...layer.selection);
    }
  }
  /* opts.naoModal: janela ao lado do trabalho (a do Mais detalhes, presa ao
     painel). O fundo nao escurece nem segura o clique (cockpit-ui.css,
     .ck-nao-modal) e o teclado continua do app: ver keyLayer. */
  function openLayer(title, opts = {}) {
    const focus = d.activeElement,
      overlay = node("div", "ck-overlay" + (opts.naoModal ? " ck-nao-modal" : "")),
      panel = node("section", "ck-layer " + (opts.className || ""));
    const layer = {
      id: ++layerSeq,
      overlay,
      panel,
      focus,
      closed: false,
      onClose: opts.onClose,
      naoModal: !!opts.naoModal,
    };
    if (focus && typeof focus.selectionStart === "number")
      layer.selection = [focus.selectionStart, focus.selectionEnd];
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", layer.naoModal ? "false" : "true");
    panel.tabIndex = -1;
    const header = node("header", "ck-layer-head"),
      heading = node("h2", "", title);
    heading.id = "ck-heading-" + layer.id;
    panel.setAttribute("aria-labelledby", heading.id);
    header.append(
      heading,
      button("x", "Fechar (Esc)", () => closeLayer(layer)),
    );
    layer.body = node("div", "ck-layer-body");
    panel.append(header, layer.body);
    overlay.append(panel);
    d.body.append(overlay);
    layers.push(layer);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay && layers.at(-1) === layer) {
        stopEvent(e);
        closeLayer(layer);
      }
    });
    queueMicrotask(() => {
      if (!layer.closed)
        (
          layer.body.querySelector("input,textarea,select,button") || panel
        ).focus();
    });
    return layer;
  }
  function keyLayer(e) {
    const layer = layers.at(-1);
    if (!layer) return false;
    /* camada NAO modal (a janelinha ao lado do painel): o teclado so' e' dela
       com o foco DENTRO dela, e so' o Esc (fecha) e o Tab (circula nela). Fora
       dela nada e' segurado: os atalhos do app (Ctrl+K, F6...), o Tab e o
       Shift+Tab entre pastas e o Esc que para o turno seguem como sempre. Atalho
       com Ctrl nunca e' segurado aqui. */
    if (layer.naoModal) {
      if (!layer.panel.contains(d.activeElement)) return false;
      if (e.key === "Escape") {
        stopEvent(e);
        closeLayer(layer);
        return true;
      }
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const visible = [
            ...layer.panel.querySelectorAll(
              'button,input,textarea,select,[tabindex="0"]',
            ),
          ].filter((n) => !n.disabled && n.tabIndex !== -1 && n.getClientRects().length),
          first = visible[0],
          last = visible.at(-1),
          atual = d.activeElement;
        if (!first) {
          e.preventDefault();
          layer.panel.focus();
        } else if (e.shiftKey && (atual === first || atual === layer.panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (atual === last || atual === layer.panel)) {
          e.preventDefault();
          first.focus();
        }
        return true;
      }
      return false;
    }
    if (
      d.querySelector("dialog[open]") ||
      !q("#modalGrupo").classList.contains("hidden") ||
      !q("#popGrupo").classList.contains("hidden")
    ) {
      if (e.key === "Escape") {
        stopEvent(e);
        if (d.querySelector("dialog[open]"))
          d.querySelector("dialog[open]").close();
        else {
          fecharModalGlobal();
          fecharPopGlobal();
        }
      }
      return true;
    }
    if (e.key === "Escape") {
      stopEvent(e);
      closeLayer(layer);
      return true;
    }
    if (e.key === "Tab") {
      const visible = [
          ...layer.panel.querySelectorAll(
            'button,input,textarea,select,[tabindex="0"]',
          ),
        ].filter((n) => !n.disabled && n.tabIndex !== -1 && n.getClientRects().length),
        first = visible[0],
        last = visible.at(-1);
      if (!first) {
        stopEvent(e);
        layer.panel.focus();
      } else if (
        e.shiftKey &&
        (d.activeElement === first || !layer.panel.contains(d.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (d.activeElement === last || !layer.panel.contains(d.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      !["c", "v", "a", "x", "z", "y"].includes(e.key.toLowerCase())
    )
      e.stopImmediatePropagation();
    return true;
  }
  function persist() {
    window.api.setConfig(cfg);
  }
  function toggleNavigator() {
    if (cfg.visualMac && root.innerWidth <= 600) {
      clearTimeout(peekTimer);
      nav.classList.toggle('ck-peek');
      q('.ck-toggle', nav)?.setAttribute('aria-expanded', String(nav.classList.contains('ck-peek')));
      return;
    }
    cfg.uiCollapsed = !cfg.uiCollapsed;
    applyPreferences();
    persist();
  }
  function applyPreferences() {
    if (!nav) return;
    if (typeof root !== 'undefined') root.VisualMac?.applyPreferences(cfg);
    const collapsed = !!cfg.uiCollapsed || (!!cfg.visualMac && typeof root !== 'undefined' && root.innerWidth <= 600);
    nav.classList.toggle('ck-collapsed', collapsed);
    nav.classList.remove('ck-peek');
    d.body.classList.toggle("ck-logos-neutral", cfg.uiLogos !== true);
    // as duas medidas ajustadas na mao; sem valor gravado voltam ao CSS de sempre
    ajustarTorre?.(cfg.uiTorreAltura ?? null, false);
    ajustarLargura?.(cfg.uiSidebarLargura ?? null, false);
    q(".ck-toggle", nav)?.setAttribute(
      "aria-expanded",
      String(!collapsed),
    );
  }
  function navigatorCollapsed() { return !!cfg.uiCollapsed || (!!cfg.visualMac && root.innerWidth <= 600); }
  function updateNavigatorMode() {
    if (!nav) return;
    const collapsed = navigatorCollapsed();
    const changed = nav.classList.contains('ck-collapsed') !== collapsed;
    nav.classList.toggle('ck-collapsed', collapsed);
    // Uma atualização de cor do sistema não deve fechar a lateral sob o mouse.
    if (!collapsed || changed) nav.classList.remove('ck-peek');
    q('.ck-toggle', nav)?.setAttribute('aria-expanded', String(!collapsed));
  }
  root.addEventListener('resize', updateNavigatorMode);
  root.addEventListener('cockpit-appearance-changed', updateNavigatorMode);
  // leva 5h: ligar ou desligar o visual Mac troca o + e o respiro da faixa, e com isso o que cabe na trilha (a largura da faixa não muda)
  // rodada 2 da leva 5h, item 5: e a medida guardada deixa de valer (o primeiro ouvinte a zera; o segundo refaz a conta, que então lê de novo)
  root.addEventListener('cockpit-appearance-changed', () => { medidasDaTrilha = null; });
  root.addEventListener('cockpit-appearance-changed', () => organizarTrilha());
  /* As duas alcas da lateral -- a altura da TORRE e a largura da barra -- sao o
     mesmo mecanismo: arrastar com o ponteiro, seta do teclado pra quem nao
     arrasta, duplo clique pra voltar ao padrao. Uma funcao so': duas copias
     disto e' a receita pra uma delas ficar pra tras no proximo ajuste.
     Guardar null = APAGAR do cfg, e e' isso que devolve o comportamento antigo
     (o CSS volta a mandar) em vez de gravar o padrao como se fosse escolha. */
  function medidaArrastavel(alca, op) {
    const limitar = (v) => Math.min(op.max, Math.max(op.min, Math.round(v)));
    let arrastando = null;
    /* Sem valor gravado o numero lido e' a medida REAL, nao o padrao teorico: a
       Torre sem ajuste fica do tamanho do conteudo, ate' o teto de 200px.
       Como esse tamanho muda a cada conversa que entra ou sai, o valor tambem e'
       refeito quando a alca recebe o foco -- que e' quando ele vai ser lido. */
    function mostrar() {
      alca.setAttribute("aria-valuenow", String(op.gravado() ?? Math.round(op.atual())));
    }
    function aplicar(valor, guardar = true) {
      op.aplicar(valor == null ? null : limitar(valor));
      mostrar();
      if (guardar) persist();
    }
    alca.setAttribute("aria-valuemin", String(op.min));
    alca.setAttribute("aria-valuemax", String(op.max));
    alca.addEventListener("focus", mostrar);
    /* O arrasto e' manipulacao direta: parte de onde a alca esta' DESENHADA (op.inicioArrasto; sem ele, do op.atual).
       Com op.limiar ele so' vale depois de N px: clique sem mover nao muda nada, e a classe (que na Torre faz a lista
       mostrar o valor) so' liga junto com o 1o valor aplicado, sem salto. Sem op.limiar, tudo como sempre. */
    alca.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      arrastando = { base: (op.inicioArrasto || op.atual)(), zero: op.eixo === "y" ? e.clientY : e.clientX, ligado: !op.limiar };
      // captura: sem ela o ponteiro sai da alca de 6px e o arrasto morre no meio
      try { alca.setPointerCapture(e.pointerId); } catch {}
      if (arrastando.ligado) alca.classList.add("ck-arrastando");
      e.preventDefault();
    });
    alca.addEventListener("pointermove", (e) => {
      if (!arrastando) return;
      const andou = (op.eixo === "y" ? e.clientY : e.clientX) - arrastando.zero;
      if (!arrastando.ligado && Math.abs(andou) < op.limiar) return;
      aplicar(arrastando.base + andou * op.porPixel(), false);
      if (!arrastando.ligado) { arrastando.ligado = true; alca.classList.add("ck-arrastando"); }
    });
    const soltar = () => {
      if (!arrastando) return;
      const mexeu = arrastando.ligado;
      arrastando = null;
      alca.classList.remove("ck-arrastando");
      if (mexeu) persist();
    };
    alca.addEventListener("pointerup", soltar);
    alca.addEventListener("pointercancel", soltar);
    alca.addEventListener("dblclick", () => aplicar(null));
    alca.addEventListener("keydown", (e) => {
      // Home/Esc = o mesmo que o duplo clique, pra quem esta' so' no teclado
      if (["Home", "Escape"].includes(e.key)) {
        stopEvent(e);
        aplicar(null);
        return;
      }
      const passo = op.passo * (e.shiftKey ? 4 : 1);
      const setas =
        op.eixo === "y"
          ? { ArrowUp: -passo, ArrowDown: passo }
          : { ArrowLeft: -passo, ArrowRight: passo };
      if (!(e.key in setas)) return;
      stopEvent(e);
      aplicar(op.atual() + setas[e.key]);
    });
    return aplicar;
  }
  function peek(on) {
    clearTimeout(peekTimer);
    if (!on) nav.classList.remove("ck-peek");
    else if (navigatorCollapsed() && cfg.uiPeek !== false)
      /* confere de novo na hora de ABRIR: quem expandia a lateral no meio dos
         300 ms ficava com o espiar preso por cima da barra ja' aberta -- e
         nesse estado a largura ajustada a mao era ignorada (o peek tem a dele) */
      peekTimer = setTimeout(() => {
        if (navigatorCollapsed()) nav.classList.add("ck-peek");
      }, 300);
  }
  function allPanes() {
    return [
      ...new Map(
        [...panes.values(), ...panesFundo.values()].map((p) => [p.id, p]),
      ).values(),
    ];
  }
  /* A CHAVE e' a conversa, nao o objeto que por acaso a representa agora. Ficha
     e painel vivo sao a mesma linha em dois momentos, e o painel restaurado
     nasce com id NOVO (o antigo fica no uiRestoredPaneId): com a chave do
     objeto, abrir a pasta apagava a linha da Torre e montava outra no lugar --
     ela piscava e mudava de posicao sem nada ter acontecido. Config antigo sem
     paneId continua caindo na chave "saved:..." de sempre. */
  function liveRows() {
    const list = allPanes()
      .filter((p) => !p.morto)
      .map((p) => ({
        key: p.uiRestoredPaneId || p.id,
        p,
        aba: abaPorId(p.abaId),
        state: stateOf(p),
        title: tituloNaTorre(p),
        engine: p.engine,
      }));
    for (const aba of abasLocais())
      for (const f of aba.paineis || []) {
        /* casa pelo id de AGORA e pelo id que o painel tinha na ficha de
           origem: comparar so' com um dos dois deixava a mesma conversa entrar
           duas vezes na Torre logo depois de restaurar a pasta */
        if (
          list.some(
            (x) =>
              x.p &&
              ((f.paneId &&
                (x.p.id === f.paneId || x.p.uiRestoredPaneId === f.paneId)) ||
                (x.aba?.id === aba.id &&
                  f.sessaoId &&
                  (x.p.sessaoId || x.p.resumeId) === f.sessaoId)),
          )
        )
          continue;
        list.push({
          key:
            f.paneId ||
            "saved:" +
              aba.id +
              ":" +
              (f.sessaoId || f.titulo || aba.paineis.indexOf(f)),
          f,
          aba,
          /* uiEstado e' o estado REAL da ultima vez que o painel esteve na tela
             (fichaDoPainel, desde 21/09/2026). Sem ele a conversa que estava
             trabalhando -- ou esperando voce -- numa pasta que ainda nao foi
             aberta nesta sessao virava "saved" e caia fora da Torre, e so'
             reaparecia quando voce abria aquela pasta: era a Torre mudando por
             causa da troca de pasta. Ficha antiga nao tem o campo e continua
             valendo a regra de antes. */
          /* uiCompleted no fallback: SEM ele a Torre crescia a cada pasta que
             voce abria. O config que ja' existe no disco nao tem uiEstado (o
             campo nasceu agora) mas tem uiCompleted: a conversa concluida de
             uma pasta fechada valia "saved" e ficava fora; ao abrir a pasta o
             painel era restaurado, stateOf via uiCompleted, virava "done" e
             entrava na Torre pra nunca mais sair. Aqui a ficha decide igual ao
             stateOf (app.js: uiLastState === 'done' || uiCompleted). */
          state:
            f.uiEstado && STATES[f.uiEstado]
              ? f.uiEstado
              : f.uiUnread || f.uiCompleted
                ? "done"
                : "saved",
          title: f.titulo || "Conversa guardada",
          engine: f.engine || "claude",
        });
      }
    return list;
  }
  /* Onde a linha mora na Torre. A ordem vem do DADO -- a pasta (posicao dela na
     faixa) e a posicao do painel dentro de cfg.abas[].paineis -- e nao de onde o
     painel esta' guardado neste instante. Antes ela saia de allPanes(), que
     lista os paineis da pasta ABERTA primeiro e os de segundo plano depois:
     trocar de pasta trocava as linhas de lugar dentro de cada estado, com o
     mesmo conteudo e o mesmo estado. A mesma conta serve pra ficha e pra painel
     vivo, entao a linha tambem nao pula quando a pasta abre; o terceiro numero
     so' desempata painel recem-criado, que ainda nao foi gravado em ficha. */
  function lugarNaTorre(row) {
    const abas = abasLocais();
    const lista = (row.aba && row.aba.paineis) || [];
    const p = row.p;
    const sessao = p && (p.sessaoId || p.resumeId);
    const dentro = row.f
      ? lista.indexOf(row.f)
      : lista.findIndex(
          (f) =>
            f &&
            ((f.paneId &&
              (f.paneId === p.id || f.paneId === p.uiRestoredPaneId)) ||
              (sessao && f.sessaoId === sessao)),
        );
    const pasta = row.aba ? abas.indexOf(row.aba) : -1;
    return [
      pasta < 0 ? abas.length : pasta,
      dentro < 0 ? lista.length : dentro,
      (p && p.uiOrdem) || 0,
    ];
  }
  /* O estado manda na Torre; o empate DENTRO de um estado resolve no lugar fixo
     da conversa, nunca na pasta que esta' aberta. */
  function ordemDaTorre(a, b) {
    return (
      STATES[a.state].rank - STATES[b.state].rank ||
      a.lugar[0] - b.lugar[0] ||
      a.lugar[1] - b.lugar[1] ||
      a.lugar[2] - b.lugar[2]
    );
  }
  async function activate(row, pending = true) {
    const request = ++activationSeq;
    peek(false);
    if (
      row.p &&
      pending &&
      (row.p.pedindoPerm || row.p.filaPerm?.length || row.p.perguntaAberta || row.p.planoPendente)
    )
      return pendingLayer(row.p);
    if (row.p) irAoPainel(row.p);
    else if (row.aba) {
      await trocarAbaLocal(row.aba.id);
      // A troca pode ter entrado na fila de outra aba ainda em restauração.
      while (trocandoAba && request === activationSeq)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (request !== activationSeq || cfg.abaAtiva !== row.aba.id) return;
      const target = row.f && paneFromSaved([...panes.values()], row.f, row.aba.id);
      if (target) irAoPainel(target);
    }
    refresh();
  }
  /* Leva 5h: o selo laranja de uma pasta (na aba e na listinha do ▾) mostra o número, com 99+ nas muitas, e a mesma coisa em palavras
     ("1 pede você", "3 pedem você") vai no nome acessível e no hover, para o leitor de tela não ler o número solto. */
  function textoDoSelo(n) {
    return n > 99 ? "99+" : n ? String(n) : "";
  }
  function fraseDePendencias(n) {
    return n ? n + (n === 1 ? " pede você" : " pedem você") : "";
  }
  /* `pendentes`: quantas conversas desta pasta pedem você (estado "attention", o mesmo da Torre); vira o selo laranja da aba (leva 5h) */
  function groupFor(id, title, aba, pendentes = 0) {
    let g = groups.get(id);
    if (!g) {
      const el = node("section", "ck-nav-group"),
        head = button("", title, () => {
          if (aba) trocarAbaLocal(aba.id);
        });
      head.className = "ck-group-head";
      if (aba) head.dataset.placeId = aba.id; // o destaque que viaja (cockpit-anim.js) acha a aba destino por aqui
      head.setAttribute("aria-expanded", "false");
      const label = node("span", "ck-group-name"),
        placeIcon = node("span", "ck-group-icon"),
        selo = node("span", "ck-place-selo"),
        chevron = node("span", "ck-group-chevron"),
        stats = node("span", "ck-group-stats");
      // o selo laranja so' existe com pendencia; quem le a aba ja' ouve a mesma coisa no aria-label (mais abaixo)
      selo.hidden = true;
      selo.setAttribute("aria-hidden", "true");
      // o tipo fica marcado no dataset e o icone acompanha (folder = pasta local,
      // server = pasta da VPS). Na faixa horizontal TODA aba mostra o icone: e' ele
      // que diferencia pasta local de pasta da VPS sem ler o nome (decisao do Hugo)
      placeIcon.dataset.place = aba?.tipo === "ssh" ? "ssh" : "local";
      placeIcon.innerHTML = ico(aba?.tipo === "ssh" ? "server" : "folder");
      placeIcon.hidden = !aba;
      chevron.innerHTML = ico("chevron-down");
      head.append(placeIcon, label, selo, stats, chevron);
      const body = node("div", "ck-group-body");
      body.hidden = true;
      const saved = node("details", "ck-saved-list"),
        savedTitle = node("summary", "", "Guardadas"),
        savedBody = node("div");
      saved.append(savedTitle, savedBody);
      body.append(saved);
      el.append(head, body);
      g = { el, head, label, selo, stats, body, saved, savedTitle, savedBody };
      groups.set(id, g);
      if (aba) {
        head.draggable = true;
        head.addEventListener("dragstart", (e) => {
          draggingPlace = true;
          e.dataTransfer.setData("application/cockpit-place", aba.id);
        });
        head.addEventListener("dragend", () => {
          draggingPlace = false;
          refresh();
        });
        head.addEventListener("dragover", (e) => {
          if (
            Array.from(e.dataTransfer.types).includes(
              "application/cockpit-place",
            )
          )
            e.preventDefault();
        });
        head.addEventListener("drop", (e) => {
          e.preventDefault();
          draggingPlace = false;
          const source = e.dataTransfer.getData("application/cockpit-place");
          // conferência da rodada 2: soltar a aba nela mesma (um arrasto curto sem querer) não reordena nem grava nada
          if (source && source !== aba.id)
            moverAbaLocal(
              source,
              indiceAoSoltarNaTrilha(aba.id),
            );
          refresh();
        });
        head.addEventListener("dblclick", () => {
          if (!trocandoAba && cfg.abaAtiva === aba.id) abrirModalAbaLocal(aba);
        });
        head.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          placeActions(aba);
        });
      }
    }
    g.label.textContent = title;
    /* leva 5h: o selo laranja da aba e a mesma informação em palavras, no nome acessível e no hover. O nome só vai no aria-label aqui
       (o button() o põe uma vez, na criação): renomear a pasta não deixava o nome antigo para o leitor de tela */
    const frase = fraseDePendencias(pendentes), texto = textoDoSelo(pendentes);
    if (g.selo.textContent !== texto) g.selo.textContent = texto;
    const semSelo = !pendentes;
    if (g.selo.hidden !== semSelo) g.selo.hidden = semSelo;
    if (pendentes) g.el.dataset.pendentes = String(pendentes);
    else delete g.el.dataset.pendentes;
    g.head.setAttribute("aria-label", title + (frase ? " · " + frase : ""));
    g.head.title = title + (frase ? " · " + frase : "") + (aba ? " · Clique direito para opções; duplo clique para editar" : "");
    g.el.dataset.current = String(!!aba && cfg.abaAtiva === aba.id);
    if (aba && cfg.abaAtiva === aba.id) g.head.setAttribute("aria-current", "location");
    else g.head.removeAttribute("aria-current");
    return g;
  }
  /* Rodada 2 da leva 5h, item 6: o índice da config em que a pasta arrastada deve cair para ficar na casa da TELA onde foi solta. Com pastas no ▾ e
     a ativa vinda de lá (abasVisiveis a põe no último lugar visível), a casa da tela e o índice da config não são a mesma coisa: as visíveis são as
     primeiras da config mais a ativa, que está lá no fim. Soltar na casa dela usando o índice da config mandava a pasta arrastada para o fim da
     lista, fora das primeiras (que são as que ficam à vista): ela sumia no ▾ e outra pasta aparecia no lugar. Quando há um buraco da config entre a
     casa anterior e a do alvo (é o caso da ativa que veio do ▾), a pasta cai logo depois da casa anterior: ainda entre as primeiras, colada ao lugar
     onde foi solta. Em qualquer outra casa (ou sem nada no ▾) o índice é o da config, como sempre. */
  function indiceAoSoltarNaTrilha(destinoId) {
    const lista = abasLocais();
    const alvo = lista.findIndex((a) => a.id === destinoId);
    // as pastas que estão na tela, na ordem da trilha, cada uma com o índice dela na config
    const naTela = [...trilha.children]
      .filter((el) => el.classList.contains("ck-place-only") && !el.hidden)
      .map((el) => lista.findIndex((a) => a.id === el.firstElementChild?.dataset.placeId));
    const casa = naTela.indexOf(alvo);
    if (casa > 0 && naTela[casa] > naTela[casa - 1] + 1) return naTela[casa - 1];
    return alvo;
  }
  function refresh() {
    if (!initialized || dirty || draggingPlace) return;
    dirty = true;
    requestAnimationFrame(() => {
      dirty = false;
      if (draggingPlace) return;
      renderNavigator();
      organizarTrilha();   // leva 5h: a ativa pode ter mudado de lugar, e o selo muda o que cabe
      for (const p of allPanes()) decoratePane(p);
    });
  }
  /* R4-01: deixa "nos" nesta ordem dentro de "lista", logo depois de "antes" (null = no começo), re-inserindo o
     MÍNIMO: ficam quietas as linhas da maior subsequência crescente das posições em que já estão, e cada uma das
     outras sai do lugar uma vez só (insertBefore). Custo: nada mudou = 0; uma linha que se desloca, para cima ou
     para baixo, = 1; N linhas em ordem inversa = N-1, que é o piso de qualquer método. Re-inserir um nó tira dele
     o foco do teclado (vai para o body, no Chromium) e recomeça a animação dos pontinhos de "trabalhando".
     O que não é linha (o aviso, o "Tudo em dia") fica depois delas. */
  function alinharEmOrdem(lista, nos, antes = null) {
    const ordem = [...new Set(nos)], quer = new Set(ordem), pos = new Map();
    // a faixa das linhas: logo depois de "antes", até o primeiro nó que não é linha (ou o fim da lista)
    let fim = antes ? antes.nextElementSibling : lista.firstElementChild;
    while (fim && quer.has(fim)) {
      pos.set(fim, pos.size);
      fim = fim.nextElementSibling;
    }
    // maior subsequência crescente das posições atuais, lidas na ordem pedida (busca binária: n log n)
    const cand = ordem.filter((el) => pos.has(el)), val = cand.map((el) => pos.get(el)), cauda = [], elo = [];
    for (let i = 0; i < cand.length; i++) {
      let a = 0, b = cauda.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (val[cauda[m]] < val[i]) a = m + 1;
        else b = m;
      }
      elo[i] = a ? cauda[a - 1] : -1;
      cauda[a] = i;
    }
    const quietas = new Set();
    for (let i = cauda.length ? cauda[cauda.length - 1] : -1; i >= 0; i = elo[i]) quietas.add(cand[i]);
    // de trás para frente: quem não está na subsequência entra logo antes do seguinte
    for (let k = ordem.length - 1; k >= 0; k--) {
      if (!quietas.has(ordem[k])) lista.insertBefore(ordem[k], fim);
      fim = ordem[k];
    }
  }
  /* A MESMA linha serve a torre e ao historico da pasta. E' o que faz as duas
     listas parecerem a mesma coisa: o que muda entre elas e' de onde vem a
     lista, nunca o desenho. Duplicar este bloco era a receita para as duas
     divergirem no primeiro ajuste de estado ou de logo. */
  function sessionRow(store, row) {
    let r = store.get(row.key);
    if (!r) {
      // linha de historico carrega a sessao gravada (row.s) e abre por ela; a da
      // torre carrega o painel vivo e passa pelo activate, que desvia para a
      // pendencia quando ha' permissao esperando
      const el = button("", row.title, () =>
        r.row.s ? openSession(r.row.s, r.el) : activate(r.row),
      );
      el.className = "ck-session";
      el.dataset.key = row.key;
      const glyph = node("span", "ck-state"),
        place = node("span", "ck-session-place"),
        logo = node("span", "ck-engine"),
        title = node("span", "ck-session-title"),
        robots = node("span", "ck-robots");
      el.append(glyph, place, logo, title, robots);
      /* os tres pontinhos de "trabalhando" nascem AQUI, uma vez por linha, e o
         CSS liga/desliga por estado. Criar e jogar fora a cada repintura seria
         churn de DOM em 20+ linhas; e eles moram DENTRO do selo, entao a linha
         continua com os mesmos cinco pedacos das duas listas. */
      glyph.innerHTML = "<i></i><i></i><i></i>";
      r = { el, glyph, place, logo, title, robots, row };
      store.set(row.key, r);
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        sessionActions(r.row);
      });
    }
    r.row = row;
    r.el.dataset.state = row.state;
    r.el.classList.toggle("ck-current", row.p === focusPane);
    r.el.classList.toggle("ck-live", !!row.p);
    // o selo nao tem mais texto: e' forma pura (CSS). Limpar textContent aqui
    // apagaria os tres pontinhos criados junto com a linha.
    r.glyph.className =
      "ck-state ck-g " + (row.state === "saved" ? "stored" : row.state);
    r.glyph.title = STATES[row.state].label;
    const placeIcon = row.aba?.tipo === "ssh" ? "server" : "folder";
    if (r.place.dataset.icon !== placeIcon) {
      r.place.dataset.icon = placeIcon;
      r.place.innerHTML = ico(placeIcon);
    }
    r.place.title = row.aba?.nome || "Local";
    if (r.logo.dataset.motor !== row.engine) {
      r.logo.dataset.motor = row.engine;
      r.logo.innerHTML = svgMotor(row.engine);
    }
    r.title.textContent = row.title;
    const robos =
        row.p?.robos instanceof Map
          ? [...row.p.robos.values()]
          : Object.values(row.p?.robos || {}),
      busy = robos.filter(
        (b) =>
          !["done", "completed", "failed", "concluido", "erro"].includes(
            b.estado || b.status,
          ),
      ).length;
    r.robots.innerHTML = busy
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V3m-3 0h3M1 12v5m22-5v5M8 14h1m6 0h1m-7 3h6"/></svg><span>' +
        busy +
        "</span>"
      : "";
    r.robots.title = busy + " robôs em segundo plano";
    r.el.title = [
      STATES[row.state].label,
      nomeDoMotor(row.engine),
      row.title,
      row.aba?.nome,
      row.p?.cwd || row.s?.cwd,
    ]
      .filter(Boolean)
      .join(" · ");
    r.el.setAttribute("aria-label", r.el.title);
    return r;
  }
  /* O historico da lateral le o MESMO histCache que a busca completa enche pelo
     loadHist -- inclusive o filtro por pasta que ele ja' aplica. Um segundo
     caminho de leitura ficaria fora de sincronia com o que a busca mostra. */
  function historyRows(vivas = liveRows()) {
    const aba = abaAtual();
    const live = new Map();
    for (const row of vivas)
      for (const id of [row.p?.sessaoId, row.p?.resumeId, row.f?.sessaoId])
        if (id) live.set(id, row);
    const list = [];
    for (const engine of MOTORES)
      for (const s of histCache[engine] || []) {
        // a conversa que ESTA aberta agora aparece com o estado real dela: sem
        // isso a mesma sessao era "guardada" aqui e "trabalhando" na torre
        const open = live.get(s.id);
        /* ...e se ela ja' esta' NA torre, nao se repete aqui embaixo: eram duas
           linhas ambar identicas, e clicar em cada uma fazia coisa diferente
           (a de cima abre a permissao, a de baixo so' foca o painel) */
        if (open && inControlTower(open)) continue;
        list.push({
          key: "hist:" + engine + ":" + s.id,
          s,
          aba,
          p: open?.p,
          state: open ? open.state : "saved",
          title: s.title || "Conversa",
          engine: s.engine || engine,
          when: s.when || 0,
        });
      }
    return list.sort((a, b) => b.when - a.when);
  }
  /* Recarrega em tres momentos: quando a pasta ativa muda (lista inteira
     diferente), de cinco em cinco minutos, e quando FALTA cache -- ver
     historicoFaltando(). Conversa que acabou de nascer ja' aparece viva na
     torre; aqui o que interessa e' o passado, que nao muda a cada segundo.
     A troca de pasta e os 5 min recarregam os cinco motores (cada um varre a
     pasta de sessoes dele) e rearmam o relogio; a falta de cache recarrega SO'
     os motores sem cache (motoresSemCache) e nao mexe no relogio. */
  async function loadPlaceHistory(motores = MOTORES) {
    const place = abaAtual()?.id || "";
    /* so' a recarga COMPLETA mexe no relogio dos 5 min. A dos motores sem cache
       roda a cada fim de turno: se zerasse o relogio, a completa nunca rodaria
       -- e e' so' ela que traz as conversas criadas fora do Cockpit nos outros
       motores */
    const completa = motores === MOTORES;
    historyPlace = place;
    /* auditoria 2 (I-1): CONTA as recargas. A parcial nao mexe no relogio e o relogio nao espera por ela: as duas
       correm juntas. Com liga/desliga, a primeira que terminava desligava com a outra lendo, e o historicoFaltando
       disparava outra parcial, que jogava fora a leitura em andamento (aba remota: o Claude sumia mais um ciclo) */
    historyLoading++;
    historyTried = Date.now();
    if (completa) clearTimeout(historyTimer);
    try {
      /* 28/09 (Hugo: "a VPS nao carrega nenhuma sessao"): a lista esperava o
         motor MAIS LENTO pra aparecer. Na VPS a 1a conexao do Codex pode ir ate'
         o prazo e escondia as conversas do Claude que ja' tinham chegado. Cada
         motor que chega ja' pinta (o esqueleto sai quando ha' linha). */
      await Promise.all(
        motores.map((engine) =>
          Promise.resolve(loadHist(engine)).catch(() => {}).then(() => {
            if ((abaAtual()?.id || "") === place) refresh();
          }),
        ),
      );
    } finally {
      historyLoading--;   // so' chega a zero quando a ULTIMA termina
      historyTried = Date.now();
      /* so' o dono da pasta atual re-arma: duas trocas de pasta em rajada
         deixavam o timer da primeira pendurado, varrendo os 5 motores pra
         sempre a cada 5 min */
      if ((abaAtual()?.id || "") === place) {
        if (completa) historyTimer = setTimeout(loadPlaceHistory, 300000);
        refresh();
      } else if (!historyLoading) refresh();   // leva 4: a ultima a terminar era da pasta anterior; sem isto o "carregando" ficava na lateral
    }
  }
  /* R4-02: cada lote da varredura (~80 ms) repintava a lateral inteira (o requestAnimationFrame do refresh só junta
     por quadro). Agora o progresso repinta no máximo a cada 400 ms (o primeiro sai na hora) e o fim da varredura
     (complete) repinta na hora. */
  let progressoTimer = 0, ultimoProgresso = 0;
  function aoProgressoDoHistorico(event) {
    if (event.detail?.abaId !== abaAtual()?.id) return;
    if (event.detail?.complete) {
      clearTimeout(progressoTimer);
      progressoTimer = 0;
      ultimoProgresso = Date.now();
      refresh();
      return;
    }
    if (progressoTimer) return;
    // a espera nunca passa de 400 ms, nem se o relógio do sistema voltar (ajuste de hora)
    progressoTimer = setTimeout(() => {
      progressoTimer = 0;
      ultimoProgresso = Date.now();
      refresh();
    }, Math.min(400, Math.max(0, ultimoProgresso + 400 - Date.now())));
  }
  window.addEventListener('cockpit-history-progress', aoProgressoDoHistorico);
  /* O app zera histCache[motor] na rotina normal: fim de turno (app.js:4172),
     renomear painel, titulo automatico, apagar conversa, ligar "ver robos".
     Em todos esses pontos a recarga esta' atras de "se a lista antiga estiver
     visivel" -- e no tema ck-app ela NUNCA esta'. O historico da lateral, que
     le o mesmo cache, esvaziava sozinho a cada turno que terminava e so'
     voltava depois de 5 min ou de trocar de pasta. Aqui a falta de cache e' o
     proprio gatilho: pintou sem cache, recarrega. A janela de 2 s evita laco
     se algum motor falhar e deixar o cache nulo de novo. */
  function historicoFaltando() {
    if (historyLoading || Date.now() - historyTried < 2000) return false;
    return MOTORES.some((engine) => histCache[engine] == null);
  }
  /* R4-02: o fim de turno zera o cache de UM motor; recarregar os cinco varria a pasta de sessões de todos de novo */
  function motoresSemCache() {
    return MOTORES.filter((engine) => histCache[engine] == null);
  }
  /* Caixa reservada do historico. Enquanto o loadPlaceHistory() varre os cinco
     motores a lista ficava vazia 1-2s e depois enchia de uma vez, empurrando
     tudo pra baixo. Seis linhas fantasma no mesmo passo das de verdade seguram
     a altura; quando os dados chegam o esqueleto sai flutuando por cima e as
     linhas entram no mesmo intervalo de 180ms.
     O "carregando" NAO e' inventado aqui: vem do historyLoading que o
     loadPlaceHistory() ja' liga e desliga. Um segundo controle ficaria fora de
     sincronia com a recarga de 5 min e com a troca de pasta. */
  function historySkeleton(loading) {
    let el = q(".ck-skeleton", sessionList);
    clearTimeout(skeletonTimer);
    if (loading) {
      // recarga que recomecou no meio da saida: reaproveita o mesmo esqueleto
      if (el) {
        delete el.dataset.out;
        delete sessionList.dataset.swap;
        return el;
      }
      el = node("div", "ck-skeleton");
      el.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 6; i++) el.append(node("span", "ck-skeleton-row"));
      sessionList.prepend(el);
      return el;
    }
    if (!el) return null;
    el.dataset.out = "1";
    sessionList.dataset.swap = "1";
    // o esqueleto MORRE quando os dados chegam: sem isso ficaria uma varredura
    // infinita rodando escondida atras da lista o dia inteiro
    skeletonTimer = setTimeout(() => {
      el.remove();
      delete sessionList.dataset.swap;
    }, 180);
    return el;
  }
  let accountPlace;
  function renderNavigator() {
    // R4-01: quem tinha o foco do teclado antes da repintura (volta para ele se a linha precisar mudar de lugar)
    const focoAntes = d.activeElement;
    const scope = accountScope(abaAtual());
    if (accountPlace !== scope) {
      accountPlace = scope;
      loadAccounts();
      updateChooser();
    }
    const data = liveRows(),
      automations = automationAttention(),
      attention = data.filter((x) => x.state === "attention").length + automations.length;
    countButton.replaceChildren(
      node("span", "ck-g attention"),
      node("span", "ck-attention-number", String(attention)),
    );
    countButton.dataset.count = String(attention);
    countButton.title = attention + " sessões precisam de atenção (F6)";
    countButton.setAttribute("aria-label", countButton.title);
    nav.dataset.grouping = "control";
    const usedRows = new Set(), usedGroups = new Set(), usedHistory = new Set();
    /* as pastas moram na faixa horizontal em cima dos paineis, dentro da TRILHA (leva 5h): [pasta pasta pasta ▾] e o '+' logo depois.
       O selo laranja de cada aba conta as conversas dela que pedem voce (o mesmo estado "attention" da Torre). */
    const pendentesPorPasta = new Map(), secoes = [];
    for (const row of data)
      if (row.state === "attention" && row.aba) pendentesPorPasta.set(row.aba.id, (pendentesPorPasta.get(row.aba.id) || 0) + 1);
    for (const aba of abasLocais()) {
      const g = groupFor("place:" + aba.id, aba.nome, aba, pendentesPorPasta.get(aba.id) || 0);
      usedGroups.add(g);
      g.el.classList.add("ck-place-only");
      g.body.hidden = true;
      g.head.removeAttribute("aria-expanded");
      g.stats.replaceChildren();
      secoes.push(g.el);
    }
    /* na ordem da config, antes do ▾ (o ultimo item da trilha). So' se move quem saiu do lugar: re-inserir uma aba que ja' esta' no
       lugar tira o foco do teclado dela, e a repintura roda a cada estado que muda */
    alinharEmOrdem(trilha, secoes);
    const active = data.filter(inControlTower);
    for (const row of active) row.lugar = lugarNaTorre(row);
    active.sort(ordemDaTorre);
    root.VisualMac?.updateTower([
      ...active.map(row => ({ ...row, unread: !!(row.p || row.f)?.uiUnread })),
      ...automations.map(task => ({ key: 'automation:' + task.nome, title: nomeDaRotina(task.nome), state: 'attention', automation: true })),
    ], row => {
      if (row.automation) toolLayer('automations');
      else activate(row);
    });
    /* TETO DE MOVIMENTO, contado POR ESTADO. Medido na previa com 54 linhas e
       a CPU 6x mais lenta: 136 selos animando derrubam a tela pra 6,6 quadros
       por segundo; com teto, 31. So' que contar por POSICAO na lista nao
       serve -- a Torre poe "sua vez" antes de "trabalhando", entao nove
       pendencias no topo empurravam TODOS os "trabalhando" pra fora do teto e
       os pontinhos nunca apareciam. Contando por estado, os QUATRO primeiros
       de cada um sempre se mexem; do quinto em diante a forma fala sozinha,
       que e' o mesmo contrato do prefers-reduced-motion. */
    const quantosNoEstado = {}, linhasDaTorre = [];
    for (const row of active) {
      usedRows.add(row.key);
      const r = sessionRow(rows, row);
      quantosNoEstado[row.state] = (quantosNoEstado[row.state] || 0) + 1;
      r.el.toggleAttribute("data-quieto", quantosNoEstado[row.state] > 4);
      linhasDaTorre.push(r.el);
    }
    for (const [key, r] of rows)
      if (!usedRows.has(key)) {
        r.el.remove();
        rows.delete(key);
      }
    // R4-01: o append de antes movia TODAS as linhas a cada repintura; agora só a que está fora da ordem
    alinharEmOrdem(controlList, linhasDaTorre, automationSection?.parentNode === controlList ? automationSection : null);
    for (const [key, g] of groups)
      if (!usedGroups.has(g)) {
        g.el.remove();
        groups.delete(key);
      }
    const idle = !active.length && !automations.length;
    if (idle && !q(".ck-empty-nav", controlList))
      controlList.append(node("p", "ck-empty-nav", "Tudo em dia"));
    if (!idle) q(".ck-empty-nav", controlList)?.remove();
    renderAutomationSummary();
    const place = abaAtual();
    folderHeading.title = "Conversas de " + (place?.nome || "esta pasta");
    if (historyPlace !== (place?.id || "")) {
      // com muitas pastas a faixa rola: a que acabou de ficar ativa tem que
      // aparecer sozinha, senao trocar pelo teclado destacava algo fora da tela.
      // So' na TROCA -- a cada repintura isso brigaria com a rolagem na mao.
      groups.get("place:" + place?.id)?.el.scrollIntoView({ block: "nearest", inline: "nearest" });
      loadPlaceHistory();
    } else if (historicoFaltando()) loadPlaceHistory(motoresSemCache());
    // reaproveita o liveRows do começo desta repintura: montá-lo de novo varre
    // todos os painéis e todas as fichas de todas as pastas outra vez
    const saved = historyRows(data);
    /* R4-01: cabeçalhos de período e linhas são reaproveitados e só mudam de lugar quando saem da ordem. Antes os
       cabeçalhos eram apagados e recriados, e cada linha ia de novo para o fim, perdendo o foco do teclado. */
    const sequencia = [], periodosUsados = new Set();
    for (const group of HistoricoLista.grupos(saved)) {
      let header = periodHeaders.get(group.nome);
      if (!header) {
        header = node('div', 'ck-history-period', group.nome);
        header.setAttribute('role', 'heading'); header.setAttribute('aria-level', '3');
        periodHeaders.set(group.nome, header);
      }
      periodosUsados.add(group.nome);
      sequencia.push(header);
      for (const row of group.itens) {
        usedHistory.add(row.key);
        sequencia.push(sessionRow(histRows, row).el);
      }
    }
    for (const [nome, header] of periodHeaders)
      if (!periodosUsados.has(nome)) {
        header.remove();
        periodHeaders.delete(nome);
      }
    for (const [key, r] of histRows)
      if (!usedHistory.has(key)) {
        r.el.remove();
        histRows.delete(key);
      }
    const esqueleto = sessionList.firstElementChild?.classList.contains("ck-skeleton") ? sessionList.firstElementChild : null;
    alinharEmOrdem(sessionList, sequencia, esqueleto);
    /* esqueleto so' quando NAO ha' linha nenhuma pra mostrar. Com a lista ja'
       cheia, a recarga de 5 min tambem liga o historyLoading -- piscar cinza
       por cima do que ja' esta' na tela seria pior que nao mostrar nada. */
    const carregando = historyLoading && !saved.length;
    historySkeleton(carregando);
    // "Nenhuma conversa aqui" e' resposta, nao espera: enquanto carrega, quem
    // ocupa o lugar e' o esqueleto
    const avisosHistorico = [...new Set(MOTORES.flatMap(engine => {
      const cache = histCache[engine];
      return cache?.aviso ? [nomeDoMotor(engine) + ': ' + cache.aviso] : cache?.truncated ? ['Histórico parcial: limite de arquivos ou conversas atingido.'] : [];
    }))];
    if (!saved.length && !carregando && !avisosHistorico.length && !q(".ck-empty-nav", sessionList))
      sessionList.append(node("p", "ck-empty-nav", "Nenhuma conversa aqui"));
    if (saved.length || carregando || avisosHistorico.length) q(".ck-empty-nav", sessionList)?.remove();
    if (avisosHistorico.length) {
      let notice = q('.ck-history-limit', sessionList);
      if (!notice) { notice = node('p', 'ck-search-status ck-history-limit'); notice.setAttribute('role', 'status'); sessionList.append(notice); }
      // role=status anuncia de novo a cada escrita, mesmo do mesmo texto: so' grava quando muda (R4-03)
      const textoDoAviso = avisosHistorico.join(' · ');
      if (notice.textContent !== textoDoAviso) notice.textContent = textoDoAviso;
    }
    else q('.ck-history-limit', sessionList)?.remove();
    // R4-01: linha focada que precisou mudar de lugar perde o foco no Chromium; ele volta para ela
    if (focoAntes && focoAntes !== d.activeElement && focoAntes.isConnected && (controlList.contains(focoAntes) || sessionList.contains(focoAntes)))
      focoAntes.focus({ preventScroll: true });
  }
  /* 29/09 (Hugo): escolhe a pasta numa janelinha e abre a conversa nova nela.
     O motor é o do painel em foco AGORA (antes de trocar de pasta), igual ao
     "+" do Histórico. */
  function novaConversaEmOutraPasta() {
    const engine = focusPane?.engine || cfg.lastEngine || "claude";
    const atual = abaAtual()?.id;
    const l = openLayer("Nova conversa em…", { className: "ck-small" });
    for (const aba of abasLocais()) {
      const b = labelled((aba.nome || "Pasta") + (aba.id === atual ? " (aberta)" : ""), async () => {
        closeLayer(l);
        if (cfg.abaAtiva !== aba.id) await trocarAbaLocal(aba.id);
        // a troca pode ter sido recusada (apagando uma aba) ou ter ficado na fila (outra troca em curso): sem isto a conversa abria na pasta de antes
        if (cfg.abaAtiva !== aba.id) return;
        novaConversa(engine);
      });
      b.insertAdjacentHTML("afterbegin", ico(aba.tipo === "ssh" ? "server" : "folder"));
      l.body.append(b);
    }
    return l;
  }
  function placeActions(aba) {
    const l = openLayer(aba.nome || "Lugar", { className: "ck-small" });
    const index = abasLocais().findIndex((a) => a.id === aba.id);
    const actions = [
      ["Editar lugar", () => abrirModalAbaLocal(aba), true],
      ["Mover para cima", () => moverAbaUmaCasa(aba.id, -1), index > 0],
      ["Mover para baixo", () => moverAbaUmaCasa(aba.id, 1), index < abasLocais().length - 1],
      ["Remover lugar", () => apagarAbaLocal(aba), abasLocais().length > 1],
    ];
    for (const [label, action, enabled] of actions) {
      const b = labelled(label, () => { closeLayer(l); action(); });
      b.disabled = !enabled;
      l.body.append(b);
    }
    return l;
  }
  function sessionActions(row) {
    const l = openLayer(row.title, { className: "ck-small" });
    l.body.append(
      labelled("Abrir conversa", () => {
        closeLayer(l);
        // a linha do historico nao tem painel nem ficha: quem sabe reabri-la e'
        // o openSession, o mesmo da busca completa
        if (row.s) openSession(row.s);
        else activate(row, false);
      }),
    );
    if (row.p) {
      l.body.append(
        labelled("Renomear", () => {
          closeLayer(l);
          renomearAqui(row.p);
        }),
      );
      l.body.append(
        labelled("Ramificar a conversa", () => {
          closeLayer(l);
          ramificar(row.p);
        }),
      );
      l.body.append(
        labelled("Ações, exportar e comandos", () => {
          closeLayer(l);
          menuSkills(row.p);
        }),
      );
      l.body.append(
        labelled("Fechar painel", () => {
          closeLayer(l);
          closePane(row.p.id);
        }),
      );
    }
  }
  function pendingLayer(p) {
    const l = openLayer(tituloNaTorre(p), { className: "ck-pending" });
    l.panel.dataset.pane = p.id;
    const body = node("div", "ck-pending-body");
    l.body.append(body);
    if (p.pedindoPerm || p.filaPerm?.length || p.perguntaAberta || p.planoPendente)
      montarCorpoDaPendencia(p, body);
    else body.append(node("p", "ck-attention", p.uiInterrupted
      ? "A execução foi interrompida. Você pode continuar na conversa."
      : "A execução encontrou um erro. Confira os detalhes na conversa."));
    l.body.append(
      labelled("Ir para a conversa", () => {
        closeLayer(l);
        irAoPainel(p);
      }),
    );
    l.panel.addEventListener("click", () => queueMicrotask(refresh));
  }
  /* Anda pela MESMA lista que o contador soma: liveRows, nao allPanes. O
     contador ja' inclui ficha de pasta fechada; se aqui so' entrasse painel
     vivo, o botao anunciava "1 precisa de atencao" e o clique nao ia a lugar
     nenhum. activate() sabe trocar de pasta e abrir a ficha. */
  /* Anda pela MESMA lista que o contador soma (liveRows, nao allPanes): o
     contador inclui ficha de pasta fechada, e antes o clique nao ia a lugar
     nenhum nesse caso. O lugar onde parei e' guardado em `ultimaPendencia`, e
     NAO deduzido do focusPane: ficha nao tem painel, e o painel restaurado
     depois de activate() ja' nao e' mais "attention" -- o indice dava -1 e o
     ciclo voltava pra primeira linha em toda tecla, deixando as outras
     inalcancaveis. */
  function nextPending() {
    const rows = liveRows().filter((r) => r.state === "attention");
    const hasAutomation = automationAttention().length > 0;
    if (!rows.length) { ultimaPendencia = null; if (hasAutomation) toolLayer("automations"); return; }
    let i = rows.findIndex((r) => r.key === ultimaPendencia);
    if (i < 0) i = rows.findIndex((r) => r.p && r.p === focusPane);
    if (i === rows.length - 1 && hasAutomation) { ultimaPendencia = null; return toolLayer("automations"); }
    const proxima = rows[(i + 1) % rows.length];
    ultimaPendencia = proxima.key;
    if (proxima.p) pendingLayer(proxima.p);
    else activate(proxima);   // ficha: abre a pasta dela e restaura o painel
  }
  /* Shift+Tab e Ctrl+Tab avançam na ordem visível da faixa superior.
     Ctrl+Shift+Tab volta. Cada tecla troca imediatamente, pela mesma função
     do clique (incluindo a animação e a fila de trocas rápidas). */
  function pastaEfetiva() {
    const indo = trocandoAba ? abaPendente || abaIndoPara : null;
    return (indo && abaPorId(indo)?.id) || abaAtual()?.id || null;
  }
  function iconeDaPasta(aba) {
    return aba.tipo === 'ssh' ? 'server' : 'folder';
  }
  function detalheDaPasta(aba) {
    return aba.tipo === 'ssh'
      ? [aba.usuario, aba.host].filter(Boolean).join('@')
      : (aba.caminhos || []).join(' · ');
  }
  function podeTrocarPasta() {
    const aberto = s => {
      const n = q(s);
      return !!n && !n.classList.contains('hidden');
    };
    return !layers.some(l => !l.naoModal) && !dialogoAberto() && !quadro
      && !aberto('#modalGrupo') && !aberto('#popGrupo')
      && !aberto('.p-modal:not(.hidden)')   // a janelinha do painel (menu + ou /): Shift+Tab anda pelos itens
      && !aberto('.p-visor:focus-within');   // leva 5 (R4-04): com o foco no visor, Shift+Tab e' do laco de foco dele
  }
  function pularPasta(passo) {
    if (!podeTrocarPasta()) return false;
    // renderPlaces também usa abasLocais(): arrastar na faixa muda esta lista.
    const abas = abasLocais();
    if (abas.length < 2) return false;
    const atual = Math.max(0, abas.findIndex(a => a.id === pastaEfetiva()));
    const destino = abas[(atual + (passo < 0 ? -1 : 1) + abas.length) % abas.length];
    trocarAbaLocal(destino.id);
    return true;
  }
  function teclaTrocaPasta(e) {
    if (e.key !== 'Tab' || e.altKey || e.metaKey || e.isComposing || (!e.ctrlKey && !e.shiftKey)) return;
    // Em popups, Shift+Tab continua voltando o foco entre seus controles.
    if (!podeTrocarPasta()) return;
    if (!e.ctrlKey && layers.some(l => l.naoModal && l.panel?.contains(d.activeElement))) return;
    stopEvent(e);
    pularPasta(e.ctrlKey && e.shiftKey ? -1 : 1);
  }
  function moveView(view, title) {
    const existing = layers.find((layer) => layer.view === view);
    if (existing) { existing.panel.focus(); return existing; }
    const original = q('.side-view[data-view="' + view + '"]');
    if (!original) return;
    const marker = d.createComment("view " + view);
    original.before(marker);
    const wasHidden = original.classList.contains("hidden");
    const l = openLayer(title, {
      className: "ck-tool-sheet" + (view === "rotinas" ? " ck-automations-sheet" : ""),
      onClose() {
        marker.replaceWith(original);
        original.classList.toggle("hidden", wasHidden);
      },
    });
    l.view = view;
    original.classList.remove("hidden");
    l.body.append(original);
    if (view === "rotinas") pintarRotinas(true);
    if (view === "torre") pintarTorre(false);
    if (view === "explorer" && focusPane)
      loadTree(focusPane.cwd, remotoDoPane(focusPane));
    for (const e of MOTORES)
      if (view === "h" + e) {
        loadHist(e);
        carregarUsoSidebar(e);
        pintarAbasGrupo(e);
        pintarCartaoConta(e);
      }
    if (view === "settings") addPreferences(original);
    return l;
  }
  function closeToolView(view) {
    const layer = layers.find((item) => item.view === view);
    if (layer) closeLayer(layer);
  }
  function addPreferences(settings) {
    settings.classList.add("ck-settings-view");
    settings.closest(".ck-layer")?.classList.add("ck-settings-sheet");
    if (q(".ck-preferences", settings)) return;
    const content = q(".settings", settings);
    const appearance = q(".aj-grupo", content);
    const section = node("div", "ck-preferences");
    for (const [key, title, description, def] of [
      [
        "uiCollapsed",
        "Barra lateral recolhida ao abrir",
        "Só símbolos à esquerda. Ctrl B alterna a qualquer momento.",
        false,
      ],
      [
        "uiPeek",
        "Abrir ao passar o mouse",
        "Com a barra recolhida, abre por cima das conversas.",
        true,
      ],
      [
        "uiLogos",
        "Logos com cores dos motores",
        "Desligado, os logos acompanham a cor do texto.",
        false,
      ],
      [
        "notificationPeek",
        "Mostrar novos avisos por 3 segundos",
        "A prévia recolhe sozinha. O aviso continua guardado na central.",
        true,
      ],
      [
        "notificationSound",
        "Som para perguntas e erros",
        "Um toque curto quando você precisa responder. Cota e restauração ficam silenciosas.",
        true,
      ],
      [
        "autoUpdateEngines",
        "Atualizar Claude e Codex ao abrir",
        "Procura e instala versões novas dos motores deste computador. Vale na próxima abertura.",
        true,
      ],
    ]) {
      const label = node("label", "ck-preference"),
        input = node("input"),
        copy = node("span", "ck-preference-copy");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-label", title);
      input.checked = cfg[key] ?? def;
      input.addEventListener("change", () => {
        cfg[key] = input.checked;
        applyPreferences();
        persist();
      });
      copy.append(
        node("span", "aj-nome", title),
        node("span", "aj-desc", description),
      );
      label.append(copy, input);
      if (key === "autoUpdateEngines") {
        const motors = [...content.querySelectorAll(".aj-grupo")].find(
          group => group.querySelector("h3")?.textContent.trim() === "Motores",
        );
        const updates = node("div", "ck-preferences");
        updates.append(label);
        (motors || appearance).querySelector("h3").after(updates);
      } else section.append(label);
    }
    const soundRow = node("div", "ck-preference"), soundFeedback = node("span", "ck-hint");
    soundFeedback.setAttribute("role", "status");
    soundFeedback.textContent = "Teste o toque dos avisos.";
    const example = button("", "Ouvir exemplo", async () => {
      example.disabled = true;
      try {
        const played = await root.VisualMac?.playNotificationSound?.();
        soundFeedback.textContent = played ? "Toque de exemplo reproduzido." : "O áudio não está disponível agora. Os avisos continuam aparecendo.";
      } catch { soundFeedback.textContent = "O áudio não está disponível agora. Os avisos continuam aparecendo."; }
      finally { example.disabled = false; }
    }, "ck-notification-sample");
    example.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
    soundRow.append(soundFeedback, example); section.append(soundRow);
    const shortcuts = node("section", "aj-grupo");
    shortcuts.append(node("h3", "aj-titulo", "Atalhos"));
    for (const [keys, title] of [
      ["Ctrl K", "Buscar sessões, arquivos e comandos"],
      ["Ctrl B", "Recolher / expandir navegação"],
      ["Ctrl N", "Nova conversa"],
      ["Ctrl Shift K", "Limpar tela sem apagar histórico"],
      ["Ctrl F", "Buscar nesta conversa"],
      ["F6", "Próxima pendência"],
      ["Ctrl Tab", "Próxima pasta, na ordem da barra"],
      ["Ctrl Shift Tab", "Pasta anterior, na ordem da barra"],
      ["Ctrl PageDown", "Painel seguinte"],
      ["Ctrl PageUp", "Painel anterior"],
      ["Ctrl 1–9", "Focar painel"],
      ["Ctrl Shift 1–9", "Trocar lugar"],
      ["Shift Tab", "Próxima pasta, na ordem da barra"],
      ["Esc", "Fechar a janela em foco"],
    ]) {
      const line = node("div", "ck-shortcut");
      line.append(node("kbd", "", keys), node("span", "", title));
      shortcuts.append(line);
    }
    q(".aj-campo", appearance).after(section);
    root.VisualMac?.addPreferences(settings);
    content.append(shortcuts);
    const themes = q(".temas", appearance);
    const black = q('[data-tema="escuro"]', themes);
    if (black) themes.prepend(black);
    for (const preview of themes.querySelectorAll(".tema-am"))
      preview.setAttribute("aria-hidden", "true");
    const sections = [...content.querySelectorAll(".aj-grupo")];
    const tabs = node("nav", "ck-settings-tabs");
    tabs.setAttribute("aria-label", "Seções dos ajustes");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-orientation", "vertical");
    const icons = [
      "image",
      "sparkles",
      "mic",
      "key-round",
      "sliders-horizontal",
      "code-xml",
    ];
    function selectSection(index, focus = false) {
      sections.forEach((panel, i) => {
        panel.hidden = i !== index;
        const tab = tabs.children[i];
        tab.setAttribute("aria-selected", String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
      });
      content.scrollTop = 0;
      if (focus) tabs.children[index].focus();
    }
    for (const [i, panel] of sections.entries()) {
      panel.id = "ck-settings-section-" + i;
      const heading = panel.querySelector("h3");
      const title =
        heading?.textContent === "Motores"
          ? "Motores e contas"
          : heading?.textContent || "Geral";
      if (heading) heading.textContent = title;
      const tab = button(icons[i], title, () => selectSection(i));
      tab.append(node("span", "", title));
      tab.id = "ck-settings-tab-" + i;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panel.id);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;
      tab.addEventListener("keydown", (event) => {
        const direction = ["ArrowDown", "ArrowRight"].includes(event.key)
          ? 1
          : ["ArrowUp", "ArrowLeft"].includes(event.key)
            ? -1
            : 0;
        if (!direction && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? sections.length - 1
              : (i + direction + sections.length) % sections.length;
        selectSection(index, true);
      });
      tabs.append(tab);
    }
    settings.prepend(tabs);
    selectSection(0);
  }
  function historyLayer() {
    const l = openLayer("Conversas guardadas", { className: "ck-small" });
    for (const e of MOTORES)
      l.body.append(
        labelled(nomeDoMotor(e), () => {
          closeLayer(l);
          moveView("h" + e, "Conversas do " + nomeDoMotor(e));
        }),
      );
    l.body.append(
      labelled("Grupos", () => {
        closeLayer(l);
        abrirModalGrupo();
      }),
    );
  }
  function commands() {
    return [
      [
        "Nova conversa",
        "plus",
        () => novaConversa(focusPane?.engine || cfg.lastEngine || "claude"),
      ],
      ["Novo lugar", "folder", () => abrirModalAbaLocal()],
      ["Conversas guardadas e favoritos", "star", historyLayer],
      ["Grupos", "folder", () => abrirModalGrupo()],
      ["Ajustes e atalhos", "settings", () => toolLayer("settings")],
      ["Arquivos", "file", () => toolLayer("files")],
      ["Terminal", "terminal", () => toolLayer("terminal")],
      ["Mudanças", "git-compare", () => toolLayer("changes")],
      ["Quadro", "workflow", () => toolLayer("board")],
      ["Automações", "rotate-cw", () => toolLayer("automations")],
      ["Diagnóstico dos conectores", "plug", () => toolLayer("health")],
      // leva 5i: os dois botoes da barra (⚖ e 👥) tambem saem no encaixe mais apertado; o Ctrl+K e o / sao o caminho para eles, da conversa em foco
      [
        "Debater com Codex e Claude",
        "scale",
        () => focusPane && window.CockpitCollaboration?.open(focusPane),
      ],
      [
        "Workflow dos agentes",
        "users",
        () => focusPane && window.CockpitCollaboration?.workflow(focusPane),
      ],
      [
        "Torre de controle e sessões externas",
        "server",
        () => moveView("torre", "Torre de controle"),
      ],
      [
        "Limpar tela da conversa",
        "eraser",
        () => {
          if (focusPane) {
            focusPane.chat.innerHTML = "";
            focusPane.blocks.clear();
            focusPane.tools.clear();
            esquecerPassos(focusPane);
            note(focusPane, "Tela limpa. A conversa continua de onde estava.");
          }
        },
      ],
      [
        "Exportar e ações da conversa",
        "upload",
        () => focusPane && menuSkills(focusPane),
      ],
      [
        "Ramificar conversa",
        "git-branch",
        () => focusPane && ramificar(focusPane),
      ],
    ].map(([title, icon, run]) => ({ title, icon, run, detail: "Comando" }));
  }
  function palette() {
    let debounce, scope='all', selectedResult=null, pendingScans=[];
    const cancelScans=()=>{for(const cancel of pendingScans)cancel();pendingScans=[];};
    const l = openLayer('Buscar', {className:'ck-palette',onClose(){searchSeq++;clearTimeout(debounce);cancelScans();}});
    const input=node('input','ck-search');input.type='search';input.placeholder='Agentes, pastas, arquivos · @agente · /arquivo · >comando';
    for(const [k,v] of Object.entries({'aria-label':'Buscar no Cockpit',role:'combobox','aria-expanded':'true','aria-controls':'ck-results-'+l.id,'aria-autocomplete':'list'}))input.setAttribute(k,v);
    const filters=node('div','ck-search-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrar busca');
    const scopes=[['all','Tudo'],['agents','Conversas'],['folders','Pastas'],['files','Arquivos'],['commands','Comandos']];
    for(const [value,label] of scopes){
      const b=labelled(label,()=>{scope=value;clearTimeout(debounce);search();input.focus();},'ck-search-filter');
      b.dataset.scope=value;b.setAttribute('aria-pressed',String(scope===value));filters.append(b);
    }
    const list=node('div','ck-results');list.id='ck-results-'+l.id;list.setAttribute('role','listbox');list.setAttribute('aria-label','Resultados da busca');
    const status=node('p','ck-search-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    const help=node('p','ck-search-help','↑ ↓ escolher · Enter abrir · Esc fechar');help.id='ck-search-help-'+l.id;input.setAttribute('aria-describedby',help.id);
    l.body.append(input,filters,list,status,help);
    let results=[],selected=0;
    /* "Conversas" separado de "Agentes": conversa guardada aparecia sob o rotulo
       AGENTES, junto das sessoes vivas, e nao dava pra saber o que estava
       rodando e o que era historico. */
    const order=['Agentes','Conversas','Pastas','Arquivos','Comandos'];
    function paint(){
      results.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group));
      // Novos arquivos/conversas podem entrar antes do item escolhido. Preserva
      // o objeto, não o índice, para Enter continuar abrindo o mesmo resultado.
      if(selectedResult&&results.includes(selectedResult))selected=results.indexOf(selectedResult);
      if(selected>=80)selected=-1;
      if(selected>=results.length)selected=0;
      selectedResult=results[selected]||null;
      list.replaceChildren();let last;
      results.slice(0,80).forEach((r,i)=>{
        if(r.group!==last){const heading=node('div','ck-result-group',r.group);heading.setAttribute('role','presentation');list.append(heading);last=r.group;}
        const b=button(r.icon||'messages-square',r.title,()=>{closeLayer(l);r.run();},'ck-result');
        b.id='ck-result-'+l.id+'-'+i;b.tabIndex=-1;b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===selected));
        b.setAttribute('aria-label',[r.title,r.detail].filter(Boolean).join(' · '));
        const text=node('span','ck-result-text');text.append(node('strong','',r.title),node('small','',r.detail));b.append(text);list.append(b);
      });
      if(results[selected])input.setAttribute('aria-activedescendant','ck-result-'+l.id+'-'+selected);else input.removeAttribute('aria-activedescendant');
    }
    function pathQuery(text,p,remote){
      let raw=text,base=p.cwd||cfg.defCwd||HOME;
      const join=(a,b)=>a.replace(/[\\/]+$/,'')+(remote?'/':'/')+b;
      if(raw.startsWith('~')){base=remote?'~':HOME;raw=raw.slice(1).replace(/^[\\/]/,'');}
      else if(/^[A-Za-z]:[\\/]/.test(raw)||raw.startsWith('\\\\')||(remote&&raw.startsWith('/'))){
        const ix=Math.max(raw.lastIndexOf('/'),raw.lastIndexOf('\\'));return{base:raw.slice(0,ix+1),term:raw.slice(ix+1)};
      }else raw=raw.replace(/^\//,'');
      const ix=Math.max(raw.lastIndexOf('/'),raw.lastIndexOf('\\'));
      if(ix>=0){base=join(base,raw.slice(0,ix));raw=raw.slice(ix+1);}
      return{base,term:raw};
    }
    async function search(){
      cancelScans();
      const seq=++searchSeq,text=input.value.trim(),kind=scope==='all'?searchKind(text):scope,term=searchText(text.replace(/^[>@]/,''));
      const p=focusPane,aba=abaAtual();selected=0;selectedResult=null;results=[];
      for(const b of filters.children)b.setAttribute('aria-pressed',String(b.dataset.scope===scope));
      list.setAttribute('aria-busy','false');
      const valid=()=>!l.closed&&seq===searchSeq;
      if(kind==='all'||kind==='agents')results.push(...liveRows().filter(r=>searchText(r.title+' '+r.engine+' '+r.aba?.nome).includes(term)).map(r=>({group:'Agentes',key:r.engine+'|'+(r.p?.sessaoId||r.f?.sessaoId||r.id),title:r.title,detail:STATES[r.state].glyph+' '+nomeDoMotor(r.engine)+' · '+(r.aba?.nome||''),run:()=>activate(r,false)})));
      if(kind==='all'||kind==='folders')results.push(...abasLocais().filter(a=>searchText(a.nome+' '+(a.caminhos||[]).join(' ')+' '+(a.host||'')).includes(term)).map(a=>({group:'Pastas',title:a.nome,detail:detalheDaPasta(a),icon:iconeDaPasta(a),run:()=>trocarAbaLocal(a.id)})));
      if(kind==='all'||kind==='commands')results.push(...commands().filter(c=>searchText(c.title).includes(term)).map(c=>({...c,group:'Comandos'})));
      paint();status.textContent=results.length+' resultados';
      const jobs=[];const warnings=[];
      if((kind==='files'||(kind==='all'&&term.length>1))&&p)jobs.push((async()=>{
        const remote=remotoDoPane(p);if(faltaConfigurarServidor(remote))throw Error(AVISO_ABA_EM_BRANCO);
        const query=pathQuery(text,p,remote);
        const values=await Promise.allSettled([window.api.listDir(query.base,remote||undefined),query.term?window.api.buscarArquivos({cwd:query.base,termo:query.term,remoto:remote||undefined}):Promise.resolve([])]);
        if(!valid())return;
        const seen=new Set();
        const append=f=>{
          const path=f.path||f.caminho;if(!path||seen.has(path))return;seen.add(path);
          const name=f.name||f.nome||path;
          if(f.dir){
            results.push({group:'Pastas',title:name,detail:path,icon:remote?'server':'folder',run:()=>{
              const same=a=>a.tipo==='ssh'?!!remote&&a.host===remote.host&&a.usuario===remote.usuario&&Number(a.porta||22)===Number(remote.porta||22)&&(a.chave||'')===(remote.chave||'')&&a.caminhoRemoto===path:!remote&&(a.caminhos||[]).includes(path);
              const found=abasLocais().find(same);found?trocarAbaLocal(found.id):abrirModalAbaLocal(null,{caminho:path,remoto:remote});
            }});
          }else results.push({group:'Arquivos',title:name,detail:path,icon:'file',run:()=>verArquivo(p,path,remote)});
        };
        values.forEach((value,i)=>{
          if(value.status==='rejected'){warnings.push(value.reason?.message||'Consulta indisponível');return;}
          const answer=value.value;if(answer?.error){warnings.push(answer.error);return;}
          const entries=Array.isArray(answer)?answer:answer?.entries||answer?.itens||[];
          entries.filter(f=>i===1||searchText(f.name||f.nome||'').includes(searchText(query.term))).forEach(append);
        });
        paint();
      })());
      if((kind==='all'&&term.length>1)||kind==='agents')jobs.push((async()=>{
        const remote=remotoDoAba(aba);
        /* R4-06: cada lote traz a lista ACUMULADA (até 5000). O texto de busca de cada conversa é normalizado uma vez e
           guardado por motor|id; só normaliza de novo se o título mudar. Antes: normalize NFD duas vezes por conversa,
           na lista inteira, a cada lote. */
        const textoDeBusca=new Map();
        const casa=(engine,s)=>{
          const fonte=(s.titulo||s.title||s.nome||'')+' '+(s.tituloOriginal||'')+' '+engine,chave=engine+'|'+s.id;
          let guardado=textoDeBusca.get(chave);
          if(!guardado||guardado.fonte!==fonte)textoDeBusca.set(chave,guardado={fonte,texto:searchText(fonte)});
          return guardado.texto.includes(term);
        };
        function appendSessions(engine,items){
          if(!valid())return;
          const snapshot=(Array.isArray(items)?items:items.itens||[]).filter(s=>casa(engine,s));
          const keys=new Set(snapshot.map(s=>engine+'|'+s.id));
          const retained=results.filter(r=>r.group!=='Conversas'||!r.key.startsWith(engine+'|')||keys.has(r.key));
          if(selectedResult&&!retained.includes(selectedResult)){selected=-1;selectedResult=null;}
          results=retained;
          const seen=new Set(results.map(r=>r.key).filter(Boolean));
          const existing=new Map(results.filter(r=>r.group==='Conversas').map(r=>[r.key,r]));
          for(const s of snapshot){
            const previous=existing.get(engine+'|'+s.id);
            if(previous){previous.title=s.titulo||s.title||s.nome||'Conversa';previous.run=async()=>{if(aba&&cfg.abaAtiva!==aba.id)await trocarAbaLocal(aba.id);openSession({...s,engine});};continue;}
            const key=engine+'|'+s.id;if(seen.has(key))continue;seen.add(key);
            results.push({group:'Conversas',key,title:s.titulo||s.title||s.nome||'Conversa',detail:'Guardada · '+nomeDoMotor(engine)+' · '+(aba?.nome||''),run:async()=>{if(aba&&cfg.abaAtiva!==aba.id)await trocarAbaLocal(aba.id);openSession({...s,engine});}});
          }
          paint();
        }
        const loaded=await Promise.allSettled(MOTORES.map(async engine=>({engine,items:await listarSessoesComProgresso(engine,{
          remoto:remote,incluirRobos:!!cfg.verRobos,scope:'paleta-'+l.id,
          registrarCancel:cancel=>pendingScans.push(cancel),
          onProgress:items=>{appendSessions(engine,items);if(valid())status.textContent=results.length+' resultados · Carregando mais conversas…';}
        })})));
        if(!valid())return;
        for(const answer of loaded){
          if(answer.status!=='fulfilled'){warnings.push(answer.reason?.message||'Histórico indisponível');continue;}
          const {engine,items}=answer.value;if(!items||items.cancelled)continue;
          if(items.error||items.erro){warnings.push(items.error||items.erro);continue;}
          if(items.truncated)warnings.push('Histórico parcial: limite de arquivos ou conversas atingido');
          if(items.aviso)warnings.push(items.aviso);
          appendSessions(engine,items);
        }
      })());
      if(jobs.length){list.setAttribute('aria-busy','true');status.textContent='Buscando…';const settled=await Promise.allSettled(jobs);if(!valid())return;for(const r of settled)if(r.status==='rejected')warnings.push(r.reason?.message||'Consulta indisponível');}
      if(valid()){
        paint();list.setAttribute('aria-busy','false');
        const total=results.length>80?'80 de '+results.length+' resultados · Refine a busca':results.length?results.length+' resultados':'Nenhum resultado. Tente outro termo ou filtro.';
        status.textContent=(kind==='files'&&!p?'Abra uma conversa para buscar arquivos nesta pasta.':total)+(warnings.length?' · '+[...new Set(warnings)].join(' · '):'');
      }
    }
    input.addEventListener('input',()=>{
      searchSeq++;clearTimeout(debounce);cancelScans();results=[];selected=0;selectedResult=null;paint();
      list.setAttribute('aria-busy','true');status.textContent='Buscando…';debounce=setTimeout(search,180);
    });
    input.addEventListener('keydown',e=>{
      if(e.isComposing)return;
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();selected=Math.max(0,Math.min(Math.min(results.length,80)-1,selected+(e.key==='ArrowDown'?1:-1)));selectedResult=results[selected]||null;paint();q('[aria-selected="true"]',list)?.scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'&&results[selected]){e.preventDefault();const r=results[selected];closeLayer(l);r.run();}
    });
    search();queueMicrotask(()=>input.focus());return l;
  }
  async function agentLayer(p, section, origem) {
    /* Leva 5h (seção 1 da spec, decisão do Hugo em 08/10): a camada grande "Agente" (motor + modelo + esforço + permissões + envio + conta, no meio
       da tela) saiu de cena. O chip da caixa tem 3 botões (motor, modelo, permissão) e cada um abre o SEU menuzinho: uma janelinha pequena, colada no
       botão, aberta para cima, como a do + (leva 5d). Quem chamava a camada continua chamando o agentLayer, com a mesma assinatura: 'engine' abre o
       do motor, 'mode' o da permissão, e 'model', 'effort' ou sem parte o do modelo. Tudo o que a camada fazia continua valendo, no mesmo código,
       repartido em pedaços que os três usam (chipController e um pintor por menuzinho, logo abaixo).
       Rodada 2 da leva 5h, item 7: o terceiro parâmetro (origem) é o botão que abriu, quando NÃO é o chip: o logo do motor do cabeçalho do painel.
       A janelinha ancora nele (chipAncorar), e não no chip, a ~772 px dali. Chip, paleta e ⌘⇧M seguem sem origem. */
    return chipMenu(p, section === "mode" ? "perm" : section === "engine" ? "motor" : "modelo", origem);
  }
  async function chipMenu(p, peca, origem) {
    if (!p || p.morto) return null;
    const m = chipController(p, peca, origem);
    await m.repintar();
    return m;
  }
  /* A janelinha é a .modal-cx do próprio painel (novoMenu, do app.js): só um menu aberto por vez, o Esc fecha e devolve o foco a quem abriu, clique
     fora fecha. `m` guarda o que os três menuzinhos dividem:
     - a geração (m.geracao) e o m.snap de cada pintura: uma consulta atrasada nunca repinta uma janelinha que já foi fechada, trocada por outra
       ou que mudou de lugar, de conta ou de motor (as mesmas conferências da camada grande);
     - o m.change(): o "Atualizando…", os botões desligados e o aria-busy enquanto a troca roda, a mensagem de quando ela não pegou, e a repintura
       com o foco de volta no botão usado;
     - a posição (chipAncorar) e o teclado (chipTeclado). */
  function chipController(p, peca, origem) {
    const cx = novoMenu(p), modal = q(".p-modal", p.el), id = (cx._chipId || 0) + 1;
    cx._chipId = id;
    cx.classList.add("menu-chip", "mz-" + peca);
    if (peca === "modelo" && p.engine === "acp") cx.classList.add("mz-acp");
    const m = {
      p, peca, cx, id, origem: origem || null, geracao: 0, mudando: false, snap: null, conteudo: null, aviso: null, comparacao: null, ordem: "power", pedidoComparacao: null,
      // fechada: outro menu tomou a caixa (o novoMenu refaz a classe) ou ela foi fechada (clique fora, Esc, uma escolha que fecha)
      get fechado() {
        return cx._chipId !== id || !cx.classList.contains("menu-chip") || !modal || !modal.classList.contains("como-menu");
      },
      controles() {
        return [...cx.querySelectorAll("[data-chave]")];
      },
      avisar(texto) {
        if (!m.aviso) return;
        m.aviso.textContent = texto || "";
        m.aviso.hidden = !texto;
      },
      // o foco vai para o controle pedido (a chave) e, sem ele, para o que está escolhido, e por último para o primeiro ligado
      focar(chave) {
        if (m.fechado) return;
        const ligados = m.controles().filter((b) => !b.disabled);
        const alvo = (chave && ligados.find((b) => b.dataset.chave === chave))
          || ligados.find((b) => b.getAttribute("aria-checked") === "true") || ligados[0];
        if (!alvo) return;
        alvo.focus({ preventScroll: true });
        alvo.scrollIntoView?.({ block: "nearest" });
      },
      async change(acao, foco, esperado, recusado = "", confirmado) {
        const snap = m.snap;
        if (m.mudando || !snap || !snap.valida()) return;
        m.mudando = true;
        const antes = m.controles().map((b) => [b, b.disabled]);
        antes.forEach(([b]) => { b.disabled = true; });
        cx.setAttribute("aria-busy", "true");
        m.avisar("Atualizando…");
        let erro = "";
        try { await acao(); }
        catch (e) { erro = "Não consegui concluir a mudança. " + String(e?.message || e); }
        finally {
          m.mudando = false;
          antes.forEach(([b, estava]) => { if (b.isConnected) b.disabled = estava; });
          cx.removeAttribute("aria-busy");
        }
        if (!snap.mesmoLugar()) return;
        if (!erro && (p.engine !== (esperado || snap.motor) || (confirmado && !confirmado())))
          erro = recusado || "A escolha não foi alterada. Tente novamente.";
        refresh();
        await m.repintar(foco, erro);
      },
      async repintar(foco, mensagem = "") {
        if (m.fechado || p.morto) return;
        const geracao = ++m.geracao, lugar = remotoDoPane(p), chaveDoLugar = JSON.stringify(lugar),
          aba = p.abaId, conta = p.uiContaGeracao || 0, motor = p.engine;
        const mesmoLugar = () => !m.fechado && !p.morto && geracao === m.geracao && p.abaId === aba
          && JSON.stringify(remotoDoPane(p)) === chaveDoLugar && (p.uiContaGeracao || 0) === conta;
        m.snap = { lugar, motor, mesmoLugar, valida: () => mesmoLugar() && p.engine === motor };
        cx.dataset.engine = motor;
        m.conteudo = node("div", "mz-conteudo");
        m.aviso = node("p", "mz-aviso");
        m.aviso.setAttribute("role", "status");
        cx.replaceChildren(m.conteudo, m.aviso);
        m.avisar(mensagem);
        chipAncorar(m);
        if (peca === "motor") await chipPintarMotor(m, foco);
        else if (peca === "modelo") await chipPintarModelo(m, foco);
        else chipPintarPerm(m, foco);
      },
    };
    cx.onkeydown = (e) => chipTeclado(m, e);
    return m;
  }
  /* Cola a janelinha no botão do chip, como o menuMais faz com o +: mede o botão e grava duas medidas na .modal-cx. --mi-dir: do lado direito
     de dentro do painel (sem a borda de 1 px dele) até o lado direito do botão, que é por onde a janelinha se alinha (os botões do chip ficam
     na ponta direita da linha de baixo, e a janelinha cresce para a esquerda); --mi-base: do pé do painel até o TOPO do botão, de onde ela sobe.
     Sem medida (painel ou botão fora da tela, sem caixa) nada é gravado e o CSS fica com os valores de reserva. */
  function chipAncorar(m) {
    const { p, cx, peca, origem } = m;
    const doChip = q({ motor: ".pm-motor", modelo: ".pm-modelo", perm: ".pm-perm" }[peca], p.el);
    /* Rodada 2 da leva 5h, item 7: quem abriu manda. Aberta pelo logo do motor do CABEÇALHO do painel (origem), a janelinha cola nele em vez de
       ir para o chip, a ~772 px dali: sobe se há mais espaço em cima do botão do que embaixo, senão DESCE (o cabeçalho fica no alto, então desce:
       --mi-topo, do topo do painel até o pé do botão, e a classe mz-desce), e alinha pela esquerda (--mi-esq e mz-esq) se o botão está na metade
       esquerda do painel, senão pela direita (--mi-dir). Sem origem, com o próprio botão do chip como origem, desconectada ou sem medida, vale o
       chip de sempre: sobe, alinhada pela direita. */
    const daOrigem = origem && origem !== doChip && origem.isConnected && origem.getBoundingClientRect ? origem.getBoundingClientRect() : null;
    const usaOrigem = !!(daOrigem && daOrigem.width);
    const botao = usaOrigem ? origem : doChip;
    if (!botao || !p.el.getBoundingClientRect) return;
    const bm = usaOrigem ? daOrigem : botao.getBoundingClientRect(), bp = p.el.getBoundingClientRect();
    if (!bm.width || !bp.width) return;
    const bordaEsq = p.el.clientLeft || 0, bordaTopo = p.el.clientTop || 0;
    const desce = usaOrigem && (bm.top - bp.top) < (bp.bottom - bm.bottom);
    const aEsquerda = usaOrigem && (bm.left + bm.right) < (bp.left + bp.right);
    cx.classList.toggle("mz-desce", desce);
    cx.classList.toggle("mz-esq", aEsquerda);
    if (desce) cx.style.setProperty("--mi-topo", Math.max(0, Math.round(bm.bottom - bp.top - bordaTopo)) + "px");
    else cx.style.setProperty("--mi-base", Math.max(0, Math.round(bp.bottom - bm.top)) + "px");
    if (aEsquerda) cx.style.setProperty("--mi-esq", Math.max(0, Math.round(bm.left - bp.left - bordaEsq)) + "px");
    else cx.style.setProperty("--mi-dir", Math.max(0, Math.round(bp.right - bm.right - bordaEsq)) + "px");
  }
  /* Um botão só de ícone (ou de logo) da janelinha. O nome vai no aria-label e o "nome — descrição" no hover (title), como nos itens do +. A chave
     (data-chave) é a identidade do controle: o foco volta nele depois de uma repintura, e o teclado anda pelos que têm role="menuitem*". */
  function chipControle(o) {
    const b = node("button", "mz-item " + (o.classe || ""));
    b.type = "button";
    b.setAttribute("role", o.papel || "menuitem");
    b.setAttribute("aria-label", o.rotulo);
    b.title = o.dica || o.rotulo;
    b.dataset.chave = o.chave;
    for (const [k, v] of Object.entries(o.dados || {})) b.dataset[k] = v;
    if (o.ic) b.innerHTML = ico(o.ic);
    else if (o.svg) b.innerHTML = o.svg;
    if (o.papel && o.papel !== "menuitem") {
      b.setAttribute("aria-checked", String(!!o.marcado));
      b.classList.toggle("mz-sel", !!o.marcado);
    }
    if (o.desligado) b.disabled = true;
    if (o.acao) b.addEventListener("click", o.acao);
    return b;
  }
  /* As setas andam pelos itens (direita e baixo para frente, esquerda e cima para trás, dando a volta nas pontas), Home e End vão às pontas e o
     Tab dá a volta dentro da janelinha, como o do +. Itens desligados são pulados. Tecla com Ctrl, Alt ou Cmd é atalho do app e passa; a tecla num
     campo de texto (o do ACP) é do campo. O Esc é do Esc global do app: fecha e devolve o foco a quem abriu. */
  function chipTeclado(m, e) {
    if (m.fechado || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.matches && e.target.matches("input, textarea")) return;
    const itens = [...m.cx.querySelectorAll('[role^="menuitem"]')].filter((b) => !b.disabled), n = itens.length;
    if (!n) return;
    const i = itens.indexOf(d.activeElement);
    let alvo = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") alvo = itens[(i + 1) % n];
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") alvo = itens[i <= 0 ? n - 1 : i - 1];
    else if (e.key === "Home") alvo = itens[0];
    else if (e.key === "End") alvo = itens[n - 1];
    else if (e.key === "Tab" && i >= 0 && (e.shiftKey ? i === 0 : i === n - 1)) alvo = e.shiftKey ? itens[n - 1] : itens[0];
    if (!alvo) return;
    e.preventDefault();
    e.stopPropagation();
    alvo.focus();
  }
  // MOTOR: os 5 logos, só ícone. O indisponível fica apagado, com o motivo no hover. Vale o mesmo motoresDisponiveis e o mesmo trocarMotor de sempre.
  /* Leva 5i (IAs pelo ACP): depois dos 5 logos, um traço e uma linha com os logos das IAs do ACP que estão INSTALADAS (a lista vem do
     motoresDisponiveis, em acp.presets; as que faltam não aparecem), cada uma com o nome no hover e no aria. Escolher uma põe o painel no ACP
     com o comando daquela IA (usarIaAcp: trocar de motor já com o comando, ou só trocar o agente se o painel já é do ACP). O 4º logo, o do
     Grok, também abre o ACP, com "grok agent stdio" (o CLI oficial não fala o formato do motor nativo; ver comandoDoGrokNoAcp). Sem o
     acp-presets.js nada disso aparece: ficam os 5 logos de sempre. Teclado, foco e Esc são os de todo item do menuzinho (chipTeclado). */
  async function chipPintarMotor(m, foco) {
    const { p, snap, conteudo } = m;
    let disponiveis;
    try { disponiveis = await window.api.motoresDisponiveis(snap.lugar || null); }
    catch { disponiveis = {}; }
    if (!snap.valida()) return;
    const IAS = window.CockpitAcpPresets, comIas = !!IAS && typeof usarIaAcp === "function" && typeof iaDoPainel === "function";
    const atual = comIas ? iaDoPainel(p) : null;
    const linha = node("div", "mz-linha mz-motores");
    linha.setAttribute("role", "group");
    linha.setAttribute("aria-label", "Motor");
    for (const eng of MOTORES) {
      const info = disponiveis?.[eng], liberado = typeof info === "boolean" ? info : info?.disponivel;
      const nome = nomeDoMotor(eng) + (liberado === false ? " · indisponível" : "");
      const motivo = liberado === false ? info?.detalhe || (snap.lugar ? "não roda neste servidor" : "não instalado nesta máquina") : "";
      const grok = comIas && eng === "grok";
      // o plugue só fica marcado num painel do ACP cuja IA não tem lugar próprio (o 4º logo ou a linha de baixo): "Outro comando…", ou o Gemini, o Claude Code e o Codex pelos adaptadores
      const marcado = grok ? (p.engine === "grok" || atual?.ia === "grok-build")
        : (comIas && eng === "acp") ? (p.engine === "acp" && !IAS.temLugarProprio(atual))
        : p.engine === eng;
      linha.append(chipControle({
        svg: svgMotor(eng), rotulo: nome, dica: motivo ? nome + " · " + motivo : nome, papel: "menuitemradio", marcado,
        desligado: liberado !== true, classe: "mz-icone mz-motor-op", chave: "motor:" + eng, dados: { motor: eng },
        acao: async () => {
          if (grok) {
            if (iaDoPainel(p)?.ia === "grok-build") return;
            await m.change(() => usarIaAcp(p, IAS.GROK_COMANDO), "motor:" + eng, "acp", "Este motor não pôde ser ativado neste destino. O motor anterior foi mantido.", () => iaDoPainel(p)?.ia === "grok-build");
            return;
          }
          if (eng === snap.motor) return;
          await m.change(() => trocarMotor(p, eng), "motor:" + eng, eng, "Este motor não pôde ser ativado neste destino. O motor anterior foi mantido.");
        },
      }));
    }
    conteudo.append(linha);
    const instaladas = comIas && Array.isArray(disponiveis?.acp?.presets) ? IAS.daLinha(disponiveis.acp.presets) : [];
    if (instaladas.length) {
      const traco = node("div", "mz-traco");
      traco.setAttribute("role", "separator");
      const ias = node("div", "mz-linha mz-ias");
      ias.setAttribute("role", "group");
      ias.setAttribute("aria-label", "IAs pelo ACP");
      for (const ia of instaladas) {
        ias.append(chipControle({
          svg: svgIa(ia.ia), rotulo: ia.nome, dica: ia.nome, papel: "menuitemradio", marcado: atual?.ia === ia.ia,
          classe: "mz-icone mz-ia-op", chave: "ia:" + ia.ia, dados: { ia: ia.ia },
          acao: async () => {
            if (iaDoPainel(p)?.ia === ia.ia) return;
            await m.change(() => usarIaAcp(p, ia.comando), "ia:" + ia.ia, "acp", "Esta IA não pôde ser ativada neste painel. A anterior foi mantida.", () => iaDoPainel(p)?.ia === ia.ia);
          },
        }));
      }
      conteudo.append(traco, ias);
    }
    m.focar(foco);
  }
  /* MODELO: a lista (ícone da família + nome + anel de peso; o escolhido destacado; descrição, nota AA e cota no hover), o esforço em barrinhas
     com o ícone brain, e o rodapé de ícones: ordenar por poder ou por cota, o Artificial Analysis, atualizar a lista, o escudo do Sonnet reserva
     (só no Claude) e conta e consumo. No ACP, o pintarMenuAcp de sempre vai dentro da janelinha. A lista aparece JÁ com o que se conhece; a consulta
     ao catálogo (Claude e Codex) segue por trás e, chegando, repinta tudo (o esforço depende do catálogo). */
  async function chipPintarModelo(m, foco) {
    const { p, snap, conteudo } = m, M = window.CockpitModels, lugar = snap.lugar;
    const catalogo = p.engine === "claude" || p.engine === "codex";
    const icone = (classe, nome) => { const s = node("span", classe); s.innerHTML = ico(nome); return s; };
    const rodape = node("div", "mz-linha mz-rodape");
    rodape.setAttribute("role", "group");
    rodape.setAttribute("aria-label", "Ferramentas do modelo");
    if (p.engine === "acp") {
      const acp = node("div", "mz-acp-conteudo");
      pintarMenuAcp(p, acp);
      conteudo.append(acp);
    } else {
      const lista = node("div", "mz-lista");
      lista.setAttribute("role", "group");
      lista.setAttribute("aria-label", "Modelos");
      conteudo.append(lista);
      const lerComparacao = (atualizar) => Promise.resolve().then(() => window.api.modelBenchmarks?.(!!atualizar))
        .then((valor) => { m.comparacao = valor || null; }).catch(() => {});
      if (!m.pedidoComparacao) m.pedidoComparacao = lerComparacao(false);
      const botoesDeOrdem = [];
      const marcarOrdem = () => {
        for (const [ordem, b] of botoesDeOrdem) {
          const ligado = m.ordem === ordem;
          b.classList.toggle("mz-sel", ligado);
          b.setAttribute("aria-checked", String(ligado));
        }
      };
      const pintarLista = () => {
        if (!snap.valida()) return;
        const emFoco = lista.contains(d.activeElement) ? d.activeElement.dataset.chave : null;
        lista.replaceChildren();
        for (const mo of M.ordered(modelosDe(p), p.engine, m.comparacao, m.ordem)) {
          const exibir = M.present(mo, p.engine), fam = M.familia(mo, p.engine), info = catalogo ? M.metrics(mo, p.engine, m.comparacao) : null;
          const janela = Number(mo.contextWindow || mo.context_window);
          const dica = [exibir.name + " · " + exibir.description, info && info.label, info && info.detail,
            janela > 0 && "Contexto: " + janela.toLocaleString("pt-BR") + " tokens", mo.upgrade && "Alternativa sugerida: " + mo.upgrade,
            (mo.hidden || mo.preserved) && "Fora das sugestões atuais · escolha mantida"].filter(Boolean).join("\n");
          const linha = chipControle({
            rotulo: exibir.name, dica, papel: "menuitemradio", marcado: mo.id === p.model, classe: "mz-modelo-op", chave: "modelo:" + mo.id,
            acao: async () => {
              if (mo.id === p.model) return;
              await m.change(() => trocarModeloDoPainel(p, mo), "modelo:" + mo.id);
            },
          });
          if (fam) linha.append(icone("mz-fam", fam.icone));
          linha.append(node("span", "mz-nome", exibir.name));
          if (fam) linha.append(icone("mz-anel", "peso-" + fam.peso));
          lista.append(linha);
        }
        marcarOrdem();
        if (emFoco) m.focar(emFoco);
      };
      pintarLista();
      // o benchmark que chega depois só muda o hover (a nota AA, a data da leitura) e a ordem por poder: repinta a lista e o hover do AA, nada mais
      let botaoAA = null;
      const dicaDoAA = () => "Ver benchmarks no Artificial Analysis" + (m.comparacao?.checkedAt ? " · lido em " + new Date(m.comparacao.checkedAt)
        .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        + (m.comparacao.status === "snapshot" ? " · cópia de referência" : m.comparacao.stale ? " · última leitura" : "") : "");
      m.pedidoComparacao.then(() => {
        if (!snap.valida() || m.mudando) return;
        pintarLista();
        if (botaoAA) botaoAA.title = dicaDoAA();
      });
      const niveis = (modeloAtual(p)?.efforts || []).map((e) => (typeof e === "string" ? { id: e } : e)).filter((e) => e.id);
      if (niveis.length) {
        const esforco = node("div", "mz-esforco");
        esforco.setAttribute("role", "group");
        esforco.setAttribute("aria-label", "Esforço do modelo");
        const cerebro = icone("mz-cerebro", "brain");
        cerebro.setAttribute("aria-hidden", "true");
        esforco.append(cerebro);
        const atual = niveis.findIndex((n) => n.id === p.effort);
        niveis.forEach((nivel, i) => {
          const nome = EF_PT[nivel.id] || nivel.id;
          const barra = chipControle({
            rotulo: "Esforço: " + nome, dica: nome + " — " + (EF_DESC_PT[nivel.id] || "O modelo usa o esforço padrão."), papel: "menuitemradio",
            marcado: nivel.id === p.effort, classe: "mz-barra" + (i <= atual ? " mz-acesa" : ""), chave: "esforco:" + nivel.id,
            acao: async () => {
              if (p.effort === nivel.id) return;
              await m.change(() => trocarEsforco(p, nivel.id), "esforco:" + nivel.id);
            },
          });
          const marca = node("span");
          marca.style.height = 7 + i * 3 + "px";
          barra.append(marca);
          esforco.append(barra);
        });
        conteudo.append(esforco);
      }
      if (catalogo) {
        for (const [ordem, ic, rotulo, dica] of [
          ["power", "chart-no-axes-column-increasing", "Ordenar por poder", "Ordenar por poder: maior nota medida"],
          ["quota", "battery", "Ordenar pela cota", "Ordenar pela cota: menor gasto primeiro. Referência oficial, conferida em 29/09/2026. Gasto relativo; não é uma previsão de percentual."],
        ]) {
          const b = chipControle({
            ic, rotulo, dica, papel: "menuitemradio", marcado: m.ordem === ordem, classe: "mz-icone", chave: "ordem:" + ordem,
            acao: () => {
              if (!snap.valida() || m.mudando) return;
              m.ordem = ordem;
              pintarLista();
            },
          });
          botoesDeOrdem.push([ordem, b]);
          rodape.append(b);
        }
        botaoAA = chipControle({
          ic: "external-link", rotulo: "Ver benchmarks no Artificial Analysis", classe: "mz-icone", chave: "aa", dica: dicaDoAA(),
          acao: () => window.api.abrirLink("https://artificialanalysis.ai/leaderboards/models"),
        });
        rodape.append(
          botaoAA,
          chipControle({
            ic: "refresh-cw", rotulo: "Atualizar modelos disponíveis", classe: "mz-icone", chave: "atualizar",
            dica: "Atualizar modelos disponíveis\nCatálogo do " + nomeDoMotor(p.engine) + " · " + (lugar ? "VPS" : "Este PC")
              + " — a lista é consultada no motor e na conta deste destino.",
            acao: async () => {
              if (!snap.valida() || m.mudando) return;
              p.uiCodexModelsAt = 0; p.uiClaudeModelsAt = 0;
              m.pedidoComparacao = lerComparacao(true);
              await m.repintar("atualizar");
            },
          }),
        );
      }
    }
    if (p.engine === "claude") {
      rodape.append(chipControle({
        ic: "shield-check", rotulo: "Se o modelo cair, usar o Sonnet", papel: "menuitemcheckbox", marcado: !!cfg.fallbackClaude, classe: "mz-icone", chave: "fallback",
        dica: "Se o modelo escolhido ficar indisponível, o Sonnet assume o turno e avisa na conversa.",
        acao: () => m.change(() => alternarFallbackClaude(p), "fallback"),
      }));
    }
    rodape.append(chipControle({
      ic: "user", rotulo: "Conta e consumo", classe: "mz-icone mz-fim", chave: "conta",
      acao: () => { fecharMenus(); accountLayer(p.engine, abaPorId(p.abaId)); },
    }));
    conteudo.append(rodape);
    m.focar(foco);
    if (!catalogo) return;
    // a consulta ao catálogo (a mesma da camada grande: escopo PC ou servidor, vale 1 minuto) segue por trás; ninguém espera por ela
    const escopo = lugar ? JSON.stringify([lugar.usuario, lugar.host, Number(lugar.porta || 22), lugar.chave || ""]) : "pc";
    const prefixo = p.engine === "claude" ? "uiClaudeModels" : "uiCodexModels";
    if (p[prefixo + "Scope"] === escopo && p[prefixo]?.length && Date.now() - (p[prefixo + "At"] || 0) <= 60000) return;
    m.avisar("Consultando modelos…");
    (async () => {
      try {
        const resposta = p.engine === "claude" ? await window.api.claudeModels(lugar || undefined) : await window.api.codexModels(lugar || undefined);
        const modelos = Array.isArray(resposta) ? resposta : resposta?.models;
        if (!snap.valida()) return;
        if (Array.isArray(modelos) && modelos.length) {
          p[prefixo] = modelos; p[prefixo + "Scope"] = escopo; p[prefixo + "At"] = Date.now();
          /* com uma troca em andamento (m.mudando) quem repinta é o fim dela, que já enxerga o catálogo novo; repintar aqui trocaria a geração
             no meio da troca, e o m.change() desistiria de repintar (a janelinha ficaria com a escolha de antes) */
          if (!m.mudando) await m.repintar(conteudo.contains(d.activeElement) ? d.activeElement.dataset.chave : undefined);
        } else if (!m.mudando) m.avisar("Não foi possível confirmar a lista agora. Sua escolha foi mantida.");
      } catch {
        if (snap.valida() && !m.mudando) m.avisar("Lista não confirmada. Tente atualizar novamente.");
      }
    })();
  }
  /* PERMISSÃO: os modos do motor só com ícone (o unlock na cor de atenção; nome e descrição no hover), um traço, e o envio ↳ Entra / ≡ Fila.
     O remoto da VPS desliga os modos que o adaptador não oferece; plano ou pergunta pendente impedem a troca e a janelinha diz por quê. */
  function chipPintarPerm(m, foco) {
    const { p, snap, conteudo } = m, remoto = snap.lugar;
    const modos = node("div", "mz-linha mz-modos");
    modos.setAttribute("role", "group");
    modos.setAttribute("aria-label", "Permissões");
    for (const modo of MODOS[p.engine] || []) {
      const travado = !!remoto && p.engine === "claude" && modo.id !== "bypass";
      modos.append(chipControle({
        ic: modo.ic, rotulo: modo.nome, dica: travado ? "O adaptador remoto deste motor não oferece este modo" : modo.nome + " — " + modo.desc,
        papel: "menuitemradio", marcado: p.mode === modo.id, desligado: travado, chave: "modo:" + modo.id, dados: { mode: modo.id },
        classe: "mz-icone mz-modo-op" + (modo.id === "bypass" && p.engine !== "grok" ? " mz-perigo" : ""),
        acao: async () => {
          if (p.mode === modo.id) return;
          const bloqueado = p.engine === "claude" && (p.planoPendente || (p.perguntaAberta && p.perguntaAberta.bloqueante !== false));
          await m.change(() => mudarModoDoPainel(p, modo), "modo:" + modo.id, snap.motor,
            bloqueado ? "Responda o plano ou a pergunta antes de trocar as permissões." : "As permissões anteriores foram mantidas. Tente novamente.",
            () => p.mode === modo.id);
        },
      }));
    }
    const traco = node("div", "mz-traco");
    traco.setAttribute("role", "separator");
    /* UI 3.1: o Entra/Fila saiu da barra de escrever e mora aqui, com as permissões (antes: na camada grande, "Se ele estiver trabalhando") */
    const envio = node("div", "mz-linha mz-envio");
    envio.setAttribute("role", "group");
    envio.setAttribute("aria-label", "Se ele estiver trabalhando");
    for (const [id, ic, nome, desc] of [
      ["entra", "corner-down-right", "Entra", "Sua mensagem entra no que está sendo feito agora"],
      ["fila", "list-end", "Fila", "Sua mensagem espera terminar para começar"],
    ]) {
      envio.append(chipControle({
        ic, rotulo: "Se ele estiver trabalhando: " + nome, dica: nome + " — " + desc, papel: "menuitemradio", marcado: (p.envio || "fila") === id,
        classe: "mz-icone mz-envio-op", chave: "envio:" + id,
        acao: () => {
          if ((p.envio || "fila") === id) return;
          p.envio = id; cfg.envioPadrao = id; window.api.setConfig(cfg); p.pintarEnvio?.();
          for (const b of envio.querySelectorAll("[data-chave]")) {
            const ligado = b.dataset.chave === "envio:" + id;
            b.classList.toggle("mz-sel", ligado);
            b.setAttribute("aria-checked", String(ligado));
          }
        },
      }));
    }
    conteudo.append(modos, traco, envio);
    m.focar(foco);
  }
  function plan(p, items) {
    p.plano = Array.isArray(items) ? items : [];
    let bar = q(".ck-plan", p.el);
    if (!p.plano.length) {
      bar?.remove();
      return;
    }
    const done = p.plano.filter((x) => x.estado === "feito").length;
    /* UI 4.5: plano todo feito nao fica como faixa em cima do campo (dizia so' "Plano concluído 2/2"): vira uma linha na
       conversa, "✓ 2 passos", que abre a lista. Uma vez por plano (o agente reenvia o mesmo plano). */
    if (done === p.plano.length) {
      bar?.remove();
      const itens = p.plano.slice(), chave = JSON.stringify(itens.map((x) => x.txt));
      if (p.uiPlanoFeito === chave || !p.chat) return;
      p.uiPlanoFeito = chave;
      const linha = labelled("✓ " + (itens.length === 1 ? "1 passo" : itens.length + " passos"), () => planLayer(p, itens), "ck-plan-feito");
      linha.title = "Ver o plano concluído";
      p.chat.insertBefore(linha, p.trabEl && p.trabEl.parentNode === p.chat ? p.trabEl : null);
      return;
    }
    p.uiPlanoFeito = "";
    if (!bar) {
      bar = button("", "Abrir plano completo", () => planLayer(p), "ck-plan");
      q(".pane-cmp", p.el).before(bar);
    }
    bar.replaceChildren();
    const current =
      p.plano.find((x) =>
        ["fazendo", "andamento", "em_andamento", "in_progress"].includes(
          x.estado,
        ),
      ) || p.plano.find((x) => x.estado !== "feito");
    const segments = node("span", "ck-plan-segments");
    if (p.plano.length <= 12)
      for (const item of p.plano)
        segments.append(
          node(
            "span",
            "ck-plan-segment " +
              (item.estado === "feito"
                ? "done"
                : item === current
                  ? "current"
                  : ""),
          ),
        );
    else {
      const progress = node("progress");
      progress.max = p.plano.length;
      progress.value = done;
      progress.setAttribute("aria-label", "Progresso do plano");
      segments.append(progress);
    }
    const line = node("span", "ck-plan-line");
    line.append(
      node("span", "ck-plan-current", current?.txt),
      node("span", "ck-plan-total", done + "/" + p.plano.length),
    );
    bar.append(segments, line);
    bar.title =
      "Plano: " +
      done +
      " de " +
      p.plano.length +
      " passos concluídos. Abrir lista completa.";
  }
  function planLayer(p, itens = p.plano) {
    const l = openLayer("Plano · " + tituloNaTorre(p));
    for (const item of itens || []) {
      const row = node(
        "div",
        "ck-plan-item " + (item.estado === "feito" ? "done" : ""),
      );
      row.append(
        node("span", "", item.estado === "feito" ? "✓" : "○"),
        node("span", "", item.txt),
      );
      l.body.append(row);
    }
  }
  function robotsLayer(p) {
    const l = openLayer("Robôs · " + tituloNaTorre(p));
    for (const robot of p.robos?.values() || [])
      l.body.append(
        node(
          "p",
          "",
          (robot.desc || robot.tipo || "Robô") +
            " · " +
            duracaoCurta(Date.now() - robot.t0),
        ),
      );
  }
  function decoratePane(p) {
    if (!p.el || p.morto) return;
    attach(p);
    const state = stateOf(p),
      title = q(".ck-pane-title", p.el),
      status = q(".ck-pane-status", p.el);
    if (title) {
      title.textContent = tituloNaTorre(p);
      title.title = [
        tituloNaTorre(p),
        p.cwd,
        abaPorId(p.abaId)?.nome,
        p.gitBranch,
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (status) {
      status.innerHTML =
        '<span class="ck-g ' +
        (state === "saved" ? "stored" : state) +
        '"></span>';
      status.dataset.state = state;
      status.title =
        STATES[state].label + (p.uiInterrupted ? " · interrompido" : "");
      status.setAttribute("aria-label", status.title);
    }
    p.el.dataset.uiState = state;
    const robotButton = q(".ck-header-robots", p.el),
      n = p.robos?.size || 0;
    robotButton.hidden = !n;
    robotButton.innerHTML = n
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V3m-3 0h3M1 12v5m22-5v5M8 14h1m6 0h1m-7 3h6"/></svg><span>' +
        n +
        "</span>"
      : "";
    robotButton.title = n + " robôs em segundo plano";
    robotButton.setAttribute("aria-label", robotButton.title);

    const tokens = q(".p-tokens", p.el);
    if (tokens && window.CockpitUsage) {
      const s = CockpitUsage.contextSummary(p.tokens, p.janela);
      tokens.classList.add("ck-context");
      tokens.classList.toggle("ck-context-full", s.attention);
      tokens.title = s.available
        ? "Contexto: " +
          Math.round(s.pct) +
          "% · " +
          s.tokens.toLocaleString("pt-BR") +
          " / " +
          s.windowSize.toLocaleString("pt-BR") +
          " tokens"
        : "Contexto ainda não informado";
      tokens.setAttribute("aria-label", tokens.title);
      tokens.innerHTML =
        '<span class="ck-meter' +
        (s.attention ? " full" : "") +
        '" style="--p:' +
        (s.available ? s.pct : 0) +
        '"></span>';
    }
    const perm = q(".pane-perm", p.el),
      question = q(".pane-perg", p.el);
    if (question)
      question.classList.toggle(
        "ck-queued-behind",
        !!perm && !perm.classList.contains("hidden"),
      );
    q(".p-input", p.el)?.setAttribute(
      "aria-label",
      "Mensagem para " + nomeDoMotor(p.engine) + " · " + tituloNaTorre(p),
    );
    /* Leva 5h: o nome acessível do chip não nasce mais aqui. Ele deixou de ser um botão (que juntava o title do modelo com a permissão:
       "Opus 5.5 · permissão: Sem pedir permissão") e virou um grupo de três, cada um com o seu nome pronto, escrito por quem pinta o
       pedaço: fillModels (modelo), pintarModo (permissão) e pintarBotaoDeMotor (motor), no app.js. */
  }
  function attach(p) {
    if (p.uiAttached || !p.el) return;
    p.uiAttached = true;
    const header = q(".pane-hd", p.el),
      title = button(
        "",
        tituloNaTorre(p),
        () => renomearAqui(p),
        "ck-pane-title",
      );
    title.textContent = tituloNaTorre(p);
    q(".p-motor", header).after(title);
    ligarArrastarPainel(p, title);
    const status = button(
      "",
      STATES[stateOf(p)].label,
      () => (stateOf(p) === "attention" ? pendingLayer(p) : irAoPainel(p)),
      "ck-pane-status",
    );
    q(".p-close", header).before(
      status,
      button(
        "",
        "Robôs em segundo plano",
        () => robotsLayer(p),
        "ck-header-robots",
      ),
    );
    /* Leva 5h: o botão do motor do cabeçalho abre o menuzinho do motor; o chip da caixa é um GRUPO de três botões (.pm-btn[data-peca]) e o
       clique no grupo escolhe pelo botão (o closest sobe do SVG, do traço ou do span até ele): motor -> 'engine', modelo -> 'model',
       permissão -> 'mode'. Clique no grupo fora de um botão (o ponto separador, a folga) não abre nada e não é consumido. Alvo sem closest
       (DOM de mentira): cai no modelo. */
    /* Rodada 2 da leva 5h, item 7: o logo do motor do cabeçalho passa a si mesmo como origem, e a janelinha abre colada nele (e não no chip). */
    const logoDoMotor = q(".p-motor", p.el);
    logoDoMotor.addEventListener(
      "click",
      (e) => {
        stopEvent(e);
        agentLayer(p, "engine", logoDoMotor);
      },
      true,
    );
    q(".p-model", p.el).addEventListener(
      "click",
      (e) => {
        const peca = e.target.closest?.(".pm-btn");
        if (e.target.closest && !peca) return;
        stopEvent(e);
        const qual = peca?.dataset?.peca;
        agentLayer(p, qual === "perm" ? "mode" : qual === "motor" ? "engine" : "model");
      },
      true,
    );
    q(".p-cwd", header).setAttribute("aria-label", "Pasta da conversa");
    refresh();
  }
  function toolLayer(kind) {
    const p = focusPane;
    if (kind === "files") return moveView("explorer", "Arquivos");
    if (kind === "automations") return moveView("rotinas", "Automações");
    if (kind === "settings") return moveView("settings", "Ajustes");
    if (!p) {
      const l = openLayer("Ferramentas");
      l.body.append(
        node("p", "", "Abra uma conversa para usar esta ferramenta."),
      );
      return;
    }
    if (kind === "terminal")
      janelaTerminal(p, linhaShell(p.cwd, remotoDoPane(p)), "Terminal");
    if (kind === "changes") mostrarMudancasDoTurno(p);
    if (kind === "board") abrirQuadro(p);
    if (kind === "health") {
      if (window.CockpitCollaboration?.health) window.CockpitCollaboration.health(p);
      else janelaConectores(p);
    }
  }
  /* Decisao do Hugo (21/09): o rodape fica com Arquivos, Mudancas, este menu e
     os Ajustes -- nada mais. As tres que sobraram moram AQUI dentro. Saíram da
     lista: Quadro (virou botao na barra de escrever, ao lado do microfone),
     Novo lugar (virou o "+" da faixa de pastas) e Conversas guardadas (a lista
     do dia a dia agora e' o HISTORICO da lateral). */
  function toolsMenu() {
    const l = openLayer("Ferramentas", { className: "ck-small ck-tools-sheet" });
    for (const [icon, label, action] of [
      ["rotate-cw", "Automações", () => toolLayer("automations")],
      ["terminal", "Terminal", () => toolLayer("terminal")],
      ["plug", "Conectores", () => toolLayer("health")],
    ]) {
      const b = button(icon, label, () => { closeLayer(l); action(); }, "ck-tool-item");
      b.append(node("span", "", label));
      l.body.append(b);
    }
    return l;
  }
  let accountRequest = 0;
  const ACCOUNT_TTL = 60 * 1000;
  let accountsTimer;
  function refreshAccounts(force = false) {
    clearTimeout(accountsTimer);
    accountsTimer = setTimeout(() => loadAccounts(force), 80);
  }
  function accountScope(aba) {
    const remote = remotoDoAba(aba);
    return JSON.stringify([
      aba?.id || "pc",
      remote?.host || "",
      remote?.usuario || "",
      remote ? Number(remote.porta ?? 22) : null,
      remote?.chave || "",
      remote?.caminhoRemoto || "",
    ]);
  }
  async function loadAccounts(force = false) {
    if (!accountList || !window.CockpitUsage) return;
    const current = abaAtual(),
      aba = current ? { ...current } : null;
    const key = accountScope(aba),
      generation = ++accountRequest;
    const currentRequest = () =>
      generation === accountRequest && key === accountScope(abaAtual());
    // o que e' de outro lugar some na hora; o do lugar atual espera o veredito
    for (const b of accountList.children)
      if (!b.dataset.key.startsWith(key + ":")) b.hidden = true;
    for (const engine of MOTORES) {
      if (!currentRequest()) return;
      const id = key + ":" + engine;
      let b = [...accountList.children].find((n) => n.dataset.key === id);
      if (!b) {
        b = node("div", "ck-account-button");
        b.addEventListener("click", () => accountLayer(engine, aba));
        b.dataset.key = id;
        accountList.append(b);
      }
      /* So' aparece o motor em que ele REALMENTE esta' logado neste lugar.
         Antes a fileira trazia os cinco, e os que nunca foram conectados
         (Gemini, Grok, ACP) ocupavam espaco mostrando nada -- eram eles que
         empurravam o medidor pra uma segunda linha. Pedido do Hugo, 21/09. */
      const cached = accountCache.get(id);
      if (cached && Date.now() - cached.at < ACCOUNT_TTL && !force) {
        window.VisualMac?.setLimit?.(engine, cached.dados, lugarDaConta(engine, aba), {
          label: 'Ver conta', run: () => { accountLayer(engine, aba); return false; },
        });
        b.hidden = !cached.logado;
        if (cached.logado)
          b.innerHTML = CockpitUsage.renderAccountMeter(cached.summary, {
            engine,
            logoHtml: svgMotor(engine),
            server: aba?.tipo === "ssh",
            withNumber: true,
          });
        continue;
      }
      b.hidden = true;   // enquanto nao sabemos, nao reserva espaco
      try {
        const result = await window.api.contasComparar(
          engine,
          remotoDoAba(aba) || undefined,
          { forcar: force },
        );
        if (!currentRequest()) return;
        const active = result.contas?.find((c) => c.atual),
          summary = CockpitUsage.accountSummary(engine, active?.dados, {
            where: result.onde,
            now: Date.now(),
          });
        /* Logado = tem CONTA conectada neste lugar. Nao depende de ter numero:
           a API de uso da Anthropic devolve 429 com frequencia (em 21/09 veio
           com retry-after de 2273 s) e, se o medidor sumisse nessas horas, ele
           ia achar que o Claude desconectou. O renderAccountMeter ja' desenha o
           estado "sem dados de limite" -- arco apagado, sem numero, com o
           motivo no hover. Quem fica de fora e' so' o motor sem conta nenhuma,
           que era o pedido original (Gemini/Grok/ACP fora da fileira). */
        const logado = !!active || !!summary.available;
        const dados = active?.dados ? { ...active.dados, entrou: true, erro: active.erro || (active.estado === 'erro' ? 'Consulta indisponível' : active.dados.erro) }
          : (active || result.erro || result.error || result.cancelado ? null : { entrou: false });
        accountCache.set(id, { summary, at: Date.now(), logado, dados });
        window.VisualMac?.setLimit?.(engine, dados, lugarDaConta(engine, aba), {
          label: 'Ver conta', run: () => { accountLayer(engine, aba); return false; },
        });
        if (currentRequest()) {
          b.hidden = !logado;
          if (logado)
            b.innerHTML = CockpitUsage.renderAccountMeter(summary, {
              engine,
              logoHtml: svgMotor(engine),
              server: aba?.tipo === "ssh",
              withNumber: true,
            });
        }
      } catch {
        if (!currentRequest()) return;
        /* A consulta falhou. Se ja' sabiamos que essa conta existe, o medidor
           FICA, apagado: sumir faria parecer que o motor desconectou, quando
           foi so' a consulta que nao voltou. So' esconde quem nunca respondeu. */
        const antes = accountCache.get(id);
        b.hidden = !antes?.logado;
        if (antes?.logado)
          b.innerHTML = CockpitUsage.renderAccountMeter(
            CockpitUsage.accountSummary(engine, null),
            { engine, logoHtml: svgMotor(engine), server: aba?.tipo === "ssh", withNumber: true },
          );
      }
    }
    if (!currentRequest()) return;
    for (const b of accountList.children)
      if (!b.dataset.key.startsWith(key + ":")) b.hidden = true;
  }
  async function accountLayer(engine, aba) {
    const captured = aba ? { ...aba } : null,
      remote = remotoDoAba(captured),
      lugar = { remoto: remote, chave: chaveDoLugar(remote), rotulo: remote ? "Servidor · " + chaveDoLugar(remote) : "Neste " + ESTE_PC };
    let pedidoId = '', generation = 0, busy = false;
    const l = openLayer("Contas e limites · " + nomeDoMotor(engine), {
      className: "ck-account",
      onClose() { generation++; window.api.contasCompararCancelar?.(pedidoId); },
    });
    const context = node('div', 'ck-account-context');
    context.append(node('strong', '', lugar.rotulo), node('span', '', 'A conta vale para os painéis deste motor neste lugar.'));
    const status = node('p', 'ck-account-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const list = node('div', 'ck-account-list'), footer = node('footer', 'ck-account-actions');
    footer.setAttribute('role', 'group'); footer.setAttribute('aria-label', 'Ações das contas');
    l.body.append(context, status, list, footer);
    const say = (text, error = false) => { if (!l.closed) { status.textContent = text; status.classList.toggle('ck-attention', error); } };
    const lock = value => { busy = value; l.panel.setAttribute('aria-busy', String(value)); for (const b of l.body.querySelectorAll('button')) b.disabled = value; };
    const focusKey = () => l.panel.contains(d.activeElement) ? d.activeElement.dataset.accountAction : null;
    const action = (label, key, run, cls = '') => {
      const icon = key.startsWith('switch:') ? 'arrow-left-right' : key.startsWith('login') ? 'key-round' : key === 'manage' ? 'user' : 'refresh-cw';
      const b = button(icon, label, async e => { e.stopPropagation(); if (busy || l.closed) return; await run(); }, cls);
      b.dataset.accountAction = key; return b;
    };
    const login = () => { closeLayer(l); return entrarNaContaDoLugar(engine, lugar); };
    async function refresh(force = false, feedback = '') {
      const key = focusKey(), hadFocus = l.panel.contains(d.activeElement), seq = ++generation;
      window.api.contasCompararCancelar?.(pedidoId);
      pedidoId = 'ui-account-' + ++layerSeq;
      lock(true); say('Consultando contas…');
      try {
        const [result, capacidade] = await Promise.all([
          window.api.contasComparar(engine, remote || undefined, { pedidoId, forcar: force }),
          capacidadesDaConta(engine, lugar),
        ]);
        if (l.closed || seq !== generation) return;
        if (!result || result.cancelado) throw Error('A consulta não foi concluída. Tente atualizar.');
        list.replaceChildren(); footer.replaceChildren();
        const accounts = [...(result.contas || [])].sort((a, b) => Number(!!b.atual) - Number(!!a.atual));
        for (const account of accounts) {
          const summary = CockpitUsage.accountSummary(engine, account.dados, { where: result.onde, now: Date.now() });
          const card = node('section', 'ck-account-card' + (account.atual ? ' ck-account-current' : ''));
          card.tabIndex = -1;
          card.dataset.account = account.apelido;
          const head = node('div', 'ck-account-card-head'), identity = node('div', 'ck-account-identity');
          identity.append(node('h3', '', account.apelido || 'Conta'));
          const email = account.dados?.email || account.dados?.account?.email;
          const plan = account.dados?.plano || account.dados?.plan;
          if (email || plan) identity.append(node('p', '', [typeof email === 'string' ? email : '', typeof plan === 'string' ? plan : ''].filter(Boolean).join(' · ')));
          head.append(identity, node('span', 'ck-account-badge', account.atual ? 'Em uso' : !perfilDeContaUtilizavel(account) ? 'Precisa entrar' : 'Guardada'));
          card.append(head);
          const windows = node('div', 'ck-account-windows');
          for (const w of summary.windows || []) {
            const label = w.id === 'semana' ? 'Semana' : 'Janela atual';
            const row = node('div', 'ck-usage-window');
            row.dataset.level = w.pct >= 100 ? 'limit' : w.pct >= 90 ? 'attention' : 'normal';
            row.append(node('span', '', label), node('strong', '', w.pct == null ? 'Sem dado' : Math.round(w.pct) + '% usado'));
            const track = node('progress'); track.max = 100; if (w.pct != null) track.value = w.pct;
            track.setAttribute('aria-label', label + ' · consumo');
            const reset = w.resetAt ? new Date(w.resetAt) : null;
            row.append(track, node('small', '', reset && Number.isFinite(reset.getTime()) ? 'Renova ' + reset.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Renovação não informada'));
            windows.append(row);
          }
          if (windows.childElementCount) card.append(windows);
          if (!summary.available || account.erro || account.motivo)
            card.append(node('p', 'ck-account-note', account.motivo || account.erro || 'Consumo indisponível. Isso não confirma que a conta está sem cota.'));
          if (account.stale || account.dados?.desatualizado || summary.stale)
            card.append(node('small', 'ck-attention', 'Última consulta disponível · os dados podem estar desatualizados.'));
          if (summary.projection) {
            const details = node('details', 'ck-account-estimate');
            details.append(node('summary', '', 'Estimativa de consumo'), node('p', '', typeof summary.projection === 'string' ? summary.projection : summary.projection.title || summary.projection.text || 'Consumo acima do ritmo desta janela.'));
            card.append(details);
          }
          if (!account.atual && capacidade.trocar && perfilDeContaUtilizavel(account)) {
            card.append(action('Usar a conta ' + account.apelido, 'switch:' + account.apelido, async () => {
              const returnFocus = l.panel.contains(d.activeElement);
              lock(true); say('Trocando para ' + account.apelido + '…');
              try {
                const changed = await trocarContaGuardada(engine, lugar, account);
                if (changed) {
                  accountCache.clear(); loadAccounts(true);
                  if (!l.closed) await refresh(true, 'Conta trocada para ' + account.apelido + '. As conversas continuam na próxima mensagem.');
                } else say('Troca cancelada. A conta foi mantida.');
              } catch (error) { say(error.message || String(error), true); }
              finally {
                if (!l.closed) {
                  lock(false);
                  if (returnFocus && (d.activeElement === d.body || l.panel.contains(d.activeElement)))
                    (Array.from(l.body.querySelectorAll('button')).find(b=>b.dataset.accountAction==='switch:'+account.apelido) || l.body.querySelector('.ck-account-current') || l.panel).focus({preventScroll:true});
                }
              }
            }, 'ck-account-use'));
          } else if (!account.atual && !perfilDeContaUtilizavel(account) && capacidade.login)
            card.append(action('Entrar novamente', 'login:' + account.apelido, login));
          list.append(card);
        }
        if (!accounts.length) list.append(node('p', 'ck-account-empty', result.erro || result.error || 'Nenhuma conta guardada neste lugar. Entre em uma conta para começar.'));
        if (capacidade.login) footer.append(action('Entrar em outra conta', 'login', login, 'ck-account-login'));
        if (capacidade.gerenciado) footer.append(action('Gerenciar contas guardadas', 'manage', () => { closeLayer(l); return menuContas(engine, accountList, null, lugar); }));
        footer.append(action('Atualizar limites', 'refresh', () => refresh(true)));
        if (!capacidade.gerenciado) footer.prepend(node('p', 'ck-account-note', capacidade.orientacao || 'A autenticação é feita no terminal deste motor.'));
        say(feedback || (result.erro || result.error ? String(result.erro || result.error) : 'Contas consultadas agora.'), !!(result.erro || result.error));
        lock(false);
        if (hadFocus && key && !l.closed && (d.activeElement === d.body || l.panel.contains(d.activeElement))) (Array.from(l.body.querySelectorAll('button')).find(b=>b.dataset.accountAction===key) || l.panel).focus({preventScroll:true});
      } catch (error) {
        if (!l.closed && seq === generation) {
          say('Não foi possível consultar: ' + (error.message || error), true);
          if (!footer.children.length) footer.append(action('Tentar novamente', 'refresh', () => refresh(true)));
          lock(false);
        }
      }
    }
    await refresh();
  }
  let resumeScheduler, resumeTick;
  function updateResumeCountdown() {
    clearTimeout(resumeTick);
    let active = false;
    for (const p of allPanes()) {
      const entry = resumeScheduler?.get(p.id);
      const bar = q(".ck-resume", p.el);
      if (!bar || entry?.status !== "scheduled") continue;
      active = true;
      let counter = q(".ck-resume-countdown", bar);
      if (!counter) {
        counter = node("span", "ck-resume-countdown");
        bar.append(counter);
      }
      const seconds = Math.max(
        0,
        Math.ceil((entry.resetAt - Date.now()) / 1000),
      );
      counter.textContent =
        "Em " +
        Math.floor(seconds / 60) +
        ":" +
        String(seconds % 60).padStart(2, "0");
      counter.setAttribute(
        "aria-label",
        "Retomada em " + seconds + " segundos",
      );
    }
    if (active) resumeTick = setTimeout(updateResumeCountdown, 1000);
  }
  const accountGeneration = new Map();
  function resumeIdentity(p) {
    const remote = chaveDoLugar(remotoDoPane(p)),
      key = p.engine + ":" + remote;
    return identityOf(
      p,
      (p.uiAccountIdentity || "") + ":" + (accountGeneration.get(key) || 0),
      remote,
    );
  }
  async function readAccountIdentity(p) {
    const lugar = lugarDaContaDoPainel(p);
    const result = await window.api.contaLer(
      pedidoDeConta(p.engine, lugar, { fresco: true }),
    );
    if (
      !result?.entrou ||
      result.erro ||
      result.error ||
      !(result.email || result.accountId || result.id)
    ) {
      throw new Error(
        "Não foi possível confirmar a conta. Retomada automática bloqueada.",
      );
    }
    return String(result.accountId || result.id || result.email);
  }
  function cancelResumesFor(engine, remote) {
    const key = engine + ":" + remote;
    accountGeneration.set(key, (accountGeneration.get(key) || 0) + 1);
    accountCache.clear();
    accountRequest++;
    for (const p of allPanes())
      if (p.engine === engine && chaveDoLugar(remotoDoPane(p)) === remote)
        cancelResume(p);
  }
  function cancelResume(p) {
    if (!p) return;
    p.uiGeneration = (p.uiGeneration || 0) + 1;
    resumeScheduler?.cancel(p.id);
    q(".ck-resume", p.el)?.remove();
  }
  function offerResume(p, lim) {
    if (!resumeScheduler || !p || p.morto) return;
    let reset =
      lim?.ms || lim?.resetAt || lim?.reseta || lim?.resetsAt || lim?.resets_at;
    if (typeof reset === "string") reset = Date.parse(reset);
    if (typeof reset === "number" && reset < 1e12) reset *= 1000;
    if (!Number.isFinite(reset) || reset <= Date.now()) return;
    q(".ck-resume", p.el)?.remove();
    const bar = node("div", "ck-resume");
    bar.append(
      node(
        "span",
        "",
        "Limite atingido · reinicia " +
          new Date(reset).toLocaleTimeString("pt-BR"),
      ),
    );
    const wait = labelled("Esperar e retomar", async () => {
      wait.disabled = true;
      const before = resumeIdentity(p);
      try {
        const account = await readAccountIdentity(p);
        if (
          p.morto ||
          !bar.isConnected ||
          !sameIdentity(before, resumeIdentity(p))
        )
          return;
        if (!p.sessaoId && !p.resumeId)
          throw new Error("Esta conversa ainda não tem sessão para retomar.");
        p.uiAccountIdentity = account;
        const identity = resumeIdentity(p);
        resumeScheduler.schedule(p.id, { resetAt: reset, identity });
        bar.classList.add("ck-scheduled");
      } catch (error) {
        bar.append(node("span", "ck-attention", error.message));
        wait.disabled = false;
      }
    });
    bar.append(
      wait,
      labelled("Cancelar", () => cancelResume(p)),
    );
    q(".pane-cmp", p.el).before(bar);
  }
  function placeDialog(cx, existing, readRemote) {
    cx.classList.add("ck-place-dialog");
    q(".mo-tit", cx).textContent = existing ? "Editar lugar" : "Novo lugar";
    q("#abNome", cx).placeholder = "Nome do lugar";
    q("#abOk", cx).textContent = existing ? "Salvar" : "Criar lugar";
    for (const choice of cx.querySelectorAll(".tipo-bt")) {
      const local = choice.dataset.tipo === "local";
      choice.innerHTML = ico(local ? "folder" : "server");
      choice.append(node("span", "ck-place-kind", local ? "Pasta local" : "Servidor SSH"),
        node("span", "ck-place-example", local ? "C:\\Projetos\\minha-pasta" : "usuario@host:~/pasta"));
    }
    const advanced = node("details", "ck-place-advanced");
    advanced.append(node("summary", "", "Avançado"));
    const connectors = q("#abCorpoConectores", cx), colors = q(".cor-linha", cx);
    const colorLabel = colors.previousElementSibling;
    advanced.append(connectors, colorLabel, colors);
    q("#abDestinoErro", cx).before(advanced);
    const ssh = q("#abCorpoSsh", cx), details = node("details", "ck-ssh-details");
    details.append(node("summary", "", "Detalhes SSH · endereço, porta e pasta"));
    const compactLabel = node("label", "mo-dica", "Destino SSH"), compact = node("input");
    compact.id = "abEndereco";
    compact.placeholder = "usuario@host:~/pasta";
    compact.autocomplete = "off";
    compact.setAttribute("aria-label", "Destino SSH");
    const portLabel = q('label[for="abPorta"]', cx);
    for (const n of [q("#abHost", cx), q("#abUsuario", cx), portLabel, q("#abPorta", cx), q("#abCaminho", cx)]) details.append(n);
    ssh.prepend(compactLabel, compact, details);
    const status = node("p", "ck-place-probe");
    status.setAttribute("role", "status");
    ssh.append(status);
    compact.value = formatSshAddress(readRemote());
    let generation = 0, timer;
    const alive = () => cx.isConnected && !cx.closest(".hidden");
    const canonical = () => readRemote();
    async function inspect(request) {
      /* O timer de 800 ms sobrevive ao dialogo: fecharModalGlobal esvazia o
         .modal-cx e o readRemote do app.js ia ler '#abHost' de um modal vazio
         (TypeError). Se o cx ja' virou outro dialogo, o compact deste nao esta'
         mais dentro dele. Por isso a guarda vem ANTES de ler o formulario. */
      if (!alive() || !cx.contains(compact)) return;
      const remote = canonical();
      if (!alive() || !q('.tipo-bt[data-tipo="ssh"]', cx).classList.contains("on") ||
          !remote.host || !remote.usuario || !remote.chave || !Number.isInteger(remote.porta) ||
          remote.porta < 1 || remote.porta > 65535 || !compact.validity.valid) {
        if (request === generation) status.textContent = "Preencha o destino e escolha uma chave para consultar os motores.";
        return;
      }
      status.textContent = "Consultando motores neste destino…";
      status.dataset.state = "loading";
      try {
        const available = await window.api.motoresDisponiveis(remote);
        if (request !== generation || !alive()) return;
        const engines = MOTORES.filter(e => available?.[e]?.disponivel === true);
        const reasons = [...new Set(MOTORES.map(e => available?.[e]?.detalhe).filter(Boolean))];
        status.textContent = engines.length
          ? "Motores encontrados: " + engines.map(nomeDoMotor).join(", ") + ". O login é conferido ao usar o motor."
          : "Nenhum motor disponível nesta consulta." + (reasons.length ? " " + reasons.join(" · ") : "");
        status.dataset.state = engines.length ? "available" : "unknown";
      } catch (error) {
        if (request !== generation || !alive()) return;
        status.textContent = "Não foi possível consultar os motores. " + String(error?.message || error);
        status.dataset.state = "error";
      }
    }
    function schedule() {
      clearTimeout(timer);
      const request = ++generation;
      timer = setTimeout(() => inspect(request), 800);
    }
    compact.addEventListener("input", () => {
      const value = parseSshAddress(compact.value);
      compact.setCustomValidity(value.error || "");
      compact.setAttribute("aria-invalid", String(!!value.error));
      if (!value.error) {
        q("#abHost", cx).value = value.host;
        q("#abUsuario", cx).value = value.usuario;
        q("#abCaminho", cx).value = value.caminhoRemoto;
        if (!q("#abNome", cx).value.trim()) q("#abNome", cx).value = value.host;
      }
      schedule();
    });
    details.addEventListener("input", () => {
      compact.value = formatSshAddress(canonical());
      compact.setCustomValidity("");
      compact.setAttribute("aria-invalid", "false");
      schedule();
    });
    for (const choice of cx.querySelectorAll(".tipo-bt")) choice.addEventListener("click", schedule);
    const chooseKey = q("#abEscolherChave", cx), originalChoose = chooseKey.onclick;
    chooseKey.onclick = async (...args) => { await originalChoose(...args); schedule(); };
    if (!existing) {
      const recent = node("section", "ck-place-recents");
      recent.append(node("h3", "", "Lugares existentes"));
      for (const aba of abasLocais()) {
        if (aba.tipo === "ssh" && (!aba.usuario || !aba.host)) continue;
        const b = button(aba.tipo === "ssh" ? "server" : "folder", aba.nome, () => {
          fecharModalGlobal();
          trocarAbaLocal(aba.id);
        }, "ck-place-recent");
        const caption = aba.tipo === "ssh" ? formatSshAddress(aba) : pastasDaAba(aba).map(shortPath).join(" · ") || "Este PC";
        b.append(node("span", "", aba.nome), node("small", "", caption));
        recent.append(b);
      }
      if (recent.children.length > 1) q("#abDestinoErro", cx).before(recent);
    }
    if (existing?.tipo === "ssh") schedule();
  }
  let automationTimer, automationSection, automationLoading = false;
  function automationSnapshot() {
    return typeof resumoDasRotinas === "function"
      ? resumoDasRotinas()
      : { itens: [], erro: "", velha: false, lidoEm: 0 };
  }
  function automationAttention() {
    return automationSnapshot().itens.filter(t => t.dele !== false && emAlarme(t));
  }
  function renderAutomationSummary() {
    const snapshot = automationSnapshot(), attention = automationAttention();
    /* O aviso mora no botao Ferramentas: Automacoes deixou de ter botao proprio
       no rodape (21/09) e passou a viver dentro desse menu. Sem isto o alarme de
       automacao ficaria invisivel -- ninguem abre um menu pra descobrir que tem
       alarme la' dentro. */
    const trigger = q('.ck-tools .ck-tools-menu', nav);
    if (trigger) {
      trigger.dataset.attention = String(attention.length);
      trigger.classList.toggle("ck-auto-attention", attention.length > 0);
      trigger.classList.toggle("ck-auto-stale", !!snapshot.erro || snapshot.velha);
      trigger.title = attention.length ? attention.length + " automações precisam de atenção" : "Ferramentas";
      if (snapshot.erro || snapshot.velha) trigger.title += " · consulta de automações desatualizada";
    }
    if (!attention.length) { automationSection?.remove(); automationSection = null; return; }
    if (!automationSection) automationSection = node("section", "ck-nav-group ck-automation-group");
    automationSection.dataset.hasLive = "true";
    automationSection.replaceChildren(node("h3", "ck-group-name", "Automações · sua vez"));
    for (const task of attention) {
      const b = button("", "Automação: " + task.nome, () => {
        toolLayer("automations");
        const field = q("#rotFiltro");
        if (field) { field.value = task.nome; pintarRotinas(false); }
      }, "ck-session ck-live ck-automation-session");
      b.dataset.kind = "automation";
      b.dataset.state = "attention";
      const clock = node("span", "ck-engine");
      /* era ico("clock"), que NAO existe em ICONES: saia um <svg> vazio.
         'rotate-cw' e' o mesmo icone que as Automacoes usam no rodape. */
      clock.innerHTML = ico("rotate-cw");
      b.append(node("span", "ck-state ck-g attention"), clock,
        node("span", "ck-session-title", nomeDaRotina(task.nome)));
      if (snapshot.erro || snapshot.velha) b.title += " · última consulta conhecida";
      automationSection.append(b);
    }
    // automacao esperando resposta e' assunto da TORRE, nao do historico: desde
    // que a lista de baixo virou o passado da pasta, prender este bloco nela
    // deixava um "sua vez" em cima de conversas que ja' acabaram
    // R4-01: a seção só sobe para o topo se não estiver lá (não é re-inserida a cada repintura). O conteúdo dela
    // (o título e os botões) ainda é refeito a cada chamada, acima: o foco do teclado num botão dela não sobrevive.
    if (controlList.firstElementChild !== automationSection) controlList.prepend(automationSection);
  }
  async function refreshAutomations() {
    clearTimeout(automationTimer);
    if (!document.hidden && !automationLoading && !q("#btnRotinasAtualizar")?.disabled) {
      automationLoading = true;
      try { await pintarRotinas(false); } catch {}
      finally { automationLoading = false; refresh(); }
    }
    automationTimer = setTimeout(refreshAutomations, 120000);
  }
  async function updateChooser() {
    const aba = abaAtual(),
      remote = remotoDoAba(aba);
    try {
      const caps = await window.api.motoresDisponiveis(remote || null);
      if (abaAtual()?.id !== aba?.id) return;
      for (const engine of MOTORES) {
        const b = q('.bv-bt[data-motor="' + engine + '"]');
        if (!b) continue;
        const capability = caps?.[engine],
          available = capability?.disponivel ?? capability;
        b.disabled = available !== true;
        b.title =
          capability?.detalhe ||
          (available ? "Disponível neste lugar" : "Indisponível neste lugar");
        let detail = q(".ck-engine-availability", b);
        if (!detail) {
          detail = node("small", "ck-engine-availability");
          b.append(detail);
        }
        detail.textContent =
          available === true
            ? remote
              ? "Servidor"
              : "Disponível"
            : "Indisponível";
      }
    } catch {
      /* A ação verifica a capacidade novamente antes de abrir. */
    }
  }
  /* Leva 5 (UI 6.3): com coluna cortada a' direita, a borda ganha um degrade e um botao com o nome da proxima; o clique
     rola ate' ela. So' conta .coluna (os divisores entre colunas ficam de fora). */
  function sinalDeMaisColunas(caixa, work, botao) {
    const borda = caixa.getBoundingClientRect().right;
    const proxima = [...caixa.children].find((c) => c.classList.contains("coluna") && c.getBoundingClientRect().right > borda + 1);
    if (!proxima) { delete work.dataset.maisDireita; botao.hidden = true; return null; }
    const nome = proxima.querySelector(".ck-pane-title")?.textContent?.trim() || "Mais colunas";
    work.dataset.maisDireita = "1";
    work.style.setProperty("--ck-mais-topo", caixa.offsetTop + "px");
    botao.hidden = false;
    // roda a cada quadro do scroll: o texto so' e' refeito quando o nome mudou.
    // O clique, nao: a tela remonta as colunas (elementos novos) e o clique velho rolaria a coluna morta.
    const rotulo = nome + " ›";
    if (botao.textContent !== rotulo) {
      botao.textContent = rotulo;
      botao.title = "Ir para " + nome;
      botao.ariaLabel = botao.title;
    }
    botao.onclick = () => {
      proxima.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
      /* na ultima coluna o botao some e o foco, que estava nele, cairia no body: vai para o campo da coluna. preventScroll:
         a rolagem suave acabou de comecar e um focus() comum a cancelaria */
      proxima.querySelector(".p-input")?.focus({ preventScroll: true });
    };
    return proxima;
  }
  /* Leva 5h: a faixa de pastas, nas tres pecas: [trilha: pasta pasta pasta ▾] [+]. As pastas entram na trilha a cada repintura
     (renderNavigator); o ▾ nasce escondido e e' sempre o ultimo item dela, e o + vem logo depois da trilha. So' simbolo: o nome do + e do
     ▾ vai no title e no aria-label (o button() poe os dois), nunca como palavra na faixa. */
  function montarFaixaDePastas() {
    placeBar = node("div", "ck-place-bar");
    placeBar.setAttribute("aria-label", "Pastas");
    trilha = node("div", "ck-place-trilha");
    maisPastas = button("chevron-down", "Mais pastas", (e) => {
      e.stopPropagation();   // o clique que abre a listinha não pode subir ao document, que fecha os menus (inclusive o que acabou de abrir)
      abrirMaisPastas();
    }, "ck-place-more");
    maisPastas.hidden = true;
    maisPastas.setAttribute("aria-haspopup", "menu");
    trilha.append(maisPastas);
    newPlace = button("plus", "Nova pasta", () => abrirModalAbaLocal(), "ck-new-place");
    placeBar.append(trilha, newPlace);
  }
  /* Leva 5h: as medidas da faixa para a abasVisiveis. Mede a FAIXA, não a trilha: a trilha encolhe e cresce com as abas que estão nela, e
     medir uma coisa que a própria conta muda daria laço. A largura das abas é o que sobra da faixa depois do + (e do vão até ele) e do
     respiro da trilha. A aba mínima, o vão e o ▾ moram no CSS (cockpit-ui.css, no .ck-place-bar) e são lidos de lá, um número só para
     o CSS e para a conta; os valores de reserva abaixo são os mesmos que o CSS declara. */
  function medirTrilha() {
    const estilo = (el) => (root.getComputedStyle ? root.getComputedStyle(el) : null);
    const px = (v, reserva) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : reserva;
    };
    const faixa = estilo(placeBar), cs = estilo(trilha);
    const medida = (nome, reserva) => px(cs?.getPropertyValue?.(nome), reserva);
    const util = placeBar.clientWidth - px(faixa?.paddingLeft, 0) - px(faixa?.paddingRight, 0);
    const respiro = px(cs?.paddingLeft, 0) + px(cs?.paddingRight, 0);
    /* rodada 2 da leva 5h, item 2: o vão arrastável depois do + (o ::after da faixa, --faixa-arrasto) também sai da largura das abas, junto com o
       vão (gap) que vem antes dele: as pastas vão para o ▾ antes de comerem esse vão */
    const gap = px(faixa?.columnGap, 0), arrasto = medida("--faixa-arrasto", 120);
    const minimo = medida("--aba-min", 96), vao = medida("--trilha-vao", 2), mais = medida("--trilha-mais", 28);
    const semReserva = util - newPlace.offsetWidth - gap - respiro;
    /* conferência da rodada 2: numa faixa estreita a reserva sai só do que sobra depois de 1 aba + ▾ (antes ela comia a trilha inteira e o +
       ficava por cima da aba ativa); com folga, a reserva inteira continua fora das abas */
    const reserva = arrasto > 0 ? Math.max(0, Math.min(arrasto + gap, semReserva - (minimo + vao + mais))) : 0;
    // vaoDeArrasto: a largura do ::after (a reserva sem o vão até ele), que a organizarTrilha passa ao CSS em --faixa-arrasto-agora
    return { largura: semReserva - reserva, minimo, vao, mais, vaoDeArrasto: Math.max(0, reserva - gap) };
  }
  /* Rodada 2 da leva 5h, item 5: a medida da faixa, a parte CARA (lê layout e estilo: clientWidth, offsetWidth, getComputedStyle). `faixa` é a largura
     lida; 0 quer dizer "sem layout" (janela oculta), e a conta espera. */
  function lerMedidasDaTrilha() {
    const faixa = placeBar.clientWidth;
    return faixa > 0 ? { ...medirTrilha(), faixa } : { faixa: 0 };
  }
  /* Leva 5h: decide quais pastas ficam na trilha (abasVisiveis) e esconde as outras. As escondidas continuam no DOM, na mesma ordem
     (Ctrl+Tab, o arraste e os menus seguem passando por todas); só ganham `hidden`, e o ▾ diz quantas ficaram de fora. Roda depois de
     cada renderNavigator (a ativa pode ter mudado de lugar) e quando a LARGURA da faixa muda.
     Rodada 2 da leva 5h, item 5: a repintura da lateral roda a cada quadro de streaming e esta função lia layout nela (clientWidth, offsetWidth,
     getComputedStyle), logo depois das escritas do renderNavigator: um layout forçado a mais por quadro (300 layouts viravam 600 em 300 quadros).
     Agora são duas partes. A CONTA (a medida + a abasVisiveis) é cara e só roda de novo quando muda a largura da faixa (o ResizeObserver zera a
     medida guardada), o visual (o evento de aparência zera também), o número de pastas ou a ativa. A PINTURA (o hidden de cada aba, o ▾, o ponto
     laranja) roda sempre, porque as pendências e as seções mudam a cada repintura, mas só escreve o que mudou e não lê layout nenhum. Sem
     ResizeObserver ninguém avisa a mudança de largura, então a medida é refeita a cada chamada, como antes. */
  function organizarTrilha() {
    if (!trilha || !placeBar.isConnected || draggingPlace) return;
    if (!observandoAFaixa || !medidasDaTrilha) medidasDaTrilha = lerMedidasDaTrilha();
    const medidas = medidasDaTrilha;
    if (!(medidas.faixa > 0)) return;
    /* conferência da rodada 2: o vão arrastável (::after) fica com a largura que a conta reservou. Com folga é a reserva inteira (120 px) e quem
       encolhe são as abas; numa faixa estreita é só o que sobra depois de 1 aba + ▾, e o + não cai mais em cima da aba ativa. Só escreve quando muda. */
    const vaoPx = (medidas.vaoDeArrasto ?? 0) + "px", estiloDaFaixa = placeBar.style;
    if (estiloDaFaixa && typeof estiloDaFaixa.setProperty === "function" && estiloDaFaixa.getPropertyValue?.("--faixa-arrasto-agora") !== vaoPx)
      estiloDaFaixa.setProperty("--faixa-arrasto-agora", vaoPx);
    const abas = [...trilha.children].filter((el) => el.classList.contains("ck-place-only"));
    const ativa = abas.findIndex((el) => el.dataset.current === "true");
    let conta = contaDaTrilha;
    if (!conta || conta.medidas !== medidas || conta.total !== abas.length || conta.ativa !== ativa)
      conta = contaDaTrilha = { medidas, total: abas.length, ativa, ficam: new Set(abasVisiveis({ total: abas.length, ativa, ...medidas })) };
    const ficam = conta.ficam;
    let fora = 0, pendentes = 0;
    const ids = [];
    abas.forEach((el, i) => {
      const esconder = !ficam.has(i);
      if (el.hidden !== esconder) el.hidden = esconder;
      if (!esconder) return;
      fora++;
      pendentes += Number(el.dataset.pendentes) || 0;
      ids.push(el.firstElementChild?.dataset.placeId);
    });
    if (maisPastas.hidden !== !fora) maisPastas.hidden = !fora;
    const rotulo = "Mais pastas (" + fora + ")";
    if (maisPastas.title !== rotulo) {
      maisPastas.title = rotulo;
      maisPastas.setAttribute("aria-label", rotulo);
    }
    // o ponto laranja do ▾: alguma pasta escondida tem conversa pedindo você (o número de cada uma está na listinha)
    if (pendentes) maisPastas.dataset.pendentes = String(pendentes);
    else delete maisPastas.dataset.pendentes;
    // a listinha aberta é feita das escondidas de antes: se elas mudaram (a janela cresceu ou encolheu), fecha em vez de ficar desatualizada
    const chave = ids.join("|");
    if (chave !== escondidasAntes) {
      escondidasAntes = chave;
      const pop = q("#popGrupo");
      if (pop && pop._abriu === maisPastas && !pop.classList.contains("hidden")) fecharPopGlobal();
    }
  }
  /* Leva 5h: o que cabe na trilha depende da LARGURA da faixa. Só ela conta: a altura mexe (o visual Mac cresce a faixa) e refazer a conta
     por isso seria à toa. A conta também não muda a largura da faixa (ela mexe só no que está dentro dela), então o observador não entra
     em laço. */
  function observarLarguraDaFaixa() {
    if (!root.ResizeObserver) return;
    let largura = 0;
    new root.ResizeObserver(() => {
      if (placeBar.clientWidth === largura) return;
      largura = placeBar.clientWidth;
      medidasDaTrilha = null;   // rodada 2 da leva 5h, item 5: a largura mudou, as medidas guardadas valiam para a de antes: a próxima conta lê de novo (uma vez)
      organizarTrilha();
    }).observe(placeBar);
    observandoAFaixa = true;   // agora quem avisa a mudança de largura é este observador, e a conta pode confiar na medida guardada
  }
  /* Leva 5h: um item da listinha do ▾ (ícone da pasta, nome e o selo laranja se ela tem conversa pedindo você). Escolher troca de pasta pelo
     mesmo caminho do clique na aba; a pasta escolhida vira aba visível, e é lá que ficam o botão direito, o duplo clique e o arrasto. */
  function itemDaPasta(secao, aba) {
    const item = node("div", "mi ck-place-item"), icone = node("div", "mi-ic"), texto = node("div", "mi-txt");
    const n = Number(secao.dataset.pendentes) || 0;
    icone.innerHTML = ico(iconeDaPasta(aba));
    texto.append(node("div", "mi-n", aba.nome));
    item.append(icone, texto);
    if (n) {
      const selo = node("span", "ck-place-selo", textoDoSelo(n));
      selo.setAttribute("aria-hidden", "true");
      item.append(selo);
    }
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-label", aba.nome + (n ? " · " + fraseDePendencias(n) : ""));
    item.tabIndex = 0;
    item.title = detalheDaPasta(aba);
    item.addEventListener("click", () => {
      fecharPopGlobal();
      trocarAbaLocal(aba.id);
    });
    return item;
  }
  /* as setas andam pela listinha (o abrirPopGlobal só cuida de Tab, Enter e Espaço); devolve se a tecla era dela */
  function setasNaListaDePastas(e, lista) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return false;
    const itens = [...lista.querySelectorAll(".mi")];
    if (!itens.length) return false;
    e.preventDefault();
    const i = itens.indexOf(d.activeElement), n = itens.length;
    const destino = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" ? (i + 1) % n : i < 0 ? n - 1 : (i - 1 + n) % n;
    itens[destino].focus();
    return true;
  }
  /* Leva 5h: a listinha do ▾ com as pastas que não couberam. Reaproveita o menuzinho ancorado do app (abrirPopGlobal, o mesmo #popGrupo do
     "Mais ações", das contas e dos grupos): ele fecha com o clique fora e com o Esc e devolve o foco a quem abriu (o ▾). Aqui entram só
     os itens e as setas. O ▾ é liga-desliga: clicar nele com a listinha aberta fecha. */
  function abrirMaisPastas() {
    const pop = q("#popGrupo");
    if (pop._abriu === maisPastas && !pop.classList.contains("hidden")) return fecharPopGlobal();
    const fora = [...trilha.children].filter((el) => el.classList.contains("ck-place-only") && el.hidden)
      .map((secao) => [secao, abaPorId(secao.firstElementChild?.dataset.placeId)]).filter(([, aba]) => aba);
    if (!fora.length) return;
    const lista = abrirPopGlobal(maisPastas);
    for (const [secao, aba] of fora) lista.append(itemDaPasta(secao, aba));
    const teclado = lista.onkeydown;   // o do abrirPopGlobal: Tab dá a volta e Enter e Espaço escolhem
    lista.onkeydown = (e) => {
      if (!setasNaListaDePastas(e, lista)) teclado?.call(lista, e);
    };
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    d.body.classList.add("ck-app");
    nav = node("nav", "ck-navigator");
    nav.id = "ckNavigator";
    nav.setAttribute("aria-label", "Sessões, lugares e ferramentas");
    const top = node("div", "ck-nav-top"),
      brand = node("span", "ck-brand");
    brand.innerHTML =
      '<img src="assets/motti/cockpit-mark.svg" class="ck-brand-dark" alt=""><img src="assets/motti/cockpit-mark-onlight.svg" class="ck-brand-light" alt="">';
    brand.title = "Cockpit";
    brand.setAttribute("aria-label", "Cockpit");
    const search = button(
      "search",
      "Buscar (Ctrl K)",
      palette,
      "ck-nav-search",
    );
    search.append(node("span", "", "Buscar"));
    top.append(
      brand,
      /* o "+" saiu daqui e foi pro cabecalho do HISTORICO (ele abre conversa na
         pasta aberta, nao "em geral") */
      button(
        "panel-left",
        "Recolher / expandir (Ctrl B)",
        toggleNavigator,
        "ck-toggle",
      ),
      search,
    );
    const grouping = node("div", "ck-nav-grouping");
    countButton = button(
      "",
      "Próxima pendência (F6)",
      nextPending,
      "ck-attention-count",
    );
    /* 29/09 (Hugo): a Torre ganha ícone, igual ao HISTÓRICO, e um "+" que
       pergunta a pasta antes (o do Histórico abre na pasta ABERTA; este abre
       em qualquer pasta, de onde você estiver). */
    grouping.innerHTML = ico("tower-control");
    grouping.append(
      node("span", "ck-nav-label", "TORRE"),
      countButton,
      button("plus", "Nova conversa em outra pasta", novaConversaEmOutraPasta, "ck-new-chat ck-new-chat-pasta"),
    );
    controlList = node("div", "ck-control-list");
    controlList.setAttribute("aria-label", "Torre de controle");
    sessionList = node("div", "ck-session-list");
    sessionList.setAttribute("aria-label", "Conversas desta pasta");
    /* "HISTÓRICO" em vez do nome da pasta: e' curto, tem largura fixa e faz par
       com TORRE. O nome da pasta variaria de 3 a 40 caracteres, entraria em
       reticencias e ainda repetiria o que a faixa de cima ja' destaca -- aqui
       ele fica no title, que e' onde nao custa espaco. */
    folderHeading = node("div", "ck-folder-heading");
    /* era ico("clock"), que NAO existe em ICONES (app.js:76): o cabecalho
       nascia com um <svg> vazio de 14px na frente de "HISTORICO" */
    folderHeading.innerHTML = ico("messages-square");
    folderHeading.append(node("span", "ck-nav-label", "HISTÓRICO"));
    /* O "+" mora AQUI, nao la' em cima do lado do Buscar: ele abre conversa na
       pasta que esta' aberta, entao pertence ao cabecalho da lista dessa pasta.
       Pedido do Hugo em 21/09/2026. */
    folderHeading.append(
      button("plus", "Nova conversa nesta pasta (Ctrl N)", () =>
        novaConversa(focusPane?.engine || cfg.lastEngine || "claude"),
        "ck-new-chat",
      ),
    );
    const history = button(
      "star",
      "Históricos, favoritos e grupos",
      historyLayer,
      "ck-history",
    );
    history.append(node("span", "", "Conversas guardadas"));
    accountList = node("div", "ck-accounts");
    accountList.setAttribute("aria-label", "Contas e consumo");
    /* Rodape de 4 botoes (era 7): Arquivos, Mudancas, Ferramentas e Ajustes.
       Terminal, Automacoes e Conectores foram pra dentro do "Ferramentas" e o
       Quadro desceu pra barra de escrever -- menos icone na tela, que e' o que
       o Hugo pediu. Os 4 ficam sempre visiveis, inclusive no rail. */
    const tools = node("div", "ck-tools");
    for (const [icon, label, kind] of [
      ["folder", "Arquivos", "files"],
      ["git-compare", "Mudanças", "changes"],
    ])
      tools.append(button(icon, label, () => toolLayer(kind), "ck-tool-persistent"));
    tools.append(button("wrench", "Ferramentas", toolsMenu, "ck-tools-menu"));
    tools.append(button("settings", "Ajustes", () => toolLayer("settings"), "ck-tool-persistent"));
    /* O dono pediu pra definir na mao quanto da lateral e' Torre e quanto e'
       largura da barra. Duas alcas: a de cima fica ENTRE as duas listas (a
       Torre fica com o que voce deu, o historico com o resto) e a da direita
       e' a borda da propria lateral. Sem valor gravado, o CSS de sempre manda:
       Torre com teto de 200px e barra em 224px. */
    const divisorTorre = node("div", "ck-torre-divisor");
    divisorTorre.tabIndex = 0;
    divisorTorre.setAttribute("role", "separator");
    divisorTorre.setAttribute("aria-orientation", "horizontal");
    divisorTorre.title =
      "Altura da Torre: arraste, ou use as setas. Duplo clique volta ao padrão.";
    divisorTorre.setAttribute("aria-label", "Altura da Torre, em porcento da lateral");
    const alcaLargura = node("div", "ck-largura-alca");
    alcaLargura.tabIndex = 0;
    alcaLargura.setAttribute("role", "separator");
    alcaLargura.setAttribute("aria-orientation", "vertical");
    alcaLargura.title =
      "Largura da lateral: arraste, ou use as setas. Duplo clique volta ao padrão.";
    alcaLargura.setAttribute("aria-label", "Largura da barra lateral, em pixels");
    ajustarTorre = medidaArrastavel(divisorTorre, {
      eixo: "y", min: 15, max: 70, padrao: 44, passo: 3,
      gravado: () => cfg.uiTorreAltura ?? null,
      // o arrasto anda em POR CENTO da lateral, que e' a mesma medida do CSS
      porPixel: () => 100 / Math.max(1, nav.clientHeight),
      /* o valor gravado e' o TETO, e a Torre desenhada so' tem a altura do conteudo:
         medir ela rebaixava um teto de 58% para o minimo na 1a seta. As setas partem
         do teto; a medida so' vale quando nao ha teto gravado. */
      atual: () =>
        cfg.uiTorreAltura ??
        ((controlList.getBoundingClientRect().height /
          Math.max(1, nav.clientHeight)) *
          100),
      /* o ARRASTO parte da Torre desenhada, onde o Hugo ve a alca, e so' depois de 3 px:
         partindo do teto, a classe do arrasto levava a Torre ao teto ao apertar e a alca
         ficava centenas de px longe do ponteiro (rodada final da leva 5) */
      limiar: 3,
      inicioArrasto: () =>
        (controlList.getBoundingClientRect().height /
          Math.max(1, nav.clientHeight)) *
        100,
      aplicar: (v) => {
        if (v == null) {
          delete cfg.uiTorreAltura;
          nav.removeAttribute("data-torre");
          nav.style.removeProperty("--ck-torre");
          return;
        }
        cfg.uiTorreAltura = v;
        nav.dataset.torre = "manual";
        nav.style.setProperty("--ck-torre", v + "%");
      },
    });
    ajustarLargura = medidaArrastavel(alcaLargura, {
      eixo: "x", min: 168, max: 420, padrao: 224, passo: 8,
      gravado: () => cfg.uiSidebarLargura ?? null,
      porPixel: () => 1,
      atual: () => nav.getBoundingClientRect().width,
      // so' a variavel: o rail (56px) e o peek (272px) tem largura propria e
      // nao usam --layout-sidebar, entao continuam do tamanho de sempre
      aplicar: (v) => {
        if (v == null) {
          delete cfg.uiSidebarLargura;
          nav.style.removeProperty("--layout-sidebar");
          return;
        }
        cfg.uiSidebarLargura = v;
        nav.style.setProperty("--layout-sidebar", v + "px");
      },
    });
    nav.append(top, grouping, controlList, divisorTorre, folderHeading, sessionList, history, accountList, tools, alcaLargura);
    q("#shell").prepend(nav);
    /* A faixa de pastas fica ACIMA dos paineis e a' DIREITA da lateral. O #shell
       e' uma linha (lateral | trabalho), entao a faixa precisa de uma coluna
       propria: solta no #shell ela viraria mais uma coluna, ao LADO dos paineis.
       O #panes continua com o mesmo id e a mesma ordem -- so' ganhou um pai. */
    montarFaixaDePastas();
    const panesBox = q("#panes");
    if (panesBox) {
      const work = node("div", "ck-work"),
        welcome = q("#boasvindas");
      panesBox.before(work);
      work.append(placeBar);
      if (welcome) work.append(welcome);
      work.append(panesBox);
      // leva 5 (UI 6.3): sinal de coluna cortada a' direita; mede uma vez por quadro (scroll, tamanho, colunas novas)
      const maisColunas = button("", "Ir para a próxima coluna", () => {}, "ck-mais-colunas");
      maisColunas.hidden = true;
      work.append(maisColunas);
      let quadroPedido = 0;
      const medir = () => {
        if (quadroPedido) return;
        quadroPedido = requestAnimationFrame(() => { quadroPedido = 0; sinalDeMaisColunas(panesBox, work, maisColunas); });
      };
      panesBox.addEventListener("scroll", medir, { passive: true });
      if (root.ResizeObserver) new ResizeObserver(medir).observe(panesBox);
      if (root.MutationObserver) new MutationObserver(medir).observe(panesBox, { childList: true });
      medir();
    } else nav.after(placeBar);
    root.VisualMac?.mount(placeBar, nav);
    observarLarguraDaFaixa();
    root.VisualMac?.observeMeters(accountList);
    nav.addEventListener("mouseenter", () => peek(true));
    nav.addEventListener("mouseleave", () => peek(false));
    applyPreferences();
    automationTimer = setTimeout(refreshAutomations, 1500);
    if (window.CockpitResume)
      resumeScheduler = CockpitResume.createScheduler({
        async validate(key, identity) {
          const p = acharPainel(identity.paneId);
          if (
            !p ||
            p.morto ||
            p.busy ||
            p.queued ||
            p.anexos?.length ||
            p._ditado ||
            q(".p-input", p.el).value.trim() ||
            !sameIdentity(identity, resumeIdentity(p))
          )
            return false;
          const account = await readAccountIdentity(p);
          return (
            account === p.uiAccountIdentity &&
            !p.morto &&
            !p.busy &&
            !p.queued &&
            !p.anexos?.length &&
            !p._ditado &&
            !q(".p-input", p.el).value.trim() &&
            sameIdentity(identity, resumeIdentity(p))
          );
        },
        onResume(key, identity) {
          const p = acharPainel(identity.paneId);
          if (
            p &&
            !p.morto &&
            !p.anexos?.length &&
            !p._ditado &&
            !p.queued &&
            !q(".p-input", p.el).value.trim() &&
            sameIdentity(identity, resumeIdentity(p))
          )
            enviarContinue(p);
          else
            throw new Error(
              "Retomada cancelada: a sessão ou o rascunho mudou.",
            );
        },
        onChange(key, entry) {
          const p = acharPainel(key),
            bar = p && q(".ck-resume", p.el);
          if (bar) {
            let info = q(".ck-resume-status", bar);
            if (!info) {
              info = node("span", "ck-resume-status");
              bar.append(info);
            }
            info.textContent =
              entry.status === "blocked"
                ? entry.error ||
                  "Retomada bloqueada: a sessão, a conta ou o rascunho mudou."
                : entry.status === "scheduled"
                  ? "Retomada agendada"
                  : entry.status === "resuming"
                    ? "Retomando…"
                    : entry.status === "resumed"
                      ? "Retomada enviada"
                      : "Retomada cancelada";
          }
          refresh();
          updateResumeCountdown();
        },
      });
    refresh();
    loadAccounts();
    updateChooser();
  }
  d.addEventListener(
    "keydown",
    (e) => {
      if (keyLayer(e)) return;
      if (dialogoAberto() || !q("#modalGrupo").classList.contains("hidden"))
        return;
      const terminal = e.target.closest?.(".term-wrap"),
        board = !!quadro;
      if (terminal || board) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "k") {
          stopEvent(e);
          palette();
        }
        if (k === "b") {
          stopEvent(e);
          toggleNavigator();
        }
        if (k === "n") {
          stopEvent(e);
          novaConversa(focusPane?.engine || cfg.lastEngine || "claude");
        }
      }
      if (e.key === "F6") {
        stopEvent(e);
        nextPending();
      }
      if (e.key === "Escape") {
        /* so' os paineis NA TELA, os mesmos em que o tratarEsc mexe. Com
           allPanes() a janelinha de um painel guardado em outra pasta
           (terminal, visor) engolia o Esc aqui, o tratarEsc nao achava nada
           para fechar e o turno da pasta atual nao parava mais */
        const modal = [...panes.values()].find((p) =>
          q(".p-modal:not(.hidden),.p-visor:not(.hidden)", p.el),
        );
        if (modal) {
          stopEvent(e);
          tratarEsc(focusPane, true);
        } else if (!q("#popGrupo").classList.contains("hidden")) {
          stopEvent(e);
          fecharPopGlobal();
        }
      }
    },
    true,
  );
  /* Ctrl+Tab (troca de pasta): no WINDOW e em captura, antes de qualquer outro
     ouvinte -- inclusive o de cima, que mora no document */
  root.addEventListener("keydown", teclaTrocaPasta, true);
  function menuAction(action) {
    if (
      dialogoAberto() ||
      !q("#modalGrupo").classList.contains("hidden") ||
      quadro ||
      d.activeElement?.closest?.(".term-wrap")
    )
      return false;
    // so' camada MODAL engole o menu; a NAO modal (Mais detalhes) deixa o app seguir
    if (layers.some((l) => !l.naoModal)) return true;
    if (action === "commandPalette" || action === "buscarConversa") {
      palette();
      return true;
    }
    return false;
  }
  root.CockpitUI = {
    ...exported,
    initialize,
    refresh,
    attach,
    toggleNavigator,
    palette,
    openLayer,
    closeLayer,
    closeToolView,
    agentLayer,
    accountLayer,
    toolLayer,
    plan,
    pendingLayer,
    menuAction,
    pularPasta,
    cancelResume,
    offerResume,
    cancelResumesFor,
    loadAccounts,
    refreshAccounts,
    accountScope,
    accountChanging: (engine, remote) => operacoesDeConta.has(chaveDaOperacaoDeConta(engine, { chave: chaveDoLugar(remote) })),
    placeDialog,
    automationChanged: refresh,
    layers,
  };
  root.addEventListener("cockpit-config-ready", initialize, { once: true });
  root.addEventListener("beforeunload", () => {
    clearTimeout(resumeTick);
    clearTimeout(accountsTimer);
    clearTimeout(automationTimer);
    clearTimeout(historyTimer);
    resumeScheduler?.dispose();
  });
  if (typeof cfg === "object" && cfg.abaAtiva) initialize();
})(typeof window === "object" ? window : globalThis);
