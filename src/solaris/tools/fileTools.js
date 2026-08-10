'use strict';

// ============================================================
// SOLARIS FILE TOOLS (Fase 1)
// ============================================================
// Ferramentas determinísticas de arquivo — createHtml/createCss/createJs/
// createZip/readProject/scanProject do roadmap. Usadas HOJE de duas
// formas:
//   1. Chamadas DIRETO pelo Orquestrador (pipeline/orchestrator.js) — o
//      manifesto já decide determinísticamente qual arquivo gerar e
//      quando, então não precisa do modelo "decidir" invocar a
//      ferramenta (mesmo princípio #5 do CLAUDE.md: IA só entra onde
//      não há alternativa determinística viável).
//   2. Usadas como implementação (não como schema) pelos loops de
//      tool-calling reais: pipeline/projectInspector.js (SOMENTE
//      LEITURA — lerArquivo/listarProjeto/buscarNoProjeto) e
//      pipeline/projectEditor.js (LEITURA + ESCRITA — os mesmos três
//      mais criarArquivo/deletarArquivo). Ambos declaram seu próprio
//      schema de ferramenta no formato plain-object que
//      modelRouter.executarTarefaComFerramentas espera — o
//      FUNCTION_DECLARATIONS abaixo (formato Type do SDK) é
//      anterior a essa wiring real e ficou órfão; mantido só porque
//      fileTools.test.js ainda o exercita, não fingir que é o schema
//      em uso.
//
// Toda escrita/leitura é confinada a um baseDir (guardado contra path
// traversal — "../" ou caminho absoluto nunca escapa do projeto) —
// entrada de caminho pode vir de um manifesto gerado por IA, tratada
// como não-confiável.
// ============================================================

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const yauzl = require('yauzl');
const { Type } = require('@google/genai');

/** Resolve `caminhoRelativo` dentro de `baseDir`, garantindo que o
 *  resultado não escapa do baseDir (path traversal). Lança se escapar —
 *  achado real de segurança: caminho vem de manifesto gerado por IA,
 *  entrada não-confiável, nunca deve tocar filesystem fora do projeto. */
function _resolverSeguro(baseDir, caminhoRelativo) {
    if (typeof caminhoRelativo !== 'string' || !caminhoRelativo.trim()) {
        throw new Error('[SOLARIS-FILETOOLS] caminho vazio ou inválido.');
    }
    const baseAbs = path.resolve(baseDir);
    const alvoAbs = path.resolve(baseAbs, caminhoRelativo);
    if (alvoAbs !== baseAbs && !alvoAbs.startsWith(baseAbs + path.sep)) {
        throw new Error(`[SOLARIS-FILETOOLS] caminho "${caminhoRelativo}" escapa do diretório do projeto — recusado.`);
    }
    return alvoAbs;
}

/** Cria/sobrescreve um arquivo dentro do projeto, criando diretórios
 *  intermediários conforme necessário. Retorna { ok, caminhoAbsoluto }. */
function criarArquivo(baseDir, caminhoRelativo, conteudo) {
    const alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    fs.mkdirSync(path.dirname(alvoAbs), { recursive: true });
    fs.writeFileSync(alvoAbs, conteudo ?? '', 'utf-8');
    return { ok: true, caminhoAbsoluto: alvoAbs };
}

const criarHtml = (baseDir, caminho, conteudo) => criarArquivo(baseDir, caminho, conteudo);
const criarCss  = (baseDir, caminho, conteudo) => criarArquivo(baseDir, caminho, conteudo);
const criarJs   = (baseDir, caminho, conteudo) => criarArquivo(baseDir, caminho, conteudo);

/** Apaga um arquivo do projeto. Nunca lança — path traversal ou arquivo
 *  ausente viram { ok:false, erro } (mesmo contrato de lerArquivo/
 *  criarArquivo — entrada de caminho vem de manifesto/proposta gerada
 *  por IA, tratada como não-confiável). */
function deletarArquivo(baseDir, caminhoRelativo) {
    let alvoAbs;
    try {
        alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    } catch (e) {
        return { ok: false, erro: e.message };
    }
    if (!fs.existsSync(alvoAbs) || !fs.statSync(alvoAbs).isFile()) {
        return { ok: false, erro: `arquivo "${caminhoRelativo}" não existe no projeto.` };
    }
    fs.unlinkSync(alvoAbs);
    return { ok: true };
}

/** Lê um arquivo do projeto. Nunca lança por arquivo ausente — retorna
 *  { ok:false, erro } (entrada externa, resultado esperado a reportar). */
