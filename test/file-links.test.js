'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const links=require('../src/renderer/file-links');
const win={cwd:'C:\\Projetos\\cockpit',home:'C:\\Users\\hugo'};
const vps={cwd:'/srv/projeto',remote:true};
test('link exato da entrega VPS mantém caminho e destino, inclusive /opt',()=>{
  const p='/opt/equipe/trabalho/entregas/Motti/2026-09-29_revisao-cs/previa-acoes.txt';
  assert.deepEqual(links.resolve(p,{cwd:'~',remote:true}),{kind:'file',path:p});
});
test('relativos Windows usam a pasta do painel, com barras e espaços codificados',()=>{
  assert.equal(links.resolve('README.md',win).path,'C:\\Projetos\\cockpit\\README.md');
  assert.equal(links.resolve('./docs/Plano%20final.md',win).path,'C:\\Projetos\\cockpit\\docs\\Plano final.md');
  assert.equal(links.resolve('../shared/a.tsx',win).path,'C:\\Projetos\\shared\\a.tsx');
});
test('relativos VPS usam cwd ou pasta do documento aninhado',()=>{
  assert.equal(links.resolve('docs/revisao.md',vps).path,'/srv/projeto/docs/revisao.md');
  assert.equal(links.resolve('sub/detalhe.md',{cwd:'/srv/projeto/docs',remote:true}).path,'/srv/projeto/docs/sub/detalhe.md');
  assert.equal(links.resolve('../../README.md',{cwd:'/srv/projeto/docs',remote:true}).path,'/srv/README.md');
});
test('home local expande HOME; home remoto permanece ~ para o servidor resolver',()=>{
  assert.equal(links.resolve('~/Notas/a.md',win).path,'C:\\Users\\hugo\\Notas\\a.md');
  assert.equal(links.resolve('README.md',{cwd:'~',remote:true}).path,'~/README.md');
  assert.equal(links.resolve('../README.md',{cwd:'~',remote:true}).path,'~/../README.md');
  assert.equal(links.resolve('~/pasta/a.md',vps).path,'~/pasta/a.md');
});
test('Windows absoluto nunca é juntado ao cwd; caminho de rede (UNC) é bloqueado',()=>{
  assert.equal(links.resolve('D:/Dados/relatorio.md',win).path,'D:\\Dados\\relatorio.md');
  // Contrato antigo trocado de propósito (R5-01): o UNC virava arquivo, e o clique chegava ao statSync do main,
  // que congela o app ~21 s e faz o Windows tentar SMB. Agora nunca vira arquivo.
  assert.deepEqual(links.resolve('\\\\servidor\\equipe\\relatorio.md',win),{kind:'blocked'});
});
test('file URL decodifica espaços, drive Windows e POSIX; host de rede é bloqueado',()=>{
  assert.equal(links.resolve('file:///C:/QA/Meu%20arquivo.md',win).path,'C:\\QA\\Meu arquivo.md');
  assert.equal(links.resolve('file:///opt/a%20b.md',vps).path,'/opt/a b.md');
  // Contrato antigo trocado de propósito (R5-01): file://servidor/... virava \\servidor\... e era aceito como arquivo.
  assert.deepEqual(links.resolve('file://servidor/equipe/a.md',win),{kind:'blocked'});
  assert.equal(links.resolve('file://localhost/C:/QA/a.md',win).path,'C:\\QA\\a.md');
});
test('linha/coluna e âncora de seção são metadados, sem mutilar nomes parecidos',()=>{
  assert.deepEqual(links.resolve('README.md:12:4',win),{kind:'file',path:'C:\\Projetos\\cockpit\\README.md',line:12,column:4});
  assert.deepEqual(links.resolve('/srv/app.ts#L9-L20',vps),{kind:'file',path:'/srv/app.ts',line:9});
  assert.deepEqual(links.resolve('docs/a.md#instalacao',vps),{kind:'file',path:'/srv/projeto/docs/a.md',anchor:'#instalacao'});
  assert.equal(links.resolve('/srv/relatorio:2026.md',vps).path,'/srv/relatorio:2026.md');
  assert.equal(links.resolve('/srv/a%23L12.md',vps).path,'/srv/a#L12.md');
  assert.equal(links.resolve('/srv/a.md%3A12',vps).path,'/srv/a.md:12');
  assert.equal(links.resolve('/srv/100%.md',vps).path,'/srv/100%.md');
});
test('URL externa e âncora da página continuam externas e âncoras',()=>{
  assert.deepEqual(links.parse('#secao'),{kind:'anchor',href:'#secao'});
  assert.deepEqual(links.parse('https://example.com/a.md#L1'),{kind:'external',href:'https://example.com/a.md#L1'});
  assert.deepEqual(links.parse('mailto:hugo@example.com'),{kind:'external',href:'mailto:hugo@example.com'});
  assert.deepEqual(links.parse('//example.com/docs'),{kind:'external',href:'https://example.com/docs'});
});
test('protocolos ativos, ofuscados e dispositivos especiais não viram arquivo nem navegação',()=>{
  for(const s of ['javascript:alert(1)','data:text/html,<script>','vbscript:msgbox(1)','blob:https://site/a','https%3A//site/x','java%73cript:alert(1)','java\nscript:alert(1)','java%0dscript:alert(1)','%00arquivo.md','shell:AppsFolder','C:relative.md','file://user:pass@server/a.md','\\\\?\\C:\\a.md','\\\\.\\PhysicalDrive0'])assert.equal(links.parse(s).kind,'blocked',s);
});
test('dirname preserva raízes, compartilhamento UNC e caminhos do VPS',()=>{
  for(const [a,b]of [['C:\\QA\\a.md','C:\\QA'],['C:\\a.md','C:\\'],['/a.md','/'],['~/a.md','~'],['\\\\server\\share\\a.md','\\\\server\\share\\'],['\\\\server\\share\\','\\\\server\\share\\']])assert.equal(links.dirname(a),b,a);
});
/* R5-01: caminho de rede (\\servidor, //servidor, file://servidor) nunca vira link de arquivo. O clique chegava ao
   statSync do main, que congela o app ~21 s com o servidor fora do ar e faz o Windows tentar SMB (hash da senha). */
