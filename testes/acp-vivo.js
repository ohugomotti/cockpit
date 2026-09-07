/* Prova VIVA do motor ACP (src/acp.js) contra o "gemini --acp" de verdade.
   Nao entra no rodar-tudo (e' lento e depende de rede + chave): rode na mao.

   O que prova, ponta a ponta, sem o Electron:
     1. sobe o agente, faz o handshake e abre a sessao (modos/modelos lidos)
     2. manda um pedido que EXIGE ferramenta (criar um arquivo)
     3. o agente pede permissao -> a ponte chama o callback -> respondemos
        "permitir" -> o arquivo aparece no disco
     4. os eventos que a tela receberia (busy, tool-start, tool-end, text-final,
        turn-end) sairam na ordem certa
     5. session/set_model: funciona ou o agente recusa (fica registrado)

   Uso:  node testes/acp-vivo.js   (leva ~30-120s) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const plataforma = require('../src/plataforma');
const { criarAcp, lerChaveGemini } = require('../src/acp');

const HOME = os.homedir();
if (!process.env.GEMINI_API_KEY && !lerChaveGemini(HOME)) {
  console.log('SEM CHAVE do Gemini (env ou ~/.gemini/.env) - prova pulada.');
  process.exit(0);
}
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-acp-'));
const alvo = path.join(pasta, 'prova-acp.txt');
const eventos = [];
const pedidos = [];
let acp;
const falhas = [];
const checa = (nome, ok, detalhe) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !detalhe ? '' : '  -> ' + detalhe)); if (!ok) falhas.push(nome); };

acp = criarAcp({
  emit: (paneId, kind, data) => { eventos.push({ kind, ...data }); if (kind !== 'text-final') console.log('    evento', kind, JSON.stringify(data).slice(0, 140)); },
  spawnBin: plataforma.spawnBin, buildEnv: plataforma.buildEnv, matarProcesso: plataforma.matarProcesso,
  HOME, pastaDados: () => path.join(pasta, 'dados'),
  aoPedirPermissao: (paneId, rpcId, info) => {
    pedidos.push(info);
    console.log('    PEDIDO DE PERMISSAO:', JSON.stringify(info).slice(0, 200));
    // como se voce tivesse clicado em "Permitir" um segundo depois
    setTimeout(() => acp.responderPermissao(paneId, rpcId, true), 800);
  },
  aoCair: () => console.log('    (caiu)'),
  autoLiberada: () => false,
});

(async () => {
  const t0 = Date.now();
  try {
    const ok = await acp.start('p1', { comando: 'gemini --acp', cwd: pasta, approval: 'manual' });
    checa('start devolveu true', ok === true);
    const info = eventos.find((e) => e.kind === 'acp-info');
    checa('acp-info chegou com o nome do agente', !!(info && info.agente), JSON.stringify(info));
    checa('modos do agente lidos', !!(info && info.modos && info.modos.length), JSON.stringify(info && info.modos));
    checa('sessao emitida', !!eventos.find((e) => e.kind === 'sessao' && e.id));
    console.log('  (' + Math.round((Date.now() - t0) / 1000) + 's ate a sessao)');

    const fim = new Promise((res) => {
      const olha = setInterval(() => { if (eventos.find((e) => e.kind === 'turn-end')) { clearInterval(olha); res(); } }, 200);
      setTimeout(() => { clearInterval(olha); res(); }, 240000);
    });
    // ACP_MODELO=gemini-3.1-flash-lite quando a cota do modelo padrao acabou (429)
    if (process.env.ACP_MODELO) console.log('  modelo pedido:', process.env.ACP_MODELO, JSON.stringify(await acp.setModelo('p1', process.env.ACP_MODELO)));
    const foi = acp.enviar('p1', 'Crie um arquivo chamado prova-acp.txt nesta pasta com o conteúdo exatamente: OK\nDepois responda só: FEITO', []);
    checa('enviar devolveu true', foi === true);
    await fim;
    console.log('  (' + Math.round((Date.now() - t0) / 1000) + 's ate o fim do turno)');

    const tipos = eventos.map((e) => e.kind);
    checa('busy saiu', tipos.includes('busy'));
    checa('turn-end saiu', tipos.includes('turn-end'));
    checa('houve um passo de ferramenta (tool-start)', tipos.includes('tool-start'), tipos.join(','));
    checa('o passo terminou (tool-end)', tipos.includes('tool-end'));
    checa('o agente pediu permissao e a ponte repassou', pedidos.length > 0);
    const existe = fs.existsSync(alvo);
    checa('o arquivo foi criado no disco', existe, alvo);
    if (existe) checa('com o conteudo pedido', /OK/.test(fs.readFileSync(alvo, 'utf8')), JSON.stringify(fs.readFileSync(alvo, 'utf8')));
    const falas = eventos.filter((e) => e.kind === 'text-final').map((e) => e.text);
    checa('houve fala do agente', falas.length > 0, JSON.stringify(falas.slice(-1)));

    // transcricao propria do Cockpit
    const sess = acp.sessoes();
    checa('a conversa aparece na lista do Cockpit', sess.length === 1 && /prova-acp/.test(sess[0].title), JSON.stringify(sess));
    const hist = acp.historico(sess[0] && sess[0].id, sess[0] && sess[0].file);
    checa('o historico tem a sua fala e a dele', hist.some((m) => m.role === 'user') && hist.some((m) => m.role === 'bot'), JSON.stringify(hist).slice(0, 300));

    // trocar modelo: registra o que o agente faz com session/set_model
    const r = await acp.setModelo('p1', (info && info.modelos && info.modelos[1] && info.modelos[1].id) || 'gemini-3.5-flash');
    console.log('  session/set_model ->', JSON.stringify(r));
  } catch (e) {
    checa('sem excecao', false, String(e && e.stack || e));
  } finally {
    acp.parar('p1');
    setTimeout(() => {
      try { fs.rmSync(pasta, { recursive: true, force: true }); } catch {}
      console.log(falhas.length ? '\n=== ' + falhas.length + ' FALHA(S) ===' : '\n=== MOTOR ACP: PROVADO AO VIVO ===');
      process.exit(falhas.length ? 1 : 0);
    }, 800);
  }
})();
