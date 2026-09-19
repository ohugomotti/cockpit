"""Aplica somente as pontes compartilhadas e corrige caminhos; preserva o resto."""
import copy
import json
import os
import re
import shutil
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOME_DIR = Path.home()
BACKUP = ROOT / ".local-backup"
CHROME_SCRIPT = HOME_DIR / ".claude/chrome-logado/chrome-mcp.ps1"
WIN_EXE = HOME_DIR / "Projetos-Codex/cockpit-integracoes/windows-mcp-0.8.5/Scripts/windows-mcp.exe"
SHARED_DOC = HOME_DIR / "Projetos-Codex/cockpit-integracoes/AMBIENTE-COMPARTILHADO.md"
POWERSHELL = r"C:\Program Files\PowerShell\7\pwsh.exe"
UI_TOOLS = "App,Click,Move,Scroll,Shortcut,Snapshot,Screenshot,Type,Wait"


def write_safe(path, before, after, backup_name):
    if before == after:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_text(encoding="utf-8-sig") != before:
            raise RuntimeError(f"Arquivo mudou durante a preparacao: {path}")
        backup_path = BACKUP / backup_name
        if not backup_path.exists():
            shutil.copy2(path, backup_path)
    elif before:
        raise RuntimeError(f"Arquivo desapareceu: {path}")
    staged = path.with_name(path.name + ".astra-tmp")
    staged.write_text(after, encoding="utf-8", newline="\n")
    os.replace(staged, path)
    print(f"Atualizado: {path}")


def section(text, name, values):
    pattern = re.compile(r"(?ms)^\[" + re.escape(name) + r"\]\s*\n.*?(?=^\[|\Z)")
    match = pattern.search(text)
    old = match.group(0) if match else f"[{name}]\n"
    new = old.rstrip() + "\n"
    for key, value in values.items():
        assignment = f"{key} = {json.dumps(value, ensure_ascii=False)}"
        key_pattern = re.compile(r"(?m)^" + re.escape(key) + r"\s*=.*$")
        if key_pattern.search(new):
            new = key_pattern.sub(lambda _: assignment, new)
        else:
            new += assignment + "\n"
    new += "\n"
    return text[:match.start()] + new + text[match.end():] if match else text.rstrip() + "\n\n" + new


