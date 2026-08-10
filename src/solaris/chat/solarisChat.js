'use strict';

// ============================================================
// SOLARIS CHAT (Fase 0 + Fase 2)
// ============================================================
// Entrada conversacional mínima — só a função de domínio (pergunta →
// resposta via modelRouter.executarTriagem, Flash, baixa latência pra
// bate-papo/brainstorm). Rota HTTP/view/streaming/histórico
// persistente ficam pra uma fase seguinte (ver src/solaris/history/ —
// pasta criada, ainda vazia, mesmo padrão do sol-model quando começou).
//
// Fase 2: casa a mensagem do usuário contra o catálogo RAG (Blog/SaaS/
// Landing Page/Dashboard/etc, ver ragCatalogLoader.js) ANTES de montar
// o prompt — decisão determinística (código), não a IA quem escolhe a
// categoria. Quando casa, injeta o resumo da categoria como contexto de
// sistema pro modelo usar como estrutura sugerida concreta (ver
// SOLARIS_SYSTEM_PROMPT), em vez de perguntas abertas. Sem match, o
// prompt segue sem contexto extra (comportamento original preservado).
// ============================================================

const { criarModelRouter } = require('../llm/modelRouter');
const { SOLARIS_SYSTEM_PROMPT } = require('../prompts/systemPrompt');
const { buscarCategoria, resumirParaPrompt } = require('../rag/ragCatalogLoader');

function _contextoDeCategoria(mensagem) {
    const categoria = buscarCategoria(mensagem);
    if (!categoria) return '';
    // Achado real (usuário reportou "por qualquer pergunta ele sempre fala
    // dos frameworks e das paletas de cores"): o match de keyword aqui é
    // só léxico (ex.: a mensagem citou "Flask" numa pergunta comparativa),
    // não prova que o usuário está pedindo pra escopar/construir esse tipo
    // de projeto agora. Sem a ressalva abaixo, esse contexto competia com
    // a instrução de responder à pergunta real (ver "Antes de seguir o
    // roteiro" no system prompt) e vencia — o modelo usava a estrutura
    // sugerida mesmo em resposta a bate-papo ou pergunta técnica pontual.
    return `\n\n[Contexto do sistema — categoria reconhecida por palavra-chave no pedido do usuário: "${categoria.titulo || categoria.id}" (${JSON.stringify(resumirParaPrompt(categoria))}). Só use isso como base de estrutura se o usuário estiver de fato pedindo pra criar/escopar um projeto desse tipo agora. Se a mensagem for outra coisa — bate-papo, pergunta técnica pontual, pedido não relacionado — ignore este contexto e responda ao que foi perguntado de verdade.]`;
}

function _montarPrompt(mensagem, historico) {
    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
        throw new Error('[SOLARIS-CHAT] mensagem é obrigatória.');
    }
    const contexto = historico
        .map((h) => `${h.autor === 'usuario' ? 'Usuário' : 'Solaris'}: ${h.texto}`)
        .join('\n');
    const base = contexto ? `${contexto}\nUsuário: ${mensagem}` : mensagem;
    return `${base}${_contextoDeCategoria(mensagem)}`;
}

function criarSolarisChat({ modelRouter = criarModelRouter() } = {}) {
    return {
        async perguntar(mensagem, historico = []) {
            const prompt = _montarPrompt(mensagem, historico);
            return modelRouter.executarTriagem({
                prompt,
                systemInstruction: SOLARIS_SYSTEM_PROMPT,
            });
        },

        // Versão streaming de perguntar() — async generator, cede cada
        // trecho de texto assim que o Gemini gera (Fase 2: streaming real
        // no chat, ver src/routes/dashboard_routes/solaris.js). `tokensRef`
        // opcional recebe {total,input,output} ao final, pra cobrança de
        // crédito (mesmo padrão do resto do projeto).
        async *perguntarStream(mensagem, historico = [], tokensRef = null) {
            const prompt = _montarPrompt(mensagem, historico);
            yield* modelRouter.executarTriagemStream({
                prompt,
                systemInstruction: SOLARIS_SYSTEM_PROMPT,
                tokensRef,
            });
        },
    };
}

module.exports = { criarSolarisChat };
