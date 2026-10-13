/* Caminhos da conversa: não lê disco, não interpreta comandos nem abre URLs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CockpitFileLinks=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const controls=/[\u0000-\u001f\u007f]/;
  const drive=/^[a-z]:[\\/]/i;
  function decode(text){return text.replace(/(?:%[0-9a-f]{2})+/gi,s=>{try{return decodeURIComponent(s);}catch{return s;}});}
  /* Caminho de rede (UNC): começa com duas barras de qualquer tipo (\\x, //x, /\x, \/x) ou é file://host/...
     com host que não seja vazio nem localhost. Abrir um assim faz o Windows falar SMB com o servidor: o app
     trava ~21 s se ele estiver fora do ar e, se estiver no ar, o hash da senha do Windows vai junto. */
  function isNetworkPath(value){
    // o navegador ignora tab e quebra de linha no meio do endereço: "/<TAB>/host" vira "//host"
    const text=String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim();
    if(/^[\\/]{2}/.test(text))return true;
    if(!/^file:/i.test(text))return false;
    try{const url=new URL(text);return(!!url.hostname&&url.hostname!=='localhost')||/^[\\/]{2}/.test(decode(url.pathname));}catch{return false;}
  }
  function parse(value){
    if(typeof value!=='string'||!value.trim()||controls.test(value))return{kind:'blocked'};
    let raw=value.trim();
    if(raw.startsWith('#'))return{kind:'anchor',href:raw};
    const inspected=decode(raw);
    if(controls.test(inspected))return{kind:'blocked'};
    if(/^(?:https?:|mailto:)/i.test(inspected)){
      // Não transforma um protocolo ofuscado em um link navegável.
      if(!/^(?:https?:|mailto:)/i.test(raw))return{kind:'blocked'};
      try{const u=new URL(raw);if(!['http:','https:','mailto:'].includes(u.protocol))return{kind:'blocked'};return{kind:'external',href:u.href};}catch{return{kind:'blocked'};}
    }
    if(raw.startsWith('//')){try{return{kind:'external',href:new URL('https:'+raw).href};}catch{return{kind:'blocked'};}}
    // \\servidor, /\servidor, \/servidor e file://servidor: caminho de rede nunca vira arquivo
    if(isNetworkPath(raw))return{kind:'blocked'};
    if(/^file:/i.test(raw)){
      try{
        const url=new URL(raw);
        if(url.username||url.password||url.port)return{kind:'blocked'};
        if(url.hostname&&url.hostname!=='localhost')return{kind:'blocked'};
        raw=url.pathname+url.hash;
        if(/^\/[a-z]:\//i.test(raw))raw=raw.slice(1);
      }catch{return{kind:'blocked'};}
    }
    let line,column,anchor;
    const hash=raw.match(/#L([1-9]\d*)(?:C([1-9]\d*))?(?:-L[1-9]\d*(?:C[1-9]\d*)?)?$/i);
    const position=raw.match(/:([1-9]\d*)(?::([1-9]\d*))?$/);
    if(hash){line=Number(hash[1]);column=hash[2]?Number(hash[2]):undefined;raw=raw.slice(0,hash.index);}
    else if(position&&/\.[a-z\d_-]+$|(?:^|[\\/])(?:Dockerfile|Makefile|LICENSE)$/i.test(raw.slice(0,position.index))){line=Number(position[1]);column=position[2]?Number(position[2]):undefined;raw=raw.slice(0,position.index);}
    else {const section=raw.match(/(\.(?:md|mdx|markdown|html?))#(.+)$/i);if(section){anchor='#'+section[2];raw=raw.slice(0,section.index+section[1].length);}}
    let file=decode(raw);
    if(!file||controls.test(file)||/^[a-z][a-z\d+.-]*:/i.test(file)&&!drive.test(file))return{kind:'blocked'};
    // rede e dispositivos (\\servidor, //servidor, \\?\ e \\.\), mesmo escondidos em %5C ou em file:////
    if(isNetworkPath(file))return{kind:'blocked'};
    if(drive.test(file))file=file.replace(/\//g,'\\');
    return{kind:'file',path:file,...(line?{line}:{}),...(column?{column}:{}),...(anchor?{anchor}:{})};
  }
  function normalize(value){
    const win=drive.test(value)||value.startsWith('\\\\');
    let root='',rest=value.replace(/\\/g,win?'/':'\\');
    if(win&&rest.startsWith('//')){
      const m=rest.match(/^\/\/([^/]+)\/([^/]+)(?:\/|$)/);if(!m)return null;
      root='//'+m[1]+'/'+m[2]+'/';rest=rest.slice(m[0].length);
    }else if(drive.test(rest)){root=rest.slice(0,3);rest=rest.slice(3);}
    else if(rest.startsWith('/')){root='/';rest=rest.slice(1);}
    else if(rest==='~'||rest.startsWith('~/')){root='~/';rest=rest.slice(2);}
    const parts=[];
    for(const part of rest.split('/')){
      if(!part||part==='.')continue;
      if(part==='..'){if(parts.length&&parts.at(-1)!=='..')parts.pop();else if(!root||root==='~/')parts.push(part);}
      else parts.push(part);
    }
    let result=root+parts.join('/');
    if(result==='~/')result='~';
    if(win)return result.replace(/\//g,'\\');
    /* Fora do ramo win a barra invertida não separa pedaço: "/./\host" perde o "." aqui e vira "/\host", que o Windows
       lê como \\host (rede). O parse olhou ANTES de o "." sair e não viu. Só este ramo: o UNC do ramo win (pasta de
       trabalho do painel, dirname) segue como estava. */
    if(isNetworkPath(result))return null;
    return result||'.';
  }
  function resolve(value,options={}){
    const parsed=parse(value);if(parsed.kind!=='file')return parsed;
    let file=parsed.path;
    const home=options.remote?'~':String(options.home||'');
    let cwd=String(options.cwd||home||'');
    if(cwd==='~'||cwd.startsWith('~/'))cwd=home?home+cwd.slice(1):cwd;
    if(file==='~'||file.startsWith('~/')||file.startsWith('~\\')){
      if(!home)return{kind:'blocked'};
      file=home+file.slice(1).replace(/\\/g,'/');
    }else if(!drive.test(file)&&!file.startsWith('\\\\')&&!file.startsWith('/')){
      if(!cwd)return{kind:'blocked'};
      if(drive.test(cwd)||cwd.startsWith('\\\\'))file=cwd.replace(/[\\/]+$/,'')+'\\'+file.replace(/\//g,'\\');
      else file=cwd.replace(/\/+$/,'')+'/'+file;
    }
    const result=normalize(file);return result?{...parsed,path:result}:{kind:'blocked'};
  }
  function dirname(value){
    const file=normalize(String(value||''));if(!file)return'';
    const win=drive.test(file)||file.startsWith('\\\\'),sep=win?'\\':'/';
    if(file==='~'||file==='/'||/^[a-z]:\\$/i.test(file))return file;
    if(/^\\\\[^\\]+\\[^\\]+\\?$/.test(file))return file;
    const trimmed=file.replace(/[\\/]+$/,''),index=trimmed.lastIndexOf(sep);
    if(index<0)return'.';
    return normalize(trimmed.slice(0,index+1))||'.';
  }
  /* Arquivo local com espaço (todo G:\Meu Drive\... tem): a regex simples do app para no 1º espaço, então ele nunca virava
     link. Só entra o que não deixa dúvida: letra de unidade (X:\ ou X:/), extensão conhecida e, logo depois, espaço, pontuação
     ou o fim. Pasta, extensão desconhecida e frase solta ficam de fora: um link a menos custa menos que um link errado.
     Rede nunca entra: o caminho começa por letra de unidade e o isNetworkPath confere de novo.
     O caminho acaba na 1ª extensão conhecida que vem seguida de espaço, pontuação ou o fim. Cada pedaço entre barras não tem
     espaço nas pontas (nome de pasta não termina em espaço) nem ":" nem quebra de linha: assim uma barra de OUTRO caminho
     mais adiante não vira separador deste, um caminho não engole o seguinte, nem atravessa parágrafo, e o regex não
     retrocede de forma explosiva. */
  const known=String.raw`excalidraw|canvas|md|markdown|mdown|mdx|mkd|txt|json|jsonc|html?|css|scss|csv|tsv|log|ya?ml|toml|ini|cfg|conf|xml|sql|jsx?|mjs|cjs|tsx?|py|sh|ps1|bat|cmd|rs|go|java|cpp|hpp|rb|php|c|h|srt|vtt|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|png|jpe?g|gif|webp|bmp|svg|heic|ico|mp[34]|mov|mkv|avi|webm|wav|m4a|ogg|zip|rar|7z`;
  const first=String.raw`[^\s\\/:*?"<>|]`,rest=String.raw`[^\\/:*?"<>|\r\n]`;
  const piece=String.raw`${first}(?:${rest}*${first})?`;
  const core=String.raw`[A-Za-z]:[\\/](?:${piece}[\\/])*?${first}${rest}*?\.(?:${known})(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:C[1-9]\d*)?(?:-L[1-9]\d*)?)?`;
  /* Só no texto corrido: o nome (depois da última barra) não atravessa frase. Ele para em . , ; ou ! seguidos de espaço
     e tem no máximo 120 caracteres: "C:\Users\hugom\Meu Projeto. Dentro dela está o README.md" não vira um link de 56
     caracteres. Dentro de crases o texto inteiro já é o caminho: o isDriveFile segue com o core, sem essa regra. */
  const coreText=core.replace(rest+'*?\\.(?:','(?:(?![.,;!]\\s)'+rest+'){0,120}?\\.(?:');
  const inText=new RegExp(String.raw`(?<![\w:/\\])(${coreText})(?=$|[\s,;:!?)\]}"'”’»…>|*]|\.(?!\w))`,'gi');
  const whole=new RegExp('^'+core+'$','i');
  // só os que têm espaço: sem espaço a regex simples do app já dá conta (e entende mais extensões)
  function findSpacedPaths(text){
    const found=[];
    if(typeof text!=='string')return found;
    for(const m of text.matchAll(inText))if(/\s/.test(m[1])&&!isNetworkPath(m[1]))found.push({index:m.index,path:m[1]});
    return found;
  }
  // o texto INTEIRO é um arquivo X:\... (é o que decide se um código entre crases vira link)
  function isDriveFile(value){return typeof value==='string'&&whole.test(value)&&!isNetworkPath(value);}
  /* Leva 3 (peso): caminho sem espaço, em tempo linear. O regex do app (o "re" do linkarArquivos) sozinho é
     quadrático: num pedaço enorme sem espaço e sem ".ext" no fim (400 KB de "/-/-/-…", base64, texto minificado),
     cada "/" vira um começo que varre o pedaço até o fim e volta (~1 minuto). Um caminho nunca atravessa espaço nem
     "'<>)|*? (o mesmo conjunto do corpo do re): o re roda pedaço por pedaço, e cada pedaço é cortado logo depois do
     ÚLTIMO ponto seguido de letra ou número, com a extensão e o :linha/#L grudados. Todo caminho termina num ".ext",
     então nada depois do corte casaria e nenhum começo depois dele é tentado. Mesmo resultado do re no texto inteiro,
     desde que o re (o de app.js, em linkarArquivos, global) continue assim:
       1. o corpo é [^\s"'<>)|*?]+ (a classe de "runs") e nenhum caractere do prefixo, da extensão nem da cauda cai fora dela;
       2. todo achado acaba em ponto + letra/número (a extensão) e, no máximo, na cauda :N:N ou #LNCN-LN: só caracteres de
          [A-Za-z0-9:#-] (a classe de "tail");
       3. o lookbehind não recusa nenhum delimitador (espaço e "'<>)|*?): no começo do pedaço ele enxerga "nada";
       4. o re não olha o que vem depois da cauda (sem lookahead).
     Mexeu no re, mexe aqui junto, e rode test/linkar-arquivos-linear.test.js: ele compara com o re no texto inteiro. */
  const runs=/[^\s"'<>)|*?]+/g,tail=/[A-Za-z0-9:#-]*/y;
  function findPlainPaths(text,re){
    // o laço abaixo só termina com um re global (o lastIndex anda sozinho): sem o g ele repetiria o mesmo achado para sempre
    if(!re||!re.global)throw new TypeError('findPlainPaths: o re precisa ser uma RegExp global (flag g)');
    const found=[];
    if(typeof text!=='string')return found;
    runs.lastIndex=0;
    for(let run;(run=runs.exec(text));){
      const piece=run[0];
      let dot=-1;
      for(let k=piece.length-2;k>=0;k--)if(piece[k]==='.'&&/[A-Za-z0-9]/.test(piece[k+1])){dot=k;break;}
      if(dot<0)continue;
      tail.lastIndex=dot+1;tail.exec(piece);
      const cut=piece.slice(0,tail.lastIndex);
      re.lastIndex=0;
      for(let m;(m=re.exec(cut));){
        // casamento vazio não anda o lastIndex: sem este passo o laço não terminaria. Achado vazio não é caminho: pula
        if(m[0]==='')re.lastIndex++;
        else found.push({index:run.index+m.index,path:m[1]});
      }
    }
    return found;
  }
  /* Junta as duas listas: as com espaço, e das outras só as que não caem dentro de uma delas. As duas vêm em ordem e sem
     sobreposição dentro de cada uma, então a conferência anda junto (antes era um "some" na lista inteira para cada
     caminho: quadrático numa linha com milhares de caminhos). */
  function mergePaths(spaced,plain){
    const out=spaced.slice();let j=0;
    for(const p of plain){
      while(j<spaced.length&&spaced[j].index+spaced[j].path.length<=p.index)j++;
      if(!(j<spaced.length&&spaced[j].index<p.index+p.path.length))out.push(p);
    }
    return out.sort((a,b)=>a.index-b.index);
  }
  return{parse,resolve,dirname,isNetworkPath,findSpacedPaths,isDriveFile,findPlainPaths,mergePaths};
});
