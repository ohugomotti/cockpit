'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const links = require('../src/renderer/file-links');

/* R1-01: o mdSeguro é o único portão entre o markdown do modelo e o innerHTML. Numa página file://, um
   <img src="//servidor/a.png"> vira \\servidor\a.png: o Windows tenta autenticar por SMB sozinho, sem
   ninguém clicar (entrega o hash da senha).

   O DOMPurify de verdade precisa de um DOM, e este projeto não tem jsdom. Por isso aqui roda o mdSeguro
   REAL (recortado do app.js) com um DOMPurify de mentira que só anota o que o mdSeguro entrega a ele: a
   configuração (ALLOWED_URI_REGEXP) e o gancho uponSanitizeAttribute. A prova é feita em cima disso. */
const XHTML = 'http://www.w3.org/1999/xhtml';
// o DOMPurify tira todo espaço e controle do valor ANTES de testar o ALLOWED_URI_REGEXP
const ESPACOS_DO_DOMPURIFY = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;
const aceita = (regra, valor) => regra.test(String(valor).replace(ESPACOS_DO_DOMPURIFY, ''));

function mdSeguroReal() {
  const visto = { ganchos: [], retirados: [], config: null };
  const ctx = {
    window: { CockpitFileLinks: links },
    marked: { parse: (t) => String(t) },
    DOMPurify: {
      addHook: (nome, fn) => { visto.ganchos.push({ nome, fn }); },
      removeHook: (nome, fn) => { visto.retirados.push({ nome, fn }); },
      sanitize: (html, config) => { visto.config = config; return 'limpo'; },
    },
  };
  vm.createContext(ctx);
  const fonte = lerFonte('renderer', 'app.js');
  // a regra do url() mora numa função só, fora do mdSeguro (o svgLimpo usa a mesma): entra no contexto junto com ele
  vm.runInContext(pegarBloco(fonte, 'function urlDeRedeNoAtributo(', 'urlDeRedeNoAtributo') + '\n' + pegarBloco(fonte, 'function mdSeguro(', 'mdSeguro'), ctx);
  assert.equal(ctx.mdSeguro('texto'), 'limpo');
  assert.equal(visto.ganchos.length, 1);
  assert.equal(visto.ganchos[0].nome, 'uponSanitizeAttribute');
  return { regra: visto.config.ALLOWED_URI_REGEXP, config: visto.config, gancho: visto.ganchos[0].fn, visto };
}
const noImg = { nodeName: 'IMG', namespaceURI: XHTML };
const noLink = { nodeName: 'A', namespaceURI: XHTML };
const atributo = (attrName, attrValue) => ({ attrName, attrValue, keepAttr: true });

test('o mdSeguro registra o gancho e o tira no fim (um gancho por chamada, sem acumular)', () => {
  const { visto } = mdSeguroReal();
  assert.equal(visto.retirados.length, 1);
  assert.equal(visto.retirados[0].nome, 'uponSanitizeAttribute');
  assert.equal(visto.retirados[0].fn, visto.ganchos[0].fn);
});

test('a regra de URL recusa endereço que começa com duas barras de qualquer tipo (//, \\\\, /\\, \\/)', () => {
  const { regra } = mdSeguroReal();
  for (const v of [
    '//atacante.com/a.png', '\\\\atacante.com\\a.png', '/\\atacante.com/a.png', '\\/atacante.com/a.png',
    '  //atacante.com/a.png', '/\t/atacante.com/a.png', '/\n/atacante.com/a.png', '\t\\\\atacante.com\\a.png',
  ]) assert.equal(aceita(regra, v), false, JSON.stringify(v));
});

test('a regra de URL continua aceitando https, mailto, âncora e caminho relativo com ./ ou /', () => {
  const { regra } = mdSeguroReal();
  for (const v of [
    'https://exemplo.com/a.png', 'http://exemplo.com/a', 'mailto:oi@exemplo.com', '#secao',
    './a.png', '../a.png', '.\\a.png', '..\\a.png', '/abs/a.png',
  ]) assert.equal(aceita(regra, v), true, v);
});

test('a regra de URL passa a aceitar também caminho relativo sem ./ (como o DOMPurify padrão)', () => {
  const { regra } = mdSeguroReal();
  for (const v of ['img/a.png', 'a.png', 'docs/a.md']) assert.equal(aceita(regra, v), true, v);
});

test('a regra de URL continua recusando protocolo ativo e file:', () => {
  const { regra } = mdSeguroReal();
  for (const v of [
    'javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<b>x</b>',
    'file://atacante.com/a.png', 'file:///C:/a.png',
  ]) assert.equal(aceita(regra, v), false, JSON.stringify(v));
});

