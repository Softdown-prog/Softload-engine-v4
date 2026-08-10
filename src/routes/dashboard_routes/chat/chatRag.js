'use strict';
// ──────────────────────────────────────────────────────────────────────────
// RAG — carrega múltiplas fontes de conhecimento no startup
// ──────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { criarMatcher, pontuarKeywords } = require('../../../rag/ragMatcher');

const RAG_BASE     = path.join(__dirname, '../../../rag');
const RAG_DIR      = path.join(RAG_BASE, 'rag-ia-suporte/ia-de-balcao');
const TEMAS_DIR    = path.join(RAG_BASE, 'rag-ia-compiler/pipeline/temas');
const WIDGETS_DIR  = path.join(RAG_BASE, 'rag-ia-compiler/pipeline/widgets');

// Lê os indexes de temas e widgets no startup e monta um catálogo compacto
// para injetar permanentemente no system prompt — a IA sabe exatamente o que existe.
function carregarCatalogo() {
    let catalogo = '\n\n---\n## CATÁLOGO DO QUE EXISTE NO SOFTLOAD ENGINE\n';
    catalogo += 'Use APENAS o que está listado abaixo. Nunca invente nichoTema, widget ou feature que não conste aqui.\n';

    try {
        const temas = JSON.parse(fs.readFileSync(path.join(TEMAS_DIR, 'index.json'), 'utf8'));
        catalogo += '\n### TEMAS DISPONÍVEIS (nichoTema válidos)\n';
        for (const t of (temas.ficheiros || [])) {
            const arq = t.arquivo_meta || t.arquivo_impl || '';
            const id  = arq.replace('tema-', '').replace('-meta.json', '').replace('-impl.json', '');
            const destaques = Array.isArray(t.destaques) ? t.destaques.slice(0, 3).join(', ') : '';
            catalogo += `- **${id}** → ${t.nicho} | ${t.estetica}${destaques ? ` | ex: ${destaques}` : ''}\n`;
        }
    } catch (e) {
        console.warn('[RAG] catálogo de temas não carregado:', e.message);
    }

    try {
        const widgets = JSON.parse(fs.readFileSync(path.join(WIDGETS_DIR, 'index.json'), 'utf8'));
        catalogo += '\n### WIDGETS DISPONÍVEIS\n';
        for (const w of (widgets.ficheiros || [])) {
            const id = w.arquivo.replace('.json', '').replace('widget-', '');
            catalogo += `- **${id}** → ${w.responsabilidade.split(' — ')[0].substring(0, 80)}\n`;
        }
    } catch (e) {
        console.warn('[RAG] catálogo de widgets não carregado:', e.message);
    }

    catalogo += '\nQuando o contexto RAG injetar dados de um tema específico (seção BLUEPRINT DE NICHO), use esses dados como referência técnica. Widgets listados em widgets_complementares do tema são os recomendados para esse nicho.';
    return catalogo;
}

const CATALOGO = carregarCatalogo();

const RAG_FONTES = [
    {
        dir:          path.join(RAG_BASE, 'ia-de-balcao'),
        skipArquivos: new Set(),
    },
    {
        dir:          path.join(RAG_BASE, 'rag-ia-suporte/ia-de-balcao'),
        // personalidade é auto-injetada via carregarPersonalidade() — não indexar para busca
        skipArquivos: new Set(['ia-balcao-personalidade.json']),
    },
    {
        dir:          path.join(RAG_BASE, 'rag-ia-suporte/suporte'),
        skipArquivos: new Set(),
    },
    {
        dir:          path.join(RAG_BASE, 'rag-ia-compiler/pipeline/widgets'),
        skipArquivos: new Set(),
    },
    {
        dir:          path.join(RAG_BASE, 'rag-ia-compiler/pipeline/engenharia'),
        // excluir duplicatas já cobertas por rag-ia-suporte/ia-de-balcao/ (mantém keywords calibradas)
        skipArquivos: new Set([
            'ia-balcao-grid-sidebar-condicional.json',
            'ia-balcao-imagens-responsivas-blogger.json',
        ]),
    },
];

