'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lightFor, readUsage, ringSVG, onAccent } = require('../src/renderer/visual-mac');
const Usage = require('../src/renderer/cockpit-usage');
const { lerFonte, pegarBloco } = require('../testes/raiz');

test('Cor de destaque clara do sistema mantém texto legível', () => {
  assert.equal(onAccent('#ffff00'), '#000000');
  assert.equal(onAccent('#eeeeee'), '#000000');
  assert.equal(onAccent('#003399'), '#ffffff');
  assert.equal(onAccent('invalid'), '#ffffff');
});

test('Automático acompanha sistema; as quatro cores continuam independentes', () => {
  assert.equal(lightFor('automatico', true), 'escuro');
  assert.equal(lightFor('automatico', false), 'claro');
  assert.equal(lightFor('jornal', true), 'claro');
  assert.equal(lightFor('claro', true), 'claro');
  assert.equal(lightFor('azul', false), 'escuro');
  assert.equal(lightFor('escuro', false), 'escuro');
});
test('Anéis distinguem zero de dados indisponíveis e conservam as duas janelas', () => {
  assert.deepEqual(readUsage('Claude · Este PC: sessão 0% · zera amanhã; semana 72.5% · zera domingo'), {sessao:0, semana:72.5});
  assert.deepEqual(readUsage('Codex: sessão 93,2%'), {sessao:93.2, semana:null});
  assert.deepEqual(readUsage('Gemini: sem dados de limite'), {sessao:null, semana:null});
  assert.match(ringSVG(readUsage('sessão 0%'), 'claude'), /stroke-dasharray="0 100"/);
  assert.doesNotMatch(ringSVG(readUsage('sem dados'), 'grok'), /stroke-dasharray/);
});
test('SVG dos anéis não aceita conteúdo arbitrário do nome do motor', () => {
  const svg = ringSVG({sessao:90,semana:45}, '\"><script>oops</script>');
  assert.doesNotMatch(svg, /<script>|oops/);
  assert.match(svg, /anel-5h quente/);
  assert.doesNotMatch(svg, /anel-semana quente/);
});

/* ---- Task 16 (UI 5.1): o logo do motor volta ao centro dos anéis de limite ---- */
const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-19T12:00:00Z'); // sábado

/* LOGO e svgMotor de verdade, tirados do app.js (mesmo recorte do renderer-logos.test.js) */
function motorReal() {
  const app = lerFonte('renderer', 'app.js');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('const LOGO = {'), app.indexOf('const ICONES')).replace('const LOGO', 'var LOGO'), ctx);
  const i = app.indexOf('const svgMotor = ');
  vm.runInContext(app.slice(i, app.indexOf('\n', i)).replace(/^const /, 'var '), ctx);
  return ctx;
}
/* O que o refreshMeters faz com um botão de conta: pega o título e o logo que o mostrador
   original (renderAccountMeter) já trouxe e desenha o anel */
function anelDoMostrador(motor, engine, dados) {
  const resumo = Usage.accountSummary(engine, dados, { now: NOW, timeZone: 'UTC' });
  const html = Usage.renderAccountMeter(resumo, { engine, logoHtml: motor.svgMotor(engine), withNumber: true });
  const titulo = /aria-label="([^"]*)"/.exec(html)[1];
  const logo = /<span class="ck-logo">(.*?)<\/span>/.exec(html)[1];
  return { titulo, svg: ringSVG(readUsage(titulo), engine, logo) };
}

test('Anéis leem o hover novo (janela de 5 h / semana) e continuam lendo o antigo', () => {
  assert.deepEqual(readUsage('Claude · janela de 5 h: 42 % (zera 14:00) · semana: 18 % (zera seg)'), {sessao:42, semana:18});
  assert.deepEqual(readUsage('Codex · Este PC · janela de 5 h: 72,5 % (zera 15:00) · dados desatualizados'), {sessao:72.5, semana:null});
  assert.deepEqual(readUsage('Claude · janela de 90 min: 0 % (zera 12:09) · semana: 100 % (reset indisponível)'), {sessao:0, semana:100});
  assert.deepEqual(readUsage('Codex · sessão: 60 % (zera 16:00)'), {sessao:60, semana:null});
  assert.deepEqual(readUsage('Claude · Este PC: sem dados de limite'), {sessao:null, semana:null});
});

test('Cada anel leva o logo do motor no furo do anel de dentro, dentro do mesmo SVG', () => {
  const motor = motorReal();
  const svg = ringSVG({ sessao: 42, semana: 18 }, 'claude', motor.svgMotor('claude'));
  assert.ok(svg.includes('<path d="' + motor.LOGO.claude + '"/>'), 'o logo do Claude não está no anel');
  const logo = /<svg class="mac-logo" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 24 24">/.exec(svg);
  assert.ok(logo, 'sem <svg class="mac-logo"> dentro do anel');
  const [x, y, w, h] = logo.slice(1).map(Number);
  assert.equal(w, 10, 'o logo tem ~10 px (UI 5.1)');
  assert.equal(h, w);
  assert.deepEqual([x + w / 2, y + h / 2], [16, 16], 'centrado nos anéis (centro 16, 16)');
  const dentro = /<circle class="trilho-semana" cx="16" cy="16" r="([\d.]+)" fill="none" stroke-width="([\d.]+)"/.exec(svg);
  const furo = Number(dentro[1]) - Number(dentro[2]) / 2; // 8,8 - 3,6 / 2 = 7 de raio livre
  assert.ok(w / 2 + 1 <= furo, 'o logo (raio ' + w / 2 + ') precisa de 1 px de folga até o traço: furo de ' + furo);
  // fecha por último, dentro do <svg> dos anéis e por cima dos trilhos e dos arcos
  assert.ok(svg.startsWith('<svg class="mac-aneis"'));
  assert.ok(svg.endsWith('</svg></svg>'));
  assert.ok(svg.indexOf('class="mac-logo"') > svg.lastIndexOf('<circle'));
});

