'use strict';
// Exercita produtores de DOM/eventos reais, mas só com dados fictícios.
(() => {
  async function seed() {
    const qa=window.__qa;
    if (!qa || !HOME || !cfg.abaAtiva) return setTimeout(seed,50);
    if (qa.fixture==='vazio') {qa.ready=true;return;}
    try {
      sairDaAbertura();
      const descriptors=[
        {engine:'claude',titulo:'Revisar navegação lateral'},
        {engine:'codex',titulo:'Implementar integração remota'},
        {engine:'gemini',titulo:'Conferir textos da interface'}
      ];
      const created=[];
      comMontagemAdiada(()=>{for(const descriptor of descriptors){const panel=newPane({...descriptor,cwd:cfg.defCwd,abaId:cfg.abaAtiva});created.push(panel);}});
      for (const [i,panel] of created.entries()) {
        panel.sessaoId=`qa-session-${i}`;panel.started=true;
        if(typeof pintarNome==='function')pintarNome(panel);
        textFinal(panel,`qa-message-${i}`,[
          'Revisei a navegação. **A conversa continua sendo o centro da tela.**\n\nA barra reúne as sessões por lugar e sinaliza onde você precisa responder. Falta sua autorização para aplicar a alteração abaixo.',
          'Estou verificando a ligação com o servidor.\n\n- Preservar a conversa de cada motor.\n- Confirmar o destino antes de enviar.\n- Cancelar respostas que chegaram depois de uma troca de sessão.',
          'A revisão terminou. Os rótulos repetidos foram substituídos por símbolos com nomes acessíveis.\n\n**Pronto para o próximo prompt.**'
        ][i],{});
        qa.emit('onPaneEvent',{paneId:panel.id,kind:'tokens',total:[184000,91000,26000][i],janela:[1000000,1000000,200000][i]});
      }
      // Desfazer a edição (Tarefa 9): ?cenario=desfazer. O Claude (1o painel) fez dois Edits num turno: um deu
      // certo (o diff do passo tem "Desfazer esta mudança") e outro deu erro (sem botão). Abra "2 passos" e "ver mudança".
      if (qa.fixture==='desfazer') {
        const P0=created[0].id;
        qa.emit('onPaneEvent',{paneId:P0,kind:'busy'});
        qa.emit('onPaneEvent',{paneId:P0,kind:'tool-start',id:'qa-edit-ok',name:'Edit',arg:'C:/Projetos/Demonstracao/src/app.js',mudanca:{path:'C:/Projetos/Demonstracao/src/app.js',tipo:'edit',antes:'const pronto = false;\nconst titulo = "Painel";',depois:'const pronto = true;\nconst titulo = "Painel principal";',todas:false}});
        qa.emit('onPaneEvent',{paneId:P0,kind:'tool-end',id:'qa-edit-ok',output:'The file C:/Projetos/Demonstracao/src/app.js has been updated.',error:false});
        qa.emit('onPaneEvent',{paneId:P0,kind:'tool-start',id:'qa-edit-erro',name:'Edit',arg:'C:/Projetos/Demonstracao/src/menu.js',mudanca:{path:'C:/Projetos/Demonstracao/src/menu.js',tipo:'edit',antes:'abrirMenu()',depois:'abrirMenuLateral()',todas:false}});
        qa.emit('onPaneEvent',{paneId:P0,kind:'tool-end',id:'qa-edit-erro',output:'String to replace not found in file.',error:true});
        qa.emit('onPaneEvent',{paneId:P0,kind:'turn-end'});
      }
      // no cenario do plano o Claude esta' esperando o plano, nao uma permissao. A mudanca de exemplo usa o formato
      // de verdade do main (path/tipo, mudancaDaFerramenta); antes usava "arquivo", que a tela nao le (Tarefa 9)
      if (qa.fixture!=='plano') qa.emit('onPaneEvent',{paneId:created[0].id,kind:'approval',key:'qa-approval-1',title:'Editar navegação',detail:'src/renderer/cockpit-ui.js',tool:'Edit',allowAlways:true,
        mudanca:{path:'src/renderer/cockpit-ui.js',tipo:'edit',antes:'const aberto = false;',depois:'const aberto = true;'}});
      qa.emit('onPaneEvent',{paneId:created[1].id,kind:'busy'});
      qa.emit('onPaneEvent',{paneId:created[1].id,kind:'plano',itens:[{txt:'Separar destinos',estado:'feito'},{txt:'Conferir retomada',estado:'fazendo'},{txt:'Validar cancelamento',estado:'pendente'}]});
      qa.emit('onPaneEvent',{paneId:created[2].id,kind:'turn-end'});
      qa.emit('onPaneEvent',{paneId:created[2].id,kind:'robos',tarefas:[{id:'qa-robo-1',tipo:'agente',desc:'Conferir contraste dos quatro temas'}]});
      // Trecho selecionado (Tarefa 2): a resposta do Claude (1o painel) fica PRONTA, com o painel
      // parado; é nela que a barra do trecho aparece ao selecionar. ?cenario=trecho mostra também
      // uma mensagem presa a um trecho e outro trecho esperando em cima da caixa de escrever.
      if (qa.fixture==='trecho') {
        userMsg(created[0],comCitacao('A barra reúne as sessões por lugar e sinaliza onde você precisa responder.','Mostre como isso fica com duas pastas abertas.'));
        citarTrecho(created[0],'Falta sua autorização para aplicar a alteração abaixo.');
      }
      // Nome dos agentes (Tarefa 7): ?cenario=agentes. O Claude (1o painel) solta 3 subagentes com a descrição em
      // inglês; a Torre e o passo "Chamando um agente" trocam pelo nome em português que o Haiku daria (aqui, fixo).
      if (qa.fixture==='agentes') {
        cfg.tituloAuto=true;
        const P0=created[0].id;
        const agentes=[
          {id:'toolu_qa_1',paneId:P0,engine:'claude',task:'Explore codebase for auth flow',tipo:'Explore',pedido:'Find where the login and the session are handled and list what matters.',state:'running',parentId:'qa-session-0'},
          {id:'toolu_qa_2',paneId:P0,engine:'claude',task:'Review landing page copy',tipo:'general-purpose',pedido:'Read every text of the home page and check each link and button.',state:'running',parentId:'qa-session-0'},
          {id:'toolu_qa_3',paneId:P0,engine:'claude',task:'Run the test suite',tipo:'general-purpose',pedido:'Run npm test and summarize the failures in plain words.',state:'completed',message:'Todos os testes passaram.',parentId:'qa-session-0'}
        ];
        const nomes={toolu_qa_1:{titulo:'Procurando login',linha:'procura onde o sistema cuida do login'},toolu_qa_2:{titulo:'Revisando página',linha:'confere textos e links da home'},toolu_qa_3:{titulo:'Testando sistema',linha:'confere se o sistema funciona'}};
        qa.override('agentesSessao',async ()=>({itens:agentes.map(a=>({...a}))}));
        qa.override('agentesNomes',async lista=>Object.fromEntries((lista||[]).map(a=>[a.chave,nomes[String(a.chave).split('|')[1]]]).filter(x=>x[1])));
        qa.emit('onPaneEvent',{paneId:P0,kind:'busy'});
        for (const a of agentes) {
          qa.emit('onPaneEvent',{paneId:P0,kind:'agent-state',agent:a});
          qa.emit('onPaneEvent',{paneId:P0,kind:'tool-start',id:a.id,name:'Agent',arg:a.task});
        }
      }
      // Leva 5i, o Workflow dos agentes como ORGANOGRAMA: ?cenario=supervisao (o padrao) traz uma equipe de exemplo no painel do Claude (o 1o).
      // Para ver: clique no icone de gente (👥) da barra do painel do Claude. No topo a conversa; 4 filhos (1 precisa de voce, 2 rodando, 1 falhou);
      // 2 netos sob um dos que rodam (Auditando funil); 3 concluidos num cartao so'. Os tempos andam ao vivo. Os nomes em portugues (o que o Haiku
      // daria) entram direto no agNomes: nada e' pedido a motor nenhum. O clique no cartao abre o detalhe; o "ler a conversa" usa o agentHistory do mock.
      // (num try proprio: se faltar algo do app, o erro vai para __qa.errors e o resto da previa, que todos os cenarios usam, segue de pe')
      if (qa.fixture==='supervisao') try {
        const P0=created[0].id,agora=Date.now(),atras=s=>agora-s*1000;
        const base={paneId:P0,engine:'claude',parentId:'qa-session-0',state:'running',threadId:'',historySupported:false,endedAt:0};
        const equipe=[
          {...base,id:'qa-ag-1',task:'Migrate the offers table',model:'claude-opus-5-5',state:'waiting',startedAt:atras(48),message:'Posso apagar a coluna "preco_antigo" da tabela de ofertas?'},
          {...base,id:'qa-ag-2',task:'Audit the sales funnel step by step',model:'claude-sonnet-5-5',startedAt:atras(250),threadId:'qa-task-2',historySupported:true,message:'Etapa 3 de 5: conferindo o checkout.'},
          {...base,id:'qa-ag-3',task:'Compare the cost per lead of the campaigns',model:'claude-sonnet-5-5',startedAt:atras(95)},
          {...base,id:'qa-ag-4',task:'Measure mobile page speed',model:'claude-haiku-5-5',state:'failed',startedAt:atras(140),endedAt:atras(109),message:'O Chrome não abriu na porta 9333.'},
          {...base,id:'qa-ag-2a',parentId:'qa-ag-2',task:'Review the sales page styles',model:'claude-haiku-5-5',startedAt:atras(134),threadId:'qa-task-2a',historySupported:true},
          {...base,id:'qa-ag-2b',parentId:'qa-ag-2',task:'Check where every button goes',model:'claude-haiku-5-5',startedAt:atras(62)},
          {...base,id:'qa-ag-5',task:'Read the ads that are live',model:'claude-haiku-5-5',state:'completed',startedAt:atras(400),endedAt:atras(218),message:'Encontrei 12 anúncios no ar.'},
          {...base,id:'qa-ag-6',task:'Search competitor sales pages',model:'claude-sonnet-5-5',state:'completed',startedAt:atras(380),endedAt:atras(272),message:'Separei 5 páginas de concorrentes.'},
          {...base,id:'qa-ag-7',task:'Organize the results spreadsheet',model:'claude-haiku-5-5',state:'completed',startedAt:atras(330),endedAt:atras(300),message:'Planilha organizada.'}
        ];
        const nomes={'qa-ag-1':['Migrando banco','troca a coluna antiga e pergunta antes'],'qa-ag-2':['Auditando funil','confere cada etapa da página à compra'],
          'qa-ag-3':['Comparando custos','compara o custo por lead das campanhas'],'qa-ag-4':['Medindo velocidade','mede a velocidade da página no celular'],
          'qa-ag-2a':['Revisando visual','confere o estilo da página de vendas'],'qa-ag-2b':['Testando links','abre cada botão e confere o destino'],
          'qa-ag-5':['Lendo anúncios','lê os anúncios que estão no ar'],'qa-ag-6':['Buscando concorrentes','procura páginas de vendas dos concorrentes'],
          'qa-ag-7':['Organizando planilha','junta os resultados numa planilha só']};
        qa.override('agentesSessao',async o=>({itens:equipe.filter(a=>!o||o.paneId==null||String(a.paneId)===String(o.paneId)).map(a=>({...a}))}));
        for (const a of equipe) { const [titulo,linha]=nomes[a.id]; agNomes.nomes.set(chaveDoAgente(a),{titulo,linha}); }
        for (const a of equipe) qa.emit('onPaneEvent',{paneId:P0,kind:'agent-state',agent:a});
      } catch (error) { qa.errors.push('equipe de exemplo: '+String(error.stack||error)); }
      // Plano pronto (Tarefa 8): ?cenario=plano. O Claude (1o painel) esta' no Plano vindo do "Sem pedir
      // permissão", ocupado, com o cartão do plano em markdown na conversa e uma pergunta dele (AskUserQuestion,
      // id claude_q_…) na caixa de perguntas. Executar volta pro "Sem pedir permissão" sem religar.
      if (qa.fixture==='plano') {
        const P0=created[0];
        P0.mode='plan';P0.modoAntesDoPlano='bypass';pintarModo(P0);
        qa.emit('onPaneEvent',{paneId:P0.id,kind:'busy'});
        qa.emit('onPaneEvent',{paneId:P0.id,kind:'plano-pronto',chave:'claude_p_1_qa-plano',arquivoDoPlano:'C:/Users/qa/.claude/plans/navegacao.md',
          plano:'## Plano: navegação lateral\n\n1. Ler `src/renderer/cockpit-ui.js` e achar onde a barra agrupa as conversas.\n2. Trocar o título repetido por um símbolo com nome acessível.\n3. Rodar os testes da Torre e conferir os quatro temas.\n\n**Arquivos:** `cockpit-ui.js`, `cockpit-ui.css`.\n\n| Passo | Risco |\n|---|---|\n| 1 | nenhum |\n| 2 | baixo |\n| 3 | nenhum |'});
        qa.emit('onPaneEvent',{paneId:P0.id,kind:'pergunta',id:'claude_q_1_qa-pergunta',bloqueante:true,perguntas:[
          {titulo:'Símbolo',pergunta:'Qual símbolo usar no lugar do título repetido?',varias:false,opcoes:[{rotulo:'Pasta',detalhe:'o mesmo ícone da barra'},{rotulo:'Ponto colorido',detalhe:'a cor da aba'}]},
          {titulo:'Temas',pergunta:'Em quais temas conferir?',varias:true,opcoes:[{rotulo:'Escuro',detalhe:''},{rotulo:'Claro',detalhe:''},{rotulo:'Jornal',detalhe:''}]}]});
      }
      setFocus(created[0]);
      qa.panels=created.map(panel=>panel.id);
      qa.panel=id=>acharPainel(id);
      qa.setTheme=tema=>{cfg.tema=tema;aplicarTema(tema);};
      qa.events=event=>qa.emit('onPaneEvent',event);
      qa.snapshot=()=>({panels:[...panes.values()].map(p=>({id:p.id,engine:p.engine,session:p.sessaoId,busy:p.busy,permissions:p.filaPerm?.length||0,draft:p.el.querySelector('.p-input')?.value})),calls:qa.calls.length,missing:[...qa.missing],errors:[...qa.errors]});
      qa.ready=true;
      document.title='Cockpit — prévia isolada com dados fictícios';
      dispatchEvent(new CustomEvent('cockpit-qa-ready'));
    } catch(error) {qa.errors.push(String(error.stack||error));qa.ready=true;console.error('QA fixture',error);}
  }
  addEventListener('load',()=>setTimeout(seed,150),{once:true});
})();
