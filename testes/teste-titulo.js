/* O nome da conversa vem da primeira mensagem. A auditoria pegou esta funcao
   devolvendo "Mim", "Isso" e a URL crua - estes casos travam isso. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { RAIZ, versaoAnterior } = require('./raiz');
const appTxt = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'app.js'), 'utf8');

function pegar(txt, assinatura, nome) {
  const i = txt.indexOf(assinatura);
  if (i < 0) throw new Error('nao achei ' + nome);
  let j = txt.indexOf('{', i), nivel = 0;
  for (let k = j; k < txt.length; k++) {
    if (txt[k] === '{') nivel++;
    else if (txt[k] === '}') { nivel--; if (nivel === 0) return txt.slice(i, k + 1); }
  }
  throw new Error('nao fechei ' + nome);
}

const ctx = { console };
vm.createContext(ctx);
// a lista de palavras sem conteudo vem junto
const i = appTxt.indexOf('const PALAVRA_VAZIA');
const j = appTxt.indexOf('function tituloCurto');
vm.runInContext(appTxt.slice(i, j), ctx);
vm.runInContext(pegar(appTxt, 'function tituloCurto(', 'tituloCurto'), ctx);

let falhas = 0;
const NL = String.fromCharCode(10);
function checa(nome, cond, det) {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
}

const t = (x) => ctx.tituloCurto(x);

console.log(NL + 'O que o titulo NUNCA pode ser');
{
  // mensagem que e' so' link/caminho/codigo: melhor ficar sem nome do que
  // carimbar a URL crua - o titulo do Claude Code assume depois
  const soLink = t('https://previdenciaaoquadrado.com/oficina-0926');
  checa('link sozinho nao vira titulo', soLink === '', JSON.stringify(soLink));

  const soCaminho = t('C:\\Users\\hugom\\Projetos-claude\\nexfin-erp\\src\\main.js');
  checa('caminho sozinho nao vira titulo', soCaminho === '', JSON.stringify(soCaminho));

  const soCodigo = t('```js' + NL + 'const a = 1;' + NL + '```');
  checa('bloco de codigo nao vira titulo', soCodigo === '', JSON.stringify(soCodigo));

  const soEspaco = t('   ' + NL + NL + '   ');
  checa('so espaco nao vira titulo', soEspaco === '', JSON.stringify(soEspaco));

  checa('texto vazio nao vira titulo', t('') === '' && t(null) === '', 'vazio/null');
}

console.log(NL + 'A frase nao pode ser embaralhada');
{
  const a = t('faz isso pra mim');
  checa('"faz isso pra mim" nao vira "Mim"', a.toLowerCase() !== 'mim', JSON.stringify(a));

  const b = t('eu quero que voce veja isso');
  checa('nao sobra so a ultima palavra', b.split(' ').length > 1 || b.toLowerCase() !== 'isso', JSON.stringify(b));

  const c = t('quero que voce me ajude a arrumar o rodape da pagina de vendas');
  checa('nao termina em palavra solta ("da", "de", "o")',
    !/\s(da|de|do|o|a|em|para|com|que)$/i.test(c), JSON.stringify(c));
}

console.log(NL + 'Pontuacao e tamanho');
{
  const a = t('Corrija o bug!!!');
  checa('nao sobra pontuacao pendurada', !/[!?.,;:\-]$/.test(a), JSON.stringify(a));

  const b = t('arruma o rodape da pagina, o botao esta desalinhado e a cor errada');
  checa('no maximo 5 palavras', b.split(' ').length <= 5, JSON.stringify(b));
  checa('no maximo 48 letras', b.length <= 48, b.length + ' letras');

  const c = t('Analise');
  checa('uma palavra so funciona', c === 'Analise', JSON.stringify(c));
}

console.log(NL + 'Casos reais das conversas do Hugo');
{
  const casos = [
    'tenho várias correções pra fazer nesse cockpit e preciso que você corrija todos eles',
    'em downloads tem uma pasta com vários PDFs, são PDFs de contratos',
    'faz uma planilha bonita com essas senhas e sobe na pasta apropriada',
    'Conseguimos conectar a API do bradesco?',
    'quero que revise todos os clientes e veja quais estão sem tráfego',
  ];
  for (const c of casos) {
    const r = t(c);
    const ok = r && r.length >= 3 && r.length <= 48 && r.split(' ').length <= 5;
    checa(JSON.stringify(c.slice(0, 34) + '…') + ' -> ' + JSON.stringify(r), ok, '');
  }
}

console.log(NL + 'Comeca com maiuscula e sem quebra de linha');
{
  const a = t('arruma o rodape');
  checa('primeira letra maiuscula', a[0] === a[0].toUpperCase(), JSON.stringify(a));
  const b = t('primeira linha' + NL + 'segunda linha');
  checa('nao leva quebra de linha', !b.includes(NL), JSON.stringify(b));
}

console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'todos os casos passaram'));
process.exit(falhas ? 1 : 0);
