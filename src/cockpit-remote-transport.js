"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { StringDecoder } = require("node:string_decoder");
const q = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
function target(remote) {
  if (
    !remote ||
    typeof remote !== "object" ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(remote.usuario || "") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.:[\]-]*$/.test(remote.host || "") ||
    !remote.chave ||
    /[\0\r\n]/.test(remote.chave)
  )
    throw new Error("Destino SSH inválido. Edite o servidor.");
  const port = remote.porta == null ? 22 : Number(remote.porta);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Porta SSH inválida.");
  return { ...remote, porta: port };
}
function key(remote) {
  const r = target(remote);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([r.usuario, r.host, r.porta, r.chave]))
    .digest("hex");
}
function remotePath(value) {
  const p = String(value || "~");
  if (/[\0\r\n]/.test(p)) throw new Error("Caminho remoto inválido.");
  return p === "~"
    ? '"$HOME"'
    : p.startsWith("~/")
      ? '"$HOME"/' + q(p.slice(2))
      : q(p);
}
function createTransport({ spawnBin, buildEnv, HOME, kill = (p) => p.kill() }) {
  function spawn(remote, command, cwd) {
    const r = target(remote);
    const script =
      (cwd == null ? "" : "cd -- " + remotePath(cwd) + " || exit 1; ") +
      command;
    return spawnBin(
      "ssh",
      [
        "-T",
        "-i",
        r.chave,
        "-p",
        String(r.porta),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        r.usuario + "@" + r.host,
        "--",
        "exec ${SHELL:-/bin/sh} -lc " + q(script),
      ],
      { cwd: HOME, env: buildEnv(), stdio: ["pipe", "pipe", "pipe"] },
    );
  }
  function run(remote, command, { cwd, input, timeout = 20000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("Operação cancelada."));
      const decoder = new StringDecoder("utf8");
      let proc,
        out = "",
        err = "",
        finished = false;
      try {
        proc = spawn(remote, command, cwd);
      } catch (e) {
        reject(e);
        return;
      }
      const done = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) {
          kill(proc);
          reject(error);
        } else resolve(out);
      };
      const abort = () => {
        kill(proc);
        done(new Error("Operação cancelada."));
      };
      const timer = setTimeout(() => {
        kill(proc);
        done(new Error("Tempo de conexão SSH esgotado. " + err));
      }, timeout);
      signal?.addEventListener("abort", abort, { once: true });
      proc.stdout.on("data", (d) => {
        out += decoder.write(Buffer.isBuffer(d) ? d : Buffer.from(d));
        if (out.length > 32 * 1024 * 1024) {
          kill(proc);
          done(new Error("Resposta remota excedeu o limite."));
        }
      });
      proc.stderr.on("data", (d) => {
        err = (err + d).slice(-2000);
      });
      proc.on("error", done);
      proc.on("close", (code) =>
        done(
          code === 0
            ? null
            : new Error("SSH/processo remoto falhou (" + code + "): " + err),
        ),
      );
      proc.stdin.on("error", done);
      proc.stdin.end(input);
    });
  }
  async function upload(remote, files, signal) {
    if (!files?.length) return { paths: [], cleanup: async () => {} };
    const dir = "/tmp/cockpit-" + crypto.randomUUID();
    const cleanup = () => run(remote, "rm -rf -- " + q(dir)).catch(() => {});
    await run(remote, "umask 077; mkdir -- " + q(dir), { signal });
    try {
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) throw new Error("Operação cancelada.");
        const stat = fs.statSync(files[i]);
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
          throw new Error("Anexo inválido ou maior que 20 MB.");
        const dest =
          dir +
          "/" +
          i +
          "-" +
          path.basename(files[i]).replace(/[^\w. -]/g, "_");
        await run(remote, "umask 077; cat > " + q(dest), {
          input: fs.readFileSync(files[i]),
          signal,
        });
        paths.push(dest);
      }
      return { paths, cleanup };
    } catch (e) {
      await cleanup();
      throw e;
    }
  }
  return { spawn, run, upload, kill };
}
class Rpc extends EventEmitter {
  constructor(proc, kill = (p) => p.kill()) {
    super();
    this.decoder = new StringDecoder("utf8");
    this.proc = proc;
    this.kill = kill;
    this.pending = new Map();
    this.id = 0;
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
    proc.stdout.on("data", (chunk) => {
      if (this.closed) return;
      this.buffer += this.decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
      if (this.buffer.length > 8 * 1024 * 1024)
        return this.close(new Error("Mensagem remota excedeu o limite."));
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        if (m.id != null && !m.method) {
          const p = this.pending.get(m.id);
          if (p) {
            this.pending.delete(m.id);
            m.error
              ? p.reject(new Error(m.error.message || "Erro remoto"))
              : p.resolve(m.result);
          }
        } else this.emit("message", m);
      }
    });
    proc.stderr.on("data", (d) => {
      this.stderr = (this.stderr + d).slice(-2000);
    });
    proc.stdin.on("error", (e) => this.close(e));
    proc.on("error", (e) => this.close(e));
    proc.on("close", (code) =>
      this.close(
        new Error("Processo remoto encerrado (" + code + "): " + this.stderr),
      ),
    );
  }
  write(message) {
    if (this.closed) throw new Error("Canal remoto fechado.");
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error("Canal remoto fechado."));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Tempo esgotado: " + method));
      }, timeout);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.get(id)?.reject(e);
        this.pending.delete(id);
      }
    });
  }
  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, params });
  }
  reply(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }
  close(error = new Error("Canal cancelado.")) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.kill(this.proc);
    this.emit("closed", error);
  }
}
module.exports = { q, target, key, remotePath, createTransport, Rpc };