test('caminho de rede nunca vira arquivo',()=>{
  for(const s of [
    '\\\\servidor\\pasta\\x.md','/\\servidor/x.md','\\/servidor/x.md','file://servidor/pasta/x.md','file://127.0.0.1/share/x.md',
    'file:////servidor/x.md','file:///\\\\servidor\\x.md','file:///%5C%5Cservidor%5Cx.md','%5C%5Cservidor%5Cx.md','%2F%2Fservidor%2Fx.md',
    '\\\\servidor\\x.md#L10','\\\\servidor\\x.md:12','\\\\?\\UNC\\servidor\\x.md',
  ])assert.deepEqual(links.parse(s),{kind:'blocked'},s);
  assert.deepEqual(links.resolve('\\\\servidor\\pasta\\x.md',vps),{kind:'blocked'});
});
test('arquivo local continua funcionando',()=>{
  assert.equal(links.parse('file:///C:/Users/x/a.md').kind,'file');
  assert.equal(links.parse('file:///C:/Users/x/a.md').path,'C:\\Users\\x\\a.md');
  assert.equal(links.parse('file://localhost/C:/x/a.md').kind,'file');
  assert.equal(links.parse('C:\\x\\a.md').kind,'file');
  assert.equal(links.parse('C:/x/a.md').path,'C:\\x\\a.md');
  assert.equal(links.parse('src/app.js:12').kind,'file');
  assert.equal(links.parse('/opt/equipe/a.md').kind,'file');
});
test('//host em link continua link de navegador (https), nunca arquivo',()=>{
  assert.deepEqual(links.parse('//exemplo.com/x'),{kind:'external',href:'https://exemplo.com/x'});
});
test('isNetworkPath: duas barras de qualquer tipo, file://host (menos localhost) e escondidos em tab ou %5C',()=>{
  for(const v of [
    '\\\\h\\s','//h/s','/\\h/s','\\/h/s','  \\\\h\\s','\\\\?\\UNC\\h\\s','/\t/h/s',
    'file://h/s','FILE://h/s','file://127.0.0.1/s','file:////h/s','file:///%5C%5Ch/s',
  ])assert.equal(links.isNetworkPath(v),true,JSON.stringify(v));
  for(const v of [
    'C:\\a','C:/a','/abs/a.png','./a.png','../a.png','img/a.png','a\\\\b','file:///C:/a','file://localhost/C:/a',
    'data:image/png;base64,AA','https://exemplo.com/a','#secao','','  ',null,undefined,0,
  ])assert.equal(links.isNetworkPath(v),false,JSON.stringify(v));
});
/* Fix round 1 da Task 1: o normalize colapsa "." e ".." DEPOIS do parse. Em "/./\host\x.md" o parse só enxerga "/."
   (não é rede), mas o normalize derrubava o "." e entregava "/\host\x.md", que no Windows é \\host\x.md: o resultado
   voltava como kind:'file' e aparecia o link "Abrir aqui". Nada que o resolve devolve como arquivo pode começar com
   duas barras de qualquer tipo (a recusa no main continuava de pé; isto fecha a porta de entrada na tela). */