function carregarPersonalidade() {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(RAG_DIR, 'ia-balcao-personalidade.json'), 'utf8'));
        const linhas = [
            `\n\n## ARQUÉTIPO COMPORTAMENTAL`,
            `${data.resumo_em_uma_frase}`,
            ``,
            `### COMPORTAMENTOS ATIVOS`,
            ...(data.comportamentos_ativos || []).map(c =>
                `- **${c.id}**: ${c.descricao}`
            ),
            ``,
            `### COMPORTAMENTOS PROIBIDOS`,
            ...(data.comportamentos_proibidos || []).map(c =>
                `- **${c.id}** (${(c.exemplos || []).slice(0, 2).join(', ')}): ${c.motivo}`
            ),
            ``,
            `### TOM`,
            `${data.tom?.descricao || ''}`,
        ];
        return linhas.join('\n');
    } catch (e) {
        console.warn('[CHAT] personalidade RAG não carregada:', e.message);
        return '';
    }
}

// Índice unificado e cache partilhado — populados no startup
let RAG_INDEX   = [];  // [ { arquivo, _cacheKey, _keywords, _dir, ...resto } ]
const RAG_CACHE = {};  // _cacheKey → objeto JSON parseado

function _carregarFonteRag(fonte) {
    try {
        const idx  = JSON.parse(fs.readFileSync(path.join(fonte.dir, 'index.json'), 'utf8'));
        const rota = idx.rota || path.basename(fonte.dir);
        let   n    = 0;

        for (const entry of (idx.ficheiros || [])) {
            if (fonte.skipArquivos.has(entry.arquivo)) continue;

            // Normaliza: alguns índices usam 'palavras_chave', outros 'tags'
            const keywords  = entry.palavras_chave || entry.tags || [];
            const cacheKey  = `${rota}/${entry.arquivo}`;

            RAG_INDEX.push({ ...entry, _dir: fonte.dir, _cacheKey: cacheKey, _keywords: keywords });

            try {
                RAG_CACHE[cacheKey] = JSON.parse(
                    fs.readFileSync(path.join(fonte.dir, entry.arquivo), 'utf8')
                );
                n++;
            } catch (e) {
                console.warn(`[RAG] Falha ao carregar ${entry.arquivo}:`, e.message);
            }
        }
        console.log(`[RAG] ${rota}: ${n} ficheiros`);
    } catch (e) {
        console.warn(`[RAG] index ausente em ${path.basename(fonte.dir)}:`, e.message);
    }
}

for (const fonte of RAG_FONTES) _carregarFonteRag(fonte);
console.log(`[RAG] ✓ ${Object.keys(RAG_CACHE).length} ficheiros de conhecimento ativos no total.`);

// Máximo de ficheiros injetados por mensagem — antes era ilimitado, e com o
// matching por substring chegava a 5+ ficheiros (30KB+) em perguntas comuns.
const MAX_RAG_POR_MENSAGEM = 4;

// Busca arquivos RAG relevantes pela mensagem do usuário.
// Match por fronteira de palavra + acentos normalizados (ragMatcher), ranqueado
// por especificidade: mais keywords casadas e frases longas sobem no ranking.
function buscarRagRelevante(msg) {
    const matcher = criarMatcher(msg);
    const encontrados = [];
    for (const entry of RAG_INDEX) {
        const { hits, score } = pontuarKeywords(matcher, entry._keywords);
        if (hits > 0 && RAG_CACHE[entry._cacheKey]) {
            encontrados.push({ entry, data: RAG_CACHE[entry._cacheKey], _hits: hits, _score: score });
        }
    }
    encontrados.sort((a, b) => (b._hits - a._hits) || (b._score - a._score));
    return encontrados.slice(0, MAX_RAG_POR_MENSAGEM);
}

// Formata os arquivos RAG como contexto adicional no system prompt.
// data.titulo preferido sobre data.nome (padrão dos widgets/engenharia).
function montarContextoRag(arquivos) {
    if (!arquivos.length) return '';
    const blocos = arquivos.map(({ entry, data }) => {
        const conteudo = JSON.stringify(data, null, 2);
        const label    = data.titulo || data.nome || entry.arquivo;
        return `\n\n## CONHECIMENTO TÉCNICO: ${label}\n\`\`\`json\n${conteudo}\n\`\`\``;
    });
    return `\n\n---\n## BASE DE CONHECIMENTO BLOGGER ATIVA${blocos.join('')}`;
}

module.exports = {
    CATALOGO,
    buscarRagRelevante,
    montarContextoRag,
    carregarPersonalidade,
};