test('o gancho tira o src que aponta para rede, em qualquer tag', () => {
  const { gancho } = mdSeguroReal();
  for (const tag of ['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'IMAGE', 'IFRAME']) {
    for (const v of [
      '//atacante.com/a.png', '\\\\atacante.com\\a.png', '/\\atacante.com/a.png', '\\/atacante.com/a.png',
      'file://atacante.com/a.png', '  //atacante.com/a.png', '/\t/atacante.com/a.png',
    ]) {
      const data = atributo('src', v);
      gancho({ nodeName: tag, namespaceURI: XHTML }, data);
      assert.equal(data.keepAttr, false, tag + ' ' + JSON.stringify(v));
    }
  }
});

test('o gancho deixa o src local, https e data: para o DOMPurify decidir', () => {
  const { gancho } = mdSeguroReal();
  for (const v of [
    'data:image/png;base64,iVBORw0KGgo=', './a.png', 'img/a.png', '/abs/a.png', 'https://exemplo.com/a.png',
    'file:///C:/a.png', 'file://localhost/C:/a.png',
  ]) {
    const data = atributo('src', v);
    gancho(noImg, data);
    assert.equal(data.keepAttr, true, v);
    assert.equal(data.forceKeepAttr, undefined, v);
  }
});

test('o gancho do href segue igual: arquivo e âncora ficam; rede e protocolo ofuscado saem', () => {
  const { gancho } = mdSeguroReal();
  for (const v of ['docs/a.md', './docs/a.md', 'C:\\x\\a.md', 'file:///C:/x/a.md', '#secao', '/opt/equipe/a.md']) {
    const data = atributo('href', v);
    gancho(noLink, data);
    assert.equal(data.forceKeepAttr, true, v);
    assert.equal(data.keepAttr, true, v);
  }
  for (const v of [
    '\\\\servidor\\x.md', 'file://servidor/x.md', 'file:////servidor/x.md', '/\\servidor/x.md', '\\/servidor/x.md',
    'javascript:alert(1)', 'java%73cript:alert(1)',
  ]) {
    const data = atributo('href', v);
    gancho(noLink, data);
    assert.equal(data.keepAttr, false, v);
    assert.equal(data.forceKeepAttr, undefined, v);
  }
  for (const v of ['https://exemplo.com/a', 'mailto:oi@exemplo.com']) {   // quem decide é a regra de URL
    const data = atributo('href', v);
    gancho(noLink, data);
    assert.equal(data.keepAttr, true, v);
    assert.equal(data.forceKeepAttr, undefined, v);
  }
  const fora = atributo('href', 'docs/a.md');   // href que não é de <a> não ganha exceção
  gancho(noImg, fora);
  assert.equal(fora.forceKeepAttr, undefined);
});

test('as proibições de tag e atributo continuam na configuração', () => {
  const { config } = mdSeguroReal();
  for (const tag of ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'base', 'meta', 'link']) assert.ok(config.FORBID_TAGS.includes(tag), tag);
  for (const attr of ['style', 'srcset', 'formaction', 'action', 'target', 'ping']) assert.ok(config.FORBID_ATTR.includes(attr), attr);
});

/* Task 1c (acompanhamento do R1-01): o src já era barrado, mas "url(//servidor)" em qualquer outro atributo faz o
   mesmo estrago. O SVG embutido no markdown passa pelo mesmo gancho, e fill, filter, mask, clip-path, marker-* e
   stroke mandam a página buscar a imagem (ou o SVG) em \\servidor, sem clique. O style também entra na regra: a
   proibição dele na configuração é uma segunda trava, não a primeira. A regra é uma só: o alvo de cada url(), sem
   aspas e sem espaços, passa pelo CockpitFileLinks.isNetworkPath. */
const SVG = 'http://www.w3.org/2000/svg';
const noSvg = { nodeName: 'rect', namespaceURI: SVG };
const URLS_DE_REDE = ['url(//h/x)', "url('\\\\h\\x')", 'url("/\\h/x")', 'url( //h/x )'];
const ATRIBUTOS_DE_PINTURA = ['fill', 'filter', 'mask', 'clip-path', 'stroke', 'marker-start', 'marker-mid', 'marker-end'];

test('o gancho tira fill, filter, mask, clip-path, marker-* e stroke com url() para rede (com ou sem aspas, com espaços)', () => {
  const { gancho } = mdSeguroReal();
  for (const nome of ATRIBUTOS_DE_PINTURA) {
    for (const v of URLS_DE_REDE) {
      const data = atributo(nome, v);
      gancho(noSvg, data);
      assert.equal(data.keepAttr, false, nome + ' ' + v);
    }
  }
});

test('o gancho tira style com url() para rede (background, cursor), sozinho ou no meio de outras regras', () => {
  const { gancho } = mdSeguroReal();
  for (const v of URLS_DE_REDE) {
    for (const css of ['background:' + v, 'cursor:' + v + ', auto', 'color:red;background:#fff ' + v + ' no-repeat', 'background:url(#a), ' + v]) {
      const data = atributo('style', css);
      gancho(noSvg, data);
      assert.equal(data.keepAttr, false, css);
    }
  }
});

