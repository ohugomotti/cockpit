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
      qa.emit('onPaneEvent',{paneId:created[0].id,kind:'approval',key:'qa-approval-1',title:'Editar navegação',detail:'src/renderer/cockpit-ui.js',tool:'Edit',allowAlways:true,
        mudanca:{arquivo:'src/renderer/cockpit-ui.js',antes:'const aberto = false;',depois:'const aberto = true;'}});
      qa.emit('onPaneEvent',{paneId:created[1].id,kind:'busy'});
      qa.emit('onPaneEvent',{paneId:created[1].id,kind:'plano',itens:[{txt:'Separar destinos',estado:'feito'},{txt:'Conferir retomada',estado:'fazendo'},{txt:'Validar cancelamento',estado:'pendente'}]});
      qa.emit('onPaneEvent',{paneId:created[2].id,kind:'turn-end'});
      qa.emit('onPaneEvent',{paneId:created[2].id,kind:'robos',tarefas:[{id:'qa-robo-1',tipo:'agente',desc:'Conferir contraste dos quatro temas'}]});
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
