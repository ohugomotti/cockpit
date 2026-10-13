// Roda cada test/*.test.js num "node --test" proprio, K por vez, com limite de tempo por arquivo.
// O resultado vai sendo gravado em <saida> (JSON) a cada arquivo: se o job morrer, a proxima chamada continua de onde parou.
// Por que: a suite inteira num "node --test" so' as vezes trava a 100% de CPU (leitor-imagens-md, trecho-selecionado e outros, intermitente)
// e nao termina; arquivo por arquivo, o travado morre no limite e os outros seguem (10/10: 190 arquivos em 61 s).
// Uso (pelo teto): pwsh -NoProfile -File testes\com-teto.ps1 -Pasta <repo> -Exe node -Linha 'testes\suite-por-arquivo.mjs <repo> <saida.json> 3 150' -TotalMB 3072 -TempoSeg 570
// Argumentos: <pasta do repo> <saida.json> [K=3] [limite em s=150] [lista,de,arquivos]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , pasta, saida, conc = '3', limite = '150', so = ''] = process.argv;
const K = Number(conc), LIM = Number(limite) * 1000;
const todos = fs.readdirSync(path.join(pasta, 'test')).filter((f) => f.endsWith('.test.js')).sort();
let feitos = {};
try { feitos = JSON.parse(fs.readFileSync(saida, 'utf8')); } catch {}
const lista = so ? so.split(',').map((s) => s.trim()).filter(Boolean) : todos.filter((f) => !(f in feitos));
const gravar = () => fs.writeFileSync(saida, JSON.stringify(feitos, null, 1));

function rodar(f) {
  return new Promise((res) => {
    const t0 = Date.now();
    let out = '', morto = false;
    const ch = spawn(process.execPath, ['--test', '--test-reporter=spec', path.join('test', f)], { cwd: pasta, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const juntar = (d) => { out += d; if (out.length > 4e6) out = out.slice(-2e6); };
    ch.stdout.on('data', juntar);
    ch.stderr.on('data', juntar);
    const timer = setTimeout(() => {
      morto = true;
      try { execFileSync('taskkill', ['/T', '/F', '/PID', String(ch.pid)], { stdio: 'ignore' }); } catch {}
    }, LIM);
    ch.on('close', (code) => {
      clearTimeout(timer);
      const num = (k) => { const m = out.match(new RegExp('ℹ ' + k + ' (\\d+)')); return m ? Number(m[1]) : null; };
      const falhas = [...new Set(out.split(/\r?\n/).filter((l) => /^\s*✖/.test(l)).map((l) => l.trim().slice(0, 160)))].slice(0, 8);
      const r = { estado: morto ? 'tempo' : (code === 0 ? 'ok' : 'falhou'), codigo: code, s: Math.round((Date.now() - t0) / 1000),
        tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped'), todo: num('todo'), falhas };
      if (r.estado !== 'ok') r.fim = out.slice(-1500);
      feitos[f] = r;
      gravar();
      res(r);
    });
  });
}

const t0 = Date.now();
let i = 0;
async function trabalhador() {
  while (i < lista.length) {
    const f = lista[i++];
    const r = await rodar(f);
    if (r.estado !== 'ok') console.log(`${r.estado.toUpperCase()} ${f} (${r.s} s) fail=${r.fail}`);
  }
}
await Promise.all(Array.from({ length: Math.min(K, lista.length) }, trabalhador));

const v = Object.entries(feitos);
const soma = (k) => v.reduce((a, [, r]) => a + (r[k] || 0), 0);
const ruins = v.filter(([, r]) => r.estado !== 'ok');
console.log(`rodados agora: ${lista.length} em ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(`arquivos: ${v.length}/${todos.length} | ok ${v.length - ruins.length} | falhou ${ruins.filter(([, r]) => r.estado === 'falhou').length} | tempo ${ruins.filter(([, r]) => r.estado === 'tempo').length}`);
console.log(`testes: ${soma('tests')} | pass ${soma('pass')} | fail ${soma('fail')} | skipped ${soma('skipped')} | todo ${soma('todo')}`);
for (const [f, r] of ruins) console.log(` - ${r.estado} ${f} (${r.s} s): ${r.falhas.join(' | ') || '(sem linha de falha)'}`);
const faltam = todos.filter((f) => !(f in feitos));
if (faltam.length) console.log(`FALTAM ${faltam.length}: ${faltam.slice(0, 12).join(', ')}${faltam.length > 12 ? ' ...' : ''}`);
