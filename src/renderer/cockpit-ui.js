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
  const exported = { inControlTower, STATES, stateOf, searchKind, identityOf, sameIdentity, paneFromSaved, parseSshAddress, formatSshAddress };
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
    newPlace,
    folderHeading,
    ajustarTorre,
    ajustarLargura,
    historyPlace = null,
    historyTimer,
    skeletonTimer,
    historyLoading = false,
    ultimaPendencia = null,
    historyTried = 0,
    initialized = false,
    dirty = false,
    draggingPlace = false,
    peekTimer;
  const rows = new Map(),
    histRows = new Map(),
    groups = new Map(),
    accountCache = new Map();
  let layerSeq = 0,
    searchSeq = 0,
    activationSeq = 0;
  const layers = [];
  function closeLayer(layer = layers.at(-1)) {
    if (!layer || !layers.includes(layer)) return;
    while (layers.at(-1) !== layer) closeLayer();
    layers.pop();
    layer.closed = true;
    layer.onClose?.();
    layer.overlay.remove();
    if (layer.focus?.isConnected) {
      layer.focus.focus({ preventScroll: true });
      if (layer.selection && layer.focus.setSelectionRange)
        layer.focus.setSelectionRange(...layer.selection);
    }
  }
  function openLayer(title, opts = {}) {
    const focus = d.activeElement,
      overlay = node("div", "ck-overlay"),
      panel = node("section", "ck-layer " + (opts.className || ""));
    const layer = {
      id: ++layerSeq,
      overlay,
      panel,
      focus,
      closed: false,
      onClose: opts.onClose,
    };
    if (focus && typeof focus.selectionStart === "number")
      layer.selection = [focus.selectionStart, focus.selectionEnd];
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
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
        ].filter((n) => !n.disabled && n.getClientRects().length),
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
    cfg.uiCollapsed = !cfg.uiCollapsed;
    applyPreferences();
    persist();
  }
  function applyPreferences() {
    if (!nav) return;
    nav.classList.toggle("ck-collapsed", !!cfg.uiCollapsed);
    nav.classList.remove("ck-peek");
    d.body.classList.toggle("ck-logos-neutral", cfg.uiLogos !== true);
    // as duas medidas ajustadas na mao; sem valor gravado voltam ao CSS de sempre
    ajustarTorre?.(cfg.uiTorreAltura ?? null, false);
    ajustarLargura?.(cfg.uiSidebarLargura ?? null, false);
    q(".ck-toggle", nav)?.setAttribute(
      "aria-expanded",
      String(!cfg.uiCollapsed),
    );
  }
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
       Torre sem ajuste fica do tamanho do conteudo, bem abaixo do teto de 44%.
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
    alca.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      arrastando = { base: op.atual(), zero: op.eixo === "y" ? e.clientY : e.clientX };
      // captura: sem ela o ponteiro sai da alca de 6px e o arrasto morre no meio
      try { alca.setPointerCapture(e.pointerId); } catch {}
      alca.classList.add("ck-arrastando");
      e.preventDefault();
    });
    alca.addEventListener("pointermove", (e) => {
      if (!arrastando) return;
      const andou = (op.eixo === "y" ? e.clientY : e.clientX) - arrastando.zero;
      aplicar(arrastando.base + andou * op.porPixel(), false);
    });
    const soltar = () => {
      if (!arrastando) return;
      arrastando = null;
      alca.classList.remove("ck-arrastando");
      persist();
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
    else if (cfg.uiCollapsed && cfg.uiPeek !== false)
      /* confere de novo na hora de ABRIR: quem expandia a lateral no meio dos
         300 ms ficava com o espiar preso por cima da barra ja' aberta -- e
         nesse estado a largura ajustada a mao era ignorada (o peek tem a dele) */
      peekTimer = setTimeout(() => {
        if (cfg.uiCollapsed) nav.classList.add("ck-peek");
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
      (row.p.pedindoPerm || row.p.filaPerm?.length || row.p.perguntaAberta)
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
  function groupFor(id, title, aba) {
    let g = groups.get(id);
    if (!g) {
      const el = node("section", "ck-nav-group"),
        head = button("", title, () => {
          if (aba) trocarAbaLocal(aba.id);
        });
      head.className = "ck-group-head";
      head.setAttribute("aria-expanded", "false");
      const label = node("span", "ck-group-name"),
        placeIcon = node("span", "ck-group-icon"),
        chevron = node("span", "ck-group-chevron"),
        stats = node("span", "ck-group-stats");
      // o tipo fica marcado no dataset porque na faixa horizontal so' a pasta de
      // servidor mostra icone: o dono pediu "apenas o nome", e o iconezinho de
      // folder repetido em toda pasta e' ruido que nao distingue nada
      placeIcon.dataset.place = aba?.tipo === "ssh" ? "ssh" : "local";
      placeIcon.innerHTML = ico(aba?.tipo === "ssh" ? "server" : "folder");
      placeIcon.hidden = !aba;
      chevron.innerHTML = ico("chevron-down");
      head.append(placeIcon, label, stats, chevron);
      const body = node("div", "ck-group-body");
      body.hidden = true;
      const saved = node("details", "ck-saved-list"),
        savedTitle = node("summary", "", "Guardadas"),
        savedBody = node("div");
      saved.append(savedTitle, savedBody);
      body.append(saved);
      el.append(head, body);
      g = { el, head, label, stats, body, saved, savedTitle, savedBody };
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
          if (source)
            moverAbaLocal(
              source,
              abasLocais().findIndex((a) => a.id === aba.id),
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
    g.head.title = title + (aba ? " · Clique direito para opções; duplo clique para editar" : "");
    g.el.dataset.current = String(!!aba && cfg.abaAtiva === aba.id);
    if (aba && cfg.abaAtiva === aba.id) g.head.setAttribute("aria-current", "location");
    else g.head.removeAttribute("aria-current");
    return g;
  }
  function refresh() {
    if (!initialized || dirty || draggingPlace) return;
    dirty = true;
    requestAnimationFrame(() => {
      dirty = false;
      if (draggingPlace) return;
      renderNavigator();
      for (const p of allPanes()) decoratePane(p);
    });
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
     torre; aqui o que interessa e' o passado, que nao muda a cada segundo, e
     cada recarga varre a pasta de sessoes dos cinco motores. */
  async function loadPlaceHistory() {
    const place = abaAtual()?.id || "";
    historyPlace = place;
    historyLoading = true;
    historyTried = Date.now();
    clearTimeout(historyTimer);
    try {
      await Promise.all(
        MOTORES.map((engine) =>
          Promise.resolve(loadHist(engine)).catch(() => {}),
        ),
      );
    } finally {
      historyLoading = false;
      historyTried = Date.now();
      /* so' o dono da pasta atual re-arma: duas trocas de pasta em rajada
         deixavam o timer da primeira pendurado, varrendo os 5 motores pra
         sempre a cada 5 min */
      if ((abaAtual()?.id || "") === place) {
        historyTimer = setTimeout(loadPlaceHistory, 300000);
        refresh();
      }
    }
  }
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
    // as pastas moram na faixa horizontal em cima dos paineis; o '+' de nova
    // pasta e' o ultimo item dela, entao cada pasta entra ANTES dele
    for (const aba of abasLocais()) {
      const g = groupFor("place:" + aba.id, aba.nome, aba);
      usedGroups.add(g);
      g.el.classList.add("ck-place-only");
      g.body.hidden = true;
      g.head.removeAttribute("aria-expanded");
      g.stats.replaceChildren();
      placeBar.insertBefore(g.el, newPlace);
    }
    const active = data.filter(inControlTower);
    for (const row of active) row.lugar = lugarNaTorre(row);
    active.sort(ordemDaTorre);
    /* TETO DE MOVIMENTO, contado POR ESTADO. Medido na previa com 54 linhas e
       a CPU 6x mais lenta: 136 selos animando derrubam a tela pra 6,6 quadros
       por segundo; com teto, 31. So' que contar por POSICAO na lista nao
       serve -- a Torre poe "sua vez" antes de "trabalhando", entao nove
       pendencias no topo empurravam TODOS os "trabalhando" pra fora do teto e
       os pontinhos nunca apareciam. Contando por estado, os QUATRO primeiros
       de cada um sempre se mexem; do quinto em diante a forma fala sozinha,
       que e' o mesmo contrato do prefers-reduced-motion. */
    const quantosNoEstado = {};
    for (const row of active) {
      usedRows.add(row.key);
      const r = sessionRow(rows, row);
      quantosNoEstado[row.state] = (quantosNoEstado[row.state] || 0) + 1;
      r.el.toggleAttribute("data-quieto", quantosNoEstado[row.state] > 4);
      controlList.append(r.el);
    }
    for (const [key, r] of rows)
      if (!usedRows.has(key)) {
        r.el.remove();
        rows.delete(key);
      }
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
    } else if (historicoFaltando()) loadPlaceHistory();
    // reaproveita o liveRows do começo desta repintura: montá-lo de novo varre
    // todos os painéis e todas as fichas de todas as pastas outra vez
    const saved = historyRows(data);
    for (const row of saved) {
      usedHistory.add(row.key);
      sessionList.append(sessionRow(histRows, row).el);
    }
    for (const [key, r] of histRows)
      if (!usedHistory.has(key)) {
        r.el.remove();
        histRows.delete(key);
      }
    /* esqueleto so' quando NAO ha' linha nenhuma pra mostrar. Com a lista ja'
       cheia, a recarga de 5 min tambem liga o historyLoading -- piscar cinza
       por cima do que ja' esta' na tela seria pior que nao mostrar nada. */
    const carregando = historyLoading && !saved.length;
    historySkeleton(carregando);
    // "Nenhuma conversa aqui" e' resposta, nao espera: enquanto carrega, quem
    // ocupa o lugar e' o esqueleto
    if (!saved.length && !carregando && !q(".ck-empty-nav", sessionList))
      sessionList.append(node("p", "ck-empty-nav", "Nenhuma conversa aqui"));
    if (saved.length || carregando) q(".ck-empty-nav", sessionList)?.remove();
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
    if (p.pedindoPerm || p.filaPerm?.length || p.perguntaAberta)
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
      section.append(label);
    }
    const shortcuts = node("section", "aj-grupo");
    shortcuts.append(node("h3", "aj-titulo", "Atalhos"));
    for (const [keys, title] of [
      ["Ctrl K", "Buscar sessões, arquivos e comandos"],
      ["Ctrl B", "Recolher / expandir navegação"],
      ["Ctrl N", "Nova conversa"],
      ["Ctrl Shift K", "Limpar tela sem apagar histórico"],
      ["Ctrl F", "Buscar nesta conversa"],
      ["F6", "Próxima pendência"],
      ["Ctrl 1–9", "Focar painel"],
      ["Ctrl Shift 1–9", "Trocar lugar"],
      ["Shift Tab", "Alternar modo no campo"],
      ["Esc", "Fechar a janela em foco"],
    ]) {
      const line = node("div", "ck-shortcut");
      line.append(node("kbd", "", keys), node("span", "", title));
      shortcuts.append(line);
    }
    q(".aj-campo", appearance).after(section);
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
    let debounce;
    const l = openLayer('Buscar', {className:'ck-palette',onClose(){searchSeq++;clearTimeout(debounce);}});
    const input=node('input','ck-search');input.type='search';input.placeholder='Agentes, pastas, arquivos · @agente · /arquivo · >comando';
    for(const [k,v] of Object.entries({'aria-label':'Buscar no Cockpit',role:'combobox','aria-expanded':'true','aria-controls':'ck-results-'+l.id,'aria-autocomplete':'list'}))input.setAttribute(k,v);
    const list=node('div','ck-results');list.id='ck-results-'+l.id;list.setAttribute('role','listbox');
    const status=node('p','ck-search-status');status.setAttribute('role','status');l.body.append(input,list,status);
    let results=[],selected=0;
    /* "Conversas" separado de "Agentes": conversa guardada aparecia sob o rotulo
       AGENTES, junto das sessoes vivas, e nao dava pra saber o que estava
       rodando e o que era historico. */
    const order=['Agentes','Conversas','Pastas','Arquivos','Comandos'];
    function paint(){
      results.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group));
      list.replaceChildren();let last;
      results.slice(0,80).forEach((r,i)=>{
        if(r.group!==last){const heading=node('div','ck-result-group',r.group);heading.setAttribute('role','presentation');list.append(heading);last=r.group;}
        const b=button(r.icon||'messages-square',r.title,()=>{closeLayer(l);r.run();},'ck-result');
        b.id='ck-result-'+l.id+'-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===selected));
        const text=node('span','ck-result-text');text.append(node('strong','',r.title),node('small','',r.detail));b.append(text);list.append(b);
      });
      if(results.length)input.setAttribute('aria-activedescendant','ck-result-'+l.id+'-'+selected);else input.removeAttribute('aria-activedescendant');
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
      const seq=++searchSeq,text=input.value.trim(),kind=searchKind(text),term=text.replace(/^[>@]/,'').toLocaleLowerCase();
      const p=focusPane,aba=abaAtual();selected=0;results=[];
      const valid=()=>!l.closed&&seq===searchSeq;
      if(kind==='all'||kind==='agents')results.push(...liveRows().filter(r=>(r.title+' '+r.engine+' '+r.aba?.nome).toLocaleLowerCase().includes(term)).map(r=>({group:'Agentes',key:r.engine+'|'+(r.p?.sessaoId||r.f?.sessaoId||r.id),title:r.title,detail:STATES[r.state].glyph+' '+nomeDoMotor(r.engine)+' · '+(r.aba?.nome||''),run:()=>activate(r,false)})));
      if(kind==='all')results.push(...abasLocais().filter(a=>(a.nome+' '+(a.caminhos||[]).join(' ')+' '+(a.host||'')).toLocaleLowerCase().includes(term)).map(a=>({group:'Pastas',title:a.nome,detail:a.tipo==='ssh'?a.usuario+'@'+a.host:(a.caminhos||[]).join(' · '),icon:a.tipo==='ssh'?'server':'folder',run:()=>trocarAbaLocal(a.id)})));
      if(kind==='all'||kind==='commands')results.push(...commands().filter(c=>c.title.toLocaleLowerCase().includes(term)).map(c=>({...c,group:'Comandos'})));
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
          entries.filter(f=>i===1||(f.name||f.nome||'').toLocaleLowerCase().includes(query.term.toLocaleLowerCase())).forEach(append);
        });
        paint();
      })());
      if((kind==='all'||kind==='agents')&&term.length>1)jobs.push((async()=>{
        const remote=remotoDoAba(aba);
        const loaded=await Promise.allSettled(MOTORES.map(async engine=>({engine,items:await(remote?window.api.sessionsRemoto({engine,remoto:remote}):engine==='claude'?window.api.sessionsClaude(!!cfg.verRobos):engine==='codex'?window.api.sessionsCodex(!!cfg.verRobos):window.api.sessionsCli(engine))})));
        if(!valid())return;
        const seen=new Set(results.map(r=>r.key).filter(Boolean));
        for(const answer of loaded){
          if(answer.status!=='fulfilled'||!answer.value.items)continue;
          const {engine,items}=answer.value;
          for(const s of Array.isArray(items)?items:items.itens||[]){
            if(!((s.titulo||s.title||s.nome||'')+' '+engine).toLocaleLowerCase().includes(term))continue;
            const key=engine+'|'+s.id;if(seen.has(key))continue;seen.add(key);
            results.push({group:'Conversas',key,title:s.titulo||s.title||s.nome||'Conversa',detail:'Guardada · '+nomeDoMotor(engine)+' · '+(aba?.nome||''),run:async()=>{if(aba&&cfg.abaAtiva!==aba.id)await trocarAbaLocal(aba.id);openSession({...s,engine});}});
          }
        }
        paint();
      })());
      if(jobs.length){status.textContent='Buscando…';const settled=await Promise.allSettled(jobs);if(!valid())return;for(const r of settled)if(r.status==='rejected')warnings.push(r.reason?.message||'Consulta indisponível');}
      if(valid()){paint();status.textContent=results.length+' resultados'+(warnings.length?' · '+warnings.join(' · '):'');}
    }
    input.addEventListener('input',()=>{searchSeq++;clearTimeout(debounce);debounce=setTimeout(search,180);});
    input.addEventListener('keydown',e=>{
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();selected=Math.max(0,Math.min(Math.min(results.length,80)-1,selected+(e.key==='ArrowDown'?1:-1)));paint();q('[aria-selected="true"]',list)?.scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'&&results[selected]){e.preventDefault();const r=results[selected];closeLayer(l);r.run();}
    });
    search();queueMicrotask(()=>input.focus());return l;
  }
  async function agentLayer(p, section) {
    const l = openLayer("Agente · " + tituloNaTorre(p), {
        className: "ck-agent",
      }),
      originalEngine = p.engine,
      engines = node("div", "ck-engine-options");
    l.body.append(node("h3", "", "Motor"), engines);
    const place = remotoDoPane(p);
    let availability;
    try {
      availability = await window.api.motoresDisponiveis(place || null);
    } catch {
      availability = {};
    }
    if (l.closed || p.morto) return;
    for (const eng of MOTORES) {
      const info = availability?.[eng],
        allowed = typeof info === "boolean" ? info : info?.disponivel;
      const b = button(
        "",
        nomeDoMotor(eng) + (allowed === false ? " · indisponível" : ""),
        async () => {
          if (p.morto || p.engine !== originalEngine) return;
          await trocarMotor(p, eng);
          closeLayer(l);
          refresh();
        },
        "ck-engine-option",
      );
      b.innerHTML = svgMotor(eng);
      b.dataset.motor = eng;
      b.classList.toggle("ck-selected", p.engine === eng);
      b.disabled = allowed !== true;
      b.title += info?.detalhe ? " · " + info.detalhe : "";
      engines.append(b);
    }
    l.body.append(node("h3", "", "Modelo"));
    if (p.engine === 'codex') {
      const scope = place ? JSON.stringify([place.usuario,place.host,Number(place.porta || 22),place.chave || '']) : 'pc';
      if (p.uiCodexModelsScope !== scope || !p.uiCodexModels?.length || Date.now() - (p.uiCodexModelsAt || 0) > 60000) {
        try {
          const models = await window.api.codexModels(place || undefined);
          if (l.closed || p.morto || p.engine !== originalEngine) return;
          if (Array.isArray(models) && models.length) {
            p.uiCodexModels = models; p.uiCodexModelsScope = scope; p.uiCodexModelsAt = Date.now();
          } else l.body.append(node('p','ck-hint','Catálogo indisponível neste destino. O modelo atual foi preservado.'));
        } catch { l.body.append(node('p','ck-hint','Não foi possível consultar os modelos deste destino.')); }
      }
    }
    if (l.closed) return;
    if (p.engine === "acp") {
      const acp = node("div");
      pintarMenuAcp(p, acp);
      l.body.append(acp);
    } else
      for (const model of modelosDe(p)) {
        const b = labelled(
          model.nome || model.id,
          async () => {
            await trocarModeloDoPainel(p, model);
            closeLayer(l);
            agentLayer(p, "model");
          },
          "ck-choice",
        );
        b.classList.toggle("ck-selected", model.id === p.model);
        b.title = model.desc || model.nome;
        const context = model.contextWindow || model.context_window;
        if (Number(context) > 0) b.append(node('small','ck-model-context',Number(context).toLocaleString('pt-BR') + ' contexto'));
        l.body.append(b);
      }
    if (p.engine === "claude") {
      const fallback = labelled("Se o modelo cair, usar o Sonnet", async () => {
        if (p.morto || p.engine !== originalEngine || fallback.disabled) return;
        fallback.disabled = true;
        try {
          await alternarFallbackClaude(p);
          fallback.setAttribute("aria-checked", String(!!cfg.fallbackClaude));
          fallback.classList.toggle("ck-selected", !!cfg.fallbackClaude);
        } finally { fallback.disabled = false; }
      }, "ck-choice ck-fallback");
      fallback.setAttribute("role", "switch");
      fallback.setAttribute("aria-checked", String(!!cfg.fallbackClaude));
      fallback.classList.toggle("ck-selected", !!cfg.fallbackClaude);
      fallback.title = "Se o modelo escolhido ficar indisponível, o Sonnet assume o turno e avisa na conversa.";
      l.body.append(fallback);
    }
    const effort = node("section", "ck-effort");
    const levels = (modeloAtual(p)?.efforts || []).map(e => typeof e === 'string' ? {id:e} : e).filter(e => e.id);
    if (levels.length) {
      effort.append(node('h3','','Esforço'));
      const bars = node('div','ck-effort-bars'); bars.setAttribute('role','radiogroup'); bars.setAttribute('aria-label','Esforço do modelo');
      const name = node('span','ck-effort-name');
      function paintEffort() { for (const b of bars.children) { const chosen = b.dataset.effort === p.effort; b.classList.toggle('ck-selected',chosen); b.setAttribute('aria-checked',String(chosen)); } name.textContent = (typeof EF_PT === 'object' && EF_PT[p.effort]) || p.effort || 'Padrão'; }
      levels.forEach((level,i) => {
        const label = (typeof EF_PT === 'object' && EF_PT[level.id]) || level.id;
        const b = button('',label,async () => {
          if (p.morto || p.engine !== originalEngine || bars.dataset.busy) return;
          bars.dataset.busy='1';
          try { await trocarEsforco(p,level.id); paintEffort(); } finally { delete bars.dataset.busy; }
        },'ck-effort-level');
        b.dataset.effort=level.id;b.setAttribute('role','radio');b.title=level.desc || label;
        const mark=node('span');mark.style.height=(7+i*3)+'px';b.append(mark);bars.append(b);
      });
      paintEffort(); effort.append(bars,name); l.body.append(effort);
    }
    const modeSection = node("section", "ck-mode-section");
    modeSection.append(node("h3", "", "Permissões"));
    const modeList = node("div", "ck-mode-options"),
      description = node("p", "ck-mode-description");
    description.textContent =
      (MODOS[p.engine] || []).find((m) => m.id === p.mode)?.desc || "";
    for (const mode of MODOS[p.engine] || []) {
      const b = button(
        mode.ic,
        mode.nome + " · " + mode.desc,
        async () => {
          await mudarModoDoPainel(p, mode);
          closeLayer(l);
          refresh();
        },
        "ck-mode-choice",
      );
      b.classList.toggle("ck-selected", p.mode === mode.id);
      b.classList.toggle("ck-danger-mode", mode.id === "bypass");
      if (place && p.engine === "claude" && mode.id !== "bypass") {
        b.disabled = true;
        b.title = "O adaptador remoto deste motor não oferece este modo";
      }
      modeList.append(b);
    }
    modeSection.append(modeList, description);
    l.body.append(
      modeSection,
      labelled("Conta e consumo", () => {
        closeLayer(l);
        accountLayer(p.engine, abaPorId(p.abaId));
      }),
    );
    if (section === "mode") modeSection.scrollIntoView({ block: "nearest" });
    if (section === "effort" && levels.length) effort.scrollIntoView({ block: "nearest" });
  }
  function plan(p, items) {
    p.plano = Array.isArray(items) ? items : [];
    let bar = q(".ck-plan", p.el);
    if (!p.plano.length) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = button("", "Abrir plano completo", () => planLayer(p), "ck-plan");
      q(".pane-cmp", p.el).before(bar);
    }
    bar.replaceChildren();
    const done = p.plano.filter((x) => x.estado === "feito").length;
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
      node("span", "ck-plan-current", current?.txt || "Plano concluído"),
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
  function planLayer(p) {
    const l = openLayer("Plano · " + tituloNaTorre(p));
    for (const item of p.plano || []) {
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
    const mode = q(".p-modo", p.el);
    if (mode) {
      mode.setAttribute("aria-label", mode.title);
      mode.classList.toggle("ck-danger-mode", p.mode === "bypass");
    }
    q(".p-input", p.el)?.setAttribute(
      "aria-label",
      "Mensagem para " + nomeDoMotor(p.engine) + " · " + tituloNaTorre(p),
    );
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
    for (const [selector, part] of [
      [".p-motor", "engine"],
      [".p-model", "model"],
      [".p-modo", "mode"],
    ])
      q(selector, p.el).addEventListener(
        "click",
        (e) => {
          stopEvent(e);
          agentLayer(p, part);
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
        accountCache.set(id, { summary, at: Date.now(), logado });
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
      lugar = {
        remoto: remote,
        chave: chaveDoLugar(remote),
        rotulo: remote ? "Servidor · " + chaveDoLugar(remote) : "Neste " + ESTE_PC,
      },
      pedidoId = "ui-account-" + ++layerSeq;
    const l = openLayer(nomeDoMotor(engine) + " · " + lugar.rotulo, {
      className: "ck-account",
      onClose() {
        window.api.contasCompararCancelar?.(pedidoId);
      },
    });
    l.body.append(node("p", "", "Consultando contas…"));
    try {
      const [result, capacidade] = await Promise.all([
        window.api.contasComparar(engine, remote || undefined, { pedidoId }),
        capacidadesDaConta(engine, lugar),
      ]);
      if (l.closed) return;
      l.body.replaceChildren();
      for (const account of result.contas || []) {
        const summary = CockpitUsage.accountSummary(engine, account.dados, {
            where: result.onde,
            now: Date.now(),
          }),
          card = node("section", "ck-account-card");
        card.append(
          node("h3", "", account.apelido + (account.atual ? " · em uso" : "")),
        );
        const meter = node("div");
        meter.innerHTML = CockpitUsage.renderAccountMeter(summary, {
          engine,
          logoHtml: svgMotor(engine),
          server: !!remote,
          withNumber: true,
        });
        card.append(meter);
        const email = account.dados?.email || account.dados?.account?.email;
        const plan = account.dados?.plano || account.dados?.plan;
        if (typeof email === "string")
          card.append(node("p", "ck-muted", email));
        if (typeof plan === "string") card.append(node("p", "ck-muted", plan));
        if (summary.credits != null) {
          const credits = summary.credits;
          const text =
            typeof credits === "object"
              ? credits.unlimited
                ? "Créditos sem limite informado"
                : credits.balance != null
                  ? "Créditos extras: " + credits.balance
                  : credits.hasCredits === false
                    ? "Sem créditos extras"
                    : null
              : "Créditos extras: " + String(credits);
          if (text) card.append(node("p", "ck-muted", text));
        }
        if (!summary.available)
          card.append(
            node(
              "p",
              "ck-muted",
              account.erro || "Consumo indisponível para esta conta.",
            ),
          );
        for (const w of summary.windows || []) {
          const row = node("div", "ck-usage-window");
          row.append(
            node("span", "", w.id),
            node("strong", "", w.pct == null ? "—" : Math.round(w.pct) + "%"),
          );
          const track = node("progress");
          track.max = 100;
          if (w.pct != null) track.value = w.pct;
          track.setAttribute("aria-label", w.id);
          row.append(
            track,
            node(
              "small",
              "",
              w.resetAt
                ? "Reinicia " + new Date(w.resetAt).toLocaleString("pt-BR")
                : "Reinício não informado",
            ),
          );
          card.append(row);
        }
        if (summary.projection)
          card.append(
            node(
              "p",
              "ck-attention",
              "Estimativa: " +
                (typeof summary.projection === "string"
                  ? summary.projection
                  : summary.projection.title ||
                    summary.projection.text ||
                    "consumo acima do ritmo da janela"),
            ),
          );
        if (summary.stale)
          card.append(node("small", "ck-muted", "Consulta desatualizada"));
        if (!account.atual && capacidade.trocar) {
          if (perfilDeContaUtilizavel(account)) {
            const usar = labelled("Usar esta conta", async (e) => {
              e.stopPropagation();
              usar.disabled = true;
              try {
                if (await trocarContaGuardada(engine, lugar, account)) {
                  closeLayer(l);
                  accountCache.clear();
                  loadAccounts(true);
                }
              } catch (error) {
                card.append(node("p", "ck-attention", error.message));
              } finally { usar.disabled = false; }
            });
            card.append(usar);
          } else {
            card.append(node("p", "ck-attention", account.motivo || account.erro || "Esta conta precisa de um novo login."));
            if (capacidade.login) card.append(labelled("Entrar novamente", (e) => {
              e.stopPropagation(); closeLayer(l); entrarNaContaDoLugar(engine, lugar);
            }));
          }
        }
        l.body.append(card);
      }
      if (!result.contas?.length)
        l.body.append(node("p", "", "Nenhuma conta guardada neste lugar."));
      if (!capacidade.gerenciado) l.body.append(node("p", "ck-muted", capacidade.orientacao || "A gestão desta conta é feita no terminal do motor."));
      if (capacidade.gerenciado) l.body.append(
        labelled("Gerenciar contas", (e) => {
          e.stopPropagation();
          closeLayer(l);
          menuContas(engine, accountList, null, lugar);
        }),
      );
    } catch (e) {
      if (!l.closed)
        l.body.replaceChildren(
          node("p", "ck-attention", "Não foi possível consultar: " + e.message),
        );
    }
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
    controlList.prepend(automationSection);
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
      search,
      /* o "+" saiu daqui e foi pro cabecalho do HISTORICO (ele abre conversa na
         pasta aberta, nao "em geral") */
      button(
        "panel-left",
        "Recolher / expandir (Ctrl B)",
        toggleNavigator,
        "ck-toggle",
      ),
    );
    const grouping = node("div", "ck-nav-grouping");
    countButton = button(
      "",
      "Próxima pendência (F6)",
      nextPending,
      "ck-attention-count",
    );
    grouping.append(
      node("span", "ck-nav-label", "TORRE"),
      countButton,
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
    tools.append(button("sliders-horizontal", "Ferramentas", toolsMenu, "ck-tools-menu"));
    tools.append(button("settings", "Ajustes", () => toolLayer("settings"), "ck-tool-persistent"));
    /* O dono pediu pra definir na mao quanto da lateral e' Torre e quanto e'
       largura da barra. Duas alcas: a de cima fica ENTRE as duas listas (a
       Torre fica com o que voce deu, o historico com o resto) e a da direita
       e' a borda da propria lateral. Sem valor gravado, o CSS de sempre manda:
       Torre em 44% e barra em 224px. */
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
      atual: () =>
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
    placeBar = node("div", "ck-place-bar");
    placeBar.setAttribute("aria-label", "Pastas");
    newPlace = button("plus", "Nova pasta", () => abrirModalAbaLocal(), "ck-new-place");
    newPlace.append(node("span", "", "Nova pasta"));
    placeBar.append(newPlace);
    const panesBox = q("#panes");
    if (panesBox) {
      const work = node("div", "ck-work"),
        welcome = q("#boasvindas");
      panesBox.before(work);
      work.append(placeBar);
      if (welcome) work.append(welcome);
      work.append(panesBox);
    } else nav.after(placeBar);
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
        const modal = allPanes().find((p) =>
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
  function menuAction(action) {
    if (
      dialogoAberto() ||
      !q("#modalGrupo").classList.contains("hidden") ||
      quadro ||
      d.activeElement?.closest?.(".term-wrap")
    )
      return false;
    if (layers.length) return true;
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