def main():
    # Manter os nomes usados pela tarefa agendada existente.
    for source_name, installed_name in (("iniciar-chrome.ps1", "iniciar.ps1"),
                                        ("chrome-mcp.ps1", "chrome-mcp.ps1")):
        source = Path(__file__).resolve().parent / source_name
        target = CHROME_SCRIPT.parent / installed_name
        before = target.read_text(encoding="utf-8-sig") if target.exists() else ""
        write_safe(target, before, source.read_text(encoding="utf-8-sig"), "chrome-" + installed_name)
    for required in (CHROME_SCRIPT, WIN_EXE, Path(POWERSHELL)):
        if not required.is_file():
            raise RuntimeError(f"Dependencia nao validada: {required}")
    chrome = {"command": POWERSHELL, "args": ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(CHROME_SCRIPT)]}
    windows = {"command": str(WIN_EXE), "args": ["serve", "--transport", "stdio", "--tools", UI_TOOLS],
               "env": {"ANONYMIZED_TELEMETRY": "false", "PYTHONUTF8": "1"}}

    path = HOME_DIR / ".codex/config.toml"
    before = path.read_text(encoding="utf-8-sig")
    old_config = tomllib.loads(before)
    after = section(before, "mcp_servers.chrome-logado", {**chrome, "startup_timeout_sec": 45})
    after = section(after, "mcp_servers.windows-mcp", {"command": windows["command"], "args": windows["args"],
                                                     "startup_timeout_sec": 45, "tool_timeout_sec": 90})
    after = section(after, "mcp_servers.windows-mcp.env", windows["env"])
    new_config = tomllib.loads(after)
    for name in ("chrome-logado", "windows-mcp"):
        if any(k in new_config["mcp_servers"][name] for k in ("url", "http_headers", "bearer_token_env_var")):
            raise RuntimeError(f"Transporte HTTP anterior conflita com stdio: {name}")
    for config in (old_config, new_config):
        for name in ("chrome-logado", "windows-mcp"):
            config.get("mcp_servers", {}).pop(name, None)
    if old_config != new_config:
        raise RuntimeError("Configuracao Codex fora das duas pontes seria alterada")
    write_safe(path, before, after, "codex-config.toml")

    path = HOME_DIR / ".claude.json"
    before = path.read_text(encoding="utf-8-sig")
    config = json.loads(before)
    config.setdefault("mcpServers", {})
    config["mcpServers"]["chrome-logado"] = {**config["mcpServers"].get("chrome-logado", {}), **chrome}
    config["mcpServers"]["windows-mcp"] = {**config["mcpServers"].get("windows-mcp", {}), **windows}
    for name in ("chrome-logado", "windows-mcp"):
        bridge = config["mcpServers"][name]
        if "url" in bridge or bridge.get("type", "stdio") != "stdio":
            raise RuntimeError(f"Transporte anterior conflita com stdio: {name}")
    after = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    comparison_old = json.loads(before)
    comparison_new = copy.deepcopy(config)
    for item in (comparison_old, comparison_new):
        for name in ("chrome-logado", "windows-mcp"):
            item.get("mcpServers", {}).pop(name, None)
    if comparison_old != comparison_new:
        raise RuntimeError("Configuracao Claude fora das duas pontes seria alterada")
    write_safe(path, before, after, "claude-config-original.json")

    shared_text = f"""# Ambiente compartilhado — Cockpit, Codex e Claude

- Navegador: MCP `chrome-logado`. O wrapper `{CHROME_SCRIPT}` verifica/inicia o Chrome antes de ligar o MCP. Perfil existente: `{HOME_DIR / '.claude/chrome-logado/perfil'}`. Porta somente local: 9222. Nao copiar o perfil nem criar outro.
- Windows no Cockpit: MCP `windows-mcp`, servidor stdio Windows-MCP 0.8.5 em ambiente Python isolado. Ferramentas de tela: {UI_TOOLS}. Telemetria desativada. Shell/Registro/arquivos desse MCP nao estao habilitados; use os recursos proprios do motor para comandos e arquivos.
- Observar com Snapshot antes de agir; usar Screenshot quando bastar a imagem. Usar elementos ou coordenadas da observacao atual e conferir o resultado. Abrir somente aplicativos necessarios a tarefa autorizada. Nao usar a interface do terminal para executar comandos.
- Sessao bloqueada, tela segura e janelas elevadas podem impedir o controle. Nao tentar contornar protecoes ou usar credenciais de outro aplicativo.
- O Computer Use nativo da OpenAI depende do aplicativo desktop oficial; no Cockpit, nao insistir em @oai/sky quando informar native pipe indisponivel. A ponte Windows-MCP e independente e tambem funciona no Claude.
- Configuracoes: `{HOME_DIR / '.codex/config.toml'}` e `{HOME_DIR / '.claude.json'}`. Cada motor mantem seus conectores, logins e permissoes. Usam o mesmo Chrome e o mesmo executavel Windows-MCP.
- Pastas: projetos novos do Codex em `Projetos-Codex`; projetos existentes do Claude continuam em `Projetos-claude`. Para alterar o Cockpit, usar worktree do repositorio atual, preservar as mudancas do outro motor e comparar com o pacote instalado.
- Mapa de tarefas do time: `{HOME_DIR / '.claude/ROTEAMENTO.md'}`. Conferir disponibilidade real; anotacoes antigas nao comprovam que uma integracao responde hoje.
- Memoria Codex: `{HOME_DIR / '.codex/memories/MEMORY.md'}`. Referencia compartilhada do Claude: `{HOME_DIR / '.claude/projects/C--Users-hugom/memory/MEMORY.md'}`. Memorias so devem ser atualizadas quando o usuario pedir explicitamente.
"""
    before = SHARED_DOC.read_text(encoding="utf-8-sig") if SHARED_DOC.exists() else ""
    write_safe(SHARED_DOC, before, shared_text, "ambiente-compartilhado-anterior.md")
    common_block = f"\n## Cockpit: Codex e Claude\n\nPara operar o Windows e o navegador dentro do Cockpit, consultar `{SHARED_DOC}`. As pontes sao compartilhadas; preservar logins e escolhas de cada motor. No Codex, o rodape Use deve identificar o modelo real, por exemplo GPT-6 Astra, sem usar uma sigla de Claude.\n"

    for path, backup_name in ((HOME_DIR / ".codex/AGENTS.md", "codex-AGENTS.md"),
                              (HOME_DIR / "AGENTS.md", "home-AGENTS.md"),
                              (HOME_DIR / ".claude/CLAUDE.md", "claude-CLAUDE.md")):
        before = path.read_text(encoding="utf-8-sig")
        after = before
        if path.name == "AGENTS.md":
            after = after.replace(str(HOME_DIR) + "\\.Codex\\projects\\C--Users-hugom\\memory\\", str(HOME_DIR) + "\\.codex\\memories\\")
            after = after.replace(r".Codex\homero-memory", r".claude\homero-memory")
            after = after.replace(r".Codex\chrome-logado\perfil", r".claude\chrome-logado\perfil")
            after = after.replace(r".Codex\skills\graphify\SKILL.md", r".agents\skills\graphify\SKILL.md")
        if "## Cockpit: Codex e Claude" not in after:
            after = after.rstrip() + "\n" + common_block
        write_safe(path, before, after, backup_name)

    path = HOME_DIR / ".codex/ROTEAMENTO.md"
    before = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    if not before:
        text = f"# Roteamento do Codex no Cockpit\n\n1. Para Windows/navegador, ler `{SHARED_DOC}`.\n2. Para tarefas do time, consultar o mapa compartilhado `{HOME_DIR / '.claude/ROTEAMENTO.md'}` e as skills realmente disponiveis neste motor.\n3. Para memoria, usar `{HOME_DIR / '.codex/memories/MEMORY.md'}`; registros do Claude sao referencia e precisam de verificacao quando puderem ter mudado.\n4. Nao duplicar perfis do Chrome, logins ou conectores ja configurados.\n"
        write_safe(path, before, text, "codex-ROTEAMENTO-anterior.md")

    print("Conferido: configuracoes fora das duas pontes preservadas; JSON/TOML validos.")


if __name__ == "__main__":
    main()