test('"." e ".." na frente de \\host não escondem caminho de rede: resolve devolve blocked',()=>{
  for(const [nome,contexto]of [['win',win],['vps',vps],['home remoto',{cwd:'~',remote:true}]]){
    for(const s of [
      '/./\\host\\x.md','/../\\h\\..','/x/../\\h\\s\\a.md','/././\\h','/.//\\h',
      '/%2e/%5Chost%5Cx.md','/%2e%2e/%5Ch','/x/%2e%2e/%5Ch',
    ])assert.deepEqual(links.resolve(s,contexto),{kind:'blocked'},nome+': '+s);
  }
});
test('pasta de trabalho "/" mais nome começando com \\ também não vira caminho de rede',()=>{
  // "/" + "\host" = "/\host": o mesmo buraco, agora pelo cwd e sem nenhum "." no link
  for(const s of ['\\host\\x.md','./\\host\\x.md'])assert.deepEqual(links.resolve(s,{cwd:'/',remote:true}),{kind:'blocked'},s);
});
test('o aperto não atrapalha caminho normal com "." e ".." nem a pasta de trabalho UNC',()=>{
  assert.equal(links.resolve('/./opt/a.md',vps).path,'/opt/a.md');
  assert.equal(links.resolve('/x/../srv/a.md',vps).path,'/srv/a.md');
  assert.equal(links.resolve('/.//opt/a.md',vps).path,'/opt/a.md');
  assert.equal(links.resolve('/./opt/a.md',win).path,'/opt/a.md');
  // cwd UNC segue como estava (quem recusa abrir é o ehCaminhoDeRede do main): só o ramo fora do Windows foi apertado
  assert.equal(links.resolve('README.md',{cwd:'\\\\srv\\share\\proj'}).path,'\\\\srv\\share\\proj\\README.md');
  assert.equal(links.dirname('\\\\server\\share\\a.md'),'\\\\server\\share\\');
});
test('nenhuma mistura curta de barras, "." e ".." (nem escondida em %5C, %2e, %2f) vira arquivo de rede',()=>{
  // todas as sequências de até 4 pedaços, em 5 pastas de trabalho (nenhuma UNC): kind:'file' nunca começa com duas barras.
  // A regex é a do main (ehCaminhoDeRede) de propósito, para não conferir o isNetworkPath com ele mesmo.
  const pedacos=['/','\\','.','..','h','%5C','%2e','%2f'];
  const contextos=[win,vps,{cwd:'~',remote:true},{cwd:'/',remote:true},{}];
  const varre=(entrada,restam)=>{
    if(entrada)for(const contexto of contextos){
      const r=links.resolve(entrada,contexto);
      if(r.kind==='file'&&/^[\\/]{2}/.test(r.path))assert.fail('virou arquivo de rede: '+JSON.stringify(entrada)+' em '+JSON.stringify(contexto)+' => '+JSON.stringify(r.path));
    }
    if(restam>0)for(const pedaco of pedacos)varre(entrada+pedaco,restam-1);
  };
  varre('',4);
});
/* Leva 2, Task 2 (UI 7.2-2): caminho local COM ESPAÇO no texto corrido (todo G:\Meu Drive\... tem). A regex simples do
   app para no 1º espaço, então esse caminho nunca virava link. findSpacedPaths só devolve o que não deixa dúvida: letra de
   unidade, extensão conhecida e, logo depois, espaço, pontuação ou o fim. Na dúvida devolve nada: um link a menos custa menos
   que um link errado. Rede (\\servidor, //servidor, file://servidor) nunca entra. */