test('Com 2 motores logados há 2 anéis, cada um com o logo do próprio motor', () => {
  const motor = motorReal();
  const claude = anelDoMostrador(motor, 'claude', { sessao: { pct: 42, reseta: NOW + 2 * H }, semana: { pct: 18, reseta: NOW + 48 * H } });
  const codex = anelDoMostrador(motor, 'codex', { sessao: { pct: 7, mins: 300, reseta: NOW + H }, semana: { pct: 55, mins: 10080, reseta: NOW + 72 * H } });
  for (const [anel, proprio, outro] of [[claude, 'claude', 'codex'], [codex, 'codex', 'claude']]) {
    assert.match(anel.svg, new RegExp('^<svg class="mac-aneis" data-motor="' + proprio + '" '));
    assert.equal((anel.svg.match(/<svg /g) || []).length, 2, 'o anel e, dentro dele, o logo');
    assert.ok(anel.svg.includes('<path d="' + motor.LOGO[proprio] + '"/>'), 'sem o logo do ' + proprio);
    assert.ok(!anel.svg.includes(motor.LOGO[outro]), 'logo do ' + outro + ' no anel do ' + proprio);
  }
  // o hover e os arcos saem do mesmo dado
  assert.equal(claude.titulo, 'Claude · janela de 5 h: 42 % (zera 14:00) · semana: 18 % (zera seg)');
  assert.match(claude.svg, /class="anel-5h" [^>]*stroke-dasharray="42 100"/);
  assert.match(claude.svg, /class="anel-semana" [^>]*stroke-dasharray="18 100"/);
  assert.equal(codex.titulo, 'Codex · janela de 5 h: 7 % (zera 13:00) · semana: 55 % (zera ter)');
  assert.match(codex.svg, /class="anel-5h" [^>]*stroke-dasharray="7 100"/);
  assert.match(codex.svg, /class="anel-semana" [^>]*stroke-dasharray="55 100"/);
});

test('Anel só aceita caminho de desenho como logo, nunca marcação de fora', () => {
  const sujo = '<svg><path d="M0 0z" onload="oops()"/><path d="M0 0&quot;><script>oops</script>"/><path d=\'M1 1\'/></svg>';
  const svg = ringSVG({ sessao: 1, semana: 1 }, 'claude', sujo);
  assert.doesNotMatch(svg, /<script>|oops|onload|&quot;/);
  assert.equal((svg.match(/<path d="/g) || []).length, 1, 'só o caminho limpo entra');
  assert.match(svg, /<path d="M0 0z"\/>/);
});

test('Sem logo no mostrador o anel sai como antes', () => {
  for (const logo of [undefined, '', '<svg viewBox="0 0 24 24" class="logo-motor"></svg>']) {
    assert.doesNotMatch(ringSVG({ sessao: 10, semana: 20 }, 'grok', logo), /mac-logo/);
  }
});

test('refreshMeters entrega ao anel o logo que o mostrador original (.ck-logo) já trouxe', () => {
  const bloco = pegarBloco(lerFonte('renderer', 'visual-mac.js'), 'function refreshMeters(', 'refreshMeters');
  assert.match(bloco, /ringSVG\(usage, engine, button\.querySelector\('\.ck-logo'\)\?\.innerHTML\)/);
});

test('CSS do logo do anel: nunca escondido e na cor do tema, igual nos 3 modos de cor e em todos os temas', () => {
  const css = lerFonte('renderer', 'visual-mac.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.mac-logo\b/.test(m[1]));
  assert.ok(regras.length > 0, 'falta a regra do .mac-logo no visual-mac.css');
  for (const [, seletor, corpo] of regras) {
    assert.doesNotMatch(corpo, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\s*[;}]|fill\s*:\s*(none|transparent)/, 'esconde o logo: ' + seletor.trim());
    assert.doesNotMatch(seletor, /data-mac-aneis|data-mac-luz|data-tema/, 'o logo vale em todo modo e tema: ' + seletor.trim());
  }
  const token = regras.map(([, , corpo]) => /(?:^|[;\s])fill\s*:\s*var\((--[\w-]+)\)/.exec(corpo)).find(Boolean)?.[1];
  assert.equal(token, '--ink-muted', 'o logo usa a cor de texto secundário do tema, não a dos anéis');
  // o token existe nos 4 temas do tokens.css e nos dois lados do Automático. Leva 5e, 2a rodada: o Automático não tem mais bloco
  // próprio no visual-mac.css; o seletor dele divide a lista de seletores do Escuro e do Claro no tokens.css, e tem o token por isso.
  const tokens = lerFonte('renderer', 'tokens.css');
  for (const tema of ['escuro', 'azul', 'claro', 'jornal']) {
    const bloco = new RegExp('data-tema="' + tema + '"\\]\\s*\\{([^}]*)\\}').exec(tokens);
    assert.ok(bloco && bloco[1].includes(token + ':'), 'tema ' + tema + ' sem ' + token);
  }
  for (const luz of ['claro', 'escuro']) {
    const bloco = new RegExp('html\\[data-tema="automatico"\\]\\[data-mac-luz="' + luz + '"\\],\\s*(?::root, )?html\\[data-tema="' + luz + '"\\]\\s*\\{([^}]*)\\}').exec(tokens);
    assert.ok(bloco && bloco[1].includes(token + ':'), 'Automático ' + luz + ' sem ' + token + ' (ele divide o bloco do ' + luz + ')');
  }
});
