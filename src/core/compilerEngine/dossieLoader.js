'use strict';

// ============================================================
// DOSSIÊ LOADER — Lê o contrato formal por nicho (quando existe).
//
// tema-{nicho}-dossie.json substitui, para o nicho migrado, a
// combinação impl.json + tokens_css do meta.json + blocks.json.
// Nichos ainda não migrados não têm esse arquivo — carregarNichoDossie
// retorna null, e nichoBlocks.js cai no cano legado (walker heurístico).
//
// Diferente de blockLibrary.carregarBlocos, um erro de parse aqui é
// logado explicitamente: um dossiê corrompido não deve se comportar
// como "nicho ainda não migrado" silenciosamente.
// ============================================================

const fs   = require('fs');
const path = require('path');

const TEMAS_DIR = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');

// Cache em memória: nicho → dossiê (ou null se ausente/inválido).
const _cache = new Map();

// ──────────────────────────────────────────────────────────────
// carregarNichoDossie — lê e cacheia o dossiê de um nicho.
// Retorna null se o arquivo não existir (nicho ainda não migrado)
// OU se o JSON estiver corrompido (loga aviso explícito nesse caso).
// ──────────────────────────────────────────────────────────────
function carregarNichoDossie(nichoTema) {
    if (!nichoTema || typeof nichoTema !== 'string') return null;

    const base = nichoTema.replace(/^tema-/, '');
    if (_cache.has(base)) return _cache.get(base);

    const filePath = path.join(TEMAS_DIR, `tema-${base}-dossie.json`);

    let dossie = null;
    if (fs.existsSync(filePath)) {
        try {
            dossie = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            console.warn(`[DOSSIE] tema-${base}-dossie.json existe mas está corrompido: ${e.message}`);
            dossie = null;
        }
    }

    _cache.set(base, dossie);
    return dossie;
}

// ──────────────────────────────────────────────────────────────
// limparCache — usado em testes.
// ──────────────────────────────────────────────────────────────
function limparCache() {
    _cache.clear();
}

module.exports = { carregarNichoDossie, limparCache };