const achados=t=>links.findSpacedPaths(t).map(x=>x.path);
test('findSpacedPaths: caminho de unidade com espaço sai inteiro, do X:\\ até a extensão, com a posição no texto',()=>{
  assert.deepEqual(links.findSpacedPaths('veja G:\\Meu Drive\\a b.pdf agora'),[{index:5,path:'G:\\Meu Drive\\a b.pdf'}]);
  for(const [texto,esperado]of [
    ['1. Solto: G:\\Meu Drive\\04. PESSOAL\\relatorio.md','G:\\Meu Drive\\04. PESSOAL\\relatorio.md'],
    ['G:/Meu Drive/Plano final.docx','G:/Meu Drive/Plano final.docx'],
    ['G:\\Meu Drive\\RELATÓRIO FINAL.PDF','G:\\Meu Drive\\RELATÓRIO FINAL.PDF'],
    ['G:\\Meu Drive\\Plano 1.2.3 final.md','G:\\Meu Drive\\Plano 1.2.3 final.md'],
    ['G:\\Meu Drive\\desenho 1.excalidraw.md','G:\\Meu Drive\\desenho 1.excalidraw.md'],
    ['G:\\Meu Drive\\a b.js:12:3','G:\\Meu Drive\\a b.js:12:3'],
    ['G:\\Meu Drive\\a b.md#L10','G:\\Meu Drive\\a b.md#L10'],
    // o ponto de uma pasta ("proj.v2") não corta o caminho no meio, como a regex simples fazia
    ['C:\\proj.v2\\Meu Drive\\a.md','C:\\proj.v2\\Meu Drive\\a.md'],
  ])assert.deepEqual(achados(texto),[esperado],texto);
});
test('findSpacedPaths: pontuação, aspas e parênteses depois da extensão não entram no caminho',()=>{
  for(const [texto,esperado]of [
    ['(G:\\Meu Drive\\a b.pdf)','G:\\Meu Drive\\a b.pdf'],
    ['"G:\\Meu Drive\\a b.pdf"','G:\\Meu Drive\\a b.pdf'],
    ['salvei em G:\\Meu Drive\\a b.pdf.','G:\\Meu Drive\\a b.pdf'],
    ['G:\\Meu Drive\\a b.pdf,','G:\\Meu Drive\\a b.pdf'],
    ['G:\\Meu Drive\\a b.pdf;','G:\\Meu Drive\\a b.pdf'],
    ['G:\\Meu Drive\\a b.pdf: ok','G:\\Meu Drive\\a b.pdf'],
    ['G:\\Meu Drive\\a b.pdf!','G:\\Meu Drive\\a b.pdf'],
    ['G:\\Meu Drive\\a b.pdf?','G:\\Meu Drive\\a b.pdf'],
    ['abrindo G:\\Meu Drive\\a b.pdf…','G:\\Meu Drive\\a b.pdf'],
    ['(abra G:\\Meu Drive\\Contrato (final).pdf)','G:\\Meu Drive\\Contrato (final).pdf'],
  ])assert.deepEqual(achados(texto),[esperado],texto);
});
test('findSpacedPaths: dois caminhos no mesmo texto saem separados, cada um até a SUA extensão',()=>{
  assert.deepEqual(achados('G:\\Meu Drive\\a b.pdf e G:\\Meu Drive\\c d.md'),['G:\\Meu Drive\\a b.pdf','G:\\Meu Drive\\c d.md']);
  // o ":" de outra unidade quebra o caminho: o 1º candidato morre, o 2º sobrevive
  assert.deepEqual(achados('copie C:\\pasta e D:\\outra pasta\\a.md'),['D:\\outra pasta\\a.md']);
  // a barra de OUTRO caminho mais adiante não vira separador do primeiro: ele acaba na 1ª extensão
  assert.deepEqual(achados('G:\\Meu Drive\\a b.pdf e /opt/equipe/a.md'),['G:\\Meu Drive\\a b.pdf']);
  assert.deepEqual(achados('C:\\a b\\c.md, D/x/y.md'),['C:\\a b\\c.md']);
});
test('findSpacedPaths: sem espaço no caminho é da regex simples do app, não daqui',()=>{
  assert.deepEqual(links.findSpacedPaths('C:\\x\\app.js e C:\\y\\b.md:12'),[]);
});
test('findSpacedPaths: na dúvida não devolve nada (extensão desconhecida, pasta, frase solta, colado em palavra)',()=>{
  for(const t of [
    'G:\\Meu Drive\\a b.xyz','G:\\Meu Drive\\Pasta Nova','G:\\Meu Drive\\Pasta Nova e depois',
    'G:\\Meu Drive\\a b.mdz','G:\\Meu Drive\\a b.md.bak','G:\\Meu Drive\\a b.md_velho','G:\\Meu Drive\\a b.md-velho',
    'C:\\ e abra o README.md','abcG:\\Meu Drive\\a b.md','G:Meu Drive\\a b.md','G:\\Meu\nDrive\\a b.md','G:\\Meu Drive\\\\a b.md',
    // pasta sem barra final + frase + outro caminho: o espaço antes da barra não é nome de pasta
    'G:\\Meu Drive\\pasta e depois /opt/x.md',
  ])assert.deepEqual(links.findSpacedPaths(t),[],JSON.stringify(t));
});
test('findSpacedPaths: caminho de rede nunca sai, nem escondido atrás de uma letra de unidade',()=>{
  for(const t of [
    '\\\\srv\\Meu Drive\\a b.md','//srv/Meu Drive/a b.md','/\\srv\\Meu Drive\\a b.md','\\/srv/Meu Drive/a b.md',
    'file://srv/Meu Drive/a b.md','file:///G:/Meu Drive/a b.md','\\\\?\\G:\\Meu Drive\\a b.md','\\\\.\\G:\\Meu Drive\\a b.md',
    '\\\\srv\\G:\\Meu Drive\\a b.md','//srv/G:/Meu Drive/a b.md',
  ])assert.deepEqual(links.findSpacedPaths(t),[],JSON.stringify(t));
});
test('findSpacedPaths: entrada que não é texto devolve lista vazia, sem explodir',()=>{
  for(const t of [null,undefined,0,{},[],''])assert.deepEqual(links.findSpacedPaths(t),[]);
});
test('findSpacedPaths: texto enorme sem caminho não trava (sem retrocesso explosivo)',()=>{
  const lixo=['C:\\'+'a b '.repeat(20000),'C:\\'+'a\\'.repeat(20000),('C:\\a b.zz '+'x:\\').repeat(5000)];
  const antes=Date.now();
  for(const t of lixo)assert.deepEqual(links.findSpacedPaths(t),[]);
  assert.ok(Date.now()-antes<2000,'levou '+(Date.now()-antes)+' ms');
});
/* Dentro de crases o texto INTEIRO precisa ser o arquivo: "abrir G:\x\a.md" é um comando, não um caminho. Pasta
   (sem extensão conhecida) fica como código: o leitor não abre pasta e o link só daria erro. */
