// A conferencia da rodada 1 (caminhos vitais), pura (rodada 2 da leva 5i): recebe o que a sonda (sonda-vital.cjs) leu da tela e do disco e diz o que nao bate.
// Separada da sonda para ser testada sem Electron nem porta de depuracao (test/auditoria-janela-de-teste.test.js).
//
// A copia do perfil agora nasce SEM conversas (sanear-perfil.cjs): a tela abre com 0 paineis (a tela de abertura, "com quem voce vai trabalhar") e isso
// e' o ESPERADO. Painel aparecendo e' alarme: seria conversa de verdade na janela de teste. A trava da janela de teste (titulo, faixa vermelha e
// window.api.janelaDeTeste) tambem e' conferida: candidato sem ela e' falha grave (a sonda sai com o codigo 3).
'use strict';

const CODIGO_SEM_TRAVA = 3;

/* esperado: { abas, tema, visualMac, paineis } (lido do config da copia, antes de abrir o candidato)
   lido:     { tela, trava, gravou, disco, erros }
   Devolve { ok, falhas: [texto], semTrava } */
function conferirRodada1(esperado, lido) {
  const falhas = [];
  const { tela, trava, gravou, disco, erros } = lido || {};
  const t = tela || {};
  const semTrava = !(trava && trava.api === true && /^TESTE/.test(String(trava.titulo || '')) && trava.faixa === true);
  if (semTrava) falhas.push('a trava da janela de teste nao esta ligada (api.janelaDeTeste=' + (trava && trava.api) + ', titulo="' + (trava && trava.titulo) + '", faixa=' + (trava && trava.faixa) + ')');
  if (t.abas !== esperado.abas) falhas.push('abas na tela: ' + t.abas + ' (esperado ' + esperado.abas + ')');
  if (t.tema !== esperado.tema) falhas.push('tema na tela: ' + t.tema + ' (esperado ' + esperado.tema + ')');
  if (!!t.visualMac !== !!esperado.visualMac || !!t.htmlMac !== !!esperado.visualMac) falhas.push('visual Mac na tela: cfg=' + t.visualMac + ' html=' + t.htmlMac + ' (esperado ' + !!esperado.visualMac + ')');
  const paineisEsperados = esperado.paineis === undefined ? 0 : esperado.paineis;
  if (t.paineis !== paineisEsperados) falhas.push('paineis na tela: ' + t.paineis + ' (esperado ' + paineisEsperados + (paineisEsperados === 0 ? ': a copia nao tem conversa nenhuma' : '') + ')');
  if (t.erroSalvar === true) falhas.push('a tela mostrou o aviso "Reabra o Cockpit" (config nao salvou)');
  if (!(gravou && gravou.ok === true)) falhas.push('o setConfig nao gravou: ' + JSON.stringify(gravou));
  const d = disco || {};
  for (const [nome, arq] of [['config.json', d.config], ['config.json.bak', d.bak]]) {
    if (!arq || arq.erro) falhas.push(nome + ' nao abre depois de gravar: ' + JSON.stringify(arq));
    else {
      if (arq.abas !== esperado.abas) falhas.push(nome + ' no disco: ' + arq.abas + ' abas (esperado ' + esperado.abas + ')');
      if (arq.tema !== esperado.tema) falhas.push(nome + ' no disco: tema ' + arq.tema + ' (esperado ' + esperado.tema + ')');
    }
  }
  if (Array.isArray(d.outros) && d.outros.length) falhas.push('sobras ao lado do config.json: ' + d.outros.join(', '));
  if (Array.isArray(erros) && erros.length) falhas.push(erros.length + ' erro(s) no console');
  return { ok: falhas.length === 0, falhas, semTrava };
}

module.exports = { conferirRodada1, CODIGO_SEM_TRAVA };
