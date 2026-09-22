from pathlib import Path
import json, hashlib, sys
from graphify.detect import detect
from graphify.extract import extract
root=Path.cwd(); out=root/'graphify-out';out.mkdir(exist_ok=True)
(out/'.graphify_python').write_text(sys.executable,encoding='utf-8')
(out/'.graphify_root').write_text(str(root/'src'),encoding='utf-8')
detected=detect(root/'src',cache_root=root); (out/'.graphify_detect.json').write_text(json.dumps(detected,ensure_ascii=False),encoding='utf-8')
files=sorted(p for p in (root/'src').rglob('*') if p.is_file() and p.suffix in {'.js','.py'} and not {'vendor','node_modules','graphify-out'}.intersection(p.parts))
snapshot=[{'file':str(p.relative_to(root)).replace('\\','/'),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
result=extract(files,cache_root=root,root=root/'src',parallel=False)
(out/'.graphify_ast.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
(out/'audit-sources.json').write_text(json.dumps(snapshot,indent=2),encoding='utf-8')
print(json.dumps({'files':len(files),'nodes':len(result['nodes']),'edges':len(result['edges']),'scope':'codigo proprio JS/Python, incluindo audio, excluindo vendor/node_modules'}))


