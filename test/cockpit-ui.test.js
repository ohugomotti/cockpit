"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const UI = require("../src/renderer/cockpit-ui.js");
const app = fs.readFileSync(
  path.join(__dirname, "../src/renderer/app.js"),
  "utf8",
);
function extract(name) {
  const start = app.search(new RegExp("(?:async )?function " + name + "\\("));
  const end = app.indexOf("\n}", start);
  assert.notEqual(start, -1, name);
  return app.slice(start, end + 2);
}
test("permissão e pergunta bloqueante prevalecem sobre trabalho e conclusão", () => {
  assert.equal(
    UI.stateOf({ busy: true, uiCompleted: true, filaPerm: [{}] }),
    "attention",
  );
  assert.equal(
    UI.stateOf({ busy: true, perguntaAberta: { bloqueante: true } }),
    "attention",
  );
  assert.equal(
    UI.stateOf({ busy: true, perguntaAberta: { bloqueante: false } }),
    "working",
  );
});
test("interrupção ou erro nunca viram conclusão", () => {
  for (const state of [
    { uiInterrupted: true },
    { uiLastState: "error" },
    { morto: true },
  ])
    assert.equal(UI.stateOf({ ...state, uiCompleted: true }), "attention");
  assert.equal(
    UI.stateOf({ uiInterrupted: true, _religar: { n: 1 } }),
    "working",
  );
});
test("conclusão precisa evidência e robôs não anulam o fim do turno", () => {
  assert.equal(UI.stateOf({ hist: [{}], started: true }), "saved");
  assert.equal(
    UI.stateOf({ uiCompleted: true, robos: new Map([["a", {}]]) }),
    "done",
  );
  assert.equal(UI.stateOf({ queued: "próximo" }), "working");
});
test("filtros de busca distinguem comando, caminho, arroba e texto", () => {
  assert.equal(UI.searchKind(">exportar"), "commands");
  assert.equal(UI.searchKind("@codex"), "agents");
  assert.equal(UI.searchKind("~"), "files");
  assert.equal(UI.searchKind("/app.js"), "files");
  assert.equal(UI.searchKind("src/renderer"), "files");
  assert.equal(UI.searchKind("C:\\Projeto"), "files");
  assert.equal(UI.searchKind("Conversa antiga"), "all");
});
test("identidade de retomada isola sessão, conta, lugar, motor e geração", () => {
  const p = { id: "p1", engine: "codex", sessaoId: "s1", uiGeneration: 3 };
  const a = UI.identityOf(p, "conta-a", "alice@vps");
  assert.ok(UI.sameIdentity(a, { ...a }));
  for (const key of [
    "paneId",
    "engine",
    "sessionId",
    "accountKey",
    "remoteKey",
    "generation",
  ])
    assert.equal(UI.sameIdentity(a, { ...a, [key]: "outro" }), false, key);
});
test("sessão retomada usa resumeId quando ainda não chegou sessaoId", () => {
  assert.equal(
    UI.identityOf({ id: "p", engine: "claude", resumeId: "retomar" }, "a", "pc")
      .sessionId,
    "retomar",
  );
});
test("navegador preserva sessões de abas fechadas ao reunir painéis vivos e guardados", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/cockpit-ui.js"),
    "utf8",
  );
  function piece(name) {
    const start = source.indexOf("function " + name + "(");
    assert.notEqual(start, -1, name);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  }
  const abas = Array.from({ length: 14 }, (_, i) => ({
    id: "aba-" + i,
    paineis: Array.from({ length: i < 2 ? 3 : 2 }, (_, j) => ({
      paneId: "painel-" + i + "-" + j,
      sessaoId: "sessao-" + i + "-" + j,
      titulo: "Conversa " + j,
      engine: j % 2 ? "codex" : "claude",
    })),
  }));
  // A mesma sessão em outro lugar continua pertencendo à sua própria aba.
  abas[1].paineis[0].sessaoId = abas[0].paineis[0].sessaoId;
  const original = structuredClone(abas);
  const ativos = abas[0].paineis.map((f, i) => ({
    id: f.paneId,
    abaId: abas[0].id,
    engine: f.engine,
    titulo: f.titulo,
    ...(i === 1 ? { resumeId: f.sessaoId } : { sessaoId: f.sessaoId }),
  }));
  // IDs recriados na restauração também devem casar pela sessão/resumeId.
  ativos[1].id = "painel-remontado";
  const ctx = {
    panes: new Map(ativos.map((p) => [p.id, p])),
    panesFundo: new Map(),
    abasLocais: () => abas,
    abaPorId: (id) => abas.find((aba) => aba.id === id),
    stateOf: UI.stateOf,
    tituloNaTorre: (p) => p.titulo,
  };
  vm.runInNewContext(
    piece("allPanes") + "\n" + piece("liveRows") + "\nrows = liveRows();",
    ctx,
  );
  assert.equal(ctx.rows.length, 30);
  assert.equal(ctx.rows.filter((row) => row.p).length, 3);
  assert.equal(ctx.rows.filter((row) => row.f).length, 27);
  for (const aba of abas) {
    const rows = ctx.rows.filter((row) => row.aba.id === aba.id);
    assert.equal(rows.length, aba.paineis.length, aba.id);
    if (aba !== abas[0]) {
      assert.ok(rows.every((row) => row.state === "saved" && !row.p));
      assert.deepEqual(Array.from(rows, (row) => row.f), aba.paineis);
    }
  }
  assert.deepEqual(abas, original, "montar o navegador não altera as sessões salvas");
});
test("tema legado motti migra visualmente sem gravar escolha", () => {
  let attr;
  const buttons = [
    {
      dataset: { tema: "azul" },
      classList: {
        toggle(k, v) {
          this.on = v;
        },
      },
    },
  ];
  const context = {
    document: {
      documentElement: {
        setAttribute(k, v) {
          attr = v;
        },
      },
    },
    $$: () => buttons,
  };
  vm.runInNewContext(extract("aplicarTema") + ';aplicarTema("motti")', context);
  assert.equal(attr, "azul");
  assert.equal(buttons[0].classList.on, true);
});
test("novo painel remoto não muda silenciosamente motor solicitado", () => {
  const context = {
    MOTORES: ["claude", "codex", "gemini", "grok", "acp"],
    cfg: { lastEngine: "claude" },
  };
  vm.runInNewContext(
    extract("motorDoPainelNovo") +
      ';resultado=motorDoPainelNovo("codex",{tipo:"ssh"})',
    context,
  );
  assert.equal(context.resultado, "codex");
});
test("capacidade remota precisa confirmação positiva, inclusive erro de rede", async () => {
  for (const value of [
    null,
    {},
    { codex: { disponivel: false } },
    { codex: true },
  ]) {
    const ctx = {
      faltaConfigurarServidor: () => false,
      window: { api: { motoresDisponiveis: async () => value } },
    };
    vm.runInNewContext(
      extract("capacidadeRemota") + ';resultado=capacidadeRemota("codex",{})',
      ctx,
    );
    assert.equal(await ctx.resultado, false);
  }
  const ctx = {
    faltaConfigurarServidor: () => false,
    window: {
      api: {
        motoresDisponiveis: async () => ({ codex: { disponivel: true } }),
      },
    },
  };
  vm.runInNewContext(
    extract("capacidadeRemota") + ';resultado=capacidadeRemota("codex",{})',
    ctx,
  );
  assert.equal(await ctx.resultado, true);
});
test("pedidos antigos não aprovam nem liberam ferramenta depois de sair da fila", async () => {
  let approvals = 0,
    auto = 0;
  const yes = {},
    no = {},
    always = {},
    txt = {};
  const bar = {
    classList: { remove() {} },
    querySelector() {
      return null;
    },
  };
  const ev = { key: "old", title: "Comando", tool: "Bash" },
    p = { filaPerm: [ev], el: {} };
  const ctx = {
    window: {
      api: {
        approve: async () => {
          approvals++;
        },
        autoLiberar: async () => {
          auto++;
        },
      },
    },
    $: (s) =>
      ({ ".pp-txt": txt, ".pp-sempre": always, ".pp-yes": yes, ".pp-no": no })[
        s
      ] || null,
    piscar() {},
    quadro: null,
    note() {},
    proximaPermissao() {},
    elDiff() {},
  };
  always.classList = { toggle() {} };
  vm.runInNewContext(
    extract("desenharPermissao") + ";desenhar=desenharPermissao",
    ctx,
  );
  ctx.desenhar(p, bar);
  p.filaPerm = [{ key: "new" }];
  await yes.onclick();
  await always.onclick();
  assert.equal(approvals, 0);
  assert.equal(auto, 0);
});
test("duas apresentações do mesmo pedido compartilham trava até approve resolver", async () => {
  let resolve,
    approvals = 0,
    shift = 0;
  const ev = { key: "A", title: "Editar" },
    next = { key: "B", title: "Executar" },
    p = { filaPerm: [ev, next], el: {} };
  function card() {
    return {
      txt: {},
      yes: {},
      no: {},
      always: { classList: { toggle() {} } },
      classList: { remove() {} },
    };
  }
  const one = card(),
    two = card();
  const ctx = {
    window: {
      api: {
        approve: () => {
          approvals++;
          return new Promise((r) => {
            resolve = r;
          });
        },
      },
    },
    $: (sel, bar) =>
      ({
        ".pp-txt": bar.txt,
        ".pp-yes": bar.yes,
        ".pp-no": bar.no,
        ".pp-sempre": bar.always,
      })[sel] || null,
    piscar() {},
    quadro: null,
    note() {},
    proximaPermissao() {
      p.filaPerm.shift();
      shift++;
    },
  };
  vm.runInNewContext(
    extract("desenharPermissao") + ";draw=desenharPermissao",
    ctx,
  );
  ctx.draw(p, one);
  ctx.draw(p, two);
  const first = one.yes.onclick(),
    second = two.no.onclick();
  assert.equal(approvals, 1);
  resolve(true);
  await Promise.all([first, second]);
  assert.equal(shift, 1);
  assert.equal(p.filaPerm[0], next);
});
test("falha terminal continua atenção mesmo com turn-end posterior", () => {
  const p = {
    id: "p",
    el: {},
    engine: "claude",
    hist: [],
    blocks: new Map(),
    tools: new Map(),
  };
  const noop = () => {};
  const ctx = {
    $: () => ({
      classList: {
        remove() {},
        contains() {
          return true;
        },
      },
    }),
    setTimeout() {},
    histCache: {},
    acharPainel: () => p,
    panes: new Map([["p", p]]),
    window: { CockpitUI: { refresh: noop } },
    note: noop,
    avisarLoginDoServidor: noop,
    setDot: noop,
    pararTrabalho: noop,
    limparPassos: noop,
    marcarFimDoTurno: noop,
    mostrarContinuar: noop,
    avisarPainel: noop,
    atualizarGit: noop,
    savePanes: noop,
    pintarAbasLocal: noop,
    sincronizarPendencias: noop,
  };
  vm.runInNewContext(
    extract("tratarEventoDoPainel") + ";event=tratarEventoDoPainel",
    ctx,
  );
  ctx.event({
    paneId: "p",
    kind: "note",
    text: "O processo falhou",
    error: true,
  });
  ctx.event({ paneId: "p", kind: "turn-end" });
  assert.equal(p.uiTerminalError, true);
  assert.equal(p.uiCompleted, false);
  assert.equal(UI.stateOf(p), "attention");
});

