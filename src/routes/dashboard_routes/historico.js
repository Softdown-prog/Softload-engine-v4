'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin }               = require('../../middlewares/authGuard');
const { db, bucket, admin }         = require('../../services/firebase');
const { parseBloggerXMLToHTML }     = require('../../lib/bloggerPreviewRenderer');
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../../core/presets');
const { STORAGE_LIMITS_MB }         = require('../../services/storageService');

const FV = admin.firestore.FieldValue;

const GRID_LABELS = {
    lista:   'Lista',
    revista: 'Revista',
    mosaico: 'Mosaico',
    coluna:  'Coluna',
};

// GET /dashboard/historico — lista as últimas 30 compilações do usuário
router.get('/dashboard/historico', exigirLogin, async (req, res) => {
    try {
        const email    = req.session.user.email.toLowerCase();
        const snapshot = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(30)
            .get();

        const compilacoes = snapshot.docs.map(doc => {
            const d = doc.data();
            const preset = COLOR_PRESETS[d.colorPreset] || COLOR_PRESETS['tech-blue'];
            const typo   = TYPOGRAPHY_PRESETS[d.typography];

            return {
                id:             doc.id,
                arquivo:        d.arquivo,
                gcPath:         d.gcPath,
                xmlPath:        d.xmlPath || null,
                tamanhoBytes:   d.tamanhoBytes || 0,
                siteName:       d.siteName || 'Sem nome',
                colorPreset:    d.colorPreset || 'tech-blue',
                colorLabel:     preset.label,
                colorHex:       preset.primary,
                typography:     d.typography  || null,
                typographyLabel: typo ? typo.label.split('(')[0].trim() : (d.typography || null),
                gridLayout:     d.gridLayout  || null,
                gridLabel:      GRID_LABELS[d.gridLayout] || d.gridLayout || null,
                enableSeo:      d.enableSeo   || d.seo || false,
                buttonStyle:    d.buttonStyle || null,
                geradoPorIA:    d.geradoPorIA || false,
                criadoEm:       d.criadoEm
                    ? d.criadoEm.toDate().toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })
                    : '—',
                criadoEmISO: d.criadoEm ? d.criadoEm.toDate().toISOString() : null,
            };
        });

        const totalIA         = compilacoes.filter(c => c.geradoPorIA).length;
        const storageLimitMb  = STORAGE_LIMITS_MB[req.session.user.plano] ?? STORAGE_LIMITS_MB.free;

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.render('pages/dashboard/historico', {
            user:       req.session.user,
            titulo:     'Histórico | Softload',
            activePage: 'historico',
            compilacoes,
            totalIA,
            storageLimitMb,
        });
    } catch (err) {
        console.error('[HISTORICO]', err.message);
        res.render('pages/dashboard/historico', {
            user:       req.session.user,
            titulo:     'Histórico | Softload',
            activePage: 'historico',
            compilacoes:    [],
            totalIA:        0,
            storageLimitMb: 5,
        });
    }
});

// GET /dashboard/compilacao/:id/download — stream direto do GCS
router.get('/dashboard/compilacao/:id/download', exigirLogin, async (req, res) => {
    const t0  = Date.now();
    const pad = () => new Promise(r => setTimeout(r, Math.max(0, 100 - (Date.now() - t0))));

    try {
        const user  = req.session.user;
        const email = user.email.toLowerCase();
        const doc   = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.id).get();

        if (!doc.exists) {
            await pad(); return res.status(404).send('Arquivo não encontrado.');
        }

        const data   = doc.data();
        const gcPath = data.gcPath;

        // Garante que o path pertence ao UID do usuário — bloqueia acesso cruzado
        const prefixoEsperado = `users/${user.uid}/`;
        if (typeof gcPath !== 'string' || !gcPath.startsWith(prefixoEsperado)) {
            console.warn(`[DOWNLOAD] gcPath '${gcPath}' não pertence ao usuário ${user.uid} — bloqueado.`);
            await pad(); return res.status(403).send('Acesso negado.');
        }

        const nomeArquivo = data.arquivo || 'template.zip';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

        bucket.file(gcPath)
            .createReadStream()
            .on('error', (err) => {
                console.error('[DOWNLOAD]', err.message);
                if (!res.headersSent) res.status(500).send('Falha ao baixar arquivo.');
            })
            .pipe(res);

    } catch (err) {
        console.error('[DOWNLOAD]', err.message);
        if (!res.headersSent) res.status(500).send('Falha ao baixar arquivo. Tente novamente.');
    }
});

