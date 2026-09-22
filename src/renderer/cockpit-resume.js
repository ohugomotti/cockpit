(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CockpitResume = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MAX_DELAY = 0x7fffffff;
  const IDENTITY_FIELDS = ['paneId', 'engine', 'sessionId', 'accountKey', 'remoteKey', 'generation'];

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function parseReset(value) {
    if (finite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function copyIdentity(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Identidade de retomada ausente.');
    const copy = {};
    for (const field of IDENTITY_FIELDS) copy[field] = value[field];
    for (const field of ['paneId', 'engine', 'sessionId', 'accountKey']) {
      const item = copy[field];
      const scalar = (typeof item === 'string' && item.length > 0) || (typeof item === 'number' && Number.isFinite(item));
      if (!scalar) throw new TypeError('Identidade de retomada inválida: ' + field + '.');
    }
    if (!finite(copy.generation)) throw new TypeError('Identidade de retomada inválida: generation.');
    if (copy.remoteKey != null && !((typeof copy.remoteKey === 'string')
      || (typeof copy.remoteKey === 'number' && Number.isFinite(copy.remoteKey)))) {
      throw new TypeError('Identidade de retomada inválida: remoteKey.');
    }
    if (copy.remoteKey == null) copy.remoteKey = null;
    return Object.freeze(copy);
  }

  function errorText(error) {
    return error && error.message ? String(error.message) : String(error || 'Erro desconhecido');
  }

  function sameIdentity(a, b) {
    return IDENTITY_FIELDS.every((field) => a[field] === b[field]);
  }

  function createScheduler(options) {
    options = options && typeof options === 'object' ? options : {};
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    const onChange = typeof options.onChange === 'function' ? options.onChange : function () {};
    const onResume = typeof options.onResume === 'function' ? options.onResume : async function () {};
    const validate = typeof options.validate === 'function' ? options.validate : async function () { return true; };
    const entries = new Map();
    let disposed = false;

    function snapshot(entry) {
      if (!entry) return null;
      const result = {
        key: entry.key,
        resetAt: entry.resetAt,
        identity: { ...entry.identity },
        status: entry.status,
      };
      if (entry.reason) result.reason = entry.reason;
      if (entry.error) result.error = entry.error;
      return result;
    }

    function notify(entry) {
      try { onChange(entry.key, snapshot(entry)); } catch {}
    }

    function current(entry) {
      return !disposed && entries.get(entry.key) === entry;
    }

    function clockValue() {
      try {
        const value = Number(now());
        return finite(value) ? value : null;
      } catch {
        return null;
      }
    }

    function blockClock(entry) {
      if (!current(entry)) return;
      entry.status = 'blocked';
      entry.reason = 'clock-error';
      entry.error = 'Relógio indisponível para confirmar o reset.';
      notify(entry);
    }

    function accepted(value) {
      return value === true || !!(value && typeof value === 'object' && (value.ok === true || value.valid === true));
    }

    async function due(entry) {
      if (!current(entry) || entry.status !== 'scheduled') return;
      entry.timer = null;
      const currentTime = clockValue();
      if (currentTime == null) {
        blockClock(entry);
        return;
      }
      const remaining = entry.resetAt - currentTime;
      if (remaining > 0) {
        arm(entry);
        return;
      }
      entry.status = 'validating';
      notify(entry);
      if (!current(entry) || entry.status !== 'validating') return;
      let valid;
      try {
        valid = await validate(entry.key, { ...entry.identity });
      } catch (error) {
        if (!current(entry)) return;
        entry.status = 'blocked';
        entry.reason = 'validation-error';
        entry.error = errorText(error);
        notify(entry);
        return;
      }
      if (!current(entry) || entry.status !== 'validating') return;
      if (!accepted(valid)) {
        entry.status = 'blocked';
        entry.reason = 'validation';
        notify(entry);
        return;
      }
      const validatedAt = clockValue();
      if (validatedAt == null) {
        blockClock(entry);
        return;
      }
      if (entry.resetAt > validatedAt) {
        entry.status = 'scheduled';
        notify(entry);
        arm(entry);
        return;
      }
      entry.status = 'resuming';
      notify(entry);
      if (!current(entry) || entry.status !== 'resuming') return;
      try {
        await onResume(entry.key, { ...entry.identity });
      } catch (error) {
        if (!current(entry)) return;
        entry.status = 'blocked';
        entry.reason = 'resume-error';
        entry.error = errorText(error);
        notify(entry);
        return;
      }
      if (!current(entry) || entry.status !== 'resuming') return;
      entry.status = 'resumed';
      notify(entry);
    }

    function arm(entry) {
      if (!current(entry) || entry.status !== 'scheduled') return;
      const currentTime = clockValue();
      if (currentTime == null) {
        blockClock(entry);
        return;
      }
      const remaining = Math.max(0, entry.resetAt - currentTime);
      entry.timer = setTimer(function () { return due(entry); }, Math.min(MAX_DELAY, remaining));
    }

    function cancel(key) {
      key = String(key == null ? '' : key);
      const entry = entries.get(key);
      if (!entry) return false;
      entries.delete(key);
      if (entry.timer != null) clearTimer(entry.timer);
      entry.timer = null;
      entry.status = 'cancelled';
      notify(entry);
      return true;
    }

    function schedule(key, spec) {
      if (disposed) throw new Error('Agendador encerrado.');
      key = String(key == null ? '' : key);
      if (!key) throw new TypeError('Chave de retomada ausente.');
      spec = spec && typeof spec === 'object' ? spec : {};
      const resetAt = parseReset(spec.resetAt);
      const identity = copyIdentity(spec.identity);
      const existing = entries.get(key);
      if (existing && finite(resetAt) && existing.resetAt === resetAt && sameIdentity(existing.identity, identity)) {
        return snapshot(existing);
      }
      const nowAtSchedule = clockValue();
      if (!finite(resetAt) || nowAtSchedule == null || resetAt <= nowAtSchedule) {
        throw new RangeError('Reset da retomada precisa estar no futuro.');
      }
      cancel(key);
      const entry = { key, resetAt, identity, status: 'scheduled', timer: null, reason: '', error: '' };
      entries.set(key, entry);
      notify(entry);
      arm(entry);
      return snapshot(entry);
    }

    function cancelAll() {
      let count = 0;
      for (const key of [...entries.keys()]) if (cancel(key)) count++;
      return count;
    }

    function get(key) {
      return snapshot(entries.get(String(key == null ? '' : key)));
    }

    function dispose() {
      if (disposed) return;
      cancelAll();
      disposed = true;
    }

    return { schedule, cancel, cancelAll, get, dispose };
  }

  return { createScheduler };
});
