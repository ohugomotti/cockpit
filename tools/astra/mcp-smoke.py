"""Cliente MCP real para validar as pontes locais sem chamar um modelo."""
import argparse
import asyncio
import base64
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"
WINDOWS_EXE = Path.home() / "Projetos-Codex/cockpit-integracoes/windows-mcp-0.8.5/Scripts/windows-mcp.exe"
UI_TOOLS = "App,Click,Move,Scroll,Shortcut,Snapshot,Screenshot,Type,Wait"


async def run(target, interactive):
    env = dict(os.environ, ANONYMIZED_TELEMETRY="false", PYTHONUTF8="1")
    if target == "windows":
        params = StdioServerParameters(command=str(WINDOWS_EXE), args=[
            "serve", "--transport", "stdio", "--tools", UI_TOOLS,
        ], env=env)
    else:
        params = StdioServerParameters(
            command=r"C:\Program Files\PowerShell\7\pwsh.exe",
            args=["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
                  str(Path.home() / ".claude/chrome-logado/chrome-mcp.ps1")], env=env)
    ARTIFACTS.mkdir(exist_ok=True)
    with (ARTIFACTS / f"{target}-mcp-stderr.log").open("w", encoding="utf-8") as errlog:
        async with stdio_client(params, errlog=errlog) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.list_tools()
                tools = [tool.model_dump(mode="json", by_alias=True) for tool in result.tools]
                (ARTIFACTS / f"{target}-mcp-tools.json").write_text(
                    json.dumps(tools, ensure_ascii=False, indent=2), encoding="utf-8")
                names = [tool["name"] for tool in tools]
                if target == "windows" and set(names) != set(UI_TOOLS.split(",")):
                    raise RuntimeError(f"Conjunto de ferramentas inesperado: {names}")
                if target == "chrome" and "list_pages" not in names:
                    raise RuntimeError("Chrome nao disponibilizou list_pages")
                print(json.dumps({"connected": target, "tools": names}), flush=True)
                if not interactive:
                    return
                counter = 0
                while True:
                    line = await asyncio.to_thread(sys.stdin.readline)
                    if not line or line.strip() == "quit":
                        break
                    request = json.loads(line)
                    counter += 1
                    result = await session.call_tool(request["name"], request.get("arguments", {}))
                    output = result.model_dump(mode="json", by_alias=True)
                    output_path = ARTIFACTS / f"{target}-mcp-result-{counter}.json"
                    output_path.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
                    summary = []
                    for block in output.get("content", []):
                        if block.get("type") == "image":
                            extension = "png" if block.get("mimeType") == "image/png" else "jpg"
                            image_path = ARTIFACTS / f"{target}-mcp-{counter}.{extension}"
                            image_path.write_bytes(base64.b64decode(block["data"]))
                            summary.append({"image": str(image_path)})
                        elif block.get("type") == "text":
                            summary.append({"text": block["text"][:18000]})
                    print(json.dumps({"isError": output.get("isError", False),
                                      "result": str(output_path), "content": summary}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=["windows", "chrome"])
    parser.add_argument("--interactive", action="store_true")
    options = parser.parse_args()
    asyncio.run(run(options.target, options.interactive))
