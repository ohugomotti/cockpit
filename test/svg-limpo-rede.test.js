'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const links = require('../src/renderer/file-links');

/* R1-01 (SVG do bloco excalidraw): o svgLimpo é o portão entre o desenho que o modelo manda e o DOM. Numa
   página file://, um <image href="//servidor/a.png"> vira \\servidor\a.png: o Windows tenta autenticar por SMB
   sozinho, sem ninguém clicar (entrega o hash da senha). É a mesma falha que o mdSeguro já fechou.

   O DOMPurify de verdade precisa de um DOM, e este projeto não tem jsdom. Por isso aqui roda o svgLimpo REAL
   (recortado do app.js) com um DOMPurify de mentira que só anota o que o svgLimpo entrega a ele: a ordem das
   chamadas, a configuração e o gancho uponSanitizeAttribute. A prova é feita em cima disso. */
const SVG = 'http://www.w3.org/2000/svg';

/* do "let seqDesenho" até a função seguinte: pega o svgLimpo e qualquer auxiliar dele, sem fixar o nome.
   A regra do url() mora numa função só, fora deste trecho (o mdSeguro usa a mesma): entra no contexto junto. */
function trechoDoSvgLimpo() {
  const fonte = lerFonte('renderer', 'app.js');
  const ini = fonte.indexOf('let seqDesenho = 0;');
  const fim = fonte.indexOf('function desenharBlocosExcalidraw(');
  assert.ok(ini > 0 && fim > ini, 'o trecho do desenho está no app.js');
  return pegarBloco(fonte, 'function urlDeRedeNoAtributo(', 'urlDeRedeNoAtributo') + '\n' + fonte.slice(ini, fim);
}

function svgLimpoReal({ falha = false, semDOMPurify = false } = {}) {
  const visto = { ordem: [], ganchos: [], retirados: [], config: null };
  const svgFalso = { querySelectorAll: () => [], removeAttribute: () => {} };
  const ctx = {
    window: { CockpitFileLinks: links },
    DOMPurify: {
      addHook: (nome, fn) => { visto.ordem.push('addHook'); visto.ganchos.push({ nome, fn }); },
      removeHook: (nome, fn) => { visto.ordem.push('removeHook'); visto.retirados.push({ nome, fn }); },
      sanitize: (html, config) => {
        visto.ordem.push('sanitize');
        visto.config = config;
        if (falha) throw new Error('o DOMPurify falhou');
        return { querySelector: () => svgFalso };
      },
    },
  };
  if (semDOMPurify) delete ctx.DOMPurify;
  vm.createContext(ctx);
  vm.runInContext(trechoDoSvgLimpo(), ctx);
  const resultado = ctx.svgLimpo({ outerHTML: '<svg></svg>' }, 'fx1-');
  return { visto, resultado, svgFalso, config: visto.config, gancho: visto.ganchos[0] && visto.ganchos[0].fn };
}
/* o que o DOMPurify entrega ao gancho: o nome do atributo e o valor, com keepAttr começando em true */
const atributo = (attrName, attrValue) => ({ attrName, attrValue, keepAttr: true });
const noImagem = { nodeName: 'image', namespaceURI: SVG };
const ATRIBUTOS_DE_ENDERECO = ['href', 'xlink:href', 'src'];

test('o svgLimpo registra o gancho antes de sanitizar e o tira no fim (um por chamada, sem acumular)', () => {
  const { visto, resultado, svgFalso } = svgLimpoReal();
  assert.equal(visto.ganchos.length, 1, 'o svgLimpo registra um gancho');
  assert.equal(visto.ganchos[0].nome, 'uponSanitizeAttribute');
  assert.deepEqual(visto.ordem, ['addHook', 'sanitize', 'removeHook']);
  assert.equal(visto.retirados.length, 1);
  assert.equal(visto.retirados[0].nome, 'uponSanitizeAttribute');
  assert.equal(visto.retirados[0].fn, visto.ganchos[0].fn);
  assert.equal(resultado, svgFalso, 'o desenho limpo continua sendo devolvido');
});

test('se o DOMPurify falha, o svgLimpo devolve null e o gancho sai do mesmo jeito', () => {
  const { visto, resultado } = svgLimpoReal({ falha: true });
  assert.equal(resultado, null);
  assert.deepEqual(visto.ordem, ['addHook', 'sanitize', 'removeHook']);
  assert.equal(visto.retirados[0].fn, visto.ganchos[0].fn);
});

test('sem o DOMPurify carregado, o svgLimpo continua devolvendo null em vez de estourar', () => {
  const { resultado } = svgLimpoReal({ semDOMPurify: true });
  assert.equal(resultado, null);
});

