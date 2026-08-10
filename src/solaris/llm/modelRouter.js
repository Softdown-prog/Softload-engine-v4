'use strict';

// ============================================================
// SOLARIS MODEL ROUTER — orquestração multi-modelo Gemini pro
// Solaris Code (Fase 0).
// ============================================================
// Mesma chave de API (GEMINI_API_KEY), mesmo SDK (@google/genai)
// já usado por src/services/geminiService.js (Blogger Engine) — Solaris
// é um motor separado, mas não duplica dependência nem padrão de acesso
// à API. Dois papéis, dois modelos:
//
//   FLASH — triagem/baixa latência: chat conversacional/escopo do
//   projeto (solarisChat.js — perguntar framework, estrutura, estilo,
//   confirmar manifesto), detecção de framework em upload, parse de
//   relatório de Worker (PostCSS/php -l/etc) pra JSON estruturado,
//   validação pontual. Rápido/barato, adequado ao volume de mensagens
//   de ida-e-volta de uma conversa.
//
//   PRO (+ thinking opcional) — arquiteto: só entra DEPOIS que o
//   usuário confirma o manifesto no chat (marcador
//   [[SOLARIS_GERAR:{...}]], ver solarisGenerationTrigger.js) — gera o
//   manifesto JSON de verdade e o código de cada arquivo via function
//   calling (orchestrator.js), resolução de conflito entre Workers.
//   Tarefa de código complexa, cara e de baixo volume (1x por projeto
//   confirmado, não por mensagem) — cabe o custo/latência maior do Pro.
//   temperature mais alta (criativo), sem streaming (generateContent).
//
// thinkingConfig: a versão do SDK instalada (@google/genai
// 0.24.x) não tipa esse campo, mas generationConfig é repassado opaco
// pro corpo da requisição REST (confirmado lendo dist/index.js) — a
// API do Gemini 2.5 aceita thinkingConfig.thinkingBudget mesmo sem
// suporte explícito no SDK. Nome de campo em camelCase (convenção
// REST/JS), não thinking_budget (Python) do roadmap original.
// ============================================================

const { GoogleGenAI } = require('@google/genai');

const MODEL_FLASH = process.env.SOLARIS_FLASH_MODEL || 'gemini-2.5-flash';
const MODEL_PRO   = process.env.SOLARIS_PRO_MODEL   || 'gemini-2.5-pro';

// Teto real de saída do Gemini 2.5 (Flash/Pro) é 65.536 tokens — não dá
// pra configurar teto de ENTRADA via API (a janela de contexto de 1M é
// nativa do modelo, sem parâmetro pra encolher; um prompt maior que isso
// simplesmente falha na chamada). MAX_OUTPUT_TOKENS é um cap deliberado
// abaixo do teto real, calibrado pelo dono do produto (custo/latência).
const MAX_OUTPUT_TOKENS = Number(process.env.SOLARIS_MAX_OUTPUT_TOKENS) || 60000;

let _genAI = null;

function getClient() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('[SOLARIS-LLM] GEMINI_API_KEY não configurada no ambiente.');
    if (!_genAI) _genAI = new GoogleGenAI({ apiKey: key });
    return _genAI;
}

