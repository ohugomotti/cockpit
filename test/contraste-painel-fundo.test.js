'use strict';
/* Leva 5e, pedido do Hugo (07/10/2026): "em todos os modos de cores, um contraste maior entre o painel da sessão e o fundo do
   Cockpit". Mais: "o menu lateral não é fundo" (a lateral é uma superfície própria), "a cor muito clara do fundo" (nos temas claros
   o fundo estava claro demais) e "as pastas também não devem ter a mesma cor do fundo" (as abas de pasta ganham superfície própria,
   e a ativa fica mais marcada).

   Medida do app real do Hugo, com o visual Mac ligado (prints dele): Jornal, painel #FCFBF6 sobre fundo #F9F7F0 = 1,02:1;
   Escuro, painel #141416 sobre fundo #0D0C0B = 1,06:1. No visual Mac o "fundo" era o Mica do Windows sob uma película
   (--mac-window): quase branco nos claros, quase preto nos escuros, e a prévia (tools/redesenho) não reproduz isso. Agora a área
   de trabalho (.ck-work: a faixa de pastas, os painéis e o vão entre as colunas) tem uma cor explícita e opaca, o --work, um por tema,
   e a conta não depende do papel de parede.

   Antes (visual Mac ligado, Mica típico #202020 nos escuros e #F3F3F3 nos claros), painel × fundo: Escuro 1,06 · Azul 1,16 ·
   Automático escuro 1,15 · Claro 1,02 · Jornal 1,04 · Automático claro 1,03. Lateral × fundo: de 1,02 a 1,07 em cinco dos seis.
   Desligado o visual Mac, o painel era o próprio --canvas, a mesma cor do fundo (1,00).

   A régua: painel (--raised) × fundo (--work) ≥ 1,20:1; abas (--tab, --tab-on) e lateral × fundo ≥ 1,10:1 cada; texto ≥ 4,5:1 no
   painel, na lateral, nas abas e direto sobre o fundo. Os 7 modos: Automático claro e escuro, Claro, Jornal, Escuro, Azul e Motti
   (o Motti é o Azul em tempo de execução: app.js e visual-mac.js trocam 'motti' por 'azul', então os números do Azul valem pelos dois).

   Segunda rodada da leva 5e (07/10, depois dos prints): "o azul e o escuro ficou ainda estranho, o automático tá diferente do escuro,
   deveria ser o mesmo". Duas exigências novas, e é este arquivo que as cobra:
   1) ESCADA nos escuros (Escuro, Azul e, por ser apelido do Escuro, o Automático escuro): fundo < lateral < painel < popups e cartões.
      A lateral tinha virado uma placa de vidro cinza-CLARO solta sobre o preto puro (Escuro: lateral #3A3A3D, painel #1C1C20, fundo
      #000000; Azul: lateral #3D4865). Agora o fundo é o degrau mais escuro (sem ser preto puro), a lateral é uma superfície própria um
      degrau acima, ABAIXO do painel, e no visual Mac ela é uma tinta escura quase opaca, não vidro claro. As razões:
      painel × fundo ≥ 1,20 · lateral × fundo ≥ 1,06 · painel × lateral ≥ 1,08 · aba × fundo ≥ 1,10 · texto ≥ 4,5 em toda superfície.
      (Nos claros a lateral segue em ≥ 1,10 do fundo, como estava.) A aba inativa tem a cor do painel e a ativa é um degrau acima.
   2) AUTOMÁTICO = TEMA FIXO: com o Windows escuro o Automático pinta com os mesmos tokens do Escuro, e com o Windows claro com os do
      Claro, com o visual Mac ligado e desligado. A conta compara o valor que cada propriedade do <html> tem de fato (testes/cascata.js
      aplica as folhas na ordem do index.html, com a especificidade de cada seletor): qualquer propriedade diferente reprova, e por isso
      um apelido que ganhe de uma regra que o tema fixo não ganha (o selo de [data-tema="automatico"][data-mac-luz] pesa mais que
      [data-tema="claro"]) também reprova. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ler } = require('../testes/contraste');
const { estado, efetivo, resolver, dessemelhantes } = require('../testes/cascata');
const STYLE = ler('style.css'), UI = ler('cockpit-ui.css'), MAC = ler('visual-mac.css');
const APP = ler('app.js'), VMAC_JS = ler('visual-mac.js'), ANIM = ler('cockpit-anim.css');

/* ---------- a conta ---------- */
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// cor [r, g, b, alfa] de um valor "#rrggbb", "#rrggbbaa", "rgb(...)" ou "rgba(...)"
function cor(valor, de) {
  const v = String(valor).trim();
  let p = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(v);
  if (p) return [parseInt(p[1], 16), parseInt(p[2], 16), parseInt(p[3], 16), p[4] ? parseInt(p[4], 16) / 255 : 1];
  p = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  assert.ok(p, de + ' num formato que a conta não lê: ' + v);
  return [+p[1], +p[2], +p[3], p[4] === undefined ? 1 : +p[4]];
}
// a cor c (com alfa) pintada sobre um fundo opaco [r, g, b]
const sobre = ([r, g, b, a], f) => [r * a + f[0] * (1 - a), g * a + f[1] * (1 - a), b * a + f[2] * (1 - a)];
const opaca = (c, de) => { assert.equal(c[3], 1, de + ' tem de ser opaca'); return c.slice(0, 3); };
// assert.match despeja o arquivo CSS inteiro quando falha: aqui a mensagem é curta
const tem = (texto, re, onde) => assert.ok(re.test(texto), 'não achei: ' + onde + ' — ' + re);
const fmt = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const hexLongo = (h) => { const v = String(h).trim().toLowerCase(); return /^#[0-9a-f]{3}$/.test(v) ? '#' + [...v.slice(1)].map((x) => x + x).join('') : v; };

/* ---------- os 7 modos: o estado do <html> de cada um (tema, a luz que o visual-mac.js põe nele, visual Mac ligado ou não) ---------- */
const MODOS = {
  escuro: { luz: 'escuro', tema: 'escuro' },
  azul: { luz: 'escuro', tema: 'azul' },
  claro: { luz: 'claro', tema: 'claro' },
  jornal: { luz: 'claro', tema: 'jornal' },
  'automático claro': { luz: 'claro', tema: 'automatico', fixo: 'claro' },
  'automático escuro': { luz: 'escuro', tema: 'automatico', fixo: 'escuro' },
};
const ESCUROS = ['escuro', 'azul', 'automático escuro'];
const guardados = new Map();
function mapa(modo, mac) {
  const chave = modo + '|' + mac;
  if (!guardados.has(chave)) guardados.set(chave, efetivo(estado(MODOS[modo].tema, MODOS[modo].luz, mac)));
  return guardados.get(chave);
}
// o valor de um token num modo, como cor: o que o <html> vale de fato (o bloco do tema, o do visual Mac, quem pesa mais)
function token(modo, nome, macLigado) {
  const m = mapa(modo, macLigado), d = m.get(nome);
  assert.ok(d, modo + (macLigado ? ' (visual Mac)' : '') + ': falta ' + nome);
  return cor(resolver(d.valor, m), modo + ' ' + nome);
}
// o Mica é do Windows e some do alcance do CSS: a conta vale para a faixa inteira, do mais escuro ao mais claro que ele chega.
// A prévia (tools/redesenho) não tem Mica: o fundo dela é BRANCO, e foi assim que o Hugo mediu a lateral #3A3A3D do Escuro (vidro
// rgba(34,34,40,.62) sobre a película preta a 62 % sobre o branco). Nos escuros ela entra na conta como o pior caso.
const MICA = { escuro: [[0, 0, 0], [64, 64, 64]], claro: [[200, 200, 200], [255, 255, 255]] };
const PREVIA = [255, 255, 255];
// a lateral do visual Mac é vidro (--mac-glass) sobre a película da janela (--mac-window) sobre o Mica
const lateralMac = (modo, mica) => sobre(token(modo, '--mac-glass', true), sobre(token(modo, '--mac-window', true), mica));
// o que fica sob a lateral em cada estado: [nome, cor] (no visual Mac, uma por ponta do Mica)
function laterais(modo, mac) {
  if (!mac) return [['--side', opaca(token(modo, '--side', false), modo + ' --side')]];
  const micas = MICA[MODOS[modo].luz].concat(MODOS[modo].luz === 'escuro' ? [PREVIA] : []);
  return micas.map((mica) => ['vidro sobre Mica ' + fmt(mica), lateralMac(modo, mica)]);
}
const ESTADOS = [[false, 'visual Mac desligado'], [true, 'visual Mac ligado']];
const cada = (fn, modos = Object.keys(MODOS)) => { for (const modo of modos) for (const [mac, nome] of ESTADOS) fn(modo, mac, modo + ', ' + nome); };
// o texto (com alfa) sobre uma superfície opaca tem de passar do mínimo
const piso = (texto, sobreO, minimo, onde) => {
  const r = razao(sobre(texto, sobreO), sobreO);
  assert.ok(r >= minimo, onde + ' = ' + r.toFixed(2) + ':1 (mínimo ' + minimo + ')');
};

test('cada modo declara o fundo e as superfícies novas em hexadecimal opaco (--work, --side, --tab, --tab-on)', () => {
  for (const modo of Object.keys(MODOS)) for (const n of ['--work', '--side', '--tab', '--tab-on'])
    assert.match(mapa(modo, false).get(n)?.valor || '', /^#[0-9a-f]{6}$/i, modo + ': ' + n + ' tem de ser #rrggbb (cor explícita e opaca, um token por tema)');
  // o visual Mac não repinta o painel: o --raised é o mesmo com ele ligado e desligado (a conta do painel é uma só)
  for (const modo of Object.keys(MODOS)) assert.equal(mapa(modo, true).get('--raised')?.valor, mapa(modo, false).get('--raised')?.valor, modo + ': o visual Mac não redefine o --raised');
});

test('o Motti é o Azul: o nome troca em tempo de execução, então os números do Azul valem pelos dois modos', () => {
  tem(APP, /document\.documentElement\.setAttribute\('data-tema', window\.api\.temaInicial === 'motti' \? 'azul'/, 'app.js: tema inicial');
  tem(APP, /const visual = t === 'motti' \? 'azul' : \(t \|\| 'escuro'\);/, 'app.js: tema escolhido');
  tem(VMAC_JS, /const selected = theme === 'motti' \? 'azul' :/, 'visual-mac.js: tema escolhido');
});

test('a luz de cada modo é a que o visual-mac.js põe no <html> (data-mac-luz), em qualquer tema: é com ela que o Automático casa com o tema fixo', () => {
  tem(VMAC_JS, /function lightFor\(theme, dark\) \{ return theme === 'automatico' \? \(dark \? 'escuro' : 'claro'\) : \['claro', 'jornal'\]\.includes\(theme\) \? 'claro' : 'escuro'; \}/, 'visual-mac.js: a luz de cada tema');
  tem(VMAC_JS, /html\.dataset\.tema = selected;\s*html\.dataset\.macLuz = lightFor\(selected, system\.dark\);/, 'visual-mac.js: a luz vai para o <html> em todo tema, não só no Automático');
  for (const [modo, m] of Object.entries(MODOS)) {
    const esperada = m.tema === 'automatico' ? m.luz : ['claro', 'jornal'].includes(m.tema) ? 'claro' : 'escuro';
    assert.equal(m.luz, esperada, modo + ': a luz do modo na conta tem de ser a do visual-mac.js');
  }
});

cada((modo, mac, nome) => {
  test(nome + ': painel × fundo ≥ 1,20:1', () => {
    const painel = opaca(token(modo, '--raised', mac), '--raised'), fundo = opaca(token(modo, '--work', mac), '--work');
    const r = razao(painel, fundo);
    assert.ok(r >= 1.2, 'painel ' + fmt(painel) + ' sobre fundo ' + fmt(fundo) + ' = ' + r.toFixed(2) + ':1 (mínimo 1,20)');
  });

  test(nome + ': abas e lateral × fundo (1,10:1 cada nos claros; a lateral dos escuros é degrau da escada, ≥ 1,06), e a aba ativa é mais marcada que as outras', () => {
    const fundo = opaca(token(modo, '--work', mac), '--work');
    const aba = opaca(token(modo, '--tab', mac), '--tab'), ativa = opaca(token(modo, '--tab-on', mac), '--tab-on');
    assert.ok(razao(aba, fundo) >= 1.1, 'aba ' + fmt(aba) + ' sobre fundo ' + fmt(fundo) + ' = ' + razao(aba, fundo).toFixed(2) + ':1');
    assert.ok(razao(ativa, fundo) >= 1.1, 'aba ativa ' + fmt(ativa) + ' sobre fundo = ' + razao(ativa, fundo).toFixed(2) + ':1');
    assert.ok(razao(ativa, aba) >= 1.08, 'a ativa (' + fmt(ativa) + ') mal se distingue das outras (' + fmt(aba) + '): ' + razao(ativa, aba).toFixed(2) + ':1');
    const minimo = MODOS[modo].luz === 'escuro' ? 1.06 : 1.1;
    for (const [onde, lateral] of laterais(modo, mac))
      assert.ok(razao(lateral, fundo) >= minimo, 'lateral (' + onde + ') ' + fmt(lateral) + ' sobre fundo ' + fmt(fundo) + ' = ' + razao(lateral, fundo).toFixed(2) + ':1 (mínimo ' + minimo + ')');
  });

  test(nome + ': texto ≥ 4,5:1 no painel, na lateral, nas abas e direto sobre o fundo', () => {
    const fundo = opaca(token(modo, '--work', mac), '--work');
    const painel = opaca(token(modo, '--raised', mac), '--raised');
    const aba = opaca(token(modo, '--tab', mac), '--tab'), ativa = opaca(token(modo, '--tab-on', mac), '--tab-on');
    const ink = token(modo, '--ink', mac), muted = token(modo, '--ink-muted', mac), faint = token(modo, '--ink-faint', mac);
    piso(ink, painel, 4.5, 'texto principal no painel'); piso(muted, painel, 4.5, 'texto secundário no painel');
    for (const [onde, lateral] of laterais(modo, mac)) { piso(ink, lateral, 4.5, 'texto principal na lateral (' + onde + ')'); piso(muted, lateral, 4.5, 'texto secundário na lateral (' + onde + ')'); }
    piso(muted, aba, 4.5, 'nome da aba inativa'); piso(ink, ativa, 4.5, 'nome da aba ativa');
    piso(faint, aba, 3, 'ícone da pasta na aba inativa'); piso(faint, ativa, 3, 'ícone da pasta na aba ativa');
    piso(token(modo, '--focus', mac), ativa, 3, 'o traço de foco sob a aba ativa');
    // o que cai direto no fundo: o "+" de nova pasta e o "⋯" da janela. (A pílula neutra da ilha, que também mora na barra, tem a
    // superfície das abas, --tab: o 12 % de cinza dela sobre o fundo novo, mais escuro, dava 4,00:1 no Automático claro.)
    piso(muted, fundo, 4.5, 'o "+" de nova pasta e o "⋯" sobre o fundo');
    // a barra de rolagem da esteira (#panes) é a única que cai no fundo: o polegar (--control-border) pede 3:1, como nos outros fundos
    piso(token(modo, '--control-border', mac), fundo, 3, 'o polegar da barra de rolagem da esteira sobre o fundo');
  });
});

/* ---------- 1) a escada dos escuros: fundo < lateral < painel < popups e cartões ---------- */
cada((modo, mac, nome) => {
  test(nome + ': escada fundo < lateral < painel — o fundo não é preto puro, a lateral é um degrau acima dele e abaixo do painel', () => {
    const fundo = opaca(token(modo, '--work', mac), '--work'), painel = opaca(token(modo, '--raised', mac), '--raised');
    assert.notEqual(fmt(fundo), '#000000', 'o fundo é o degrau mais escuro, mas não é o preto puro (a lateral virava placa solta sobre ele)');
    assert.ok(razao(painel, fundo) >= 1.2, 'painel ' + fmt(painel) + ' × fundo ' + fmt(fundo) + ' = ' + razao(painel, fundo).toFixed(2) + ':1 (mínimo 1,20)');
    for (const [onde, lateral] of laterais(modo, mac)) {
      assert.ok(lum(fundo) < lum(lateral) && lum(lateral) < lum(painel), 'a lateral (' + onde + ') ' + fmt(lateral) + ' tem de ficar entre o fundo ' + fmt(fundo) + ' e o painel ' + fmt(painel));
      assert.ok(razao(lateral, fundo) >= 1.06, 'lateral (' + onde + ') ' + fmt(lateral) + ' × fundo ' + fmt(fundo) + ' = ' + razao(lateral, fundo).toFixed(2) + ':1 (mínimo 1,06)');
      assert.ok(razao(painel, lateral) >= 1.08, 'painel ' + fmt(painel) + ' × lateral (' + onde + ') ' + fmt(lateral) + ' = ' + razao(painel, lateral).toFixed(2) + ':1 (mínimo 1,08)');
      // o rótulo de seção da lateral ("torre", "histórico", 11 px) e o campo de busca são --ink-faint: texto de verdade
      piso(token(modo, '--ink', mac), lateral, 4.5, 'texto principal na lateral (' + onde + ')');
      piso(token(modo, '--ink-faint', mac), lateral, 4.5, 'rótulo de seção (--ink-faint) na lateral (' + onde + ')');
    }
    piso(token(modo, '--ink-faint', mac), painel, 4.5, 'texto fraco (--ink-faint) no painel');
  });

  test(nome + ': a aba inativa tem a cor do painel e a ativa é um degrau acima, com o anel de foco', () => {
    const painel = opaca(token(modo, '--raised', mac), '--raised'), aba = opaca(token(modo, '--tab', mac), '--tab'), ativa = opaca(token(modo, '--tab-on', mac), '--tab-on');
    assert.ok(razao(aba, painel) <= 1.02, 'a aba inativa ' + fmt(aba) + ' é a cor do painel ' + fmt(painel) + ' (' + razao(aba, painel).toFixed(2) + ':1)');
    assert.ok(lum(ativa) > lum(aba) && razao(ativa, aba) >= 1.08, 'a aba ativa ' + fmt(ativa) + ' é um degrau acima da inativa ' + fmt(aba) + ' (' + razao(ativa, aba).toFixed(2) + ':1)');
    assert.ok(razao(token(modo, '--focus', mac).slice(0, 3), ativa) >= 3, 'o anel de foco aparece sobre a aba ativa');
  });

  test(nome + ': popups e cartões ficam um degrau acima do painel, e o texto passa de 4,5:1 neles', () => {
    const painel = opaca(token(modo, '--raised', mac), '--raised'), alto = opaca(token(modo, '--high', mac), '--high');
    assert.ok(lum(alto) > lum(painel) && razao(alto, painel) >= 1.08, 'o degrau de cima (--high) ' + fmt(alto) + ' sobre o painel ' + fmt(painel) + ' = ' + razao(alto, painel).toFixed(2) + ':1 (mínimo 1,08)');
    const ink = token(modo, '--ink', mac), muted = token(modo, '--ink-muted', mac);
    piso(ink, alto, 4.5, 'texto principal no degrau de cima'); piso(muted, alto, 4.5, 'texto secundário no degrau de cima');
    if (!mac) return;
    // no visual Mac, o cartão (caixa de escrever, pedido de permissão, pergunta da IA, a lateral que se abre por cima) é o vidro forte
    // e o popup (paleta, troca, ajustes) é o HUD; os dois pintados sobre o painel ficam acima dele
    for (const n of ['--mac-glass-strong', '--mac-hud']) {
      const c = sobre(token(modo, n, true), painel);
      assert.ok(lum(c) > lum(painel) && razao(c, painel) >= 1.08, n + ' sobre o painel = ' + fmt(c) + ' (' + razao(c, painel).toFixed(2) + ':1 do painel, mínimo 1,08)');
      piso(ink, c, 4.5, 'texto principal em ' + n); piso(muted, c, 4.5, 'texto secundário em ' + n);
    }
  });
}, ESCUROS);

test('a película da janela nos escuros é a cor do fundo: a moldura em volta da lateral não clareia com o papel de parede', () => {
  // antes: Escuro rgba(0,0,0,.62) e Azul rgba(7,24,47,.64) sobre o Mica; um Mica claro deixava a moldura mais clara que a lateral
  // (a lateral parecia um buraco), e a do Azul já era mais clara que o fundo com o Mica típico (#202020)
  for (const modo of ESCUROS) {
    const fundo = opaca(token(modo, '--work', true), '--work');
    for (const mica of MICA.escuro) {
      const janela = sobre(token(modo, '--mac-window', true), mica);
      assert.ok(razao(janela, fundo) <= 1.04, modo + ': a janela em volta da lateral (' + fmt(janela) + ', Mica ' + fmt(mica) + ') difere do fundo (' + fmt(fundo) + ') em ' + razao(janela, fundo).toFixed(2) + ':1');
    }
  }
});

/* ---------- 2) o Automático é o tema fixo ---------- */
for (const [modo, luz, fixo] of [['automático escuro', 'escuro', 'escuro'], ['automático claro', 'claro', 'claro']]) for (const [mac, nome] of ESTADOS) {
  test(modo + ', ' + nome + ': usa exatamente os tokens do ' + fixo + ' (superfícies, bordas, texto e acentos), e as regras de tema por descendente valem para os dois', () => {
    const a = efetivo(estado('automatico', luz, mac)), f = efetivo(estado(fixo, luz, mac));
    const diferentes = [];
    for (const n of new Set([...a.keys(), ...f.keys()]))
      if (a.get(n)?.valor !== f.get(n)?.valor) diferentes.push(n + ': Automático ' + a.get(n)?.valor + ' · ' + fixo + ' ' + f.get(n)?.valor);
    assert.deepEqual(diferentes, [], 'o Automático ' + luz + ' tem de pintar igual ao ' + fixo + ' (' + diferentes.length + ' diferenças)');
    assert.deepEqual(dessemelhantes(estado('automatico', luz, mac), estado(fixo, luz, mac)), [], 'regra de tema que vale para o ' + fixo + ' e não para o Automático (ou ao contrário)');
  });
}

test('a miniatura de cada tema nos Ajustes mostra o fundo, a lateral e o painel do tema; a do Automático é meio Claro, meio Escuro', () => {
  const corpo = (re, onde) => { const m = re.exec(UI); assert.ok(m, 'falta ' + onde); return m[1]; };
  const amostra = (b, n) => { const m = new RegExp('--sample-' + n + ':\\s*(#[0-9a-fA-F]{3,6});').exec(b); assert.ok(m, 'falta --sample-' + n); return hexLongo(m[1]); };
  const blocos = {
    escuro: corpo(/\n\.ck-settings-view \.tema-bt \{([^}]*)\}/, '.tema-bt (a miniatura do Escuro é a de base)'),
    azul: corpo(/\.ck-settings-view \.tema-bt\[data-tema="azul"\] \{([^}]*)\}/, 'a miniatura do Azul'),
    claro: corpo(/\.ck-settings-view \.tema-bt\[data-tema="claro"\] \{([^}]*)\}/, 'a miniatura do Claro'),
    jornal: corpo(/\.ck-settings-view \.tema-bt\[data-tema="jornal"\] \{([^}]*)\}/, 'a miniatura do Jornal'),
  };
  for (const [modo, b] of Object.entries(blocos)) {
    const m = mapa(modo, false);
    const val = (n) => hexLongo(m.get(n).valor);
    assert.equal(amostra(b, 'canvas'), val('--work'), modo + ': a miniatura mostra o fundo (--work)');
    assert.equal(amostra(b, 'surface'), val('--side'), modo + ': a miniatura mostra a lateral (--side)');
    assert.equal(amostra(b, 'raised'), val('--raised'), modo + ': a miniatura mostra o painel (--raised)');
  }
  const auto = /\.ck-app \.tema-am\.mac-auto-am \{ background: linear-gradient\(135deg, (#[0-9a-fA-F]{6}) 0 50%, (#[0-9a-fA-F]{6}) 50% 100%\); \}/.exec(MAC);
  assert.ok(auto, 'falta a miniatura do Automático (visual-mac.css)');
  assert.equal(auto[1].toLowerCase(), hexLongo(mapa('claro', false).get('--work').valor), 'a metade clara do Automático é o fundo do Claro');
  assert.equal(auto[2].toLowerCase(), hexLongo(mapa('escuro', false).get('--work').valor), 'a metade escura do Automático é o fundo do Escuro');
});

/* ---------- as regras pintam com esses tokens ---------- */
test('as regras pintam com esses tokens: fundo no trabalho, painel em --raised, lateral e abas com superfície própria', () => {
  // fundo: a área de trabalho, a esteira, a faixa de pastas e a barra da janela (visual Mac ligado ou não)
  tem(UI, /\.ck-app \.ck-work \{[^}]*background: var\(--work\);/, '.ck-app .ck-work pinta o fundo');
  tem(UI, /\.ck-app #panes \{[^}]*background: var\(--work\);/, '.ck-app #panes pinta o fundo');
  tem(UI, /\n\.ck-place-bar \{[^}]*background-color: var\(--work\);[^}]*linear-gradient\(var\(--work\), var\(--work\)\)/, 'a faixa de pastas tem o fundo, e a tampa da pista de rolagem também');
  tem(MAC, /\n\.ck-app \.mac-window-bar \{[^}]*background: var\(--work\);/, 'a barra da janela tem o fundo');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.ck-work \{ background: var\(--work\); \}/, 'no visual Mac o trabalho deixa de ser transparente e tem o fundo explícito');
  // painel: --raised nos dois estados (o visual Mac já era; o desligado era --canvas, a mesma cor do fundo)
  tem(UI, /\n\.ck-app \.pane \{[^}]*background: var\(--raised\);/, 'o painel');
  tem(UI, /\n\.ck-app \.pane-hd \{[^}]*background: var\(--raised\);/, 'o cabeçalho do painel');
  tem(UI, /\n\.ck-app \.pane-chat \{[^}]*background: var\(--raised\);/, 'a conversa do painel');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.pane \{[^}]*background: var\(--raised\);/, 'o cartão do visual Mac');
  // lateral
  tem(UI, /\n\.ck-navigator \{[^}]*background: var\(--side\);/, 'a lateral sem o visual Mac');
  /* abas de pasta. Leva 5h (abas do Safari): a superfície das inativas passou a ser a TRILHA (--hover sobre o fundo; a leva 5e dava um
     --tab a cada pastilha), elas ficam planas, e a ativa LEVANTA em --tab-on com sombra leve (antes: --tab-on e o traço de foco embaixo).
     test/abas-safari.test.js faz a conta de contraste da ativa e do texto sobre a trilha. */
  tem(UI, /\n\.ck-place-trilha \{[^}]*background: var\(--hover\);/, 'a trilha: a cápsula das abas');
  tem(UI, /\n\.ck-place-bar \.ck-group-head \{[^}]*background: transparent;/, 'a aba inativa: plana, no tom da trilha');
  tem(UI, /\n\.ck-place-bar \.ck-place-only\[data-current="true"\] \.ck-group-head \{[^}]*background: var\(--tab-on, var\(--raised\)\);[^}]*box-shadow: 0 1px 3px/, 'a aba ativa: superfície mais forte e sombra leve');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.ck-place-bar \.ck-group-head \{[^}]*background: transparent;/, 'a aba no visual Mac');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.ck-place-bar \[data-current="true"\] \.ck-group-head \{[^}]*background: var\(--tab-on, var\(--raised\)\);/, 'a aba ativa no visual Mac');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.mac-ilha:not\(\.aberta\):not\(\[data-level="warning"\]\):not\(\[data-level="error"\]\) \.mac-ilha-corpo \{[^}]*background: var\(--tab\);/, 'a pílula neutra da ilha tem a superfície das abas');
  // nada solto com a cor velha: o vão entre colunas, a pista da barra de rolagem e o degradê de "mais colunas"
  tem(STYLE, /\n\.pane-split\{[^}]*border-left:2px solid var\(--work,var\(--bg\)\);border-right:2px solid var\(--work,var\(--bg\)\)\}/, 'o vão entre colunas mostra o fundo');
  tem(UI, /\.ck-app #panes::-webkit-scrollbar-thumb \{[^}]*border: 3px solid transparent;/, 'o anel do polegar não aparece como moldura de outra cor');
  tem(UI, /\n\.ck-app \.ck-work\[data-mais-direita\]::after \{[^}]*linear-gradient\(to right, transparent, var\(--raised\)\)/, 'o degradê acaba na cor do painel');
});