test('isDriveFile: o texto inteiro é X:\\...\\arquivo.ext, com espaço e tudo',()=>{
  for(const t of [
    'G:\\Meu Drive\\04. PESSOAL\\nota.md','C:\\Users\\hugom\\Projetos-claude\\relatorio.md','G:/Meu Drive/a b.pdf',
    'C:\\x\\app.js:12','C:\\x\\app.js:12:4','C:\\x\\app.js#L10','D:\\Dados\\a.TXT','C:\\proj.v2\\Meu Drive\\a.md',
  ])assert.equal(links.isDriveFile(t),true,JSON.stringify(t));
});
test('isDriveFile: rede, pasta, extensão desconhecida e frase com caminho no meio dão falso',()=>{
  for(const t of [
    '\\\\srv\\x.md','\\\\srv\\Meu Drive\\a b.md','//srv/x.md','/\\srv\\x.md','file://srv/x.md','file:///C:/x.md','\\\\?\\C:\\x.md',
    '/opt/equipe/a.md','~/a.md','src/app.js','./a.md',
    'C:\\Users\\hugom','C:\\Users\\hugom\\.claude','C:\\Users\\hugom\\Projetos-claude\\','C:\\','C:relativo.md','G:\\Meu Drive\\Pasta Nova',
    'abrir C:\\x\\a.md','C:\\x\\a.md --flag','C:\\x\\a.md e D:\\y\\b.md','C:\\x\\a.md\nC:\\y\\b.md','C:\\x\\a.xyz','C:\\x\\Dockerfile',
    '','  ',null,undefined,0,{},
  ])assert.equal(links.isDriveFile(t),false,JSON.stringify(t));
});
/* Leva 2, Fix C item 1 (revisão da Task 2): no TEXTO CORRIDO o nome com espaço não atravessa a frase. A cauda do nome
   (o que vem depois da última barra) aceitava ". ", ", " e "; " e não tinha teto: "C:\Users\hugom\Meu Projeto. Dentro
   dela está o README.md" virava um link de 56 caracteres. Agora a cauda para em ponto, vírgula, ponto e vírgula ou
   exclamação seguidos de espaço e tem no máximo 120 caracteres. Só o texto corrido: dentro de crases (isDriveFile) o
   texto inteiro é o caminho e não muda. */
