/* Leva 34 ("Sinais"): as pecas puras da tela e do main, extraidas do fonte
   de verdade, e as provas de que o que doia sumiu do codigo (o teto de 8
   passos que apagava erro; a fala do CLI desenhada como se fosse sua). */
const vm = require('vm');
const { RAIZ, lerFonte, pegarBloco, globaisFalsos } = require('./raiz');
const { resultadoFerramenta } = require(require('path').join(RAIZ, 'src', 'cockpit-observability'));

const app = lerFonte('renderer', 'app.js');
const main = lerFonte('main.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

const ctx = { ...globaisFalsos(), console };
vm.createContext(ctx);
for (const f of ['function tipoDoPasso(', 'function legendaDaFala(', 'function marcaDoSistema(', 'function podeContinuar(']) {
  vm.runInContext(pegarBloco(app, f, f), ctx);
}

// --- tipo do passo (filtro da linha do tempo) ---
checa('Bash/Terminal sao terminal', ctx.tipoDoPasso('Bash') === 'terminal' && ctx.tipoDoPasso('Terminal') === 'terminal');
checa('Read/Edit/Write sao arquivo', ['Read', 'Edit', 'Write', 'MultiEdit'].every((n) => ctx.tipoDoPasso(n) === 'arquivo'));
checa('Grep/Glob/WebSearch sao busca', ['Grep', 'Glob', 'WebSearch', 'WebFetch'].every((n) => ctx.tipoDoPasso(n) === 'busca'));
checa('o resto e outro', ctx.tipoDoPasso('Task') === 'outro' && ctx.tipoDoPasso('mcp__x__y') === 'outro');

// --- legenda do "trabalhando…" ---
checa('pega a ULTIMA linha util, sem markdown', ctx.legendaDaFala('## Bloco 3\n\n- item\n\n**Rodando a auditoria** agora') === 'Rodando a auditoria agora');
checa('corta em ~90 caracteres com reticencias', (() => { const l = ctx.legendaDaFala('x'.repeat(200)); return l.length <= 90 && l.endsWith('…'); })());
checa('linha de tabela vazia nao vira legenda', ctx.legendaDaFala('Resumo\n|---|---|') === 'Resumo');
checa('texto vazio da legenda vazia', ctx.legendaDaFala('') === '');

// --- fala do sistema ---
checa('"Continue from where you left off." vira faixa de retomada', /retomado/.test(ctx.marcaDoSistema('Continue from where you left off.')));
checa('interrupcao vira faixa "voce interrompeu"', /interrompeu/.test(ctx.marcaDoSistema('[Request interrupted by user for tool use]')));
checa('fala normal nao e marcada', ctx.marcaDoSistema('continue daqui') === '');

// --- pode continuar ---
checa('parado com conversa: pode', ctx.podeContinuar({ busy: false, queued: null, hist: [{}] }) === true);
checa('trabalhando ou sem conversa: nao', ctx.podeContinuar({ busy: true, hist: [{}] }) === false && ctx.podeContinuar({ busy: false, hist: [] }) === false);
checa('com fila: nao (a fila ja vai continuar)', ctx.podeContinuar({ busy: false, queued: 'x', hist: [{}] }) === false);

// --- o teto de 8 passos sumiu ---
checa('nao ha mais "while (box.children.length > 8)" no app', !app.includes('while (box.children.length > 8)'));
checa('passo() chama ajustarCaixaDePassos (incremental, com o passo novo)', /function passo\(P, frase, id, nome\)[\s\S]*?ajustarCaixaDePassos\(box, d\)/.test(app));
checa('passo() so move a caixa quando ela nao esta no fim (custo constante)', /if \(ultimo !== box\) P\.chat\.appendChild\(box\)/.test(app));
checa('erro fica a vista mesmo recolhido (css)', lerFonte('renderer', 'style.css').includes('.passos.recolhido .passo.erro{display:flex}'));

// --- imagens do resultado da ferramenta (main) ---
const ctxM = { ...globaisFalsos(), console, resultadoFerramenta };
vm.createContext(ctxM);
vm.runInContext('const LIM_IMG_PASSO = 3 * 1024 * 1024;\n' + pegarBloco(main, 'function imagensDoResultado(', 'imagensDoResultado'), ctxM);
const dadosPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
const png = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: dadosPng } };
checa('bloco de imagem base64 vira {mime, dados}', JSON.stringify(ctxM.imagensDoResultado([{ type: 'text', text: 'x' }, png])) === JSON.stringify([{ mime: 'image/png', dados: dadosPng }]));
checa('texto puro nao rende imagem', ctxM.imagensDoResultado('so texto').length === 0);
checa('no maximo 4 por resultado', ctxM.imagensDoResultado(Array.from({ length: 6 }, () => ({ ...png, source: { ...png.source } }))).length === 4);
checa('base64 que não é PNG válido fica de fora', ctxM.imagensDoResultado([{ ...png, source: { ...png.source, data: 'AAAA' } }]).length === 0);
checa('imagem enorme fica de fora', ctxM.imagensDoResultado([{ type: 'image', source: { type: 'base64', data: 'x'.repeat(3 * 1024 * 1024 + 1) } }]).length === 0);

// --- o main entrega a PushNotification e o plano do Cockpit ---
checa('PushNotification vira aviso-agente', /c\.name === 'PushNotification'[\s\S]*?emit\(paneId, 'aviso-agente'/.test(main));
checa('mcp__cockpit__plano vira plano', /c\.name === 'mcp__cockpit__plano'[\s\S]*?emit\(paneId, 'plano'/.test(main));
checa('ferramenta do Cockpit nao pede permissao', /doCockpit = \/\^mcp__cockpit__\//.test(main));
checa('o Claude recebe as instrucoes da casa so no painel local', /args\.push\('--append-system-prompt', INSTRUCOES_COCKPIT\)/.test(main) && /if \(cfgMcp\)/.test(main));

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-sinais: tudo ok');
process.exit(falhas ? 1 : 0);
