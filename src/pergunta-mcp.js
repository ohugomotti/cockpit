/* ===================== A CAIXA DE PERGUNTAS =====================
   Servidor MCP que dá ao motor uma ferramenta pra PERGUNTAR e ESPERAR.

   Por que existe: no modo em que o Cockpit roda o Claude (--print, sem
   terminal), a ferramenta de perguntas que ele usa no terminal simplesmente
   não existe — foi medido: ela não aparece na lista de ferramentas da sessão.
   Sem isso, quando faltava uma decisão sua, ele tinha dois caminhos ruins:
   escolher sozinho e você descobrir depois, ou escrever a pergunta no texto e
   parar o turno, perdendo o trabalho já feito.

   Então o Cockpit passa a oferecer a ferramenta ele mesmo, por um servidor MCP
   próprio (--mcp-config, SEM --strict: medido que assim os seus 29 servidores
   continuam de pé). O motor chama, este processo escreve o pedido num arquivo e
   FICA ESPERANDO. A tela desenha a caixa, você responde, o arquivo da resposta
   aparece e a ferramenta devolve o texto — o turno segue de onde parou, com a
   sua decisão em mãos.

   Por que troca por arquivo e não por socket: este processo é neto do Cockpit
   (Cockpit → claude → este). Arquivo é o mesmo padrão que o resto da casa já
   usa pra falar entre processos, não precisa de porta e sobrevive a qualquer
   ordem de subida.

   Env que o Cockpit passa:
     COCKPIT_PERGUNTAS  pasta onde pedido e resposta se encontram
     COCKPIT_PAINEL     qual painel está perguntando
     COCKPIT_ESPERA_MS  teto de espera (padrão 30 min) */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PASTA = process.env.COCKPIT_PERGUNTAS || '';
const PAINEL = process.env.COCKPIT_PAINEL || 'x';
const ESPERA_MS = Number(process.env.COCKPIT_ESPERA_MS || 30 * 60 * 1000);
const PASSO_MS = 250;

const FERRAMENTA = {
  name: 'perguntar',
  description: [
    'Faz perguntas ao usuário DENTRO do painel e espera a resposta dele antes de continuar.',
    '',
    'Use quando faltar uma decisão que muda o resultado do trabalho: qual caminho seguir,',
    'qual das opções ele prefere, o que fazer com um caso ambíguo. É melhor perguntar aqui',
    'do que escolher por conta e ele descobrir depois — e melhor do que escrever a pergunta',
    'no texto e encerrar o turno, porque assim o trabalho continua de onde parou.',
    '',
    'Não use para pedir permissão de mexer em arquivo (isso tem canal próprio), nem para',
    'perguntas que você mesmo responde lendo o código.',
    '',
    'Junte o que puder numa chamada só: até 4 perguntas de uma vez é melhor do que quatro',
    'idas e voltas. Cada pergunta precisa de 2 a 5 opções prontas — o usuário também pode',
    'escrever a resposta dele, mas as opções são o caminho rápido.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      perguntas: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        description: 'As perguntas, na ordem em que aparecem na tela.',
        items: {
          type: 'object',
          properties: {
            pergunta: { type: 'string', description: 'A pergunta em uma frase, direta.' },
            titulo: { type: 'string', description: 'Rótulo curto de 1 a 3 palavras (ex: "Direção", "Escopo").' },
            opcoes: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              description: 'Respostas prontas. A primeira deve ser a que você recomenda.',
              items: {
                type: 'object',
                properties: {
                  rotulo: { type: 'string', description: 'A opção, curta.' },
                  detalhe: { type: 'string', description: 'Uma linha dizendo o que essa escolha implica.' },
                },
                required: ['rotulo'],
              },
            },
            varias: { type: 'boolean', description: 'true se ele pode marcar mais de uma opção.' },
          },
          required: ['pergunta', 'opcoes'],
        },
      },
    },
    required: ['perguntas'],
  },
};

/* ===== a segunda ferramenta: o PLANO =====
   Medido em 30 dias de uso: em 34 turnos com mais de 10 minutos, NENHUM tinha
   plano - porque a ferramenta de lista de tarefas do Claude (TodoWrite) nao
   existe no modo --print, nem forcando pela flag de ferramentas. Entao o Cockpit
   oferece a dele. O Claude chama, a tela desenha a checklist viva (o painel le
   a chamada direto do fluxo, nao precisa de arquivo) e esta ferramenta so'
   confirma. */
