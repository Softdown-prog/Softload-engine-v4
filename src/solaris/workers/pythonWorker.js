'use strict';

// ============================================================
// SOLARIS PYTHON WORKER (Flask/Django, tipo "py")
// ============================================================
// Único Worker desta pasta que faz shell-out — decisão consciente,
// diferente do motivo de phpWorker.js/jsWorker.js NÃO fazerem isso
// (ver o comentário de topo de src/core/parser/phpParser.js): pra
// PHP/CSS/JS/EJS/JSON existe parser puro-JS maduro o bastante
// (php-parser/PostCSS/Acorn/ejs/JSON.parse), então shell-out nunca foi
// necessário. Pra Python, os parsers puro-JS avaliados (filbert,
// python-ast) não cobrem sintaxe de Python 3 moderna com confiança —
// sem alternativa determinística viável, entra a exceção (mesmo
// raciocínio do princípio #5 do CLAUDE.md — "IA só entra onde não há
// alternativa determinística viável" — generalizado aqui pra
// "shell-out só entra onde não há parser puro-JS viável").
//
// O shell-out é estritamente `ast.parse()`, NUNCA `exec()`/`eval()`:
// ast.parse só constrói a árvore sintática — nenhuma linha do código
// do usuário roda, nenhum import é resolvido, nenhum efeito colateral
// acontece. Mesma garantia de segurança que os parsers puro-JS dos
// outros Workers, só que via processo Python em vez de biblioteca JS.
// Escopo estreito de propósito:
//   - entrada só via stdin — nunca grava o código num arquivo .py real
//     em disco, elimina qualquer chance de algo tentar importá-lo;
//   - sem rede, sem argumento extra, timeout curto (defesa em
//     profundidade — ast.parse não deveria travar nunca, mas nenhum
//     processo externo deste projeto roda sem teto de tempo);
//   - `python3-minimal` na imagem de produção (ver Dockerfile) — só o
//     interpretador + stdlib mínima, zero pip/pacote de terceiro.
// ============================================================

const { execFileSync } = require('child_process');

const TIMEOUT_MS = 5000;

// Traceback do "python3 -c" termina com "SyntaxError: ..." (ou outro tipo
// de erro) na última linha — o resto é o traceback interno da chamada em
// si (irrelevante pro usuário, sempre a mesma stack de "<string>").
function _extrairMensagemErro(stderrBruto) {
    const linhas = (stderrBruto || '').trim().split('\n').filter(Boolean);
    return linhas.length ? linhas[linhas.length - 1] : 'erro de sintaxe Python não identificado.';
}

function validarPy(codigo) {
    if (typeof codigo !== 'string' || !codigo.trim()) {
        return { ok: false, erros: ['código Python vazio ou inválido.'], avisos: [] };
    }

    try {
        execFileSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
            input: codigo,
            timeout: TIMEOUT_MS,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'], // nunca deixa stderr do processo filho vazar pro processo do servidor
        });
        return { ok: true, erros: [], avisos: [] };
    } catch (e) {
        if (e.code === 'ENOENT') {
            // python3 ausente neste ambiente (ex.: dev sem Docker) — não
            // finge que validou; mesmo padrão de "sem Worker pro tipo
            // ainda" já usado em orchestrator.js pra tipo sem Worker
            // registrado, nunca bloqueia a geração por uma lacuna de
            // ambiente que não tem a ver com a correção do código em si.
            return { ok: true, erros: [], avisos: ['python3 não encontrado neste ambiente — sintaxe NÃO foi verificada.'] };
        }
        return { ok: false, erros: [_extrairMensagemErro(e.stderr)], avisos: [] };
    }
}

module.exports = { validarPy };