test('findSpacedPaths: ponto, vírgula, ponto e vírgula ou exclamação + espaço dentro do nome não atravessam a frase',()=>{
  for(const t of [
    'Criei a pasta C:\\Users\\hugom\\Meu Projeto. Dentro dela está o README.md',
    'Salvei em G:\\Meu Drive\\Relatorios Mensais, veja o plano.pdf',
    'Salvei em G:\\Meu Drive\\Relatorios Mensais; veja o plano.pdf',
    'Salvei em G:\\Meu Drive\\Relatorios Mensais! Veja o plano.pdf',
    'Salvei em G:\\Meu Drive\\Relatorios Mensais.\tVeja o plano.pdf',
    'Salvei em G:/Meu Drive/Relatorios Mensais, veja o plano.pdf',
  ])assert.deepEqual(links.findSpacedPaths(t),[],JSON.stringify(t));
});
test('findSpacedPaths: nome com mais de 120 caracteres não vira link; um de tamanho normal continua',()=>{
  const longo='G:\\Meu Drive\\'+'palavra '.repeat(20)+'fim.md';   // 163 caracteres entre a barra e a extensão
  assert.deepEqual(links.findSpacedPaths(longo),[]);
  assert.deepEqual(links.findSpacedPaths('veja '+longo+' agora'),[]);
  const medio='G:\\Meu Drive\\'+'palavra '.repeat(12)+'fim.md';     // uns 99
  assert.deepEqual(achados(medio),[medio]);
  assert.deepEqual(achados('veja '+medio+', agora'),[medio]);
});
test('findSpacedPaths: os positivos de antes continuam links, inclusive com frase depois do caminho',()=>{
  for(const [texto,esperado]of [
    ['veja G:\\Meu Drive\\a b.pdf agora','G:\\Meu Drive\\a b.pdf'],
    ['1. Solto: G:\\Meu Drive\\04. PESSOAL\\relatorio.md','G:\\Meu Drive\\04. PESSOAL\\relatorio.md'],
    ['Abri G:\\Meu Drive\\04. PESSOAL\\nota final.md. Depois, veja o resto','G:\\Meu Drive\\04. PESSOAL\\nota final.md'],
    ['G:/Meu Drive/Plano final.docx','G:/Meu Drive/Plano final.docx'],
    ['G:\\Meu Drive\\RELATÓRIO FINAL.PDF','G:\\Meu Drive\\RELATÓRIO FINAL.PDF'],
    ['G:\\Meu Drive\\Plano 1.2.3 final.md','G:\\Meu Drive\\Plano 1.2.3 final.md'],
    ['G:\\Meu Drive\\desenho 1.excalidraw.md','G:\\Meu Drive\\desenho 1.excalidraw.md'],
    ['G:\\Meu Drive\\a b.js:12:3','G:\\Meu Drive\\a b.js:12:3'],
    ['G:\\Meu Drive\\a b.md#L10','G:\\Meu Drive\\a b.md#L10'],
    ['C:\\proj.v2\\Meu Drive\\a.md','C:\\proj.v2\\Meu Drive\\a.md'],
    ['(abra G:\\Meu Drive\\Contrato (final).pdf)','G:\\Meu Drive\\Contrato (final).pdf'],
    ['Salvei em G:\\Meu Drive\\Relatorios Mensais.pdf, veja o plano.pdf','G:\\Meu Drive\\Relatorios Mensais.pdf'],
    ['Criei C:\\Users\\hugom\\Meu Projeto\\README.md. Dentro dela está o plano','C:\\Users\\hugom\\Meu Projeto\\README.md'],
  ])assert.deepEqual(achados(texto),[esperado],texto);
});
test('isDriveFile: dentro de crases o texto inteiro é o caminho, então ", " e ". " no nome não mudam o veredito',()=>{
  for(const t of ['G:\\Meu Drive\\Relatorios Mensais, veja o plano.pdf','C:\\Users\\hugom\\Meu Projeto. Dentro dela está o README.md'])assert.equal(links.isDriveFile(t),true,JSON.stringify(t));
});
test('findSpacedPaths: texto de 400 KB leva menos de 50 ms (tempo linear, sem retrocesso)',()=>{
  const TAM=400*1024;
  const encher=unidade=>unidade.repeat(Math.ceil(TAM/unidade.length)).slice(0,TAM);
  const entradas=[
    encher('Criei a pasta C:\\Users\\hugom\\Meu Projeto. Dentro dela está o README.md e depois, veja G:\\Meu Drive\\Relatorios Mensais, veja o plano.pdf. '),
    encher('veja G:\\Meu Drive\\04. PESSOAL\\Plano final.md e depois D:\\Dados\\a b.js:12:3 . '),
    encher('C:\\ a b, c d. e f; g h! '),
    'C:\\'+'a b, '.repeat(Math.ceil(TAM/5)),
    'C:\\'+'a\\'.repeat(TAM/2),
  ];
  for(const texto of entradas){
    links.findSpacedPaths(texto);   // aquece: a 1ª execução compila a regex
    let melhor=Infinity;
    for(let i=0;i<5;i++){const ini=process.hrtime.bigint();links.findSpacedPaths(texto);melhor=Math.min(melhor,Number(process.hrtime.bigint()-ini)/1e6);}
    assert.ok(melhor<50,'levou '+melhor.toFixed(1)+' ms em '+texto.length+' caracteres começando por '+JSON.stringify(texto.slice(0,40)));
  }
});
/* Leva 3, T9: findPlainPaths e mergePaths (caminho sem espaço em tempo linear). O "re" é o do linkarArquivos, lido do app.js
   como o quadro-fluxo.test.js faz. A equivalência com o re no texto inteiro e o tempo estão em linkar-arquivos-linear.test.js. */
