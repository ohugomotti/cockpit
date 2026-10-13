// Confere os logos embutidos no acp-presets.js contra os SVGs oficiais do registro do ACP (leva 5i).
//
// O app nao baixa nada com ele aberto: os logos moram dentro do src/renderer/acp-presets.js. Este script e' o jeito de PROVAR que o que esta la'
// e' o desenho oficial, sem um digito trocado: le <pasta>/<id>.svg (o SVG de 16 px que o registro serve em cdn.agentclientprotocol.com) e compara,
// elemento por elemento, com LOGOS[id]. Ignora so' o que o app tira de proposito: os atributos do <svg> (xmlns, width, height, fill), o data-name
// dos elementos e a ordem dos atributos. Tudo o mais (o d= inteiro de cada path, os fill/stroke, o viewBox) tem que ser igual.
//
// Uso (pelo teto de memoria, como todo node de prova deste repositorio):
//   pwsh -NoProfile -File testes\com-teto.ps1 -Pasta <worktree> -Exe node -Linha 'tools\acp\conferir-logos.mjs <pasta-dos-svg>' -PorProcessoMB 1024 -TotalMB 2048 -TempoSeg 120
// Sai com codigo 1 se algum logo diferir.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IAS = require(path.join(raiz, 'src', 'renderer', 'acp-presets.js'));
const pasta = process.argv[2];
if (!pasta) { console.error('Uso: node tools/acp/conferir-logos.mjs <pasta-com-os-svg-oficiais>'); process.exit(2); }

const espaco = (s) => String(s).replace(/\s+/g, ' ').trim();
// {tag, attrs} de cada elemento do miolo, na ordem do arquivo
function elementos(miolo) {
  const saida = [];
  for (const m of String(miolo).matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*"[^"]*")*)\s*\/?>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) if (a[1] !== 'data-name') attrs[a[1]] = espaco(a[2]);
    saida.push({ tag: m[1].toLowerCase(), attrs });
  }
  return saida;
}
const chaves = (o) => Object.keys(o).sort();

let falhas = 0;
for (const ia of Object.keys(IAS.LOGOS).sort()) {
  const arquivo = path.join(pasta, ia + '.svg');
  if (!fs.existsSync(arquivo)) { console.log('FALTA  ' + ia + ': nao achei ' + arquivo); falhas++; continue; }
  const svg = fs.readFileSync(arquivo, 'utf8');
  const raizSvg = /<svg\b([^>]*)>/.exec(svg);
  const fim = svg.lastIndexOf('</svg>');
  if (!raizSvg || fim < 0) { console.log('TORTO  ' + ia + ': o arquivo nao e um <svg>…</svg>'); falhas++; continue; }
  const vbOficial = (/viewBox\s*=\s*"([^"]*)"/.exec(raizSvg[1]) || [])[1];
  const miolo = svg.slice(raizSvg.index + raizSvg[0].length, fim);
  const oficial = elementos(miolo), nosso = elementos(IAS.LOGOS[ia].corpo);
  const problemas = [];
  if (espaco(vbOficial) !== espaco(IAS.LOGOS[ia].vb)) problemas.push('viewBox: oficial "' + vbOficial + '", nosso "' + IAS.LOGOS[ia].vb + '"');
  if (oficial.length !== nosso.length) problemas.push('elementos: oficial ' + oficial.length + ', nosso ' + nosso.length);
  else oficial.forEach((o, i) => {
    const n = nosso[i];
    if (o.tag !== n.tag) problemas.push('elemento ' + (i + 1) + ': <' + o.tag + '> x <' + n.tag + '>');
    for (const k of new Set([...chaves(o.attrs), ...chaves(n.attrs)])) {
      if (o.attrs[k] !== n.attrs[k]) {
        const a = String(o.attrs[k]), b = String(n.attrs[k]);
        let d = 0; while (d < a.length && d < b.length && a[d] === b[d]) d++;
        problemas.push('elemento ' + (i + 1) + ' (' + o.tag + '), atributo ' + k + ': difere a partir do caractere ' + d + ' (oficial "' + a.slice(Math.max(0, d - 12), d + 20) + '", nosso "' + b.slice(Math.max(0, d - 12), d + 20) + '")');
      }
    }
  });
  if (problemas.length) { falhas++; console.log('DIFERE ' + ia + ':\n  - ' + problemas.join('\n  - ')); }
  else console.log('IGUAL  ' + ia + ' (' + oficial.length + ' elemento' + (oficial.length === 1 ? '' : 's') + ', viewBox ' + vbOficial + ')');
}
console.log(falhas ? '\n' + falhas + ' logo(s) com problema.' : '\nTodos os logos embutidos sao iguais aos oficiais.');
process.exitCode = falhas ? 1 : 0;