test('o gancho deixa url(#id), url(data:image/...) e style sem url() para o DOMPurify decidir', () => {
  const { gancho } = mdSeguroReal();
  for (const [nome, v] of [
    ['fill', 'url(#id)'], ['filter', "url('#id')"], ['mask', 'url( #id )'], ['clip-path', 'url("#id")'], ['marker-end', 'url(#seta)'],
    ['stroke', 'url(data:image/png;base64,AA)'], ['fill', 'url(#a) red'],
    ['style', 'background:url(#id)'], ['style', 'background:url(data:image/png;base64,AA)'], ['style', 'color:red'],
    ['style', 'background:url(./a.png)'], ['style', 'background:url(https://exemplo.com/a.png)'], ['fill', 'url(file:///C:/a.png)'],
  ]) {
    const data = atributo(nome, v);
    gancho(noSvg, data);
    assert.equal(data.keepAttr, true, nome + ' ' + v);
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + v);   // quem decide é o DOMPurify, o gancho só recusa
  }
});

test('url() em maiúscula, vários url() no mesmo valor, file://host e escape de CSS também saem', () => {
  const { gancho } = mdSeguroReal();
  for (const v of [
    'URL(//h/x)', 'Url( "//h/x" )', 'url(#a) url(//h/x)', 'url(//h/x) url(#a)', 'url(file://h/x)', 'url(file:////h/x)', 'url(\t//h/x)',
    // o navegador desfaz o escape de CSS antes de buscar: "u\72l(" é url( e "\2f" é "/"
    'u\\72l(//h/x)', '\\75rl(//h/x)', '\\000075rl(//h/x)', 'url(\\2f\\2f h/x)', 'url(\\2F \\2F h/x)',
  ]) {
    for (const nome of ['fill', 'style']) {
      const data = atributo(nome, v);
      gancho(noSvg, data);
      assert.equal(data.keepAttr, false, nome + ' ' + JSON.stringify(v));
    }
  }
});

/* Últimos ajustes da leva 1 (família do R1-01): image-set() e -webkit-image-set() aceitam um TEXTO entre aspas no lugar do
   url(): image-set("//h/x" 1x). A regra de cima só olhava o url(); o style do SVG embutido passa pelo mesmo gancho e,
   numa página file://, "//h" vira \\h (SMB, sem clique). Agora o conteúdo de CADA texto entre aspas (simples ou duplas) do
   valor também passa pelo isNetworkPath: cobre image-set, -webkit-image-set e um futuro src("..."). O que não é caminho
   de rede fica (font-family:"Segoe UI"), e "//" sozinho também: é texto, não tem servidor. */
const STYLES_DE_REDE = [
  // o caso provado pela revisão: image-set com texto em vez de url(), nas duas grafias
  'background:image-set("//h/x" 1x)', "background:-webkit-image-set('//h/x' 1x)", "background:image-set('//h/x' 1x)",
  'background:-webkit-image-set("//h/x" 1x)', 'background:image-set("a.png" 1x, "//h/x" 2x)',   // o de rede não precisa ser o primeiro
  'background-image:image-set("//h/x" 1x, "//h/y" 2x)', 'cursor:image-set("//h/x" 1x), auto',
  'color:red;list-style-image:-webkit-image-set("//h/x" 1x);margin:0', 'mask-image:src("//h/x")', "border-image-source:src('//h/x')",
  // o mesmo endereço escrito de outros jeitos
  'background:image-set(" //h/x" 1x)', 'background:image-set("\\\\h\\x" 1x)', 'background:image-set("/\\h/x" 1x)',
  'background:image-set("\\/h/x" 1x)', 'background:image-set("/\t/h/x" 1x)',
  'background:image-set("file://h/x" 1x)', 'background:image-set("file://h" 1x)', 'background:image-set("FILE:////h/x" 1x)',
  // o navegador desfaz o escape de CSS antes de buscar: "\2f" é "/"
  'background:image-set("\\2f\\2f h/x" 1x)', 'background:image-set("\\2F/h/x" 1x)', 'background:image-set("\\00002f/h/x" 1x)',
  // continuação de linha (barra invertida + quebra) e tab por escape: também somem antes de buscar
  'background:image-set("\\\n//h/x" 1x)', 'background:image-set("/\\\n/h/x" 1x)', 'background:image-set("\\9 //h/x" 1x)',
  // sem espaço depois do texto, e src() com espaços dentro do parêntese
  'background:image-set("//h/x"1x)', 'mask-image:src(  "//h/x"  )',
  // sem fechar: o CSS fecha o texto (e o parêntese) no fim do valor
  'background:image-set("//h/x" 1x', 'background:image-set("//h/x',
  // "//" sozinho e fonte entre aspas ficam, mas o endereço de rede ao lado não se salva por isso
  'content:"//";background:image-set("//h/x" 1x)', 'font-family:"Segoe UI";background:image-set("//h/x" 1x)',
  // aspa que não abre texto (dentro de comentário, ou escapada) não desencontra as contas
  'background:image-set(/*"*/ "//h/x" 1x)', 'background:image-set("\\"" 0.5x, "\\2f/h/x" 1x)',
  // o "//" só é inofensivo entre as MESMAS aspas e sem nada escapado: um host que começa com aspa continua sendo host
  "background:image-set(\"//'h/x\" 1x)", 'background:image-set("//\\"h/x" 1x)',
  // url() com texto: "file://h" sem caminho e com espaço antes do ")" não vira URL para o isNetworkPath
  'background:url("file://h" )', "background:url( 'file://h' )", 'background:url(file://h )', 'background:url( file://h )',
];

