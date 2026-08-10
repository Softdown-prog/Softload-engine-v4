'use strict';

// ============================================================
// SOLARIS PROJECT EDITOR (Fase 2d)
// ============================================================
// Loop de tool-calling (Gemini Pro, via modelRouter.executarTarefaComFerramentas)
// que assume o turno de chat inteiro sobre um projeto ANEXADO à sessão
// (upload anterior persistido no GCS via tools/projectStorage.js) —
// substitui o antigo responderComProjeto() de projectInspector.js, que
// era só leitura. Aqui o modelo pode, além de ler
// (readFile/listFiles/searchInProject, reusadas de projectInspector.js),
// PROPOR mudança em arquivo: criar, editar ou deletar.
//
// Confirmação por arquivo, nunca aplicação direta: cada proposta
// (proporMudancaArquivo) fica pendente em memória — nada é escrito no
// projeto de verdade até uma chamada SEGUINTE de aplicarMudancasPendentes,
// e mesmo essa é recusada em código se a proposta foi criada NESTA MESMA
// resposta (`estado.criadasNesteTurno` — mesmo guard reforçado em código
// que templateEditAgent.js usa pra edição de template: nunca confiar só
// no prompt pra essa garantia). Cada arquivo tem sua própria proposta
// pendente — aplicar ou cancelar pode mirar um caminho específico ou
// todos de uma vez.
//
// Validação determinística ANTES de aceitar a proposta (princípio #5 do
// CLAUDE.md, mesmo gate que peça de dossiê gerada por IA passa em
// pecaOrchestrator.js): conteúdo de criar/editar roda pelo Worker do
// tipo certo (WORKER_POR_TIPO de pipeline/orchestrator.js, resolvido
// pela extensão do caminho) — proposta com erro de sintaxe nunca vira
// pendente, o modelo recebe o erro e tenta de novo.
//
// Quem persiste de verdade (baseDir local + GCS via tools/projectStorage.js)
// é o CALLER, injetado como `aplicarMudancasReal` — este módulo não
// conhece GCS/Firestore, só orquestra o loop e o estado de propostas em
// memória do turno (mesmo desenho de aplicarEdicaoReal em
// src/ai/templateEditAgent.js).
// ============================================================

const path = require('path');
const { lerArquivo, _resolverSeguro } = require('../tools/fileTools');
const { WORKER_POR_TIPO } = require('./orchestrator');
const { INSPECAO_TOOLS, _executorFerramenta: executarFerramentaLeitura } = require('./projectInspector');

const MAX_TOOL_CALLS = 10;

const TIPO_POR_EXTENSAO = {
    '.html': 'html', '.htm': 'html',
    '.css': 'css',
    '.js': 'js',
    '.php': 'php',
    '.ejs': 'ejs',
    '.json': 'json',
    '.py': 'py',
};

function _tipoPorCaminho(caminho) {
    return TIPO_POR_EXTENSAO[path.extname(caminho || '').toLowerCase()] || null;
}

const OPERACOES_VALIDAS = ['criar', 'editar', 'deletar'];

const EDICAO_TOOLS = [{
    functionDeclarations: [
        ...INSPECAO_TOOLS[0].functionDeclarations,
        {
            name: 'proporMudancaArquivo',
            description: 'Propõe criar, editar ou deletar um arquivo do projeto — NÃO aplica a mudança, só monta a proposta pendente de confirmação. Cada caminho tem no máximo uma proposta pendente por vez; propor de novo pro mesmo caminho substitui a anterior.',
            parameters: {
                type: 'object',
                required: ['caminho', 'operacao', 'resumo'],
                properties: {
                    caminho: { type: 'string', description: 'Caminho relativo do arquivo dentro do projeto (ex: "app.py", "static/style.css").' },
                    operacao: { type: 'string', enum: OPERACOES_VALIDAS, description: '"criar" (arquivo ainda não existe), "editar" (arquivo já existe, conteúdo novo é o arquivo INTEIRO, não um diff) ou "deletar".' },
                    conteudo: { type: 'string', description: 'Conteúdo completo do arquivo — obrigatório pra "criar"/"editar", ignorado em "deletar".' },
                    resumo: { type: 'string', description: 'Resumo curto em PT-BR do que muda nesse arquivo.' },
                },
            },
        },
        {
            name: 'verPropostasPendentes',
            description: 'Lista as propostas de mudança de arquivo pendentes de confirmação nesta sessão.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'aplicarMudancasPendentes',
            description: 'Aplica de verdade as propostas pendentes (grava no projeto persistido). SÓ chame depois que o usuário confirmar claramente, numa mensagem SEGUINTE à(s) proposta(s) — nunca na mesma resposta em que foram criadas (o sistema recusa isso de qualquer forma).',
            parameters: {
                type: 'object',
                properties: {
                    caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos específicos a aplicar. Omitido = aplica TODAS as propostas pendentes.' },
                },
            },
        },
        {
            name: 'cancelarMudancasPendentes',
            description: 'Descarta proposta(s) pendente(s) sem aplicar — use quando o usuário rejeitar ou desistir.',
            parameters: {
                type: 'object',
                properties: {
                    caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos específicos a cancelar. Omitido = cancela TODAS as propostas pendentes.' },
                },
            },
        },
    ],
}];

