'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', 'src', 'renderer', 'cockpit-usage.js');
const Usage = require(ARQUIVO);
const { normalize: normalizeAccount } = require('../src/cockpit-accounts');
const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-19T12:00:00Z');

test('publica a mesma API em CommonJS e no navegador', () => {
  assert.deepEqual(Object.keys(Usage).sort(), ['accountSummary', 'contextSummary', 'renderAccountMeter']);
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox);
  assert.equal(typeof sandbox.window.CockpitUsage.accountSummary, 'function');
});

test('limite de atenção inclui 80 e normaliza somente números finitos entre 0 e 100', () => {
  for (const [valor, esperado, atencao] of [
    [0, 0, false], [79, 79, false], [80, 80, true], [89, 89, true],
    [90, 90, true], [95, 95, true], [100, 100, true], [180, 100, true], [-4, 0, false],
  ]) {
    const s = Usage.accountSummary('claude', { sessao: { pct: valor } }, { now: NOW });
    assert.equal(s.available, true, String(valor));
    assert.equal(s.pct, esperado, String(valor));
    assert.equal(s.attention, atencao, String(valor));
  }
  for (const valor of [NaN, Infinity, -Infinity, '80']) {
    const s = Usage.accountSummary('claude', { sessao: { pct: valor } }, { now: NOW });
    assert.equal(s.available, false, String(valor));
    assert.equal(s.pct, null, String(valor));
  }
});

test('atenção de uma janela não some quando outra janela vence o arco', () => {
  const s = Usage.accountSummary('claude', {
    sessao: { pct: 79, reseta: NOW + 5 * H },
    semana: { pct: 80, reseta: NOW + 34 * H },
  }, { now: NOW });
  assert.equal(s.pct, 79, 'a sessão é o arco mais apertado pelo ritmo');
  assert.equal(s.windows.find((w) => w.id === 'semana').attention, true);
  assert.equal(s.attention, true, 'o alerta agrega todas as janelas');
  assert.match(s.title, /sessão 79%/i);
  assert.match(s.title, /semana 80%/i);
  assert.equal((s.title.match(/zera/g) || []).length, 2);
});

test('reset ausente ou inválido conserva o uso sem inventar ritmo nem projeção', () => {
  for (const reset of [undefined, '', 'não-é-data', NaN, Infinity, NOW - 1]) {
    const s = Usage.accountSummary('claude', { sessao: { pct: 60, reseta: reset } }, { now: NOW });
    assert.equal(s.windows[0].resetAt, null);
    assert.equal(s.windows[0].elapsedPct, null);
    assert.equal(s.windows[0].ahead, false);
    assert.equal(s.projection, null);
  }
});

test('epoch finito fora do intervalo de Date não derruba o resumo', () => {
  const s = Usage.accountSummary('codex', {
    sessao: { pct: 30, reseta: Number.MAX_VALUE, mins: 60 },
  }, { now: NOW });
  assert.equal(s.available, true);
  assert.equal(s.pct, 30);
  assert.equal(s.windows[0].resetAt, null);
  assert.equal(s.windows[0].elapsedPct, null);
  assert.match(s.title, /reset indisponível/);
});

test('Claude usa durações conhecidas e Codex só calcula ritmo com minutos informados', () => {
  const claude = Usage.accountSummary('claude', {
    sessao: { pct: 60, reseta: NOW + 4 * H },
    semana: { pct: 10, reseta: NOW + 6 * 24 * H },
  }, { now: NOW });
  assert.equal(claude.windows[0].durationMs, 5 * H);
  assert.equal(claude.windows[0].elapsedPct, 20);
  assert.equal(claude.windows[0].ahead, true);
  assert.deepEqual(claude.projection, {
    estimated: true,
    windowId: 'sessao',
    at: Date.parse('2026-09-19T12:40:00Z'),
  });

  const semDuracao = Usage.accountSummary('codex', {
    sessao: { pct: 60, reseta: NOW + 4 * H },
  }, { now: NOW });
  assert.equal(semDuracao.windows[0].durationMs, null);
  assert.equal(semDuracao.windows[0].elapsedPct, null);
  assert.equal(semDuracao.projection, null);

  const codex = Usage.accountSummary('codex', {
    sessao: { pct: 60, reseta: NOW + 90 * 60000, mins: 120 },
  }, { now: NOW });
  assert.equal(codex.windows[0].durationMs, 120 * 60000);
  assert.equal(codex.windows[0].elapsedPct, 25);
  assert.equal(codex.windows[0].ahead, true);
});

test('aceita reset ISO e epoch em segundos ou milissegundos', () => {
  const iso = Usage.accountSummary('codex', { sessao: { pct: 10, reseta: '2026-09-19T13:00:00Z', mins: 120 } }, { now: NOW });
  const seg = Usage.accountSummary('codex', { sessao: { pct: 10, reseta: (NOW + H) / 1000, mins: 120 } }, { now: NOW });
  const ms = Usage.accountSummary('codex', { sessao: { pct: 10, reseta: NOW + H, mins: 120 } }, { now: NOW });
  assert.equal(iso.windows[0].resetAt, NOW + H);
  assert.equal(seg.windows[0].resetAt, NOW + H);
  assert.equal(ms.windows[0].resetAt, NOW + H);
});