test('o gancho tira href, xlink:href e src que apontam para rede', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const nome of [...ATRIBUTOS_DE_ENDERECO, 'XLINK:HREF']) {
    for (const v of [
      '//h/a.png', '\\\\h\\a.png', '/\\h/a.png', '\\/h/a.png', 'file://h/a.png', 'file:////h/a.png', 'FILE://h/a.png',
      '  //h/a.png', '/\t/h/a.png', '/\n/h/a.png', '\t\\\\h\\a.png',
    ]) {
      const data = atributo(nome, v);
      gancho(noImagem, data);
      assert.equal(data.keepAttr, false, nome + ' ' + JSON.stringify(v));
    }
  }
});

test('o gancho deixa #id, data:image e endereço local para o DOMPurify decidir', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const nome of ATRIBUTOS_DE_ENDERECO) {
    for (const v of [
      '#id', '#mask-a1', 'data:image/png;base64,AAAA', 'https://exemplo.com/a.png', './a.png', 'img/a.png',
      '/abs/a.png', 'file:///C:/a.png', 'file://localhost/C:/a.png',
    ]) {
      const data = atributo(nome, v);
      gancho(noImagem, data);
      assert.equal(data.keepAttr, true, nome + ' ' + v);
      assert.equal(data.forceKeepAttr, undefined, nome + ' ' + v);   // quem decide é o DOMPurify, o gancho só recusa
    }
  }
});

test('o gancho só olha href, xlink:href e src: o resto do desenho segue igual', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const [nome, v] of [['d', '//h/a'], ['class', '//h/a'], ['fill', 'url(#a)'], ['points', '//h'], ['id', '//h']]) {
    const data = atributo(nome, v);
    gancho(noImagem, data);
    assert.equal(data.keepAttr, true, nome);
    assert.equal(data.forceKeepAttr, undefined, nome);
  }
});

test('a configuração do svgLimpo não mudou: perfil SVG, tags proibidas e fragmento de DOM', () => {
  const { config } = svgLimpoReal();
  assert.equal(config.USE_PROFILES.svg, true);   // (o objeto nasce no contexto do vm: não dá pra deepEqual)
  assert.equal(config.USE_PROFILES.svgFilters, true);
  for (const tag of ['a', 'style', 'foreignObject', 'script']) assert.ok(config.FORBID_TAGS.includes(tag), tag);
  assert.equal(config.RETURN_DOM_FRAGMENT, true);
});

/* Task 1c (acompanhamento do R1-01): href, xlink:href e src já eram barrados, mas "url(//servidor)" em qualquer outro
   atributo faz o mesmo estrago: o style (background, cursor...) e os atributos de pintura do SVG (fill, filter, mask,
   clip-path, marker-*, stroke) mandam a página buscar a imagem (ou o SVG) em \\servidor, sem clique. Aqui o style é
   permitido pelo perfil SVG, então esta é a única trava dele. A regra é uma só: o alvo de cada url(), sem aspas e
   sem espaços, passa pelo CockpitFileLinks.isNetworkPath. */
const URLS_DE_REDE = ['url(//h/x)', "url('\\\\h\\x')", 'url("/\\h/x")', 'url( //h/x )'];
const ATRIBUTOS_DE_PINTURA = ['fill', 'filter', 'mask', 'clip-path', 'stroke', 'marker-start', 'marker-mid', 'marker-end'];
const noRetangulo = { nodeName: 'rect', namespaceURI: SVG };

test('o gancho tira fill, filter, mask, clip-path, marker-* e stroke com url() para rede (com ou sem aspas, com espaços)', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const nome of ATRIBUTOS_DE_PINTURA) {
    for (const v of URLS_DE_REDE) {
      const data = atributo(nome, v);
      gancho(noRetangulo, data);
      assert.equal(data.keepAttr, false, nome + ' ' + v);
    }
  }
});

test('o gancho tira style com url() para rede (background, cursor), sozinho ou no meio de outras regras', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const v of URLS_DE_REDE) {
    for (const css of ['background:' + v, 'cursor:' + v + ', auto', 'color:red;background:#fff ' + v + ' no-repeat', 'background:url(#a), ' + v]) {
      const data = atributo('style', css);
      gancho(noRetangulo, data);
      assert.equal(data.keepAttr, false, css);
    }
  }
});