// Injetável — testes passam um client fake pra não bater na API real.
function criarModelRouter(clientFactory = getClient) {
    return {
        // Triagem de baixa latência (Flash). Uso: detector de framework,
        // parser de diagnóstico de Worker → JSON, ajuste pontual isolado.
        async executarTriagem({ prompt, systemInstruction, responseSchema } = {}) {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('[SOLARIS-LLM] executarTriagem: prompt é obrigatório.');
            }
            const generationConfig = { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS };
            if (responseSchema) {
                generationConfig.responseMimeType = 'application/json';
                generationConfig.responseSchema = responseSchema;
            }
            const model = clientFactory().getGenerativeModel({
                model: MODEL_FLASH,
                systemInstruction,
                generationConfig,
            });
            const result = await model.generateContent(prompt);
            return result.response.text();
        },

        // Mesmo modelo Flash em streaming — async generator, cede cada
        // trecho de texto assim que o Gemini gera (mesmo padrão de
        // src/services/geminiService.js:gerarChatStream). Uso EXCLUSIVO:
        // chat conversacional do Solaris via SSE (evento "chunk" real,
        // não só "status"→"done"). `tokensRef` opcional recebe
        // {total,input,output} ao final, extraído do usageMetadata do
        // último chunk/response — mesma fonte usada em toda cobrança de
        // crédito do projeto.
        //
        // temperature no teto real da API Gemini (2.0 — não existe valor
        // maior: a faixa válida de generationConfig.temperature é 0.0–2.0,
        // qualquer coisa acima é rejeitado pela API). Pedido explícito do
        // dono do produto: deixar o chat o mais livre/criativo possível na
        // resposta, sem se prender à mesma sequência de perguntas a cada
        // mensagem. Não usa a mesma constante de executarTriagem de
        // propósito: aquele método continua em 0.2 porque também serve
        // ragEntryGenerator.js (geração de entrada de catálogo, quer
        // determinismo/JSON confiável, não personalidade de conversa) —
        // subir a temperatura ali afetaria um consumidor que não pediu
        // isso.
        async *executarTriagemStream({ prompt, systemInstruction, tokensRef } = {}) {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('[SOLARIS-LLM] executarTriagemStream: prompt é obrigatório.');
            }
            const generationConfig = { temperature: 2.0, maxOutputTokens: MAX_OUTPUT_TOKENS };
            const model = clientFactory().getGenerativeModel({
                model: MODEL_FLASH,
                systemInstruction,
                generationConfig,
            });
            const result = await model.generateContentStream(prompt);

            let lastChunkUsage = null;
            for await (const chunk of result.stream) {
                const texto = chunk.text();
                if (texto) yield texto;
                if (chunk.usageMetadata) lastChunkUsage = chunk.usageMetadata;
            }

            if (tokensRef) {
                const finalResp = await result.response;
                const usage = finalResp.usageMetadata || lastChunkUsage || {};
                tokensRef.total  = usage.totalTokenCount      ?? 0;
                tokensRef.input  = usage.promptTokenCount     ?? 0;
                tokensRef.output = usage.candidatesTokenCount ?? 0;
            }
        },

        // Tarefa de arquitetura (Pro, thinking opcional). Uso: brainstorm,
        // manifesto JSON, geração de arquivo por arquivo via tools.
        async executarTarefaArquitetura({
            prompt,
            systemInstruction,
            responseSchema,
            tools,
            thinkingBudget = 2048,
        } = {}) {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('[SOLARIS-LLM] executarTarefaArquitetura: prompt é obrigatório.');
            }
            const generationConfig = { temperature: 0.7, maxOutputTokens: MAX_OUTPUT_TOKENS };
            if (responseSchema) {
                generationConfig.responseMimeType = 'application/json';
                generationConfig.responseSchema = responseSchema;
            }
            if (thinkingBudget) {
                generationConfig.thinkingConfig = { thinkingBudget };
            }
            const model = clientFactory().getGenerativeModel({
                model: MODEL_PRO,
                systemInstruction,
                generationConfig,
                tools,
            });
            const result = await model.generateContent(prompt);
            return result.response;
        },

        // Loop de tool-calling genérico (Pro, function-calling) — mesmo
        // formato do loop agêntico já usado em src/ai/solAgent.js
        // (model.startChat + sendMessage com functionResponse), mas
        // reutilizável por qualquer feature do Solaris que precise disso
        // (hoje: pipeline/projectInspector.js), não amarrado a um
        // conjunto fixo de ferramentas. `executorFerramenta(nome, args)`
        // é assíncrono e decide o que cada ferramenta faz de verdade —
        // este método só sabe orquestrar a conversa com o Gemini.
        // Nunca lança por esgotamento de maxToolCalls — devolve o texto
        // que tiver até ali (chamador decide se trata como sucesso
        // parcial ou erro).
        async executarTarefaComFerramentas({
            prompt,
            systemInstruction,
            tools,
            executorFerramenta,
            maxToolCalls = 10,
            thinkingBudget = 0,
            onProgress,
        } = {}) {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('[SOLARIS-LLM] executarTarefaComFerramentas: prompt é obrigatório.');
            }
            if (typeof executorFerramenta !== 'function') {
                throw new Error('[SOLARIS-LLM] executarTarefaComFerramentas: executorFerramenta é obrigatório.');
            }
            const progress = typeof onProgress === 'function' ? onProgress : () => {};

            const generationConfig = { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS };
            if (thinkingBudget) {
                generationConfig.thinkingConfig = { thinkingBudget };
            }
            const model = clientFactory().getGenerativeModel({
                model: MODEL_PRO,
                systemInstruction,
                generationConfig,
                tools,
            });

            const chat = model.startChat({});
            const tokens = { total: 0, input: 0, output: 0 };
            let texto = '';
            let iteracoes = 0;
            let mensagemParaEnviar = prompt;

            while (iteracoes < maxToolCalls) {
                iteracoes++;
                const result = await chat.sendMessage(mensagemParaEnviar);
                const response = result.response;

                const usage = response.usageMetadata;
                if (usage) {
                    tokens.total  += usage.totalTokenCount      ?? 0;
                    tokens.input  += usage.promptTokenCount     ?? 0;
                    tokens.output += usage.candidatesTokenCount ?? 0;
                }

                const parts     = response.candidates?.[0]?.content?.parts || [];
                const chamadas  = parts.filter((p) => p.functionCall);
                const textos    = parts.filter((p) => p.text);

                if (chamadas.length === 0) {
                    texto = textos.map((p) => p.text).join('');
                    break;
                }

                chamadas.forEach((p) => progress({ nome: p.functionCall.name, args: p.functionCall.args }));

                mensagemParaEnviar = await Promise.all(chamadas.map(async (p) => ({
                    functionResponse: {
                        name: p.functionCall.name,
                        response: await executorFerramenta(p.functionCall.name, p.functionCall.args || {}),
                    },
                })));
            }

            return { texto, iteracoes, tokens };
        },

        MODEL_FLASH,
        MODEL_PRO,
    };
}

module.exports = { criarModelRouter, MODEL_FLASH, MODEL_PRO };
