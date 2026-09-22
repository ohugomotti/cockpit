"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(
  path.join(__dirname, "../src/renderer/app.js"),
  "utf8",
);
const ui = fs.readFileSync(
  path.join(__dirname, "../src/renderer/cockpit-ui.js"),
  "utf8",
);
function extract(source, name, indent = "") {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1);
  return source.slice(
    start,
    source.indexOf("\n" + indent + "}", start) + indent.length + 2,
  );
}
const ctx = { panes: new Map(), panesFundo: new Map() };
vm.runInNewContext(
  [
    extract(app, "remotoDoAba"),
    extract(app, "linhaShell"),
    extract(app, "bloqueioEdicaoDestino"),
    app.match(/const chaveDoLugar = [^\n]+/)[0],
    app.match(/const chaveAberta =[^\n]+\n[^\n]+/)[0],
    extract(ui, "accountScope", "  "),
    "Object.assign(globalThis, {remotoDoAba, linhaShell, chaveDoLugar, chaveAberta, accountScope, bloqueioEdicaoDestino});",
  ].join("\n"),
  ctx,
);
const aba = {
  id: "servidor",
  tipo: "ssh",
  host: "qa.example",
  usuario: "qa",
  chave: "C:/QA/id",
  caminhoRemoto: "~/projeto",
};

test("editor mantém o destino enquanto existem painéis vivos ou salvos, mas permite renomear", () => {
  const mudancas = [
    { porta: 2222 },
    { host: "outro" },
    { usuario: "outro" },
    { chave: "C:/QA/other" },
    { caminhoRemoto: "/outro" },
    { tipo: "local" },
  ];
  for (const mudanca of mudancas) {
    const destino = { ...aba, ...mudanca };
    assert.equal(
      ctx.bloqueioEdicaoDestino(aba, destino),
      "",
      "Aba vazia permite trocar destino",
    );
    assert.match(
      ctx.bloqueioEdicaoDestino(
        { ...aba, paineis: [{ sessaoId: "s" }] },
        destino,
      ),
      /Feche os painéis/,
    );
    ctx.panes.set("p", { id: "p", abaId: aba.id, started: true });
    assert.match(ctx.bloqueioEdicaoDestino(aba, destino), /Feche os painéis/);
    ctx.panes.clear();
    ctx.panesFundo.set("p", { id: "p", abaId: aba.id, busy: true });
    assert.match(ctx.bloqueioEdicaoDestino(aba, destino), /Feche os painéis/);
    assert.equal(
      ctx.bloqueioEdicaoDestino(aba, { ...aba, nome: "Outro nome", porta: 22 }),
      "",
    );
    ctx.panesFundo.clear();
  }
  assert.equal(ctx.bloqueioEdicaoDestino(null, aba), "");
});

test("destino do painel mantém porta configurada e formato das abas antigas", () => {
  assert.equal(ctx.remotoDoAba({ tipo: "local" }), null);
  assert.equal(Object.hasOwn(ctx.remotoDoAba(aba), "porta"), false);
  assert.equal(ctx.remotoDoAba({ ...aba, porta: 2222 }).porta, 2222);
});
test("contas, retomada e árvore distinguem duas portas do mesmo servidor", () => {
  const normal = ctx.remotoDoAba(aba),
    other = ctx.remotoDoAba({ ...aba, porta: 2222 });
  assert.equal(
    ctx.chaveDoLugar(normal),
    ctx.chaveDoLugar({ ...normal, porta: 22 }),
  );
  assert.notEqual(ctx.chaveDoLugar(normal), ctx.chaveDoLugar(other));
  assert.equal(ctx.accountScope(aba), ctx.accountScope({ ...aba, porta: 22 }));
  assert.notEqual(
    ctx.accountScope(aba),
    ctx.accountScope({ ...aba, porta: 2222 }),
  );
  assert.notEqual(
    ctx.chaveAberta(normal, "/projeto"),
    ctx.chaveAberta(other, "/projeto"),
  );
  assert.notEqual(
    ctx.chaveAberta(normal, "/projeto"),
    ctx.chaveAberta({ ...normal, chave: "C:/QA/other" }, "/projeto"),
  );
});
test("terminal remoto conecta na porta correta e recusa porta inválida", () => {
  assert.match(ctx.linhaShell(null, ctx.remotoDoAba(aba)), /ssh -t -p 22 /);
  assert.match(
    ctx.linhaShell(null, ctx.remotoDoAba({ ...aba, porta: 2222 })),
    /ssh -t -p 2222 /,
  );
  for (const porta of [0, -1, 65536, 22.5, "", "22 & echo LOCAL", "abc"]) {
    assert.equal(
      ctx.linhaShell(null, ctx.remotoDoAba({ ...aba, porta })),
      null,
      String(porta),
    );
  }
});
