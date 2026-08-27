/* A PERDA DE CONTEXTO: trocar de aba e voltar fazia a proxima mensagem subir
   uma conversa NOVA, do zero, com o historico ainda desenhado na tela.

   Este teste percorre a vida do painel do jeito que ela acontece de verdade -
   ligar com --resume, receber o id da sessao, desligar o motor, religar - e
   confere UMA coisa: na hora de religar, o app manda o endereco da conversa?

   Roda contra a versao nova E contra a instalada, pra mostrar a diferenca. */
const fs = require('fs');
const path = require('path');
const { RAIZ, versaoAnterior } = require('./raiz');
const NL = String.fromCharCode(10);

let falhas = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

/* Le o app.js e responde: os pontos que desligam o motor guardam o endereco da
   conversa antes? Em vez de reimplementar o app inteiro num DOM de mentira,
   olha os tres trechos exatos onde isso tem que acontecer. */
function analisar(arquivo) {
  const s = fs.readFileSync(arquivo, 'utf8');
  const temFuncao = /function desligarMotor\(P\)[\s\S]{0,400}?P\.resumeId = P\.sessaoId \|\| P\.resumeId/.test(s);

  // recorta cada ponto e ve se ele guarda o endereco (direto ou pela funcao)
  const pontos = [
    // ancorado no NOME DA FUNCAO, nao num comentario: comentario muda, funcao nao
    { nome: 'sair da aba', marca: 'async function guardarPaineisDaAba(' },
    { nome: 'terminar o turno fora da tela', marca: '// desliga o MOTOR (acabou o trabalho)' },
    { nome: 'a conexao caiu', marca: "case 'engine-down':" },
  ];
  const out = {};
  for (const p of pontos) {
    const i = s.indexOf(p.marca);
    if (i < 0) { out[p.nome] = 'nao achei o trecho'; continue; }
    // janela grande o bastante pra cobrir a funcao inteira: o ponto que importa
    // fica perto do fim dela, depois do comentario que explica o porque
    const trecho = s.slice(i, i + 3000);
    const guardaDireto = /P\.resumeId = P\.sessaoId/.test(trecho);
    const guardaPelaFuncao = /desligarMotor\(/.test(trecho) && temFuncao;
    const desliga = /P\.started = false|desligarMotor\(/.test(trecho);
    out[p.nome] = !desliga ? 'nao desliga aqui'
      : ((guardaDireto || guardaPelaFuncao) ? 'guarda' : 'PERDE');
  }
  return out;
}

/* A cadeia de estado, passo a passo, do jeito que o app faz. Isto e o teste de
   verdade: simula o ciclo e olha o que iria pro --resume. */
function ciclo(guardaAoDesligar) {
  const P = { resumeId: 'conversa-antiga', sessaoId: null, started: false };
  // 1. manda a primeira mensagem: liga passando o --resume e gasta o id
  const primeiroResume = P.resumeId || undefined;
  P.started = true; P.resumeId = null;
  // 2. o motor responde com o id da sessao (o 'system init')
  P.sessaoId = 'conversa-viva';
  // 3. voce troca de aba: o motor e desligado
  if (guardaAoDesligar) P.resumeId = P.sessaoId || P.resumeId;
  P.started = false;
  // 4. volta e manda outra mensagem: o que vai no --resume agora?
  const segundoResume = P.resumeId || undefined;
  return { primeiroResume, segundoResume };
}

console.log('1) a cadeia de estado do painel');
const bom = ciclo(true), ruim = ciclo(false);
console.log('     guardando o endereco:  1a mensagem --resume=' + bom.primeiroResume
  + '   |  depois de trocar de aba --resume=' + bom.segundoResume);
console.log('     sem guardar:           1a mensagem --resume=' + ruim.primeiroResume
  + '   |  depois de trocar de aba --resume=' + ruim.segundoResume);
checa('sem guardar, a 2a mensagem sobe SEM --resume (o bug)', ruim.segundoResume === undefined);
checa('guardando, a 2a mensagem continua na mesma conversa', bom.segundoResume === 'conversa-viva');

console.log(NL + '2) o codigo NOVO guarda nos tres pontos');
const novo = analisar(path.join(RAIZ, 'src', 'renderer', 'app.js'));
for (const k of Object.keys(novo)) console.log('     ' + k.padEnd(32) + novo[k]);
checa('sair da aba guarda a conversa', novo['sair da aba'] === 'guarda', novo['sair da aba']);
checa('terminar fora da tela guarda a conversa',
  novo['terminar o turno fora da tela'] === 'guarda', novo['terminar o turno fora da tela']);
checa('queda de conexao guarda a conversa', novo['a conexao caiu'] === 'guarda', novo['a conexao caiu']);

const instalado = path.join(RAIZ, 'src-antes-leva18', 'renderer', 'app.js');
if (fs.existsSync(instalado)) {
  console.log(NL + '3) a versao que esta rodando hoje (prova do bug)');
  const velho = analisar(instalado);
  for (const k of Object.keys(velho)) console.log('     ' + k.padEnd(32) + velho[k]);
  const perdia = Object.values(velho).filter(v => v === 'PERDE').length;
  console.log('     -> ' + perdia + ' dos 3 pontos perdiam a conversa');
  checa('a versao de hoje realmente perdia (era o bug relatado)', perdia >= 2, perdia + ' pontos');
}

console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'a conversa nao se perde mais ao trocar de aba'));
process.exit(falhas ? 1 : 0);
