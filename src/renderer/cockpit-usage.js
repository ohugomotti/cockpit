(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CockpitUsage = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MINUTE = 60000;
  const CLAUDE_DURATION = { sessao: 5 * 60 * MINUTE, semana: 7 * 24 * 60 * MINUTE };
  const ENGINE_NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', fable: 'Fable', acp: 'ACP' };
  const ARC = 'M5.515 22.485A12 12 0 1 1 22.485 22.485';

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function nowValue(now) {
    const value = typeof now === 'function' ? now() : now;
    return finite(value) ? value : Date.now();
  }

  function epoch(value) {
    let result = null;
    if (finite(value)) {
      if (value <= 0) return null;
      result = value < 1e12 ? value * 1000 : value;
    } else {
      if (typeof value !== 'string' || !value.trim()) return null;
      result = Date.parse(value);
    }
    return finite(result) && Number.isFinite(new Date(result).getTime()) ? result : null;
  }

  function durationFor(engine, id, raw) {
    if (finite(raw && raw.mins) && raw.mins > 0) return raw.mins * MINUTE;
    return String(engine).toLowerCase() === 'claude' ? CLAUDE_DURATION[id] : null;
  }

  function normalizeWindow(engine, id, raw, now) {
    if (!raw || !finite(raw.pct)) return null;
    const pct = clamp(raw.pct, 0, 100);
    const parsedReset = epoch(raw.reseta != null ? raw.reseta : raw.resetAt);
    const resetAt = parsedReset != null && parsedReset > now ? parsedReset : null;
    const durationMs = durationFor(engine, id, raw);
    let elapsedPct = null;
    let elapsedMs = null;
    let ahead = false;
    if (resetAt != null && finite(durationMs) && durationMs > 0) {
      const startAt = resetAt - durationMs;
      const elapsed = now - startAt;
      if (elapsed >= 0 && elapsed <= durationMs) {
        elapsedMs = elapsed;
        const exactPct = elapsed / durationMs * 100;
        elapsedPct = Math.round(clamp(exactPct, 0, 100));
        ahead = pct > exactPct;
      }
    }
    return {
      id,
      pct,
      resetAt,
      durationMs: finite(durationMs) ? durationMs : null,
      elapsedPct,
      ahead,
      attention: pct >= 80 || ahead,
      _elapsedMs: elapsedMs,
    };
  }

  function projectionFor(windows, now) {
    const candidates = windows.filter((window) => window.ahead && window.pct > 0
      && finite(window._elapsedMs) && window._elapsedMs >= MINUTE
      && finite(window.durationMs) && finite(window.resetAt));
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.pct - b.elapsedPct) - (a.pct - a.elapsedPct));
    const window = candidates[0];
    const startAt = window.resetAt - window.durationMs;
    const at = Math.round(startAt + window._elapsedMs * 100 / window.pct);
    if (!finite(at) || at <= now || at >= window.resetAt) return null;
    return { estimated: true, windowId: window.id, at };
  }

  function windowScore(window) {
    return window.pct + (window.elapsedPct == null ? 0 : Math.max(0, window.pct - window.elapsedPct));
  }

  function chooseWindow(windows) {
    return windows.slice().sort((a, b) => windowScore(b) - windowScore(a))[0] || null;
  }

  function creditsSummary(extra) {
    if (!extra || typeof extra !== 'object') return null;
    const used = finite(extra.usado) && extra.usado >= 0 ? extra.usado : null;
    const rawLimit = extra.teto;
    const unlimited = extra.unlimited === true || extra.ilimitado === true || (finite(rawLimit) && rawLimit < 0);
    const limit = !unlimited && finite(rawLimit) && rawLimit >= 0 ? rawLimit : null;
    const balance = finite(extra.saldo) ? extra.saldo : null;
    const pct = used != null && limit != null && limit > 0 ? clamp(used / limit * 100, 0, 100) : null;
    return {
      enabled: extra.ligado === true,
      used,
      balance,
      limit,
      unlimited,
      pct,
      currency: extra.moeda == null ? '' : String(extra.moeda),
    };
  }

  function resetText(value) {
    if (!finite(value)) return 'reset indisponível';
    return 'zera ' + new Date(value).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  }

  function titleFor(engine, where, windows, stale) {
    const name = ENGINE_NAMES[String(engine).toLowerCase()] || String(engine || 'Motor');
    const place = where ? ' · ' + String(where) : '';
    if (!windows.length) return name + place + ': sem dados de limite' + (stale ? ' · dados desatualizados' : '');
    const labels = { sessao: 'sessão', semana: 'semana' };
    const parts = windows.map((window) => labels[window.id] + ' ' + window.pct + '% · ' + resetText(window.resetAt));
    return name + place + ': ' + parts.join('; ') + (stale ? ' · dados desatualizados' : '');
  }

  function accountSummary(engine, data, opts) {
    data = data && typeof data === 'object' ? data : {};
    opts = opts && typeof opts === 'object' ? opts : {};
    const now = nowValue(opts.now);
    const windows = ['sessao', 'semana']
      .map((id) => normalizeWindow(engine, id, data[id], now))
      .filter(Boolean);
    const chosen = chooseWindow(windows);
    const stamp = epoch(data.updatedAt != null ? data.updatedAt
      : data.fetchedAt != null ? data.fetchedAt
        : data.atualizadaEm != null ? data.atualizadaEm : data.timestamp);
    const staleAfterMs = finite(opts.staleAfterMs) && opts.staleAfterMs >= 0 ? opts.staleAfterMs : null;
    const stale = stamp != null && staleAfterMs != null && now - stamp > staleAfterMs;
    const projection = projectionFor(windows, now);
    const publicWindows = windows.map(({ _elapsedMs, ...window }) => window);
    return {
      available: windows.length > 0,
      pct: chosen ? chosen.pct : null,
      attention: windows.some((window) => window.attention),
      title: titleFor(engine, opts.where, publicWindows, stale),
      windows: publicWindows,
      projection,
      credits: creditsSummary(data.extra || data.credits),
      stale,
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pointOnArc(radius, fraction) {
    const angle = (135 + 270 * clamp(fraction, 0, 1)) * Math.PI / 180;
    return [14 + radius * Math.cos(angle), 14 + radius * Math.sin(angle)];
  }

  function renderAccountMeter(summary, opts) {
    summary = summary && typeof summary === 'object' ? summary : accountSummary('', {});
    opts = opts && typeof opts === 'object' ? opts : {};
    const engine = escapeHtml(opts.engine == null ? '' : opts.engine);
    const title = escapeHtml(summary.title || 'Sem dados de limite');
    const available = summary.available === true && finite(summary.pct);
    const attention = summary.attention === true;
    const chosen = available ? chooseWindow((summary.windows || []).filter((window) => window && finite(window.pct))) : null;
    const elapsed = chosen && finite(chosen.elapsedPct) ? chosen.elapsedPct : null;
    const tick = elapsed == null ? '' : (() => {
      const p1 = pointOnArc(9.6, elapsed / 100);
      const p2 = pointOnArc(14.4, elapsed / 100);
      return '<line class="ck-tick" x1="' + p1[0].toFixed(2) + '" y1="' + p1[1].toFixed(2)
        + '" x2="' + p2[0].toFixed(2) + '" y2="' + p2[1].toFixed(2) + '"/>';
    })();
    const fill = available
      ? '<path class="ck-fill" d="' + ARC + '" pathLength="100" stroke-dasharray="' + summary.pct + ' 100"/>'
      : '';
    const server = opts.server ? '<span class="ck-server" aria-hidden="true">⌁</span>' : '';
    const logo = opts.logoHtml == null ? '' : String(opts.logoHtml);
    const number = opts.withNumber && available
      ? '<span class="ck-number' + (attention ? ' hot' : '') + '">' + summary.pct + '<small>%</small></span>'
      : '';
    return '<button class="ck-acct' + (attention ? ' hot' : '') + '" type="button" data-motor="' + engine
      + '" title="' + title + '"><span class="ck-dial' + (!available ? ' off' : '') + (attention ? ' hot' : '')
      + '" role="img" aria-label="' + title + '"><svg viewBox="0 0 28 28" aria-hidden="true">'
      + '<path class="ck-bg" d="' + ARC + '" pathLength="100"/>' + fill + tick + '</svg>'
      + '<span class="ck-logo">' + logo + '</span>' + server + '</span>' + number + '</button>';
  }

  function contextSummary(tokens, windowSize) {
    const available = finite(tokens) && tokens >= 0 && finite(windowSize) && windowSize > 0;
    if (!available) return { available: false, pct: null, tokens: null, windowSize: null, attention: false };
    const pct = clamp(tokens / windowSize * 100, 0, 100);
    return { available: true, pct, tokens, windowSize, attention: pct >= 80 };
  }

  return { accountSummary, renderAccountMeter, contextSummary };
});