test("fim de turno com erro ou interrupção dispensa nota anterior e não herda sucesso", () => {
  for (const end of [
    { error: true, status: "failed" },
    { status: "failed" },
    { status: "interrupted" },
    { status: "cancelled" },
  ]) {
    const p = {
      id: "p",
      el: {},
      engine: "codex",
      hist: [],
      blocks: new Map(),
      tools: new Map(),
      busy: true,
      uiCompleted: true,
    };
    const noop = () => {};
    const ctx = {
      $: () => ({
        classList: {
          remove() {},
          contains() {
            return true;
          },
        },
      }),
      setTimeout() {},
      histCache: {},
      acharPainel: () => p,
      panes: new Map([["p", p]]),
      window: { CockpitUI: { refresh: noop } },
      note: noop,
      avisarLoginDoServidor: noop,
      setDot: noop,
      pararTrabalho: noop,
      limparPassos: noop,
      marcarFimDoTurno: noop,
      mostrarContinuar: noop,
      avisarPainel: noop,
      atualizarGit: noop,
      savePanes: noop,
      pintarAbasLocal: noop,
      sincronizarPendencias: noop,
    };
    vm.runInNewContext(
      extract("tratarEventoDoPainel") + ";event=tratarEventoDoPainel",
      ctx,
    );
    ctx.event({ paneId: "p", kind: "turn-end", ...end });
    assert.equal(p.uiCompleted, false);
    assert.equal(UI.stateOf(p), "attention");
    ctx.event({ paneId: "p", kind: "turn-end" });
    assert.equal(p.uiCompleted, false);
    assert.equal(UI.stateOf(p), "attention");
  }
});

