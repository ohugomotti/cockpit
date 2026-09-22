"use strict";
// Somente apresentação. Decisões e escopos continuam nos adaptadores.
// Campos conferidos no schema emitido pelo CLI instalado em 20/09/2026.
const json = (value) => JSON.stringify(value, null, 2) || "";
function codexApprovalDetails(kind, params = {}, remote = false) {
  const reason = String(params.reason || "");
  if (["cmd", "command", "cmdLegado"].includes(kind)) {
    const command = Array.isArray(params.command) ? params.command.join(" ") : String(params.command || "");
    const detail = [command || "O motor não informou o comando neste pedido."];
    if (params.cwd) detail.push("em " + params.cwd);
    for (const name of ["networkApprovalContext", "proposedExecpolicyAmendment", "proposedNetworkPolicyAmendments"])
      if (params[name] != null) detail.push(name + ": " + json(params[name]));
    return { title: remote ? "Rodar comando no servidor" : "Rodar comando no seu computador", action: "command", target: params.cwd || "", detail: detail.join("\n"), reason };
  }
  if (kind === "perm") {
    return { title: remote ? "Pedir mais acesso ao servidor" : "Pedir mais acesso ao computador", action: "permissions", target: params.cwd || "", detail: json(params.permissions || {}), reason };
  }
  if (kind === "file" || kind === "fileLegado") {
    const changes = params.fileChanges && typeof params.fileChanges === "object" ? Object.entries(params.fileChanges) : [];
    const parts = changes.map(([file, change]) => {
      if (change?.type === "update" && typeof change.unified_diff === "string")
        return "Alterar " + file + (change.move_path ? " → " + change.move_path : "") + "\n" + change.unified_diff;
      if (["add", "delete"].includes(change?.type) && typeof change.content === "string")
        return (change.type === "add" ? "Criar " : "Excluir ") + file + "\n" + change.content;
      return file + "\n" + json(change);
    });
    if (params.grantRoot) parts.push("Acesso solicitado em " + params.grantRoot);
    // O pedido v2 só traz itemId; nunca fabricar um diff a partir desse ID.
    if (!changes.length) parts.push("O motor não forneceu o diff neste pedido.");
    return { title: "Alterar arquivos", action: "edit", target: changes.map(([file]) => file).join("\n") || params.grantRoot || "", detail: parts.join("\n\n"), reason };
  }
  return { title: "O motor pede permissão", detail: json(params), reason };
}
module.exports = { codexApprovalDetails };
