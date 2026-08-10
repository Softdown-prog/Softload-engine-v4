'use strict';

// ==========================================
// SANITIZAÇÃO E VALIDAÇÃO
// ==========================================

/**
 * Escapa entidades HTML para uso em atributos e conteúdo de texto XML.
 * NÃO use para valores CSS — use sanitizarCssColor() para cores.
 */
function sanitizarInput(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Valida se um valor é uma cor hexadecimal válida (#RGB ou #RRGGBB).
 */
function validarHex(hex) {
    return typeof hex === 'string' && /^#([0-9A-Fa-f]{3}){1,2}$/.test(hex.trim());
}

/**
 * Retorna a cor hex se válida, ou o fallback seguro.
 * Impede CSS injection em valores de cores vindos do usuário.
 */
function sanitizarCssColor(val, fallback = '#000000') {
    return validarHex(val) ? val.trim() : fallback;
}

/**
 * Converte hex (#RGB ou #RRGGBB) para o triplet decimal "R,G,B" usado em
 * funções rgba()/rgb() — ex: rgba(var(--sl-primary-rgb), 0.1). Retorna o
 * fallback se o hex for inválido (nunca gera CSS quebrado).
 */
function hexParaRgb(hex, fallback = '0,0,0') {
    if (!validarHex(hex)) return fallback;
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r},${g},${b}`;
}

module.exports = {
    sanitizarInput,
    validarHex,
    sanitizarCssColor,
    hexParaRgb,
};
