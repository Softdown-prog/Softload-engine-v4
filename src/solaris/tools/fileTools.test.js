'use strict';

/**
 * Testes de fileTools.js — usa um diretório temporário sob o scratchpad
 * da sessão, limpo no fim.
 *
 * Execute: node src/solaris/tools/fileTools.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const {
    criarArquivo, criarHtml, criarCss, criarJs, deletarArquivo,
    lerArquivo, listarProjeto, buscarNoProjeto, criarZip, extrairZip, FUNCTION_DECLARATIONS,
} = require('./fileTools');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-filetools-test-'));

async function run() {
    // A. criarArquivo escreve o conteúdo, cria diretórios intermediários.
    {
        const r = criarHtml(baseDir, 'index.html', '<h1>oi</h1>');
        assert('criarHtml retorna ok:true', r.ok === true);
        assert('arquivo existe de verdade', fs.existsSync(path.join(baseDir, 'index.html')));
        assert('conteúdo bate', fs.readFileSync(path.join(baseDir, 'index.html'), 'utf-8') === '<h1>oi</h1>');

        criarCss(baseDir, 'css/style.css', 'body{color:red}');
        assert('criarCss cria diretório intermediário (css/)', fs.existsSync(path.join(baseDir, 'css', 'style.css')));

        criarJs(baseDir, 'js/app.js', 'console.log(1);');
        assert('criarJs escreve no lugar certo', fs.readFileSync(path.join(baseDir, 'js', 'app.js'), 'utf-8') === 'console.log(1);');
    }

    // B. path traversal é recusado — nunca escreve fora do baseDir.
    {
        let erro = null;
        try { criarArquivo(baseDir, '../fora-do-projeto.txt', 'x'); } catch (e) { erro = e; }
        assert('".." é recusado', erro && /escapa do diretório/.test(erro.message));
        assert('arquivo NÃO foi criado fora do baseDir', !fs.existsSync(path.join(baseDir, '..', 'fora-do-projeto.txt')));

        let erro2 = null;
        try { criarArquivo(baseDir, '/etc/passwd', 'x'); } catch (e) { erro2 = e; }
        assert('caminho absoluto é recusado', erro2 !== null);
    }

    // C. lerArquivo — sucesso e arquivo ausente (não lança).
    {
        const r = lerArquivo(baseDir, 'index.html');
        assert('lerArquivo lê o conteúdo real', r.ok === true && r.conteudo === '<h1>oi</h1>');

        const r2 = lerArquivo(baseDir, 'nao-existe.html');
        assert('lerArquivo de arquivo ausente não lança, retorna erro', r2.ok === false && /não existe/.test(r2.erro));
    }

    // D. listarProjeto — recursivo, caminhos relativos com "/".
    {
        const arquivos = listarProjeto(baseDir);
        assert('listarProjeto lista os 3 arquivos criados', arquivos.length === 3, JSON.stringify(arquivos));
        assert('caminho usa "/" (não separador de SO)', arquivos.includes('css/style.css'));
        assert('projeto inexistente retorna []', listarProjeto(path.join(baseDir, 'nao-existe')).length === 0);
    }

    // E. criarZip — Buffer ZIP válido (assinatura PK\x03\x04), contém os arquivos certos.
    {
        const zipBuffer = await criarZip(baseDir);
        assert('criarZip retorna um Buffer', Buffer.isBuffer(zipBuffer));
        assert('Buffer começa com assinatura ZIP (PK)', zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4b);
        assert('Buffer tem tamanho > 0', zipBuffer.length > 0);
    }

    // F. criarZip de projeto vazio rejeita com erro claro.
    {
        const dirVazio = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-filetools-vazio-'));
        let erro = null;
        try { await criarZip(dirVazio); } catch (e) { erro = e; }
        assert('criarZip de projeto vazio rejeita', erro && /sem arquivo nenhum/.test(erro.message));
        fs.rmSync(dirVazio, { recursive: true, force: true });
    }

    // G. FUNCTION_DECLARATIONS — schema Gemini presente pros 5 verbos, formato válido.
    {
        const nomes = FUNCTION_DECLARATIONS.map((f) => f.name);
        assert('createHtml/createCss/createJs/readProject/scanProject declarados',
            ['createHtml', 'createCss', 'createJs', 'readProject', 'scanProject'].every((n) => nomes.includes(n)));
        assert('toda declaração tem description', FUNCTION_DECLARATIONS.every((f) => typeof f.description === 'string' && f.description.length > 0));
    }

    // H. extrairZip — helper local que cria um Buffer ZIP arbitrário (sem
    // passar por baseDir/criarZip) pra testar extração isolada.
    function _criarZipBuffer(entradas) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const archive = archiver('zip', { zlib: { level: 6 } });
            archive.on('data', (c) => chunks.push(c));
            archive.on('end', () => resolve(Buffer.concat(chunks)));
            archive.on('error', reject);
            for (const { name, content } of entradas) archive.append(content, { name });
            archive.finalize();
        });
    }

    // H1. extrairZip — extração legítima, conteúdo preservado.
    {
        const zipBuffer = await _criarZipBuffer([
            { name: 'app.py', content: 'from flask import Flask\napp = Flask(__name__)' },
            { name: 'templates/index.html', content: '<h1>Oi</h1>' },
        ]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        const r = await extrairZip(dir, zipBuffer);
        assert('extrairZip: ok true', r.ok === true);
        assert('extrairZip: lista os 2 arquivos', r.arquivos.length === 2, JSON.stringify(r.arquivos));
        assert('extrairZip: conteúdo do app.py preservado', fs.readFileSync(path.join(dir, 'app.py'), 'utf8').includes('Flask(__name__)'));
        assert('extrairZip: diretório intermediário criado', fs.existsSync(path.join(dir, 'templates', 'index.html')));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H2. extrairZip — zip-slip (entrada com "../" incorporado no meio do
    // caminho, sobrevive à sanitização do archiver ao criar o zip) é
    // recusado inteiro, nada é extraído.
    {
        const zipBuffer = await _criarZipBuffer([
            { name: 'ok.txt', content: 'arquivo legítimo' },
            { name: 'a/../../evil.txt', content: 'tentativa de escapar do baseDir' },
        ]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro = null;
        try { await extrairZip(dir, zipBuffer); } catch (e) { erro = e; }
        assert('extrairZip: zip-slip rejeitado', erro !== null, erro ? erro.message : 'não lançou');
        assert('extrairZip: zip-slip — nada foi extraído (nem o arquivo legítimo)', fs.readdirSync(dir).length === 0);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H3. extrairZip — arquivo individual maior que o limite é recusado.
    {
        const zipBuffer = await _criarZipBuffer([{ name: 'grande.txt', content: 'x'.repeat(1000) }]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro = null;
        try { await extrairZip(dir, zipBuffer, { maxTamanhoArquivo: 500 }); } catch (e) { erro = e; }
        assert('extrairZip: arquivo grande demais rejeitado', erro !== null && /excede/.test(erro.message), erro ? erro.message : 'não lançou');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H4. extrairZip — total descomprimido acima do limite é recusado
    // (proteção contra zip bomb), mesmo com cada arquivo individual OK.
    {
        const zipBuffer = await _criarZipBuffer([
            { name: 'a.txt', content: 'x'.repeat(300) },
            { name: 'b.txt', content: 'x'.repeat(300) },
            { name: 'c.txt', content: 'x'.repeat(300) },
        ]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro = null;
        try { await extrairZip(dir, zipBuffer, { maxTamanhoArquivo: 500, maxTamanhoTotal: 700 }); } catch (e) { erro = e; }
        assert('extrairZip: total descomprimido grande demais rejeitado', erro !== null && /zip bomb/.test(erro.message), erro ? erro.message : 'não lançou');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H5. extrairZip — mais arquivos que o limite é recusado.
    {
        const entradas = [];
        for (let i = 0; i < 5; i++) entradas.push({ name: `arquivo${i}.txt`, content: 'x' });
        const zipBuffer = await _criarZipBuffer(entradas);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro = null;
        try { await extrairZip(dir, zipBuffer, { maxArquivos: 3 }); } catch (e) { erro = e; }
        assert('extrairZip: excesso de arquivos rejeitado', erro !== null && /mais de 3 arquivos/.test(erro.message), erro ? erro.message : 'não lançou');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H6. extrairZip — buffer corrompido/não-ZIP rejeita com erro claro, não lança exceção crua.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro = null;
        try { await extrairZip(dir, Buffer.from('isso não é um zip')); } catch (e) { erro = e; }
        assert('extrairZip: buffer corrompido rejeitado com erro claro', erro !== null && /extrairZip/.test(erro.message));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H7. extrairZip — entrada inválida (buffer vazio/não-Buffer) rejeita sem lançar cru.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-extrairzip-test-'));
        let erro1 = null;
        try { await extrairZip(dir, Buffer.alloc(0)); } catch (e) { erro1 = e; }
        assert('extrairZip: buffer vazio rejeitado', erro1 !== null);

        let erro2 = null;
        try { await extrairZip(dir, null); } catch (e) { erro2 = e; }
        assert('extrairZip: buffer null rejeitado', erro2 !== null);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // I. buscarNoProjeto — grep case-insensitive escopado ao baseDir.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-buscarnoprojeto-test-'));
        criarArquivo(dir, 'app.py', 'from flask import Flask\napp = Flask(__name__)\n# roda em debug');
        criarArquivo(dir, 'templates/index.html', '<h1>Olá</h1>');

        const r1 = buscarNoProjeto(dir, 'flask');
        assert('buscarNoProjeto: acha ocorrência case-insensitive', r1.totalEncontrado === 2, JSON.stringify(r1));
        assert('buscarNoProjeto: inclui caminho e número da linha', r1.ocorrencias[0].caminho === 'app.py' && r1.ocorrencias[0].linha === 1);
        assert('buscarNoProjeto: não trunca com poucos resultados', r1.truncado === false);

        const r2 = buscarNoProjeto(dir, 'não-existe-isso-em-lugar-nenhum');
        assert('buscarNoProjeto: termo ausente retorna 0 ocorrências', r2.totalEncontrado === 0);

        const r3 = buscarNoProjeto(dir, '');
        assert('buscarNoProjeto: termo vazio retorna erro', typeof r3.erro === 'string');

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // J. deletarArquivo — remove de verdade, arquivo ausente e path
    // traversal não lançam (mesmo contrato de lerArquivo/criarArquivo).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-deletararquivo-test-'));
        criarArquivo(dir, 'apagar.txt', 'conteúdo');
        assert('setup: arquivo existe antes de apagar', fs.existsSync(path.join(dir, 'apagar.txt')));

        const r1 = deletarArquivo(dir, 'apagar.txt');
        assert('deletarArquivo: ok:true', r1.ok === true);
        assert('deletarArquivo: arquivo some de verdade do disco', !fs.existsSync(path.join(dir, 'apagar.txt')));

        const r2 = deletarArquivo(dir, 'nao-existe.txt');
        assert('deletarArquivo: arquivo ausente não lança, retorna erro', r2.ok === false && /não existe/.test(r2.erro));

        const r3 = deletarArquivo(dir, '../fora-do-projeto.txt');
        assert('deletarArquivo: path traversal não lança, retorna erro', r3.ok === false && /escapa do diretório/.test(r3.erro));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    fs.rmSync(baseDir, { recursive: true, force: true });
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} fileTools: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
