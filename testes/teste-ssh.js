/* A aba do servidor caía entre uma mensagem e outra: o canal SSH ficava em
   silencio total durante o turno inteiro (8 a 12 minutos) e mais o tempo de
   leitura, e conexao parada e' descartada por roteador/firewall sem avisar
   ninguem - os dois lados seguem achando que estao ligados ate alguem escrever.

   Este teste confere as tres defesas, direto no arquivo:
     1. o ssh sobe com sinal de vida
     2. o motivo da queda nao e' mais jogado fora
     3. a mensagem que pega o motor caido e reenviada sozinha */
const fs = require('fs');
const path = require('path');
const { RAIZ, versaoAnterior } = require('./raiz');
const NL = String.fromCharCode(10);

let falhas = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

const main = fs.readFileSync(path.join(RAIZ, 'src', 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'app.js'), 'utf8');

// recorta o trecho que monta o comando ssh
const i = main.indexOf("spawnBin('ssh'");
const trechoSsh = i < 0 ? '' : main.slice(i, i + 700);

console.log('1) o canal SSH manda sinal de vida');
checa('acha o ponto que abre o ssh', i > 0);
checa('ServerAliveInterval definido', /ServerAliveInterval=\d+/.test(trechoSsh));
const intervalo = (trechoSsh.match(/ServerAliveInterval=(\d+)/) || [])[1];
checa('o intervalo e curto o bastante pra segurar o NAT (<= 30s)',
  intervalo && Number(intervalo) <= 30, intervalo + 's');
checa('ServerAliveCountMax definido (derruba de verdade quando o servidor some)',
  /ServerAliveCountMax/.test(trechoSsh));
const contagem = (trechoSsh.match(/ServerAliveCountMax=(\d+)/) || [])[1];
checa('e da folga suficiente pra um turno longo nao ser cortado (>= 4)',
  contagem && Number(contagem) >= 4, contagem + ' tentativas');
checa('TCPKeepAlive ligado', /TCPKeepAlive/.test(trechoSsh));
if (intervalo && contagem) {
  console.log('     -> sinal a cada ' + intervalo + 's, desiste depois de '
    + (Number(intervalo) * Number(contagem)) + 's sem resposta');
}

console.log(NL + '2) o motivo da queda nao vai mais pro lixo');
checa('o stderr do motor e guardado',
  /proc\.stderr\.on\('data',\s*\(d\)\s*=>\s*\{[\s\S]{0,200}st\.erro/.test(main));
/* so' dentro do claudeStart: os outros dois spawns de ssh sao consultas de 25s
   pra listar conversa remota, e ali o stderr nao interessa mesmo */
const ini = main.indexOf('function claudeStart(');
const fimF = main.indexOf('function claudeStop(');
const corpoStart = main.slice(ini, fimF);
checa('o ouvinte vazio que jogava fora sumiu do motor',
  !/proc\.stderr\.on\('data',\s*\(\)\s*=>\s*\{\}\);/.test(corpoStart));
checa('o aviso de queda leva o motivo junto',
  /emit\(paneId,\s*'engine-down',\s*\{\s*motivo/.test(main));
checa('a tela mostra o motivo quando existe', /ev\.motivo/.test(app));
checa('e diz que foi o SERVIDOR quando for remoto', /ev\.remoto\s*\?\s*'A conexão com o servidor caiu/.test(app));

console.log(NL + '3) a mensagem nao se perde quando o motor caiu calado');
const j = app.indexOf('const foi = await window.api.paneSend(pacote());');
const trechoEnvio = j < 0 ? '' : app.slice(j, j + 1400);
checa('acha o ponto do envio', j > 0);
checa('quando o motor esta morto, o painel religa sozinho',
  /paneStart\(\{[\s\S]{0,200}resumeId/.test(trechoEnvio));
checa('religa na MESMA conversa', /P\.resumeId = P\.sessaoId \|\| P\.resumeId/.test(trechoEnvio));
checa('e manda a mensagem de novo', /paneSend\(pacote\(\)\)[\s\S]{0,120}foiDeNovo|foiDeNovo\s*=\s*await window\.api\.paneSend/.test(trechoEnvio));
checa('avisa voce que religou', /Religando e mandando de novo/.test(trechoEnvio));
checa('se falhar de novo, devolve o texto pra voce', /desfazerEnvio\(P, escrito, text, anexos\)/.test(app));

console.log(NL + '4) a versao anterior nao tinha nada disso (prova de que era o buraco)');
const antes = path.join(RAIZ, 'src-antes-leva20', 'main.js');
if (fs.existsSync(antes)) {
  const velho = fs.readFileSync(antes, 'utf8');
  const k = velho.indexOf("spawnBin('ssh'");
  const trechoVelho = k < 0 ? '' : velho.slice(k, k + 700);
  checa('antes o ssh subia SEM sinal de vida', !/ServerAliveInterval/.test(trechoVelho));
  checa('antes o motivo do erro era jogado fora',
    /proc\.stderr\.on\('data',\s*\(\)\s*=>\s*\{\}\);/.test(velho));
} else {
  console.log('     (sem a copia anterior para comparar)');
}

console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'as tres defesas estao no lugar'));
process.exit(falhas ? 1 : 0);
