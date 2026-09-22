"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { key } = require("./cockpit-remote-transport");
const { inspectCredential, sameCredentialAccount, publicCredentialState } = require("./cockpit-credentials");
const finite = (v) =>
  v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const pct = (v) =>
  finite(v) == null ? null : Math.min(100, Math.max(0, Number(v)));
function normalize(engine, raw) {
  if (engine === "claude") {
    const window = (x, mins) =>
      x && pct(x.utilization) != null
        ? {
            pct: pct(x.utilization),
            reseta: Number.isFinite(Date.parse(x.resets_at))
              ? Date.parse(x.resets_at)
              : null,
            mins,
          }
        : null;
    return {
      sessao: window(raw.five_hour, 300),
      semana: window(raw.seven_day, 10080),
      extra: raw.extra_usage
        ? {
            ligado: !!raw.extra_usage.is_enabled,
            usado: finite(raw.extra_usage.used_credits),
            teto: finite(raw.extra_usage.monthly_limit),
            moeda: raw.extra_usage.currency || "",
          }
        : null,
    };
  }
  const limits = raw.rate_limit || {},
    window = (x) =>
      x && pct(x.used_percent) != null
        ? {
            pct: pct(x.used_percent),
            mins:
              finite(x.limit_window_seconds) == null
                ? null
                : Number(x.limit_window_seconds) / 60,
            reseta:
              finite(x.reset_at) == null ? null : Number(x.reset_at) * 1000,
          }
        : null;
  const windows = [
    window(limits.primary_window),
    window(limits.secondary_window),
  ].filter(Boolean);
  return {
    plano: typeof raw.plan_type === "string" ? raw.plan_type : "",
    sessao: windows.find((w) => w.mins != null && w.mins <= 1440) || null,
    semana: windows.find((w) => w.mins != null && w.mins > 1440) || null,
    janelas: windows,
    extra: raw.credits
      ? {
          ligado: !!raw.credits.has_credits,
          ilimitado: !!raw.credits.unlimited,
          saldo: finite(raw.credits.balance),
          moeda: "créditos",
        }
      : null,
  };
}
function createAccounts({
  folder,
  readActive,
  transport,
  fetch,
  now = Date.now,
  concurrency = 2,
}) {
  const cache = new Map(),
    rejectedCredentials = new Map(),
    requests = new Map();
  let activeQueries = 0;
  const waiting = [];
  function limited(signal, fn) {
    return new Promise((resolve, reject) => {
      const task = { signal, fn, resolve, reject };
      waiting.push(task);
      pump();
    });
  }
  function pump() {
    while (activeQueries < concurrency && waiting.length) {
      const task = waiting.shift();
      if (task.signal.aborted) {
        task.resolve(null);
        continue;
      }
      activeQueries++;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeQueries--;
          pump();
        });
    }
  }
  async function profiles(engine, remote, signal, limit = 30) {
    if (!["claude", "codex"].includes(engine)) return [];
    let active = "",
      saved = [];
    if (remote != null) {
      key(remote);
      // Credentials stay in the main process and are never interpolated into commands or logs.
      const credentialPath =
        engine === "claude"
          ? '"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"'
          : '"${CODEX_HOME:-$HOME/.codex}/auth.json"';
      const script =
        'printf "ACTIVE\\n"; base64 < ' +
        credentialPath +
        ' 2>/dev/null | tr -d "\\n"; printf "\\n"; for f in "$HOME/.cockpit-contas"/' +
        engine +
        '__*.json; do [ -f "$f" ] || continue; printf "%s\\n" "${f##*/}"; base64 < "$f" | tr -d "\\n"; printf "\\n"; done';
      const lines = (await transport.run(remote, script, { signal }))
        .trim()
        .split(/\r?\n/);
      if (lines[0] !== "ACTIVE")
        throw new Error("Resposta de perfis remotos inválida.");
      active = Buffer.from(lines[1] || "", "base64").toString("utf8");
      for (let i = 2; i + 1 < lines.length; i += 2) {
        const name = lines[i];
        if (!name.startsWith(engine + "__") || !name.endsWith(".json"))
          continue;
        try {
          saved.push({
            apelido: decodeURIComponent(name.slice(engine.length + 2, -5)),
            credential: Buffer.from(lines[i + 1], "base64").toString("utf8"),
          });
        } catch {}
      }
    } else {
      active = readActive(engine) || "";
      let names = [];
      try {
        names = fs.readdirSync(folder());
      } catch {}
      for (const name of names)
        if (name.startsWith(engine + "__") && name.endsWith(".json")) {
          try {
            saved.push({
              apelido: decodeURIComponent(name.slice(engine.length + 2, -5)),
              credential: fs.readFileSync(path.join(folder(), name), "utf8"),
            });
          } catch {}
        }
    }
    const current = inspectCredential(engine, active, now());
    for (const p of saved) {
      const info = inspectCredential(engine, p.credential, now());
      p.atual = sameCredentialAccount(info, current);
      // Comparison itself is read-only. Use the active, refreshed token only for the same proven identity.
      if (p.atual && current.valido && current.podeUsar && (!current.expiresAt || current.expiresAt > now())) p.credential = active;
    }
    if (active && !saved.some((p) => p.atual))
      saved.unshift({
        apelido: "Conta atual",
        atual: true,
        credential: active,
      });
    return saved.slice(0, limit);
  }
  function credentialCacheKey(engine, credential, remote) {
    const token = engine === 'claude' ? credential.claudeAiOauth?.accessToken : credential.tokens?.access_token;
    return crypto.createHash('sha256').update(JSON.stringify([engine, remote ? key(remote) : 'local', token,
      engine === 'codex' ? String(credential.tokens?.account_id || '') : ''])).digest('hex');
  }
  function profileState(engine, text, remote) {
    const info = inspectCredential(engine, text, now());
    if (!info.valido || info.authMode !== 'oauth') return info;
    const rejected = rejectedCredentials.get(credentialCacheKey(engine, JSON.parse(text), remote));
    // A fresh successful query or a new token removes the known rejection naturally.
    // Rate limiting and transport errors are never authentication rejection.
    if (rejected?.estado === 'login') return { ...info, podeUsar: false, precisaLogin: true,
      motivo: rejected.erro || 'O provedor recusou esta credencial. Entre novamente.' };
    return info;
  }
  async function validateSaved(engine, remote, nickname) {
    const controller = new AbortController();
    const list = await profiles(engine, remote, controller.signal, Infinity);
    const selected = list.find(p => p.apelido === nickname);
    return selected ? publicCredentialState(profileState(engine, selected.credential, remote)) : null;
  }
  async function usage(engine, profile, remote, signal, force) {
    const info = inspectCredential(engine, profile.credential, now());
    if (!info.valido || !info.podeUsar) return { estado: 'login', dados: null, erro: info.motivo, consultadoEm: now() };
    if (info.precisaRenovar) return { estado: 'sem-dados', dados: null, erro: info.motivo, consultadoEm: now() };
    const credential = JSON.parse(profile.credential);
    const token =
      engine === "claude"
        ? credential.claudeAiOauth?.accessToken
        : credential.tokens?.access_token;
    if (!token)
      return {
        estado: "sem-dados",
        dados: null,
        erro: "Este perfil não oferece consulta de consumo por OAuth.",
        consultadoEm: now(),
      };
    const cacheKey = credentialCacheKey(engine, credential, remote);
    const saved = cache.get(cacheKey);
    if (
      saved &&
      (saved.until > now() ||
        (!force && now() - saved.value.consultadoEm < 60000))
    )
      return saved.value;
    const headers = { Authorization: "Bearer " + token };
    if (engine === "claude") headers["anthropic-beta"] = "oauth-2025-04-20";
    else {
      headers["User-Agent"] = "codex-cli";
      if (credential.tokens?.account_id)
        headers["ChatGPT-Account-Id"] = credential.tokens.account_id;
    }
    let result,
      until = 0,
      verifiedResponse = false;
    const controller = new AbortController(),
      cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, 20000);
    try {
      const r = await fetch(
        engine === "claude"
          ? "https://api.anthropic.com/api/oauth/usage"
          : "https://chatgpt.com/backend-api/wham/usage",
        {
          method: "GET",
          headers,
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (r.status === 401 || r.status === 403)
        result = {
          estado: "login",
          dados: null,
          erro: "Entre novamente nesta conta pelo destino correspondente.",
        };
      else if (r.status === 429) {
        const retry = r.headers?.get("retry-after");
        const delay =
          Number.isFinite(Number(retry)) && retry != null
            ? Number(retry) * 1000
            : Date.parse(retry) - now();
        until = now() + Math.max(30000, Number.isFinite(delay) ? delay : 60000);
        result = {
          estado: "erro",
          dados: saved?.value.dados || null,
          erro: "Limite de consultas; aguarde antes de atualizar.",
          tentarEm: until,
        };
      } else if (!r.ok)
        result = {
          estado: "erro",
          dados: null,
          erro: "Provedor de consumo respondeu HTTP " + r.status + ".",
        };
      else {
        const dados = normalize(engine, await r.json());
        verifiedResponse = true;
        result = {
          estado:
            dados.sessao || dados.semana || dados.extra || dados.janelas?.length
              ? "ok"
              : "sem-dados",
          dados,
        };
      }
    } catch {
      result = {
        estado: "erro",
        dados: null,
        erro: signal?.aborted
          ? "Consulta cancelada."
          : "Não foi possível consultar o consumo no prazo.",
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
    result.consultadoEm = now();
    if (!signal?.aborted) {
      if (result.estado === 'login') rejectedCredentials.set(cacheKey, result);
      else if (verifiedResponse) rejectedCredentials.delete(cacheKey);
      if (cache.size > 100) cache.clear();
      cache.set(cacheKey, { value: result, until });
    }
    return result;
  }
  async function compare(engine, remote, options = {}) {
    const where =
      remote != null
        ? (key(remote),
          remote.usuario +
            "@" +
            remote.host +
            (Number(remote.porta || 22) === 22
              ? ""
              : ":" + Number(remote.porta)))
        : "Este computador";
    const id = options.pedidoId || crypto.randomUUID();
    requests.get(id)?.abort();
    const controller = new AbortController();
    requests.set(id, controller);
    try {
      const list = await profiles(engine, remote, controller.signal),
        out = new Array(list.length);
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, async () => {
          while (index < list.length && !controller.signal.aborted) {
            const i = index++,
              p = list[i];
            const u = await limited(controller.signal, () =>
              usage(engine, p, remote, controller.signal, options.forcar),
            );
            if (u) {
              const state = publicCredentialState(profileState(engine, p.credential, remote));
              if (u.estado === 'login') { state.podeUsar = false; state.precisaLogin = true; state.motivo = u.erro || state.motivo; }
              out[i] = { apelido: p.apelido, atual: !!p.atual, ...state, ...u };
            }
          }
        }),
      );
      return {
        contas: out.filter(Boolean),
        onde: where,
        cancelado: controller.signal.aborted,
        ...(list.length
          ? {}
          : {
              aviso:
                "Nenhum perfil com consulta de consumo disponível neste destino.",
            }),
      };
    } catch (e) {
      return {
        contas: [],
        onde: where,
        erro: controller.signal.aborted
          ? "Consulta cancelada."
          : "Não foi possível ler os perfis neste destino.",
        cancelado: controller.signal.aborted,
      };
    } finally {
      if (requests.get(id) === controller) requests.delete(id);
    }
  }
  return {
    compare,
    profiles,
    profileState,
    validateSaved,
    cancel: (id) => {
      const c = requests.get(id);
      if (c) c.abort();
      return !!c;
    },
    clear: () => cache.clear(),
  };
}
module.exports = { createAccounts, normalize };