function lerArquivo(baseDir, caminhoRelativo) {
    let alvoAbs;
    try {
        alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    } catch (e) {
        return { ok: false, erro: e.message };
    }
    if (!fs.existsSync(alvoAbs) || !fs.statSync(alvoAbs).isFile()) {
        return { ok: false, erro: `arquivo "${caminhoRelativo}" não existe no projeto.` };
    }
    return { ok: true, conteudo: fs.readFileSync(alvoAbs, 'utf-8') };
}

/** Lista todo arquivo do projeto (recursivo), caminhos relativos ao
 *  baseDir — scanProject do roadmap. Projeto inexistente retorna []. */
function listarProjeto(baseDir) {
    const baseAbs = path.resolve(baseDir);
    if (!fs.existsSync(baseAbs)) return [];
    const arquivos = [];
    (function andar(dirAbs) {
        for (const nome of fs.readdirSync(dirAbs)) {
            const abs = path.join(dirAbs, nome);
            if (fs.statSync(abs).isDirectory()) andar(abs);
            else arquivos.push(path.relative(baseAbs, abs).split(path.sep).join('/'));
        }
    })(baseAbs);
    return arquivos.sort();
}

/** Empacota o projeto inteiro (ou só os caminhos passados) num Buffer
 *  ZIP — mesmo padrão já usado em src/services/storageService.js
 *  (archiver, zlib nível 6). Resolve com o Buffer completo (projeto de
 *  Solaris é pequeno — poucos arquivos de texto — bufferizar é seguro,
 *  diferente do streaming direto pro GCS do storageService). */
function criarZip(baseDir, caminhos = null) {
    return new Promise((resolve, reject) => {
        const alvos = caminhos && caminhos.length ? caminhos : listarProjeto(baseDir);
        if (alvos.length === 0) {
            reject(new Error('[SOLARIS-FILETOOLS] criarZip: projeto sem arquivo nenhum pra empacotar.'));
            return;
        }
        const archive = archiver('zip', { zlib: { level: 6 } });
        const chunks = [];
        archive.on('data', (chunk) => chunks.push(chunk));
        archive.on('error', reject);
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        for (const caminhoRelativo of alvos) {
            const abs = _resolverSeguro(baseDir, caminhoRelativo);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                archive.append(fs.createReadStream(abs), { name: caminhoRelativo });
            }
        }
        archive.finalize();
    });
}

// Limites de segurança pra extração de ZIP enviado por usuário (entrada
// não-confiável por definição — upload). Três defesas independentes:
//   1. quantidade de arquivo (zip com milhares de entradas minúsculas —
//      "quantidade" é uma variante de zip bomb tão real quanto tamanho).
//   2. tamanho declarado no cabeçalho de CADA entrada (filtra cedo, antes
//      de gastar CPU descomprimindo algo óbvio demais).
//   3. tamanho REAL lido durante a descompressão de cada entrada — um
//      zip malicioso pode mentir no cabeçalho; só o byte count real
//      durante o stream pega isso (a checagem 2 sozinha não é suficiente).
// Valores calibrados pro caso de uso real (projeto web pequeno — poucas
// dezenas de arquivo de texto), não pra upload de projeto grande.
const ZIP_MAX_ARQUIVOS        = 300;
const ZIP_MAX_TAMANHO_ARQUIVO = 5  * 1024 * 1024;  // 5MB por arquivo
const ZIP_MAX_TAMANHO_TOTAL   = 30 * 1024 * 1024;  // 30MB descomprimido, total

// Lê os metadados de toda entrada do zip SEM descomprimir nada —
// puro central-directory, custo desprezível mesmo pra zip grande. É o
// PASSO 1 de extrairZip: valida o zip inteiro antes de qualquer
// escrita em disco, pra rejeição ser atômica de verdade (um zip com
// 1 entrada maliciosa no meio não deixa as entradas legítimas
// anteriores já gravadas em disco — achado real testando a primeira
// versão desta função, que extraía incrementalmente e só then
// validava, gravando o começo do zip antes de rejeitar o resto).
function _listarEntradasZip(zipfile) {
    return new Promise((resolve, reject) => {
        const entradas = [];
        let finalizado = false;

        zipfile.on('error', (e) => {
            if (finalizado) return;
            finalizado = true;
            reject(e);
        });
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
            if (finalizado) return;
            entradas.push(entry);
            zipfile.readEntry();
        });
        zipfile.on('end', () => {
            if (finalizado) return;
            finalizado = true;
            resolve(entradas);
        });
    });
}

