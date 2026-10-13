'use strict';
// Leva 2, Fix C item 5: o main devolve tipo 'credencial' para arquivo de segredo
// (.env, id_rsa, *.pem…); o visor mostra o recado próprio com "Abrir no programa",
// nunca o conteúdo e nunca o recado genérico "Este tipo não abre aqui dentro".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

test('visor: tipo credencial tem recado próprio com Abrir no programa, antes do ramo grande', () => {
  const credencial = app.indexOf("a.tipo === 'credencial'");
  const grande = app.indexOf("a.tipo === 'grande'");
  assert.ok(credencial > 0, 'falta o ramo do tipo credencial no verArquivo');
  assert.ok(credencial < grande, 'o ramo credencial vem antes do grande');
  const linha = app.slice(credencial, app.indexOf('\n', credencial));
  assert.match(linha, /recadoComPrograma\(/);
  assert.match(linha, /Arquivo de credenciais: não mostro aqui\./);
  assert.match(linha, /abrirNoPrograma/);
});
