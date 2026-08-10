'use strict';

// ============================================================
// SOLARIS PROJECT STORAGE — persistência de projeto enviado no GCS
// ============================================================
// Fecha o gap documentado no README: um projeto extraído de upload
// (fileTools.extrairZip) só sobrevivia dentro da MESMA requisição —
// nenhum turno de chat seguinte conseguia perguntar sobre um arquivo
// específico. Este módulo grava/lê os arquivos extraídos no GCS
// (users/{uid}/solaris-projects/{sessionId}/...), usando o `sessionId`
// do chat como chave — cada sessão tem no máximo um projeto anexado
// por vez, sem inventar um segundo identificador.
//
// Por que GCS e não disco local: o servidor roda em Cloud Run, múltiplas
// instâncias sem estado compartilhado por padrão — um baseDir em disco
// só existiria na instância que atendeu aquele request específico. GCS
// é o único jeito de um turno de chat SEGUINTE (que pode cair numa
// instância diferente) ainda enxergar o projeto.
//
// Mesmo princípio de segurança de sempre: o conteúdo persistido é só
// TEXTO — nunca executado, nem aqui nem em nenhum outro lugar (mesma
// garantia de extrairZip/lerArquivo). Cota de armazenamento
// (storageService.reservarCota) é debitada aqui, mesmo pool
// `storage_usado_mb` já usado por compilações e sessões de chat — regra
// geral do projeto, nunca um contador paralelo por feature.
//
// Retenção: TTL automática via `apagarProjetosExpirados()` — cada projeto
// persistido ganha um doc de rastreamento em Firestore
// (`solaris_projetos_persistidos/{uid}_{sessionId}`, com `criadoEm` e
// `tamanhoBytes`), varrido periodicamente (ver POST
// /internal/solaris/limpar-projetos-expirados em apiRoutes.js, ou
// `npm run solaris:limpar-projetos-expirados` manual). Enumerar via
// Firestore em vez de listar o bucket inteiro: mais barato, indexável
// por data, e não depende de escanear objetos não relacionados a
// projetos Solaris que também vivem sob `users/{uid}/`.
// ============================================================

const { bucket, db } = require('../../services/firebase');
const { reservarCota, liberarCota } = require('../../services/storageService');
const { criarArquivo } = require('./fileTools');

const COLECAO_RASTREAMENTO = 'solaris_projetos_persistidos';
const DIAS_RETENCAO_PADRAO = 30;

function _prefixo(uid, sessionId) {
    return `users/${uid}/solaris-projects/${sessionId}`;
}

function _idRastreamento(uid, sessionId) {
    return `${uid}_${sessionId}`;
}

function _manifestoPath(uid, sessionId) {
    return `${_prefixo(uid, sessionId)}/manifesto.json`;
}

function _arquivoPath(uid, sessionId, caminhoRelativo) {
    return `${_prefixo(uid, sessionId)}/files/${caminhoRelativo}`;
}

/**
 * Persiste um projeto no GCS sob `sessionId`. `arquivos` é o mesmo
 * formato já usado por frameworkDetector/projectInspector —
 * `{caminho, conteudo}[]` — o chamador (rota de upload) já tem isso em
 * mãos, evita reler do disco.
 *
 * Reserva cota ANTES de gravar (storageService.reservarCota) — lança
 * `Error` se estourar o limite do plano, sem gravar nada.
 *
 * @returns {Promise<{ok:true, totalArquivos:number, tamanhoBytes:number}>}
 */
async function salvarProjeto({ uid, email, plano, sessionId, framework, arquivos }) {
    const manifesto = {
        sessionId,
        framework,
        arquivos: arquivos.map((a) => a.caminho),
        criadoEm: new Date().toISOString(),
    };
    const manifestoBuf = Buffer.from(JSON.stringify(manifesto), 'utf-8');

    let tamanhoBytes = manifestoBuf.byteLength;
    for (const { conteudo } of arquivos) {
        tamanhoBytes += Buffer.byteLength(conteudo || '', 'utf-8');
    }

    const { confirmarUso } = await reservarCota(email, plano, tamanhoBytes);

    await Promise.all([
        bucket.file(_manifestoPath(uid, sessionId)).save(manifestoBuf, {
            metadata: { contentType: 'application/json; charset=utf-8' },
            resumable: false,
        }),
        ...arquivos.map(({ caminho, conteudo }) =>
            bucket.file(_arquivoPath(uid, sessionId, caminho)).save(Buffer.from(conteudo || '', 'utf-8'), {
                metadata: { contentType: 'text/plain; charset=utf-8' },
                resumable: false,
            })
        ),
    ]);

    await confirmarUso(tamanhoBytes);

    // Doc de rastreamento pra TTL — só o suficiente pra apagarProjetosExpirados
    // varrer por data e pra apagarProjeto() saber quanto liberar de cota,
    // sem precisar ler o manifesto completo do GCS pra isso.
    await db.collection(COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId)).set({
        uid, sessionId, email: (email || '').toLowerCase(), criadoEm: manifesto.criadoEm, tamanhoBytes,
    });

    return { ok: true, totalArquivos: arquivos.length, tamanhoBytes };
}

