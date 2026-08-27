/* Roda a bateria inteira e devolve código de saída 1 se qualquer uma falhar. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const aqui = __dirname;
const testes = fs.readdirSync(aqui)
  .filter((f) => f.startsWith('teste-') && f.endsWith('.js'))
  .sort();

let falharam = 0;
for (const t of testes) {
  process.stdout.write(t.padEnd(30));
  try {
    execFileSync(process.execPath, [path.join(aqui, t)], { stdio: 'pipe' });
    console.log('ok');
  } catch (e) {
    falharam++;
    console.log('FALHOU');
    const saida = (e.stdout || Buffer.from('')).toString() + (e.stderr || Buffer.from('')).toString();
    console.log(saida.split('\n').filter((l) => /FALHA|Error|ESTOUROU/.test(l)).slice(0, 8).join('\n'));
  }
}

console.log('');
console.log(falharam ? falharam + ' de ' + testes.length + ' falharam' : testes.length + ' testes, todos passaram');
process.exit(falharam ? 1 : 0);