test('projeção exige amostra mínima e se identifica como estimativa', () => {
  const curta = Usage.accountSummary('codex', {
    sessao: { pct: 10, reseta: NOW + 59900, mins: 1 },
  }, { now: NOW });
  assert.equal(curta.windows[0].ahead, true);
  assert.equal(curta.projection, null, '100 ms de histórico não sustentam projeção');

  const suficiente = Usage.accountSummary('codex', {
    sessao: { pct: 60, reseta: NOW + 9 * 60000, mins: 10 },
  }, { now: NOW });
  assert.equal(suficiente.projection.estimated, true);
  assert.ok(suficiente.projection.at > NOW);
});

test('crédito ilimitado ou teto inválido nunca vira porcentagem', () => {
  const ilimitado = Usage.accountSummary('codex', { extra: { ligado: true, usado: 30, teto: -1, moeda: 'créditos' } }, { now: NOW });
  assert.equal(ilimitado.credits.unlimited, true);
  assert.equal(ilimitado.credits.limit, null);
  assert.equal(ilimitado.credits.pct, null);

  const limitado = Usage.accountSummary('claude', { extra: { ligado: true, usado: 25, teto: 100, moeda: 'USD' } }, { now: NOW });
  assert.equal(limitado.credits.pct, 25);
  assert.equal(limitado.credits.unlimited, false);
});

test('integra saldo e ilimitado no formato real do adaptador novo', () => {
  const data = normalizeAccount('codex', {
    rate_limit: {},
    credits: { has_credits: true, unlimited: true, balance: 123 },
  });
  assert.deepEqual(data.extra, {
    ligado: true, ilimitado: true, saldo: 123, moeda: 'créditos',
  });
  const credits = Usage.accountSummary('codex', data, { now: NOW }).credits;
  assert.equal(credits.enabled, true);
  assert.equal(credits.unlimited, true);
  assert.equal(credits.balance, 123);
  assert.equal(credits.used, null);
  assert.equal(credits.limit, null);
  assert.equal(credits.pct, null);
});

test('marca consulta antiga sem misturar o local da conta', () => {
  const pc = Usage.accountSummary('claude', { sessao: { pct: 20 }, updatedAt: NOW - 60001 }, {
    now: NOW, staleAfterMs: 60000, where: 'Este PC',
  });
  const servidor = Usage.accountSummary('claude', { sessao: { pct: 70 }, updatedAt: NOW }, {
    now: NOW, staleAfterMs: 60000, where: 'VPS produção',
  });
  assert.equal(pc.stale, true);
  assert.equal(servidor.stale, false);
  assert.match(pc.title, /Este PC/);
  assert.doesNotMatch(pc.title, /VPS produção/);
  assert.match(servidor.title, /VPS produção/);
});

test('HTML escapa metadados, mantém logo confiável e sempre informa data-motor', () => {
  const summary = Usage.accountSummary('claude\" onmouseover=\"roubar()', {
    sessao: { pct: 82, reseta: NOW + H },
  }, { now: NOW, where: 'PC \"principal\" <script>' });
  const logo = '<svg data-logo="interno"></svg>';
  const html = Usage.renderAccountMeter(summary, {
    engine: 'claude\" data-x=\"injetado', logoHtml: logo, server: true, withNumber: true,
  });
  assert.match(html, /data-motor="claude&quot; data-x=&quot;injetado"/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /" onmouseover="/);
  assert.ok(html.includes(logo));
  assert.match(html, /ck-server/);
  assert.match(html, /82<small>%<\/small>/);

  const vazio = Usage.renderAccountMeter(Usage.accountSummary('gemini', {}, { now: NOW }), { engine: 'gemini' });
  assert.match(vazio, /data-motor="gemini"/);
  assert.match(vazio, /ck-dial off/);
});

test('marcador usa a janela realmente escolhida quando percentuais empatam', () => {
  const summary = Usage.accountSummary('claude', {
    sessao: { pct: 60, reseta: NOW + H },
    semana: { pct: 60, reseta: NOW + 6 * 24 * H },
  }, { now: NOW });
  assert.equal(summary.windows[0].elapsedPct, 80);
  assert.equal(summary.windows[1].elapsedPct, 14);
  const html = Usage.renderAccountMeter(summary, { engine: 'claude' });
  assert.match(html, /<line class="ck-tick" x1="4\.48" y1="15\.20"/);
  assert.doesNotMatch(html, /x1="23\.48" y1="12\.50"/);
});

test('contexto diferencia zero de indisponível e limita a porcentagem visual', () => {
  assert.deepEqual(Usage.contextSummary(0, 200000), {
    available: true, pct: 0, tokens: 0, windowSize: 200000, attention: false,
  });
  assert.equal(Usage.contextSummary(undefined, 200000).available, false);
  assert.equal(Usage.contextSummary(10, 0).available, false);
  assert.equal(Usage.contextSummary(NaN, 200000).available, false);
  assert.equal(Usage.contextSummary(300000, 200000).pct, 100);
  assert.equal(Usage.contextSummary(160000, 200000).attention, true);
});