const FERRAMENTA_PLANO = {
  name: 'plano',
  description: [
    'Mostra ao usuário, no painel, a checklist do que você vai fazer e em que pé está cada item.',
    '',
    'Use em qualquer trabalho com mais de 3 passos ou que deva levar mais de 2 minutos:',
    'chame no começo com todos os passos, marque "fazendo" no passo atual e "feito" ao',
    'concluir, e chame de novo a cada mudança. Mande SEMPRE a lista inteira (ela substitui',
    'a anterior). Item curto, em português, no máximo 30 itens.',
    '',
    'É a única forma de o usuário ver o andamento durante um turno longo: sem isso ele fica',
    'olhando um relógio. Não substitui a resposta final nem serve para perguntar nada.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      itens: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        description: 'A lista inteira, na ordem de execução.',
        items: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'O passo, em uma linha curta.' },
            estado: { type: 'string', enum: ['pendente', 'fazendo', 'feito'], description: 'Em que pé está. Só um item por vez em "fazendo".' },
          },
          required: ['texto', 'estado'],
        },
      },
    },
    required: ['itens'],
  },
};

function resumoDoPlano(itens) {
  const lista = (Array.isArray(itens) ? itens : []).slice(0, 30).filter((x) => x && String(x.texto || '').trim());
  if (!lista.length) return null;
  const feitos = lista.filter((x) => x.estado === 'feito' || x.estado === 'completed').length;   // mesmo apelido que o main aceita
  return 'Plano na tela: ' + feitos + '/' + lista.length + ' feitos. Quando algo mudar, mande a lista inteira de novo.';
}

const escrever = (o) => { try { process.stdout.write(JSON.stringify(o) + '\n'); } catch {} };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;

/* O texto vem do modelo. Sem teto, uma pergunta de 100 KB ou com 40 opcoes
   entraria inteira na tela e empurraria a conversa pra fora. Aqui e' o unico
   lugar por onde tudo passa, entao a poda mora aqui. */
const LIM_PERGUNTA = 400;
const LIM_TITULO = 40;
const LIM_ROTULO = 90;
const LIM_DETALHE = 220;
const corta = (v, n) => {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function podar(perguntas) {
  const out = [];
  for (const q of perguntas.slice(0, 4)) {
    if (!q || typeof q !== 'object') continue;
    const pergunta = corta(q.pergunta, LIM_PERGUNTA);
    if (!pergunta) continue;
    const opcoes = [];
    for (const op of (Array.isArray(q.opcoes) ? q.opcoes : []).slice(0, 5)) {
      const rotulo = corta(op && op.rotulo, LIM_ROTULO);
      if (!rotulo) continue;
      opcoes.push({ rotulo, detalhe: corta(op && op.detalhe, LIM_DETALHE) });
    }
    if (opcoes.length < 1) continue;   // sem opcao nao ha o que clicar
    out.push({ pergunta, titulo: corta(q.titulo, LIM_TITULO), opcoes, varias: !!q.varias });
  }
  return out;
}

/* Deixa o pedido na pasta e fica esperando a resposta aparecer. Escrita em dois
   tempos (.tmp + rename) pros dois lados nunca lerem um JSON pela metade. */
async function perguntarEEsperar(perguntas) {
  if (!PASTA) return { erro: 'a caixa de perguntas não está ligada neste painel' };
  const id = PAINEL + '-' + Date.now().toString(36) + '-' + (++seq);
  const pedido = path.join(PASTA, id + '.pedido.json');
  const resposta = path.join(PASTA, id + '.resposta.json');

  try {
    fs.mkdirSync(PASTA, { recursive: true });
    const tmp = pedido + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ id, painel: PAINEL, criado: Date.now(), perguntas }), 'utf8');
    fs.renameSync(tmp, pedido);
  } catch (e) {
    return { erro: 'não consegui abrir a caixa de perguntas: ' + e.message };
  }

  const limite = Date.now() + ESPERA_MS;
  while (Date.now() < limite) {
    await dorme(PASSO_MS);
    let cru;
    try {
      if (!fs.existsSync(resposta)) continue;
      cru = fs.readFileSync(resposta, 'utf8');
    } catch { continue; }
    try { fs.unlinkSync(resposta); } catch {}
    try { fs.unlinkSync(pedido); } catch {}
    try { return { dado: JSON.parse(cru) }; }
    catch { return { erro: 'a resposta chegou ilegível' }; }
  }
  // ninguém respondeu: tira o pedido da tela e deixa o motor decidir o que fazer
  try { fs.unlinkSync(pedido); } catch {}
  try { fs.writeFileSync(path.join(PASTA, id + '.cancelar'), '1', 'utf8'); } catch {}
  return { erro: 'tempo esgotado' };
}

