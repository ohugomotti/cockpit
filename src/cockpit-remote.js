"use strict";
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { q, key, remotePath, Rpc } = require("./cockpit-remote-transport");
const proto = require("./codex-protocol");
const { codexApprovalDetails } = require("./cockpit-approval");
const acp = require("./acp");
const native = require("./cockpit-remote-native");
const ENGINES = ["claude", "codex", "gemini", "grok", "acp"];
function createRemote({ transport, emit, cliArgs, cliEvent, cliFlush, store }) {
  const panes = new Map(),
    servers = new Map(),
    inspections = new Map(),
    approvals = new Map(),
    questions = new Map();
  function alive(st) {
    return panes.get(st.paneId) === st && !st.stopped;
  }
  function event(st, kind, data = {}) {
    if (!alive(st)) return;
    st.history ||= [];
    if (kind === "text-delta" || kind === "text-final") {
      let m = st.history.find((m) => m.role === "bot" && m.id === data.id);
      if (!m) {
        m = { id: data.id, role: "bot", text: "" };
        st.history.push(m);
      }
      m.text =
        kind === "text-delta"
          ? m.text + (data.text || "")
          : data.text || m.text;
    }
    if (kind === "tool-start")
      st.history.push({
        role: "tool",
        id: data.id,
        name: data.name,
        arg: data.arg,
      });
    if (kind === "sessao" || kind === "turn-end" || kind === "engine-down") {
      try {
        store?.save(st);
      } catch {
        emit(st.paneId, "note", {
          text: "Não consegui guardar o registro desta conversa remota.",
          error: true,
        });
      }
    }
    emit(st.paneId, kind, { ...data, remoto: true, destino: st.destination });
  }
  async function inspect(remote, force = false) {
    const destination = key(remote),
      old = inspections.get(destination);
    if (!force && old && Date.now() - old.at < 60000) return old.promise;
    const promise = transport
      .run(
        remote,
        'for b in claude codex gemini grok; do if command -v "$b" >/dev/null 2>&1; then printf "%s\\n" "$b"; fi; done',
      )
      .then((out) => {
        const found = new Set(out.trim().split(/\s+/));
        return Object.fromEntries(
          ENGINES.map((engine) => [
            engine,
            {
              disponivel: found.has(engine === "acp" ? "gemini" : engine),
              remoto: true,
              detalhe:
                !found.has(engine === "acp" ? "gemini" : engine)
                  ? engine === "acp"
                    ? "Preset Gemini ACP não instalado neste servidor."
                    : "Binário não encontrado no PATH deste servidor."
                  : engine === "acp"
                    ? "Preset Gemini ACP; comando personalizado é conferido ao abrir."
                    : "Binário detectado; login conferido ao iniciar.",
              capacidades: {
                conversa: true,
                anexos: true,
                retomar: engine !== "acp",
                historico: engine === "codex" || engine === "claude",
                compactar: engine === "codex" || engine === "claude",
                steer: engine === "codex" || engine === "claude",
              },
            },
          ]),
        );
      })
      .catch((e) =>
        Object.fromEntries(
          ENGINES.map((engine) => [
            engine,
            { disponivel: false, remoto: true, detalhe: e.message },
          ]),
        ),
      );
    inspections.set(destination, { at: Date.now(), promise });
    return promise;
  }
  function server(remote) {
    const destination = key(remote);
    let s = servers.get(destination);
    if (s && !s.rpc.closed) return s;
    const rpc = new Rpc(
      transport.spawn(remote, "exec codex app-server", "~"),
      transport.kill,
    );
    s = { rpc, destination, threads: new Map(), remote };
    servers.set(destination, s);
    rpc.on("message", (m) => codexMessage(s, m));
    rpc.on("closed", (error) => {
      if (servers.get(destination) === s) servers.delete(destination);
      for (const st of s.threads.values()) {
        clearApprovals(st);
        event(st, "engine-down", { engine: "codex", motivo: error.message });
        void cleanup(st);
      }
      s.threads.clear();
    });
    s.ready = rpc
      .request("initialize", {
        clientInfo: { name: "cockpit", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      })
      .then(() => rpc.notify("initialized", {}))
      .catch((e) => {
        rpc.close(e);
        throw e;
      });
    return s;
  }
  function approval(st, rpc, m, kind, data) {
    const id = "remote_" + crypto.randomUUID();
    approvals.set(id, { st, rpc, m, kind });
    let presentation = data;
    if (!presentation && kind === "acp") {
      const tc = m.params?.toolCall || {};
      const previous = st.ferramentas?.get(String(tc.toolCallId || '')) || {};
      const info = acp.dadosDaPermissao(tc, previous);
      presentation = { title: info.passo.titulo || info.passo.name, detail: info.detail, mudanca: info.mudanca, action: info.action, target: info.target };
    }
    event(st, "approval", {
      key: id,
      ...(presentation || codexApprovalDetails(kind, m.params || {}, true)),
    });
  }
  function answer(id, responses, cancelled) {
    const q = questions.get(id);
    if (!q) return false;
    questions.delete(id);
    try {
      q.rpc.reply(
        q.id,
        proto.buildUserInputResponse(q.questions, responses, !!cancelled),
      );
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }
  function clearApprovals(st) {
    for (const [id, q] of questions)
      if (q.st === st) {
        answer(id, [], true);
        event(st, "pergunta-cancelada", { id });
      }
    for (const [id, a] of approvals)
      if (a.st === st) {
        approve(id, false);
        event(st, "permissao-cancelada", { key: id });
      }
  }
  function approve(id, allow) {
    const a = approvals.get(id);
    if (!a) return false;
    approvals.delete(id);
    try {
      if (a.kind === "acp") {
        const option = acp.escolherOpcao(
          a.m.params?.options || [],
          !!allow,
          false,
        );
        a.rpc.reply(a.m.id, {
          outcome: option
            ? { outcome: "selected", optionId: option.optionId }
            : { outcome: "cancelled" },
        });
      } else
        a.rpc.reply(
          a.m.id,
          proto.buildApprovalResponse(a.kind, !!allow, {
            permissions: a.m.params?.permissions,
          }),
        );
      return true;
    } catch {
      return false;
    }
  }
  async function cleanup(st) {
    const pending = st.uploads.splice(0);
    await Promise.allSettled(pending.map((u) => u.cleanup()));
  }
  function codexMessage(s, m) {
    const p = m.params || {},
      tid = p.threadId || p.thread_id || p.thread?.id || p.conversationId;
    const st = s.threads.get(tid);
    if (m.id != null) {
      if (
        st &&
        /requestApproval$|^execCommandApproval$|^applyPatchApproval$/.test(
          m.method,
        )
      )
        return approval(
          st,
          s.rpc,
          m,
          /permissions/.test(m.method)
            ? "perm"
            : m.method === "execCommandApproval"
              ? "cmdLegado"
              : m.method === "applyPatchApproval"
                ? "fileLegado"
                : /fileChange/.test(m.method)
                  ? "file"
                  : "command",
        );
      if (st && m.method === "item/tool/requestUserInput") {
        const card = proto.normalizeUserInputRequest(m.id, p);
        card.id = "remote_q_" + crypto.randomUUID();
        questions.set(card.id, {
          st,
          rpc: s.rpc,
          id: m.id,
          questions: card.todas,
        });
        event(st, "pergunta", card);
        return;
      }
      if (m.method === "currentTime/read")
        return s.rpc.reply(m.id, {
          currentTimeAt: Math.floor(Date.now() / 1000),
        });
      s.rpc.write({
        jsonrpc: "2.0",
        id: m.id,
        error: {
          code: -32601,
          message: "Pedido remoto não suportado pelo Cockpit: " + m.method,
        },
      });
      return;
    }
    if (!st || !alive(st)) return;
    const it = p.item || {};
    switch (m.method) {
      case "turn/started":
        st.codexErrors = {};
        st.turn = p.turnId || p.turn?.id;
        if (st.cancelled) {
          void interruptTurn(st);
          return;
        }
        event(st, "busy");
        break;
      case "item/agentMessage/delta":
        if (!st.cancelled)
          event(st, "text-delta", {
            id: p.itemId || "msg",
            text: p.delta || "",
          });
        break;
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        if (!st.cancelled) event(st, "think-delta", { text: p.delta || "" });
        break;
      case "item/started":
        if (!["agentMessage", "reasoning", "userMessage"].includes(it.type))
          event(st, "tool-start", {
            id: it.id,
            name: it.tool || it.type,
            arg:
              it.command ||
              it.query ||
              JSON.stringify(it.arguments || it.changes || ""),
          });
        break;
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta":
        event(st, "tool-output", proto.normalizeCommandOutput(m.method, p));
        break;
      case "item/completed":
        if (it.type === "agentMessage") {
          if (!st.cancelled)
            event(st, "text-final", {
              id: it.id || "msg",
              ...proto.normalizeAgentMessage(it),
            });
        } else if (!["reasoning", "userMessage"].includes(it.type))
          event(st, "tool-end", {
            id: it.id,
            output:
              it.aggregatedOutput ||
              JSON.stringify(it.result || it.changes || ""),
            error:
              it.status === "failed" ||
              !!it.error ||
              (it.exitCode != null && it.exitCode !== 0),
          });
        break;
      case "turn/completed": {
        const failed = !!p.turn?.error || p.turn?.status === "failed";
        const errors = st.codexErrors ||= {};
        if (failed && (p.turn?.error || !errors.finalText)) {
          const notice = proto.normalizeErrorNotification({ error: p.turn?.error }, errors);
          if (!notice.duplicate) event(st, "note", notice);
        }
        st.turn = null;
        st.sending = false;
        clearApprovals(st);
        if (!errors.ended) event(st, "turn-end", {
          status: st.cancelled ? "interrupted" : p.turn?.status || "unknown",
          error: failed,
        });
        st.codexErrors = {};
        void cleanup(st);
        break;
      }
      case "error":
      case "turn/failed": {
        const errors = st.codexErrors ||= {};
        const notice = proto.normalizeErrorNotification(p, errors);
        if (!notice.duplicate) event(st, "note", notice);
        if (notice.retrying) break;
        st.turn = null;
        st.sending = false;
        if (!errors.ended) event(st, "turn-end", { error: true, status: "failed" });
        errors.ended = true;
        clearApprovals(st);
        void cleanup(st);
        break;
      }
      case "thread/tokenUsage/updated":
        event(st, "tokens", {
          total:
            p.tokenUsage?.last?.totalTokens ?? p.tokenUsage?.total?.totalTokens,
          janela: p.tokenUsage?.modelContextWindow,
        });
        break;
      case "thread/compacted":
        event(st, "compactou");
        break;
      case "turn/plan/updated":
        event(st, "plano", {
          itens: (p.plan || []).map((x) => ({
            txt: x.step,
            estado:
              x.status === "completed"
                ? "feito"
                : x.status === "inProgress"
                  ? "fazendo"
                  : "pendente",
          })),
        });
        break;
    }
  }
  async function start(paneId, opts) {
    void stop(paneId);
    const st = {
      ...opts,
      paneId,
      destination: key(opts.remoto),
      cwd: opts.remoto.caminhoRemoto || opts.cwd || "~",
      engine: opts.engine,
      uploads: [],
      abort: new AbortController(),
      cancelled: false,
      stopped: false,
      sending: false,
    };
    st.history = store?.read(st.remoto, st.engine, opts.resumeId)?.msgs || [];
    panes.set(paneId, st);
    try {
      if (st.engine === "codex") {
        st.server = server(st.remoto);
        await st.server.ready;
        if (!alive(st)) return false;
        const { method, params } = proto.buildThreadOpenRequest({
          ...opts,
          cwd: st.cwd,
        });
        // '~' is expanded by the shell before launching the app-server; protocol needs an absolute cwd.
        const absolute = await transport.run(st.remoto, "pwd -P", {
          cwd: st.cwd,
          signal: st.abort.signal,
        });
        params.cwd = absolute.trim();
        const r = await st.server.rpc.request(method, params);
        st.session = r.threadId || r.thread?.id || opts.resumeId;
        if (!alive(st)) return false;
        if (!st.session)
          throw new Error("Codex remoto não devolveu a conversa.");
        const previous = st.server.threads.get(st.session);
        if (previous && previous !== st) await stop(previous.paneId);
        st.server.threads.set(st.session, st);
        event(st, "sessao", { id: st.session, file: "" });
      } else if (st.engine === "acp") {
        const command = acp.comandoEmPartes(st.model || acp.COMANDO_PADRAO);
        if (!command.bin || /^(npx|npm|pnpm|yarn|bunx)$/.test(command.bin))
          throw new Error(
            "Configure um binário ACP já instalado no servidor; instalação automática está desativada.",
          );
        await transport.run(
          st.remoto,
          "command -v " + q(command.bin) + " >/dev/null",
        );
        st.cwd = (
          await transport.run(st.remoto, "pwd -P", {
            cwd: st.cwd,
            signal: st.abort.signal,
          })
        ).trim();
        if (!alive(st)) return false;
        st.rpc = new Rpc(
          transport.spawn(
            st.remoto,
            "exec " + [command.bin, ...command.args].map(q).join(" "),
            st.cwd,
          ),
          transport.kill,
        );
        Object.assign(st, {
          ferramentas: new Map(),
          msgId: null,
          acc: "",
          seq: 0,
          comandos: [],
          modelos: [],
          modos: [],
        });
        st.rpc.on("closed", (e) => {
          clearApprovals(st);
          event(st, "engine-down", { engine: "acp", motivo: e.message });
          void cleanup(st);
        });
        st.rpc.on("message", (m) => {
          if (!alive(st)) return;
          if (m.method === "session/update" && !st.cancelled) {
            for (const ev of acp.traduzirUpdate(st, m.params?.update || {})) {
              const { kind, ...data } = ev;
              event(st, kind, data);
            }
          } else if (m.id != null && m.method === "session/request_permission")
            approval(st, st.rpc, m, "acp");
          else if (m.id != null)
            st.rpc.write({
              jsonrpc: "2.0",
              id: m.id,
              error: {
                code: -32601,
                message:
                  "Use as ferramentas do servidor; acesso local indisponível.",
              },
            });
        });
        const init = await st.rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "cockpit", version: "1.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        });
        st.caps = init.agentCapabilities || {};
        if (opts.resumeId && !st.caps.loadSession)
          throw new Error("Este agente remoto não suporta retomada.");
        const r = await st.rpc.request(
          opts.resumeId ? "session/load" : "session/new",
          {
            ...(opts.resumeId ? { sessionId: opts.resumeId } : {}),
            cwd: st.cwd,
            mcpServers: [],
          },
        );
        if (!alive(st)) return false;
        st.session = opts.resumeId || r.sessionId;
        if (!st.session) throw new Error("Agente ACP não devolveu a sessão.");
        const modes = r.modes?.availableModes || [];
        const mode = acp.modoDoAgente(opts.approval, modes);
        if (mode)
          await st.rpc.request("session/set_mode", {
            sessionId: st.session,
            modeId: mode,
          });
        event(st, "sessao", { id: st.session, file: "" });
        event(st, "acp-info", {
          agente: init.agentInfo?.name || command.bin,
          modos: modes.map((m) => ({ id: m.id, nome: m.name || m.id })),
          modelos: (r.models?.availableModels || []).map((m) => ({
            id: m.modelId,
            nome: m.name,
          })),
          retomou: !!opts.resumeId,
          imagem: false,
        });
      } else if (["gemini", "grok"].includes(st.engine)) {
        await transport.run(
          st.remoto,
          "command -v " + q(st.engine) + " >/dev/null",
          {
            signal: st.abort.signal,
          },
        );
        if (!alive(st)) return false;
        st.session = opts.resumeId || crypto.randomUUID();
        st.sessao = st.session;
        st.primeira = !opts.resumeId;
        event(st, "sessao", { id: st.session, file: "" });
      } else throw new Error("Adaptador remoto desconhecido.");
      return alive(st);
    } catch (e) {
      if (alive(st)) {
        event(st, "note", { text: e.message, error: true });
        await stop(paneId);
      }
      return false;
    }
  }
  async function send(paneId, text, effort, files = []) {
    const st = panes.get(paneId);
    if (!st || st.sending || st.stopped) return false;
    st.failed = false;
    st.sending = true;
    st.cancelled = false;
    st.abort = new AbortController();
    try {
      const uploaded = await transport.upload(
        st.remoto,
        files,
        st.abort.signal,
      );
      if (!alive(st) || st.cancelled) {
        await uploaded.cleanup();
        return false;
      }
      st.uploads.push(uploaded);
      for (let i = 0; i < files.length; i++)
        text = text.split(files[i]).join(uploaded.paths[i]);
      if (uploaded.paths.length && !text.includes("Arquivos que anexei"))
        text += "\n\nArquivos que anexei:\n" + uploaded.paths.join("\n");
      st.history.push({ role: "user", text });
      try {
        store?.save(st);
      } catch {}
      event(st, "busy");
      if (st.engine === "codex") {
        const input = uploaded.paths
          .filter((p) => /\.(png|jpe?g|gif|webp)$/i.test(p))
          .map((p) => ({ type: "localImage", path: p }));
        st.startSent = true;
        const r = await st.server.rpc.request(
          "turn/start",
          {
            threadId: st.session,
            input: [...input, { type: "text", text }],
            ...(effort ? { effort } : {}),
          },
          900000,
        );
        if (r.turn?.id || st.turn) st.startSent = false;
        if (r.turn?.id && st.sending) st.turn = r.turn.id;
        if (st.cancelled && st.turn) await interruptTurn(st);
      } else if (st.engine === "acp") {
        const r = await st.rpc.request(
          "session/prompt",
          { sessionId: st.session, prompt: [{ type: "text", text }] },
          900000,
        );
        st.sending = false;
        event(st, "turn-end", {
          status:
            st.cancelled || r.stopReason === "cancelled"
              ? "interrupted"
              : "completed",
        });
        await cleanup(st);
      } else {
        if (st.engine === "gemini" && !st.primeira)
          st.arquivoSessao = JSON.parse(
            await transport.run(
              st.remoto,
              native.script({
                engine: "gemini",
                action: "path",
                id: st.session,
              }),
              { signal: st.abort.signal },
            ),
          );
        if (!alive(st) || st.cancelled) {
          st.sending = false;
          await cleanup(st);
          return false;
        }
        const args = cliArgs(st.engine, st);
        const proc = transport.spawn(
          st.remoto,
          "exec " + [st.engine, ...args].map(q).join(" "),
          st.cwd,
        );
        st.proc = proc;
        st.erro = "";
        st.buf = "";
        st.msgId = null;
        st.acc = "";
        const decoder = new StringDecoder("utf8");
        proc.stdout.on("data", (d) => {
          if (!alive(st) || st.proc !== proc) return;
          st.buf += decoder.write(Buffer.isBuffer(d) ? d : Buffer.from(d));
          let i;
          while ((i = st.buf.indexOf("\n")) >= 0) {
            const l = st.buf.slice(0, i);
            st.buf = st.buf.slice(i + 1);
            let ev;
            try {
              ev = JSON.parse(l);
            } catch {
              continue;
            }
            if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
            if (ev.type === "init" && ev.session_id) {
              st.session = st.sessao = ev.session_id;
              event(st, "sessao", { id: st.session, file: "" });
            } else {
              if (ev.type === "error" || ev.status === "error")
                st.failed = true;
              cliEvent(paneId, st, ev);
              if (ev.type === "message" && ev.role !== "user") {
                const content =
                  typeof ev.content === "string"
                    ? ev.content
                    : (ev.content || []).map((c) => c.text || "").join("");
                let msg = st.history.find(
                  (m) => m.id === st.msgId && m.role === "bot",
                );
                if (!msg) {
                  msg = { role: "bot", id: st.msgId, text: "" };
                  st.history.push(msg);
                }
                msg.text += content;
              }
            }
          }
        });
        proc.stderr.on("data", (d) => {
          st.erro = (st.erro + d).slice(-2000);
        });
        const done = (code) => {
          if (st.proc !== proc) return;
          if (!alive(st)) {
            st.proc = null;
            void cleanup(st);
            return;
          }
          st.proc = null;
          st.sending = false;
          st.primeira = false;
          cliFlush(paneId, st, true);
          if (code !== 0)
            event(st, "note", {
              text: st.erro || "Processo remoto falhou.",
              error: true,
            });
          event(st, "turn-end", {
            status: st.cancelled
              ? "interrupted"
              : code === 0 && !st.failed
                ? "completed"
                : "failed",
            error: !st.cancelled && (code !== 0 || !!st.failed),
          });
          void cleanup(st);
        };
        proc.on("error", (e) => {
          st.erro = e.message;
          done(-1);
        });
        proc.on("close", done);
        proc.stdin.on("error", (e) => {
          st.erro = e.message;
          done(-1);
        });
        proc.stdin.end(text);
      }
      return true;
    } catch (e) {
      if (
        st.engine === "acp" &&
        /Tempo esgotado: session\/prompt/.test(e.message)
      )
        st.rpc.close(e);
      if (
        st.engine === "codex" &&
        /Tempo esgotado: turn\/start/.test(e.message)
      )
        st.server.rpc.close(
          new Error(
            "O turno remoto não confirmou início no prazo; conexão encerrada para evitar execução duplicada.",
          ),
        );
      st.sending = false;
      if (!st.cancelled) event(st, "note", { text: e.message, error: true });
      event(st, "turn-end", {
        error: !st.cancelled,
        status: st.cancelled ? "interrupted" : "failed",
      });
      await cleanup(st);
      return false;
    }
  }
  async function interruptTurn(st) {
    if (st.turn) {
      try {
        await st.server.rpc.request("turn/interrupt", {
          threadId: st.session,
          turnId: st.turn,
        });
      } catch {}
    }
  }
  async function interrupt(paneId) {
    const st = panes.get(paneId);
    if (!st) return false;
    st.cancelled = true;
    st.abort.abort();
    clearApprovals(st);
    if (st.engine === "codex") await interruptTurn(st);
    else if (st.engine === "acp" && st.session) {
      try {
        st.rpc.notify("session/cancel", { sessionId: st.session });
      } catch {}
    } else if (st.proc) transport.kill(st.proc);
    if (!st.session) await stop(paneId);
    return true;
  }
  async function stop(paneId) {
    const st = panes.get(paneId);
    if (!st) return true;
    st.stopped = true;
    st.cancelled = true;
    st.abort.abort();
    clearApprovals(st);
    panes.delete(paneId);
    if (st.engine === "codex" && st.server) {
      // Remove the old owner before the first await: a resume of the same
      // thread must never find the stopped owner and stop the replacement pane.
      if (st.server.threads.get(st.session) === st)
        st.server.threads.delete(st.session);
      // Without a turn ID, notifications cannot distinguish an old request
      // from a future turn of this same thread. Close the channel explicitly
      // instead of leaving a listener that could interrupt a replacement.
      if (st.startSent && !st.turn) {
        st.server.rpc.close(
          new Error(
            "Conexão remota encerrada: o turno foi parado antes de confirmar o identificador.",
          ),
        );
      }
      if (st.turn) await interruptTurn(st);
    }
    if (st.rpc) st.rpc.close();
    if (st.proc) transport.kill(st.proc);
    if (st.timerFala) clearTimeout(st.timerFala);
    await cleanup(st);
    return true;
  }
  async function operation(paneId, method, text) {
    const st = panes.get(paneId);
    if (!st || st.engine !== "codex")
      return { error: "Operação indisponível neste motor remoto." };
    try {
      await st.server.rpc.request(
        method === "compactar" ? "thread/compact/start" : "turn/steer",
        method === "compactar"
          ? { threadId: st.session }
          : {
              threadId: st.session,
              expectedTurnId: st.turn,
              input: [{ type: "text", text }],
            },
      );
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }
  async function query(remote, method, params = {}) {
    const s = server(remote);
    await s.ready;
    return s.rpc.request(method, params);
  }
  async function sessions(engine, remote) {
    try {
      const cached = store?.list(engine, remote) || [];
      if (engine === "gemini") {
        try {
          const nativeRows = JSON.parse(
            await transport.run(
              remote,
              native.script({ engine, action: "list" }),
            ),
          );
          return [
            ...nativeRows.map((n) => {
              const c = cached.find((c) => c.id === n.id && c.nomeCustomizado);
              return c ? { ...n, title: c.title } : n;
            }),
            ...cached.filter((c) => !nativeRows.some((n) => n.id === c.id)),
          ];
        } catch (e) {
          return cached.length
            ? {
                itens: cached,
                aviso:
                  "Lista nativa indisponível; exibindo registro do Cockpit. " +
                  e.message,
              }
            : { error: e.message };
        }
      }
      if (engine !== "codex") return cached;
      const r = await query(remote, "thread/list", { limit: 500 });
      const native = (r.data || r.threads || []).map((t) => ({
        engine,
        id: t.id,
        cwd: t.cwd,
        title: t.name || t.preview || "Conversa remota",
        when: (t.updatedAt || t.createdAt || 0) * 1000,
        file: "",
        remoto: true,
        destino: key(remote),
        origem: "servidor",
      }));
      return [
        ...native,
        ...cached.filter((c) => !native.some((n) => n.id === c.id)),
      ];
    } catch (e) {
      return { error: e.message };
    }
  }
  async function history(engine, remote, id) {
    const cached = store?.read(remote, engine, id);
    if (engine === "gemini") {
      try {
        return JSON.parse(
          await transport.run(
            remote,
            native.script({ engine, action: "history", id }),
          ),
        );
      } catch (e) {
        if (!cached) return { error: e.message };
      }
    }
    if (cached?.msgs?.length && engine !== "codex") return cached.msgs;
    if (engine !== "codex")
      return {
        error:
          "Não há registro desta sessão remota no Cockpit. Retomar usa o histórico do próprio motor no servidor.",
      };
    try {
      const r = await query(remote, "thread/read", {
        threadId: id,
        includeTurns: true,
      });
      const out = [];
      for (const turn of r.thread?.turns || [])
        for (const item of turn.items || []) {
          if (item.type === "agentMessage")
            out.push({ role: "bot", ...proto.normalizeAgentMessage(item) });
          else if (item.type === "userMessage")
            out.push({
              role: "user",
              text: (item.content || []).map((x) => x.text || "").join("\n"),
            });
          else if (item.type === "commandExecution")
            out.push({
              role: "tool",
              name: "Terminal",
              arg: item.command || "",
              text: item.aggregatedOutput || "",
            });
        }
      return out;
    } catch (e) {
      return cached?.msgs?.length ? cached.msgs : { error: e.message };
    }
  }
  async function rename(engine, remote, id, name) {
    if (engine === "codex")
      await query(remote, "thread/name/set", {
        threadId: id,
        name: name || null,
      });
    store?.rename?.(remote, engine, id, name);
    return true;
  }
  async function remove(engine, remote, id) {
    if (engine === "codex")
      await query(remote, "thread/archive", { threadId: id });
    else if (engine === "gemini")
      await transport.run(
        remote,
        native.script({ engine, action: "delete", id }),
      );
    store?.remove?.(remote, engine, id);
    return {
      ok: true,
      ...(engine === "grok" || engine === "acp"
        ? {
            aviso:
              "Removido apenas o registro do Cockpit; o agente mantém o histórico dele.",
          }
        : {}),
    };
  }
  async function fork(engine, remote, id, doFim) {
    try {
      if (engine === "gemini")
        return JSON.parse(
          await transport.run(
            remote,
            native.script({ engine, action: "fork", id, doFim }),
          ),
        );
      if (engine === "codex") {
        let cut = {};
        if (doFim != null && doFim >= 1) {
          const turns = await query(remote, "thread/turns/list", {
            threadId: id,
            sortDirection: "desc",
            limit: Math.min(500, Math.max(50, doFim + 5)),
          });
          const t = (turns.data || turns.turns || turns.items || [])[doFim - 1];
          if (!t)
            return { error: "Ponto de corte não encontrado no servidor." };
          cut = { lastTurnId: t.id || t.turnId };
        }
        const r = await query(remote, "thread/fork", { threadId: id, ...cut });
        const forked = r.thread?.id || r.threadId;
        return forked
          ? { id: forked }
          : { error: "Servidor não devolveu a conversa nova." };
      }
      return {
        error: "Este motor não oferece bifurcação pelo protocolo remoto.",
      };
    } catch (e) {
      return { error: e.message };
    }
  }
  async function setModel(paneId, modelId) {
    const st = panes.get(paneId);
    if (!st || st.engine !== "acp")
      return { error: "Agente ACP remoto indisponível." };
    try {
      await st.rpc.request("session/set_model", {
        sessionId: st.session,
        modelId,
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }
  async function close() {
    await Promise.allSettled([...panes.keys()].map(stop));
    for (const s of servers.values()) s.rpc.close();
    servers.clear();
  }
  return {
    start,
    send,
    interrupt,
    stop,
    operation,
    inspect,
    query,
    sessions,
    history,
    rename,
    remove,
    fork,
    setModel,
    approve,
    answer,
    questionOwns: (id) => questions.has(id),
    owns: (id) => panes.has(id),
    approvalOwns: (id) => approvals.has(id),
    close,
    panes,
    servers,
  };
}
module.exports = { createRemote };