test('o gancho deixa url(#id), url(data:image/...) e style sem url() para o DOMPurify decidir', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const [nome, v] of [
    ['fill', 'url(#id)'], ['filter', "url('#id')"], ['mask', 'url( #id )'], ['clip-path', 'url("#id")'], ['marker-end', 'url(#seta)'],
    ['stroke', 'url(data:image/png;base64,AA)'], ['fill', 'url(#a) red'],
    ['style', 'background:url(#id)'], ['style', 'background:url(data:image/png;base64,AA)'], ['style', 'color:red'],
    ['style', 'background:url(./a.png)'], ['style', 'background:url(https://exemplo.com/a.png)'], ['fill', 'url(file:///C:/a.png)'],
  ]) {
    const data = atributo(nome, v);
    gancho(noRetangulo, data);
    assert.equal(data.keepAttr, true, nome + ' ' + v);
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + v);   // quem decide é o DOMPurify, o gancho só recusa
  }
});

test('url() em maiúscula, vários url() no mesmo valor, file://host e escape de CSS também saem', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const v of [
    'URL(//h/x)', 'Url( "//h/x" )', 'url(#a) url(//h/x)', 'url(//h/x) url(#a)', 'url(file://h/x)', 'url(file:////h/x)', 'url(\t//h/x)',
    // o navegador desfaz o escape de CSS antes de buscar: "u\72l(" é url( e "\2f" é "/"
    'u\\72l(//h/x)', '\\75rl(//h/x)', '\\000075rl(//h/x)', 'url(\\2f\\2f h/x)', 'url(\\2F \\2F h/x)',
  ]) {
    for (const nome of ['fill', 'style']) {
      const data = atributo(nome, v);
      gancho(noRetangulo, data);
      assert.equal(data.keepAttr, false, nome + ' ' + JSON.stringify(v));
    }
  }
});

/* Últimos ajustes da leva 1 (família do R1-01): image-set() e -webkit-image-set() aceitam um TEXTO entre aspas no lugar do
   url(): image-set("//h/x" 1x). A regra de cima só olhava o url(); o style sobrevive no perfil SVG e, numa página file://,
   "//h" vira \\h (SMB, sem clique). Agora o conteúdo de CADA texto entre aspas (simples ou duplas) do valor também passa
   pelo isNetworkPath: cobre image-set, -webkit-image-set e um futuro src("..."). O que não é caminho de rede fica
   (font-family:"Segoe UI"), e "//" sozinho também: é texto, não tem servidor. */
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
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const css of STYLES_DE_REDE) {
    const data = atributo('style', css);
    gancho(noRetangulo, data);
    assert.equal(data.keepAttr, false, JSON.stringify(css));
  }
});

test('o gancho tira fill, filter, mask, clip-path, marker-* e stroke com image-set() para rede (o texto entre aspas vale em qualquer atributo)', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const nome of ATRIBUTOS_DE_PINTURA) {
    for (const v of ['image-set("//h/x" 1x)', "-webkit-image-set('//h/x' 1x)", 'src("/\\h/x")']) {
      const data = atributo(nome, v);
      gancho(noRetangulo, data);
      assert.equal(data.keepAttr, false, nome + ' ' + v);
    }
  }
});

test('texto entre aspas que não é caminho de rede fica: font-family:"Segoe UI", content:"//", image-set() local, https ou data:', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
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
    gancho(noRetangulo, data);
    assert.equal(data.keepAttr, true, nome + ' ' + JSON.stringify(v));
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + JSON.stringify(v));   // quem decide é o DOMPurify, o gancho só recusa
  }
});

test('atributo sem url() não muda, mesmo com // ou barra invertida no valor', () => {
  const { gancho } = svgLimpoReal();
  assert.equal(typeof gancho, 'function', 'o svgLimpo registra um gancho');
  for (const [nome, v] of [
    ['d', 'M0 0//h'], ['class', '//h/a'], ['fill', 'red'], ['stroke', '#000'], ['points', '//h'], ['id', '//h'],
    ['style', 'color:red'], ['style', 'font-family:C:\\x\\y'], ['fill', 'u\\72l'], ['title', 'ver url e depois //h'],
  ]) {
    const data = atributo(nome, v);
    gancho(noRetangulo, data);
    assert.equal(data.keepAttr, true, nome + ' ' + v);
    assert.equal(data.forceKeepAttr, undefined, nome + ' ' + v);
  }
});

test('a regra do url() mora numa função só, e o gancho do svgLimpo chama essa função (sem cópia da regra)', () => {
  const fonte = lerFonte('renderer', 'app.js');
  assert.equal(fonte.split('function urlDeRedeNoAtributo(').length - 1, 1, 'uma definição só');
  assert.ok(pegarBloco(fonte, 'function tirarRedeDoSvg(', 'tirarRedeDoSvg').includes('urlDeRedeNoAtributo('), 'o gancho usa a função');
});