function reDoApp(){
  const app=require('../testes/raiz').lerFonte('renderer','app.js');
  const linha=app.slice(app.indexOf('function linkarArquivos(')).split('\n').find(l=>/^\s*const re = \//.test(l));
  return require('node:vm').runInNewContext(linha.replace(/^\s*const re = /,'').replace(/;\s*$/,''));
}
test('findPlainPaths: caminho sem espaço sai com a posição, :linha:coluna e #L-L grudados, até o ÚLTIMO ponto (a vírgula de dentro fica) e sem o ponto final da frase',()=>{
  const re=reDoApp();
  const t='veja C:\\x\\a.md e /opt/x.js:12:3 ou ./b.md#L3-L5. e ~/pasta.v2/n.md#L3C4-L5 e /opt/a,b.js.';
  assert.deepEqual(links.findPlainPaths(t,re),[
    {index:5,path:'C:\\x\\a.md'},{index:17,path:'/opt/x.js:12:3'},{index:35,path:'./b.md#L3-L5'},
    {index:51,path:'~/pasta.v2/n.md#L3C4-L5'},{index:77,path:'/opt/a,b.js'},
  ]);
  assert.deepEqual(links.findPlainPaths('sem caminho, só a.b e v1.2',re),[]);
  for(const entrada of [null,undefined,0,{},[]])assert.deepEqual(links.findPlainPaths(entrada,re),[],String(entrada));
});
test('findPlainPaths + mergePaths: o pedaço sem espaço que cai dentro de um caminho com espaço some (C:\\a.b\\Meu Drive\\x.md não vira C:\\a.b)',()=>{
  const re=reDoApp(),t='abra C:\\a.b\\Meu Drive\\x.md e C:\\y.js';
  const espaco=links.findSpacedPaths(t),simples=links.findPlainPaths(t,re);
  assert.deepEqual(espaco,[{index:5,path:'C:\\a.b\\Meu Drive\\x.md'}]);
  assert.deepEqual(simples,[{index:5,path:'C:\\a.b'},{index:29,path:'C:\\y.js'}]);   // sozinha, a regex do app corta no 1º espaço
  assert.deepEqual(links.mergePaths(espaco,simples),[{index:5,path:'C:\\a.b\\Meu Drive\\x.md'},{index:29,path:'C:\\y.js'}]);
});
test('mergePaths: descarta o que cai dentro de um caminho com espaço, mantém o que só encosta, devolve em ordem e não mexe nas listas',()=>{
  const espaco=[{index:10,path:'0123456789'},{index:40,path:'abcdefghij'}];
  // 7 encosta no começo do 1º com espaço, 12 cai dentro dele, 20 encosta no fim dele, 38 invade o começo do 2º, 50 encosta no fim do 2º
  const simples=[{index:0,path:'abc'},{index:7,path:'xyz'},{index:12,path:'xx'},{index:20,path:'tt'},{index:38,path:'yyy'},{index:50,path:'z.md'}];
  assert.deepEqual(links.mergePaths(espaco,simples),[
    {index:0,path:'abc'},{index:7,path:'xyz'},{index:10,path:'0123456789'},{index:20,path:'tt'},{index:40,path:'abcdefghij'},{index:50,path:'z.md'},
  ]);
  assert.equal(espaco.length,2);assert.equal(simples.length,6);
  assert.deepEqual(links.mergePaths([],[]),[]);
  assert.deepEqual(links.mergePaths(espaco,[]),espaco);
  assert.deepEqual(links.mergePaths([],simples),simples);
});
test('findPlainPaths: re sem a flag g, ou que casa vazio, não prende o laço (o exec é contado: se o laço não terminar, o teste falha em vez de travar)',()=>{
  const contado=re=>{let n=0;const exec=re.exec.bind(re);re.exec=s=>{if(++n>1000)throw new Error('laço sem fim: mais de 1000 chamadas ao exec');return exec(s);};return re;};
  // sem o g o lastIndex não anda: o exec acharia o mesmo caminho para sempre
  for(const re of [/(\/\w+\.md)/,/(\/\w+\.md)/y])assert.throws(()=>links.findPlainPaths('a/b.md',contado(re)),{name:'TypeError'},String(re));
  for(const re of [undefined,null,'(x)',{}])assert.throws(()=>links.findPlainPaths('a/b.md',re),{name:'TypeError'});
  // casamento vazio: o lastIndex também não anda sozinho; o achado vazio é pulado e os outros saem
  assert.deepEqual(links.findPlainPaths('a.b',contado(/(x*)/g)),[]);
  assert.deepEqual(links.findPlainPaths('a.b',contado(/(\w*)/g)),[{index:0,path:'a'},{index:2,path:'b'}]);
});
