'use strict';
/* O buscador (Ctrl K) veio com os resultados SOBREPOSTOS: com 40 achados, o
   título de um item caía por cima do texto do item de baixo e nada era legível
   (print do Hugo em 21/09/2026). A causa não era duplicação de resultado — era
   a lista encolher os itens.

   O que este teste protege:
   1) item de resultado NÃO encolhe. `.ck-results` é uma coluna flex e todo
      filho de flex tem `flex-shrink: 1` por padrão; com muitos itens eles eram
      espremidos abaixo da própria altura de conteúdo e o texto vazava. Quem
      rola é a lista, não o item;
   2) título e resumo ficam em UMA linha cada, cortando com reticências — o
      resumo vinha com a frase inteira e embolava três linhas por item;
   3) conversa guardada não se mistura com sessão viva: ela tem o grupo
      "Conversas", separado de "Agentes". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const ui = fs.readFileSync(path.join(raiz, 'cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'cockpit-ui.css'), 'utf8').replace(/\r\n/g, '\n');

function regra(seletor) {
  const i = css.indexOf('\n' + seletor + ' {');
  assert.notEqual(i, -1, 'regra não encontrada no cockpit-ui.css: ' + seletor);
  return css.slice(i, css.indexOf('}', i) + 1);
}

test('o resultado da busca não encolhe: quem rola é a lista', () => {
  const lista = regra('.ck-results');
  assert.match(lista, /flex-direction:\s*column/);
  assert.match(lista, /overflow:\s*auto/, 'a rolagem é da lista');
  const item = regra('.ck-result');
  assert.match(item, /flex:\s*none/, 'sem isto o item é espremido e o texto vaza por cima do vizinho');
});

test('título e resumo do resultado ocupam uma linha cada, com reticências', () => {
  const texto = css.slice(css.indexOf('.ck-result strong,'));
  const bloco = texto.slice(0, texto.indexOf('}') + 1);
  assert.match(bloco, /\.ck-result small/, 'a regra vale para os dois');
  assert.match(bloco, /white-space:\s*nowrap/);
  assert.match(bloco, /text-overflow:\s*ellipsis/);
  assert.match(bloco, /overflow:\s*hidden/);
  // a coluna de texto precisa poder encolher, senão o ellipsis nunca acontece
  const caixa = regra('.ck-result-text');
  assert.match(caixa, /min-width:\s*0/);
  assert.match(caixa, /flex:\s*1/);
});

test('conversa guardada tem grupo próprio, separado das sessões vivas', () => {
  assert.match(ui, /const order=\['Agentes','Conversas','Pastas','Arquivos','Comandos'\]/);
  // a linha das guardadas é a que fala "Guardada · "
  const i = ui.indexOf("detail:'Guardada · '");
  assert.notEqual(i, -1, 'não achei a montagem das conversas guardadas');
  const linha = ui.slice(ui.lastIndexOf('\n', i), i);
  assert.match(linha, /group:'Conversas'/, 'guardada não pode entrar como Agentes');
  // e as sessões VIVAS continuam sendo Agentes
  assert.match(ui, /liveRows\(\)\.filter[\s\S]{0,200}?group:'Agentes'/);
});

test('a de-duplicação por motor+id continua de pé', () => {
  // era o que impedia a mesma conversa de aparecer duas vezes; segue valendo
  assert.match(ui, /const seen=new Set\(results\.map\(r=>r\.key\)\.filter\(Boolean\)\)/);
  assert.match(ui, /const key=engine\+'\|'\+s\.id;if\(seen\.has\(key\)\)continue;seen\.add\(key\)/);
});

/* O medidor de uso do Claude "sumiu" em 21/09/2026. A causa raiz é externa — a
   API api.anthropic.com/api/oauth/usage devolve 429 quando há muitos clientes
   Claude na mesma conta (medido: retry-after de 2273 s, com token válido e
   conta Max). O app já respeita o retry-after, então não agrava.

   O que ERA do app: a leva daquele mesmo dia passou a ESCONDER o botão quando a
   consulta não voltava. Sumir é pior que ficar apagado — parece que o motor
   desconectou. O renderAccountMeter já desenha o estado "sem dados de limite",
   e é ele que tem que aparecer. Quem some é só o motor sem conta nenhuma. */
const uiSrc = fs.readFileSync(path.join(raiz, 'cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
test('medidor de conta: falha na consulta apaga, não some', () => {
  const i = uiSrc.indexOf('async function loadAccounts(');
  assert.notEqual(i, -1);
  const corpo = uiSrc.slice(i, uiSrc.indexOf('\n  }', i));
  // no catch, quem ja' respondeu antes continua na tela
  assert.match(corpo, /const antes = accountCache\.get\(id\);\s*\n\s*b\.hidden = !antes\?\.logado;/);
  assert.match(corpo, /if \(antes\?\.logado\)\s*\n\s*b\.innerHTML = CockpitUsage\.renderAccountMeter\(/);
  // e o "logado" nao exige ter numero: conta conectada basta
  assert.match(corpo, /const logado = !!active \|\| !!summary\.available;/);
});
