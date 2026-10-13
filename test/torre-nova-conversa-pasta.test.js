'use strict';
/* 29/09/2026, pedido do Hugo: a Torre ganha ícone (como o HISTÓRICO) e um "+"
   que pergunta a pasta antes de abrir a conversa nova. O "+" do Histórico abre
   na pasta aberta; este abre em qualquer pasta, de onde ele estiver. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src/renderer/app.js'), 'utf8');
const UI = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const CSS = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.css'), 'utf8');

test('o kit tem o ícone da torre de controle', () => {
  const ini = APP.indexOf('const ICONES = ');
  const icones = JSON.parse(APP.slice(ini + 'const ICONES = '.length, APP.indexOf('};', ini) + 1));
  assert.ok(icones['tower-control'], 'falta tower-control no ICONES');
});

test('o cabeçalho da Torre tem ícone e um "+" que pergunta a pasta', () => {
  assert.match(UI, /grouping\.innerHTML = ico\("tower-control"\);/);
  assert.match(UI, /button\("plus", "Nova conversa em outra pasta", novaConversaEmOutraPasta, "ck-new-chat ck-new-chat-pasta"\)/);
  assert.match(CSS, /\.ck-nav-grouping > svg \{ width: 14px; height: 14px; flex: none; \}/);
  assert.match(CSS, /\.ck-collapsed:not\(\.ck-peek\) \.ck-nav-grouping > svg \{ display: none; \}/);
});

/* recusarTroca: o trocarAbaLocal do app só muda cfg.abaAtiva quando a troca acontece; recusada (apagandoAba) ou na fila
   (trocandoAba) ele volta sem mudar nada, e o await da janelinha termina do mesmo jeito. */
function montar({ ativa = 'a', motorEmFoco = 'codex', recusarTroca = false } = {}) {
  const inicio = UI.indexOf('  function novaConversaEmOutraPasta()');
  const fonte = UI.slice(inicio, UI.indexOf('\n  }\n', inicio) + 4);
  const reg = { trocou: [], abriu: [], fechou: 0, botoes: [] };
  const cfg = { abaAtiva: ativa, lastEngine: 'claude' };
  const ctx = vm.createContext({
    focusPane: motorEmFoco ? { engine: motorEmFoco } : null,
    cfg,
    abaAtual: () => ({ id: ativa }),
    abasLocais: () => [{ id: 'a', nome: 'PC inteiro' }, { id: 'b', nome: 'VPS', tipo: 'ssh' }],
    openLayer: () => ({ body: { append: (b) => reg.botoes.push(b) } }),
    closeLayer: () => { reg.fechou++; },
    labelled: (texto, acao) => ({ texto, acao, icone: '', insertAdjacentHTML(_onde, html) { this.icone = html; } }),
    ico: (nome) => '<svg data-ico="' + nome + '"></svg>',
    trocarAbaLocal: async (id) => { reg.trocou.push(id); if (!recusarTroca) cfg.abaAtiva = id; },
    novaConversa: (motor) => { reg.abriu.push(motor); },
  });
  vm.runInContext(fonte + '\nthis.abrir = novaConversaEmOutraPasta;', ctx);
  ctx.abrir();
  return reg;
}

test('a janelinha lista as pastas, marca a aberta e usa o ícone certo', () => {
  const reg = montar();
  assert.deepEqual(reg.botoes.map((b) => b.texto), ['PC inteiro (aberta)', 'VPS']);
  assert.match(reg.botoes[0].icone, /data-ico="folder"/);
  assert.match(reg.botoes[1].icone, /data-ico="server"/);
});

test('escolher outra pasta troca pra ela e abre a conversa com o motor do painel em foco', async () => {
  const reg = montar({ motorEmFoco: 'codex' });
  await reg.botoes[1].acao();
  assert.deepEqual(reg.trocou, ['b']);
  assert.deepEqual(reg.abriu, ['codex']);
  assert.equal(reg.fechou, 1);
});

/* Leva 1, final 2: trocarAbaLocal volta sem trocar quando está apagando uma aba (apagandoAba) ou quando já há outra troca
   em curso (trocandoAba: o pedido vira pendente). Sem conferir cfg.abaAtiva depois do await, a conversa nova abria na
   pasta de antes -- o mesmo padrão do activate() da Torre. */
test('troca recusada ou na fila: não abre a conversa nova na pasta errada', async () => {
  const reg = montar({ motorEmFoco: 'codex', recusarTroca: true });
  await reg.botoes[1].acao();
  assert.deepEqual(reg.trocou, ['b'], 'a troca foi pedida');
  assert.deepEqual(reg.abriu, [], 'mas nenhuma conversa nova abre na pasta de antes');
  assert.equal(reg.fechou, 1, 'a janelinha fecha do mesmo jeito');
});

test('escolher a pasta aberta não troca de pasta; sem painel em foco usa o último motor', async () => {
  const reg = montar({ motorEmFoco: null });
  await reg.botoes[0].acao();
  assert.deepEqual(reg.trocou, []);
  assert.deepEqual(reg.abriu, ['claude']);
});