test('a viagem do destaque da pasta passa POR CIMA do fundo das abas e POR BAIXO do nome (as abas inativas agora têm fundo opaco)', () => {
  tem(ANIM, /\.mv-aba-fantasma \{[^}]*z-index: 0;/, 'o fantasma fica no nível 0 (acima do fundo das abas)');
  assert.ok(!/\.mv-aba-fantasma \{[^}]*z-index: -1;/.test(ANIM), 'o fantasma no nível -1 ficaria escondido atrás do fundo opaco das abas');
  tem(UI, /\.ck-place-bar \.ck-group-head > :is\(\.ck-group-icon, \.ck-group-name\) \{[^}]*position: relative;[^}]*z-index: 1;/, 'o ícone e o nome ficam no nível 1 (acima do fantasma)');
});

test('a película da janela nos temas claros é a cor do fundo, e a cor dos botões da janela segue o fundo', () => {
  for (const modo of Object.keys(MODOS)) {
    if (MODOS[modo].luz !== 'claro') continue;
    const fundo = opaca(token(modo, '--work', true), '--work');
    for (const mica of MICA.claro) {
      const janela = sobre(token(modo, '--mac-window', true), mica);
      assert.ok(razao(janela, fundo) <= 1.04, modo + ': a janela em volta da lateral (' + fmt(janela) + ') difere do fundo (' + fmt(fundo) + ') em ' + razao(janela, fundo).toFixed(2) + ':1');
    }
  }
  // o Windows pinta os botões de minimizar/maximizar/fechar com a cor que o renderer manda: tem de ser a da barra (o fundo)
  tem(VMAC_JS, /call\('setWindowTheme', \{ color: style\.getPropertyValue\('--work'\)\.trim\(\)/, 'visual-mac.js manda o --work aos botões da janela');
});
