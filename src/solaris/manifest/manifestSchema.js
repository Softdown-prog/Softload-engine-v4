'use strict';

// ============================================================
// MANIFEST SCHEMA — contrato interno do Solaris Code (Fase 0).
// ============================================================
// Espelha o padrão já usado em src/ai/pecaRequestSchema.js e
// src/ai/templateEditSchema.js: schema Gemini restrito (1ª camada,
// Type do @google/genai) + validador server-side (2ª
// camada) que nunca confia cegamente no que a IA devolveu.
//
// O manifesto é o contrato entre Brainstorm → Orquestrador → Workers →
// IA (ver pipeline/orchestrator.js) — todo arquivo que o Solaris gera
// nasce a partir de uma entrada aqui, nunca solto.
// ============================================================

const { Type } = require('@google/genai');

const FRAMEWORKS_VALIDOS = [
    'html5', 'bootstrap5', 'php', 'flask', 'django', 'node-express', 'ejs',
];

const TIPOS_ARQUIVO_VALIDOS = [
    'html', 'css', 'js', 'php', 'py', 'ejs', 'json', 'md', 'outro',
];

const GEMINI_MANIFEST_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    required: ['framework', 'arquivos', 'objetivo'],
    properties: {
        framework: {
            type: Type.STRING,
            enum: FRAMEWORKS_VALIDOS,
            description: 'Framework/stack principal do projeto.',
        },
        objetivo: {
            type: Type.STRING,
            description: 'Resumo de 1-2 frases do que o projeto faz, levantado no brainstorm.',
        },
        paginas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Nomes das páginas/rotas do projeto (ex: ["Home","Sobre","Contato"]).',
        },
        componentes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Componentes reutilizáveis previstos (ex: ["navbar","hero","card-produto"]).',
        },
        arquivos: {
            type: Type.ARRAY,
            description: 'Lista de arquivos que o Orquestrador vai gerar um a um (fluxo granular — nunca tudo numa chamada só).',
            items: {
                type: Type.OBJECT,
                required: ['caminho', 'tipo', 'descricao'],
                properties: {
                    caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "css/style.css").' },
                    tipo: { type: Type.STRING, enum: TIPOS_ARQUIVO_VALIDOS },
                    descricao: { type: Type.STRING, description: 'O que este arquivo específico precisa conter — escopo da chamada de geração granular.' },
                },
            },
        },
        dependencias: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Bibliotecas/dependências externas previstas (ex: ["bootstrap@5","flask"]).',
        },
    },
};

// ──────────────────────────────────────────────────────────────────────────
// validarManifesto — 2ª camada. Descarta campo inválido isolado em vez de
// invalidar o manifesto inteiro, exceto pros campos sem os quais nenhum
// arquivo pode ser gerado (framework/arquivos).
// ──────────────────────────────────────────────────────────────────────────
function validarManifesto(manifesto) {
    const erros = [];
    const avisos = [];

    if (!manifesto || typeof manifesto !== 'object') {
        return { ok: false, erros: ['manifesto não é um objeto.'], avisos, manifesto: null };
    }

    if (!FRAMEWORKS_VALIDOS.includes(manifesto.framework)) {
        erros.push(`framework inválido ou ausente: ${JSON.stringify(manifesto.framework)} — válidos: ${FRAMEWORKS_VALIDOS.join(', ')}.`);
    }

    if (!Array.isArray(manifesto.arquivos) || manifesto.arquivos.length === 0) {
        erros.push('arquivos deve ser um array não-vazio — sem arquivo nenhum não há o que o Orquestrador gerar.');
    }

    const arquivosValidos = [];
    if (Array.isArray(manifesto.arquivos)) {
        for (const [i, arq] of manifesto.arquivos.entries()) {
            if (!arq || typeof arq.caminho !== 'string' || !arq.caminho.trim()) {
                avisos.push(`arquivos[${i}] descartado: caminho ausente/inválido.`);
                continue;
            }
            if (!TIPOS_ARQUIVO_VALIDOS.includes(arq.tipo)) {
                avisos.push(`arquivos[${i}] (${arq.caminho}): tipo inválido, forçado pra 'outro'.`);
            }
            arquivosValidos.push({
                caminho: arq.caminho.trim(),
                tipo: TIPOS_ARQUIVO_VALIDOS.includes(arq.tipo) ? arq.tipo : 'outro',
                descricao: typeof arq.descricao === 'string' ? arq.descricao : '',
            });
        }
    }

    if (erros.length > 0) {
        return { ok: false, erros, avisos, manifesto: null };
    }

    return {
        ok: true,
        erros,
        avisos,
        manifesto: {
            framework: manifesto.framework,
            objetivo: typeof manifesto.objetivo === 'string' ? manifesto.objetivo : '',
            paginas: Array.isArray(manifesto.paginas) ? manifesto.paginas.filter((p) => typeof p === 'string') : [],
            componentes: Array.isArray(manifesto.componentes) ? manifesto.componentes.filter((c) => typeof c === 'string') : [],
            arquivos: arquivosValidos,
            dependencias: Array.isArray(manifesto.dependencias) ? manifesto.dependencias.filter((d) => typeof d === 'string') : [],
        },
    };
}

module.exports = {
    FRAMEWORKS_VALIDOS,
    TIPOS_ARQUIVO_VALIDOS,
    GEMINI_MANIFEST_RESPONSE_SCHEMA,
    validarManifesto,
};