/* Vira o texto que o motor lê. O formato imita o da ferramenta nativa do
   terminal, que o modelo já sabe interpretar. */
function textoDaResposta(perguntas, dado) {
  if (dado && dado.cancelado) {
    return 'O usuário fechou a caixa sem responder. Não invente a resposta: '
      + 'siga pelo caminho mais conservador e diga a ele o que ficou em aberto.';
  }
  const itens = (dado && dado.respostas) || [];
  const partes = [];
  for (let i = 0; i < perguntas.length; i++) {
    const q = perguntas[i] || {};
    const r = itens[i];
    if (r == null || r === '') continue;
    const txt = Array.isArray(r) ? r.join(' + ') : String(r);
    partes.push('"' + String(q.pergunta || '').replace(/"/g, "'") + '"="' + txt.replace(/"/g, "'") + '"');
  }
  if (!partes.length) {
    return 'O usuário não escolheu nada. Não invente a resposta: pergunte de novo, mais direto, ou siga pelo caminho mais conservador.';
  }
  return 'O usuário respondeu: ' + partes.join(', ') + '. Siga com isso em mente.';
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (linha) => {
  let m;
  try { m = JSON.parse(linha); } catch { return; }

  if (m.method === 'initialize') {
    return escrever({
      jsonrpc: '2.0', id: m.id,
      result: {
        protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'cockpit-perguntas', version: '1.0.0' },
      },
    });
  }
  // notificação não tem resposta
  if (typeof m.method === 'string' && m.method.startsWith('notifications/')) return;

  if (m.method === 'tools/list') {
    return escrever({ jsonrpc: '2.0', id: m.id, result: { tools: [FERRAMENTA, FERRAMENTA_PLANO] } });
  }

  if (m.method === 'tools/call') {
    const nome = m.params && m.params.name;
    if (nome === 'plano') {
      const args = (m.params && m.params.arguments) || {};
      const texto = resumoDoPlano(args.itens);
      if (!texto) {
        return escrever({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text',
          text: 'Mande "itens": uma lista de {texto, estado} com estado pendente, fazendo ou feito.' }] } });
      }
      return escrever({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: texto }] } });
    }
    if (nome !== 'perguntar') {
      return escrever({ jsonrpc: '2.0', id: m.id,
        result: { isError: true, content: [{ type: 'text', text: 'ferramenta desconhecida: ' + nome }] } });
    }
    const args = (m.params && m.params.arguments) || {};
    const perguntas = podar(Array.isArray(args.perguntas) ? args.perguntas : []);
    if (!perguntas.length) {
      return escrever({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text',
        text: 'Cada pergunta precisa de um texto e ao menos uma opção. Mande de novo assim.' }] } });
    }
    const r = await perguntarEEsperar(perguntas);
    if (r.erro) {
      const texto = r.erro === 'tempo esgotado'
        ? 'O usuário não respondeu a tempo. Não invente a resposta: siga pelo caminho mais conservador e diga a ele o que ficou em aberto.'
        : 'Não deu para perguntar (' + r.erro + '). Siga sem isso e diga a ele o que ficou em aberto.';
      return escrever({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: texto }] } });
    }
    return escrever({ jsonrpc: '2.0', id: m.id,
      result: { content: [{ type: 'text', text: textoDaResposta(perguntas, r.dado) }] } });
  }

  if (m.id !== undefined) {
    escrever({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'método não suportado: ' + m.method } });
  }
});

// o pai morreu: não fica processo órfão segurando a pasta
process.on('disconnect', () => process.exit(0));
rl.on('close', () => process.exit(0));
