"use strict";
const { q } = require("./cockpit-remote-transport");
// Executed exclusively by Node on the destination, never against the PC filesystem.
function nativeSessionOperation(request) {
  const fs = require("fs"),
    path = require("path"),
    os = require("os"),
    crypto = require("crypto");
  const engine = request.engine;
  if (engine !== "gemini")
    throw new Error(
      "Este motor não publica um formato nativo de histórico confirmado.",
    );
  const root = path.join(os.homedir(), ".gemini", "tmp"),
    files = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name === "logs" || item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file, depth + 1);
      else if (/\.jsonl?$/.test(file)) files.push(file);
    }
  }
  walk(root, 0);
  const text = (c) =>
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c.map((x) => x?.text || "").join("")
        : "";
  function read(file) {
    const msgs = new Map();
    let meta = {},
      raw = "";
    try {
      if (fs.statSync(file).size > 32 * 1024 * 1024) return null;
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    for (const line of raw.split("\n")) {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      if (m.$rewindTo) {
        const ids = [...msgs.keys()],
          index = ids.indexOf(m.$rewindTo);
        if (index < 0) msgs.clear();
        else for (const id of ids.slice(index)) msgs.delete(id);
      } else if (m.$set) {
        meta = { ...meta, ...m.$set };
        if (Array.isArray(m.$set.messages)) {
          msgs.clear();
          for (const msg of m.$set.messages) if (msg && typeof msg === 'object' && msg.id) msgs.set(msg.id, msg);
        }
      } else if (m.id) msgs.set(m.id, m);
      else if (m.sessionId) meta = { ...meta, ...m };
    }
    return meta.sessionId
      ? { meta, msgs: [...msgs.values()], file, raw }
      : null;
  }
  const sessions = files.map(read).filter(Boolean);
  if (request.action === "list")
    return sessions.map((s) => ({
      engine,
      id: s.meta.sessionId,
      title:
        text(s.msgs.find((m) => m.type === "user")?.content).slice(0, 120) ||
        "Conversa remota",
      cwd: s.meta.cwd || s.meta.projectRoot || "",
      when: fs.statSync(s.file).mtimeMs,
      file: "",
      remoto: true,
      origem: "servidor",
    }));
  const session = sessions.find((s) => s.meta.sessionId === request.id);
  if (!session) throw new Error("Sessão não encontrada no servidor.");
  if (request.action === "history")
    return session.msgs
      .filter((m) => !["info", "error", "warning"].includes(m.type))
      .flatMap((m) => [
        ...(text(m.content)
          ? [
              {
                role: m.type === "user" ? "user" : "bot",
                text: text(m.content),
              },
            ]
          : []),
        ...(m.toolCalls || []).map((t) => ({
          role: "tool",
          name: t.name || "Ferramenta",
          arg: JSON.stringify(t.args || {}),
        })),
      ]);
  if (request.action === "path") return session.file;
  if (request.action === "delete") {
    fs.unlinkSync(session.file);
    return { ok: true };
  }
  if (request.action === "fork") {
    const id = crypto.randomUUID();
    let lines = session.raw.split("\n");
    if (request.doFim != null && request.doFim >= 1) {
      const isUser = (m) =>
        m?.type === "user" &&
        !!text(m.content).trim() &&
        !/^[/ ?<]/.test(text(m.content));
      const count = (l) => {
        try {
          const m = JSON.parse(l);
          return Array.isArray(m.$set?.messages)
            ? m.$set.messages.filter(isUser).length
            : isUser(m)
              ? 1
              : 0;
        } catch {
          return 0;
        }
      };
      const total = lines.reduce((n, l) => n + count(l), 0),
        target = total - request.doFim + 1;
      if (target < 1)
        throw new Error("Ponto não encontrado na conversa remota.");
      let seen = 0;
      const at = lines.findIndex((l) => (seen += count(l)) >= target);
      // A snapshot may contain several turns on the same JSONL line. Keep
      // only the selected prefix, not the later conversation inside $set.
      if (at >= 0) {
        const before = lines
          .slice(0, at)
          .reduce((n, line) => n + count(line), 0);
        const snapshot = JSON.parse(lines[at]);
        if (Array.isArray(snapshot.$set?.messages)) {
          let inside = 0;
          const selected = snapshot.$set.messages.findIndex((message) => {
            if (isUser(message)) inside++;
            return inside >= target - before;
          });
          if (selected < 0)
            throw new Error("Ponto não encontrado no snapshot remoto.");
          snapshot.$set.messages = snapshot.$set.messages.slice(
            0,
            selected + 1,
          );
          lines[at] = JSON.stringify(snapshot);
        }
      }
      lines = lines.slice(0, at + 1);
    }
    const raw = lines
      .map((line) => {
        try {
          const record = JSON.parse(line);
          // Metadata is JSON, not a literal byte pattern: whitespace and
          // escapes are legal, and text inside messages must stay unchanged.
          if (record?.sessionId === request.id) record.sessionId = id;
          if (record?.$set?.sessionId === request.id) record.$set.sessionId = id;
          return JSON.stringify(record);
        } catch {
          return line;
        }
      })
      .join("\n");
    const file = path.join(
      path.dirname(session.file),
      "session-fork-" + id.slice(0, 8) + ".jsonl",
    );
    fs.writeFileSync(file, raw, { flag: "wx", mode: 0o600 });
    return { id };
  }
  throw new Error("Operação remota desconhecida.");
}
function script(request) {
  return (
    "node -e " +
    q(
      "try { const result = (" +
        nativeSessionOperation.toString() +
        ")(" +
        JSON.stringify(request) +
        "); process.stdout.write(JSON.stringify(result)); } catch(e) { process.stderr.write(e.message); process.exitCode = 1; }",
    )
  );
}
module.exports = { script, nativeSessionOperation };
