'use strict';

/* "Abrir no PC" nunca executa o que o agente escreveu (R3-06).

   O shell.openPath segue a associação do Windows: com o Python Launcher instalado, um .py gravado pelo agente RODA
   no clique de quem só queria ver o arquivo. Esta é a regra, pura (sem tocar no disco), que o main consulta antes de
   abrir: script e executável só aparecem na pasta ('revelar'); o resto abre normal ('abrir'). */

const EXT_REVELAR = new Set([
  // interpretadores e scripts: o Windows (ou o Python Launcher, o Node, o PHP...) executa em vez de abrir num editor
  'py', 'pyw', 'rb', 'php', 'lua', 'r', 'pl', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'sh',
  // programas, instaladores, atalhos e o que mexe no registro
  'bat', 'cmd', 'com', 'exe', 'msi', 'scr', 'hta', 'cpl', 'lnk', 'reg', 'jar',
]);

/* A extensão como o Windows enxerga: o último pedaço do caminho (barra comum ou invertida), sem ponto nem espaço no
   fim ("a.py." e "a.py " são a.py), e ".bat" (só a extensão) vale como .bat. */
function extensaoDe(caminho) {
  const nome = String(caminho == null ? '' : caminho).split(/[\\/]/).pop().replace(/[. ]+$/, '');
  const ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase();
}

function decidirAbertura(caminho) {
  return EXT_REVELAR.has(extensaoDe(caminho)) ? 'revelar' : 'abrir';
}

module.exports = { decidirAbertura };