const SYSTEM_INSTRUCTION_EDICAO = `Você é o Solaris Code, da Softload, conversando com um usuário sobre um projeto de código que ele enviou por upload anteriormente nesta mesma sessão. Além de responder perguntas sobre o projeto, você também pode PROPOR mudanças nos arquivos — criar um arquivo novo, editar um existente (mandando o arquivo INTEIRO, não um diff) ou apagar um — mas nunca aplica uma mudança sozinho.

Use readFile/listFiles/searchInProject quando precisar entender o projeto antes de responder ou propor algo — nunca invente conteúdo de arquivo que você não leu de verdade, e nunca proponha editar um arquivo sem antes ter lido o conteúdo atual dele.

Pra propor uma mudança, chame proporMudancaArquivo com o caminho, a operacao, o conteúdo completo do arquivo (quando não for deletar) e um resumo curto em PT-BR. Cada proposta fica PENDENTE — nada é gravado até o usuário confirmar. Depois de propor, sempre pergunte se pode aplicar.

Só chame aplicarMudancasPendentes depois que o usuário confirmar CLARAMENTE, numa mensagem SEGUINTE à proposta (ex: "sim", "pode aplicar", "confirmo", "manda ver") — nunca na mesma resposta em que a proposta foi criada (o sistema recusa isso de qualquer forma, então nem tente). Se a resposta for ambígua, pergunte de novo em vez de aplicar. Se o usuário rejeitar ou pedir algo diferente, chame cancelarMudancasPendentes (ou proponha de novo pra substituir). Use verPropostasPendentes se não tiver certeza do que já está pendente.

Se a pergunta não tiver a ver com o conteúdo do projeto nem com propor uma mudança, responda normalmente com base no histórico da conversa, sem forçar uso de ferramenta.

Se algum arquivo (existente ou proposto) parecer conter segredo/credencial (chave de API, senha, token, string de conexão), NÃO reproduza o valor na resposta — só mencione que existe e recomende removê-lo.

Depois que uma mudança for aplicada de verdade, mencione brevemente que ela já foi salva no projeto anexado a esta sessão.

Responda sempre em português do Brasil, direto e natural, como uma continuação da conversa — não repita a lista crua de arquivos.`;

function _formatarHistorico(historico) {
    return (historico || []).map((h) => `${h.autor === 'usuario' ? 'Usuário' : 'Solaris'}: ${h.texto}`).join('\n');
}

function _promptTurno({ framework, arquivos, mensagem, historico, temPropostaPendente }) {
    const lista = arquivos.slice(0, 50).join(', ');
    const contexto = _formatarHistorico(historico);
    const avisoPendencia = temPropostaPendente
        ? '\nHá proposta(s) de mudança de arquivo pendente(s) de confirmação nesta sessão — use verPropostasPendentes se precisar saber quais antes de decidir o que fazer.'
        : '';
    return `Projeto anexado a esta sessão — framework detectado: ${framework || 'não identificado com confiança'}. Total de arquivos: ${arquivos.length}. Alguns caminhos: ${lista}${arquivos.length > 50 ? ', ...' : ''}.${avisoPendencia}
${contexto ? `\nHistórico da conversa até aqui:\n${contexto}\n` : ''}
Pergunta/pedido atual do usuário: "${mensagem}"

Use as ferramentas disponíveis conforme necessário.`;
}

