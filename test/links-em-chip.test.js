'use strict';
/* Leva 4, Tarefa 6 (UI 4.4 e R2-06). Medidas:
   - texto do link cru https://app.clickup.com/t/86abc123 (antes a URL; depois "ClickUp · 86abc123");
   - temporizadores que apagam o "Você respondeu" (antes 1, de 10 s; depois 0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const FileLinks = require('../src/renderer/file-links');

const APP = lerFonte('renderer', 'app.js');
const CSS = lerFonte('renderer', 'style.css');

function link(href, texto) {
  const cls = new Set(), attrs = { href };
  return { textContent: texto, title: '', href, classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
}
function marcar(links, opcoes) {
  const ctx = vm.createContext({ URL, window: { CockpitFileLinks: FileLinks } });
  vm.runInContext(pegarBloco(APP, 'function marcarLinksWeb(', 'marcarLinksWeb'), ctx);
  ctx.marcarLinksWeb({ querySelectorAll: () => links }, opcoes);
  return links;
}
function nota(isErr, fixo) {
  const timers = [], chat = { filhos: [], appendChild(d) { this.filhos.push(d); return d; }, querySelectorAll: () => [] };
  const ctx = vm.createContext({ document: { createElement: () => ({ className: '', textContent: '', remove() {} }) },
    clearEmpty() {}, scroll() {}, setTimeout: (fn, ms) => { timers.push(ms); return timers.length; } });
  vm.runInContext(['textoDaNota', 'note'].map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  ctx.note({ chat, el: {} }, 'Você respondeu:\n• Qual? → sim', isErr, fixo);
  return { d: chat.filhos[0], timers };
}

test('link cru vira chip: ClickUp com o id da tarefa; os outros, o domínio (UI 4.4)', () => {
  const [clickup, site, raiz] = marcar([link('https://app.clickup.com/t/86abc123', 'https://app.clickup.com/t/86abc123'),
    link('https://www.exemplo.com.br/caminho/longo?x=1', 'https://www.exemplo.com.br/caminho/longo?x=1'), link('https://exemplo.com', 'https://exemplo.com')]);
  assert.equal(clickup.textContent, 'ClickUp · 86abc123');
  assert.ok(clickup.classList.contains('link-chip'));
  assert.equal(site.textContent, 'exemplo.com.br');
  assert.equal(raiz.textContent, 'exemplo.com');
  assert.match(site.title, /^https:\/\/www\.exemplo\.com\.br\/caminho\/longo\?x=1\n/, 'a URL inteira fica no hover');
});

test('link com texto fica como está; e-mail não vira chip (UI 4.4)', () => {
  const [comTexto, email] = marcar([link('https://exemplo.com/guia', 'o guia'), link('mailto:a@b.com', 'mailto:a@b.com')]);
  assert.equal(comTexto.textContent, 'o guia');
  assert.equal(comTexto.classList.contains('link-chip'), false);
  assert.ok(comTexto.classList.contains('link-web'), 'continua marcado como link de fora');
  assert.equal(email.textContent, 'mailto:a@b.com');
  assert.equal(email.classList.contains('link-chip'), false);
});

test('nota fixa não ganha temporizador; o aviso comum ainda some em 10 s (R2-06)', () => {
  const fixa = nota(false, true);
  assert.deepEqual(fixa.timers, [], 'temporizadores para apagar o resumo: ' + fixa.timers.length);
  assert.equal(fixa.d.className, 'note fixa');
  assert.deepEqual(nota(false).timers, [10000]);
});

/* Leva 4, onda 2, correção 3 (revisão ae08f472484ba810d). Medida: quebras de linha do resumo de 2 perguntas que chegam à tela.
   Antes: 0 de 2 (a nota é um div com white-space normal: o "\n" virava espaço e saía um parágrafo só, "Você respondeu: • Qual? → sim
   • …"). Depois: 2 de 2 (pre-line), uma resposta por linha. */
test('nota fixa mostra cada resposta do resumo na sua linha (R2-06)', () => {
  const regra = /(?:^|\n)\.note\.fixa\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(regra, 'falta .note.fixa no style.css');
  assert.match(regra[1], /white-space:\s*pre-line/, 'regra: ' + regra[1]);
  // é esse texto, com "\n" entre as linhas, que o pre-line precisa preservar
  assert.match(nota(false, true).d.textContent, /^Você respondeu:\n• /);
});

/* Os testes abaixo não vêm do plano: travam o que o chip não pode quebrar. */

/* No caminho de verdade o linkarArquivos roda antes e já regrava o href com a forma normalizada (URL sem caminho ganha
   a barra do fim), mas o texto continua o que o modelo escreveu. Sem o semBarra o chip nunca valeria para "https://x.com". */
test('href já normalizado (barra no fim) com o texto cru ainda vira chip (UI 4.4)', () => {
  const [a, b] = marcar([link('https://exemplo.com/', 'https://exemplo.com'), link('https://exemplo.com/guia', 'https://exemplo.com/guia/')]);
  assert.equal(a.textContent, 'exemplo.com');
  assert.ok(a.classList.contains('link-chip'));
  assert.equal(b.textContent, 'exemplo.com', 'a barra a mais no texto também é o mesmo link');
});

/* O rótulo "ClickUp · id" é sinal de confiança: não pode sair para domínio que só parece o ClickUp, nem para endereço
   com "app.clickup.com" no lugar do usuário (https://app.clickup.com@evil.com/...). O chip mostra o domínio real. */
