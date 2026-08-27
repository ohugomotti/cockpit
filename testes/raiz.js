/* Onde fica a raiz do projeto (a pasta que tem src/main.js).

   Os testes rodam de dois lugares: da raiz, durante o desenvolvimento, e de
   dentro de testes/ aqui no repositorio. Em vez de cada um adivinhar, sobe os
   diretorios ate achar o src/ de verdade. */
const fs = require('fs');
const path = require('path');

function raizDoProjeto(comeco) {
  let d = comeco || __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'src', 'main.js'))) return d;
    const acima = path.dirname(d);
    if (acima === d) break;
    d = acima;
  }
  return comeco || __dirname;
}

const RAIZ = raizDoProjeto();

/* Alguns testes comparam com uma copia anterior do codigo (src-original,
   src-antes-leva18...) pra provar que o bug existia. Essas copias ficam na
   maquina de quem corrigiu, nao no repositorio - entao aqui elas sao
   OPCIONAIS: quem nao achar, pula a comparacao em vez de quebrar. */
function versaoAnterior(nome) {
  const p = path.join(RAIZ, nome);
  return fs.existsSync(path.join(p, 'renderer', 'app.js')) || fs.existsSync(path.join(p, 'main.js')) ? p : null;
}

module.exports = { RAIZ, raizDoProjeto, versaoAnterior };