/** Executor de proporMudancaArquivo — validação determinística completa
 *  ANTES de aceitar a proposta (path traversal, consistência
 *  operacao×existência, campos obrigatórios, e o Worker do tipo certo
 *  pra criar/editar). Nunca toca disco — só monta/substitui a entrada
 *  em `estado.propostas`. */
function _executarProporMudanca(baseDir, estado, args) {
    const { caminho, operacao, conteudo, resumo } = args || {};

    if (!OPERACOES_VALIDAS.includes(operacao)) {
        return { erro: `operacao inválida: "${operacao}" — use "criar", "editar" ou "deletar".` };
    }
    try {
        _resolverSeguro(baseDir, caminho || '');
    } catch (e) {
        return { erro: e.message };
    }
    if (!resumo || typeof resumo !== 'string' || !resumo.trim()) {
        return { erro: 'resumo é obrigatório — descreva brevemente a mudança em PT-BR.' };
    }

    const leitura = lerArquivo(baseDir, caminho);
    const existeAtualmente = leitura.ok;

    if (operacao === 'criar' && existeAtualmente) {
        return { erro: `"${caminho}" já existe no projeto — use operacao:"editar" pra modificá-lo.` };
    }
    if (operacao !== 'criar' && !existeAtualmente) {
        return { erro: `"${caminho}" não existe no projeto — use operacao:"criar" pra criar um arquivo novo.` };
    }

    const resumoLimpo = resumo.trim();

    if (operacao === 'deletar') {
        estado.propostas.set(caminho, { caminho, operacao, conteudoNovo: null, resumo: resumoLimpo });
        estado.criadasNesteTurno.add(caminho);
        return { sucesso: true, caminho, operacao, resumo: resumoLimpo };
    }

    if (typeof conteudo !== 'string' || conteudo.length === 0) {
        return { erro: 'conteudo é obrigatório pra criar/editar (não pode ser vazio).' };
    }

    const tipo = _tipoPorCaminho(caminho);
    const worker = tipo ? WORKER_POR_TIPO[tipo] : null;
    let aviso;
    if (worker) {
        const diagnostico = worker(conteudo);
        if (!diagnostico.ok) {
            return {
                erro: 'O conteúdo proposto não passou na validação técnica — não foi aceito como proposta. Corrija e proponha de novo.',
                detalhes: diagnostico.erros || diagnostico,
            };
        }
    } else {
        aviso = `sem validador determinístico pro tipo de arquivo de "${caminho}" ainda — proposta aceita sem checagem automática de sintaxe.`;
    }

    estado.propostas.set(caminho, {
        caminho, operacao,
        conteudoNovo: conteudo,
        resumo: resumoLimpo,
    });
    estado.criadasNesteTurno.add(caminho);
    return { sucesso: true, caminho, operacao, resumo: resumoLimpo, aviso };
}

async function _executarAplicarPendentes(estado, args, aplicarMudancasReal) {
    const caminhosAlvo = Array.isArray(args?.caminhos) && args.caminhos.length
        ? args.caminhos
        : Array.from(estado.propostas.keys());

    if (caminhosAlvo.length === 0) {
        return { erro: 'Não há nenhuma proposta pendente pra aplicar.' };
    }
    const bloqueadas = caminhosAlvo.filter((c) => estado.criadasNesteTurno.has(c));
    if (bloqueadas.length > 0) {
        return {
            erro: `Essas propostas acabaram de ser criadas agora mesmo, nesta mesma conversa — não podem ser aplicadas ainda: ${bloqueadas.join(', ')}. Pergunte ao usuário se ele confirma; só chame esta ferramenta de novo depois que ele responder numa mensagem seguinte.`,
        };
    }
    const naoEncontradas = caminhosAlvo.filter((c) => !estado.propostas.has(c));
    if (naoEncontradas.length > 0) {
        return { erro: `Sem proposta pendente pra: ${naoEncontradas.join(', ')}.` };
    }

    const mudancas = caminhosAlvo.map((c) => estado.propostas.get(c));
    try {
        await aplicarMudancasReal(mudancas);
    } catch (err) {
        return { erro: `Falha ao aplicar as mudanças: ${err.message}` };
    }

    for (const c of caminhosAlvo) estado.propostas.delete(c);
    const aplicadas = mudancas.map((m) => ({ caminho: m.caminho, operacao: m.operacao, resumo: m.resumo }));
    estado.mudancasAplicadas.push(...aplicadas);
    return { sucesso: true, aplicadas };
}