// Extrai UMA entrada já validada pro destino em disco — PASSO 2 de
// extrairZip, só chamado depois que o zip inteiro passou na validação.
function _extrairEntrada(zipfile, entry, alvoAbs, maxTamanhoArquivo) {
    return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (errStream, readStream) => {
            if (errStream) { reject(new Error(`falha lendo a entrada "${entry.fileName}" — ${errStream.message}`)); return; }

            fs.mkdirSync(path.dirname(alvoAbs), { recursive: true });
            const writeStream = fs.createWriteStream(alvoAbs);
            let bytesLidos = 0;
            let finalizado = false;

            function falhar(err) {
                if (finalizado) return;
                finalizado = true;
                readStream.destroy();
                writeStream.destroy();
                reject(err);
            }

            readStream.on('data', (chunk) => {
                bytesLidos += chunk.length;
                // Defesa em profundidade: cabeçalho do zip pode mentir
                // sobre uncompressedSize — só o byte count real durante
                // a descompressão pega isso de verdade.
                if (bytesLidos > maxTamanhoArquivo) {
                    falhar(new Error(`arquivo "${entry.fileName}" excede o tamanho declarado no cabeçalho do zip — recusado.`));
                }
            });
            readStream.on('error', (e) => falhar(new Error(`erro extraindo "${entry.fileName}" — ${e.message}`)));
            writeStream.on('error', (e) => falhar(new Error(`erro gravando "${entry.fileName}" — ${e.message}`)));
            writeStream.on('close', () => {
                if (finalizado) return;
                finalizado = true;
                resolve();
            });
            readStream.pipe(writeStream);
        });
    });
}

/** Extrai um ZIP (Buffer) pra dentro do baseDir — extractZip do
 *  roadmap, usado no fluxo real de upload. Nunca EXECUTA nada do que
 *  extrai — só grava bytes em disco pra depois serem lidos como TEXTO
 *  puro (ver tools/frameworkDetector.js: o conteúdo vira string,
 *  nunca `eval`/`require`/child_process). Duas fases, pra garantir
 *  atomicidade de verdade:
 *    Fase 1 — valida TODO o zip via metadados do central directory
 *    (nome de arquivo, tamanho declarado, contagem), sem escrever nada
 *    em disco ainda. Qualquer violação rejeita o zip INTEIRO aqui —
 *    nada chega a ser gravado.
 *    Fase 2 — só roda se a Fase 1 passou 100%: extrai de verdade,
 *    ainda validando o byte count real de cada entrada contra o
 *    tamanho declarado (defesa em profundidade — cabeçalho pode
 *    mentir).
 *  Guardado contra zip-slip (entrada apontando pra fora do destino via
 *  "../"/caminho absoluto) em DUAS camadas: `yauzl.validateFileName`
 *  (Fase 1) + `_resolverSeguro` (mesmo guard usado por toda escrita
 *  deste módulo, defesa em profundidade).
 *
 *  @returns {Promise<{ ok: true, arquivos: string[] }>} caminhos
 *    relativos extraídos (rejeita a Promise com Error em qualquer falha
 *    — chamador decide se trata como erro de usuário ou de sistema).
 */
async function extrairZip(baseDir, zipBuffer, opts = {}) {
    const maxArquivos        = opts.maxArquivos        || ZIP_MAX_ARQUIVOS;
    const maxTamanhoArquivo  = opts.maxTamanhoArquivo   || ZIP_MAX_TAMANHO_ARQUIVO;
    const maxTamanhoTotal    = opts.maxTamanhoTotal     || ZIP_MAX_TAMANHO_TOTAL;

    if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
        throw new Error('[SOLARIS-FILETOOLS] extrairZip: zipBuffer vazio ou inválido.');
    }

    const zipfile = await new Promise((resolve, reject) => {
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (errAbrir, zf) => {
            if (errAbrir) reject(new Error(`zip inválido ou corrompido — ${errAbrir.message}`));
            else resolve(zf);
        });
    }).catch((e) => { throw new Error(`[SOLARIS-FILETOOLS] extrairZip: ${e.message}`); });

    let todasEntradas;
    try {
        todasEntradas = await _listarEntradasZip(zipfile);
    } catch (e) {
        zipfile.close();
        throw new Error(`[SOLARIS-FILETOOLS] extrairZip: erro lendo o zip — ${e.message}`);
    }

    // ── Fase 1: validação completa, zero escrita em disco ──────────
    const arquivos = []; // { entry, alvoAbs, relativo }
    let totalBytes = 0;
    for (const entry of todasEntradas) {
        if (/\/$/.test(entry.fileName)) continue; // diretório — não conta como arquivo

        const erroNome = yauzl.validateFileName(entry.fileName);
        if (erroNome) {
            zipfile.close();
            throw new Error(`[SOLARIS-FILETOOLS] extrairZip: entrada "${entry.fileName}" com nome inválido (${erroNome}) — possível zip-slip, zip inteiro recusado.`);
        }

        if (arquivos.length + 1 > maxArquivos) {
            zipfile.close();
            throw new Error(`[SOLARIS-FILETOOLS] extrairZip: mais de ${maxArquivos} arquivos no zip — recusado (limite de segurança).`);
        }

        if (entry.uncompressedSize > maxTamanhoArquivo) {
            zipfile.close();
            throw new Error(`[SOLARIS-FILETOOLS] extrairZip: arquivo "${entry.fileName}" (${entry.uncompressedSize} bytes declarados) excede o limite de ${maxTamanhoArquivo} bytes por arquivo.`);
        }

        totalBytes += entry.uncompressedSize;
        if (totalBytes > maxTamanhoTotal) {
            zipfile.close();
            throw new Error(`[SOLARIS-FILETOOLS] extrairZip: total descomprimido excede ${maxTamanhoTotal} bytes — recusado (proteção contra zip bomb).`);
        }

        let alvoAbs;
        try {
            alvoAbs = _resolverSeguro(baseDir, entry.fileName);
        } catch (e) {
            zipfile.close();
            throw new Error(`[SOLARIS-FILETOOLS] extrairZip: entrada "${entry.fileName}" — ${e.message}`);
        }

        arquivos.push({ entry, alvoAbs, relativo: entry.fileName });
    }

    // ── Fase 2: zip inteiro validado — agora sim extrai de verdade ──
    const arquivosExtraidos = [];
    try {
        for (const { entry, alvoAbs, relativo } of arquivos) {
            await _extrairEntrada(zipfile, entry, alvoAbs, maxTamanhoArquivo);
            arquivosExtraidos.push(relativo);
        }
    } catch (e) {
        zipfile.close();
        throw new Error(`[SOLARIS-FILETOOLS] extrairZip: ${e.message}`);
    }

    zipfile.close();
    return { ok: true, arquivos: arquivosExtraidos.sort() };
}

