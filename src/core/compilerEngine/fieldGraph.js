'use strict';

// ==========================================
// GRAFO DE DEPENDÊNCIAS (Layer 1)
// ==========================================

/**
 * Constrói o grafo de dependências campo→slot a partir do trace de compilação.
 *
 * Equivalente ao Layer 1 do compilador AST legado (removido), mas adaptado
 * ao pipeline Chassis+DNA: não depende de componentLoader nem de resolvers legados.
 *
 * Retorna:
 *   campoParaSlots  Map<campo, string[]>   campo do blueprint → slots influenciados
 *   slotParaCampos  Map<slot,  string[]>   slot → campos do blueprint que o determinam
 *   nos             ASTNode-like[]         todos os nós do trace
 *
 * Uso:
 *   const { xml, trace } = compilarTemplate(chassis, opcoes);
 *   const grafo = construirGrafoCampos(trace);
 */
function construirGrafoCampos(trace) {
    const campoParaSlots = new Map();
    const slotParaCampos = new Map();

    for (const no of trace) {
        slotParaCampos.set(no.slot, no.sources);
        for (const campo of no.sources) {
            if (!campoParaSlots.has(campo)) campoParaSlots.set(campo, []);
            campoParaSlots.get(campo).push(no.slot);
        }
    }

    return { campoParaSlots, slotParaCampos, nos: trace };
}

module.exports = { construirGrafoCampos };