/**
 * Baixa um projeto persistido de volta pra um diretório local
 * `destDir` (temporário, apagado pelo CHAMADOR ao fim do request —
 * mesmo padrão de extrairZip, nunca sobrevive além de uma requisição
 * em disco local). Retorna `null` se não existir projeto persistido
 * pra essa sessão (upload nunca feito, ou sessão sem anexo) — o
 * chamador decide como degradar, nunca lança nesse caso.
 *
 * @returns {Promise<{framework:string|null, arquivos:string[]}|null>}
 */
async function carregarProjeto(uid, sessionId, destDir) {
    let manifestoBuf;
    try {
        [manifestoBuf] = await bucket.file(_manifestoPath(uid, sessionId)).download();
    } catch (e) {
        const is404 = e.code === 404 || e.message?.includes('No such object');
        if (is404) return null;
        throw e;
    }

    const manifesto = JSON.parse(manifestoBuf.toString('utf-8'));
    await Promise.all(manifesto.arquivos.map(async (caminho) => {
        const [conteudoBuf] = await bucket.file(_arquivoPath(uid, sessionId, caminho)).download();
        criarArquivo(destDir, caminho, conteudoBuf.toString('utf-8'));
    }));

    return { framework: manifesto.framework || null, arquivos: manifesto.arquivos };
}

/**
 * Apaga um projeto persistido — usado quando um novo upload substitui o
 * anterior na mesma sessão (pra nunca acumular mais de um projeto por
 * sessão no GCS) ou por `apagarProjetosExpirados()` (TTL). Sempre libera
 * a cota do dono via o doc de rastreamento — sem isso, toda substituição
 * (não só expiração) vazava cota pro usuário indefinidamente.
 */
async function apagarProjeto(uid, sessionId) {
    const trackingRef = db.collection(COLECAO_RASTREAMENTO).doc(_idRastreamento(uid, sessionId));
    const trackingSnap = await trackingRef.get().catch(() => null);

    await bucket.deleteFiles({ prefix: `${_prefixo(uid, sessionId)}/`, force: true }).catch(() => {
        // sessão sem projeto anterior (nada pra apagar) — não é erro
    });

    if (trackingSnap && trackingSnap.exists) {
        const { email, tamanhoBytes } = trackingSnap.data();
        await trackingRef.delete().catch(() => {});
        if (email && tamanhoBytes) await liberarCota(email, tamanhoBytes);
    }
}

// Pura — decide se um projeto está expirado dado o timestamp de criação.
// Testável isoladamente sem tocar Firestore/GCS (mesmo padrão de
// storageService.verificarCota — lógica pura separada do I/O que a
// envolve). Data inválida nunca expira sozinha (fail-safe: preferível
// reter demais a apagar por engano num dado corrompido).
function _estaExpirado(criadoEmIso, diasParaExpirar, agora = new Date()) {
    const criadoEm = new Date(criadoEmIso);
    if (Number.isNaN(criadoEm.getTime())) return false;
    const limiteMs = diasParaExpirar * 24 * 60 * 60 * 1000;
    return (agora.getTime() - criadoEm.getTime()) > limiteMs;
}

/**
 * Varre `solaris_projetos_persistidos` e apaga (GCS + rastreamento +
 * libera cota, via `apagarProjeto()`) todo projeto mais velho que
 * `diasParaExpirar`. Chamado pela rota interna POST
 * /internal/solaris/limpar-projetos-expirados (Cloud Scheduler ou
 * manual) ou por `npm run solaris:limpar-projetos-expirados`. Nunca
 * lança por causa de UM projeto com erro — acumula em `erros` e
 * continua os demais.
 *
 * @returns {Promise<{ apagados: string[], erros: Array<{id:string, erro:string}> }>}
 */
async function apagarProjetosExpirados({ diasParaExpirar = DIAS_RETENCAO_PADRAO } = {}) {
    const snap = await db.collection(COLECAO_RASTREAMENTO).get();
    const apagados = [];
    const erros = [];

    for (const doc of snap.docs) {
        const { uid, sessionId, criadoEm } = doc.data();
        if (!_estaExpirado(criadoEm, diasParaExpirar)) continue;
        try {
            await apagarProjeto(uid, sessionId);
            apagados.push(doc.id);
        } catch (err) {
            erros.push({ id: doc.id, erro: err.message });
        }
    }

    return { apagados, erros };
}

module.exports = {
    salvarProjeto, carregarProjeto, apagarProjeto, apagarProjetosExpirados,
    _estaExpirado, DIAS_RETENCAO_PADRAO, COLECAO_RASTREAMENTO,
};