test('o gancho tira o style com image-set(), -webkit-image-set() ou src() cujo texto entre aspas aponta para rede', () => {
  const { gancho } = mdSeguroReal();
  for (const css of STYLES_DE_REDE) {
    const data = atributo('style', css);
    gancho(noSvg, data);
    assert.equal(data.keepAttr, false, JSON.stringify(css));
  }
});

test('o gancho tira fill, filter, mask, clip-path, marker-* e stroke com image-set() para rede (o texto entre aspas vale em qualquer atributo)', () => {
  const { gancho } = mdSeguroReal();
  for (const nome of ATRIBUTOS_DE_PINTURA) {
    for (const v of ['image-set("//h/x" 1x)', "-webkit-image-set('//h/x' 1x)", 'src("/\\h/x")']) {
      const data = atributo(nome, v);
      gancho(noSvg, data);
      assert.equal(data.keepAttr, false, nome + ' ' + v);
    }
  }
});

test('texto entre aspas que não é caminho de rede fica: font-family:"Segoe UI", content:"//", image-set() local, https ou data:', () => {
  const { gancho } = mdSeguroReal();
  const quemFica = [
    ...[
      'font-family:"Segoe UI", sans-serif', "font-family:'Segoe UI'", 'font-family:"Segoe UI";color:red',
      'content:"//"', "content:'//'", 'content:"/"', 'content:""', 'content:"///"', 'content:"\\2f\\2f"', 'content:"a // b"', 'quotes:"(" ")"',
      'content:"//";font-family:"Segoe UI"',
      'background:image-set("a.png" 1x, "b.png" 2x)', 'background:image-set("./a.png" 1x)', 'background:image-set("#id" 1x)',
      'background:image-set("https://exemplo.com/a.png" 1x)', 'background:image-set("data:image/png;base64,AA" 1x)',
      'background:image-set("file:///C:/a.png" 1x)', 'background:image-set("file://localhost/C:/a.png" 1x)',
      'background:url("a.png"), image-set("b.png" 1x)', 'background:url(file:///C:/a.png )', 'background:url( file://localhost/C:/a.png )',
    ].map((css) => ['style', css]),
    ['font-family', '"Segoe UI"'], ['font-family', "'Segoe UI', Arial"], ['title', 'ele disse "oi" e foi embora'], ['title', "it's fine"],
  ];
  for (const [nome, v] of quemFica) {
    const data = atributo(nome, v);
    gancho(noSvg, data);
    assert.equal(data.keepAttr, true, nome + ' ' + JSON.stringify(v));
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + JSON.stringify(v));   // quem decide é o DOMPurify, o gancho só recusa
  }
});

test('atributo sem url() não muda, mesmo com // ou barra invertida no valor', () => {
  const { gancho } = mdSeguroReal();
  for (const [nome, v] of [
    ['d', 'M0 0//h'], ['class', '//h/a'], ['fill', 'red'], ['stroke', '#000'], ['points', '//h'], ['id', '//h'],
    ['style', 'color:red'], ['style', 'font-family:C:\\x\\y'], ['fill', 'u\\72l'], ['title', 'ver url e depois //h'],
  ]) {
    const data = atributo(nome, v);
    gancho(noSvg, data);
    assert.equal(data.keepAttr, true, nome + ' ' + v);
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + v);
  }
});

test('a regra do url() mora numa função só, e o gancho do mdSeguro chama essa função (sem cópia da regra)', () => {
  const fonte = lerFonte('renderer', 'app.js');
  assert.equal(fonte.split('function urlDeRedeNoAtributo(').length - 1, 1, 'uma definição só');
  assert.ok(pegarBloco(fonte, 'function mdSeguro(', 'mdSeguro').includes('urlDeRedeNoAtributo('), 'o mdSeguro usa a função');
});
