'use strict';

/**
 * Testes de pythonWorker.js — bate no python3 real (via shell-out), não
 * mocka o processo. Se python3 não estiver instalado neste ambiente, o
 * Worker degrada pra ok:true com aviso explícito (ver comentário do
 * Worker) — os testes cobrem os dois caminhos.
 *
 * Execute: node src/solaris/workers/pythonWorker.test.js
 */

const { validarPy } = require('./pythonWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Python válido (Flask) — sem erro.
{
    const r = validarPy('from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef home():\n    return "oi"\n');
    assert('Python válido: ok true', r.ok === true, JSON.stringify(r));
    assert('Python válido: zero erros', r.erros.length === 0);
}

// B. Python vazio/não-string vira erro (não lança).
{
    const r = validarPy('');
    assert('Python vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}
{
    const r = validarPy(null);
    assert('Python não-string: ok false, sem lançar', r.ok === false);
}
{
    const r = validarPy('   \n  ');
    assert('Python só espaço em branco: ok false', r.ok === false);
}

// C. sintaxe quebrada vira erro (SyntaxError do próprio Python na mensagem).
{
    const r = validarPy('def foo(\n    return 1\n');
    assert('sintaxe quebrada: ok false', r.ok === false, JSON.stringify(r));
    assert('erro cita SyntaxError', /SyntaxError/.test(r.erros[0]), JSON.stringify(r.erros));
}

// D. indentação inconsistente (erro comum e específico de Python) também é pego.
{
    const r = validarPy('def foo():\nreturn 1\n');
    assert('indentação quebrada: ok false', r.ok === false, JSON.stringify(r));
}

// E. nunca lança, mesmo com entrada estranha (objeto em vez de string).
{
    let erro = null;
    let r = null;
    try { r = validarPy({}); } catch (e) { erro = e; }
    assert('entrada não-string nunca lança', erro === null);
    assert('entrada não-string vira ok:false', r && r.ok === false);
}

// F. python3 ausente do ambiente (ENOENT) degrada pra ok:true com aviso
// explícito — nunca finge que validou, nunca bloqueia a geração por causa
// de uma lacuna de ambiente que não tem a ver com o código em si (mesmo
// padrão de "sem Worker pro tipo ainda" do orchestrator.js).
{
    const pathOriginal = process.env.PATH;
    process.env.PATH = '/caminho-que-nao-existe-de-verdade';
    let r = null;
    let erro = null;
    try { r = validarPy('x = 1'); } catch (e) { erro = e; }
    process.env.PATH = pathOriginal;
    assert('python3 ausente: nunca lança', erro === null);
    assert('python3 ausente: degrada pra ok:true com aviso explícito', r && r.ok === true && /não encontrado/.test(r.avisos[0]), JSON.stringify(r));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} pythonWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
