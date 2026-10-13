'use strict';
/* Compara duas sondas (tools/electron44/resultado-<versão>.json) e grava
   tools/electron44/diferencas.json. Leva 0, tarefa L0-a.

   Uso:  node tools/electron44/comparar.cjs [antigo.json] [novo.json]
         (padrão: resultado-32.3.3.json x resultado-44.5.1.json)

   Lista: membro que SUMIU, membro que APARECEU (o Cockpit já o usava com ?.),
   typeof que MUDOU, length que mudou, chamada que passou de síncrona para
   PROMISE, chamada que PASSOU A FALHAR e tipo de retorno que mudou. Cada item
   traz os arquivo:linha do Cockpit (do inventario.json) que usam aquela API.

   Conferência obrigatória (do brief): tem que acusar clipboard.readImage
   (sumiu) e clipboard.readText (síncrono -> Promise). Se não acusar, a sonda
   está errada e o comando sai com código 1. */

const fs = require('node:fs');
const path = require('node:path');

const AQUI = __dirname;
// "arguments"/"caller" são propriedades de função em modo não estrito: ruído.
const RUIDO = new Set(['arguments', 'caller', 'length', 'name', 'prototype']);
const apiDe = (x) => x.modulo + (x.instancia ? '#' : '.') + x.membro;

function usosNoInventario(inventario) {
  const mapa = new Map();
  for (const i of (inventario && inventario.itens) || []) {
    const api = apiDe(i);
    if (!mapa.has(api)) mapa.set(api, new Set());
    mapa.get(api).add(i.arquivo + ':' + i.linha);
  }
  return (api) => [...(mapa.get(api) || [])];
}

function comparar(antigo, novo, inventario = null) {
  const usos = usosNoInventario(inventario);
  const saida = {
    de: antigo.electron, para: novo.electron,
    chrome: { de: antigo.chrome || null, para: novo.chrome || null },
    node: { de: antigo.node || null, para: novo.node || null },
    sumiu: [], apareceu: [], mudouTypeof: [], mudouAridade: [],
    virouPromise: [], passouAFalhar: [], voltouAFuncionar: [], mudouTipoRetorno: [],
    naoVerificaveis: [], disponiveis: {}, extras: { de: antigo.extras || {}, para: novo.extras || {} },
  };
  const novos = new Map((novo.membros || []).map((m) => [apiDe(m), m]));
  for (const a of antigo.membros || []) {
    const api = apiDe(a);
    const n = novos.get(api);
    const base = { api, modulo: a.modulo, membro: a.membro, instancia: !!a.instancia };
    if (!n || a.verificavel === false || n.verificavel === false) {
      saida.naoVerificaveis.push({ ...base, motivo: (n && n.motivo) || a.motivo || 'ausente numa das sondas', usos: usos(api) });
      continue;
    }
    const de = { existe: a.existe, typeof: a.typeof, length: a.length };
    const para = { existe: n.existe, typeof: n.typeof, length: n.length };
    if (a.existe && !n.existe) saida.sumiu.push({ ...base, de, para, usos: usos(api) });
    else if (!a.existe && n.existe) saida.apareceu.push({ ...base, de, para, usos: usos(api) });
    else if (a.typeof !== n.typeof) saida.mudouTypeof.push({ ...base, de, para, usos: usos(api) });
    else if (a.length !== n.length) saida.mudouAridade.push({ ...base, de, para, usos: usos(api) });
  }
  const chamadasNovas = new Map((novo.chamadas || []).map((c) => [c.id, c]));
  for (const a of antigo.chamadas || []) {
    const n = chamadasNovas.get(a.id);
    if (!n) continue;
    const api = apiDe(a);
    const base = { api, chamada: a.id, usos: usos(api) };
    if (a.ok && n.ok && !a.promise && n.promise) saida.virouPromise.push({ ...base, tipoAntes: a.tipo, tipoResolvidoAgora: n.tipo });
    if (a.ok && !n.ok) saida.passouAFalhar.push({ ...base, tipoAntes: a.tipo, erroAgora: n.erro });
    if (!a.ok && n.ok) saida.voltouAFuncionar.push({ ...base, erroAntes: a.erro, tipoAgora: n.tipo });
    if (a.ok && n.ok && a.tipo !== n.tipo) saida.mudouTipoRetorno.push({ ...base, de: a.tipo, para: n.tipo });
  }
  const da = antigo.disponiveis || {}, dn = novo.disponiveis || {};
  for (const nome of [...new Set([...Object.keys(da), ...Object.keys(dn)])].sort()) {
    const A = new Set(Array.isArray(da[nome]) ? da[nome] : []), N = new Set(Array.isArray(dn[nome]) ? dn[nome] : []);
    const sumiram = [...A].filter((x) => !N.has(x) && !RUIDO.has(x)).sort();
    const novosNomes = [...N].filter((x) => !A.has(x) && !RUIDO.has(x)).sort();
    if (sumiram.length || novosNomes.length) saida.disponiveis[nome] = { sumiram, novos: novosNomes };
  }
  const readImageSumiu = saida.sumiu.some((x) => x.api === 'clipboard.readImage');
  const readTextVirouPromise = saida.virouPromise.some((x) => x.api === 'clipboard.readText');
  saida.conferencia = { readImageSumiu, readTextVirouPromise, ok: readImageSumiu && readTextVirouPromise };
  return saida;
}

module.exports = { comparar };

if (require.main === module) {
  const [arqA, arqB] = process.argv.slice(2);
  const ler = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const antigo = ler(arqA || path.join(AQUI, 'resultado-32.3.3.json'));
  const novo = ler(arqB || path.join(AQUI, 'resultado-44.5.1.json'));
  const inventario = ler(path.join(AQUI, 'inventario.json'));
  const d = comparar(antigo, novo, inventario);
  fs.writeFileSync(path.join(AQUI, 'diferencas.json'), JSON.stringify(d, null, 2) + '\n');
  const lista = (xs) => xs.map((x) => x.api).join(', ') || '-';
  console.log('Electron ' + d.de + ' -> ' + d.para + ' (Chromium ' + d.chrome.de + ' -> ' + d.chrome.para + ')');
  console.log('sumiu: ' + lista(d.sumiu));
  console.log('apareceu: ' + lista(d.apareceu));
  console.log('mudou typeof: ' + lista(d.mudouTypeof) + ' | mudou length: ' + lista(d.mudouAridade));
  console.log('virou Promise: ' + lista(d.virouPromise));
  console.log('passou a falhar: ' + lista(d.passouAFalhar));
  console.log('mudou tipo do retorno: ' + d.mudouTipoRetorno.map((x) => x.chamada + ' ' + x.de + '->' + x.para).join(', '));
  console.log('conferência obrigatória: ' + (d.conferencia.ok ? 'OK' : 'FALHOU') + ' ' + JSON.stringify(d.conferencia));
  if (!d.conferencia.ok) process.exit(1);
}