test("resposta atrasada da conta A não oculta nem substitui a conta do lugar B", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/cockpit-ui.js"),
    "utf8",
  );
  function piece(name) {
    const start = source.search(
      new RegExp("(?:async )?function " + name + "\\("),
    );
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  }
  let current = { id: "local", tipo: "ssh", host: "A", usuario: "qa" },
    clock = 1000,
    calls = 0;
  const pending = new Map(),
    children = [];
  const usage = {
    accountSummary: (engine, data) => data,
    renderAccountMeter: (summary) => String(summary),
  };
  const ctx = {
    accountList: {
      children,
      append(n) {
        children.push(n);
      },
    },
    accountCache: new Map(),
    accountRequest: 0,
    ACCOUNT_TTL: 60000,
    MOTORES: ["codex"],
    Date: { now: () => clock },
    CockpitUsage: usage,
    window: {
      CockpitUsage: usage,
      api: {
        contasComparar(engine, remote) {
          calls++;
          return new Promise((resolve) => pending.set(remote.host, resolve));
        },
      },
    },
    abaAtual: () => current,
    remotoDoAba: (a) => (a ? { host: a.host, usuario: a.usuario } : null),
    node: () => ({ dataset: {}, addEventListener() {} }),
    svgMotor: () => "",
    accountLayer() {},
  };
  vm.runInNewContext(
    piece("accountScope") +
      "\n" +
      piece("loadAccounts") +
      "\nload=loadAccounts;",
    ctx,
  );
  const a = ctx.load();
  current = { ...current, host: "B" };
  const b = ctx.load();
  pending.get("B")({ contas: [{ atual: true, dados: "CONTA B" }], onde: "B" });
  await b;
  pending.get("A")({ contas: [{ atual: true, dados: "CONTA A" }], onde: "A" });
  await a;
  assert.deepEqual(
    children.filter((n) => !n.hidden).map((n) => n.innerHTML),
    ["CONTA B"],
  );
  await ctx.load();
  assert.equal(calls, 2, "cache válido evita outra consulta");
  clock += 61000;
  const fresh = ctx.load();
  assert.equal(calls, 3, "cache expira");
  pending.get("B")({
    contas: [{ atual: true, dados: "CONTA B NOVA" }],
    onde: "B",
  });
  await fresh;
  assert.deepEqual(
    children.filter((n) => !n.hidden).map((n) => n.innerHTML),
    ["CONTA B NOVA"],
  );
});
