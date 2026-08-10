'use strict';

// ==========================================
// PÓS-COMPILAÇÃO: DETECÇÃO DE ÓRFÃOS
// ==========================================

/**
 * Detecta e remove placeholders [[...]] não substituídos.
 * Retorna o XML limpo. Vazio = nenhum órfão encontrado.
 */
function detectarOrfaos(xml) {
    const encontrados = xml.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (!encontrados) return xml;

    const uniq = [...new Set(encontrados)];
    console.warn('[COMPILER] ⚠️  Placeholders órfãos removidos:', uniq.join(', '));

    return xml
        .replace(/^[ \t]*\[\[[A-Z0-9_]+\]\][ \t]*(?:\r?\n|$)/gm, '')
        .replace(/[ \t]*\[\[[A-Z0-9_]+\]\][ \t]*/g, ' ')
        .replace(/[ \t]+(\r?\n)/g, '$1')
        .replace(/(\r?\n){3,}/g, '$1$1');
}

module.exports = { detectarOrfaos };