function _executarCancelarPendentes(estado, args) {
    const caminhosAlvo = Array.isArray(args?.caminhos) && args.caminhos.length
        ? args.caminhos
        : Array.from(estado.propostas.keys());

    if (caminhosAlvo.length === 0) {
        return { erro: 'Não há nenhuma proposta pendente pra cancelar.' };
    }
    const canceladas = caminhosAlvo.filter((c) => estado.propostas.delete(c));
    return { sucesso: true, canceladas };
}

/** Roda o turno de chat completo (leitura + proposta/aplicação/cancelamento
 *  de mudança) sobre um projeto ANEXADO à sessão. Nunca lança — falha de
 *  IA (cota, chave, timeout, resposta inválida) vira { ok:false, motivo },
 *  o chamador decide se cai pro chat normal sem o projeto.
 *
 *  @param {string}   baseDir             diretório local temporário com o projeto reconstruído do GCS.
 *  @param {string}   framework
 *  @param {string[]} arquivos
 *  @param {string}   mensagem
 *  @param {Array}    historico
 *  @param {Array}    propostasPendentes  propostas trazidas da sessão anterior ({caminho,operacao,conteudoNovo,resumo}[]) — nunca bloqueadas por criadasNesteTurno (vieram de um turno ANTERIOR).
 *  @param {object}   modelRouter
 *  @param {Function} aplicarMudancasReal async (mudancas[]) => void — grava de verdade (baseDir + GCS), injetado pelo caller.
 *  @returns {Promise<{ok:true,resposta:string,propostasFinais:Array,mudancasAplicadas:Array,iteracoes:number,tokens:object}|{ok:false,motivo:string}>}
 */
async function responderOuEditarProjeto({ baseDir, framework, arquivos, mensagem, historico, propostasPendentes, modelRouter, aplicarMudancasReal, onProgress }) {
    if (!baseDir || !Array.isArray(arquivos) || !mensagem || !modelRouter || typeof aplicarMudancasReal !== 'function') {
        throw new Error('[SOLARIS-PROJECT-EDITOR] responderOuEditarProjeto: baseDir, arquivos, mensagem, modelRouter e aplicarMudancasReal são obrigatórios.');
    }

    const estado = {
        propostas: new Map((propostasPendentes || []).map((p) => [p.caminho, p])),
        criadasNesteTurno: new Set(),
        mudancasAplicadas: [],
    };

    async function executor(nome, args) {
        switch (nome) {
            case 'readFile':
            case 'listFiles':
            case 'searchInProject':
                return executarFerramentaLeitura(baseDir, nome, args);
            case 'proporMudancaArquivo':
                return _executarProporMudanca(baseDir, estado, args);
            case 'verPropostasPendentes':
                return { pendentes: Array.from(estado.propostas.values()).map((p) => ({ caminho: p.caminho, operacao: p.operacao, resumo: p.resumo })) };
            case 'aplicarMudancasPendentes':
                return _executarAplicarPendentes(estado, args, aplicarMudancasReal);
            case 'cancelarMudancasPendentes':
                return _executarCancelarPendentes(estado, args);
            default:
                return { erro: `Ferramenta desconhecida: ${nome}` };
        }
    }

    try {
        const resultado = await modelRouter.executarTarefaComFerramentas({
            prompt: _promptTurno({ framework, arquivos, mensagem, historico, temPropostaPendente: estado.propostas.size > 0 }),
            systemInstruction: SYSTEM_INSTRUCTION_EDICAO,
            tools: EDICAO_TOOLS,
            executorFerramenta: executor,
            maxToolCalls: MAX_TOOL_CALLS,
            onProgress,
        });
        if (!resultado.texto) {
            return { ok: false, motivo: 'o modelo não produziu uma resposta (provável esgotamento do limite de chamadas de ferramenta).' };
        }
        return {
            ok: true,
            resposta: resultado.texto,
            propostasFinais: Array.from(estado.propostas.values()),
            mudancasAplicadas: estado.mudancasAplicadas,
            iteracoes: resultado.iteracoes,
            tokens: resultado.tokens,
        };
    } catch (e) {
        console.warn(`[SOLARIS-PROJECT-EDITOR] responderOuEditarProjeto falhou: ${e.message}`);
        return { ok: false, motivo: e.message };
    }
}

module.exports = { responderOuEditarProjeto, EDICAO_TOOLS, _tipoPorCaminho };