// Busca um termo literal (case-insensitive) em todo arquivo de texto do
// projeto — mesmo padrão de src/ai/solAgent.js:_buscarNoCodigo, mas
// escopado a um baseDir de projeto (upload do usuário) em vez do
// código-fonte da Softload. Usada pelo loop de tool-calling de inspeção
// de projeto (ver pipeline/projectInspector.js) — nunca lê fora do
// baseDir (reusa listarProjeto/lerArquivo, já confinados).
const BUSCA_MAX_RESULTADOS = 30;
function buscarNoProjeto(baseDir, termo) {
    if (!termo || typeof termo !== 'string' || !termo.trim()) {
        return { erro: 'Termo de busca vazio.' };
    }
    const alvo = termo.trim().toLowerCase();
    const ocorrencias = [];

    for (const caminho of listarProjeto(baseDir)) {
        if (ocorrencias.length >= BUSCA_MAX_RESULTADOS) break;
        const r = lerArquivo(baseDir, caminho);
        if (!r.ok) continue; // arquivo binário/ilegível como texto — pula, não é erro
        const linhas = r.conteudo.split('\n');
        for (let i = 0; i < linhas.length; i++) {
            if (linhas[i].toLowerCase().includes(alvo)) {
                ocorrencias.push({ caminho, linha: i + 1, trecho: linhas[i].trim().slice(0, 200) });
                if (ocorrencias.length >= BUSCA_MAX_RESULTADOS) break;
            }
        }
    }

    return {
        termo,
        totalEncontrado: ocorrencias.length,
        truncado: ocorrencias.length >= BUSCA_MAX_RESULTADOS,
        ocorrencias,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Declarações Gemini (function calling) — uso futuro em modo agêntico.
// ──────────────────────────────────────────────────────────────────────────
const FUNCTION_DECLARATIONS = [
    {
        name: 'createHtml',
        description: 'Cria ou sobrescreve um arquivo HTML no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "index.html").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo HTML completo do arquivo.' },
            },
        },
    },
    {
        name: 'createCss',
        description: 'Cria ou sobrescreve um arquivo CSS no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "css/style.css").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo CSS completo do arquivo.' },
            },
        },
    },
    {
        name: 'createJs',
        description: 'Cria ou sobrescreve um arquivo JavaScript no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "js/script.js").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo JavaScript completo do arquivo.' },
            },
        },
    },
    {
        name: 'readProject',
        description: 'Lê o conteúdo de um arquivo já existente no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto.' },
            },
        },
    },
    {
        name: 'scanProject',
        description: 'Lista todos os arquivos já existentes no projeto atual (caminhos relativos).',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

module.exports = {
    criarArquivo,
    criarHtml,
    criarCss,
    criarJs,
    deletarArquivo,
    lerArquivo,
    listarProjeto,
    buscarNoProjeto,
    criarZip,
    extrairZip,
    FUNCTION_DECLARATIONS,
    _resolverSeguro,
};