test('só o ClickUp de verdade ganha o rótulo ClickUp; o que imita mostra o domínio real (UI 4.4)', () => {
  const casos = [
    ['https://evilclickup.com/t/86abc123', 'evilclickup.com'],
    ['https://clickup.com.evil.com/t/86abc123', 'clickup.com.evil.com'],
    ['https://app.clickup.com.evil.com/t/86abc123', 'app.clickup.com.evil.com'],
    ['https://app.clickup.com@evil.com/t/86abc123', 'evil.com'],
    ['https://app.clickup.com/', 'app.clickup.com'],
    ['https://clickup.com/t/86abc123/', 'ClickUp · 86abc123'],
    ['https://app.clickup.com/t/86abc123?x=1#y', 'ClickUp · 86abc123'],
  ];
  const chips = marcar(casos.map(([u]) => link(u, u)));
  chips.forEach((c, i) => assert.equal(c.textContent, casos[i][1], casos[i][0]));
});

/* Leva 4, onda 2, correção 6 (revisão ae08f472484ba810d). Medida: o rótulo do chip para ClickUp com ID personalizado, que a URL
   escreve como /t/<número do time>/<id>. Antes: "ClickUp · 9014" (o número do time, igual para todas as tarefas). Depois: o id. */
test('ClickUp com ID personalizado (/t/<time>/<id>) mostra o id da tarefa, não o número do time (UI 4.4)', () => {
  const casos = [
    ['https://app.clickup.com/t/9014/86abc123', 'ClickUp · 86abc123'],
    ['https://app.clickup.com/t/9014/PROJ-42', 'ClickUp · PROJ-42'],
    ['https://app.clickup.com/t/9014/86abc123?x=1#y', 'ClickUp · 86abc123'],
    ['https://app.clickup.com/t/86abc123', 'ClickUp · 86abc123'],
    ['https://app.clickup.com/t/12345', 'ClickUp · 12345'],    // id só de dígitos, sem número do time na frente
    ['https://app.clickup.com/t/12345/', 'ClickUp · 12345'],
  ];
  const chips = marcar(casos.map(([u]) => link(u, u)));
  chips.forEach((c, i) => assert.equal(c.textContent, casos[i][1], casos[i][0]));
});

/* REGRA DE OURO do projeto: caminho de rede (\\servidor, //servidor, file://servidor) nunca vira link. O chip só olha o que o
   parse devolve como "external"; o resto sai do laço antes de qualquer mudança. Aqui o texto é IGUAL ao href (a condição
   que faria o chip agir), e nada pode mudar: nem classe, nem texto, nem href, nem title. */
test('caminho de rede com o texto igual ao href não vira link nem chip (regra de ouro)', () => {
  const redes = [
    '\\\\servidor\\pasta\\x.md', 'file://servidor/pasta/x.md', 'file://127.0.0.1/share/x.md', 'file:////servidor/x.md',
    '/\\servidor/x.md', '\\/servidor/x.md', 'file:///%5C%5Cservidor%5Cx.md', '%5C%5Cservidor%5Cx.md', '%2F%2Fservidor%2Fx.md',
    '\\\\?\\UNC\\servidor\\x.md',
  ];
  const links = marcar(redes.map((r) => link(r, r)));
  links.forEach((a, i) => {
    const r = redes[i];
    assert.equal(a.classList.contains('link-chip'), false, 'chip em ' + r);
    assert.equal(a.classList.contains('link-web'), false, 'link de fora em ' + r);
    assert.equal(a.textContent, r, 'texto mudou em ' + r);
    assert.equal(a.href, r, 'href mudou em ' + r);
    assert.equal(a.title, '', 'title mudou em ' + r);
  });
});

/* Rodada final, item 2c (revisão final a7ed9b2c1aa8b7f86). A UI 4.4 (o link cru vira chip) vale para a conversa. No leitor de arquivos
   (verArquivo) o link cru de um documento segue inteiro, como está escrito nele. Medida: texto do link cru do ClickUp no leitor
   (antes "ClickUp · 86abc123", o chip; depois a própria URL). */
test('leitor: marcarLinksWeb(el, { chip: false }) marca o link de fora e a URL crua fica inteira, sem chip (UI 4.4 é da conversa)', () => {
  const tarefa = 'https://app.clickup.com/t/86abc123';
  const [clickup, raiz, comTexto] = marcar([link(tarefa, tarefa), link('https://exemplo.com/', 'https://exemplo.com'), link('https://exemplo.com/guia', 'o guia')], { chip: false });
  assert.equal(clickup.textContent, tarefa);
  assert.equal(raiz.textContent, 'https://exemplo.com');
  assert.equal(comTexto.textContent, 'o guia');
  for (const a of [clickup, raiz, comTexto]) {
    assert.equal(a.classList.contains('link-chip'), false, a.href);
    assert.ok(a.classList.contains('link-web'), 'continua marcado como link de fora: ' + a.href);
    assert.equal(a.title, 'abre no seu navegador', 'sem a URL no hover: ela já é o texto');
  }
  // na conversa (sem a opção) o mesmo link segue virando chip
  const [naConversa] = marcar([link(tarefa, tarefa)]);
  assert.equal(naConversa.textContent, 'ClickUp · 86abc123');
});

test('leitor: caminho de rede continua nunca virando link nem chip, com a opção chip: false (regra de ouro)', () => {
  const redes = ['\\\\servidor\\pasta\\x.md', 'file://servidor/pasta/x.md', 'file://127.0.0.1/share/x.md', '/\\servidor/x.md', 'file:///%5C%5Cservidor%5Cx.md'];
  const links = marcar(redes.map((r) => link(r, r)), { chip: false });
  links.forEach((a, i) => {
    assert.equal(a.classList.contains('link-chip'), false, 'chip em ' + redes[i]);
    assert.equal(a.classList.contains('link-web'), false, 'link de fora em ' + redes[i]);
    assert.equal(a.textContent, redes[i]);
    assert.equal(a.href, redes[i]);
  });
});