// GET /dashboard/preview/session — preview sem Firestore, usa wsPreview da sessão HTTP
router.get('/dashboard/preview/session', exigirLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const prev = req.session.wsPreview;

        if (!prev || !prev.xmlPath || !prev.xmlPath.startsWith(`users/${user.uid}/`)) {
            return res.redirect('/dashboard/workspace');
        }

        const [contents] = await bucket.file(prev.xmlPath).download();
        const previewHtml = parseBloggerXMLToHTML(contents.toString('utf-8'), prev.siteName || 'Meu Blog');

        res.render('pages/dashboard/preview', {
            user,
            titulo:          `Preview — ${prev.siteName || 'Template'} | Softload`,
            activePage:      'workspace',
            siteName:        prev.siteName    || 'Template',
            compilacaoId:    prev.compilacaoId || null,
            colorPreset:     prev.colorPreset  || null,
            nichoTema:       prev.nichoTema    || null,
            from:            'workspace',
            previewHtmlB64:  Buffer.from(previewHtml).toString('base64'),
        });
    } catch (err) {
        console.error('[PREVIEW-SESSION]', err.message);
        res.redirect('/dashboard/workspace');
    }
});

// GET /dashboard/preview/:id — renderiza preview visual do template XML
router.get('/dashboard/preview/:id', exigirLogin, async (req, res) => {
    // Tempo mínimo de resposta — equaliza timing entre doc existente e não-existente
    // para impedir enumeração por análise de latência (timing attack).
    const t0    = Date.now();
    const pad   = () => new Promise(r => setTimeout(r, Math.max(0, 100 - (Date.now() - t0))));

    try {
        const user  = req.session.user;
        const email = user.email.toLowerCase();
        const doc   = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.id).get();

        if (!doc.exists) { await pad(); return res.status(404).render('pages/404'); }

        const data    = doc.data();

        // xmlPath: salvo a partir do pipeline atualizado.
        // Fallback para compilações antigas: deriva do gcPath trocando .zip → .xml
        // (o storageService sempre salvou o XML bruto, só não persistia o path).
        const xmlPath = data.xmlPath
            || (data.gcPath ? data.gcPath.replace(/\.zip$/, '.xml') : null);

        if (!xmlPath || !xmlPath.startsWith(`users/${user.uid}/`)) {
            await pad(); return res.status(404).render('pages/404');
        }

        const [contents] = await bucket.file(xmlPath).download();
        const previewHtml = parseBloggerXMLToHTML(contents.toString('utf-8'), data.siteName || 'Meu Blog');

        const from = req.query.from === 'workspace' ? 'workspace' : 'historico';
        await pad();
        res.render('pages/dashboard/preview', {
            user,
            titulo:         `Preview — ${data.siteName || 'Template'} | Softload`,
            activePage:     from,
            siteName:       data.siteName || 'Template',
            compilacaoId:   req.params.id,
            colorPreset:    data.colorPreset || null,
            nichoTema:      data.nichoTema   || null,
            from,
            previewHtmlB64: Buffer.from(previewHtml).toString('base64'),
        });
    } catch (err) {
        console.error('[PREVIEW]', err.message);
        await pad(); res.status(500).render('pages/404');
    }
});

// DELETE /dashboard/compilacao/:id — apaga template do GCS + Firestore
router.delete('/dashboard/compilacao/:id', exigirLogin, async (req, res) => {
    try {
        const user    = req.session.user;
        const email   = user.email.toLowerCase();
        const docRef  = db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.id);

        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ erro: 'Compilação não encontrada.' });

        const data    = doc.data();
        const gcPath  = data.gcPath;
        const xmlPath = data.xmlPath;

        // Segurança: o gcPath tem que pertencer ao UID do usuário
        const prefixo = `users/${user.uid}/`;
        if (typeof gcPath !== 'string' || !gcPath.startsWith(prefixo)) {
            return res.status(403).json({ erro: 'Acesso negado.' });
        }

        // Apaga arquivos no GCS (zip + xml)
        const gcsOps = [bucket.file(gcPath).delete({ ignoreNotFound: true })];
        if (xmlPath && typeof xmlPath === 'string' && xmlPath.startsWith(prefixo)) {
            gcsOps.push(bucket.file(xmlPath).delete({ ignoreNotFound: true }));
        }
        await Promise.all(gcsOps);

        // Apaga doc no Firestore
        await docRef.delete();
        console.log(`[HISTORICO] Firestore doc ${req.params.id} deletado.`);

        // Decrementa storage_usado_mb com proteção contra negativo
        const tamanhoMb = (data.tamanhoBytes || 0) / (1024 * 1024);
        if (tamanhoMb > 0) {
            await db.runTransaction(async (tx) => {
                const userRef = db.collection('clientes_premium').doc(email);
                const snap    = await tx.get(userRef);
                if (snap.exists) {
                    const atual = snap.data().storage_usado_mb || 0;
                    tx.update(userRef, { storage_usado_mb: Math.max(0, atual - tamanhoMb) });
                }
            });
        }

        console.log(`[HISTORICO] Compilação ${req.params.id} excluída por ${email}`);
        res.json({ sucesso: true, id: req.params.id });

    } catch (err) {
        console.error('[DELETE-COMPILACAO]', err.message);
        res.status(500).json({ erro: 'Falha ao excluir. Tente novamente.' });
    }
});

module.exports = router;
